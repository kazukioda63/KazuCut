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

  // Segmentごとに複製→In/Out設定（位置は観測ベースで追跡）
  const placed: { startTicks: TickString; dest: TickString }[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg) continue;
    try {
      let tempPos = tempBase;
      for (let k = 0; k < i; k++) tempPos = addTicks(tempPos, tempGap);
      const cloned = await cloneClipToTemp(
        ppro, project, guid, kind, trackIndex, originalStartTicks, tempPos
      );
      log(`${kind} seg${i}/${segments.length}: 複製OK`);
      const trimmed = await setClipInOut(
        ppro, project, guid, kind, trackIndex,
        cloned.observedStartTicks, seg.sourceInTicks, seg.sourceOutTicks
      );
      log(`${kind} seg${i}/${segments.length}: In/Out設定OK`);
      placed.push({ startTicks: trimmed.observedStartTicks, dest: seg.destinationStartTicks });
    } catch (e) {
      throw new Error(`${kind} seg${i}/${segments.length}で失敗: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 元クリップ削除 → 各Segmentを目的位置へ
  await removeClipAt(ppro, project, guid, kind, trackIndex, originalStartTicks);
  log(`${kind}: 元クリップ削除OK`);
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i];
    if (!p) continue;
    try {
      await moveClipTo(ppro, project, guid, kind, trackIndex, p.startTicks, p.dest);
      log(`${kind} seg${i}/${placed.length}: 配置OK`);
    } catch (e) {
      throw new Error(`${kind} seg${i}の配置で失敗: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
