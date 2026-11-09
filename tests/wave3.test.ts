import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLoadedData } from "../src/data/loader";
import { deserializeState, serializeState } from "../src/engine/state";
import { PlaySession } from "../src/ui/session";
import { ProgressStore, type StorageLike } from "../src/store/progressStore";
import { SimulationStore } from "../src/store/simulationStore";
const json = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const data = buildLoadedData({ challengeFiles: Object.fromEntries(readdirSync(new URL("../data/challenges", import.meta.url)).filter(f=>f!=="index.json").map(f=>[f,json(`../data/challenges/${f}`)])), indexRaw: json("../data/challenges/index.json"), badgesRaw: json("../data/badges.json") });
const U="0x"+"1".repeat(40), A="0x"+"2".repeat(40), V="0x"+"6".repeat(40);
function session(id: string) {
  const map=new Map<string,string>();
  const storage: StorageLike={getItem:k=>map.get(k)??null,setItem:(k,v)=>{map.set(k,v);},removeItem:k=>{map.delete(k);}};
  return new PlaySession(data,data.byId.get(id)!,new ProgressStore(storage,() => ({ challengeXp: new Map(data.challenges.map(c => [c.id, c.xp])), badgeIds: new Set(data.badges.map(b => b.id)) })),new SimulationStore(storage));
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
const H="0x"+"b".repeat(40), DEX="0x"+"4".repeat(40);
function permit(s: PlaySession,id="own") {return s.executeWrite("permit",A,{signatureId:id}).result;}
function solve15(s: PlaySession) {
  s.doRead("nonces",A,{account:U}); s.doRead("allowance",A,{owner:U,spender:H});
  s.signPermit(); permit(s); s.doRead("nonces",A,{account:U}); permit(s,"leaked");
  s.doRead("allowance",A,{owner:U,spender:H}); return s.answerQuiz("q15","price");
}
describe("E6 permit",()=>{
  it("署名→実行→nonce進行→流出署名無効化・全stepChecks・再挑戦",()=>{
    const s=session("15"); expect(solve15(s).clear?.awardedXp).toBe(300);
    expect(s.state.permitNonces[A]).toBe(8); expect(s.engine.getAllowance(A,U,DEX)).toBe(200000000n);
    expect(s.engine.getAllowance(A,U,H)).toBe(0n); expect(s.engine.getBalance(A,U)).toBe(500000000n);
    expect(s.state.txLog.map(t=>t.revertReason)).toEqual([undefined,"INVALID_NONCE"]);
    expect(s.checklist().every(c=>c.done)).toBe(true);
    s.reset(); expect(s.engine.signatureLog).toEqual([]); expect(s.signedPermits.map(p=>p.id)).toEqual(["leaked"]);
    expect(s.state.permitNonces[A]).toBe(7); solve15(s); expect(s.progress.totalXp).toBe(300);
  });
  it("署名はtx・call・ガス・nonce・ブロックを進めず、専用の順序証跡に残る",()=>{
    const s=session("15"),before=serializeState(s.state); s.signPermit();
    expect(serializeState(s.state)).toEqual(before); expect(s.engine.signatureLog).toHaveLength(1);
    expect(s.signedPermits.map(p=>p.id)).toEqual(["leaked","own"]);
    s.signPermit(); expect(s.engine.signatureLog).toHaveLength(1);
    permit(s); expect(s.state.txLog[0]!.sequence).toBeGreaterThan(s.engine.signatureLog[0]!.sequence);
    expect(JSON.stringify(serializeState(s.state))).not.toContain('signedPermits');
    expect(JSON.stringify(serializeState(s.state))).not.toContain('signatureLog');
  });
  it("署名の値が使われ、引数でowner/spender/value/nonceを偽装できない",()=>{
    const s=session("15"); s.signPermit();
    s.executeWrite("permit",A,{signatureId:"own",owner:H,spender:H,valueRaw:"1",nonce:"8"});
    expect(s.engine.getAllowance(A,U,DEX)).toBe(200000000n); expect(s.engine.getAllowance(A,U,H)).toBe(0n);
    expect(()=>s.executeWrite("permit",A,{signatureId:"unknown"})).toThrow();
  });
  it("nonce不一致はrevert、承認とPermit nonceは不変、ガスのみ消費",()=>{
    const s=session("15"); s.signPermit(); s.state.permitNonces[A]=9;
    const before=serializeState(s.state),r=permit(s);
    expect(r.kind).toBe("revert"); if(r.kind!=="preflight-failure") expect(r.record.revertReason).toBe("INVALID_NONCE");
    expect(serializeState(s.state).allowances).toEqual(before.allowances); expect(s.state.permitNonces[A]).toBe(9);
    expect(s.state.accounts[U]!.nonce).toBe(1); expect(s.state.blockNumber).toBe(1);
  });
  it("攻撃者の署名が先なら承認が反映され、課題は不合格",()=>{
    const s=session("15"); expect(permit(s,"leaked").kind).toBe("success");
    expect(s.engine.getAllowance(A,U,H)).toBe((1n<<256n)-1n);
    solve15(s); expect(s.evaluation.passed).toBe(false);
  });
  it("previewはallowanceとnonceの進行・古い署名のrevertを正しく予測",()=>{
    const s=session("15"); s.signPermit(); const before=serializeState(s.state);
    const p=s.previewWrite("permit",A,{signatureId:"own"});
    expect(p.diffs.some(d=>d.after.includes("200 USDC"))).toBe(true);
    expect(p.diffs).toContainEqual({label:"Permit nonce",before:"7",after:"8"});
    expect(serializeState(s.state)).toEqual(before); permit(s);
    expect(s.previewWrite("permit",A,{signatureId:"leaked"}).warning).toContain("revert");
  });
  it("履歴を復元しても署名済みリストと署名記録は復元しない",()=>{
    const s=session("15"); s.signPermit(); const saved=serializeState(s.state);
    const fresh=session("15"); fresh.engine.state=deserializeState(saved);
    expect(fresh.signedPermits.map(p=>p.id)).toEqual(["leaked"]); expect(fresh.engine.signatureLog).toEqual([]);
    fresh.doRead("nonces",A,{account:U}); fresh.signPermit();
    const order=[...fresh.state.callLog,...fresh.engine.signatureLog].map(r=>r.sequence);
    expect(new Set(order).size).toBe(order.length);
  });
});

describe("Wave 3 integration",()=>{
  it("全15課題が有効、合計2850 XP、新規課題はstepsとstepChecksが1対1",()=>{
    expect(data.invalid).toEqual([]); expect(data.problems).toEqual([]);
    expect(data.challenges.map(c=>c.id)).toEqual(Array.from({length:15},(_,i)=>String(i+1).padStart(2,"0")));
    expect(data.totalXp).toBe(2850);
    for(const id of ["13","14","15"]) expect(data.byId.get(id)!.stepChecks).toHaveLength(data.byId.get(id)!.steps.length);
  });
  it("既存2050 XPの進捗へ800 XPを加算・保存復元し、二重付与しない",()=>{
    const map=new Map<string,string>();
    const storage: StorageLike={getItem:k=>map.get(k)??null,setItem:(k,v)=>{map.set(k,v);},removeItem:k=>{map.delete(k);}};
    const progress=new ProgressStore(storage,() => ({ challengeXp: new Map(data.challenges.map(c => [c.id, c.xp])), badgeIds: new Set(data.badges.map(b => b.id)) })),sim=new SimulationStore(storage);
    let old=progress.load().state;
    for(const def of data.challenges.filter(d=>Number(d.id)<=12)) old=progress.markCleared(old,def.id,def.xp,[]).state;
    progress.save(old); expect(old.totalXp).toBe(2050);
    for(const [id,solve] of [["13",solve13],["14",solve14],["15",solve15]] as const) {
      const s=new PlaySession(data,data.byId.get(id)!,progress,sim); solve(s); expect(s.evaluation.passed).toBe(true);
      const restored=new PlaySession(data,data.byId.get(id)!,progress,sim); expect(restored.alreadyCleared()).toBe(true);
      expect(serializeState(restored.state)).toEqual(serializeState(s.state));
      restored.reset(); solve(restored);
    }
    expect(progress.load().state.totalXp).toBe(2850); expect(progress.load().state.clearedChallengeIds).toHaveLength(15);
  });
  it("署名の専用記録なしではpermit実行ログだけで合格しない",()=>{
    const s=session("15"); solve15(s); expect(s.evaluation.passed).toBe(true);
    s.engine.signatureLog=[]; s.answerQuiz("q15","price"); expect(s.evaluation.passed).toBe(false);
  });
});
