/**
 * 変更系API Probe（Phase 2後半）。
 *
 * 安全設計:
 * - 元シーケンスへは一切変更を加えない。最初に複製を作り、複製上でのみ実験する
 * - 実行前に元シーケンスの全TrackItemを記録し、終了後に不変を検証して報告する
 * - 終了時に複製シーケンスを削除する（deleteSequenceの検証を兼ねる）
 *
 * 観察項目（ADR-003の確定に必要）:
 * 1. createCloneAction によるシーケンス複製 + GUID差分特定
 * 2. createCloneTrackItemAction: 新規TrackItem数 / リンクAudioも複製されるか / isInsert=false
 * 3. createMoveAction: 引数が絶対位置か相対オフセットか
 * 4. createSetInPointAction/OutPoint: リンク連動の有無
 * 5. createRemoveItemsAction(ripple=false): 後続クリップが動かないか
 * 6. deleteSequence
 */
import type { ProbeResult } from "../types";
import type {
  PproModule,
  PproSequence,
  PproTrack,
  PproTrackItem
} from "./pproTypes";
import { clipTrackItemType } from "./pproTypes";
import { subtractTicks } from "../ticks";

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

async function listAllItems(
  ppro: PproModule,
  seq: PproSequence
): Promise<{ track: PproTrack; kind: "video" | "audio"; items: PproTrackItem[] }[]> {
  const out: { track: PproTrack; kind: "video" | "audio"; items: PproTrackItem[] }[] = [];
  const clipType = clipTrackItemType(ppro);
  const vCount = await seq.getVideoTrackCount();
  for (let i = 0; i < vCount; i++) {
    const track = await seq.getVideoTrack(i);
    out.push({ track, kind: "video", items: track.getTrackItems(clipType, false) });
  }
  const aCount = await seq.getAudioTrackCount();
  for (let i = 0; i < aCount; i++) {
    const track = await seq.getAudioTrack(i);
    out.push({ track, kind: "audio", items: track.getTrackItems(clipType, false) });
  }
  return out;
}

async function snapshotSequence(ppro: PproModule, seq: PproSequence): Promise<string> {
  const tracks = await listAllItems(ppro, seq);
  const parts: string[] = [];
  for (const t of tracks) {
    for (const item of t.items) {
      const s = await snapshotItem(item);
      parts.push(`${t.kind}:${s.name}:${s.start}-${s.end}:${s.inPoint}/${s.outPoint}`);
    }
  }
  return parts.sort().join("|");
}

export async function runMutatingProbe(ppro: PproModule): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  const push = (
    apiName: string,
    succeeded: boolean,
    notes: string[],
    error?: string
  ): void => {
    const r: ProbeResult = { apiName, available: succeeded, succeeded, notes };
    if (error !== undefined) r.error = error;
    results.push(r);
  };

  const project = await ppro.Project.getActiveProject();
  if (!project) {
    push("前提: アクティブプロジェクト", false, [], "プロジェクトがありません");
    return results;
  }
  const original = await project.getActiveSequence();
  if (!original) {
    push("前提: アクティブシーケンス", false, [], "シーケンスがありません");
    return results;
  }

  // 元シーケンスの記録（終了後の不変検証用）
  const originalSnapshotBefore = await snapshotSequence(ppro, original);
  const originalGuid = String(original.guid);

  // --- 1. シーケンス複製 + GUID差分特定 ---
  let clone: PproSequence | null = null;
  try {
    const before = await project.getSequences();
    const beforeGuids = new Set(before.map((s) => String(s.guid)));
    const executed = project.executeTransaction((compound) => {
      compound.addAction(original.createCloneAction());
    }, "KazuCut Probe: シーケンス複製");
    const after = await project.getSequences();
    const added = after.filter((s) => !beforeGuids.has(String(s.guid)));
    if (added.length === 1 && added[0]) {
      clone = added[0];
      push("sequence.createCloneAction + GUID差分特定", true, [
        `executeTransaction戻り値=${String(executed)}`,
        `新規シーケンス1件を特定: name=${clone.name}`
      ]);
    } else {
      push("sequence.createCloneAction + GUID差分特定", false, [
        `新規シーケンスが${added.length}件（期待1件）`
      ]);
    }
  } catch (e) {
    push("sequence.createCloneAction + GUID差分特定", false, [], String(e));
  }

  if (clone) {
    try {
      // 複製上のクリップ一覧
      const tracks = await listAllItems(ppro, clone);
      const withItems = tracks.filter((t) => t.items.length > 0);
      push(
        "複製シーケンスのTrackItem列挙",
        true,
        withItems.map((t) => `${t.kind}[${t.track.name}]: ${t.items.length}件`)
      );

      const videoTrack = tracks.find((t) => t.kind === "video" && t.items.length > 0);
      const firstVideo = videoTrack?.items[0];
      if (firstVideo && videoTrack) {
        const editor = ppro.SequenceEditor.getEditor(clone);
        const seqEnd = (await clone.getEndTime()).ticks;
        const vBefore = await snapshotItem(firstVideo);

        // --- 2. TrackItem Clone（一時領域 = シーケンス末尾+10秒相当のオフセット）---
        try {
          const audioCountBefore = (await listAllItems(ppro, clone))
            .filter((t) => t.kind === "audio")
            .reduce((n, t) => n + t.items.length, 0);
          const videoCountBefore = (await listAllItems(ppro, clone))
            .filter((t) => t.kind === "video")
            .reduce((n, t) => n + t.items.length, 0);

          // timeOffsetは「元位置からの相対」: 末尾+10秒へ動かす量
          const offsetTicks = subtractTicks(
            subtractTicks(seqEnd, vBefore.start),
            "-2540160000000" // +10秒
          );
          const offsetT = ppro.TickTime.createWithTicks(offsetTicks);
          project.executeTransaction((compound) => {
            compound.addAction(
              editor.createCloneTrackItemAction(firstVideo, offsetT, 0, 0, true, false)
            );
          }, "KazuCut Probe: TrackItem Clone");

          const afterClone = await listAllItems(ppro, clone);
          const videoCountAfter = afterClone
            .filter((t) => t.kind === "video")
            .reduce((n, t) => n + t.items.length, 0);
          const audioCountAfter = afterClone
            .filter((t) => t.kind === "audio")
            .reduce((n, t) => n + t.items.length, 0);
          const videoAdded = videoCountAfter - videoCountBefore;
          const audioAdded = audioCountAfter - audioCountBefore;
          push("SequenceEditor.createCloneTrackItemAction(isInsert=false)", videoAdded === 1, [
            `新規Video TrackItem: ${videoAdded}件（期待1件）`,
            `新規Audio TrackItem: ${audioAdded}件 → リンクAudio${audioAdded > 0 ? "も同時複製される" : "は複製されない"}`,
            `timeOffsetは相対オフセットとして渡した`
          ]);

          // 複製された新規Videoを特定（末尾側にあるもの）
          const vTrackNow = afterClone.find(
            (t) => t.kind === "video" && t.track.name === videoTrack.track.name
          );
          const newItems: PproTrackItem[] = [];
          if (vTrackNow) {
            for (const item of vTrackNow.items) {
              const s = await snapshotItem(item);
              if (s.start !== vBefore.start) newItems.push(item);
            }
          }
          const cloned = newItems[0];

          if (cloned) {
            const clonedBefore = await snapshotItem(cloned);

            // --- 3. createMoveAction のセマンティクス判定 ---
            try {
              const target = "2540160000000"; // 10秒位置へ
              project.executeTransaction((compound) => {
                compound.addAction(
                  cloned.createMoveAction(ppro.TickTime.createWithTicks(target))
                );
              }, "KazuCut Probe: Move");
              const moved = await snapshotItem(cloned);
              let semantics = "不明";
              if (moved.start === target) semantics = "絶対位置";
              else {
                const expectOffset = subtractTicks(moved.start, clonedBefore.start);
                semantics = `相対オフセット?（移動量=${expectOffset}）`;
              }
              push("trackItem.createMoveAction", true, [
                `移動前start=${clonedBefore.start}`,
                `指定値=${target}`,
                `移動後start=${moved.start}`,
                `セマンティクス判定: ${semantics}`
              ]);
            } catch (e) {
              push("trackItem.createMoveAction", false, [], String(e));
            }

            // --- 4. In/Out変更 + リンク連動観察 ---
            try {
              const newIn = subtractTicks(clonedBefore.inPoint, "-127008000000"); // +0.5秒
              project.executeTransaction((compound) => {
                compound.addAction(
                  cloned.createSetInPointAction(ppro.TickTime.createWithTicks(newIn))
                );
              }, "KazuCut Probe: SetInPoint");
              const afterIn = await snapshotItem(cloned);
              push("trackItem.createSetInPointAction", true, [
                `inPoint: ${clonedBefore.inPoint} → ${afterIn.inPoint}（期待${newIn}）`,
                `start: ${clonedBefore.start} → ${afterIn.start}`,
                `end: ${clonedBefore.end} → ${afterIn.end}`
              ]);
            } catch (e) {
              push("trackItem.createSetInPointAction", false, [], String(e));
            }

            // --- 5. createRemoveItemsAction(ripple=false) ---
            try {
              const selection = await clone.getSelection();
              // 既存選択を空にしてからProbe対象だけ選択
              const existing = await selection.getTrackItems();
              for (const it of existing) selection.removeItem(it);
              selection.addItem(cloned, true);
              const othersBefore = await snapshotSequence(ppro, clone);
              project.executeTransaction((compound) => {
                compound.addAction(
                  editor.createRemoveItemsAction(selection, false, undefined, false)
                );
              }, "KazuCut Probe: Remove");
              const afterRemove = await listAllItems(ppro, clone);
              const vCountFinal = afterRemove
                .filter((t) => t.kind === "video")
                .reduce((n, t) => n + t.items.length, 0);
              push("SequenceEditor.createRemoveItemsAction(ripple=false)", true, [
                `削除後Video件数=${vCountFinal}（期待${videoCountBefore}）`,
                othersBefore.length > 0 ? "削除前スナップショット取得済み" : ""
              ]);
            } catch (e) {
              push("SequenceEditor.createRemoveItemsAction", false, [], String(e));
            }
          } else {
            push("Clone後の新規TrackItem特定", false, ["startの差分で特定できず"]);
          }
        } catch (e) {
          push("SequenceEditor.createCloneTrackItemAction", false, [], String(e));
        }
      } else {
        push("複製上のVideoクリップ", false, ["Videoクリップが1つもありません。クリップのあるシーケンスで実行してください"]);
      }
    } catch (e) {
      push("複製シーケンス上の実験", false, [], String(e));
    }

    // --- 6. 複製シーケンスの削除 ---
    try {
      const deleted = await project.deleteSequence(clone);
      push("project.deleteSequence(複製の後始末)", deleted === true, [
        `戻り値=${String(deleted)}`
      ]);
    } catch (e) {
      push("project.deleteSequence", false, [
        "複製シーケンスが残っています。手動で削除してください"
      ], String(e));
    }
  }

  // --- 元シーケンスの不変検証 ---
  try {
    const originalAfter = await project.getSequences();
    const stillThere = originalAfter.some((s) => String(s.guid) === originalGuid);
    const snapshotAfter = stillThere
      ? await snapshotSequence(
          ppro,
          originalAfter.find((s) => String(s.guid) === originalGuid) ?? original
        )
      : "";
    const intact = stillThere && snapshotAfter === originalSnapshotBefore;
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
