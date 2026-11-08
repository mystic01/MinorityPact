# 真實 smoke 停止紀錄 — 2026-11-08

依使用者最新要求「開發非必要不使用API，必要用便宜模型」已停止多模型長局，不自動恢復。五個Gemini均曾成功回應，完成4回合，進入第5回合時停止；不是完整10回合驗收。

本機資料（ignored）：data/smoke.json、data/smoke.sqlite，session smoke-20261108。已有369筆事件、34筆公開談話、62筆私訊與83份策略備忘錄；投票揭曉4回合。依停止時落盤資料計算provider attempts=90，provider failures=3，validation failures=7。已記錄usage.cost合計約1.96048（OpenRouter回報值，未落盤／被中止的在途請求可能未計入，不視為完整帳單）。

目前沒有冠軍：outcome=null。B/C各6分，D/E各2分，A為0分，僅是中途比分，不能作模型能力結論。短交涉、未固定prompt版本（實測中修正schema）、單seed與未完局均限制比較意義。

已修正的工程問題：UTF8 BOM、按phase/deadline限制schema、Gemini discriminator singleton enum、規則拒絕後的格式修正提醒。原始回應與失敗未刪除、未補寫動機、未代選顏色。

後續開發只跑scripted/mock/browser QA。必要外部相容性測試以便宜模型、最小請求為限。完整真實10–12回合及多seed玩法評估保持未驗收，不因此阻止離線功能開發。
