import { describe, expect, it } from "vitest";
import { compareSnapshots, excludeTargets } from "../../plugin/src/premiere/trackSnapshot";
import type { TrackItemSnapshot } from "../../plugin/src/types";

function item(overrides: Partial<TrackItemSnapshot> = {}): TrackItemSnapshot {
  return {
    mediaType: "audio",
    trackIndex: 1,
    projectItemId: "bgm-1",
    name: "bgm.mp3",
    startTicks: "0",
    endTicks: "15240960000000",
    inTicks: "0",
    outTicks: "15240960000000",
    speed: 100,
    disabled: false,
    ...overrides
  };
}

describe("対象外トラック保護のSnapshot比較（ADR-005）", () => {
  it("不変なら差分なし", () => {
    const before = [item(), item({ mediaType: "video", trackIndex: 2, projectItemId: "guide" })];
    const after = [item(), item({ mediaType: "video", trackIndex: 2, projectItemId: "guide" })];
    expect(compareSnapshots(before, after)).toEqual([]);
  });

  it("BGMの移動を検出する", () => {
    const before = [item()];
    const after = [item({ startTicks: "254016000000", endTicks: "15494976000000" })];
    const diffs = compareSnapshots(before, after);
    expect(diffs.length).toBeGreaterThan(0);
  });

  it("BGMの短縮（end変更）を検出する", () => {
    const before = [item()];
    const after = [item({ endTicks: "7620480000000" })];
    const diffs = compareSnapshots(before, after);
    expect(diffs.some((d) => d.kind === "changed" && d.detail.includes("end"))).toBe(true);
  });

  it("ガイド画像の削除を検出する", () => {
    const guide = item({ mediaType: "video", trackIndex: 2, projectItemId: "guide", name: "guide.png" });
    const diffs = compareSnapshots([item(), guide], [item()]);
    expect(diffs.some((d) => d.kind === "count")).toBe(true);
    expect(diffs.some((d) => d.kind === "missing" && d.detail.includes("guide.png"))).toBe(true);
  });

  it("TrackItem追加を検出する", () => {
    const extra = item({ startTicks: "999", name: "added.mp3" });
    const diffs = compareSnapshots([item()], [item(), extra]);
    expect(diffs.some((d) => d.kind === "added")).toBe(true);
  });

  it("speed/disabled変更を検出する", () => {
    const diffs = compareSnapshots([item()], [item({ speed: 110 })]);
    expect(diffs.some((d) => d.detail.includes("speed"))).toBe(true);
    const diffs2 = compareSnapshots([item()], [item({ disabled: true })]);
    expect(diffs2.some((d) => d.detail.includes("disabled"))).toBe(true);
  });

  it("Tickは文字列完全一致で比較（数値等価でも表記が違えば差分）", () => {
    // 正常系では正規化済みだが、比較が数値化しないことを保証
    const diffs = compareSnapshots([item({ endTicks: "100" })], [item({ endTicks: "0100" })]);
    expect(diffs.length).toBeGreaterThan(0);
  });

  it("excludeTargets: 対象V/Aトラックだけを除外する", () => {
    const all = [
      item({ mediaType: "video", trackIndex: 0, name: "aroll.mp4" }), // 対象V
      item({ mediaType: "audio", trackIndex: 0, name: "aroll-audio" }), // 対象A
      item({ mediaType: "audio", trackIndex: 1, name: "bgm.mp3" }),
      item({ mediaType: "video", trackIndex: 1, name: "guide.png" })
    ];
    const nonTarget = excludeTargets(all, 0, 0);
    expect(nonTarget).toHaveLength(2);
    expect(nonTarget.map((s) => s.name).sort()).toEqual(["bgm.mp3", "guide.png"]);
  });
});
