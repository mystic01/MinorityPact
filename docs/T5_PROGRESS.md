# T5 工程串接 — 2026-11-08

已完成 OpenRouterController、共同 SYSTEM_PROMPT／strict JSON schema、CLI check/start/resume、原始 provider 回應與拒絕原因私有稽核表。使用 Node fetch，無額外 SDK；model 及推理／生成資源由設定檔提供，沒有寫死參賽模型。請求 provider.require_parameters=true，未用 models fallback；回應 model 必須等於設定值，否則暫停（供應商別名尚未做顯式對照）。

API key 只讀環境／本機 .env，request audit 不含 headers，provider 原文若回顯 key 則遮蔽。稽核表 append-only，schema migration v2；原始回應含 usage、model 與 provider 回傳內容。語法合法但規則非法的結果由 coordinator 拒絕並記錄。外部訊息只作不可信遊戲資料，controller 無任何引擎／資料庫工具。

CLI 以真實時間 pace，公開輸出只用 ReplayService；DB lock 防多程序重複付費。resume 使用存檔設定及快照；強制終止可能留下 stale lock，README 有處理說明。開局前缺模型或 key 會拒絕。

驗證：`npm.cmd run typecheck` 通過；`npm.cmd test` 85 項通過。新測試：strict schema/config/model、key 不洩漏、HTTP 錯誤／非法 JSON／截斷／模型不符拒絕、abort、五席十回合 mock HTTP 完整對局與 100 份原始回應稽核。沒有真正 API 請求。

**T5 尚未達完整驗收**：configs/experimental.json 的模型仍留空，OPENROUTER_API_KEY 環境變數未設定；尚無真正五 LLM 的 10–12 回合與策略能力證據。模型的實際結構化輸出／參數相容性待填妥模型並測試。不可將 mock HTTP 結果說成真正 LLM 對局。

下一步：使用者依 README 設定 configs/local.json 與本機 key 後跑真實對局；其餘可先做 T6 即時觀戰 server/UI。T6 必須使用已授權投影與操作 token，不能直接暴露 SQLite、稽核表或用 query 自行指定 agent 身分。
