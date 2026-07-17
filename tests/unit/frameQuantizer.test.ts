import { describe, expect, it } from "vitest";
import {
  ceilToFrame,
  floorToFrame,
  parseFrameTicks,
  quantizeCutOffsets
} from "../../plugin/src/analysis/frameQuantizer";
import { planKeepSegments } from "../../plugin/src/analysis/keepSegmentPlanner";
import { buildEditPlan } from "../../plugin/src/analysis/editPlanBuilder";
import {
  addTicks,
  divTicksBySmallInt,
  msToTicks,
  subtractTicks
} from "../../plugin/src/ticks";
import type { CutCandidate } from "../../plugin/src/types";

const F30 = "8467200000"; // 30fps: 1フレームのTick長
const F2997 = "8475667200"; // 29.97fps

describe("parseFrameTicks（実機APIの返値解釈）", () => {
  it("getTimebaseの整数文字列（1フレームTick数）をそのまま受理する", () => {
    expect(parseFrameTicks("8467200000")).toBe("8467200000");
    expect(parseFrameTicks("10594584000")).toBe("10594584000"); // 23.976
  });
  it("fps数値は標準フレームレートへスナップする", () => {
    expect(parseFrameTicks(30)).toBe("8467200000");
    expect(parseFrameTicks(29.97)).toBe("8475667200");
    expect(parseFrameTicks(59.94)).toBe("4237833600");
    expect(parseFrameTicks(23.976)).toBe("10594584000");
  });
  it("ticksPerFrame数値・FrameRate風オブジェクトを受理する", () => {
    expect(parseFrameTicks(8467200000)).toBe("8467200000");
    expect(parseFrameTicks({ ticksPerFrame: 8475667200 })).toBe("8475667200");
    expect(parseFrameTicks({ value: 60 })).toBe("4233600000");
    expect(parseFrameTicks({ ticks: "10160640000" })).toBe("10160640000"); // 25fps
  });
  it("解釈不能・範囲外はnull（呼び出し側は丸めなしで続行）", () => {
    expect(parseFrameTicks(undefined)).toBeNull();
    expect(parseFrameTicks(null)).toBeNull();
    expect(parseFrameTicks("")).toBeNull();
    expect(parseFrameTicks("abc")).toBeNull();
    expect(parseFrameTicks(0)).toBeNull();
    expect(parseFrameTicks(-30)).toBeNull();
    expect(parseFrameTicks("254016000000")).toBeNull(); // 1秒/フレームは範囲外
    expect(parseFrameTicks({})).toBeNull();
  });
});

describe("floor/ceilToFrame", () => {
  it("境界上はそのまま、途中は正しい方向へ丸める", () => {
    expect(floorToFrame("0", F30)).toBe("0");
    expect(ceilToFrame("0", F30)).toBe("0");
    expect(floorToFrame(F30, F30)).toBe(F30);
    expect(ceilToFrame(F30, F30)).toBe(F30);
    const mid = addTicks(F30, "1"); // 1フレーム+1tick
    expect(floorToFrame(mid, F30)).toBe(F30);
    expect(ceilToFrame(mid, F30)).toBe(addTicks(F30, F30));
  });
});

describe("quantizeCutOffsets（安全側の丸め）", () => {
  it("開始は切り上げ・終了は切り下げ（カットが縮む方向）", () => {
    // 110ms〜520ms（30fpsではどちらもコマの途中: 3.3フレーム / 15.6フレーム）
    const q = quantizeCutOffsets(msToTicks(110), msToTicks(520), F30);
    expect(q).not.toBeNull();
    expect(q!.startOffsetTicks).toBe("33868800000"); // 4フレーム（切り上げ）
    expect(q!.endOffsetTicks).toBe("127008000000"); // 15フレーム（切り下げ）
    expect(divTicksBySmallInt(q!.startOffsetTicks, Number(F30)).remainder).toBe(0);
    expect(divTicksBySmallInt(q!.endOffsetTicks, Number(F30)).remainder).toBe(0);
  });
  it("丸めて空になるカットはnull", () => {
    // 1フレーム未満のカット（コマの途中同士）
    const start = addTicks(F30, "1000");
    const end = addTicks(addTicks(F30, F30), "-1000");
    expect(quantizeCutOffsets(start, end, F30)).toBeNull();
  });
});

function cut(id: string, startMs: number, endMs: number): CutCandidate {
  return {
    id,
    reason: "silence",
    clipId: "clip1",
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

const clip = {
  clipId: "clip1",
  sourceInTicks: msToTicks(0),
  sourceOutTicks: msToTicks(10000),
  sequenceStartTicks: "0"
};

function remOf(ticks: string, frame: string): number {
  return divTicksBySmallInt(ticks, Number(frame)).remainder;
}

describe("planKeepSegments + フレーム丸め（D-021: 1コマ空白の防止）", () => {
  it("全Segment境界と配置位置がフレーム境界に揃う", () => {
    // ms由来でコマに揃わない境界（30fps: 333msも777msも途中）
    const segments = planKeepSegments(clip, [cut("a", 333, 777), cut("b", 5100, 6050)], F30);
    expect(segments.length).toBe(3);
    for (const s of segments) {
      expect(remOf(subtractTicks(s.sourceInTicks, clip.sourceInTicks), F30)).toBe(0);
      expect(remOf(s.destinationStartTicks, F30)).toBe(0);
      // 末尾Segment以外は終端もフレーム境界
      if (s.sourceOutTicks !== clip.sourceOutTicks) {
        expect(remOf(subtractTicks(s.sourceOutTicks, clip.sourceInTicks), F30)).toBe(0);
      }
    }
    // 隙間なし: 前Segmentの配置終端 = 次Segmentの配置開始
    for (let i = 1; i < segments.length; i++) {
      const prev = segments[i - 1]!;
      const prevEnd = addTicks(prev.destinationStartTicks, prev.durationTicks);
      expect(segments[i]!.destinationStartTicks).toBe(prevEnd);
    }
  });

  it("29.97fpsでも揃う", () => {
    const segments = planKeepSegments(clip, [cut("a", 2000, 3500)], F2997);
    expect(segments.length).toBe(2);
    expect(remOf(segments[1]!.destinationStartTicks, F2997)).toBe(0);
  });

  it("クリップ末尾まで達するカットの終端は丸めない（切れ端Segmentを作らない）", () => {
    const segments = planKeepSegments(clip, [cut("a", 8000, 10000)], F30);
    expect(segments.length).toBe(1); // 末尾のKeep Segmentは生成されない
    expect(segments[0]!.sourceOutTicks).toBe(msToTicks(8000)); // 8000ms = 240フレームちょうど
  });

  it("1フレーム未満に縮むカットは行わない（安全側）", () => {
    // 30fpsの1フレーム=約33.3ms。40msのカットは丸めると空になり得る
    const segments = planKeepSegments(clip, [cut("a", 340, 380)], F30);
    expect(segments.length).toBe(1);
    expect(segments[0]!.sourceInTicks).toBe(clip.sourceInTicks);
    expect(segments[0]!.sourceOutTicks).toBe(clip.sourceOutTicks);
  });

  it("frameTicksなし（取得失敗時）は従来動作", () => {
    const segments = planKeepSegments(clip, [cut("a", 333, 777)], null);
    expect(segments[0]!.sourceOutTicks).toBe(msToTicks(333));
  });
});

describe("buildEditPlan + フレーム丸め（複数クリップの累積左詰め）", () => {
  it("後続クリップの移動量がフレームの整数倍になる", () => {
    const clips = [
      clip,
      {
        clipId: "clip2",
        sourceInTicks: "0",
        sourceOutTicks: msToTicks(5000),
        sequenceStartTicks: msToTicks(10000)
      }
    ];
    const plan = buildEditPlan(clips, [cut("a", 333, 777)], F30);
    expect(remOf(plan.totalRemovedTicks, F30)).toBe(0);
    const clip2 = plan.clips[1]!;
    // クリップ2は累積短縮分だけ左へ（フレーム整数倍 → 元位置と同じ位相）
    expect(remOf(clip2.keepSegments[0]!.destinationStartTicks, F30)).toBe(0);
  });
});
