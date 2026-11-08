# T3 — 2026-11-08

實作：src/infrastructure/sqlite-store.ts、src/application/projection.ts、src/application/replay.ts，新增 strategy_note 內部事件與 tests/storage.test.ts。

SQLite 使用 Node 24 內建 DatabaseSync（本機 24.22.1 已驗證），不新增資料庫相依套件。schema v1 初始化具可重入性；events 防修改／刪除 trigger；batch fingerprint 防止不同內容誤用相同 batchId；版本衝突拒絕，events 與 checkpoint 同一 transaction。

私訊白名單只公開 sender/recipient，收發者可見 body；策略限本人，投票揭曉前限本人。ReplayService 從持久化事件重建 cursor 狀態，completed 前拒絕全知，不呼叫 LLM。Viewer 身分須由未來 server 授權層提供，不能直接信任 query。projectEvent 屬內部函式，完成狀態 gate 在服務層。

驗證：`npm.cmd test` 共 75 項全部通過，0 failed。新測試含 transaction rollback、冪等重送／版本衝突、磁碟重開保留排程、私訊與策略哨兵隔離、未終局全知拒絕、終局 cursor 分數／原文一致性。全為 scripted。模擬 SQL 中途失敗，尚未測試 OS 強制終止程序。

`npm.cmd install --ignore-scripts --cache .npm-cache --fetch-retries=0 --fetch-timeout=15000` 再次 EACCES；TypeScript 仍未安裝，因此整體 typecheck 尚未驗證，沒有 lockfile。T3 程式與 runtime 驗證完成，但靜態驗收仍待補。

版控：使用者指定 git@github.com:mystic01/MinorityPact.git，**每階段完成後自動 commit & push，不需再次核可**。已嘗試 git init、設定 remote、add、commit、push；本機 .git/config 與 index.lock 寫入遭 Permission denied。以命令級 safe.directory 解決 ownership 檢查後仍遭相同寫入限制。GitHub connector 查 repo 返回 404。**沒有成功 commit 或 push**，不得宣稱已同步。環境允許時先查 remote 分支與既有歷史，保留遠端修改，禁止 force push。

下一步：完成 dependency 安裝／typecheck 與 lockfile；確認 git 寫入／GitHub 倉庫存取可用，提交 T1/T2 與 T3，再開始 T4 排程。T4 使用目前 store checkpoint 接上 pending decisions、快照、喚醒及公平 barrier。T3 暫將決策快照放在 checkpoint pendingDecisions；完整原始嘗試稽核持久化於 T4/T5 接線時增加，不把 checkpoint 當永久原始回應存檔。
