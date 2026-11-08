# defi-direct Wave 3 仕様 v1（課題13〜15＋レベル拡張）

- 作成：2026-11-08（クロ）。位置づけ：拡張計画 v1（files/拡張計画-課題-v1.md）の Wave 2 後半＝E4・E5・E6 の実装仕様。基本設計 v1.1 と拡張計画 v1 を前提とし、矛盾する場合は本仕様を優先する。
- 目的：全15課題の完成（現行12課題＋本Wave 3課題）。XP 合計は 2,050 → 2,850。
- 前提の現行状態：main には課題01〜12（Wave 1＋Wave 2 前半＝課題10〜12）、PR #4 の stepChecks 方式（全課題に steps と1対1の stepChecks）が入っている。本Wave の新規3課題にも stepChecks を必ず付けること。
- 実装順：E4（課題13）→ E5（課題14）→ E6（課題15）。コミットは E 単位。PR は1本にまとめ、作成まで（マージはしない）。
- 守ること：既存12課題の課題JSON・判定・XP は変更しない。既存ユーザーの localStorage 進捗記録の形式を壊さない。外部ライブラリの追加は最小限とし、追加する場合は理由を PR に書く（keccak は下記 E5 の方針に従い同梱実装を優先）。

---

## 1. 設計改訂：状態スキーマ v2

拡張計画 v1 の §2.4 のとおり、SimulationState はフェーズ1で凍結されているため、本Wave で正式に改訂する。

- `STATE_SCHEMA_VERSION` を 1 → 2 に上げる。
- SimulationState に2つのフィールドを追加する（いずれも既存の残高・allowance の仕組みには触れない）：
  - `flags: Record<string, boolean>`：汎用フラグ。キーは用途ごとに名前空間を切る（例：`claimed:<契約アドレス小文字>`）。
  - `permitNonces: Record<string, number>`：Permit の署名 nonce。キーはトークンの契約アドレス（小文字）。未設定は 0 とみなす。
- 後方互換：v1 形式の状態（または未設定）から初期化する場合は `flags = {}`、`permitNonces = {}` で補完する。課題JSON の `initialState` に任意項目 `flags` と `permitNonces` を書けるようにし、初期値の設定に使う。
- 課題JSON のスキーマ（schemaVersion）は 1 のままとする（課題データの形式は変えない。新フィールドはすべて任意項目の追加で表現する）。

## 2. 新規 revert コード

validation.ts の RevertCode に3種を追加し、メッセージと課題JSON の revertReasons で引けるようにする：

- `ALREADY_CLAIMED`：請求済みのものを再度請求した
- `INVALID_PROOF`：Merkle proof がルートと一致しない
- `INVALID_NONCE`：Permit の署名 nonce が現在の nonce と一致しない

（`INSUFFICIENT_OUTPUT_AMOUNT` は Wave 2 の E3 で追加済みの前提。未追加なら本Wave で先に追加すること。）

---

## 3. E4／課題13「ERC-4626ボールト入門」（第16章／本の課題16-1）XP 250

### 設計方針（状態追加なし）
- 株（share）はシェアトークンという別コントラクトの残高として表現する。ボールトの総資産＝ボールト契約が持つ資産トークンの残高、総株数＝シェアトークンの totalSupply（既存実装は初期残高の合計から算出）として、換算は常に現在の残高から計算する。新しい状態フィールドは使わない。
- 換算式（実 ERC-4626 に倣い切り捨て）：
  - convertToShares(assets) = assets × totalShares ÷ totalAssets
  - convertToAssets(shares) = shares × totalAssets ÷ totalShares
  - deposit(assets)：ユーザー→ボールトへ assets を移し、上式の shares をユーザーへ発行（シェア残高を加算）
  - redeem(shares)：ユーザーの shares を消却し、上式の assets をボールト→ユーザーへ移す
- 課題JSON に任意項目 `vault: { asset: <資産コントラクトのアドレス>, shareToken: <シェアコントラクトのアドレス> }` を追加し、deposit／redeem／preview 系はこの指定がある課題でのみ有効にする。

### 追加する関数
- Read：`totalAssets()`（ボールトの資産残高）、`convertToShares(uint256)`、`convertToAssets(uint256)`、`previewDeposit(uint256)`（= convertToShares と同値）、`previewRedeem(uint256)`（= convertToAssets と同値）
- Write：`deposit(uint256 assets)`、`redeem(uint256 shares)`
  - revert：残高不足は既存 `INSUFFICIENT_BALANCE` を使う（deposit は資産残高、redeem はシェア残高）。
  - ガス目安：deposit／redeem ともに 120,000（課題JSON の gas で指定）。
- UI：Read 一覧と Write 一覧に上記を追加（vault 指定のある課題でのみ表示）。session.previewWrite の分岐に deposit／redeem を追加。送信確認モーダルの予測変化に、資産と株の両方の増減を表示する。

### 課題13の内容
- 舞台：資産＝USDC（decimals 6）、ボールト＝疑似ボールト契約、シェアトークン＝vUSDC。
- 初期状態：ボールトに USDC 10,500（他の預金者分）、他の預金者のアドレスに vUSDC 10,000（＝1株 1.05 USDC の運用益が出ている状態）。ユーザーの USDC は 2,000。
- 流れ（steps／stepChecks はこの順序で作る）：
  1. 自分の USDC 残高を balanceOf で確認
  2. totalAssets とシェアの totalSupply を読む
  3. convertToShares で 1,050 USDC が何株になるか読む（→ 1,000 株）
  4. deposit(1,050 USDC)
  5. 自分の vUSDC 残高を確認（1,000）
  6. previewRedeem で 1,000 株の戻り額を読む（→ 1,050 USDC）
  7. redeem(1,000 株)
  8. USDC 残高が 2,000 に戻ったことを確認
- クイズ（choice）：「預けた額と同額が戻ったのに株が 1,000 だったのはなぜか」— 1株の値段が 1.05 USDC だから、を正解とする趣旨で作る。
- 判定：actionSequence（上記の順序と数量）＋ balanceEquals（最終 USDC 2,000／vUSDC 0）＋ quizCorrect。
- 範囲外（やらない）：時刻を進める仕組み、利回りの発生イベント、withdraw／emergencyWithdraw、クールダウン（本の 16-2・16-3 は紙面の演習のまま）。

---

## 4. E5／課題14「Merkleエアドロップを請求する」（第22章／本の課題22-1）XP 250

### 設計方針（本の第22章の計算値と完全一致させる）
- ハッシュは **Keccak-256**。リーフ＝keccak256(abi.encodePacked(address, uint256 amount))（アドレス20バイト＋数量32バイト・ビッグエンディアン）。内部ノードは2つの子をバイト列の小さい順に並べて keccak256（OpenZeppelin MerkleProof 方式）。
- 正本データは `files/参照-Merkle計算値-第22章.md`（クロが 2026-11-05 にテストベクトルで検証済み）。配布リスト・ルート・proof はその値をそのまま使う：
  - A 0x1111111111111111111111111111111111111111：100（raw 100,000,000）
  - B 0x2222222222222222222222222222222222222222：250（raw 250,000,000）
  - C 0x3333333333333333333333333333333333333333：75（raw 75,000,000）
  - D 0x4444444444444444444444444444444444444444：500（raw 500,000,000）
  - Merkle root：0xba6e7cc2629ce6911cf1e06337a7a4ed024d02d87508cb223cbc875a1beffc54
  - C の proof：[0x70abacda97f1a3255e287fb4d34bc282953408c8635f75cd9f4d68defc498b57（leaf D）, 0x4c0e3b6731a0177b5c4e4ecbddf93f958476bd2f4958afb8e2d855984d869160（node AB）]
  - A の proof：[0x526cad0af1dda06f7f5688e7b654b6d6395cb3904c818c16bb7b53fac7d1b881（leaf B）, 0x7672f629b84ea7636bb85953a21640b26992fd0e41acddae02111ec9f3d59c07（node CD）]
- keccak256 の実装：外部の重い依存は避け、小規模な純 TypeScript 実装を同梱する。**必須テスト**：空文字列の keccak256 = 0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470、上記 leaf A〜D・node AB・node CD・root の再計算が参照値と一致すること、A と C の proof 検証が通ること。

### 追加する仕組み
- 状態：請求済みは `flags` の `claimed:<ディストリビュータのアドレス>` で持つ（状態 v2 を使用）。
- Read：`isClaimed(address)`（flags を読む）。
- Write：`claim(uint256 amount, bytes32[] proof)`
  - 検証順：請求済みなら `ALREADY_CLAIMED` → proof を検証し不一致なら `INVALID_PROOF` → 成功時はディストリビュータ→ユーザーへ amount を移し、claimed フラグを立てる。
  - 課題JSON に任意項目 `airdrop: { distributor: <契約アドレス>, token: <トークンのアドレス>, root: <Merkle root> }` を追加し、この指定がある課題でのみ有効にする。検証は「送信者のアドレスと amount」からリーフを作って行う（＝他人の割当は請求できない）。
- UI：Write の入力に **bytes32[] 型**を追加する（改行区切りのテキストエリア。0x の有無や空白は吸収する）。session.previewWrite と送信確認モーダルに claim の分岐を追加（成功時の予測：トークン +amount／失敗として proof 不一致の注意書き）。

### 課題14の内容
- 舞台：配布トークン＝AIR（decimals 6 の疑似トークン）。ディストリビュータ契約が総配布量 925 AIR を保持。**ユーザーのアドレスは C（0x3333…）とし、割当は 75 AIR**（initialState.userAddress を C に設定する）。
- 課題文に配布リストの表（A〜D のアドレスと数量）と、各人の proof の入手先として「公開リスト」の体裁で A と C の proof を提示する（C の proof が正解。A の proof は誤り体験用に使う）。
- 流れ：
  1. 自分の AIR 残高を確認（0）
  2. isClaimed（自分）を読む（false）
  3. A の proof で claim(75) を試し、`INVALID_PROOF` の revert を体験する
  4. C の proof で claim(75) を実行し成功
  5. AIR 残高を確認（75）
  6. isClaimed（自分）を読む（true）
  7. もう一度 claim(75) を試し、`ALREADY_CLAIMED` の revert を体験する
- クイズ（choice）：「proof は誰の・いくらの請求かとセットで検証される」趣旨（他人の proof では自分の請求が通らない理由）。
- 判定：actionSequence（revert 2種の体験を含む）＋ actionFailed（INVALID_PROOF／ALREADY_CLAIMED）＋ balanceEquals（AIR 75）＋ quizCorrect。

---

## 5. E6／課題15「Permit署名：署名が承認になるとき」（第13章／本の課題13-2）XP 300

### 設計方針（オフチェーン署名の疑似モデル）
- 署名は「ガスなし・tx にならないオフチェーン行為」として、課題画面内の専用セクションで表現する。署名済みデータはセッション内の `signedPermits` リストに保持する（localStorage には保存しない）。
- 課題JSON に任意項目 `permit: { token: <トークンのアドレス> }` を追加し、この指定がある課題でのみ署名セクションと permit 関数を有効にする。
- 署名リクエストのデータ型：`{ id, owner, spender, spenderLabel, value（表示値の文字列）, nonce, deadline, origin（出所の説明文）, hostile?: boolean }`。
  - 「流出した攻撃者の署名」は課題JSON の `permit.preSigned` に定義し、最初から signedPermits に入った状態で提示する（ユーザーが署名する操作は不要）。
  - 「自分の正規の署名」は課題JSON の `permit.ownRequest` に定義し、署名セクションの「署名する」ボタンで signedPermits に追加する（ガス・nonce・ブロックは進めない。callLog にも残さない）。
- Write：`permit(uint256 value)` — UI では signedPermits から使う署名を1つ選ぶ形にする（内部的には選択した署名の owner／spender／value／nonce を使う）。
  - 検証：署名の nonce が `permitNonces[token]` と一致しない → `INVALID_NONCE` で revert。一致 → allowance(owner, spender) = value を設定し、`permitNonces[token]` を +1 する。
  - ガス目安：45,000（approve と同程度。課題JSON で指定）。
- Read：`nonces(address)`（permitNonces を読む）を追加する。通常の allowance／balanceOf は既存のまま使う。
- UI：署名セクションに各署名リクエストの内容（spender・金額・nonce・出所）をカードで表示し、署名済みかどうかを示す。送信確認モーダルに permit の分岐を追加（予測：allowance の変化と nonce の進行）。

### 課題15の内容
- 舞台：トークン＝USDC（decimals 6）。ユーザーの USDC は 500。Permit の現在の nonce は **7**（initialState.permitNonces で設定）。
- 登場する署名：
  - 流出済みの攻撃者の署名：spender＝攻撃者のアドレス、value＝無制限（maxUint256）、nonce＝7、出所＝「先月、偽のエアドロップサイトで署名してしまったもの」。
  - 自分の正規の署名（ownRequest）：spender＝疑似DEX、value＝200、nonce＝7、出所＝「今回の swap のために自分で作る署名」。
- 流れ：
  1. nonces（自分）を読む（7）
  2. allowance（自分, 攻撃者）を読む（0）
  3. 署名セクションで正規の署名リクエストに署名する
  4. permit を実行する（正規の署名を選択）→ allowance（自分, DEX）= 200、nonce が 8 になる
  5. nonces（自分）を読み直す（8）
  6. 攻撃者の流出署名で permit を実行しようとし、`INVALID_NONCE` の revert を体験する（＝流出署名の無効化に成功）
  7. allowance（自分, 攻撃者）が 0 のままであることを確認する
- クイズ（choice）：「なぜ攻撃者の署名が使えなくなったか」— nonce が進んだため、を正解とする趣旨。
- 判定：actionSequence（署名→permit→確認の順序を含む）＋ actionFailed（INVALID_NONCE）＋ allowanceEquals（DEX 200／攻撃者 0）＋ quizCorrect。署名したかどうかは actionSequence の対象にできる形で記録する（署名行為は callLog ではなく専用の記録に残し、判定から参照できるようにする）。
- 範囲外：Permit2、EIP-712 の危険判定クイズ（本の 13-1・13-3 は紙面の演習のまま）、deadline 切れの体験（deadline は署名データの表示項目としてのみ扱う）。

---

## 6. レベル閾値の見直し（案として PR に含める）

現行 levels.ts は L5（700 XP）が上限で、総 XP 2,850 に対して不足する。既存の L1〜L5 は変更せず、後ろに3段階を追加する案：

| レベル | 名称 | minXp |
|---|---|---|
| 6 | ボールト使い | 1,200 |
| 7 | 署名の番人 | 1,900 |
| 8 | 直コンマスター | 2,600 |

名称と数値は案であり、最終判断は eguchi が行う（PR の説明に「レベル閾値は案」と明記すること）。

## 7. テストと提出の条件

- 既存テスト（現行 157 件）がすべて通ること。新規に次を追加すること：
  - E4：deposit／redeem のフローテスト（正解手順／数量違い／残高不足 revert／リセット後の再挑戦）、換算の端数（切り捨て）の単体テスト
  - E5：keccak のテストベクトル（§4 の必須テスト）、claim のフローテスト（誤 proof／正常／二重請求）
  - E6：permit のフローテスト（署名→実行→nonce 進行／流出署名の無効化／nonce 不一致 revert）
  - 状態 v2 の後方互換テスト（v1 形式からの初期化で flags／permitNonces が補完される）
- `npm run build` が成功すること。
- PR の説明に、検証結果（テスト件数と結果）とレベル閾値が案である旨を書くこと。マージはしないこと。
