# Minority Pact

本機執行的五席 AI 談判與秘密投票遊戲，支援不同模型、真人取代一席、手動 Markdown 模式，以及終局全知重播。預設少數色只有一席得 5 分、兩席各得 2 分，多數色得 0 分；另可啟用雙人條件付款契約。

## 首次使用

需要 Node.js 24 以上與 npm。下載本 repo 後，在專案目錄執行：

```powershell
npm.cmd ci
npm.cmd start
```

開啟 http://127.0.0.1:3000，在「新對局 ＋」選擇模式與席位，再建立並開始。macOS／Linux 請將 npm.cmd 換成 npm。

無 API key 可先選「手動檔案（自動檢查回覆）」，依 [手動模式](docs/MANUAL_MODE.md) 操作；外部 AI 服務可能另有費用。自動 OpenRouter 模式則先複製設定範本：

```powershell
Copy-Item .env.example .env
```

用文字編輯器將 key 填入本機 .env，再重啟服務。macOS／Linux 使用 cp .env.example .env。開始或繼續 API 對局會呼叫付費模型；安裝、建置與下列離線測試不會。模型可用性與參數相容性依供應商而定，設定範例不保證永久可用。

## 開發驗證

```powershell
npm.cmd run typecheck
npm.cmd run web:check
npm.cmd test
npm.cmd run build
# 需已安裝 Chrome，其他安裝位置可設定 BROWSER_PATH
npm.cmd run test:browser
```

測試使用腳本代理或 mock HTTP，不需 API key。真正多模型 smoke 依成本要求停在第 5 回合、完成 4 回合，尚未完成真正 10 回合驗收；離線測試不證明模型策略能力。

## 資料與使用範圍

- 預設只監聽 127.0.0.1:3000，是本機單使用者工具，未提供多人帳號或正式網際網路部署支援。
- API 模式會將各席授權的遊戲上下文送至 OpenRouter／所選模型供應商。不要在遊戲訊息中輸入 key 或其他敏感資料。
- SQLite、手動檔案及稽核紀錄含未加密的私訊、策略與原始模型回覆，不應直接分享。終局全知重播會揭露保存的私訊與策略。
- 本專案仍在實驗階段；較早規格與進度可能已由後續補充取代，詳見 [架構](ARCHITECTURE.md) 與 [驗證紀錄](docs/PROGRESS.md)。
- 目前沒有 LICENSE，尚未指定開源授權。AI 素材來源見 [素材說明](docs/AVATAR_ASSETS.md)。
- 公開前檢查範圍與待決事項見 [公開檢查](docs/PUBLIC_READINESS.md)；安全回報見 [SECURITY.md](SECURITY.md)。

## 操作細節

真人模式：重啟服務後，在「新對局 ＋」選擇「參與方式」中的A～E席位，再建立並開始對局。點「你的行動」可發公開訊息、準備多則私訊或空白提交；「提交並推進」完成本批，「我已準備投票」則表示願意結束交涉。投票階段選紅／藍後確認，不設真人倒數。可收起面板閱讀紀錄，自己的私訊即時可見，其他席位私訊保密。提交後鎖定並保存，未提交草稿重新整理可能清除。真人模式只透過本機瀏覽器服務操作，CLI保留AI觀戰用途；不會向AI提供真人身分標記。

新局交涉上限為30秒遊戲時間（最多6個五秒窗口）。私訊會在下一窗口喚醒收件席；即使未訂閱訊息，距上次決策15秒也會重新判斷。公開訂閱與是否發言仍由玩家自行決定。舊局保留保存的時間與喚醒規則，更新後請重啟服務並建立新局。

本機多模型博弈控制台，含公開即時觀戰與終局全知重播。需要 Node.js 24 以上。

介面採劇場交涉牌桌，五席獨立頭像會隨閱讀焦點與已揭曉得分切換表情；右側保留授權可見紀錄，設定由「新對局 ＋」展開。真人可取代其中一席AI並沿用立繪。設計、資訊界線與背景生成提示見 [UI_THEATER.md](docs/UI_THEATER.md)。

新局可選5／10／12局。桌機畫面依視窗高度縮放，字幕與操作列保持可見，公開發言泡泡可顯示四行。供應商HTTP429會暫停並顯示限流原因，停止立即自動重試；稍後手動繼續時保留其他成功席位的結果。

啟動：`npm.cmd start`，開啟 http://127.0.0.1:3000。預設五席為 GLM 5.3 Flash、Qwen3.8 Flash、DeepSeek V3.2、Gemini 2.5 Flash Lite、GLM 5.3；設定存於 configs/experimental.json 的 seatModels，可在建立新局前於畫面調整。共同 max_tokens 預設8192，避免使用供應商過大的預設輸出預留額度；這是含推理在內的輸出預算，非訊息數限制，若發生截斷須再調校。真實執行需要本機 .env 的 OPENROUTER_API_KEY。每局設定凍結，歷史重播顯示當局模型。server 預設採 experimental.json；可設定 GAME_CONFIG 指向其他檔案。

```powershell
npm.cmd install
npm.cmd run typecheck
npm.cmd test
```

Node 原生執行 TypeScript 測試，不需測試框架或 API key。TypeScript 靜態檢查仍需安裝 devDependencies。

`configs/experimental.json` 已提供五個不同低成本模型 ID。`llm` 保存共用參數及未指定 seatModels 時的預設；seatModels 可逐席覆寫模型。API key 從 OPENROUTER_API_KEY 讀取（見 .env.example），不傳入瀏覽器。

開發架構與資訊邊界見 [ARCHITECTURE.md](ARCHITECTURE.md)，實際驗證狀態見 [docs/PROGRESS.md](docs/PROGRESS.md)。

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

未指定 `llm.parameters.reasoning` 時，GLM 5.3／Flash 採 `{"effort":"low"}`；Qwen3.8 Flash 採 `{"max_tokens":1024}`，限制推理用量（目前預設總輸出上限為8192，舊局依保存值與執行時下限決定）。Qwen的low請求曾實際耗盡4096推理token，其[官方模型資料](https://openrouter.ai/api/v1/models)標示支援推理token預算，未標示effort選項。若使用者將總輸出上限調至1024以下，Qwen預設關閉可選推理；明確的reasoning設定優先保留。此預設於載入席位時套用，因此重啟後恢復舊局也適用，不改寫原始設定或成功決策。截斷會停止自動重試，需手動處理後再繼續，不自動提高費用上限。

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

## 手動檔案模式

Windows 可直接雙擊根目錄的 `start-game.bat`：自動建置、啟動伺服器並開啟遊戲網頁。需先安裝 Node.js 24 以上，首次使用先在專案目錄執行 `npm.cmd ci`。遊玩時保留終端視窗，結束時按 Ctrl+C；啟動器不會自動開局或呼叫付費 API。若瀏覽器未自動開啟，前往 http://127.0.0.1:3000。

網頁新對局選「手動檔案（自動檢查回覆）」。每席 Markdown 可整份貼給 AI，答案貼回同檔指定區並儲存；網頁自動顯示進度，收齊後前進。詳見 [完整說明](docs/MANUAL_MODE.md)。

## 雙人契約付款

新對局可勾選「啟用雙人契約付款」。支援提案、接受、雙方解除及當輪條件付款，API、手動檔案和真人模式皆可操作。詳見 [契約操作](docs/CONTRACTS.md)。

投票揭曉後，右側切換至「公開對話」旁的「投票結果」分頁可查看最近三輪，也可展開整局；各席下方保留上輪選色。表內「獎」為選色獎金，「淨」為包含契約付款的本輪總分增減。

手動檔案模式也可在「參與方式」選擇一席由真人加入：你在網頁操作，其餘四個 AI 使用各自 Markdown；同批真人提交與 AI 回覆齊全後一起結算。

更新程式後請在原啟動視窗按 Ctrl+C，再雙擊 start-game.bat。啟動器若提示 3000 埠被占用，代表仍有服務執行中，需先停止再重啟；只重建前端不會更新執行中的後端。
