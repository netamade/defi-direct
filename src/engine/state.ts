// 疑似実行エンジンの状態モデル（Wave 3 §1でflags / permitNoncesを追加）
//
// スキーマ凍結について（設計書 5.3 フェーズ1完了条件）：
// SimulationState / TxRecord / CallRecord / StateSnapshot のフィールド追加・削除・
// 型変更は本フェーズ完了後に行わない。変更が必要な場合は設計書の改訂を経ること。
// 金額はすべて BigInt で扱い、JSON・localStorage との受け渡しでは10進文字列にする（設計書 2.6）。

export type Address = string; // 0x + 40文字の16進数。練習用であることのみを前提とし、チェックサム検証は簡易版とする

export const STATE_SCHEMA_VERSION = 2;

export interface Account {
  address: Address;
  label: string; // 例: "あなたの練習用ウォレット" / "練習用スペンダー"
  role: "user" | "counterparty"; // user = 現在の疑似アカウント（送信者）
  isCurrentUser: boolean; // 送信者（現在の疑似アカウント）である場合にtrue。試作版では1アカウントのみtrue
  ethBalanceWei: bigint; // 疑似ETH残高（wei表記。decimalsは18固定で表示換算する）。ガス代はここから控除する
  nonce: number; // アカウント単位のnonce。ブロックに包含されたトランザクションのみ+1する
}

export interface Token {
  address: Address;
  name: string; // 例: "Practice USD Coin"
  symbol: string; // 例: "USDC"
  decimals: number; // 例: USDC=6、TKN=18。課題ごとにJSONで定義
  totalSupplyRaw: bigint;
  balances: Record<Address, bigint>; // アカウント → raw残高
}

export interface StateDiff {
  kind: "balance" | "allowance" | "eth";
  token?: Address;
  account?: Address;
  spender?: Address;
  beforeRaw: string;
  afterRaw: string;
}

export interface TxRecord {
  id: string; // SIM-TX-0001 のような連番ID（疑似ハッシュ。実ハッシュではない）
  pseudoHash: string; // 表示用の疑似ハッシュ。SIM-TX-0001形式とし、実ハッシュではないことを注記する
  blockNumber: number; // 包含された疑似ブロック番号。revert時も進む
  nonce: number; // 送信時のアカウントnonce（包含後の値ではなく、送信に使われた値）
  attemptId: number;
  sequence: number; // 試行内の通し番号（callLogと共通の順序付けに使う）
  type: "write";
  functionName: string; // 例: "approve" / "swapExactUSDCForTKN"
  contract: Address; // 呼び出したコントラクト（トークン）アドレス
  args: Record<string, string>; // 引数は文字列化して保存（BigIntは10進文字列）
  from: Address;
  status: 0 | 1; // Ethereumのトランザクションレシートに倣う。1=成功、0=revert
  outcome: "success" | "revert"; // 表示用のラベル。statusと常に対応する
  revertReason?: string; // 例: "INSUFFICIENT_BALANCE" 等のコード
  gasUsed: number; // 疑似値。成功時・revert時で課題JSONの既定値を使う
  gasPriceGwei: number; // 疑似値。表示用
  gasFeeWei: string; // gasUsed × gasPrice のwei表記（BigIntの10進文字列）。疑似ETH残高から控除する
  stateDiff: StateDiff[]; // 成功時の変化のみ。revert時は空配列（巻き戻し範囲はトークン残高とallowanceのみ）
  timestamp: string; // ISO文字列（疑似時刻でもよい。順序はsequenceが正とする）
}

export interface CallRecord {
  id: string; // SIM-CALL-0001 のような連番ID
  attemptId: number;
  sequence: number; // txLogと共通の通し番号。actionSequenceの順序判定はこのsequence順で行う
  type: "read";
  functionName: string; // 例: "decimals" / "balanceOf" / "allowance"
  contract: Address;
  args: Record<string, string>;
  from: Address; // 読み手（現在の疑似アカウント）
  returnValueRaw: string; // 返却値のraw値（10進文字列）
  returnValueDisplay: string; // 返却値の表示値
  timestamp: string;
}

export interface SimulationState {
  schemaVersion: 2; // Wave 3 状態スキーマ版数（txLog・callLog・スナップショットを含む）
  challengeId: string; // 例: "01" / "02" / "03"
  attemptId: number; // 試行番号。課題リセットごとに+1する。判定は現在のattemptIdの履歴のみで行う
  blockNumber: number; // 疑似ブロック番号。ブロックに包含されたWrite（成功・revertを問わず）ごとに+1する。Readでは不変
  accounts: Record<Address, Account>;
  tokens: Record<Address, Token>; // コントラクトアドレス → トークン定義
  allowances: Record<string, bigint>; // キー: `${owner}:${spender}:${token}` → 承認量（raw値）
  flags: Record<string, boolean>;
  permitNonces: Record<string, number>;
  txLog: TxRecord[]; // 時系列のWrite履歴。課題ごと・試行ごとに区切る（attemptIdで絞る）
  callLog: CallRecord[]; // 時系列の成功したReadのみの履歴。課題ごと・試行ごとに区切る
}

/** 状態スナップショット（テスト用に凍結。設計書 2.2 注記） */
export interface StateSnapshot {
  blockNumber: number;
  accounts: Record<Address, { ethBalanceWei: string; nonce: number }>;
  balances: Record<Address, Record<Address, string>>; // token → account → raw文字列
  allowances: Record<string, string>; // "owner:spender:token" → raw文字列
}

// --- 課題定義のうち、エンジン初期化に必要な部分（設計書 3.2 の部分集合） ---

export interface ContractInfo {
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
  label: string;
  isPractice: true;
}

export interface InitialStateInput {
  flags?: Record<string, boolean>;
  permitNonces?: Record<string, number>;
  userAddress: Address;
  spenderAddresses: Record<string, Address>; // 例: { dex: "0x..." }
  ethBalanceWei: string; // 疑似ETH残高のwei表記。全課題で必須
  balances: Record<Address, Record<Address, string>>; // token → account → raw文字列
  allowances: Record<string, string>; // "owner:spender:token" → raw文字列
}

export function allowanceKey(owner: Address, spender: Address, token: Address): string {
  return `${owner}:${spender}:${token}`;
}

function ensureAccount(
  accounts: Record<Address, Account>,
  address: Address,
  init: Partial<Account>,
): Account {
  const existing = accounts[address];
  if (existing) return existing;
  const account: Account = {
    address,
    label: init.label ?? "練習用アカウント",
    role: init.role ?? "counterparty",
    isCurrentUser: init.isCurrentUser ?? false,
    ethBalanceWei: init.ethBalanceWei ?? 0n,
    nonce: init.nonce ?? 0,
  };
  accounts[address] = account;
  return account;
}

/**
 * 課題の initialState から SimulationState を生成する。
 * エンジン側に課題固有の数値は持たず、すべて入力から組み立てる（設計書 2.3）。
 */
export function createInitialState(
  challengeId: string,
  contracts: ContractInfo[],
  initial: InitialStateInput,
  attemptId = 1,
): SimulationState {
  const accounts: Record<Address, Account> = {};

  ensureAccount(accounts, initial.userAddress, {
    label: "あなたの練習用ウォレット",
    role: "user",
    isCurrentUser: true,
    ethBalanceWei: BigInt(initial.ethBalanceWei),
  });

  for (const [key, address] of Object.entries(initial.spenderAddresses)) {
    ensureAccount(accounts, address, {
      label: key === "dex" ? "練習用DEX（疑似）" : "練習用スペンダー",
      role: "counterparty",
    });
  }

  const tokens: Record<Address, Token> = {};
  for (const contract of contracts) {
    const balances: Record<Address, bigint> = {};
    let totalSupply = 0n;
    const rawBalances = initial.balances[contract.address] ?? {};
    for (const [accountAddress, raw] of Object.entries(rawBalances)) {
      const value = BigInt(raw);
      balances[accountAddress] = value;
      totalSupply += value;
      ensureAccount(accounts, accountAddress, {});
    }
    tokens[contract.address] = {
      address: contract.address,
      name: contract.name,
      symbol: contract.symbol,
      decimals: contract.decimals,
      totalSupplyRaw: totalSupply,
      balances,
    };
  }

  const allowances: Record<string, bigint> = {};
  for (const [key, raw] of Object.entries(initial.allowances)) {
    allowances[key] = BigInt(raw);
  }

  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    challengeId,
    attemptId,
    blockNumber: 0,
    accounts,
    tokens,
    allowances,
    flags: { ...initial.flags },
    permitNonces: Object.fromEntries(Object.entries(initial.permitNonces ?? {}).map(([k,v]) => [k.toLowerCase(),v])),
    txLog: [],
    callLog: [],
  };
}

/** 課題リセット用：初期状態を再生成し attemptId を+1する（設計書 2.7）。 */
export function resetState(
  state: SimulationState,
  contracts: ContractInfo[],
  initial: InitialStateInput,
): SimulationState {
  return createInitialState(state.challengeId, contracts, initial, state.attemptId + 1);
}

/** テスト比較用のスナップショット（BigIntは10進文字列化する）。 */
export function snapshotState(state: SimulationState): StateSnapshot {
  const accounts: StateSnapshot["accounts"] = {};
  for (const [address, account] of Object.entries(state.accounts)) {
    accounts[address] = {
      ethBalanceWei: account.ethBalanceWei.toString(),
      nonce: account.nonce,
    };
  }
  const balances: StateSnapshot["balances"] = {};
  for (const [tokenAddress, token] of Object.entries(state.tokens)) {
    const perAccount: Record<Address, string> = {};
    for (const [accountAddress, raw] of Object.entries(token.balances)) {
      perAccount[accountAddress] = raw.toString();
    }
    balances[tokenAddress] = perAccount;
  }
  const allowances: Record<string, string> = {};
  for (const [key, raw] of Object.entries(state.allowances)) {
    allowances[key] = raw.toString();
  }
  return { blockNumber: state.blockNumber, accounts, balances, allowances };
}

// --- localStorage 保存用シリアライズ（BigIntは10進文字列。設計書 2.6） ---

export interface SerializedSimulationState {
  schemaVersion: 1 | 2;
  flags?: Record<string, boolean>;
  permitNonces?: Record<string, number>;
  challengeId: string;
  attemptId: number;
  blockNumber: number;
  accounts: Record<
    Address,
    {
      address: Address;
      label: string;
      role: "user" | "counterparty";
      isCurrentUser: boolean;
      ethBalanceWei: string;
      nonce: number;
    }
  >;
  tokens: Record<
    Address,
    {
      address: Address;
      name: string;
      symbol: string;
      decimals: number;
      totalSupplyRaw: string;
      balances: Record<Address, string>;
    }
  >;
  allowances: Record<string, string>;
  txLog: TxRecord[];
  callLog: CallRecord[];
}

export function serializeState(state: SimulationState): SerializedSimulationState {
  const accounts: SerializedSimulationState["accounts"] = {};
  for (const [address, account] of Object.entries(state.accounts)) {
    accounts[address] = {
      address: account.address,
      label: account.label,
      role: account.role,
      isCurrentUser: account.isCurrentUser,
      ethBalanceWei: account.ethBalanceWei.toString(),
      nonce: account.nonce,
    };
  }
  const tokens: SerializedSimulationState["tokens"] = {};
  for (const [address, token] of Object.entries(state.tokens)) {
    const balances: Record<Address, string> = {};
    for (const [accountAddress, raw] of Object.entries(token.balances)) {
      balances[accountAddress] = raw.toString();
    }
    tokens[address] = {
      address: token.address,
      name: token.name,
      symbol: token.symbol,
      decimals: token.decimals,
      totalSupplyRaw: token.totalSupplyRaw.toString(),
      balances,
    };
  }
  const allowances: Record<string, string> = {};
  for (const [key, raw] of Object.entries(state.allowances)) {
    allowances[key] = raw.toString();
  }
  return {
    schemaVersion: state.schemaVersion,
    challengeId: state.challengeId,
    attemptId: state.attemptId,
    blockNumber: state.blockNumber,
    accounts,
    tokens,
    allowances,
    flags: { ...state.flags },
    permitNonces: { ...state.permitNonces },
    txLog: state.txLog.map((tx) => ({ ...tx, args: { ...tx.args }, stateDiff: tx.stateDiff.map((d) => ({ ...d })) })),
    callLog: state.callLog.map((call) => ({ ...call, args: { ...call.args } })),
  };
}

// BigInt変換・ネストしたレコードのコピーより前に、未検証の保存JSONを検査する。
const MAX_SAVED_LOG_ENTRIES = 10_000;
const unsafeKeys = new Set(["__proto__", "constructor", "prototype"]);
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).every(key => !unsafeKeys.has(key));
}
function uint(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function decimal(value: unknown): value is string {
  return typeof value === "string" && /^-?\d+$/.test(value);
}
function stringRecord(value: unknown): boolean {
  return record(value) && Object.values(value).every(v => typeof v === "string");
}
function validLog(value: unknown, type: "write" | "read"): boolean {
  if (!record(value) || value.type !== type || !uint(value.attemptId) || !uint(value.sequence)
    || !["id", "functionName", "contract", "from", "timestamp"].every(k => typeof value[k] === "string")
    || !stringRecord(value.args)) return false;
  if (type === "read") return typeof value.returnValueRaw === "string" && typeof value.returnValueDisplay === "string";
  return typeof value.pseudoHash === "string"
    && ["blockNumber", "nonce", "gasUsed"].every(k => uint(value[k]))
    && typeof value.gasPriceGwei === "number" && Number.isFinite(value.gasPriceGwei) && value.gasPriceGwei >= 0
    && decimal(value.gasFeeWei)
    && ((value.status === 1 && value.outcome === "success") || (value.status === 0 && value.outcome === "revert"))
    && (value.revertReason === undefined || typeof value.revertReason === "string")
    && Array.isArray(value.stateDiff) && value.stateDiff.every(d => record(d)
      && ["balance", "allowance", "eth"].includes(d.kind as string)
      && decimal(d.beforeRaw) && decimal(d.afterRaw)
      && ["token", "account", "spender"].every(k => d[k] === undefined || typeof d[k] === "string"));
}
function validateSerializedState(data: unknown, contracts?: readonly ContractInfo[]): asserts data is SerializedSimulationState {
  if (!record(data) || (data.schemaVersion !== 1 && data.schemaVersion !== STATE_SCHEMA_VERSION)
    || typeof data.challengeId !== "string" || !uint(data.attemptId) || !uint(data.blockNumber)
    || !record(data.accounts) || Object.keys(data.accounts).length === 0
    || !Object.entries(data.accounts).every(([address, a]) => record(a) && a.address === address
      && typeof a.label === "string" && (a.role === "user" || a.role === "counterparty")
      && typeof a.isCurrentUser === "boolean" && decimal(a.ethBalanceWei) && uint(a.nonce))
    || Object.values(data.accounts).filter(a => record(a) && a.isCurrentUser === true).length !== 1
    || !record(data.tokens) || !Object.entries(data.tokens).every(([address, t]) => record(t)
      && t.address === address && typeof t.name === "string" && typeof t.symbol === "string"
      && uint(t.decimals) && decimal(t.totalSupplyRaw) && record(t.balances) && Object.values(t.balances).every(decimal))
    || !record(data.allowances) || !Object.values(data.allowances).every(decimal)
    || (data.flags !== undefined && (!record(data.flags) || !Object.values(data.flags).every(v => typeof v === "boolean")))
    || (data.permitNonces !== undefined && (!record(data.permitNonces) || !Object.values(data.permitNonces).every(uint)))
    || !Array.isArray(data.txLog) || data.txLog.length > MAX_SAVED_LOG_ENTRIES || !data.txLog.every(v => validLog(v, "write"))
    || !Array.isArray(data.callLog) || data.callLog.length > MAX_SAVED_LOG_ENTRIES || !data.callLog.every(v => validLog(v, "read"))) {
    throw new Error("Invalid simulation state");
  }
  if (contracts && (Object.keys(data.tokens).length !== contracts.length || !contracts.every(c => {
    const token = (data.tokens as Record<string, unknown>)[c.address];
    return record(token) && token.address === c.address && token.decimals === c.decimals;
  }))) throw new Error("Saved tokens do not match challenge contracts");
}

export function deserializeState(data: unknown, contracts?: readonly ContractInfo[]): SimulationState {
  validateSerializedState(data, contracts);
  const accounts: Record<Address, Account> = {};
  for (const [address, account] of Object.entries(data.accounts)) {
    accounts[address] = { ...account, ethBalanceWei: BigInt(account.ethBalanceWei) };
  }
  const tokens: Record<Address, Token> = {};
  for (const [address, token] of Object.entries(data.tokens)) {
    const balances: Record<Address, bigint> = {};
    for (const [accountAddress, raw] of Object.entries(token.balances)) {
      balances[accountAddress] = BigInt(raw);
    }
    tokens[address] = { ...token, totalSupplyRaw: BigInt(token.totalSupplyRaw), balances };
  }
  const allowances: Record<string, bigint> = {};
  for (const [key, raw] of Object.entries(data.allowances)) {
    allowances[key] = BigInt(raw);
  }
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    challengeId: data.challengeId,
    attemptId: data.attemptId,
    blockNumber: data.blockNumber,
    accounts,
    tokens,
    allowances,
    flags: { ...data.flags },
    permitNonces: Object.fromEntries(Object.entries(data.permitNonces ?? {}).map(([k,v]) => [k.toLowerCase(),v])),
    txLog: data.txLog.map((tx) => ({ ...tx, args: { ...tx.args }, stateDiff: tx.stateDiff.map((d) => ({ ...d })) })),
    callLog: data.callLog.map((call) => ({ ...call, args: { ...call.args } })),
  };
}
