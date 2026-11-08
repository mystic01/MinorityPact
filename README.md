# Minority Pact

新局交涉上限為50秒遊戲時間（最多10個五秒窗口）。私訊會在下一窗口喚醒收件席；即使未訂閱訊息，距上次決策15秒也會重新判斷。公開訂閱與是否發言仍由玩家自行決定。舊局保留保存的時間與喚醒規則，更新後請重啟服務並建立新局。

本機多模型博弈控制台，含公開即時觀戰與終局全知重播。需要 Node.js 24 以上。

觀戰介面採劇場交涉牌桌，五席獨立頭像會隨公開發言與已揭曉得分切換表情；右側保留公開紀錄，設定由「新對局 ＋」展開。真人席位尚未實作，介面元件已預留參與者名稱與人物分離。設計、資訊界線與背景生成提示見 [UI_THEATER.md](docs/UI_THEATER.md)。

新局可選5／10／12局。桌機畫面依視窗高度縮放，字幕與操作列保持可見，公開發言泡泡可顯示四行。供應商HTTP429會暫停並顯示限流原因，停止立即自動重試；稍後手動繼續時保留其他成功席位的結果。

啟動：`npm.cmd start`，開啟 http://127.0.0.1:3000。預設五席為 GLM 5.3 Flash、Qwen3.8 Flash、DeepSeek V3.2、Gemini 2.5 Flash Lite、GLM 5.3；設定存於 configs/experimental.json 的 seatModels，可在建立新局前於畫面調整。共同 max_tokens 暫設4096，避免使用供應商過大的預設輸出預留額度；這是含推理在內的輸出預算，非訊息數限制，若發生截斷須再調校。真實執行需要本機 .env 的 OPENROUTER_API_KEY。每局設定凍結，歷史重播顯示當局模型。server 預設採 experimental.json；可設定 GAME_CONFIG 指向其他檔案。

```powershell
npm.cmd install
npm.cmd run typecheck
npm.cmd test
```

Node 原生執行 TypeScript 測試，不需測試框架或 API key。TypeScript 靜態檢查仍需安裝 devDependencies。

`configs/experimental.json` 已提供五個不同低成本模型 ID。`llm` 保存共用參數及未指定 seatModels 時的預設；seatModels 可逐席覆寫模型。API key 從 OPENROUTER_API_KEY 讀取（見 .env.example），不傳入瀏覽器。

`parseConfig(unknown)` 與 `parseDecision(unknown)` 是 runtime 驗證入口。規則引擎接收已驗證設定；`resolveBatch` 只接當下到期行動，未來 action、批次 ID 冪等與快照由 T3/T4 負責。回傳事件以 `reduce` 套用到新狀態；輸入不被修改。reveal 後以空批次推進下一回合或終局，便於後續觀戰呈現揭曉階段。

`src/contracts/public.ts` 為公開 DTO；`DecisionInput` 是僅可交給對應 controller 的授權資料；`src/domain/engine.ts` 與 `application/ports.ts` 的內部事件含秘密，不得直接序列化對外。對外事件讀取走 `ReplayService`，以可信身分產生投影；`projectEvent` 為內部工具，不能直接由 HTTP 參數開啟全知。SQLite 使用 Node 內建 `node:sqlite`，已在本機 Node 24.22.1 驗證。

規則、時間與政策細節見 `ARCHITECTURE.md`；後續任務見 `IMPLEMENTATION_PLAN.md`，實際驗證狀態見 `docs/PROGRESS.md`。

## OpenRouter 命令列對局

可複製 `configs/experimental.json` 為 `configs/local.json`，調整 seatModels 的 OpenRouter 模型 ID／displayName。模型需支援 JSON Schema 結構化輸出與共同參數；不支援時會暫停，不自動換模型。推理資源可在 parameters.reasoning 設定。

```powershell
Copy-Item configs/experimental.json configs/local.json
# 編輯 configs/local.json，填入模型 ID
npm.cmd run game -- check configs/local.json
# 在本機 .env 設定 OPENROUTER_API_KEY，或設定同名環境變數
npm.cmd run game -- start configs/local.json data/games.sqlite
# 失敗後使用畫面上的 SESSION_ID 恢復同局
npm.cmd run game -- resume configs/local.json data/games.sqlite SESSION_ID
```

`check` 不發送 API 請求，`start/resume` 會呼叫付費模型。resume 使用資料庫中原始模型／規則。例外是單次輸出上限：啟動設定的 `llm.parameters.max_tokens` 作為執行時下限，與保存值取較大者，讓暫停的舊局也能提高額度；不改寫歷史設定或已完成決策。預設已由4096提高為8192，重新啟動服務後生效，推理強度不變；較高上限可能增加實際用量與等待，並非保證不再截斷。CLI 只印公開投影；私訊原文、策略與原始 provider 回應在 SQLite 私有資料內，勿直接分享資料庫。

CLI 依真實時間等待邏輯時間間隔，LLM 推理期間停鐘。失敗最多重試 2 次後保留 pending decisions，退出並允許 resume。資料庫旁 `.lock` 防止兩個 CLI 同時執行；若程序被強制終止留下 lock，確認沒有對局程序仍執行後再手動移除 lock。不要同時以其他程式寫入同一資料庫。

未指定 `llm.parameters.reasoning` 時，GLM 5.3／Flash 採 `{"effort":"low"}`；Qwen3.8 Flash 採 `{"max_tokens":1024}`，限制推理用量（總輸出上限仍為4096）。Qwen的low請求曾實際耗盡4096推理token，其[官方模型資料](https://openrouter.ai/api/v1/models)標示支援推理token預算，未標示effort選項。若使用者將總輸出上限調至1024以下，Qwen預設關閉可選推理；明確的reasoning設定優先保留。此預設於載入席位時套用，因此重啟後恢復舊局也適用，不改寫原始設定或成功決策。截斷會停止自動重試，需手動處理後再繼續，不自動提高費用上限。

## 本機 LLM 呼叫紀錄

`data/games.sqlite` 的 `decision_audit` 表保存未加密的 JSON 明文。可用 SQLite 檢視工具以唯讀模式開啟，執行：

```sql
SELECT id, session_id, snapshot_id,
       json_extract(record, '$.kind') AS kind,
       json_extract(record, '$.request.model') AS model,
       json_extract(record, '$.status') AS http_status,
       json_extract(record, '$.code') AS code,
       record
FROM decision_audit ORDER BY id DESC LIMIT 50;
```

`provider_response` 記錄請求提示／快照、原始回應（`rawResponse`）、起訖時間與成功狀態；usage／費用以供應商回傳為準，不是完整帳單。`decision_rejected` 記錄嘗試次數及拒絕原因。API key 不寫入請求 headers 稽核，回顯的 key 亦會遮蔽。資料含私訊及策略，不透過觀戰網頁公開；`data/` 已排除版控。舊 smoke 的紀錄另存於 `data/smoke.sqlite`。

真正 LLM smoke 與實驗進度見 docs/PROGRESS.md；模擬 HTTP 測試僅證明串接與流程，不證明模型策略能力。API 實作參考 [OpenRouter API](https://openrouter.ai/docs/api_reference/overview) 與 [Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs)。

實驗工具：`npm.cmd run experiment -- matrix configs/experimental.json` 產生12組可配置對照檔（不呼叫API）；`npm.cmd run experiment -- report DATABASE SESSION_ID` 輸出不含私訊內文的客觀指標。Chrome UI檢查：`npm.cmd run test:browser`；必要時設定BROWSER_PATH。詳見docs/T8_PROGRESS.md。
