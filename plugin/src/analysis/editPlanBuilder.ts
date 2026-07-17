import type { CutCandidate, KeepSegment } from "../types";
import { planKeepSegments, type ClipRange } from "./keepSegmentPlanner";
import { addTicks, compareTicks, subtractTicks, type TickString } from "../ticks";

export interface ClipEditPlan {
  clipId: string;
  keepSegments: KeepSegment[];
  /** このクリップで短縮された時間 */
  removedTicks: TickString;
}

export interface EditPlan {
  clips: ClipEditPlan[];
  totalRemovedTicks: TickString;
}

/**
 * 「Aロールトラック全体」モードの編集計画（仕様15章）:
 * - クリップごとにKeep Segmentを生成
 * - 意図的なクリップ間ギャップは維持（ギャップ長を変えない）
 * - 前のクリップまでの累積短縮時間だけ後続クリップ全体を左へ移動
 * - 対象外トラックは対象にしない（このモジュールは対象クリップのみ扱う）
 * - frameTicks 指定時は削除区間をフレーム境界へ丸める（D-021。詳細はkeepSegmentPlanner）
 */
export function buildEditPlan(
  clips: ClipRange[],
  candidates: CutCandidate[],
  frameTicks?: TickString | null
): EditPlan {
  const sorted = [...clips].sort((a, b) =>
    compareTicks(a.sequenceStartTicks, b.sequenceStartTicks)
  );
  const plans: ClipEditPlan[] = [];
  let cumulativeRemoved: TickString = "0";

  for (const clip of sorted) {
    // クリップ自体を累積短縮分だけ左へ移動した位置から計画
    const shiftedClip: ClipRange = {
      ...clip,
      sequenceStartTicks: subtractTicks(clip.sequenceStartTicks, cumulativeRemoved)
    };
    const segments = planKeepSegments(shiftedClip, candidates, frameTicks);
    const clipDuration = subtractTicks(clip.sourceOutTicks, clip.sourceInTicks);
    const kept = segments.reduce<TickString>(
      (acc, s) => addTicks(acc, s.durationTicks),
      "0"
    );
    const removed = subtractTicks(clipDuration, kept);
    if (compareTicks(removed, "0") < 0) {
      throw new Error(`クリップ${clip.clipId}: 保持時間が元の長さを超えています`);
    }
    plans.push({ clipId: clip.clipId, keepSegments: segments, removedTicks: removed });
    cumulativeRemoved = addTicks(cumulativeRemoved, removed);
  }

  return { clips: plans, totalRemovedTicks: cumulativeRemoved };
}
