import { describe, expect, it } from "vitest";
import { applyFillerGap, mergeCandidates, totalRemovalMs } from "../../plugin/src/analysis/candidateMerger";
import { msToTicks } from "../../plugin/src/ticks";
import type { CutCandidate } from "../../plugin/src/types";

function cand(
  id: string,
  startMs: number,
  endMs: number,
  reason: "silence" | "filler",
  retainedMs = 0,
  selected = true
): CutCandidate {
  return {
    id,
    reason,
    clipId: "clip1",
    sourceStartTicks: msToTicks(startMs),
    sourceEndTicks: msToTicks(endMs),
    sequenceStartTicks: msToTicks(startMs),
    sequenceEndTicks: msToTicks(endMs),
    originalDurationMs: endMs - startMs,
    retainedDurationMs: retainedMs,
    removalDurationMs: endMs - startMs - retainedMs,
    selected,
    warnings: [],
    metadata: {}
  };
}

describe("候補統合（仕様29章）", () => {
  it("重なる無音とフィラーをUnionへ統合し二重削除しない", () => {
    const silence = cand("s1", 1000, 1600, "silence", 90);
    const filler = cand("f1", 1400, 1900, "filler", 80);
    const merged = mergeCandidates([silence, filler], { mergeGapMs: 0, minSpeechMs: 0 });
    expect(merged).toHaveLength(1);
    const m = merged[0]!;
    expect(m.sourceStartTicks).toBe(msToTicks(1000));
    expect(m.sourceEndTicks).toBe(msToTicks(1900));
    expect(m.originalDurationMs).toBe(900);
    // 安全側: retainedは大きい方
    expect(m.retainedDurationMs).toBe(90);
    expect(m.removalDurationMs).toBe(810);
    expect(m.reason).toBe("filler");
    expect(String(m.metadata.mergedFrom)).toContain("s1");
    expect(String(m.metadata.mergedFrom)).toContain("f1");
  });

  it("mergeGap以内の近接候補を統合する", () => {
    const a = cand("a", 0, 500, "silence", 90);
    const b = cand("b", 550, 1000, "silence", 90); // 50msギャップ
    const merged = mergeCandidates([a, b], { mergeGapMs: 70, minSpeechMs: 0 });
    expect(merged).toHaveLength(1);
  });

  it("mergeGapを超える候補は統合しない", () => {
    const a = cand("a", 0, 500, "silence");
    const b = cand("b", 700, 1200, "silence"); // 200msギャップ
    const merged = mergeCandidates([a, b], { mergeGapMs: 70, minSpeechMs: 100 });
    expect(merged).toHaveLength(2);
  });

  it("極端に短い発話片（minSpeechMs未満）は候補へ吸収する", () => {
    const a = cand("a", 0, 500, "silence");
    const b = cand("b", 590, 1200, "silence"); // 90ms発話片
    const merged = mergeCandidates([a, b], { mergeGapMs: 0, minSpeechMs: 100 });
    expect(merged).toHaveLength(1);
  });

  it("片方が未選択なら統合後は未選択（安全側）", () => {
    const a = cand("a", 0, 500, "silence", 0, true);
    const b = cand("b", 400, 900, "silence", 0, false);
    const merged = mergeCandidates([a, b], { mergeGapMs: 0, minSpeechMs: 0 });
    expect(merged[0]!.selected).toBe(false);
  });

  it("applyFillerGap: フィラー削除後に残す間を設定する", () => {
    const f = applyFillerGap(cand("f", 0, 480, "filler", 0), 80);
    expect(f.retainedDurationMs).toBe(80);
    expect(f.removalDurationMs).toBe(400);
  });

  it("totalRemovalMs: 選択済みのみ集計", () => {
    const a = cand("a", 0, 500, "silence", 100, true);
    const b = cand("b", 1000, 1500, "silence", 0, false);
    expect(totalRemovalMs([a, b])).toBe(400);
  });
});
