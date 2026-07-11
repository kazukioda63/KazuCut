import { describe, expect, it } from "vitest";
import { planKeepSegments, totalKeptTicks } from "../../plugin/src/analysis/keepSegmentPlanner";
import { addTicks, msToTicks, subtractTicks, ticksToApproxMs } from "../../plugin/src/ticks";
import type { CutCandidate } from "../../plugin/src/types";

const clip = {
  clipId: "clip1",
  sourceInTicks: msToTicks(0),
  sourceOutTicks: msToTicks(10000), // 10秒クリップ
  sequenceStartTicks: msToTicks(2000) // シーケンス上2秒から
};

function cut(id: string, startMs: number, endMs: number, retainedMs = 0): CutCandidate {
  return {
    id,
    reason: "silence",
    clipId: "clip1",
    sourceStartTicks: msToTicks(startMs),
    sourceEndTicks: msToTicks(endMs),
    sequenceStartTicks: addTicks(clip.sequenceStartTicks, msToTicks(startMs)),
    sequenceEndTicks: addTicks(clip.sequenceStartTicks, msToTicks(endMs)),
    originalDurationMs: endMs - startMs,
    retainedDurationMs: retainedMs,
    removalDurationMs: endMs - startMs - retainedMs,
    selected: true,
    warnings: [],
    metadata: {}
  };
}

describe("Keep Segment生成（仕様19章）", () => {
  it("中央500ms削除で2つのKeep Segmentを生成する（Phase 3の最小実証計画）", () => {
    // 中央: 4750〜5250ms
    const segments = planKeepSegments(clip, [cut("c", 4750, 5250)]);
    expect(segments).toHaveLength(2);
    const [s1, s2] = segments;
    expect(s1!.sourceInTicks).toBe(msToTicks(0));
    expect(s1!.sourceOutTicks).toBe(msToTicks(4750));
    expect(s1!.destinationStartTicks).toBe(clip.sequenceStartTicks);
    expect(s2!.sourceInTicks).toBe(msToTicks(5250));
    expect(s2!.sourceOutTicks).toBe(msToTicks(10000));
    // 後半は左詰め: destination = clipStart + 4750ms
    expect(s2!.destinationStartTicks).toBe(addTicks(clip.sequenceStartTicks, msToTicks(4750)));
    // 合計 = 10000 - 500 = 9500ms
    expect(Math.round(ticksToApproxMs(totalKeptTicks(segments)))).toBe(9500);
  });

  it("短縮モード: 残す無音を前40%/後60%で分配する（仕様23章）", () => {
    // 1200msの無音（2000〜3200ms）を90ms残す → 削除は2036〜3146ms
    const segments = planKeepSegments(clip, [cut("c", 2000, 3200, 90)]);
    expect(segments).toHaveLength(2);
    const front = Math.round(ticksToApproxMs(segments[0]!.sourceOutTicks));
    const back = Math.round(ticksToApproxMs(segments[1]!.sourceInTicks));
    expect(front).toBe(2036); // 2000 + 90*0.4
    expect(back).toBe(3146); // 3200 - 90*0.6
  });

  it("複数削除の左詰めが正しい", () => {
    const segments = planKeepSegments(clip, [cut("a", 1000, 1500), cut("b", 3000, 4000)]);
    expect(segments).toHaveLength(3);
    const s3 = segments[2]!;
    // 3つ目のdestination = clipStart + (1000 + 1500)ms（前2区間の長さ）
    expect(s3.destinationStartTicks).toBe(addTicks(clip.sequenceStartTicks, msToTicks(2500)));
    expect(Math.round(ticksToApproxMs(totalKeptTicks(segments)))).toBe(8500);
  });

  it("クリップ先頭の無音削除（Keep Segmentは1つ）", () => {
    const segments = planKeepSegments(clip, [cut("c", 0, 800)]);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.sourceInTicks).toBe(msToTicks(800));
    expect(segments[0]!.destinationStartTicks).toBe(clip.sequenceStartTicks);
  });

  it("未選択候補・他クリップの候補は無視する", () => {
    const other = { ...cut("x", 1000, 2000), clipId: "clip2" };
    const unselected = { ...cut("y", 3000, 4000), selected: false };
    const segments = planKeepSegments(clip, [other, unselected]);
    expect(segments).toHaveLength(1);
    expect(Math.round(ticksToApproxMs(totalKeptTicks(segments)))).toBe(10000);
  });

  it("重なる候補はエラー（統合を先に実行すべき）", () => {
    expect(() =>
      planKeepSegments(clip, [cut("a", 1000, 2000), cut("b", 1500, 2500)])
    ).toThrow();
  });

  it("originalSequenceStartTicksが元位置を保持する", () => {
    const segments = planKeepSegments(clip, [cut("c", 4750, 5250)]);
    const s2 = segments[1]!;
    expect(s2.originalSequenceStartTicks).toBe(
      addTicks(clip.sequenceStartTicks, msToTicks(5250))
    );
    // 移動量 = original - destination = 500ms
    expect(
      Math.round(
        ticksToApproxMs(subtractTicks(s2.originalSequenceStartTicks, s2.destinationStartTicks))
      )
    ).toBe(500);
  });
});
