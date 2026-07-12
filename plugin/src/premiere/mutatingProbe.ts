/**
 * 変更系API Probe（Phase 2後半）。
 *
 * 安全設計:
 * - 元シーケンスへは一切変更を加えない。最初に複製を作り、複製上でのみ実験する
 * - 実行前に元シーケンスの全TrackItemを記録し、終了後に不変を検証して報告する
 * - 終了時に複製シーケンスを削除する（deleteSequenceの検証を兼ねる）
 *
 * 実機知見（2026-07-12の初回実行で確認）:
 * - awaitを挟んで保持したDOMオブジェクトは "The script object is no longer valid."
 *   で失効し得る → 各Mutationの直前に必ずオブジェクトを取り直す
 * - Action生成は project.lockedAccess() 内で行い、その中でexecuteTransactionする
 */
import type { ProbeResult } from "../types";
import type {
  PproModule,
  PproProject,
  PproSequence,
  PproTrackItem
} from "./pproTypes";
import { clipTrackItemType } from "./pproTypes";
import { addTicks, subtractTicks } from "../ticks";

interface ItemSnapshot {
  name: string;
  start: string;
  end: string;
  inPoint: string;
  outPoint: string;
}

async function snapshotItem(item: PproTrackItem): Promise<ItemSnapshot> {
  return {
    name: await item.getName(),
    start: (await item.getStartTime()).ticks,
    end: (await item.getEndTime()).ticks,
    inPoint: (await item.getInPoint()).ticks,
    outPoint: (await item.getOutPoint()).ticks
  };
}

/** GUIDでシーケンスを取り直す（保持オブジェクトの失効対策） */
async function freshSequence(project: PproProject, guid: string): Promise<PproSequence> {
  const all = await project.getSequences();
  const seq = all.find((s) => String(s.guid) === guid);
  if (!seq) throw new Error(`シーケンスが見つかりません: ${guid}`);
  return seq;
}

/** Action生成〜Transactionを lockedAccess 内で同期実行する（仕様20章） */
function runTransaction(
  project: PproProject,
  label: string,
  buildActions: () => unknown[]
): void {
  let innerError: unknown = null;
  project.lockedAccess(() => {
    try {
      project.executeTransaction((compound) => {
        for (const action of buildActions()) {
          compound.addAction(action as never);
        }
      }, label);
    } catch (e) {
      innerError = e;
    }
  });
  if (innerError) throw innerError;
}

interface TrackItemsScan {
  kind: "video" | "audio";
  trackName: string;
  trackIndex: number;
  items: PproTrackItem[];
}

/** トラックとTrackItemを毎回取り直してスキャンする */
async function scanAll(ppro: PproModule, project: PproProject, guid: string): Promise<TrackItemsScan[]> {
  const seq = await freshSequence(project, guid);
  const clipType = clipTrackItemType(ppro);
  const out: TrackItemsScan[] = [];
  const vCount = await seq.getVideoTrackCount();
  for (let i = 0; i < vCount; i++) {
    const track = await seq.getVideoTrack(i);
    out.push({ kind: "video", trackName: track.name, trackIndex: i, items: track.getTrackItems(clipType, false).filter((x) => x != null) });
  }
  const aCount = await seq.getAudioTrackCount();
  for (let i = 0; i < aCount; i++) {
    const track = await seq.getAudioTrack(i);
    out.push({ kind: "audio", trackName: track.name, trackIndex: i, items: track.getTrackItems(clipType, false).filter((x) => x != null) });
  }
  return out;
}

async function sequenceFingerprint(ppro: PproModule, project: PproProject, guid: string): Promise<string> {
  const scans = await scanAll(ppro, project, guid);
  const parts: string[] = [];
  for (const scan of scans) {
    for (const item of scan.items) {
      const s = await snapshotItem(item);
      parts.push(`${scan.kind}${scan.trackIndex}:${s.name}:${s.start}-${s.end}:${s.inPoint}/${s.outPoint}`);
    }
  }
  return parts.sort().join("|");
}

function countKind(scans: TrackItemsScan[], kind: "video" | "audio"): number {
  return scans.filter((s) => s.kind === kind).reduce((n, s) => n + s.items.length, 0);
}

export async function runMutatingProbe(ppro: PproModule): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  const push = (apiName: string, succeeded: boolean, notes: string[], error?: string): void => {
    const r: ProbeResult = { apiName, available: succeeded, succeeded, notes };
    if (error !== undefined) r.error = error;
    results.push(r);
  };

  const project = await ppro.Project.getActiveProject();
  if (!project) {
    push("前提: アクティブプロジェクト", false, [], "プロジェクトがありません");
    return results;
  }
  const active = await project.getActiveSequence();
  if (!active) {
    push("前提: アクティブシーケンス", false, [], "シーケンスがありません");
    return results;
  }
  const originalGuid = String(active.guid);
  const originalFingerprint = await sequenceFingerprint(ppro, project, originalGuid);

  // --- 1. シーケンス複製 + GUID差分特定 ---
  let cloneGuid: string | null = null;
  try {
    const before = await project.getSequences();
    const beforeGuids = new Set(before.map((s) => String(s.guid)));
    // 直前に取り直したオブジェクトでlockedAccess内Action生成（失効対策）
    const fresh = await freshSequence(project, originalGuid);
    runTransaction(project, "KazuCut Probe: シーケンス複製", () => [fresh.createCloneAction()]);
    const after = await project.getSequences();
    const added = after.filter((s) => !beforeGuids.has(String(s.guid)));
    if (added.length === 1 && added[0]) {
      cloneGuid = String(added[0].guid);
      push("sequence.createCloneAction + GUID差分特定", true, [
        `新規シーケンス1件を特定: name=${added[0].name}`,
        "lockedAccess内でAction生成→executeTransactionのパターンで成功"
      ]);
    } else {
      push("sequence.createCloneAction + GUID差分特定", false, [
        `新規シーケンスが${added.length}件（期待1件）`
      ]);
    }
  } catch (e) {
    push("sequence.createCloneAction + GUID差分特定", false, [], String(e));
  }

  if (cloneGuid) {
    const guid = cloneGuid;
    try {
      // 複製上のクリップ一覧
      const scans = await scanAll(ppro, project, guid);
      push(
        "複製シーケンスのTrackItem列挙",
        true,
        scans.filter((s) => s.items.length > 0).map((s) => `${s.kind}[${s.trackName}]: ${s.items.length}件`)
      );

      const videoScan = scans.find((s) => s.kind === "video" && s.items.length > 0);
      if (!videoScan) {
        push("複製上のVideoクリップ", false, [
          "Videoクリップが1つもありません。クリップのあるシーケンスで実行してください"
        ]);
      } else {
        const videoCountBefore = countKind(scans, "video");
        const audioCountBefore = countKind(scans, "audio");
        const firstVideo = videoScan.items[0];
        const vBefore = firstVideo ? await snapshotItem(firstVideo) : null;

        // --- 2. TrackItem Clone（isInsert=false、一時領域=末尾+10秒） ---
        let clonedFound = false;
        let clonedStartTicks = "";
        if (vBefore) {
          try {
            // 直前に全部取り直す
            const seqNow = await freshSequence(project, guid);
            const seqEnd = (await seqNow.getEndTime()).ticks;
            const offsetTicks = addTicks(subtractTicks(seqEnd, vBefore.start), "2540160000000"); // 末尾+10秒
            const scanNow = await scanAll(ppro, project, guid);
            const vTrackNow = scanNow.find((s) => s.kind === "video" && s.trackIndex === videoScan.trackIndex);
            const target = vTrackNow?.items[0];
            if (!target) throw new Error("Clone対象を再取得できません");
            const seqForEditor = await freshSequence(project, guid);
            const editor = ppro.SequenceEditor.getEditor(seqForEditor);
            const offsetT = ppro.TickTime.createWithTicks(offsetTicks);
            runTransaction(project, "KazuCut Probe: TrackItem Clone", () => [
              editor.createCloneTrackItemAction(target, offsetT, 0, 0, true, false)
            ]);

            const afterScan = await scanAll(ppro, project, guid);
            const videoAdded = countKind(afterScan, "video") - videoCountBefore;
            const audioAdded = countKind(afterScan, "audio") - audioCountBefore;
            push("SequenceEditor.createCloneTrackItemAction(isInsert=false)", videoAdded === 1, [
              `新規Video TrackItem: ${videoAdded}件（期待1件）`,
              `新規Audio TrackItem: ${audioAdded}件 → リンクAudio${audioAdded > 0 ? "も同時複製される" : "は複製されない"}`,
              `timeOffset=${offsetTicks}（相対オフセットとして指定）`
            ]);

            // 新規Videoの位置を特定
            const vTrackAfter = afterScan.find((s) => s.kind === "video" && s.trackIndex === videoScan.trackIndex);
            if (vTrackAfter) {
              for (const item of vTrackAfter.items) {
                const s = await snapshotItem(item);
                if (s.start !== vBefore.start) {
                  clonedFound = true;
                  clonedStartTicks = s.start;
                  push("Clone後の新規TrackItem特定（start差分）", true, [
                    `複製位置 start=${s.start}（期待: 元start+offset=${addTicks(vBefore.start, offsetTicks)}）`
                  ]);
                  break;
                }
              }
            }
            if (!clonedFound) {
              push("Clone後の新規TrackItem特定（start差分）", false, ["差分が見つかりません"]);
            }
          } catch (e) {
            push("SequenceEditor.createCloneTrackItemAction", false, [], String(e));
          }
        }

        // --- 3. createMoveAction セマンティクス判定（複製したクリップに対して） ---
        if (clonedFound) {
          try {
            const target = "2540160000000"; // 10秒位置
            const scanNow = await scanAll(ppro, project, guid);
            const vTrack = scanNow.find((s) => s.kind === "video" && s.trackIndex === videoScan.trackIndex);
            let moveTarget: PproTrackItem | undefined;
            for (const item of vTrack?.items ?? []) {
              if ((await item.getStartTime()).ticks === clonedStartTicks) moveTarget = item;
            }
            if (!moveTarget) throw new Error("Move対象を再取得できません");
            const before = await snapshotItem(moveTarget);
            runTransaction(project, "KazuCut Probe: Move", () => [
              moveTarget.createMoveAction(ppro.TickTime.createWithTicks(target))
            ]);
            // 取り直して結果確認
            const scanAfter = await scanAll(ppro, project, guid);
            const vTrackAfter = scanAfter.find((s) => s.kind === "video" && s.trackIndex === videoScan.trackIndex);
            const starts: string[] = [];
            for (const item of vTrackAfter?.items ?? []) {
              starts.push((await item.getStartTime()).ticks);
            }
            let semantics = "判定不能";
            let movedStart = "";
            if (starts.includes(target)) {
              semantics = "絶対位置（指定tickへ移動）";
              movedStart = target;
            } else {
              const relative = addTicks(before.start, target);
              if (starts.includes(relative)) {
                semantics = "相対オフセット（現在位置+指定tick）";
                movedStart = relative;
              }
            }
            clonedStartTicks = movedStart || clonedStartTicks;
            push("trackItem.createMoveAction", semantics !== "判定不能", [
              `移動前start=${before.start} / 指定値=${target}`,
              `移動後の全start=[${starts.join(", ")}]`,
              `セマンティクス判定: ${semantics}`
            ]);
          } catch (e) {
            push("trackItem.createMoveAction", false, [], String(e));
          }

          // --- 4. In/Out変更 + リンク連動観察 ---
          try {
            const scanNow = await scanAll(ppro, project, guid);
            const vTrack = scanNow.find((s) => s.kind === "video" && s.trackIndex === videoScan.trackIndex);
            let target: PproTrackItem | undefined;
            for (const item of vTrack?.items ?? []) {
              if ((await item.getStartTime()).ticks === clonedStartTicks) target = item;
            }
            if (!target) throw new Error("SetInPoint対象を再取得できません");
            const before = await snapshotItem(target);
            const newIn = addTicks(before.inPoint, "127008000000"); // +0.5秒
            runTransaction(project, "KazuCut Probe: SetInPoint", () => [
              target.createSetInPointAction(ppro.TickTime.createWithTicks(newIn))
            ]);
            const scanAfter = await scanAll(ppro, project, guid);
            const vTrackAfter = scanAfter.find((s) => s.kind === "video" && s.trackIndex === videoScan.trackIndex);
            const details: string[] = [];
            for (const item of vTrackAfter?.items ?? []) {
              const s = await snapshotItem(item);
              details.push(`start=${s.start} in=${s.inPoint} out=${s.outPoint} end=${s.end}`);
            }
            push("trackItem.createSetInPointAction", true, [
              `変更前: start=${before.start} in=${before.inPoint} end=${before.end}`,
              `指定In=${newIn}`,
              ...details.map((d) => `変更後: ${d}`)
            ]);
          } catch (e) {
            push("trackItem.createSetInPointAction", false, [], String(e));
          }

          // --- 5. createRemoveItemsAction(ripple=false) 引数バリエーション探索 ---
          // 初回実機実行でmediaType=undefinedが "Illegal Parameter type" となったため、
          // 成功する引数形を自動探索して記録する
          try {
            const constants = (ppro as unknown as { Constants?: Record<string, unknown> }).Constants;
            const mediaTypeObj = constants?.MediaType as Record<string, unknown> | undefined;
            push("Constants.MediaType の内容", !!mediaTypeObj, [
              `Constantsキー: ${constants ? Object.keys(constants).join(", ") : "なし"}`,
              `MediaType: ${mediaTypeObj ? JSON.stringify(Object.keys(mediaTypeObj).map((k) => `${k}=${String(mediaTypeObj[k])}`)) : "なし"}`
            ]);

            const variants: { label: string; mediaType: unknown; argCount: 2 | 4 }[] = [
              { label: "(selection, false)", mediaType: null, argCount: 2 },
              { label: "(selection, false, MediaType.VIDEO, false)", mediaType: mediaTypeObj?.["VIDEO"], argCount: 4 },
              { label: "(selection, false, MediaType.ANY, false)", mediaType: mediaTypeObj?.["ANY"], argCount: 4 },
              { label: "(selection, false, MediaType.Video, false)", mediaType: mediaTypeObj?.["Video"], argCount: 4 }
            ];

            let succeededVariant: string | null = null;
            const attempts: string[] = [];
            for (const variant of variants) {
              if (variant.argCount === 4 && variant.mediaType === undefined) {
                attempts.push(`${variant.label}: スキップ（MediaType定数なし）`);
                continue;
              }
              try {
                const seqNow = await freshSequence(project, guid);
                const scanNow = await scanAll(ppro, project, guid);
                const vTrack = scanNow.find(
                  (s) => s.kind === "video" && s.trackIndex === videoScan.trackIndex
                );
                let removeTarget: PproTrackItem | undefined;
                for (const item of vTrack?.items ?? []) {
                  const s = (await item.getStartTime()).ticks;
                  if (vBefore && s !== vBefore.start) removeTarget = item;
                }
                if (!removeTarget) {
                  attempts.push(`${variant.label}: 対象なし（既に削除済み?）`);
                  break;
                }
                const target = removeTarget;
                const selection = await seqNow.getSelection();
                const existing = await selection.getTrackItems();
                for (const it of existing) selection.removeItem(it);
                selection.addItem(target, true);
                const editor = ppro.SequenceEditor.getEditor(seqNow);
                runTransaction(project, "KazuCut Probe: Remove", () => [
                  variant.argCount === 2
                    ? (editor.createRemoveItemsAction as unknown as (
                        s: unknown, r: boolean) => unknown)(selection, false)
                    : editor.createRemoveItemsAction(selection, false, variant.mediaType, false)
                ]);
                const afterScan = await scanAll(ppro, project, guid);
                const vCountNow = countKind(afterScan, "video");
                if (vCountNow === videoCountBefore) {
                  succeededVariant = variant.label;
                  attempts.push(`${variant.label}: ✅ 成功（Video件数=${vCountNow}）`);
                  break;
                }
                attempts.push(`${variant.label}: 実行はできたが件数が${vCountNow}（期待${videoCountBefore}）`);
              } catch (e) {
                attempts.push(`${variant.label}: ${String(e)}`);
              }
            }
            push(
              "SequenceEditor.createRemoveItemsAction(ripple=false)",
              succeededVariant !== null,
              [...attempts, succeededVariant ? `採用形: ${succeededVariant}` : "全バリエーション失敗"]
            );
          } catch (e) {
            push("SequenceEditor.createRemoveItemsAction", false, [], String(e));
          }
        }
      }
    } catch (e) {
      push("複製シーケンス上の実験", false, [], String(e));
    }

    // --- 6. 複製シーケンスの削除 ---
    try {
      const cloneFresh = await freshSequence(project, guid);
      const deleted = await project.deleteSequence(cloneFresh);
      push("project.deleteSequence(複製の後始末)", deleted === true, [`戻り値=${String(deleted)}`]);
    } catch (e) {
      push("project.deleteSequence", false, ["複製シーケンスが残っています。手動で削除してください"], String(e));
    }
  }

  // --- 元シーケンスの不変検証 ---
  try {
    const fingerprintAfter = await sequenceFingerprint(ppro, project, originalGuid);
    const intact = fingerprintAfter === originalFingerprint;
    push("元シーケンス不変検証", intact, [
      intact
        ? "元シーケンスの全TrackItemが変更されていないことを確認"
        : "⚠️ 元シーケンスに差分があります。Undo(Ctrl+Z)で確認してください"
    ]);
  } catch (e) {
    push("元シーケンス不変検証", false, [], String(e));
  }

  return results;
}
