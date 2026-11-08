# T4 — 2026-11-08

完成公平決策協調器、可注入 wall clock 的 GameClock、5s/15s 邊界與自主事件／時間排程。每批先保存合法快照，再並行呼叫 controller；API 等待停鐘，結果按 seed/batchId 決定的穩定順序提交，非依回應順序。固定窗口只呼叫應醒的 AI。

pendingDecisions 的成功結果逐筆落盤；失敗使用原快照最多重試 2 次，仍失敗拋 paused_error 並保留 pending batch。重建 coordinator 後成功者不重叫。已完成決策輸入與結果保留 completedDecisions，未來行動與事件訂閱保留 checkpoint。正式技術錯誤／原始 provider response 稽核表與操作狀態 API 在 T5/T6 接線。

step 要求呼叫端提供 pace(milliseconds)；live runner 必須依此等待遊戲時間，測試使用虛擬 pacer。呼叫端不得在等待模型時額外推進 logicalTime。事件喚醒遵循 AI 訂閱且至少延後正時間，交涉截止優先，不會零時間反覆互叫。未來 action 只到期才發布公開元資料，跨階段取消待送交涉動作。

驗證：npm.cmd run typecheck 通過；npm.cmd test 共 81 項 scripted 測試。新增 clock 停鐘、不同 API 延遲排列一致、失敗恢復同快照且不重叫成功者、10 回合自主靜默到終局、5s/15s 訂閱喚醒、未來訊息延後執行與 coordinator 重建測試。尚未跑真正 LLM。尚未以 OS kill 測試實際程序崩潰；同時多執行器由單程序 coordinator busy guard 與儲存版本限制處理，部署仍須單寫入者。

環境阻礙已解除：以獲准的環境權限完成 npm 安裝、lockfile 與型別檢查。已成功將 T1–T3 推送 origin/master，commit 2c9ccf3。後續仍依使用者授權每階段自動 commit/push。

下一步 T5：OpenRouter adapter、共同 prompt、CLI live runner、原始輸出／重試稽核。開始真實對局前需要設定檔的模型 ID 與 OPENROUTER_API_KEY；禁止顯示／提交 key。先讀本頁、coordinator.ts、decision/schema contracts 與 REQUIREMENT 第 6/7/10 節。
