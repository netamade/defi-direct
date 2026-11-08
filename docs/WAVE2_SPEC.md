# defi-direct Wave 2 仕様（課題10〜12）

対象リポジトリ: netamade/defi-direct（GitHub Pages、Vite + TypeScript）
前提資料: files の拡張計画（課題10〜12の設計）と基本設計 v1.1。現行は課題01〜09公開済み、XP合計 1,400、テスト111件。

## スコープ
- 対象は **課題10・11・12 のみ**。課題13（ERC-4626）・14（Merkle）・15（Permit）は今回対象外（別途判断）。
- 課題07の「USDT型の増額 revert」はエンジンに追加しない（決定済み）。
- 実装順は開発規模の小さい順：**E2（課題11）→ E1（課題10）→ E3（課題12）**。コミットは E 単位で分けること。

## 課題11 transferFrom：承認が使われる側を見る（第12章／本の課題12-1）— E2、XP 200、難易度3
- transferFrom(from, to, amount) の Write を実装する。revert は既存の INSUFFICIENT_ALLOWANCE／INSUFFICIENT_BALANCE を流用する。
- UI の数量引数の渡し方を一般化する（現行は approve／transfer 以外の関数名では数量が swap 用の amountInRaw として渡される決め打ち。一般化後も既存関数の挙動は変えない）。
- from には自分以外のアドレスも選べるようにする（既存のアドレス選択肢の仕組みで表現する）。
- 状態スキーマは変更しない。
- 学習内容：approve した相手が transferFrom で引き出す流れ、allowance が減ること、allowance 不足・残高不足の revert 体験。

## 課題10 はじめてのWrite：WETHのdepositとwithdraw（第7章／本の課題7-1）— E1、XP 200、難易度2
- deposit()／withdraw(uint256) の Write を実装する（疑似ETH残高 ⇄ WETH残高の移動）。
- payable の value（ETH量）の入力欄を追加し、session.previewWrite に対応する。
- 状態スキーマは変更しない（疑似ETH残高とトークン残高は既存）。
- 学習内容：ETH と WETH の等価交換、deposit が payable であること、withdraw で戻ること。

## 課題12 amountOutMinで守るswap（第15章／本の課題15-1・15-2）— E3、XP 250、難易度3
- (a) getAmountsOut の Read を実装し、explorer の Read 一覧（固定6関数）に追加する。
- (b) swap 関数に amountOutMin 引数を追加する。UI は複数の uint256 入力に対応させる（既存の単一入力の課題の挙動は変えない）。
- (c) 新規 revert コード（例：INSUFFICIENT_OUTPUT_AMOUNT）を追加する（validation.ts の RevertCode とメッセージ、課題JSON の revertReasons への記載を含む）。
- 学習内容：見積もり（getAmountsOut）と実結果の差、amountOutMin で不利な約定を revert で防ぐ体験。

## 共通の制約
- 既存課題01〜09のデータと挙動は変えない。既存テスト111件がすべて通ること。新規関数・新規 revert にはテストを追加すること。`npm test` と `npm run build` の成功を完了条件とする。
- エンジンの既知の性質（変更しない）：actionSucceeded の amountRaw は正規化される／readResultEquals は数値専用／actionSequence は部分列照合／forbiddenAction は試行内に存在する間、合格条件全体を false に固定する。
- XP 合計は 1,400 → 2,050 になる。levels.ts の閾値見直し案があれば PR の説明に案として書くこと（勝手に決めず、変える場合も既存ユーザーの表示が壊れない形に限る）。

## 完了条件
- 課題10〜12がサイトに並び、通常の学習フロー（課題カード→実技→採点→XP加算）で最後まで解ける。
- PR を作成して止める（マージしない）。完了報告には変更ファイルの一覧、E1〜E3 それぞれの実装方法、テスト結果、実プレイ確認の手順を含めること。
- 本書籍（『DeFiの裏口』）側の記述変更はこのタスクの範囲外。
