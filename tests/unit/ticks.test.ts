import { describe, expect, it } from "vitest";
import {
  addTicks,
  compareTicks,
  divTicksBySmallInt,
  isValidTicks,
  msToTicks,
  multiplyTicksBySmallInt,
  subtractTicks,
  ticksToApproxMs
} from "../../plugin/src/ticks";

describe("ticks: 10進文字列演算（Number/BigInt非依存）", () => {
  it("2^53を超える値を正確に加算できる", () => {
    // 9007199254740993 は Number では表現不能
    expect(addTicks("9007199254740992", "1")).toBe("9007199254740993");
  });

  it("減算・負数", () => {
    expect(subtractTicks("100", "250")).toBe("-150");
    expect(addTicks("-150", "150")).toBe("0");
    expect(subtractTicks("-100", "-250")).toBe("150");
  });

  it("比較", () => {
    expect(compareTicks("100", "100")).toBe(0);
    expect(compareTicks("99", "100")).toBe(-1);
    expect(compareTicks("-1", "0")).toBe(-1);
    expect(compareTicks("10000000000000000000", "9999999999999999999")).toBe(1);
  });

  it("先頭ゼロを正規化する", () => {
    expect(addTicks("007", "0003")).toBe("10");
  });

  it("不正文字列を拒否する", () => {
    expect(isValidTicks("12.5")).toBe(false);
    expect(isValidTicks("abc")).toBe(false);
    expect(isValidTicks("")).toBe(false);
    expect(() => addTicks("1e5", "1")).toThrow();
  });

  it("小整数乗算・除算", () => {
    expect(multiplyTicksBySmallInt("254016000000", 2)).toBe("508032000000");
    const d = divTicksBySmallInt("254016000000", 1000);
    expect(d.quotient).toBe("254016000");
    expect(d.remainder).toBe(0);
  });

  it("ms→ticks→msの往復（仮定分解能254016000000/秒）", () => {
    expect(msToTicks(1000)).toBe("254016000000");
    expect(msToTicks(500)).toBe("127008000000");
    expect(Math.round(ticksToApproxMs("127008000000"))).toBe(500);
  });

  it("60分素材相当の大きなtickでも精度を保つ", () => {
    const oneHour = msToTicks(3600_000);
    expect(oneHour).toBe("914457600000000");
    expect(addTicks(oneHour, "1")).toBe("914457600000001");
  });
});
