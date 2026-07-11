import type { CutCandidate } from "../types";
import { compareTicks, maxTicks, minTicks, subtractTicks, ticksToApproxMs, msToTicks } from "../ticks";

/**
 * 無音候補とフィラー候補の統合（仕様29章）。
 * - 重なる/近接する候補はUnionへ統合し、二重削除を防ぐ
 * - retainedはより長い方（安全側=多く残す）を採用
 * - 元Candidate IDはmetadata.mergedFromへ保持
 * - 極端に短い発話片（minSpeechMs未満の候補間ギャップ）は候補へ吸収
 */
export function mergeCandidates(
  candidates: CutCandidate[],
  options: { mergeGapMs: number; minSpeechMs: number }
): CutCandidate[] {
  if (candidates.length === 0) return [];
  const sorted = [...candidates].sort((a, b) =>
    compareTicks(a.sourceStartTicks, b.sourceStartTicks)
  );
  const gapTicks = msToTicks(Math.max(options.mergeGapMs, 0));
  const speechTicks = msToTicks(Math.max(options.minSpeechMs, 0));

  const out: CutCandidate[] = [];
  let cur: CutCandidate | null = null;
  for (const cand of sorted) {
    if (cur === null) {
      cur = cloneCandidate(cand);
      continue;
    }
    // ギャップ = 次候補開始 - 現候補終了
    const gap = subtractTicks(cand.sourceStartTicks, cur.sourceEndTicks);
    const threshold = maxTicks(gapTicks, speechTicks);
    if (compareTicks(gap, threshold) <= 0) {
      cur = mergeTwo(cur, cand);
    } else {
      out.push(cur);
      cur = cloneCandidate(cand);
    }
  }
  if (cur) out.push(cur);
  return out;
}

function cloneCandidate(c: CutCandidate): CutCandidate {
  return {
    ...c,
    warnings: [...c.warnings],
    metadata: { ...c.metadata, mergedFrom: String(c.id) }
  };
}

function mergeTwo(a: CutCandidate, b: CutCandidate): CutCandidate {
  const sourceStart = minTicks(a.sourceStartTicks, b.sourceStartTicks);
  const sourceEnd = maxTicks(a.sourceEndTicks, b.sourceEndTicks);
  const seqStart = minTicks(a.sequenceStartTicks, b.sequenceStartTicks);
  const seqEnd = maxTicks(a.sequenceEndTicks, b.sequenceEndTicks);
  const originalDurationMs = Math.round(
    ticksToApproxMs(subtractTicks(sourceEnd, sourceStart))
  );
  // 安全側: より多く残す方を採用
  const retainedDurationMs = Math.max(a.retainedDurationMs, b.retainedDurationMs);
  const removalDurationMs = Math.max(originalDurationMs - retainedDurationMs, 0);
  const reason = a.reason === "filler" || b.reason === "filler" ? "filler" : a.reason;
  const detectedText =
    [a.detectedText, b.detectedText].filter((t): t is string => !!t).join(" ") || undefined;
  const confidences = [a.confidence, b.confidence].filter(
    (c): c is number => typeof c === "number"
  );
  const confidence = confidences.length > 0 ? Math.min(...confidences) : undefined;

  const merged: CutCandidate = {
    id: a.id,
    reason,
    clipId: a.clipId,
    sourceStartTicks: sourceStart,
    sourceEndTicks: sourceEnd,
    sequenceStartTicks: seqStart,
    sequenceEndTicks: seqEnd,
    originalDurationMs,
    retainedDurationMs,
    removalDurationMs,
    // 統合後の選択状態: 両方選択時のみ選択（安全側）
    selected: a.selected && b.selected,
    warnings: [...new Set([...a.warnings, ...b.warnings])],
    metadata: {
      ...a.metadata,
      ...b.metadata,
      mergedFrom: `${String(a.metadata.mergedFrom ?? a.id)},${String(b.metadata.mergedFrom ?? b.id)}`
    }
  };
  if (detectedText !== undefined) merged.detectedText = detectedText;
  if (confidence !== undefined) merged.confidence = confidence;
  return merged;
}

/**
 * フィラー削除後に残す間(gapAfterMs)を考慮して、フィラー候補のretainedを設定する。
 * 無音と重なる場合は上のmergeCandidatesで安全側のretainedが採用される。
 */
export function applyFillerGap(candidate: CutCandidate, gapAfterMs: number): CutCandidate {
  if (candidate.reason !== "filler") return candidate;
  const retained = Math.min(gapAfterMs, candidate.originalDurationMs);
  return {
    ...candidate,
    retainedDurationMs: retained,
    removalDurationMs: Math.max(candidate.originalDurationMs - retained, 0)
  };
}

/** 統合後の合計短縮時間（ms, 概算・表示用） */
export function totalRemovalMs(candidates: CutCandidate[]): number {
  return candidates
    .filter((c) => c.selected)
    .reduce((sum, c) => sum + c.removalDurationMs, 0);
}
