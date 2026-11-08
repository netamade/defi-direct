import { verifyProof } from "./keccak";
// 疑似実行エンジン（設計書 第2節）
//
// 原則（設計書 2.1）:
// - エンジンはEthereumの考え方に沿って正しく動く。採点の都合で状態を捻じ曲げない。
// - Readは状態を変えず、ガスもトランザクションも発生させない。成功したReadのみcallLogに残す。
// - Writeはトランザクションを1件生む。成功時のみトークン残高・allowanceが変わる。
// - revert時はトークン残高とallowanceを巻き戻す（＝変更しない）。ガス・nonce・ブロック番号は進む。
// - ガス不足は「送信前・未包含の失敗」：txLogに残さず、nonce・ブロック・ガスは動かない。
// - エンジンに課題固有の合格判定は入れない（採点は scoring 側の責務）。
import {
  allowanceKey,
  createInitialState,
  resetState,
  type Address,
  type CallRecord,
  type ContractInfo,
  type InitialStateInput,
  type SimulationState,
  type StateDiff,
  type TxRecord,
} from "./state";
import { formatUnits, MAX_UINT256, rateToRational, swapAmountOutRaw, type Rational } from "./units";
import { INSUFFICIENT_GAS_MESSAGE, ZERO_ADDRESS, type RevertCode } from "./validation";

export interface GasConfig {
  gasUsed: number;
  gasPriceGwei: number;
}

/** 設計書 2.5 の既定ガス（すべて疑似値）。課題JSONの gas で上書きできる。 */
export const DEFAULT_GAS: Record<string, GasConfig> = {
  deposit: { gasUsed: 28_000, gasPriceGwei: 20 },
  withdraw: { gasUsed: 35_000, gasPriceGwei: 20 },
  approve: { gasUsed: 45_000, gasPriceGwei: 20 },
  transferFrom: { gasUsed: 65_000, gasPriceGwei: 20 },
  transfer: { gasUsed: 51_000, gasPriceGwei: 20 }, // ERC-20 transfer想定の疑似値。21,000はネイティブETH送金の値なので使わない
  swapExactUSDCForTKN: { gasUsed: 120_000, gasPriceGwei: 20 },
};

export interface SwapConfig {
  dexAddress: Address; // 疑似DEX（呼び出し先コントラクトとして記録する）
  tokenIn: Address; // 支払うトークン（例：USDC）
  tokenOut: Address; // 受け取るトークン（例：TKN）
}

export interface EngineConfig {
  challengeId: string;
  contracts: ContractInfo[];
  initialState: InitialStateInput;
  gas?: Record<string, GasConfig>;
  swapQuoteRate?: number | string; // 参考見積もり。省略時は実行レートと同じ
  swapRate?: number | string; // 表示値ベース。既定 1
  airdrop?: { distributor: Address; token: Address; root: string };
  vault?: { asset: Address; shareToken: Address };
  swap?: SwapConfig;
}

/** 課題JSONの swap 明示フィールド（設計書 3.2 へのフェーズ3追加分） */
export interface SwapFieldDefinition {
  tokenIn: Address; // 支払うトークンのコントラクトアドレス
  tokenOut: Address; // 受け取るトークンのコントラクトアドレス
  spenderKey: string; // initialState.spenderAddresses のキー（例: "dex"）
}

/**
 * 課題定義（設計書 3.2 の ChallengeDefinition 相当）からエンジン設定を組み立てる。
 * swap の対応付けは課題JSONの明示フィールド（swap.tokenIn / tokenOut / spenderKey）で
 * 決める。contracts の並び順などの位置依存の推論は行わない。
 * swapRate があっても swap 明示フィールドがない課題では swap は有効化しない。
 */
export function engineConfigFromChallenge(def: {
  id: string;
  contracts: ContractInfo[];
  initialState: InitialStateInput;
  gas?: Record<string, GasConfig>;
  swapQuoteRate?: number;
  swapRate?: number;
  airdrop?: { distributor: Address; token: Address; root: string };
  vault?: { asset: Address; shareToken: Address };
  swap?: SwapFieldDefinition;
}): EngineConfig {
  const config: EngineConfig = {
    challengeId: def.id,
    ...(def.airdrop ? { airdrop: def.airdrop } : {}),
    ...(def.vault ? { vault: def.vault } : {}),
    contracts: def.contracts,
    initialState: def.initialState,
    ...(def.gas ? { gas: def.gas } : {}),
  };
  const dex = def.swap ? def.initialState.spenderAddresses[def.swap.spenderKey] : undefined;
  if (def.swapRate !== undefined && def.swap && dex) {
    config.swapRate = def.swapRate;
    config.swapQuoteRate = def.swapQuoteRate ?? def.swapRate;
    config.swap = { dexAddress: dex, tokenIn: def.swap.tokenIn, tokenOut: def.swap.tokenOut };
  }
  return config;
}

export type ReadFunctionName = "name" | "symbol" | "decimals" | "totalSupply" | "balanceOf" | "allowance" | "getAmountsOut" | "isClaimed" | "totalAssets" | "convertToShares" | "convertToAssets" | "previewDeposit" | "previewRedeem";
export type WriteFunctionName = "approve" | "transfer" | "transferFrom" | "deposit" | "claim" | "redeem" | "withdraw" | "swapExactUSDCForTKN";

export type ReadResult =
  | { ok: true; record: CallRecord; valueRaw: bigint; valueDisplay: string }
  | { ok: false; code: "UNKNOWN_CONTRACT" | "UNKNOWN_FUNCTION"; message: string };

export type WriteResult =
  | { kind: "success" | "revert"; record: TxRecord }
  | { kind: "preflight-failure"; code: "INSUFFICIENT_GAS"; message: string };

function formatId(prefix: string, n: number): string {
  return `${prefix}-${n.toString().padStart(4, "0")}`;
}

export class Engine {
  readonly config: EngineConfig;
  state: SimulationState;
  private readonly swapRateRational: Rational;

  constructor(config: EngineConfig) {
    this.config = config;
    this.state = createInitialState(config.challengeId, config.contracts, config.initialState, 1);
    this.swapRateRational = rateToRational(config.swapRate ?? 1);
  }

  /** 課題リセット：初期状態を再生成し attemptId を+1する（進捗には触れない。設計書 2.7） */
  reset(): void {
    this.state = resetState(this.state, this.config.contracts, this.config.initialState);
  }

  currentUser(): Address {
    const user = Object.values(this.state.accounts).find((a) => a.isCurrentUser);
    if (!user) throw new Error("現在の疑似アカウントが存在しません");
    return user.address;
  }

  getBalance(token: Address, account: Address): bigint {
    return this.state.tokens[token]?.balances[account] ?? 0n;
  }

  getAllowance(token: Address, owner: Address, spender: Address): bigint {
    return this.state.allowances[allowanceKey(owner, spender, token)] ?? 0n;
  }

  // --- Read（状態を変えない。成功時のみcallLogに記録する） ---

  read(functionName: ReadFunctionName, contract: Address, args: Record<string, string> = {}): ReadResult {
    const swap = this.config.swap;
    const vault = this.config.vault;
    const vaultRead = ["totalAssets", "convertToShares", "convertToAssets", "previewDeposit", "previewRedeem"].includes(functionName);
    if (vaultRead && (!vault || contract !== vault.shareToken)) return { ok: false, code: "UNKNOWN_FUNCTION", message: "この課題・コントラクトではボールトReadは使えません" };
    const airdrop = this.config.airdrop;
    if (functionName === "isClaimed" && (!airdrop || contract !== airdrop.distributor)) return { ok: false, code: "UNKNOWN_FUNCTION", message: "この契約ではisClaimedは使えません" };
    const token = functionName === "isClaimed" ? this.state.tokens[airdrop!.token] : functionName === "getAmountsOut"
      ? (swap && contract === swap.dexAddress ? this.state.tokens[swap.tokenOut] : undefined)
      : this.state.tokens[contract];
    if (!token) {
      // 存在しないコントラクトへのReadは疑似エラー表示とし、callLogには記録しない（設計書 2.4）
      return { ok: false, code: "UNKNOWN_CONTRACT", message: "そのコントラクトは練習環境にありません" };
    }

    let valueRaw: bigint;
    let valueDisplay: string;
    switch (functionName) {
      case "isClaimed":
        // この疑似モデルは現在の1ユーザーについて請求状態を持つ。
        return this.recordStringRead(functionName, contract, args,
          (args["account"] ?? "").toLowerCase() === this.currentUser().toLowerCase() && this.state.flags[`claimed:${contract.toLowerCase()}`] ? "true" : "false");
      case "totalAssets":
      case "convertToShares":
      case "convertToAssets":
      case "previewDeposit":
      case "previewRedeem": {
        const toShares = functionName === "convertToShares" || functionName === "previewDeposit";
        valueRaw = functionName === "totalAssets" ? this.getBalance(vault!.asset, vault!.shareToken)
          : this.convertVault(BigInt(args[toShares ? "assetsRaw" : "sharesRaw"] ?? "0"), toShares);
        valueDisplay = formatUnits(valueRaw, this.requireToken(toShares ? vault!.shareToken : vault!.asset).decimals);
        break;
      }
      case "getAmountsOut": {
        // この疑似DEXは固定ペア。配列ではなく最終受取量を数値で返す。
        const tokenIn = this.requireToken(swap!.tokenIn);
        valueRaw = swapAmountOutRaw(BigInt(args["amountInRaw"] ?? "0"), tokenIn.decimals, token.decimals,
          rateToRational(this.config.swapQuoteRate ?? this.config.swapRate ?? 1));
        valueDisplay = formatUnits(valueRaw, token.decimals);
        break;
      }
      case "name":
        // 文字列を返すRead（S-05のコントラクト情報表示用）。raw・表示とも文字列そのもの
        return this.recordStringRead(functionName, contract, args, token.name);
      case "symbol":
        return this.recordStringRead(functionName, contract, args, token.symbol);
      case "decimals":
        valueRaw = BigInt(token.decimals);
        valueDisplay = token.decimals.toString();
        break;
      case "totalSupply":
        // totalSupplyRaw は初期残高の合計で算出する（フェーズ1引き継ぎ事項。課題JSONに定義がないため）
        valueRaw = token.totalSupplyRaw;
        valueDisplay = formatUnits(valueRaw, token.decimals);
        break;
      case "balanceOf": {
        const account = args["account"] ?? "";
        valueRaw = token.balances[account] ?? 0n; // 未保有は0を返す（エラーにしない）
        valueDisplay = formatUnits(valueRaw, token.decimals);
        break;
      }
      case "allowance": {
        const owner = args["owner"] ?? "";
        const spender = args["spender"] ?? "";
        valueRaw = this.getAllowance(contract, owner, spender); // 未承認は0を返す
        valueDisplay = formatUnits(valueRaw, token.decimals);
        break;
      }
      default:
        return { ok: false, code: "UNKNOWN_FUNCTION", message: `未対応のRead関数です: ${String(functionName)}` };
    }

    const record: CallRecord = {
      id: formatId("SIM-CALL", this.state.callLog.length + 1),
      attemptId: this.state.attemptId,
      sequence: this.nextSequence(),
      type: "read",
      functionName,
      contract,
      args: { ...args },
      from: this.currentUser(),
      returnValueRaw: valueRaw.toString(),
      returnValueDisplay: valueDisplay,
      timestamp: new Date().toISOString(),
    };
    this.state.callLog.push(record);
    return { ok: true, record, valueRaw, valueDisplay };
  }

  /** 文字列を返すRead（name / symbol）用：callLogに記録し、raw・表示とも文字列を返す */
  private recordStringRead(
    functionName: ReadFunctionName,
    contract: Address,
    args: Record<string, string>,
    value: string,
  ): ReadResult {
    const record: CallRecord = {
      id: formatId("SIM-CALL", this.state.callLog.length + 1),
      attemptId: this.state.attemptId,
      sequence: this.nextSequence(),
      type: "read",
      functionName,
      contract,
      args: { ...args },
      from: this.currentUser(),
      returnValueRaw: value,
      returnValueDisplay: value,
      timestamp: new Date().toISOString(),
    };
    this.state.callLog.push(record);
    // valueRaw は数値Readとの型共通化のため 0n を返す。文字列の実値は record 側に保持する
    return { ok: true, record, valueRaw: 0n, valueDisplay: value };
  }

  // --- Write（トランザクションを1件生む） ---

  /**
   * args の数量は raw値の10進文字列で渡す（approve: { spender, amountRaw }、
   * transfer: { to, amountRaw }、transferFrom: { from, to, amountRaw }、
   * deposit: { valueRaw }（payableのwei）、withdraw: { amountRaw }、
   * swapExactUSDCForTKN: { amountInRaw, amountOutMinRaw? }）。
   * 表示値→raw値の変換と入力検証は呼び出し側（UI／validation）の責務。
   */
  write(functionName: WriteFunctionName, contract: Address, args: Record<string, string>): WriteResult {
    const gas = this.gasFor(functionName);
    const gasFeeWei = BigInt(gas.gasUsed) * BigInt(gas.gasPriceGwei) * 1_000_000_000n;
    const userAddress = this.currentUser();
    const user = this.state.accounts[userAddress];
    if (!user) throw new Error("現在の疑似アカウントが存在しません");

    // 送信前チェック：ガス代が疑似ETH残高を超える場合はブロックに含めない（設計書 2.5）
    const valueWei = functionName === "deposit" && !this.config.vault ? BigInt(args["valueRaw"] ?? "0") : 0n;
    if (user.ethBalanceWei < gasFeeWei + valueWei) {
      return { kind: "preflight-failure", code: "INSUFFICIENT_GAS", message: valueWei > 0n ? "疑似ETHが送るvalueとガス代の合計に足りないよ。valueを減らしてみよう。" : INSUFFICIENT_GAS_MESSAGE };
    }

    const plan = this.planWrite(functionName, contract, args, userAddress);

    const nonceUsed = user.nonce;
    const ethBefore = user.ethBalanceWei;
    user.ethBalanceWei = ethBefore - gasFeeWei; // ガスは成功・revertを問わず控除する
    user.nonce = nonceUsed + 1; // 包含されたトランザクションのみ+1
    this.state.blockNumber += 1; // revert時もブロックは進む

    let stateDiff: StateDiff[] = [];
    if (plan.revertCode === undefined) {
      stateDiff = plan.apply();
      stateDiff.push({
        kind: "eth",
        account: userAddress,
        beforeRaw: ethBefore.toString(),
        afterRaw: user.ethBalanceWei.toString(),
      });
    }

    const record: TxRecord = {
      id: formatId("SIM-TX", this.state.txLog.length + 1),
      pseudoHash: formatId("SIM-TX", this.state.txLog.length + 1),
      blockNumber: this.state.blockNumber,
      nonce: nonceUsed,
      attemptId: this.state.attemptId,
      sequence: this.nextSequence(),
      type: "write",
      functionName,
      contract,
      args: { ...args },
      from: userAddress,
      status: plan.revertCode === undefined ? 1 : 0,
      outcome: plan.revertCode === undefined ? "success" : "revert",
      ...(plan.revertCode !== undefined ? { revertReason: plan.revertCode } : {}),
      gasUsed: gas.gasUsed,
      gasPriceGwei: gas.gasPriceGwei,
      gasFeeWei: gasFeeWei.toString(),
      stateDiff,
      timestamp: new Date().toISOString(),
    };
    this.state.txLog.push(record);
    return { kind: record.outcome === "success" ? "success" : "revert", record };
  }

  private nextSequence(): number {
    // sequence は試行内で txLog と callLog を通した通し番号。状態は試行ごとに
    // 再生成されるため、両ログの件数合計から導出できる。
    return this.state.txLog.length + this.state.callLog.length + 1;
  }

  private gasFor(functionName: string): GasConfig {
    return this.config.gas?.[functionName] ?? DEFAULT_GAS[functionName] ?? { gasUsed: 45_000, gasPriceGwei: 20 };
  }

  /**
   * Write の事前検査と、成功時に適用する状態変更（クロージャ）を返す。
   * revert の場合は revertCode を返し、状態変更は一切行わない（巻き戻し範囲の扱いは設計書 2.5）。
   */
  private planWrite(
    functionName: WriteFunctionName,
    contract: Address,
    args: Record<string, string>,
    userAddress: Address,
  ): { revertCode?: RevertCode; apply: () => StateDiff[] } {
    const ok = (apply: () => StateDiff[]) => ({ apply });
    const revert = (revertCode: RevertCode) => ({ revertCode, apply: () => [] as StateDiff[] });

    switch (functionName) {
      case "claim": {
        const drop = this.config.airdrop;
        if (!drop || contract !== drop.distributor) throw new Error("この課題・契約ではclaimは使えません");
        const key = `claimed:${drop.distributor.toLowerCase()}`;
        if (this.state.flags[key]) return revert("ALREADY_CLAIMED");
        const amount = BigInt(args["amountRaw"] ?? "0");
        let proof: unknown;
        try { proof = JSON.parse(args["proof"] ?? "[]"); } catch { return revert("INVALID_PROOF"); }
        if (!Array.isArray(proof) || !proof.every(p => typeof p === "string") || !verifyProof(userAddress, amount, proof, drop.root)) return revert("INVALID_PROOF");
        const balance = this.getBalance(drop.token, drop.distributor);
        if (balance < amount) return revert("INSUFFICIENT_BALANCE");
        return ok(() => {
          const before = this.getBalance(drop.token, userAddress);
          this.requireToken(drop.token).balances[drop.distributor] = balance - amount;
          this.requireToken(drop.token).balances[userAddress] = before + amount;
          this.state.flags[key] = true;
          return [
            { kind: "balance", token: drop.token, account: drop.distributor, beforeRaw: balance.toString(), afterRaw: (balance - amount).toString() },
            { kind: "balance", token: drop.token, account: userAddress, beforeRaw: before.toString(), afterRaw: (before + amount).toString() },
          ];
        });
      }
      case "redeem":
      case "deposit":
        if (this.config.vault) {
          const vault = this.config.vault;
          if (contract !== vault.shareToken) throw new Error("ボールトのコントラクトを指定してください");
          const depositing = functionName === "deposit";
          const amount = BigInt(args[depositing ? "assetsRaw" : "sharesRaw"] ?? "0");
          const converted = this.convertVault(amount, depositing);
          const assets = depositing ? amount : converted;
          const shares = depositing ? converted : amount;
          const share = this.requireToken(vault.shareToken);
          if (this.getBalance(depositing ? vault.asset : vault.shareToken, userAddress) < amount ||
              (!depositing && this.getBalance(vault.asset, vault.shareToken) < assets)) return revert("INSUFFICIENT_BALANCE");
          return ok(() => {
            const delta = depositing ? 1n : -1n;
            const changes: [Address, Address, bigint][] = [[vault.asset, userAddress, -assets * delta], [vault.asset, vault.shareToken, assets * delta], [vault.shareToken, userAddress, shares * delta]];
            const diffs = changes.map(([token, account, change]) => {
              const before = this.getBalance(token, account);
              this.requireToken(token).balances[account] = before + change;
              return { kind: "balance" as const, token, account, beforeRaw: before.toString(), afterRaw: (before + change).toString() };
            });
            share.totalSupplyRaw += shares * delta;
            return diffs;
          });
        }
        if (functionName === "redeem") throw new Error("この課題ではredeemは使えません");
        // WETHのpayable depositは既存のまま。
      case "withdraw": {
        const token = this.requireToken(contract);
        const user = this.state.accounts[userAddress]!;
        const amount = BigInt(args[functionName === "deposit" ? "valueRaw" : "amountRaw"] ?? "0");
        const balance = token.balances[userAddress] ?? 0n;
        if (functionName === "withdraw" && balance < amount) return revert("INSUFFICIENT_BALANCE");
        return ok(() => {
          const delta = functionName === "deposit" ? amount : -amount;
          token.balances[userAddress] = balance + delta;
          token.totalSupplyRaw += delta;
          user.ethBalanceWei -= delta; // ガス控除後に1 wei = 1 raw WETHを交換
          return [{ kind: "balance", token: contract, account: userAddress, beforeRaw: balance.toString(), afterRaw: (balance + delta).toString() }];
        });
      }
      case "approve": {
        this.requireToken(contract);
        const spender = args["spender"] ?? "";
        const amount = BigInt(args["amountRaw"] ?? "0");
        if (spender === ZERO_ADDRESS) return revert("ZERO_ADDRESS_SPENDER");
        return ok(() => {
          const key = allowanceKey(userAddress, spender, contract);
          const before = this.state.allowances[key] ?? 0n;
          this.state.allowances[key] = amount; // approveは上書き（加算ではない）
          return [
            {
              kind: "allowance",
              token: contract,
              spender,
              beforeRaw: before.toString(),
              afterRaw: amount.toString(),
            },
          ];
        });
      }
      case "transfer": {
        const token = this.requireToken(contract);
        const to = args["to"] ?? "";
        const amount = BigInt(args["amountRaw"] ?? "0");
        if (to === ZERO_ADDRESS) return revert("ZERO_ADDRESS_RECIPIENT");
        const balance = token.balances[userAddress] ?? 0n;
        if (balance < amount) return revert("INSUFFICIENT_BALANCE");
        return ok(() => {
          // amount=0 の場合は残高変化なしで成功する（標準ERC-20の挙動。設計書 2.5）
          const diffs: StateDiff[] = [];
          if (amount > 0n) {
            const toBefore = token.balances[to] ?? 0n;
            token.balances[userAddress] = balance - amount;
            token.balances[to] = toBefore + amount;
            diffs.push(
              {
                kind: "balance",
                token: contract,
                account: userAddress,
                beforeRaw: balance.toString(),
                afterRaw: (balance - amount).toString(),
              },
              {
                kind: "balance",
                token: contract,
                account: to,
                beforeRaw: toBefore.toString(),
                afterRaw: (toBefore + amount).toString(),
              },
            );
          }
          return diffs;
        });
      }
      case "transferFrom": {
        const token = this.requireToken(contract);
        const from = args["from"] ?? "";
        const to = args["to"] ?? "";
        const amount = BigInt(args["amountRaw"] ?? "0");
        const allowance = this.getAllowance(contract, from, userAddress);
        if (allowance < amount) return revert("INSUFFICIENT_ALLOWANCE");
        if (to === ZERO_ADDRESS) return revert("ZERO_ADDRESS_RECIPIENT");
        const balance = token.balances[from] ?? 0n;
        if (balance < amount) return revert("INSUFFICIENT_BALANCE");
        return ok(() => {
          const diffs: StateDiff[] = [];
          if (amount > 0n && from !== to) {
            const recipient = token.balances[to] ?? 0n;
            token.balances[from] = balance - amount;
            token.balances[to] = recipient + amount;
            diffs.push(
              { kind: "balance", token: contract, account: from, beforeRaw: balance.toString(), afterRaw: (balance - amount).toString() },
              { kind: "balance", token: contract, account: to, beforeRaw: recipient.toString(), afterRaw: (recipient + amount).toString() },
            );
          }
          if (allowance !== MAX_UINT256 && amount > 0n) {
            this.state.allowances[allowanceKey(from, userAddress, contract)] = allowance - amount;
            diffs.push({ kind: "allowance", token: contract, spender: userAddress, beforeRaw: allowance.toString(), afterRaw: (allowance - amount).toString() });
          }
          return diffs;
        });
      }
      case "swapExactUSDCForTKN": {
        const swap = this.config.swap;
        if (!swap) throw new Error("この課題では swap は使えません（swap設定がありません）");
        const tokenIn = this.requireToken(swap.tokenIn);
        const tokenOut = this.requireToken(swap.tokenOut);
        const amountIn = BigInt(args["amountInRaw"] ?? "0");
        // 検査順は transferFrom の実挙動に合わせ、allowance → 残高 の順とする
        const allowance = this.getAllowance(swap.tokenIn, userAddress, swap.dexAddress);
        if (allowance < amountIn) return revert("INSUFFICIENT_ALLOWANCE");
        const balanceIn = tokenIn.balances[userAddress] ?? 0n;
        if (balanceIn < amountIn) return revert("INSUFFICIENT_BALANCE");
        const amountOut = swapAmountOutRaw(amountIn, tokenIn.decimals, tokenOut.decimals, this.swapRateRational);
        const amountOutMin = BigInt(args["amountOutMinRaw"] ?? "0"); // 既存課題の省略は従来どおり
        if (amountOut < amountOutMin) return revert("INSUFFICIENT_OUTPUT_AMOUNT");
        return ok(() => {
          const diffs: StateDiff[] = [];
          const balanceOutBefore = tokenOut.balances[userAddress] ?? 0n;
          tokenIn.balances[userAddress] = balanceIn - amountIn;
          tokenOut.balances[userAddress] = balanceOutBefore + amountOut;
          diffs.push(
            {
              kind: "balance",
              token: swap.tokenIn,
              account: userAddress,
              beforeRaw: balanceIn.toString(),
              afterRaw: (balanceIn - amountIn).toString(),
            },
            {
              kind: "balance",
              token: swap.tokenOut,
              account: userAddress,
              beforeRaw: balanceOutBefore.toString(),
              afterRaw: (balanceOutBefore + amountOut).toString(),
            },
          );
          // allowanceの消費。ただし無制限allowance（maxUint256）の場合は減算しない（設計書 2.4）
          if (allowance !== MAX_UINT256 && allowance > 0n) {
            const key = allowanceKey(userAddress, swap.dexAddress, swap.tokenIn);
            this.state.allowances[key] = allowance - amountIn;
            diffs.push({
              kind: "allowance",
              token: swap.tokenIn,
              spender: swap.dexAddress,
              beforeRaw: allowance.toString(),
              afterRaw: (allowance - amountIn).toString(),
            });
          }
          return diffs;
        });
      }
      default:
        throw new Error(`未対応のWrite関数です: ${String(functionName)}`);
    }
  }

  /** 現在の資産残高と発行済みシェアから換算。空ボールトはdecimalsに合わせ1:1で開始。 */
  convertVault(amount: bigint, toShares: boolean): bigint {
    const vault = this.config.vault;
    if (!vault) throw new Error("この課題ではボールトは使えません");
    const asset = this.requireToken(vault.asset), share = this.requireToken(vault.shareToken);
    const assets = this.getBalance(vault.asset, vault.shareToken), shares = share.totalSupplyRaw;
    if (assets === 0n || shares === 0n) return toShares
      ? amount * 10n ** BigInt(share.decimals) / 10n ** BigInt(asset.decimals)
      : amount * 10n ** BigInt(asset.decimals) / 10n ** BigInt(share.decimals);
    return toShares ? amount * shares / assets : amount * assets / shares;
  }

  private requireToken(contract: Address) {
    const token = this.state.tokens[contract];
    if (!token) throw new Error(`未知のコントラクトです: ${contract}`);
    return token;
  }
}
