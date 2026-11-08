import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLoadedData } from "../src/data/loader";
import { serializeState } from "../src/engine/state";
import { PlaySession } from "../src/ui/session";
import { ProgressStore, type StorageLike } from "../src/store/progressStore";
import { SimulationStore } from "../src/store/simulationStore";
const json = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const data = buildLoadedData({ challengeFiles: Object.fromEntries(readdirSync(new URL("../data/challenges", import.meta.url)).filter(f=>f!=="index.json").map(f=>[f,json(`../data/challenges/${f}`)])), indexRaw: json("../data/challenges/index.json"), badgesRaw: json("../data/badges.json") });
const U="0x"+"1".repeat(40), A="0x"+"2".repeat(40), V="0x"+"6".repeat(40);
function session(id: string) {
  const map=new Map<string,string>();
  const storage: StorageLike={getItem:k=>map.get(k)??null,setItem:(k,v)=>{map.set(k,v);},removeItem:k=>{map.delete(k);}};
  return new PlaySession(data,data.byId.get(id)!,new ProgressStore(storage,()=>data.totalXp),new SimulationStore(storage));
}
function solve13(s: PlaySession, amount="1050000000", shares="1000000000") {
  s.doRead("balanceOf",A,{account:U});
  s.doRead("totalAssets",V); s.doRead("totalSupply",V);
  s.doRead("convertToShares",V,{assetsRaw:"1050000000"});
  s.executeWrite("deposit",V,{assetsRaw:amount}); s.doRead("balanceOf",V,{account:U});
  s.doRead("previewRedeem",V,{sharesRaw:shares}); s.executeWrite("redeem",V,{sharesRaw:shares});
  s.doRead("balanceOf",A,{account:U}); return s.answerQuiz("q13","price");
}
describe("E4 vault",()=>{
  it("正解フロー・チェックリスト・リセット再挑戦・XP一度のみ",()=>{
    const s=session("13"); expect(solve13(s).clear?.awardedXp).toBe(250);
    expect(s.checklist().every(c=>c.done)).toBe(true);
    expect(s.engine.getBalance(A,U)).toBe(2000000000n); expect(s.engine.getBalance(V,U)).toBe(0n);
    expect(s.state.tokens[V]!.totalSupplyRaw).toBe(10000000000n);
    s.reset(); expect(s.checklist().every(c=>!c.done)).toBe(true); solve13(s); expect(s.progress.totalXp).toBe(250);
  });
  it("数量違いで往復して最終残高が同じでも不合格",()=>{
    const s=session("13"); solve13(s,"105000000","100000000"); expect(s.evaluation.passed).toBe(false);
  });
  it.each([["deposit","assetsRaw","2000000001"],["redeem","sharesRaw","1"]] as const)("%s不足はrevertし資産・供給量不変",(n,k,v)=>{
    const s=session("13"), before=serializeState(s.state);
    const r=s.executeWrite(n,V,{[k]:v}).result; expect(r.kind).toBe("revert");
    if(r.kind!=="preflight-failure") expect(r.record.revertReason).toBe("INSUFFICIENT_BALANCE");
    expect(serializeState(s.state).tokens).toEqual(before.tokens); expect(s.state.blockNumber).toBe(1);
  });
  it("換算は切り捨て、常に現在の残高を使う",()=>{
    const s=session("13"); expect(s.engine.convertVault(1n,true)).toBe(0n);
    expect(s.engine.convertVault(21n,true)).toBe(20n); expect(s.engine.convertVault(1n,false)).toBe(1n);
    s.state.tokens[A]!.balances[V]=21000000000n;
    expect(s.engine.convertVault(1050000000n,true)).toBe(500000000n);
  });
  it("depositとredeemのプレビューは資産・株の変化を示して状態を変えない",()=>{
    const s=session("13"), before=serializeState(s.state);
    const p=s.previewWrite("deposit",V,{assetsRaw:"1050000000"});
    expect(p.diffs.some(d=>d.label.includes("あなたのUSDC")&&d.after.includes("950 USDC"))).toBe(true);
    expect(p.diffs.some(d=>d.after.includes("1000 vUSDC"))).toBe(true); expect(serializeState(s.state)).toEqual(before);
    s.executeWrite("deposit",V,{assetsRaw:"1050000000"});
    expect(s.previewWrite("redeem",V,{sharesRaw:"1000000000"}).diffs.some(d=>d.after.includes("2000 USDC"))).toBe(true);
  });
  it("設定のない課題ではvault Readは無効",()=>expect(session("01").doRead("totalAssets",A).result.ok).toBe(false));
});
