import { describe, expect, it } from "vitest";
import { normalizeForFillerMatch } from "../../plugin/src/transcript/japaneseNormalizer";

describe("日本語正規化（仕様25章）", () => {
  it("えー / えぇ / ええー を同一視する", () => {
    const a = normalizeForFillerMatch("えー");
    expect(normalizeForFillerMatch("えぇ")).toBe(a);
    expect(normalizeForFillerMatch("ええー")).toBe(a);
    expect(normalizeForFillerMatch("エー")).toBe(a);
  });

  it("あのー / あの〜 / あの～ を同一視する", () => {
    const a = normalizeForFillerMatch("あのー");
    expect(normalizeForFillerMatch("あの〜")).toBe(a);
    expect(normalizeForFillerMatch("あの～")).toBe(a);
  });

  it("カタカナ→ひらがな", () => {
    expect(normalizeForFillerMatch("エット")).toBe(normalizeForFillerMatch("えっと"));
  });

  it("句読点・空白を除去する", () => {
    expect(normalizeForFillerMatch("えー、")).toBe(normalizeForFillerMatch("えー"));
    expect(normalizeForFillerMatch(" うーん。 ")).toBe(normalizeForFillerMatch("うーん"));
  });

  it("全角半角統一（NFKC）", () => {
    expect(normalizeForFillerMatch("ｴｰ")).toBe(normalizeForFillerMatch("えー"));
  });

  it("小書き文字を通常文字へ", () => {
    expect(normalizeForFillerMatch("えっと")).toBe(normalizeForFillerMatch("えつと"));
  });

  it("「あの」と「あのー」は同一視される（文脈依存扱いは辞書側で管理）", () => {
    expect(normalizeForFillerMatch("あのー")).toBe(normalizeForFillerMatch("あの"));
  });

  it("「あの本」は「あの」と一致しない（完全一致のみ）", () => {
    expect(normalizeForFillerMatch("あの本")).not.toBe(normalizeForFillerMatch("あの"));
  });
});
