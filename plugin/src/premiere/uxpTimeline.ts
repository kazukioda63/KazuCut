/**
 * Premiere実機のタイムライン操作（実機Probe確定挙動に基づく。docs/api-probe.md / D-017）。
 *
 * 実機の掟:
 * - DOMオブジェクトはawaitを挟んで保持しない。毎回スキャンし直す
 * - Action生成→executeTransactionは project.lockedAccess() 内で同期実行
 * - Moveは相対オフセット（移動量 = 目的地 − 現在地）
 * - SetInPointは末尾固定の先頭トリム（startが動く）
 * - CloneはリンクAudio非複製（V/Aを別々に処理）
 * - RemoveはMediaType定数（VIDEO/AUDIO）が必須、ripple=false
 */
import type {
  PproModule,
  PproProject,
  PproSequence,
  PproTrackItem
} from "./pproTypes";
import { clipTrackItemType } from "./pproTypes";
import { addTicks, compareTicks, subtractTicks, type TickString } from "../ticks";

export interface LiveClip {
  kind: "video" | "audio";
  trackIndex: number;
  trackName: string;
  name: string;
  projectItemName: string;
  startTicks: TickString;
  endTicks: TickString;
  inTicks: TickString;
  outTicks: TickString;
  speed: number;
  reversed: boolean;
}

export async function freshSequence(project: PproProject, guid: string): Promise<PproSequence> {
  const all = await project.getSequences();
  const seq = all.find((s) => String(s.guid) === guid);
  if (!seq) throw new Error(`シーケンスが見つかりません: ${guid}`);
  return seq;
}

export function runTransaction(
  project: PproProject,
  label: string,
  buildActions: () => unknown[]
): void {
  let innerError: unknown = null;
  project.lockedAccess(() => {
    try {
      project.executeTransaction((compound) => {
        for (const action of buildActions()) compound.addAction(action as never);
      }, label);
    } catch (e) {
      innerError = e;
    }
  });
  if (innerError) throw innerError;
}

async function liveItems(
  ppro: PproModule,
  project: PproProject,
  guid: string,
  kind: "video" | "audio",
  index: number
): Promise<PproTrackItem[]> {
  const seq = await freshSequence(project, guid);
  const track = kind === "video" ? await seq.getVideoTrack(index) : await seq.getAudioTrack(index);
  // 実機知見: getTrackItemsはnull要素を含む配列を返すことがある（多数クリップ操作時に観測）
  return track.getTrackItems(clipTrackItemType(ppro), false).filter((x) => x != null);
}

export async function scanTrack(
  ppro: PproModule,
  project: PproProject,
  guid: string,
  kind: "video" | "audio",
  index: number
): Promise<LiveClip[]> {
  const seq = await freshSequence(project, guid);
  const track = kind === "video" ? await seq.getVideoTrack(index) : await seq.getAudioTrack(index);
  const items = track.getTrackItems(clipTrackItemType(ppro), false).filter((x) => x != null);
  const out: LiveClip[] = [];
  for (const item of items) {
    const projectItem = await item.getProjectItem().catch(() => null);
    out.push({
      kind,
      trackIndex: index,
      trackName: track.name,
      name: await item.getName(),
      projectItemName: projectItem?.name ?? "",
      startTicks: (await item.getStartTime()).ticks,
      endTicks: (await item.getEndTime()).ticks,
      inTicks: (await item.getInPoint()).ticks,
      outTicks: (await item.getOutPoint()).ticks,
      // 実機知見(2026-07-12): getSpeed()は倍率を返す（1.0=100%速度）。
      // プロジェクト内部表現はパーセント（100=100%）のため変換する
      speed: Math.round((await item.getSpeed().catch(() => 1)) * 100),
      reversed: Boolean(await item.isSpeedReversed().catch(() => 0))
    });
  }
  return out;
}

export async function trackCount(
  project: PproProject,
  guid: string,
  kind: "video" | "audio"
): Promise<number> {
  const seq = await freshSequence(project, guid);
  return kind === "video" ? seq.getVideoTrackCount() : seq.getAudioTrackCount();
}

/** 位置述語で「今の」TrackItemを解決する（毎回取り直し・一意でなければ例外） */
async function resolveItem(
  ppro: PproModule,
  project: PproProject,
  guid: string,
  kind: "video" | "audio",
  index: number,
  predicate: (c: { start: string; in_: string; out: string }) => boolean,
  what: string
): Promise<PproTrackItem> {
  const items = await liveItems(ppro, project, guid, kind, index);
  const hits: PproTrackItem[] = [];
  for (const item of items) {
    const start = (await item.getStartTime()).ticks;
    const in_ = (await item.getInPoint()).ticks;
    const out = (await item.getOutPoint()).ticks;
    if (predicate({ start, in_, out })) hits.push(item);
  }
  if (hits.length !== 1 || !hits[0]) {
    throw new Error(`${what}: 対象が${hits.length}件（期待1件）。安全のため中止します`);
  }
  return hits[0];
}

function mediaTypeConstant(ppro: PproModule, kind: "video" | "audio"): unknown {
  const mt = (ppro as unknown as { Constants?: { MediaType?: Record<string, unknown> } })
    .Constants?.MediaType;
  const v = kind === "video" ? mt?.["VIDEO"] : mt?.["AUDIO"];
  if (v === undefined) throw new Error("Constants.MediaTypeが取得できません");
  return v;
}

/** startで特定したクリップを一時領域へ複製し、複製後の実位置を返す */
export async function cloneClipToTemp(
  ppro: PproModule,
  project: PproProject,
  guid: string,
  kind: "video" | "audio",
  trackIndex: number,
  sourceStartTicks: TickString,
  tempPosTicks: TickString
): Promise<{ observedStartTicks: TickString }> {
  const before = await scanTrack(ppro, project, guid, kind, trackIndex);
  const beforeStarts = new Set(before.map((c) => c.startTicks));

  const item = await resolveItem(
    ppro, project, guid, kind, trackIndex,
    (c) => c.start === sourceStartTicks,
    "Clone対象"
  );
  const currentStart = (await item.getStartTime()).ticks;
  const offset = subtractTicks(tempPosTicks, currentStart);
  const seq = await freshSequence(project, guid);
  const editor = ppro.SequenceEditor.getEditor(seq);
  runTransaction(project, "KazuCut: クリップ複製", () => [
    editor.createCloneTrackItemAction(item, ppro.TickTime.createWithTicks(offset), 0, 0, true, false)
  ]);

  // 複製前後差分で新規TrackItemを特定（推測特定禁止・仕様19章）
  const after = await scanTrack(ppro, project, guid, kind, trackIndex);
  const added = after.filter((c) => !beforeStarts.has(c.startTicks));
  if (added.length !== 1 || !added[0]) {
    throw new Error(`複製後の新規TrackItemが${added.length}件（期待1件）。中止します`);
  }
  return { observedStartTicks: added[0].startTicks };
}

/** 一時領域上のクリップ（start特定）へIn/Outを設定し、設定後の実位置を返す */
export async function setClipInOut(
  ppro: PproModule,
  project: PproProject,
  guid: string,
  kind: "video" | "audio",
  trackIndex: number,
  currentStartTicks: TickString,
  inTicks: TickString,
  outTicks: TickString
): Promise<{ observedStartTicks: TickString }> {
  const item = await resolveItem(
    ppro, project, guid, kind, trackIndex,
    (c) => c.start === currentStartTicks,
    "In/Out設定対象"
  );
  runTransaction(project, "KazuCut: In/Out設定", () => [
    item.createSetInPointAction(ppro.TickTime.createWithTicks(inTicks)),
    item.createSetOutPointAction(ppro.TickTime.createWithTicks(outTicks))
  ]);
  // SetInで先頭トリム→startが移動するため、in/outで取り直して実位置を得る
  const after = await scanTrack(ppro, project, guid, kind, trackIndex);
  const hits = after.filter((c) => c.inTicks === inTicks && c.outTicks === outTicks);
  if (hits.length !== 1 || !hits[0]) {
    throw new Error(`In/Out設定後の特定が${hits.length}件（期待1件）。中止します`);
  }
  return { observedStartTicks: hits[0].startTicks };
}

/** 相対Moveで目的位置へ移動し、着地を検証する */
export async function moveClipTo(
  ppro: PproModule,
  project: PproProject,
  guid: string,
  kind: "video" | "audio",
  trackIndex: number,
  currentStartTicks: TickString,
  destStartTicks: TickString
): Promise<void> {
  if (compareTicks(currentStartTicks, destStartTicks) === 0) return;
  const item = await resolveItem(
    ppro, project, guid, kind, trackIndex,
    (c) => c.start === currentStartTicks,
    "Move対象"
  );
  const delta = subtractTicks(destStartTicks, currentStartTicks);
  runTransaction(project, "KazuCut: クリップ移動", () => [
    item.createMoveAction(ppro.TickTime.createWithTicks(delta))
  ]);
  const after = await scanTrack(ppro, project, guid, kind, trackIndex);
  if (!after.some((c) => c.startTicks === destStartTicks)) {
    throw new Error(
      `Move着地検証失敗: ${destStartTicks} にクリップがありません（実位置: ${after.map((c) => c.startTicks).join(",")}）`
    );
  }
}

/** startで特定したクリップをripple無しで削除する */
export async function removeClipAt(
  ppro: PproModule,
  project: PproProject,
  guid: string,
  kind: "video" | "audio",
  trackIndex: number,
  startTicks: TickString
): Promise<void> {
  const item = await resolveItem(
    ppro, project, guid, kind, trackIndex,
    (c) => c.start === startTicks,
    "削除対象"
  );
  const seq = await freshSequence(project, guid);
  const selection = await seq.getSelection();
  const existing = await selection.getTrackItems();
  for (const it of existing) selection.removeItem(it);
  selection.addItem(item, true);
  const editor = ppro.SequenceEditor.getEditor(seq);
  const mediaType = mediaTypeConstant(ppro, kind);
  runTransaction(project, "KazuCut: クリップ削除", () => [
    editor.createRemoveItemsAction(selection, false, mediaType, false)
  ]);
}

export async function sequenceEndTicks(project: PproProject, guid: string): Promise<TickString> {
  const seq = await freshSequence(project, guid);
  return (await seq.getEndTime()).ticks;
}

/** シーケンス複製→GUID差分で特定 */
export async function cloneSequenceAndIdentify(
  project: PproProject,
  sourceGuid: string
): Promise<{ guid: string; name: string }> {
  const before = await project.getSequences();
  const beforeGuids = new Set(before.map((s) => String(s.guid)));
  const fresh = await freshSequence(project, sourceGuid);
  runTransaction(project, "KazuCut: シーケンス複製", () => [fresh.createCloneAction()]);
  const after = await project.getSequences();
  const added = after.filter((s) => !beforeGuids.has(String(s.guid)));
  if (added.length !== 1 || !added[0]) {
    throw new Error(`複製後の新規シーケンスが${added.length}件（期待1件）`);
  }
  return { guid: String(added[0].guid), name: added[0].name };
}

/** 全トラックの指紋（不変検証用） */
export async function sequenceFingerprint(
  ppro: PproModule,
  project: PproProject,
  guid: string
): Promise<string> {
  const parts: string[] = [];
  for (const kind of ["video", "audio"] as const) {
    const count = await trackCount(project, guid, kind);
    for (let i = 0; i < count; i++) {
      const clips = await scanTrack(ppro, project, guid, kind, i);
      for (const c of clips) {
        parts.push(
          `${kind}${i}:${c.projectItemName}:${c.startTicks}-${c.endTicks}:${c.inTicks}/${c.outTicks}:${c.speed}`
        );
      }
    }
  }
  return parts.sort().join("|");
}

/**
 * 1トラック分のKeep Segment再構築（戦略A・実機版）。
 * 手順: 一時領域確保確認 → Segmentごとに[Clone→In/Out→位置追跡] → 元削除 → 目的位置へMove。
 */
export interface RebuildSegment {
  sourceInTicks: TickString;
  sourceOutTicks: TickString;
  destinationStartTicks: TickString;
}

export async function rebuildTrackSegments(
  ppro: PproModule,
  project: PproProject,
  guid: string,
  kind: "video" | "audio",
  trackIndex: number,
  originalStartTicks: TickString,
  segments: RebuildSegment[],
  log: (message: string) => void
): Promise<void> {
  if (segments.length === 0) throw new Error("Keep Segmentが0件");
  const seqEnd = await sequenceEndTicks(project, guid);
  const tempBase = addTicks(seqEnd, "2540160000000"); // 末尾+10秒

  // 一時領域が空であることを確認（仕様19章）+ 元クリップの長さを取得
  let originalDuration: TickString;
  {
    const clips = await scanTrack(ppro, project, guid, kind, trackIndex);
    const inTemp = clips.filter((c) => compareTicks(c.endTicks, tempBase) > 0);
    if (inTemp.length > 0) {
      throw new Error(`一時領域が空ではありません（${inTemp.length}件）`);
    }
    const original = clips.find((c) => c.startTicks === originalStartTicks);
    if (!original) throw new Error("元クリップが見つかりません");
    originalDuration = subtractTicks(original.endTicks, original.startTicks);
  }
  // 複製直後のクリップは元の長さのまま置かれるため、間隔は「元の長さ+10秒」。
  // 10秒間隔では2つ目のClone(overwrite)が1つ目を上書きして破壊する
  // （2026-07-12 Phase 3初回実行で実機検出）
  const tempGap = addTicks(originalDuration, "2540160000000");

  // ---- バッチ実行（トラックあたりTransaction 4回）----
  // 2回目適用時のPremiereクラッシュを受けて、Segmentごとの逐次Transaction
  // （3n+1回）+大量スキャンを廃止し、DOM負荷を約50分の1へ削減（2026-07-12）。

  // 生アイテムスキャン（オブジェクトは即時使用のみ・保持しない）
  const rawScan = async (): Promise<
    { item: PproTrackItem; start: TickString; in_: TickString; out: TickString }[]
  > => {
    const items = await liveItems(ppro, project, guid, kind, trackIndex);
    const out: { item: PproTrackItem; start: TickString; in_: TickString; out: TickString }[] = [];
    for (const item of items) {
      out.push({
        item,
        start: (await item.getStartTime()).ticks,
        in_: (await item.getInPoint()).ticks,
        out: (await item.getOutPoint()).ticks
      });
    }
    return out;
  };
  const inTempArea = (start: TickString): boolean => compareTicks(start, tempBase) >= 0;

  // --- 1/4: 全Segmentを一括Clone ---
  const tempPositions: TickString[] = segments.map((_, i) => {
    let p = tempBase;
    for (let k = 0; k < i; k++) p = addTicks(p, tempGap);
    return p;
  });
  {
    const scan = await rawScan();
    const beforeStarts = new Set(scan.map((r) => r.start));
    const src = scan.filter((r) => r.start === originalStartTicks);
    if (src.length !== 1 || !src[0]) {
      throw new Error(`${kind}: Clone元の特定が${src.length}件（期待1件）`);
    }
    const srcItem = src[0].item;
    const srcStart = src[0].start;
    const seqNow = await freshSequence(project, guid);
    const editor = ppro.SequenceEditor.getEditor(seqNow);
    runTransaction(project, "KazuCut Local：Aロールを編集（複製）", () =>
      tempPositions.map((pos) =>
        editor.createCloneTrackItemAction(
          srcItem, ppro.TickTime.createWithTicks(subtractTicks(pos, srcStart)), 0, 0, true, false
        )
      )
    );
    const after = await rawScan();
    const added = after
      .filter((r) => !beforeStarts.has(r.start))
      .sort((a, b) => compareTicks(a.start, b.start));
    if (added.length !== segments.length) {
      throw new Error(
        `${kind}: 一括Clone後の新規TrackItemが${added.length}件（期待${segments.length}件）。中止します`
      );
    }
    log(`${kind}: ${segments.length}件を一括複製OK`);

    // --- 2/4: 全SegmentのIn/Outを一括設定（temp位置昇順=Segment順で対応付け） ---
    runTransaction(project, "KazuCut Local：Aロールを編集（トリム）", () => {
      const actions: unknown[] = [];
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const target = added[i];
        if (!seg || !target) continue;
        actions.push(target.item.createSetInPointAction(ppro.TickTime.createWithTicks(seg.sourceInTicks)));
        actions.push(target.item.createSetOutPointAction(ppro.TickTime.createWithTicks(seg.sourceOutTicks)));
      }
      return actions;
    });
    log(`${kind}: In/Out一括設定OK`);
  }

  // --- 3/4: 元クリップ削除 ---
  await removeClipAt(ppro, project, guid, kind, trackIndex, originalStartTicks);
  log(`${kind}: 元クリップ削除OK`);

  // --- 4/4: 一時領域から目的位置へ一括Move（(in,out)で対応付け） ---
  {
    const scan = await rawScan();
    const moves: { item: PproTrackItem; deltaTicks: TickString }[] = [];
    for (const seg of segments) {
      const hits = scan.filter(
        (r) => inTempArea(r.start) && r.in_ === seg.sourceInTicks && r.out === seg.sourceOutTicks
      );
      if (hits.length !== 1 || !hits[0]) {
        throw new Error(
          `${kind}: Segment(in=${seg.sourceInTicks})の特定が${hits.length}件（期待1件）。中止します`
        );
      }
      moves.push({
        item: hits[0].item,
        deltaTicks: subtractTicks(seg.destinationStartTicks, hits[0].start)
      });
    }
    runTransaction(project, "KazuCut Local：Aロールを編集（配置）", () =>
      moves.map((m) => m.item.createMoveAction(ppro.TickTime.createWithTicks(m.deltaTicks)))
    );
    log(`${kind}: ${segments.length}件を一括配置OK`);
  }

  // 着地検証
  {
    const finalScan = await rawScan();
    for (const seg of segments) {
      if (!finalScan.some((r) => r.start === seg.destinationStartTicks)) {
        throw new Error(`${kind}: 配置検証失敗 dest=${seg.destinationStartTicks}`);
      }
    }
  }
}
