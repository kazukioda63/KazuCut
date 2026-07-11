/**
 * 日本語正規化（仕様25章）。
 * フィラー辞書照合の前処理。表記ゆれ（えー/えぇ/ええー、あのー/あの〜等）を吸収する。
 */

const KATAKANA_START = 0x30a1;
const KATAKANA_END = 0x30f6;
const KANA_OFFSET = 0x60; // カタカナ→ひらがな

/** 小書き文字→通常文字 */
const SMALL_KANA: Record<string, string> = {
  ぁ: "あ", ぃ: "い", ぅ: "う", ぇ: "え", ぉ: "お",
  ゃ: "や", ゅ: "ゆ", ょ: "よ", ゎ: "わ", っ: "つ"
};

/** 母音の連続を1つへ縮約するための母音マップ（直前文字の母音） */
const VOWEL_OF: Record<string, string> = {
  あ: "あ", か: "あ", さ: "あ", た: "あ", な: "あ", は: "あ", ま: "あ", や: "あ", ら: "あ", わ: "あ", が: "あ", ざ: "あ", だ: "あ", ば: "あ", ぱ: "あ",
  い: "い", き: "い", し: "い", ち: "い", に: "い", ひ: "い", み: "い", り: "い", ぎ: "い", じ: "い", ぢ: "い", び: "い", ぴ: "い",
  う: "う", く: "う", す: "う", つ: "う", ぬ: "う", ふ: "う", む: "う", ゆ: "う", る: "う", ぐ: "う", ず: "う", づ: "う", ぶ: "う", ぷ: "う",
  え: "え", け: "え", せ: "え", て: "え", ね: "え", へ: "え", め: "え", れ: "え", げ: "え", ぜ: "え", で: "え", べ: "え", ぺ: "え",
  お: "お", こ: "お", そ: "お", と: "お", の: "お", ほ: "お", も: "お", よ: "お", ろ: "お", を: "お", ご: "お", ぞ: "お", ど: "お", ぼ: "お", ぽ: "お",
  ん: "ん"
};

function katakanaToHiragana(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= KATAKANA_START && code <= KATAKANA_END) {
      out += String.fromCodePoint(code - KANA_OFFSET);
    } else if (ch === "ー") {
      out += "ー"; // 長音は後段で処理
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * フィラー照合用の正規化:
 * NFKC → 記号・空白除去 → カタカナ→ひらがな → 小書き→通常 →
 * 長音・波ダッシュを直前の母音の繰り返しとみなして除去 → 重複母音縮約
 */
export function normalizeForFillerMatch(input: string): string {
  // NFKC（全角半角統一を含む）
  let t = input.normalize("NFKC");
  // 波ダッシュ類を長音へ統一
  t = t.replace(/[〜~～]/g, "ー");
  // 句読点・空白・記号除去
  t = t.replace(/[、。，．,.!?！？・:：;；'"（）()［］\[\]｛｝{}\s]/g, "");
  // カタカナ→ひらがな
  t = katakanaToHiragana(t);
  // 小書き→通常
  t = t.replace(/[ぁぃぅぇぉゃゅょゎっ]/g, (c) => SMALL_KANA[c] ?? c);
  // 長音を直前文字の母音に展開してから縮約する
  let expanded = "";
  for (const ch of t) {
    if (ch === "ー") {
      const prev = expanded.at(-1);
      const vowel = prev ? VOWEL_OF[prev] : undefined;
      expanded += vowel ?? "";
    } else {
      expanded += ch;
    }
  }
  // 重複母音縮約: 同一文字の連続（「ええと」→「えと」）に加え、
  // 直前文字の母音と一致する母音も吸収（「あのお」→「あの」）。
  // 辞書側も同じ正規化を通して照合する。
  let out = "";
  for (const ch of expanded) {
    const prev = out.at(-1);
    if (prev === ch) continue;
    if (prev && "あいうえお".includes(ch) && VOWEL_OF[prev] === ch) continue;
    out += ch;
  }
  return out;
}
