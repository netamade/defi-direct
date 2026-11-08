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
const C="0x"+"3".repeat(40), D="0x"+"8".repeat(40), T="0x"+"9".repeat(40);
const proofA=JSON.stringify(["0x526cad0af1dda06f7f5688e7b654b6d6395cb3904c818c16bb7b53fac7d1b881","0x7672f629b84ea7636bb85953a21640b26992fd0e41acddae02111ec9f3d59c07"]);
const proofC=JSON.stringify(["0x70abacda97f1a3255e287fb4d34bc282953408c8635f75cd9f4d68defc498b57","0x4c0e3b6731a0177b5c4e4ecbddf93f958476bd2f4958afb8e2d855984d869160"]);
function claim(s: PlaySession, proof=proofC,amountRaw="75000000") {return s.executeWrite("claim",D,{amountRaw,proof}).result;}
function solve14(s: PlaySession) {
  s.doRead("balanceOf",T,{account:C}); s.doRead("isClaimed",D,{account:C});
  claim(s,proofA); claim(s); s.doRead("balanceOf",T,{account:C}); s.doRead("isClaimed",D,{account:C}); claim(s);
  return s.answerQuiz("q14","price");
}
describe("E5 airdrop",()=>{
  it("誤proof→正常→二重請求と全stepChecks、250 XP、リセット",()=>{
    const s=session("14"); expect(solve14(s).clear?.awardedXp).toBe(250);
    expect(s.state.txLog.map(t=>t.revertReason)).toEqual(["INVALID_PROOF",undefined,"ALREADY_CLAIMED"]);
    expect(s.checklist().every(c=>c.done)).toBe(true); expect(s.state.flags[`claimed:${D}`]).toBe(true);
    expect(s.engine.getBalance(T,C)).toBe(75000000n); expect(s.engine.getBalance(T,D)).toBe(850000000n);
    s.reset(); expect(s.state.flags).toEqual({}); solve14(s); expect(s.progress.totalXp).toBe(250);
  });
  it.each([proofA,"[]","[",'["invalid"]'])("invalid proof %s only burns gas",proof=>{
    const s=session("14"), before=serializeState(s.state);
    expect(claim(s,proof).kind).toBe("revert"); expect(s.state.flags).toEqual({});
    expect(serializeState(s.state).tokens).toEqual(before.tokens); expect(s.state.blockNumber).toBe(1);
  });
  it("amount is part of leaf; already-claimed validation precedes proof",()=>{
    const s=session("14"); claim(s,proofC,"75000001"); expect(s.state.txLog[0]!.revertReason).toBe("INVALID_PROOF");
    claim(s); claim(s,"[]"); expect(s.state.txLog[2]!.revertReason).toBe("ALREADY_CLAIMED");
  });
  it("claim preview is read-only, predicts failure and AIR credit",()=>{
    const s=session("14"),before=serializeState(s.state);
    expect(s.previewWrite("claim",D,{amountRaw:"75000000",proof:proofA}).warning).toContain("revert");
    expect(s.previewWrite("claim",D,{amountRaw:"75000000",proof:proofC}).diffs.some(d=>d.after.includes("75 AIR"))).toBe(true);
    expect(serializeState(s.state)).toEqual(before);
  });
});
