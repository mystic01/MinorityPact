# T6 — 2026-11-08

已實作本機 HTTP server、公開 SSE、操作 token／同 Origin／loopback Host 檢查、建立／開始／暫停／恢復／中止、Vue 綜合控制台與五席模型設定。server 使用 Node 原生 HTTP，無需 Express。公開事件永遠經投影；私有 SQLite 與 audit 無對外路由。session_runtime 保存狀態，重啟後未完對局需手動 resume；CLI/server 共用 lock 防止雙寫。

使用者最新決定取代舊同模型要求：每席可以不同模型，以便感受差異。新增 seatModels（若提供則必須五席完整），共用 llm.parameters 保留；modelForSeat 在 CLI/server 接線，各席回應必須符合該席配置模型。

預設 A Gemini 2.5 Flash、B 2.5 Pro、C 2.5 Flash Lite、D 3.5 Flash、E 3.5 Flash Lite。以 OpenRouter 公開 /api/v1/models 清單確認五者目前列有 structured_outputs，不等於真正呼叫已成功。參考 https://openrouter.ai/api/v1/models 與各模型頁；非 fallback 模型清單。

驗證：backend typecheck、vue-tsc、Vite production build 與88項測試通過。新測試包含五席設定凍結、HTTP token／Origin、私訊哨兵在快照及 SSE／重連／假冒角色參數不可見、未終局全知拒絕，以及 scripted 五席 HTTP 對局至終局。無 browser automation 工具，因此尚無瀏覽器視覺 QA；已完成建置及 HTTP 層驗證。

啟動 npm.cmd start，瀏覽 http://127.0.0.1:3000；無需另外安裝 DB。畫面提供每席模型名稱、公開聊天／私訊元資料、時間／階段／分數、整局等待狀態。重播基礎 UI 已一併建立，T7 接續細化驗收。
