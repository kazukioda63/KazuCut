import { describe, expect, it } from "vitest";
import { buildCacheKey, settingsHash, type CacheKeyInput } from "../../plugin/src/cache/cacheKey";
import { createShortsFastPreset } from "../../plugin/src/state/presets";

function input(overrides: Partial<CacheKeyInput> = {}): CacheKeyInput {
  return {
    mediaPath: "C:\\Videos\\日本語 フォルダ\\sample.mp4",
    fileSize: 12345678,
    lastModified: 1720000000000,
    sourceInTicks: "0",
    sourceOutTicks: "2540160000000",
    audioStreamIndex: 0,
    settings: createShortsFastPreset().settings,
    ...overrides
  };
}

describe("キャッシュキー（仕様30章）", () => {
  it("同一入力は同一キー", () => {
    expect(buildCacheKey(input())).toBe(buildCacheKey(input()));
  });

  it("mediaPath / fileSize / lastModified / in / out / stream の変化でキーが変わる", () => {
    const base = buildCacheKey(input());
    expect(buildCacheKey(input({ mediaPath: "D:\\other.mp4" }))).not.toBe(base);
    expect(buildCacheKey(input({ fileSize: 999 }))).not.toBe(base);
    expect(buildCacheKey(input({ lastModified: 1 }))).not.toBe(base);
    expect(buildCacheKey(input({ sourceInTicks: "100" }))).not.toBe(base);
    expect(buildCacheKey(input({ sourceOutTicks: "100" }))).not.toBe(base);
    expect(buildCacheKey(input({ audioStreamIndex: 1 }))).not.toBe(base);
  });

  it("解析設定の変化でキーが変わる", () => {
    const s = createShortsFastPreset().settings;
    s.silence.minSilenceMs = 500;
    expect(buildCacheKey(input({ settings: s }))).not.toBe(buildCacheKey(input()));
  });

  it("フィラーOFF時: フィラー設定・モデルはキーへ寄与しない（ADR-006）", () => {
    const a = createShortsFastPreset().settings;
    const b = createShortsFastPreset().settings;
    b.filler.gapAfterMs = 200;
    b.filler.safeWords = ["違う辞書"];
    // OFF同士なら辞書やgapが違ってもキーは同じ
    expect(buildCacheKey(input({ settings: a }))).toBe(buildCacheKey(input({ settings: b })));
    // modelHashもOFF時は無視される
    expect(buildCacheKey(input({ modelHash: "xyz" }))).toBe(buildCacheKey(input()));
  });

  it("フィラーON時: 辞書・モデルがキーへ寄与する", () => {
    const a = createShortsFastPreset().settings;
    a.filler.enabled = true;
    const b = createShortsFastPreset().settings;
    b.filler.enabled = true;
    b.filler.gapAfterMs = 200;
    expect(settingsHash(a)).not.toBe(settingsHash(b));
    expect(
      buildCacheKey(input({ settings: a, modelHash: "m1" }))
    ).not.toBe(buildCacheKey(input({ settings: a, modelHash: "m2" })));
  });
});
