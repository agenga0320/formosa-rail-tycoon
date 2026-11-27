# 🚂 寶島鐵道大亨

搭火車環島、買下全台名產，成為台灣第一的鐵道大亨！

一款以台灣鐵路為舞台的原創大富翁類桌遊網頁遊戲，支援 1～4 人同機輪流遊玩或與電腦對戰。

## 玩法

- 開局時出發順序隨機，每位玩家從不同的本島車站出發
- 擲骰子沿鐵路前進，第一個抵達 🚩 目的地的人可以拿到獎金
- 停在車站可以購買在地物件，每年 12 月決算收益；買下同一站全部物件即可「獨佔」，收益加倍
- 藍色格拿錢、紅色格扣錢、黃色格抽卡片
- ✈️ 在台北、桃園、台中、高雄、花蓮、台東車站開始回合時，可購票飛往其他機場，取代擲骰；抵達後照常購物與領取目的地獎勵。票價為基本 1500 萬＋鐵路每格 80 萬，向上取整至百萬；飛行不觸發沿途格子，也不會甩掉衰尾道人
- 🚢 在基隆、蘇澳、花蓮、台中、高雄港口車站開始回合時，可付費搭船到其他港口，取代擲骰；路過不能搭船。搭船後下一回合暫停一次，再下回合恢復行動。船票為基本 800 萬＋鐵路每格 40 萬，向上取整至百萬。抵達後照常購物與領取目的地獎勵，不觸發沿途格子，也不會甩掉衰尾道人
- 🏝️ 新增澎湖、金門、馬祖、綠島、蘭嶼、小琉球分區地圖，每島只有一站，可購物與成為目的地，不能擲骰移動；「留島經營」每回合領取 500 萬，搭船後暫停的回合不領取；從「離島地圖」查看各島。離島須沿指定航線購票進出，小琉球僅船運。城市車站合併機場／港口接駁；[交通來源與遊戲映射](docs/island-transport.md)
- 🏦 負債時逐項選擇物件，以原價一半變賣還債；還清即停止，售出物件重新開放購買。電腦／斷線代打自動選擇，無物件可賣則保留剩餘負債
- 🤝 收購卡可從卡片格抽得或在商店以 2000 萬購買；擲骰前，以原價 2 倍收購目前車站的一項對手物件，款項交給原持有人
- 小心 🌧️ 衰尾道人！碰到其他玩家就能把它甩掉
- 遊戲年數結束時，總資產最多的人獲勝

## 線上對戰

1. 房主在開始畫面選「🌐 線上對戰」→「建立房間」，會得到 4 碼房間代碼
2. 朋友打開遊戲（或房主分享的連結），輸入名字與代碼加入
3. 人數不夠可以加入電腦玩家，房主按「開始遊戲」

遊戲在 Cloudflare 的伺服器上執行，每個房間一個 Durable Object（`worker/index.js`）。每個人的瀏覽器只負責顯示和回答自己的操作，所以任何人（包括房主）離開都不會中斷遊戲：
- 斷線的玩家由電腦代打，自動重連或用同樣名字重新加入就能接手
- 每回合開始時存檔到伺服器；伺服器重新啟動（例如更新版本）後，從那一回合開頭繼續
- 所有人都離開 1 分鐘後遊戲暫停，24 小時內有人用原本的名字回來就繼續

伺服器跑的是同一份 `js/game.js`：`tools/build-engine.mjs` 把 `js/data.js`、`js/game.js` 和 `server/`（伺服器版的畫面替身與房間邏輯）包成 `.build/engine.mjs`，部署時自動執行。

遊戲網址：https://formosa-rail-tycoon.formosa-rail-tycoon.workers.dev
（GitHub Pages 版和 Android App 也會連到這台伺服器，網址設定在 `js/net.js` 的 `ROOM_SERVER`。）

## 部署到 Cloudflare

```bash
npm install
npx wrangler login     # 第一次需要
npm test               # 包含整場線上遊戲在伺服器上跑完的測試
npm run deploy         # 網頁和遊戲伺服器一起上傳（不上傳的檔案列在 .assetsignore）
```

## 本機執行

純 HTML / CSS / JavaScript，不需要建置。要連同線上對戰一起測試：

```bash
npm install
npm run dev
```

然後打開 http://localhost:8787（只測單機的話，`python -m http.server 8741` 也可以）

## Android App

`android/` 是包住網頁遊戲的 WebView 外殼，建置時會把 `index.html`、`css/`、`js/` 複製進 APK，所以單機遊戲可離線玩，線上對戰仍需網路。

```bash
cd android
./gradlew assembleRelease
```

簽章金鑰放在 `android/release.jks` 與 `android/keystore.properties`（不進版控）；沒有這兩個檔案時 release 版不會簽章。

App 每次開啟或回到前景時會查 GitHub Releases 的最新版；有新版就停止遊戲，必須下載安裝後才能繼續（離線時無法檢查，可照常單機遊玩）。發佈新版：

1. 在 `android/app/build.gradle.kts` 提高 `versionCode` 與 `versionName`
2. 建置後 commit、push
3. 建立 tag 為 `v{versionName}` 的 Release，附上 `FormosaRailTycoon-v{versionName}-release.apk`（檔名不能改，App 只接受這個網址）

## 檔案結構

- `index.html` — 頁面
- `css/style.css` — 樣式
- `js/data.js` — 車站、路線、物件、卡片資料
- `js/game.js` — 遊戲引擎與介面
- `js/net.js` — 線上對戰（瀏覽器端）
- `worker/index.js` — Cloudflare 遊戲伺服器（每個房間一個 Durable Object）
- `server/` — 伺服器版的畫面替身與房間邏輯
- `tools/build-engine.mjs` — 把遊戲包成伺服器模組
- `wrangler.jsonc` — Cloudflare 部署設定
