/**
 * Premiere Transcript JSONの防御的パーサ（ADR-004）。
 *
 * Schemaを推測で固定しない: 複数の既知候補形状を順に試し、
 * 単語時刻の有無を厳密に判定する。未知形状は TRANSCRIPT_SCHEMA_UNSUPPORTED。
 * 実機で取得したJSONは docs/transcript-format-notes.md へ記録して形状を確定する。
 */

import type { TranscriptResult, TranscriptWord } from "../types";
import { createError } from "../errors";
import type { KazuCutError } from "../types";

type ParseOutcome =
  | { ok: true; result: TranscriptResult }
  | { ok: false; error: KazuCutError };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

/**
 * 時刻フィールド候補を秒/ミリ秒両対応で読む。
 * unitHint: フィールド名から単位を推定（"...Ms"/"...Milliseconds"はms、それ以外は秒とみなす）
 */
function readTimeMs(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const raw = asNumber(obj[key]);
    if (raw === undefined) continue;
    const lower = key.toLowerCase();
    if (lower.includes("ms") || lower.includes("milli") || lower.includes("tick")) {
      if (lower.includes("tick")) continue; // tickはここでは扱わない
      return raw;
    }
    return raw * 1000; // 秒とみなす
  }
  return undefined;
}

const START_KEYS = ["start", "startTime", "start_time", "startMs", "inPoint", "begin"];
const END_KEYS = ["end", "endTime", "end_time", "endMs", "outPoint", "finish"];
const TEXT_KEYS = ["text", "word", "content", "value"];

function tryParseWord(v: unknown): TranscriptWord | null {
  if (!isRecord(v)) return null;
  let text: string | undefined;
  for (const k of TEXT_KEYS) {
    if (typeof v[k] === "string") {
      text = v[k];
      break;
    }
  }
  const startMs = readTimeMs(v, START_KEYS);
  const endMs = readTimeMs(v, END_KEYS);
  if (text === undefined || startMs === undefined || endMs === undefined) return null;
  if (endMs < startMs) return null;
  const conf = asNumber(v["confidence"] ?? v["score"]);
  const word: TranscriptWord = { text, startMs, endMs };
  if (conf !== undefined) word.confidence = conf;
  return word;
}

/** 配列候補を探す: words / tokens / items / 直接配列 */
function findWordArrays(root: unknown): unknown[][] {
  const found: unknown[][] = [];
  const visit = (v: unknown, depth: number): void => {
    if (depth > 4) return;
    if (Array.isArray(v)) {
      found.push(v);
      return;
    }
    if (isRecord(v)) {
      for (const key of ["words", "tokens", "items", "results", "segments", "transcript"]) {
        if (key in v) visit(v[key], depth + 1);
      }
    }
  };
  visit(root, 0);
  return found;
}

export function parseTranscriptJson(jsonText: string): ParseOutcome {
  let root: unknown;
  try {
    root = JSON.parse(jsonText);
  } catch (e) {
    return {
      ok: false,
      error: createError(
        "TRANSCRIPT_SCHEMA_UNSUPPORTED",
        `Transcript JSONのパースに失敗: ${e instanceof Error ? e.message : String(e)}`
      )
    };
  }

  // 単語レベルの時刻を持つ配列を探す
  const arrays = findWordArrays(root);
  let bestWords: TranscriptWord[] | null = null;
  for (const arr of arrays) {
    const words: TranscriptWord[] = [];
    let allValid = arr.length > 0;
    for (const item of arr) {
      const w = tryParseWord(item);
      if (w === null) {
        allValid = false;
        break;
      }
      words.push(w);
    }
    if (allValid && (bestWords === null || words.length > bestWords.length)) {
      bestWords = words;
    }
  }

  if (bestWords && bestWords.length > 0) {
    // 単語ごとの平均長で「単語時刻」か「Segment時刻」かをヒューリスティック判定:
    // テキストが長い（>25文字）要素が過半なら段落単位とみなす
    const longCount = bestWords.filter((w) => w.text.length > 25).length;
    const isSegmentLevel = longCount > bestWords.length / 2;
    if (!isSegmentLevel) {
      return {
        ok: true,
        result: {
          providerId: "premiere",
          words: bestWords,
          hasWordTimings: true
        }
      };
    }
    // Segment時刻のみ: 自動適用禁止（仕様25章）。参考情報として返す
    return {
      ok: true,
      result: {
        providerId: "premiere",
        words: null,
        hasWordTimings: false,
        segments: bestWords.map((w) => ({ text: w.text, startMs: w.startMs, endMs: w.endMs }))
      }
    };
  }

  return {
    ok: false,
    error: createError(
      "TRANSCRIPT_SCHEMA_UNSUPPORTED",
      "既知のTranscript JSON形状に一致しませんでした。docs/transcript-format-notes.md へ実サンプルを記録してください。"
    )
  };
}
