import { describe, expect, it } from "vitest";
import { findFillers } from "../../plugin/src/transcript/fillerMatcher";
import {
  CONTEXT_DEPENDENT_FILLER_WORDS,
  SAFE_FILLER_WORDS
} from "../../plugin/src/state/presets";
import type { TranscriptWord } from "../../plugin/src/types";

const dict = {
  safeWords: SAFE_FILLER_WORDS,
  contextDependentWords: CONTEXT_DEPENDENT_FILLER_WORDS
};

function w(text: string, startMs: number, endMs: number, confidence = 0.9): TranscriptWord {
  return { text, startMs, endMs, confidence };
}

describe("フィラー検出（仕様25章）", () => {
  it("安全語は自動選択される", () => {
    const words = [w("えっと", 100, 480), w("今日は", 600, 1100)];
    const matches = findFillers(words, dict);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.dictWord).toBe("えっと");
    expect(matches[0]!.safe).toBe(true);
    expect(matches[0]!.autoSelect).toBe(true);
    expect(matches[0]!.startMs).toBe(100);
    expect(matches[0]!.endMs).toBe(480);
  });

  it("文脈依存語は検出するが自動選択しない", () => {
    const words = [w("まあ", 0, 300), w("良い", 350, 700)];
    const matches = findFillers(words, dict);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.safe).toBe(false);
    expect(matches[0]!.autoSelect).toBe(false);
    expect(matches[0]!.warnings.some((x) => x.includes("文脈依存"))).toBe(true);
  });

  it("「あの本」（内容語と一体のToken）は検出しない", () => {
    const matches = findFillers([w("あの本", 0, 500)], dict);
    expect(matches).toHaveLength(0);
  });

  it("「その方法」「何回」を検出しない", () => {
    expect(findFillers([w("その方法", 0, 600)], dict)).toHaveLength(0);
    expect(findFillers([w("何回", 0, 400)], dict)).toHaveLength(0);
  });

  it("分割Token（「ええ」+「と」）を結合して照合する", () => {
    const words = [w("ええ", 100, 250), w("と", 260, 350)];
    const matches = findFillers(words, dict);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.detectedText).toBe("ええと");
    expect(matches[0]!.startMs).toBe(100);
    expect(matches[0]!.endMs).toBe(350);
  });

  it("200ms超離れたTokenは結合しない", () => {
    const words = [w("ええ", 100, 250), w("と", 600, 700)];
    const matches = findFillers(words, dict);
    // 「ええ」単独は辞書の「えー」と正規化一致するため検出はされ得るが結合はされない
    expect(matches.every((m) => m.endMs <= 250 || m.startMs >= 600)).toBe(true);
  });

  it("低信頼度（<0.6）は自動選択しない", () => {
    const matches = findFillers([w("えっと", 0, 400, 0.3)], dict);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.autoSelect).toBe(false);
    expect(matches[0]!.warnings.some((x) => x.includes("信頼度"))).toBe(true);
  });

  it("表記ゆれ（エット、えぇと）も照合する", () => {
    expect(findFillers([w("エット", 0, 400)], dict)).toHaveLength(1);
    expect(findFillers([w("えぇと", 0, 400)], dict)).toHaveLength(1);
  });

  it("通常の発話は検出しない", () => {
    const words = [w("今日は", 0, 500), w("プログラミングの", 550, 1500), w("話です", 1550, 2100)];
    expect(findFillers(words, dict)).toHaveLength(0);
  });
});
