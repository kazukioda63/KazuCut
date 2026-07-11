/**
 * Tick文字列演算。
 *
 * PremiereのTickは64bit整数でNumber(2^53)を超え得るため、Numberでの演算を禁止する
 * （仕様13章）。UXP環境でのBigInt安定性が未確認のため、本モジュールはBigIntに
 * 依存しない10進文字列演算で実装する。負数対応。
 */

import { ASSUMED_TICKS_PER_SECOND } from "./constants";

export type TickString = string;

const TICK_RE = /^-?\d+$/;

export function isValidTicks(value: string): boolean {
  return TICK_RE.test(value);
}

function assertTicks(value: string): void {
  if (!isValidTicks(value)) {
    throw new Error(`不正なTick文字列: "${value}"`);
  }
}

function normalize(value: string): string {
  assertTicks(value);
  const neg = value.startsWith("-");
  let digits = neg ? value.slice(1) : value;
  digits = digits.replace(/^0+(?=\d)/, "");
  if (digits === "0") return "0";
  return neg ? `-${digits}` : digits;
}

/** 符号なし10進文字列の加算 */
function addUnsigned(a: string, b: string): string {
  let carry = 0;
  let out = "";
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const da = i < a.length ? a.charCodeAt(a.length - 1 - i) - 48 : 0;
    const db = i < b.length ? b.charCodeAt(b.length - 1 - i) - 48 : 0;
    const sum = da + db + carry;
    out = String(sum % 10) + out;
    carry = sum >= 10 ? 1 : 0;
  }
  if (carry) out = "1" + out;
  return out;
}

/** 符号なし比較: a<b:-1, a==b:0, a>b:1 */
function cmpUnsigned(a: string, b: string): number {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** 符号なし減算 (a >= b 前提) */
function subUnsigned(a: string, b: string): string {
  let borrow = 0;
  let out = "";
  for (let i = 0; i < a.length; i++) {
    const da = a.charCodeAt(a.length - 1 - i) - 48;
    const db = i < b.length ? b.charCodeAt(b.length - 1 - i) - 48 : 0;
    let d = da - db - borrow;
    if (d < 0) {
      d += 10;
      borrow = 1;
    } else {
      borrow = 0;
    }
    out = String(d) + out;
  }
  return out.replace(/^0+(?=\d)/, "");
}

function split(value: string): { neg: boolean; mag: string } {
  const n = normalize(value);
  return n.startsWith("-") ? { neg: true, mag: n.slice(1) } : { neg: false, mag: n };
}

function join(neg: boolean, mag: string): string {
  if (mag === "0") return "0";
  return neg ? `-${mag}` : mag;
}

export function addTicks(a: TickString, b: TickString): TickString {
  const x = split(a);
  const y = split(b);
  if (x.neg === y.neg) return join(x.neg, addUnsigned(x.mag, y.mag));
  const c = cmpUnsigned(x.mag, y.mag);
  if (c === 0) return "0";
  return c > 0 ? join(x.neg, subUnsigned(x.mag, y.mag)) : join(y.neg, subUnsigned(y.mag, x.mag));
}

export function subtractTicks(a: TickString, b: TickString): TickString {
  const y = split(b);
  return addTicks(a, join(!y.neg, y.mag));
}

/** a<b:-1, a==b:0, a>b:1 */
export function compareTicks(a: TickString, b: TickString): number {
  const d = split(subtractTicks(a, b));
  if (d.mag === "0") return 0;
  return d.neg ? -1 : 1;
}

export function minTicks(a: TickString, b: TickString): TickString {
  return compareTicks(a, b) <= 0 ? normalize(a) : normalize(b);
}

export function maxTicks(a: TickString, b: TickString): TickString {
  return compareTicks(a, b) >= 0 ? normalize(a) : normalize(b);
}

/** 小さな非負整数との乗算（ms→ticks換算等に使用） */
export function multiplyTicksBySmallInt(a: TickString, factor: number): TickString {
  if (!Number.isInteger(factor) || factor < 0) {
    throw new Error(`乗数は非負整数のみ: ${factor}`);
  }
  let acc = "0";
  let base = normalize(a);
  let f = factor;
  while (f > 0) {
    if (f & 1) acc = addTicks(acc, base);
    base = addTicks(base, base);
    f >>= 1;
  }
  return acc;
}

/**
 * ミリ秒→Tick文字列（仮定分解能を使用）。
 * 実機Probeで分解能確認前は概算・候補生成にのみ使用し、最終編集位置は
 * TickTime API（alignToFrame等）を通す。
 */
export function msToTicks(ms: number): TickString {
  if (!Number.isFinite(ms)) throw new Error(`不正なms: ${ms}`);
  const neg = ms < 0;
  const absMs = Math.round(Math.abs(ms));
  const perMs = divTicksBySmallInt(ASSUMED_TICKS_PER_SECOND, 1000).quotient;
  const mag = multiplyTicksBySmallInt(perMs, absMs);
  return join(neg && mag !== "0", split(mag).mag);
}

/** 小さな正整数での除算（商と余り） */
export function divTicksBySmallInt(
  a: TickString,
  divisor: number
): { quotient: TickString; remainder: number } {
  if (!Number.isInteger(divisor) || divisor <= 0) {
    throw new Error(`除数は正整数のみ: ${divisor}`);
  }
  const { neg, mag } = split(a);
  let q = "";
  let rem = 0;
  for (let i = 0; i < mag.length; i++) {
    const cur = rem * 10 + (mag.charCodeAt(i) - 48);
    q += String(Math.floor(cur / divisor));
    rem = cur % divisor;
  }
  q = q.replace(/^0+(?=\d)/, "");
  return { quotient: join(neg && q !== "0", q), remainder: neg ? -rem : rem };
}

/**
 * Tick→ミリ秒（表示・概算専用。丸め誤差あり。編集位置決定に使用禁止）
 */
export function ticksToApproxMs(ticks: TickString): number {
  const { neg, mag } = split(ticks);
  // 1ms = 254,016,000 ticks（仮定分解能/1000）
  const perMs = divTicksBySmallInt(ASSUMED_TICKS_PER_SECOND, 1000).quotient;
  // 長除算: mag / perMs
  let result = 0;
  // Number精度で十分な範囲（表示用途: 数十時間まで）をチェックしつつ変換
  const div = Number(perMs);
  const val = Number(mag);
  if (Number.isSafeInteger(val)) {
    result = val / div;
  } else {
    // 2^53超は下位を切り捨てて概算（表示専用）
    const headLen = 15;
    const head = Number(mag.slice(0, headLen));
    const scale = Math.pow(10, mag.length - headLen);
    result = (head * scale) / div;
  }
  return neg ? -result : result;
}
