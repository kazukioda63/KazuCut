import { describe, expect, it } from "vitest";
import { buildEditPlan } from "../../plugin/src/analysis/editPlanBuilder";
import { addTicks, msToTicks, ticksToApproxMs } from "../../plugin/src/ticks";
import type { CutCandidate } from "../../plugin/src/types";

function cut(clipId: string, id: string, startMs: number, endMs: number): CutCandidate {
  return {
    id,
    reason: "silence",
    clipId,
    sourceStartTicks: msToTicks(startMs),
    sourceEndTicks: msToTicks(endMs),
    sequenceStartTicks: msToTicks(startMs),
    sequenceEndTicks: msToTicks(endMs),
    originalDurationMs: endMs - startMs,
    retainedDurationMs: 0,
    removalDurationMs: endMs - startMs,
    selected: true,
    warnings: [],
    metadata: {}
  };
}

describe("Edit Plan（Aロールトラック全体・仕様15章）", () => {
  const clip1 = {
    clipId: "c1",
    sourceInTicks: msToTicks(0),
    sourceOutTicks: msToTicks(5000),
    sequenceStartTicks: msToTicks(0)
  };
  // 意図的な500msギャップの後にclip2
  const clip2 = {
    clipId: "c2",
    sourceInTicks: msToTicks(0),
    sourceOutTicks: msToTicks(5000),
    sequenceStartTicks: msToTicks(5500)
  };

  it("前クリップの累積短縮分だけ後続クリップを左移動し、ギャップは維持する", () => {
    // clip1内で1000ms削除
    const plan = buildEditPlan([clip1, clip2], [cut("c1", "a", 1000, 2000)]);
    expect(plan.clips).toHaveLength(2);
    expect(Math.round(ticksToApproxMs(plan.totalRemovedTicks))).toBe(1000);
    // clip2のKeep Segmentは 5500-1000=4500ms から開始（ギャップ500ms維持）
    const c2seg = plan.clips[1]!.keepSegments[0]!;
    expect(c2seg.destinationStartTicks).toBe(msToTicks(4500));
  });

  it("複数クリップ双方の削除が累積する", () => {
    const plan = buildEditPlan(
      [clip1, clip2],
      [cut("c1", "a", 0, 500), cut("c2", "b", 1000, 1300)]
    );
    expect(Math.round(ticksToApproxMs(plan.totalRemovedTicks))).toBe(800);
    // clip1のKeep: 500〜5000 → dest 0
    expect(plan.clips[0]!.keepSegments[0]!.destinationStartTicks).toBe(msToTicks(0));
    // clip2は500ms左へ: seg1 dest=5000, seg2 dest=5000+1000=6000
    expect(plan.clips[1]!.keepSegments[0]!.destinationStartTicks).toBe(msToTicks(5000));
    expect(plan.clips[1]!.keepSegments[1]!.destinationStartTicks).toBe(msToTicks(6000));
  });

  it("削除なしならクリップ位置不変", () => {
    const plan = buildEditPlan([clip1, clip2], []);
    expect(plan.totalRemovedTicks).toBe("0");
    expect(plan.clips[1]!.keepSegments[0]!.destinationStartTicks).toBe(
      addTicks(msToTicks(5500), "0")
    );
  });
});
