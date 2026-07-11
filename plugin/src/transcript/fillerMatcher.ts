import { normalizeForFillerMatch } from "./japaneseNormalizer";
import type { TranscriptWord } from "../types";

export interface FillerMatch {
  /** 照合した辞書語（元表記） */
  dictWord: string;
  /** 検出テキスト（元Token表記） */
  detectedText: string;
  startMs: number;
  endMs: number;
  /** 安全語=true / 文脈依存語=false */
  safe: boolean;
  /** 自動選択してよいか（安全語かつ内容語と密着していない） */
  autoSelect: boolean;
  confidence: number;
  warnings: string[];
}

export interface FillerDictionary {
  safeWords: string[];
  contextDependentWords: string[];
}

/** 単語結合の最大Token数（「ええ」+「と」のような分割Token対応） */
const MAX_JOIN = 3;

/**
 * Transcript単語列からフィラーを検出する。
 * - 安全語: 単独Token（または結合Token）が辞書と正規化一致した場合のみ検出
 * - 文脈依存語: 検出はするが autoSelect=false（仕様25章）
 * - 「あの本」等、辞書語の直後に内容語が同一Token内で続く場合は検出しない
 *   （正規化一致は完全一致のみ、前方一致は不採用）
 */
export function findFillers(
  words: TranscriptWord[],
  dict: FillerDictionary
): FillerMatch[] {
  const safeNorm = new Map<string, string>();
  for (const w of dict.safeWords) safeNorm.set(normalizeForFillerMatch(w), w);
  const ctxNorm = new Map<string, string>();
  for (const w of dict.contextDependentWords) ctxNorm.set(normalizeForFillerMatch(w), w);

  const matches: FillerMatch[] = [];
  let i = 0;
  while (i < words.length) {
    let matched: { match: FillerMatch; consumed: number } | null = null;
    // 長い結合を優先して照合
    for (let join = Math.min(MAX_JOIN, words.length - i); join >= 1; join--) {
      const slice = words.slice(i, i + join);
      const first = slice[0];
      const last = slice.at(-1);
      if (!first || !last) continue;
      // Token間が大きく空いている場合は同一語とみなさない（200ms超）
      let contiguous = true;
      for (let k = 1; k < slice.length; k++) {
        const prev = slice[k - 1];
        const cur = slice[k];
        if (!prev || !cur || cur.startMs - prev.endMs > 200) {
          contiguous = false;
          break;
        }
      }
      if (!contiguous) continue;
      const rawText = slice.map((w) => w.text).join("");
      const norm = normalizeForFillerMatch(rawText);
      if (norm.length === 0) continue;

      const safeHit = safeNorm.get(norm);
      const ctxHit = ctxNorm.get(norm);
      const dictWord = safeHit ?? ctxHit;
      if (!dictWord) continue;

      const confidences = slice
        .map((w) => w.confidence)
        .filter((c): c is number => typeof c === "number");
      const confidence =
        confidences.length > 0
          ? confidences.reduce((a, b) => a + b, 0) / confidences.length
          : 0.5;

      const warnings: string[] = [];
      const safe = safeHit !== undefined;
      let autoSelect = safe;
      if (!safe) {
        warnings.push("文脈依存語のため自動選択されません。内容を確認してください。");
      }
      if (confidence < 0.6) {
        autoSelect = false;
        warnings.push("認識信頼度が低いため自動選択されません。");
      }
      matched = {
        match: {
          dictWord,
          detectedText: rawText,
          startMs: first.startMs,
          endMs: last.endMs,
          safe,
          autoSelect,
          confidence,
          warnings
        },
        consumed: join
      };
      break;
    }
    if (matched) {
      matches.push(matched.match);
      i += matched.consumed;
    } else {
      i += 1;
    }
  }
  return matches;
}
