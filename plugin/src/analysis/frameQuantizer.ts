/**
 * フレーム境界への量子化（1コマ未満の隙間対策）。
 *
 * 無音検出の境界はミリ秒→Tick変換のためフレーム境界に揃わない。
 * Premiereはフレーム未満の位置の編集点も受け付けてしまい、境界がコマの
 * 途中に落ちるとタイムライン上で1コマ分の空白（黒フレーム）に見える。
 * 本モジュールは削除区間を安全側（カットを縮める方向）にフレーム境界へ
 * 丸めることで、全ての編集点をコマの切れ目に揃える。
 *
 * 1フレームのTick長はNumberの安全整数範囲（最長でも約2.6e10 < 2^53）なので、
 * 剰余計算のみNumber除数のdivTicksBySmallIntを使う（Tick値自体は文字列のまま）。
 */
import {
  addTicks,
  compareTicks,
  divTicksBySmallInt,
  subtractTicks,
  type TickString
} from "../ticks";

/** 標準フレームレートの1フレームTick長（254,016,000,000 ticks/秒で厳密値） */
const STANDARD_FRAME_TICKS: number[] = [
  10594584000, // 23.976 (24000/1001)
  10584000000, // 24
  10160640000, // 25
  8475667200, // 29.97 (30000/1001)
  8467200000, // 30
  5292000000, // 48
  5080320000, // 50
  4237833600, // 59.94 (60000/1001)
  4233600000, // 60
  2118916800, // 119.88
  2116800000 // 120
];

const TICKS_PER_SECOND = 254016000000;
/** 妥当な1フレームTick長の範囲（約240fps〜約6fps） */
const MIN_FRAME_TICKS = 1000000000;
const MAX_FRAME_TICKS = 43000000000;

function snapToStandard(ticks: number): number {
  // 許容0.03%: 30fpsと29.97fpsの差は0.1%なので取り違えない。
  // fps数値29.97等の浮動小数点誤差（1e-6程度）は吸収する
  for (const std of STANDARD_FRAME_TICKS) {
    if (Math.abs(ticks - std) / std < 0.0003) return std;
  }
  return Math.round(ticks);
}

/**
 * 実機APIから得た値を1フレームのTick長へ解釈する。
 * 受理する形:
 * - 整数文字列（Sequence.getTimebase()の返値想定。1フレームのTick数）
 * - number: 1e6超→ticksPerFrame / 0〜240→fps / 0〜1→秒毎フレーム
 * - object: { ticksPerFrame } / { value(fps) } / { ticks } / { seconds }
 * 解釈できない・範囲外はnull（呼び出し側は丸めなしで続行する）。
 */
export function parseFrameTicks(raw: unknown): TickString | null {
  const fromNumber = (v: number): number | null => {
    if (!Number.isFinite(v) || v <= 0) return null;
    if (v > 1e6) return snapToStandard(v); // ticksPerFrame
    if (v >= 1 && v <= 240) return snapToStandard(TICKS_PER_SECOND / v); // fps
    if (v < 1) return snapToStandard(v * TICKS_PER_SECOND); // 秒/フレーム
    return null;
  };
  let ticks: number | null = null;
  if (typeof raw === "string") {
    if (!/^\d+$/.test(raw.trim())) return null;
    ticks = snapToStandard(Number(raw.trim()));
  } else if (typeof raw === "number") {
    ticks = fromNumber(raw);
  } else if (raw !== null && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const key of ["ticksPerFrame", "value", "seconds"]) {
      const v = o[key];
      if (typeof v === "number") {
        ticks = fromNumber(v);
        if (ticks !== null) break;
      }
    }
    if (ticks === null && typeof o["ticks"] === "string") {
      return parseFrameTicks(o["ticks"]);
    }
  }
  if (ticks === null) return null;
  if (!Number.isInteger(ticks) || ticks < MIN_FRAME_TICKS || ticks > MAX_FRAME_TICKS) return null;
  return String(ticks);
}

function frameTicksAsNumber(frameTicks: TickString): number {
  const n = Number(frameTicks);
  if (!Number.isSafeInteger(n) || n < MIN_FRAME_TICKS || n > MAX_FRAME_TICKS) {
    throw new Error(`不正なフレームTick長: ${frameTicks}`);
  }
  return n;
}

/** 非負オフセットをフレーム境界へ切り下げる */
export function floorToFrame(offsetTicks: TickString, frameTicks: TickString): TickString {
  if (compareTicks(offsetTicks, "0") < 0) throw new Error(`負のオフセット: ${offsetTicks}`);
  const { remainder } = divTicksBySmallInt(offsetTicks, frameTicksAsNumber(frameTicks));
  return subtractTicks(offsetTicks, String(remainder));
}

/** 非負オフセットをフレーム境界へ切り上げる */
export function ceilToFrame(offsetTicks: TickString, frameTicks: TickString): TickString {
  const floored = floorToFrame(offsetTicks, frameTicks);
  if (compareTicks(floored, offsetTicks) === 0) return floored;
  return addTicks(floored, frameTicks);
}

/**
 * 削除区間 [startOffset, endOffset)（クリップIn基準の相対Tick）を
 * 安全側（カットを縮める方向: 開始は切り上げ・終了は切り下げ）で
 * フレーム境界へ丸める。丸め後に空になった場合はnull（=このカットは行わない）。
 */
export function quantizeCutOffsets(
  startOffsetTicks: TickString,
  endOffsetTicks: TickString,
  frameTicks: TickString
): { startOffsetTicks: TickString; endOffsetTicks: TickString } | null {
  const s = ceilToFrame(startOffsetTicks, frameTicks);
  const e = floorToFrame(endOffsetTicks, frameTicks);
  if (compareTicks(s, e) >= 0) return null;
  return { startOffsetTicks: s, endOffsetTicks: e };
}
