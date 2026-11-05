import { describe, expect, it } from "vitest";
import {
  isValidAddress,
  validateAddressInput,
  validateAmountInput,
} from "../src/engine/validation";

describe("validateAddressInput（画面側エラー）", () => {
  it("42文字のアドレスは正常", () => {
    const result = validateAddressInput("0x1111111111111111111111111111111111111111");
    expect(result.ok).toBe(true);
  });

  it("形式不正は INVALID_ADDRESS", () => {
    for (const bad of ["0x123", "1111111111111111111111111111111111111111", "0xZZZZ111111111111111111111111111111111111"]) {
      const result = validateAddressInput(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("INVALID_ADDRESS");
    }
    expect(isValidAddress("0x4444444444444444444444444444444444444444")).toBe(true);
    expect(isValidAddress("0x4444")).toBe(false);
  });

  it("空欄は EMPTY_INPUT", () => {
    const result = validateAddressInput("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EMPTY_INPUT");
  });
});

describe("validateAmountInput（画面側エラーと成功の分離）", () => {
  it("表示値をraw値に変換して返す", () => {
    const result = validateAmountInput("50", 6);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(50_000_000n);
  });

  it("0数量は正常（transferの0は成功扱い。ここでもエラーにしない）", () => {
    const result = validateAmountInput("0", 6);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0n);
  });

  it("負数・空欄・非数値・桁数超過は画面側エラー", () => {
    const cases: Array<[string, string]> = [
      ["-5", "NEGATIVE_NOT_ALLOWED"],
      ["", "EMPTY_INPUT"],
      ["abc", "NOT_A_NUMBER"],
      ["0.0000001", "TOO_MANY_DECIMALS"],
    ];
    for (const [input, code] of cases) {
      const result = validateAmountInput(input, 6);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe(code);
    }
  });
});
