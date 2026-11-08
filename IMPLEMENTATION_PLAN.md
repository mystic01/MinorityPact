# AI 開工與交接索引

狀態：T1–T4 程式已實作，81 項 scripted 測試與型別檢查通過。套件／Git 阻礙已解除，T1–T3 已推送，最新進度見 docs/T4_PROGRESS.md。尚未執行真正 LLM 遊戲。使用者要求每階段自動 commit & push 至 git@github.com:mystic01/MinorityPact.git，無需再次核可。

建議：下一步直接實作 T1/T2，不再做第二輪大架構規劃。使用者已確認本機／瀏覽器、OpenRouter、模型設定檔與畫面顯示，以及同批同步／可撤回 ready／不可改票的實驗預設。見 REQUIREMENT.md「最新確認補充」；其他未定設定仍不得稱為正式規則。

OpenRouter 交付補充：T1 建立 llm.provider/model/displayName/parameters 設定契約與 OPENROUTER_API_KEY 環境變數範本；不填固定模型。T5 實作 OpenRouter adapter，驗證所選模型的結構化輸出與參數能力，五席使用相同模型。T6 標頭低調顯示模型名稱，T7 重播顯示存檔模型；不得將 key 放進公開 DTO。

## 最短閱讀路徑

目前接續點：T5 工程串接已完成、真正 LLM 驗收待設定；最新狀態以 docs/T5_PROGRESS.md 為準。T6 可先做控制台，但其真正對局整合驗收仍需 T5 實測。

每次接手先讀本頁、ARCHITECTURE.md 第 2 節與任務指定章節，再按需讀 REQUIREMENT.md 指定節次。REQUIREMENT.md 是完整需求來源；不需要每個小任務重讀訪談表、重查候選 repo 或重新選框架。遇到實際矛盾才回溯原文。

約束優先序：使用者最新指示 → REQUIREMENT.md 已確認需求 → 實作契約 → 暫定建議。技術選型可修正，但須寫明理由，避免任務間任意換框架。

## 任務卡

| 任務 | 先決 | 指定閱讀 | 實作範圍／交付 | 完成條件 |
|---|---|---|---|---|
| T1 型別與骨架 | 無 | 架構 2–4、6；需求 3–7 | npm/TS、contracts、config schema、controller/store 介面、experimental 設定 | typecheck；拒絕缺少必填規則及不一致五席設定；public/internal 型別分離 |
| T2 規則引擎 | T1 | 架構 4、6、9；需求 3–5 | domain、B/C score、rank、phase、vote、ready policy | 32 種票型×兩計分；平手、重複投票、非法階段；無任何 SDK/IO |
| T3 事件與權限 | T1、T2 | 架構 7–9；需求 5、6、9 | SQLite schema/migration、commitBatch、投影、snapshot、replay fold | 私訊哨兵隔離、半批 rollback、重複 batch 冪等、按 cursor 重播 |
| T4 公平排程 | T1–T3 | 架構 5–7、9；需求 6、7 | clock、5s/15s policy、coordinator、排程佇列、簡單事件訂閱、恢復 | 延遲排列不影響事件；同快照重試；自主 wait；期限；pending batch 恢復 |
| T5 真正 LLM | T4；模型資訊／憑證 | 架構 4、6、7、9；需求 6、10.3–10.4、17 | 一個 provider adapter、共同 prompt、結構驗證、策略摘要、CLI runner | 一場真正五 LLM 的 10/12 回合及完整記錄；沒憑證不宣稱完成 |
| T6 即時觀戰 | T3、T4；整合驗收需 T5 | 架構 8；需求 8 | HTTP/SSE、Vue 席位分數、統一事件軸、私訊通知、整局等待 | 真實執行中持續接收；重連無漏／重複；網路 payload 無秘密 |
| T7 終局回播 | T3、T6 | 架構 7–9；需求 9 | 播放、暫停、變速、跳轉、公知／全知切換、原文展開 | completed gate；seek 分數與歷史一致；無 LLM 呼叫、無新內容 |
| T8 實驗與收尾 | T5–T7 | 架構 5、9；需求 12、17 | 事件驅動 policy、實驗 runner、B/C/窗口/回合比較、操作說明 | 各模式工程測試通過，保存真實實驗結果與限制，逐條對照 MVP DoD |

建議按表順序逐項交付。UI 可以使用清楚標示 scripted 的固定事件 fixture 開發，但不能把 fixture 當真實 LLM 成果。不要為了節省開發 token，偷偷降低五個參賽 AI 的對局資源或取消需求中的實驗模式。

每張任務卡範圍內允許補必要實作；超出邊界的功能先記錄，勿自動擴張至真人 UI、多遊戲、帳號平台、美術或排行榜。

## 可直接貼給下一個 AI

```text
請實作 IMPLEMENTATION_PLAN.md 的 T1，完成後接續 T2。
先讀 REQUIREMENT.md「最新確認補充」：本機瀏覽器觀戰、OpenRouter、
模型從設定檔讀取且畫面顯示名稱，採用已確認的實驗預設。
先按「最短閱讀路徑」閱讀，沿用 ARCHITECTURE.md 契約。
REQUIREMENT.md 已確認需求優先；未定遊戲規則只可標成 experimental policy。
先檢查目前檔案與進度，不覆蓋既有修改；不要重新研究所有候選專案。
此輪不建 UI、不呼叫付費 LLM、不擴張遊戲規則。
完成型別與純規則核心，跑對應測試，將實際命令、結果、變更檔案和下一任務
記錄到 docs/PROGRESS.md；未執行的測試明確寫未執行。
若存在會改變已確認需求的矛盾才提出問題；一般工程選擇自行處理。
```

## 後續交接格式

每次完成任務後才建立／更新 docs/PROGRESS.md，內容維持簡短：

```text
完成：T?；主要變更：檔案與介面
驗證：實際執行命令與結果（區分 scripted / 真正 LLM）
決策：新確認需求或仍暫定設定
限制：失敗／未跑項目，不粉飾
下一步：T?；只需閱讀哪些檔案
```

省 token 的重點是穩定契約、局部閱讀與可執行驗收，不是把全部設計反覆交給每個 AI 重想。框架與相依版本只在 T1 決定一次；之後依 lockfile。不要製作與程式碼重複的大量設計文件。
