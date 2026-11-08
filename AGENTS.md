# 開發與驗證規則

- 需求優先序：使用者最新指示、REQUIREMENT.md 最新補充、ARCHITECTURE.md、任務卡。每席不同模型已取代舊同模型限制。
- **開發預設完全離線驗證**：腳本代理、mock HTTP、單元測試、Chrome scripted QA；不要因為 .env 有 key 就執行付費測試。
- 只有必要的 API 相容性問題才用便宜模型做最小次數測試（例如 Gemini Flash Lite）；不得自動啟動長局、昂貴模型或12格真實矩陣。正式遊戲五席模型設定與開發測試是不同用途。
- 本次真正多模型smoke已依使用者成本要求停在第5回合、完成4回合。不要自動resume該局或宣稱已完成真正10回合驗收。
- API key 不可印出、寫入程式、提交或傳入瀏覽器。data/、.env、.npm-cache/不提交。
- 每階段完成後自動 commit & push 至 git@github.com:mystic01/MinorityPact.git；使用者已授權，不需再次詢問。保留遠端既有修改，不force push。
- 執行 npm.cmd run typecheck、npm.cmd run web:check、npm.cmd test；前端更動再build和必要browser QA。實際驗證結果寫 docs/PROGRESS.md，不把mock說成LLM策略證據。
