# ArenAI 適用性初查

2026-11-08，以 GitHub connector 讀取原始碼。檢視 main 指向 commit `de51aee3c4edad3105eda96bc9aeb1debc84e9ab`（提交時間 2026-04-03）。本次為靜態審查，未 clone、安裝、執行或驗證所有遊戲；不能宣稱已通過可執行性驗收。

結論：建議自行建立 Minority Pact 核心；ArenAI 作為結構與介面參考。已有 Vue、SSE、SQLite 可參考，但本案最關鍵的同步公平、資料權限與忠實存檔仍需專門設計。此為工程建議，不是使用者已確認採用方案。

| 原始碼 | 觀察 | 本案決策 |
|---|---|---|
| core/game-runner.js | 依 phase.execute 執行；onEvent 直接向外送；game_start 帶 role/party/team/word；錯誤 forceEnd | 不直接沿用。另寫公平 barrier、時鐘與狀態機，錯誤不當遊戲輸贏 |
| core/session-manager.js | 以 gameId/playerKey 保存各玩家 messages；可 getGameSessions 取全部 | 可參考每席獨立上下文；另加授權 projection、snapshot 與持久化 |
| server/index.js | SSE 發送緩衝事件；/games/:id/sessions 回傳 live sessions | 不直接沿用觀戰 API；本案不能讓觀戰者讀執行中的全部 prompt |
| server/db.js | SQLite games/game_logs，保存 SSE events 或 game.log、session_stats | 可參考資料庫接線；另做逐批 transaction、冪等、append-only 及恢復 |
| client/src/composables/useGameSSE.js | EventSource 驅動事件陣列及畫面狀態 | 可參考；另做安全 DTO、cursor 補送、去重與重播 |
| package.json / LICENSE | Node ESM、Express、SQLite；MIT 文字 | 不整包引入依賴；若日後複製程式片段，保留相應授權與出處 |

未認定「有事件列表」即具備符合本案的上帝回播，也未認定「每玩家獨立 messages」已等於完整秘密隔離。尚未審查 llm-client.js 的 provider 相容性、各遊戲 prompt 與所有前端元件，不列為已驗證可沿用模組。

原始碼證據（固定版本）：

- [runner](https://github.com/plduhoux/arenai/blob/de51aee3c4edad3105eda96bc9aeb1debc84e9ab/core/game-runner.js)
- [session manager](https://github.com/plduhoux/arenai/blob/de51aee3c4edad3105eda96bc9aeb1debc84e9ab/core/session-manager.js)
- [server](https://github.com/plduhoux/arenai/blob/de51aee3c4edad3105eda96bc9aeb1debc84e9ab/server/index.js)
- [database](https://github.com/plduhoux/arenai/blob/de51aee3c4edad3105eda96bc9aeb1debc84e9ab/server/db.js)
- [SSE client](https://github.com/plduhoux/arenai/blob/de51aee3c4edad3105eda96bc9aeb1debc84e9ab/client/src/composables/useGameSSE.js)
- [package](https://github.com/plduhoux/arenai/blob/de51aee3c4edad3105eda96bc9aeb1debc84e9ab/package.json)／[license](https://github.com/plduhoux/arenai/blob/de51aee3c4edad3105eda96bc9aeb1debc84e9ab/LICENSE)

不為規劃額外深入其他五個候選 repo；只有具體模組遇到問題才定向研究，避免研究與搬遷成本大於新寫小型核心。
