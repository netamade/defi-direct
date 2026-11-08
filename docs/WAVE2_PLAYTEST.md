# Wave 2 実プレイ確認

`npm test`、`npm run build` を実行後、`npm run dev` のURLを開く。
新しいブラウザプロファイル（進捗なし）で課題一覧から各カードの「挑戦する」を選ぶ。
Write は毎回、数量換算・状態変化・ガス代のプレビューを読んで「送信する（疑似）」を押す。

## 課題11（E2、200 XP）

1. Read の `allowance` で owner＝練習用スペンダー（友人）、spender＝あなたを選び、100 USDCを確認。
2. Write の `transferFrom` で from＝友人、to＝あなた、amount＝101。`INSUFFICIENT_ALLOWANCE` を確認。
3. 同じ宛先で amount＝80。`INSUFFICIENT_BALANCE` を確認。
4. amount＝20で成功。友人40 USDC、あなた20 USDCになる。
5. Read の `allowance` を同じ指定で再実行し、80 USDCを確認。QUEST CLEARと+200 XPを確認。
   `balanceOf` で両者の残高も確認できる。

友人があなたにapprove済みの状態から開始する。現在の送信者は常にあなたで、fromの友人になりすます仕組みは使わない。

## 課題10（E1、200 XP）

1. Read の `balanceOf` であなたのWETH＝0を確認。
2. Write の `deposit()` の **value** 欄に0.1を入力。valueは関数引数ではなく送るETH。
3. Read の `balanceOf` で0.1 WETHを確認。
4. Write の `withdraw` の amount＝0.04を送信。
5. Read の `balanceOf` で0.06 WETHを確認。QUEST CLEARと+200 XPを確認。

ETH残高は0.93874 ETH（1 − 0.1 ＋ 0.04 − ガス0.00126）。
value＝1でdepositを試すとガスとの合計が不足し未包含になる。
WETH残高を超えるwithdrawは `INSUFFICIENT_BALANCE` となりガス代だけを消費する。

## 課題12（E3、250 XP）

1. Read の `getAmountsOut` に amountIn＝20。20 TKN（raw 20000000000000000000）を確認。
2. Write の `approve` で対象USDC、spender＝DEX、amount＝20。
3. `swapExactUSDCForTKN` に amountIn＝20、amountOutMin＝20。
   確認モーダルのrevert予測を読み送信。`INSUFFICIENT_OUTPUT_AMOUNT` を確認。
   USDC・TKN・allowanceは変わらず、ガスだけを消費する。
4. amountIn＝20、amountOutMin＝19で再送し成功。
   amountInはUSDCの6桁、amountOutMinはTKNの18桁でraw換算される。
5. Read の対象をTKNに切り替え、`balanceOf` であなたの19 TKNを確認。
   QUEST CLEARと+250 XPを確認。

この疑似DEXは固定ペアで、getAmountsOutは配列ではなく最終受取量を数値で返す。
課題12だけ参考レート1・実行レート0.95を明示しており、見積もりが約定を保証しないことを学ぶ。
レートは固定で、時刻や乱数によって変動しない。最低受取量を省略する既存課題は従来どおり動く。

## 保存と再挑戦

3課題を終えるとダッシュボードに **650 XP / 3課題クリア（全12課題）** が表示される。
リロード後も保持され、リセットして再クリアしてもXPは重複しない。
全12課題のXP上限は2050。レベル閾値は変更していない。

## 確認結果

Chromium + Playwrightでカード→実技→確認モーダル→採点→XP加算を3課題とも実行。
課題11の2種類のrevert、課題12の異なるdecimalsの複数入力と保護revert、
リロード後の650 XP・3/12クリア表示を確認。ブラウザの実行時エラーなし。
