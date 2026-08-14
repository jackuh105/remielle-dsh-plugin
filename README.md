# remielle-dsh

小蕾米（Remielle）桌寵的 DeepSeek Harness plugin 移植版：把桌面寵物變成 DSH 插件，直接監聽 DSH 的 session 事件流，即時驅動寵物動作。

> 本插件是 [jackuh105/Remielle](https://github.com/jackuh105/Remielle)（二次開發自 [HanaAyane/remielle-codex-pet](https://github.com/HanaAyane/remielle-codex-pet)）的 DSH 移植。
> 素材版權與使用限制見 [NOTICE.md](./NOTICE.md) 與 [ASSET-USAGE.md](./ASSET-USAGE.md)。

## 功能

- **浮動桌寵**：透明 GIF 動畫、拖曳（位置記憶於 localStorage）、點擊表演慶祝
- **Harness 整合**：監聽 DSH session 事件流，即時切換動作：

  | DSH 事件 | 動作 |
  |---|---|
  | `turn/start`、`step/start`、`tool/call` | 工作中 |
  | `turn/end (completed)` | 慶祝 |
  | `turn/end (error)` | 失敗 |
  | `approval/asked`、`turn/end (blocked)` | 等待確認 |
  | 工作結束後 | 期待 →（超時後）鋼筆待機 |

- **待機行為**：行動間隔隨機（2~6 秒可調）、彩蛋表演（40% 機率可調、8 動作池、可連續）、自由移動（視窗內走動、邊緣反彈）
- **右鍵選單**：表演動作（8 種）、自由移動開關、隱藏/顯示
- **設定卡片**：DSH Settings → Plugins 區的「Remielle 桌寵」卡片（可折疊），即時生效

## 架構

```
session/event ──▶ server 端 session projection ──▶ browser subscribe ──▶ 動作對映 ──▶ GIF/PNG
                 （事件 → phase 狀態機）             （ObservableSnapshot）
```

- **server 端**（`lib/index.js`）：`remielle` session projection（純函式狀態機：`working / waiting / celebrate / failed / idle`）+ 素材 HTTP route（`/plugins/remielle-dsh/assets/`）
- **client 端**（`lib/client.js`）：命令式 DOM 寵物 widget（掛在 `document.body`）+ React 設定卡片（`settings.plugin.item` slot）
- 期待超時、彩蛋節奏等時間性行為在瀏覽器端執行；事件事實由 server 投影提供

## 安裝

本插件以 **DSH bundle 包**形式安裝到 profile：

1. 將插件裝入 web profile：

   ```bash
   dsh plugin --profile web add /path/to/remielle-dsh-plugin
   ```

   （或在 profile 目錄直接 `pnpm add -w file:/path/to/remielle-dsh-plugin`）

2. 在 profile 的 `package.json` 的 `dsh.profile.bundles` 中加入 `"remielle-dsh"`（建議放在 `@deepseek-ai/dsh-web-app` 之前）。

3. 重啟 `dsh web`（plugin 集合變更需要重啟生效）。

4. 開發時注意：
   - pnpm 對 `file:` 依賴是複製快照，每次改插件原始碼後需在 profile 目錄重新 `pnpm install`；
   - 套件的 `exports` 必須包含 `"./package.json"`（DSH 掃描 `dsh.client` 宣告時需要）。

## 設定

| 設定 | 預設 | 說明 |
|---|---|---|
| 顯示小蕾米 | 開 | 顯示/隱藏寵物 |
| Harness 動畫回應 | 開 | 是否回應 DSH 事件切換動作 |
| 期待超時（秒） | 300 | 工作結束後「期待」動畫的持續時間 |
| 行動間隔最短/最長（秒） | 2 / 6 | 待機時兩次隨機行動的間隔範圍 |
| 彩蛋機率 | 40% | 待機行動中表演彩蛋的機率 |
| 慶祝冷卻（秒） | 30 | 慶祝/失敗動作的最小間隔 |

## 素材與授權

- 插件程式碼：Apache-2.0（見 [LICENSE](./LICENSE)）
- 動畫素材（`assets/`）：基於《絕區零》公開素材，經 AI 輔助重繪與人工整理；**僅限非商業同人交流**，詳見 [NOTICE.md](./NOTICE.md) 與 [ASSET-USAGE.md](./ASSET-USAGE.md)。

素材作者：HanaAyane / 小蕾米
來源：https://github.com/HanaAyane/remielle-codex-pet

## 參考專案

- [jackuh105/Remielle](https://github.com/jackuh105/Remielle) — 本插件移植的來源（二次開發版，含 OpenCode / Codex harness 整合）
- [HanaAyane/remielle-codex-pet](https://github.com/HanaAyane/remielle-codex-pet) — 原始桌寵專案
