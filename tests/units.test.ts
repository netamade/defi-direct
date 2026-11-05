import { describe, expect, it } from "vitest";
import {
  MAX_UINT256,
  UnitsError,
  formatEther,
  formatUnits,
  parseEther,
  parseUnits,
  rateToRational,
  swapAmountOutRaw,
} from "../src/engine/units";

describe("parseUnits / formatUnits", () => {
  it("decimals 6桁（USDC想定）の換算ができる", () => {
    expect(parseUnits("10", 6)).toBe(10_000_000n);
    expect(parseUnits("1", 6)).toBe(1_000_000n);
    expect(parseUnits("0.5", 6)).toBe(500_000n);
    expect(parseUnits("1000", 6)).toBe(1_000_000_000n);
    expect(formatUnits(10_000_000n, 6)).toBe("10");
    expect(formatUnits(500_000n, 6)).toBe("0.5");
    expect(formatUnits(1_000_000_000n, 6)).toBe("1000");
    expect(formatUnits(0n, 6)).toBe("0");
  });

  it("decimals 18桁（TKN・ETH想定）の換算ができる", () => {
    expect(parseUnits("1", 18)).toBe(1_000_000_000_000_000_000n);
    expect(parseUnits("10", 18)).toBe(10_000_000_000_000_000_000n);
    expect(formatUnits(1_000_000_000_000_000_000n, 18)).toBe("1");
    expect(formatUnits(10_000_000_000_000_000_000n, 18)).toBe("10");
  });

  it("表示値→raw値→表示値の往復が一致する", () => {
    for (const [display, decimals] of [
      ["0", 6],
      ["0.000001", 6],
      ["123.456", 6],
      ["1000", 6],
      ["0.000000000000000001", 18],
      ["42.25", 18],
    ] as const) {
      expect(formatUnits(parseUnits(display, decimals), decimals)).toBe(display);
    }
  });

  it("小数点以下の桁数がdecimalsを超えたら入力エラー", () => {
    expect(() => parseUnits("0.0000001", 6)).toThrowError(UnitsError);
    try {
      parseUnits("0.0000001", 6);
      expect.unreachable();
    } catch (error) {
      expect((error as UnitsError).code).toBe("TOO_MANY_DECIMALS");
    }
    // 18桁では同じ入力でも正常
    expect(parseUnits("0.0000001", 18)).toBe(100_000_000_000n);
  });

  it("負数・空欄・数値でない入力はエラー", () => {
    expect(() => parseUnits("-1", 6)).toThrowError(UnitsError);
    expect(() => parseUnits("", 6)).toThrowError(UnitsError);
    expect(() => parseUnits("abc", 6)).toThrowError(UnitsError);
    expect(() => parseUnits("1.2.3", 6)).toThrowError(UnitsError);
  });

  it("parseEther / formatEther は decimals 18 と等価", () => {
    expect(parseEther("1")).toBe(10n ** 18n);
    expect(formatEther(10n ** 18n)).toBe("1");
  });

  it("MAX_UINT256 は 2^256 - 1", () => {
    expect(MAX_UINT256).toBe(2n ** 256n - 1n);
  });
});

describe("swapAmountOutRaw（swap換算式）", () => {
  it("10 USDC（decimals 6）→ 10 TKN（decimals 18）、レート1", () => {
    const out = swapAmountOutRaw(10_000_000n, 6, 18, rateToRational(1));
    expect(out).toBe(10_000_000_000_000_000_000n);
  });

  it("レート0.5では半分になる（浮動小数点を使わず整数比で計算）", () => {
    const rate = rateToRational(0.5);
    expect(rate).toEqual({ numerator: 1n, denominator: 2n });
    const out = swapAmountOutRaw(10_000_000n, 6, 18, rate);
    expect(out).toBe(5_000_000_000_000_000_000n);
  });

  it("decimalsOut < decimalsIn の場合は割り算側に指数が付く", () => {
    // 10 TKN（18桁）→ USDC（6桁）、レート1 → 10,000,000 raw
    const out = swapAmountOutRaw(10_000_000_000_000_000_000n, 18, 6, rateToRational(1));
    expect(out).toBe(10_000_000n);
  });
});
