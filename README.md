# Minority Pact

目前實作 T1/T2 核心及 T3 SQLite 儲存、權限投影與重播服務。需要 Node.js 24 以上。

```powershell
npm.cmd install
npm.cmd run typecheck
npm.cmd test
```

Node 原生執行 TypeScript 測試，不需測試框架或 API key。TypeScript 靜態檢查仍需安裝 devDependencies。

`configs/experimental.json` 是實驗範本；`llm.model` 留空，必須自行填入 OpenRouter 模型 ID 才能通過設定驗證。五席共用 `llm`，不支援個別模型覆寫。API key 日後從 `OPENROUTER_API_KEY` 讀取（見 `.env.example`）；目前沒有 LLM 呼叫或自動載入 `.env` 的執行器。

`parseConfig(unknown)` 與 `parseDecision(unknown)` 是 runtime 驗證入口。規則引擎接收已驗證設定；`resolveBatch` 只接當下到期行動，未來 action、批次 ID 冪等與快照由 T3/T4 負責。回傳事件以 `reduce` 套用到新狀態；輸入不被修改。reveal 後以空批次推進下一回合或終局，便於後續觀戰呈現揭曉階段。

`src/contracts/public.ts` 為公開 DTO；`DecisionInput` 是僅可交給對應 controller 的授權資料；`src/domain/engine.ts` 與 `application/ports.ts` 的內部事件含秘密，不得直接序列化對外。對外事件讀取走 `ReplayService`，以可信身分產生投影；`projectEvent` 為內部工具，不能直接由 HTTP 參數開啟全知。SQLite 使用 Node 內建 `node:sqlite`，已在本機 Node 24.22.1 驗證。

規則、時間與政策細節見 `ARCHITECTURE.md`；後續任務見 `IMPLEMENTATION_PLAN.md`，實際驗證狀態見 `docs/PROGRESS.md`。
