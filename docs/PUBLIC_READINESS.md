# 公開前檢查（2026-11-12）

## 已檢查與修正

- 檢查目前追蹤檔案與本機所有 refs 可達歷史：615 個物件、353 個唯一 blob。以常見 OpenRouter／OpenAI／GitHub／Google key、AWS access key、私鑰及長字串密碼賦值格式掃描，未命中。掃描不輸出秘密內容；格式掃描不保證找出所有秘密。
- 歷史路徑查詢未發現 .env、data/、.npm-cache/ 或 .pem／.key 檔案曾被追蹤。此範圍不含遠端不可達物件、GitHub 設定、Issues、Actions artifacts 或他人 clone。
- 補強 .gitignore：環境檔變體、SQLite／DB 與旁檔、log、私鑰和瀏覽器測試產物。已追蹤的檔案不會因 ignore 自動移除。
- README 補上首次安裝、無 key 模式、費用與資料流、離線驗證、專案限制及授權狀態。移除文件中的個人本機生成路徑，修正素材接入狀態與過期輸出預算說明。
- 後端預設只監聽 loopback，具有 Host／Origin／操作 token 檢查；資料庫及稽核並無直接公開路由。這是程式碼檢視與既有測試範圍，不是完整滲透測試。

## 維護者公開前須決定

1. **Git 作者 email**：現有提交含個人 Gmail。公開 repo 會一併公開作者 metadata；只修改未來提交的 email 不會清除歷史。若要隱藏，應在公開前另行安排歷史重寫與協作者同步。本次未重寫歷史，也未 force push。
2. **LICENSE**：尚未選擇程式及素材授權，本次不代替作者指定授權。AI 圖像生成來源已有記錄，但生成來源記錄本身不是授權條款。
3. **GitHub 設定**：建議公開時啟用可用的 secret scanning／push protection 與私人漏洞回報。本次未修改 repository visibility 或遠端設定。

## 保留內容與排除範圍

需求訪談、架構、任務進度、提示詞與概念圖保留作為開發與素材來源紀錄；含開發過程與對局錯誤診斷資訊，作者可依公開範圍再選擇刪減。它們未被當作憑證或秘密自動刪除。刪除目前檔案也不會清除舊版歷史。

工作目錄另有使用者既存的未追蹤文字檔，本次不加入提交、不移除。data/、.env、.npm-cache/ 仍不提交。

未呼叫付費 API，未恢復暫停對局，也未宣稱完成真正 10 回合驗收。實際驗證結果記於 [PROGRESS.md](PROGRESS.md)。
