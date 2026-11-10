// シミュレーション状態の保存（設計書 5.1 / docs/progress-store.md）
//
// - 進捗とは別管理。課題ごとに `chokukon_sim_v1_{challengeId}` へ保存する（attemptId は値に含まれる）。
// - 読み込みは検証を通し、壊れていれば null を返して新規開始できるようにする（クラッシュさせない）。
import {
  deserializeState,
  serializeState,
  type SimulationState,
  type ContractInfo,
} from "../engine/state";
import type { StorageLike } from "./progressStore";

export const SIM_STORAGE_KEY_PREFIX = "chokukon_sim_v1_";

export function simStorageKey(challengeId: string): string {
  return `${SIM_STORAGE_KEY_PREFIX}${challengeId}`;
}

export class SimulationStore {
  private readonly storage: StorageLike;

  constructor(storage: StorageLike) {
    this.storage = storage;
  }

  save(state: SimulationState): boolean {
    try {
      this.storage.setItem(simStorageKey(state.challengeId), JSON.stringify(serializeState(state)));
      return true;
    } catch {
      return false;
    }
  }

  /** 保存済みの状態を復元する。未保存・破損・別課題のデータなら null */
  load(challengeId: string, contracts: readonly ContractInfo[]): SimulationState | null {
    let text: string | null;
    try {
      text = this.storage.getItem(simStorageKey(challengeId));
    } catch {
      return null;
    }
    if (text === null) return null;
    try {
      const state = deserializeState(JSON.parse(text), contracts);
      return state.challengeId === challengeId ? state : null;
    } catch {
      return null;
    }
  }

  clear(challengeId: string): void {
    try {
      this.storage.removeItem(simStorageKey(challengeId));
    } catch {
      // 削除に失敗しても致命的ではない
    }
  }

  clearAll(challengeIds: string[]): void {
    for (const id of challengeIds) this.clear(id);
  }
}
