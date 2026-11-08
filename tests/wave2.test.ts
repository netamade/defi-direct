import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLoadedData } from "../src/data/loader";
import { allowanceKey, serializeState } from "../src/engine/state";
import { MAX_UINT256 } from "../src/engine/units";
import { PlaySession } from "../src/ui/session";
import { ProgressStore, type StorageLike } from "../src/store/progressStore";
import { SimulationStore } from "../src/store/simulationStore";
const json = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const data = buildLoadedData({
  challengeFiles: Object.fromEntries(readdirSync(new URL("../data/challenges", import.meta.url)).filter(f => f !== "index.json").map(f => [f, json(`../data/challenges/${f}`)])),
  indexRaw: json("../data/challenges/index.json"), badgesRaw: json("../data/badges.json"),
});
const U = "0x" + "1".repeat(40), C = "0x" + "2".repeat(40), F = "0x" + "3".repeat(40);
function session(id: string) {
  const map = new Map<string, string>();
  const storage: StorageLike = { getItem: k => map.get(k) ?? null, setItem: (k,v) => { map.set(k,v); }, removeItem: k => { map.delete(k); } };
  return new PlaySession(data, data.byId.get(id)!, new ProgressStore(storage, () => data.totalXp), new SimulationStore(storage));
}
function solve11(s: PlaySession) {
  s.doRead("allowance", C, { owner: F, spender: U });
  s.executeWrite("transferFrom", C, { from: F, to: U, amountRaw: "101000000" });
  s.executeWrite("transferFrom", C, { from: F, to: U, amountRaw: "80000000" });
  s.executeWrite("transferFrom", C, { from: F, to: U, amountRaw: "20000000" });
  s.doRead("allowance", C, { owner: F, spender: U });
}
describe("E2 transferFrom", () => {
  it("他人の承認と残高を消費してクリア、XPは一度のみ加算", () => {
    const s = session("11");
    solve11(s);
    expect(s.evaluation.passed).toBe(true);
    expect(s.progress.totalXp).toBe(200);
    expect(s.engine.getBalance(C,F)).toBe(40000000n);
    expect(s.engine.getBalance(C,U)).toBe(20000000n);
    expect(s.engine.getAllowance(C,F,U)).toBe(80000000n);
    s.reset(); solve11(s);
    expect(s.progress.totalXp).toBe(200);
  });
  it.each([["101000000", "INSUFFICIENT_ALLOWANCE"], ["80000000", "INSUFFICIENT_BALANCE"]])("%s は %s、トークン状態は巻き戻すがガス・nonceは進む", (amountRaw, code) => {
    const s = session("11"), before = serializeState(s.state);
    const r = s.executeWrite("transferFrom",C,{ from: F, to: U, amountRaw }).result;
    expect(r.kind).toBe("revert");
    if (r.kind === "preflight-failure") throw new Error("preflight");
    expect(r.record.revertReason).toBe(code);
    expect(r.record.stateDiff).toEqual([]);
    expect(serializeState(s.state).tokens).toEqual(before.tokens);
    expect(serializeState(s.state).allowances).toEqual(before.allowances);
    expect(s.state.accounts[U]!.nonce).toBe(1);
    expect(s.state.accounts[U]!.ethBalanceWei).toBe(BigInt(before.accounts[U]!.ethBalanceWei)-BigInt(r.record.gasFeeWei));
    expect(s.evaluation.passed).toBe(false);
  });
  it("無制限承認は減らず、同一宛先と0数量でも残高を増やさない", () => {
    const s = session("11");
    s.state.allowances[allowanceKey(F,U,C)] = MAX_UINT256;
    s.executeWrite("transferFrom",C,{from:F,to:F,amountRaw:"1000000"});
    expect(s.engine.getBalance(C,F)).toBe(60000000n);
    expect(s.engine.getAllowance(C,F,U)).toBe(MAX_UINT256);
    expect(s.executeWrite("transferFrom",C,{from:F,to:U,amountRaw:"0"}).result.kind).toBe("success");
    s.executeWrite("transferFrom",C,{from:F,to:U,amountRaw:"1000000"});
    expect(s.engine.getAllowance(C,F,U)).toBe(MAX_UINT256);
  });
  it("previewは送信者・宛先・承認の変化を示し状態を変えない", () => {
    const s = session("11"), before=serializeState(s.state);
    const p=s.previewWrite("transferFrom",C,{from:F,to:U,amountRaw:"20000000"});
    expect(p.diffs).toHaveLength(3);
    expect(p.diffs[2]!.after).toContain("80 USDC");
    expect(serializeState(s.state)).toEqual(before);
  });
});
const W = "0x" + "a".repeat(40);
function solve10(s: PlaySession) {
  s.doRead("balanceOf",W,{account:U});
  s.executeWrite("deposit",W,{valueRaw:"100000000000000000"});
  s.doRead("balanceOf",W,{account:U});
  s.executeWrite("withdraw",W,{amountRaw:"40000000000000000"});
  return s.doRead("balanceOf",W,{account:U});
}
describe("E1 WETH", () => {
  it("deposit→withdrawの学習フローで200 XP、ETHにはガス代も反映", () => {
    const s=session("10");
    expect(solve10(s).clear?.awardedXp).toBe(200);
    expect(s.evaluation.passed).toBe(true);
    expect(s.engine.getBalance(W,U)).toBe(60000000000000000n);
    expect(s.state.tokens[W]!.totalSupplyRaw).toBe(60000000000000000n);
    const fees=s.state.txLog.reduce((n,t)=>n+BigInt(t.gasFeeWei),0n);
    expect(s.state.accounts[U]!.ethBalanceWei).toBe(1000000000000000000n-60000000000000000n-fees);
    s.reset(); solve10(s); expect(s.progress.totalXp).toBe(200);
  });
  it("withdraw不足はrevert、WETHと供給量は不変、ETHはガスのみ控除", () => {
    const s=session("10"), before=serializeState(s.state);
    const r=s.executeWrite("withdraw",W,{amountRaw:"1"}).result;
    expect(r.kind).toBe("revert");
    if(r.kind==="preflight-failure") throw new Error("preflight");
    expect(r.record.revertReason).toBe("INSUFFICIENT_BALANCE");
    expect(serializeState(s.state).tokens).toEqual(before.tokens);
    expect(s.state.accounts[U]!.ethBalanceWei).toBe(BigInt(before.accounts[U]!.ethBalanceWei)-BigInt(r.record.gasFeeWei));
  });
  it("depositのvalue＋ガスが不足すると未包含、ちょうど足りれば送信可能", () => {
    const s=session("10"), before=serializeState(s.state);
    expect(s.executeWrite("deposit",W,{valueRaw:"1000000000000000000"}).result.kind).toBe("preflight-failure");
    expect(serializeState(s.state)).toEqual(before);
    const fee=28000n*20n*1000000000n;
    expect(s.executeWrite("deposit",W,{valueRaw:(1000000000000000000n-fee).toString()}).result.kind).toBe("success");
    expect(s.state.accounts[U]!.ethBalanceWei).toBe(0n);
  });
  it("previewは実行結果と一致し、実状態は変更しない", () => {
    const s=session("10");
    for(const [name,args] of [["deposit",{valueRaw:"100000000000000000"}],["withdraw",{amountRaw:"40000000000000000"}]] as const) {
      const before=serializeState(s.state), preview=s.previewWrite(name,W,args);
      expect(serializeState(s.state)).toEqual(before);
      s.executeWrite(name,W,args);
      expect(preview.diffs[0]!.after).toContain(s.engine.getBalance(W,U).toString());
      expect(preview.diffs[1]!.after).toBe(`${Number(s.state.accounts[U]!.ethBalanceWei)/1e18} ETH`);
    }
  });
  it("0 valueと0 withdrawも成功し、供給量とWETH残高は変わらない", () => {
    const s=session("10");
    expect(s.executeWrite("deposit",W,{valueRaw:"0"}).result.kind).toBe("success");
    expect(s.executeWrite("withdraw",W,{amountRaw:"0"}).result.kind).toBe("success");
    expect(s.engine.getBalance(W,U)).toBe(0n);
    expect(s.state.tokens[W]!.totalSupplyRaw).toBe(0n);
  });
});
