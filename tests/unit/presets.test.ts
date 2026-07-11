import { describe, expect, it } from "vitest";
import {
  builtInPresets,
  createConservativePreset,
  createNaturalPreset,
  createShortsFastPreset,
  validateSettings
} from "../../plugin/src/state/presets";

describe("標準プリセット（仕様24章）", () => {
  it("全標準プリセットでフィラー削除がOFF（ADR-006）", () => {
    for (const p of builtInPresets()) {
      expect(p.settings.filler.enabled).toBe(false);
    }
  });

  it("自然プリセットの仕様値", () => {
    const s = createNaturalPreset().settings.silence;
    expect(s.enabled).toBe(true);
    expect(s.autoThreshold).toBe(true);
    expect(s.noiseMarginDb).toBe(6);
    expect(s.hysteresisDb).toBe(3);
    expect(s.minSilenceMs).toBe(450);
    expect(s.retainMs).toBe(160);
    expect(s.prePaddingMs).toBe(55);
    expect(s.postPaddingMs).toBe(90);
    expect(s.mergeGapMs).toBe(70);
    expect(s.minSpeechMs).toBe(120);
    expect(s.vadEnabled).toBe(true);
    expect(s.vadSensitivity).toBe(2);
    expect(s.quietVoiceProtection).toBe(true);
  });

  it("ショート高速プリセットの仕様値", () => {
    const s = createShortsFastPreset().settings.silence;
    expect(s.noiseMarginDb).toBe(7);
    expect(s.minSilenceMs).toBe(280);
    expect(s.retainMs).toBe(90);
    expect(s.prePaddingMs).toBe(35);
    expect(s.postPaddingMs).toBe(60);
    expect(s.mergeGapMs).toBe(55);
    expect(s.minSpeechMs).toBe(100);
    expect(s.vadSensitivity).toBe(2);
  });

  it("保守的プリセットの仕様値", () => {
    const s = createConservativePreset().settings.silence;
    expect(s.noiseMarginDb).toBe(5);
    expect(s.hysteresisDb).toBe(4);
    expect(s.minSilenceMs).toBe(650);
    expect(s.retainMs).toBe(220);
    expect(s.vadSensitivity).toBe(1);
  });

  it("フィラー削除後の間の初期値は80ms", () => {
    expect(createNaturalPreset().settings.filler.gapAfterMs).toBe(80);
  });

  it("有効な設定は検証を通過する", () => {
    for (const p of builtInPresets()) {
      expect(validateSettings(p.settings)).toEqual([]);
    }
  });

  it("不正な設定は日本語エラーを返す", () => {
    const s = createNaturalPreset().settings;
    s.silence.retainMs = 99999;
    s.silence.minSilenceMs = 30;
    const errors = validateSettings(s);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("残す無音"))).toBe(true);
  });
});
