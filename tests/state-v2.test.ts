import { describe, expect, it } from "vitest";
import { createInitialState, serializeState, deserializeState, type SerializedSimulationState } from "../src/engine/state";
import { SimulationStore, simStorageKey } from "../src/store/simulationStore";
const token="0x"+"a".repeat(40), user="0x"+"1".repeat(40);
const initial={userAddress:user,spenderAddresses:{},ethBalanceWei:"1000",balances:{},allowances:{}};
describe("Wave 3 state v2 compatibility",()=>{
  it("legacy initial input and persisted v1 get empty maps without losing history",()=>{
    const s=createInitialState("01",[],initial);
    expect(s.flags).toEqual({}); expect(s.permitNonces).toEqual({});
    const old: SerializedSimulationState={...serializeState(s),schemaVersion:1}; delete old.flags; delete old.permitNonces;
    expect(deserializeState(old)).toEqual(s);
    const map=new Map([[simStorageKey("01"),JSON.stringify(old)]]);
    const store=new SimulationStore({getItem:k=>map.get(k)??null,setItem:(k,v)=>{map.set(k,v);},removeItem:k=>{map.delete(k);}});
    expect(store.load("01", [])).toEqual(s); expect(store.save(s)).toBe(true);
    expect(JSON.parse(map.get(simStorageKey("01"))!).schemaVersion).toBe(2);
  });
  it("initial fields and v2 serialization round-trip without sharing mutable maps",()=>{
    const input={...initial,flags:{['claimed:'+token]:true},permitNonces:{[token.toUpperCase()]:7}};
    const s=createInitialState("15",[],input); expect(s.permitNonces[token]).toBe(7);
    const saved=serializeState(s); expect(deserializeState(saved)).toEqual(s);
    s.flags['claimed:'+token]=false; expect(input.flags['claimed:'+token]).toBe(true); expect(saved.flags?.['claimed:'+token]).toBe(true);
  });
  it("unsupported schema still fails closed",()=>expect(()=>deserializeState({schemaVersion:99} as never)).toThrow());
});
