# 實作進度 — 2026-11-08

最新：T3 儲存／投影／重播服務已實作，75 項 scripted 測試通過；typecheck 仍受下載限制。版控 commit/push 因 .git 唯讀與 connector 404 未成功。詳見 [T3_PROGRESS.md](T3_PROGRESS.md)。下方保留 T1/T2 紀錄。

T1/T2 程式已實作；規則測試通過，**型別檢查尚未驗證成功，因此未達完整驗收**。

主要變更：

- package.json / tsconfig.json：Node 24、TypeScript strict；固定 typescript 5.9.3 與 @types/node 24.10.1。
- src/contracts：公開 DTO 與私有 controller 輸入分開；action discriminated union、runtime action/decision 驗證、wait／wake／策略摘要。
- src/domain/config.ts：完整 experimental config 驗證、五個唯一席位、單一 OpenRouter 模型與共同參數、拒絕未知覆寫欄位與缺失規則。
- src/domain/engine.ts：純批次 resolver / reducer，B/C 配置計分、少數派次數、雙層排名／平手、三階段、單次秘密投票、ready 撤回、截止、訊息阻止同批提前結束。
- src/application/ports.ts：事件存檔、批次版本／冪等結果、決策快照與排程 checkpoint 介面。
- configs/experimental.json / .env.example / README.md：模型留空待填；憑證僅環境變數；操作方式與資料邊界。

驗證：

- `npm.cmd test`：71 tests passed，0 failed。包含 32 票型 × B/C、零和總和、排名／平手、ready、非法／重複行動、截止與 10/12 回合。全為 scripted 工程測試，沒有真正 LLM 對局。
- `npm.cmd install --ignore-scripts --fetch-retries=0 --fetch-timeout=15000`：失敗，registry.npmjs.org 請求被環境拒絕（EACCES）。改 workspace cache 重試亦同。
- `npm.cmd run typecheck`：已嘗試，失敗於 `tsc` 未安裝；不能視為型別通過。Node 執行測試會移除型別，不能取代此檢查。
- 套件尚未成功安裝，沒有產生 package-lock.json。請在可存取 npm registry 的環境安裝後保存 lockfile。

決策／限制：

- 採使用者已確認實驗政策；保留 ReadyPolicy 可替換。暫採「有未送出訊息則延後提前結束」工程保護；排程器接線於 T4。
- domain 不呼叫 SDK、HTTP、資料庫或真實時鐘。createGame 接收已驗證 Rules；外部 JSON 必須經 parseConfig。
- 未建立 UI、LLM adapter、SQLite 實作或對外 projection；未呼叫付費 LLM。controller/store 目前只有介面。
- 未來完整事件封裝與 ACL 在 T3 處理，內部 DomainEvent 絕不可直接推送瀏覽器；T4 負責快照、未來行動、批次延遲與重試。

下一步：先成功執行 `npm.cmd install`、`npm.cmd run typecheck`，修正任何型別問題並保存 lockfile，再開始 T3 事件持久化與權限投影。只需讀本頁、contracts、domain、application/ports.ts 與 ARCHITECTURE.md 第 7–9 節。T3 重點驗收是私訊哨兵隔離、整批 transaction、重試冪等與按 cursor 重播。
