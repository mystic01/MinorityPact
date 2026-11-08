# T8 工程工具與 QA — 2026-11-08

已增加 experiment matrix/report CLI。matrix 產生 B/C × 5s/15s/event-driven × 10/12 共12份配置，不自動呼叫付費API；report 僅輸出分數、訊息／策略數量、模型、配置、event hash、API用量／回報成本、錯誤次數，不輸出私訊或策略原文，不生成劇情解釋。

已完成12格 scripted 端到端排程驗證，91項測試、backend typecheck、Vue typecheck與build通過。decision_records v3將完成的原始決策快照獨立不可變存檔，checkpoint只留未完成決策；避免每次提交重寫全部歷史。12格測試時間由約42秒降至15秒，沒有截斷模型可見歷史。

本機Chrome headless QA：`npm.cmd run test:browser` 通過建立／啟動、即時私訊保密、終局全知原文、切回限知清除秘密、390px手機寬度與無頁面執行錯誤。截圖在ignored .npm-cache/browser-qa，scripted資料，非真正LLM成果。覆寫先前T6/T7「尚無瀏覽器QA」限制。

真實OpenRouter smoke另用 data/smoke.json、data/smoke.sqlite（均ignored），五席不同Gemini、10回合、15秒交涉。五模型皆成功回應；曾修正非法截止時間、Gemini discriminator const相容性（改typed singleton enum）、Windows BOM。原始失敗及重試保留，不代選票；重試僅加格式修正提醒，遊戲快照不變。最終結果待對局完成後另存公開指標報告。

**尚未完成真正多seed／多規則矩陣與策略品質人工評估**；不能把scripted12格或單一短交涉smoke當成玩法已定案。跨模型測試不再是原本同模型公平能力比較，依使用者最新要求分席觀察。

用法：

```powershell
npm.cmd run experiment -- matrix configs/experimental.json
npm.cmd run experiment -- report data/smoke.sqlite smoke-20261108
npm.cmd run test:browser
```

自動瀏覽器檢查預設使用本機Chrome；其他環境以BROWSER_PATH指定已安裝Chromium瀏覽器。
