import type { CutCandidate, KeepSegment } from "../types";
import {
  addTicks,
  compareTicks,
  divTicksBySmallInt,
  msToTicks,
  multiplyTicksBySmallInt,
  subtractTicks,
  type TickString
} from "../ticks";

export interface ClipRange {
  clipId: string;
  /** クリップのSource In/Out */
  sourceInTicks: TickString;
  sourceOutTicks: TickString;
  /** クリップのSequence上の開始位置 */
  sequenceStartTicks: TickString;
}

/**
 * 選択済み候補からKeep Segment（残す区間）を生成する（仕様19章）。
 *
 * 「指定時間まで短縮」の場合、残す無音は前40%/後60%で分配する（仕様23章）:
 * 削除区間を [start+retain*0.4, end-retain*0.6] に縮めることで、
 * 前のKeep Segmentの末尾に40%、次のKeep Segmentの先頭に60%の無音が残る。
 *
 * destinationStartTicks は前のSegmentの終端に詰めた位置（左詰め）。
 * クリップ先頭のSequence位置(sequenceStartTicks)から開始する。
 */
export function planKeepSegments(
  clip: ClipRange,
  selectedCandidates: CutCandidate[]
): KeepSegment[] {
  // クリップ範囲内の選択済み候補のみ、開始順
  const cuts = selectedCandidates
    .filter((c) => c.selected && c.clipId === clip.clipId)
    .map((c) => shrinkForRetention(c))
    .filter((c) => compareTicks(c.startTicks, c.endTicks) < 0)
    .filter(
      (c) =>
        compareTicks(c.endTicks, clip.sourceInTicks) > 0 &&
        compareTicks(c.startTicks, clip.sourceOutTicks) < 0
    )
    .map((c) => ({
      startTicks: maxT(c.startTicks, clip.sourceInTicks),
      endTicks: minT(c.endTicks, clip.sourceOutTicks)
    }))
    .sort((a, b) => compareTicks(a.startTicks, b.startTicks));

  // 重なり検証（mergeCandidates後は起きないはずだが防御）
  for (let i = 1; i < cuts.length; i++) {
    const prev = cuts[i - 1];
    const cur = cuts[i];
    if (prev && cur && compareTicks(cur.startTicks, prev.endTicks) < 0) {
      throw new Error(
        "削除候補が重なっています。候補統合(mergeCandidates)を先に実行してください。"
      );
    }
  }

  const segments: KeepSegment[] = [];
  let cursor = clip.sourceInTicks;
  let destCursor = clip.sequenceStartTicks;
  let index = 0;
  const pushSegment = (srcIn: TickString, srcOut: TickString): void => {
    if (compareTicks(srcIn, srcOut) >= 0) return; // 空区間は生成しない
    const duration = subtractTicks(srcOut, srcIn);
    const originalSeqStart = addTicks(
      clip.sequenceStartTicks,
      subtractTicks(srcIn, clip.sourceInTicks)
    );
    segments.push({
      id: `${clip.clipId}-keep-${index++}`,
      sourceInTicks: srcIn,
      sourceOutTicks: srcOut,
      originalSequenceStartTicks: originalSeqStart,
      destinationStartTicks: destCursor,
      durationTicks: duration
    });
    destCursor = addTicks(destCursor, duration);
  };

  for (const cut of cuts) {
    pushSegment(cursor, cut.startTicks);
    cursor = cut.endTicks;
  }
  pushSegment(cursor, clip.sourceOutTicks);
  return segments;
}

/** 残す無音を前40%/後60%で分配して削除区間を縮める */
function shrinkForRetention(c: CutCandidate): { startTicks: TickString; endTicks: TickString } {
  if (c.retainedDurationMs <= 0) {
    return { startTicks: c.sourceStartTicks, endTicks: c.sourceEndTicks };
  }
  const retainTicks = msToTicks(c.retainedDurationMs);
  const total = subtractTicks(c.sourceEndTicks, c.sourceStartTicks);
  if (compareTicks(retainTicks, total) >= 0) {
    // 全部残す → 削除なし（空区間）
    return { startTicks: c.sourceStartTicks, endTicks: c.sourceStartTicks };
  }
  // 前40% / 後60%
  const front = divTicksBySmallInt(multiplyTicksBySmallInt(retainTicks, 40), 100).quotient;
  const back = subtractTicks(retainTicks, front);
  return {
    startTicks: addTicks(c.sourceStartTicks, front),
    endTicks: subtractTicks(c.sourceEndTicks, back)
  };
}

function maxT(a: TickString, b: TickString): TickString {
  return compareTicks(a, b) >= 0 ? a : b;
}
function minT(a: TickString, b: TickString): TickString {
  return compareTicks(a, b) <= 0 ? a : b;
}

/** Keep Segmentの合計時間 */
export function totalKeptTicks(segments: KeepSegment[]): TickString {
  return segments.reduce<TickString>((acc, s) => addTicks(acc, s.durationTicks), "0");
}
