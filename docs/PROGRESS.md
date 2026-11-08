# 實作進度 — 2026-11-08

真人模式方向與截斷調查（僅文件／唯讀）：已將「真人提交後推進五秒窗口、同批AI結果暫存、提交與準備投票分開」寫入REQUIREMENT第23節，尚未實作。最新局282227ee於第3回合累計70000ms暫停，唯一未完成者E（z-ai/glm-5.3），A/B/C成功結果已保存，D本批未喚醒。audit440為HTTP200、finish_reason=length：max_tokens4096、reasoning.effort=low，completion_tokens4096，其中reasoning_tokens2850，content789字元；prompt_tokens38451。這是輸出預算耗盡，low不是固定推理token上限，不能保證留足完整JSON所需額度。此前同快照audit434曾完整輸出但被Unknown observed event拒絕，隨後audit436 HTTP402表示當時餘額與進行中請求的額度預留不足；這兩者與本次截斷是不同問題，不推斷目前帳戶餘額。未修改程式／模型參數、未重試API、未恢復對局。下一步待使用者決定是否修改各席輸出預算與精簡回覆／事件引用規則，再另行離線驗證；目前不自動套用。

當批訊息與90秒交涉已完成：新局experimental預設negotiationTimeMs=90000，rulesVersion=minority-pact-v2-immediate、promptVersion=v3-zh-TW-immediate，policies.messageTiming=immediate。公開與私人訊息在動態JSON schema及coordinator驗證均限制scheduledTimeMs等於當前邏輯時間；欲延後表態可預約nextWake，再以最新授權快照思考。保留自行沉默、停止訂閱及原ready邏輯，不強制D或其他席發言。舊局未指定messageTiming時保留scheduled規則及待送訊息，不回寫資料庫。

UI依實際batchId分組而非僅按時間合併，標示「同批獨立表態 · 未參考彼此本批訊息」；舊局明示「舊制同批送達 · 可能包含先前預排訊息」。取消每6.5秒逐席輪播，泡泡及頭像改為「正在閱讀」，可點選公開訊息或頭像切換閱讀（頭像選本回合該席最近公開訊息），泡泡保留時間與批次，避免誤認為正在接話。私訊可見性不變。

驗證：typecheck、web:check、111項離線測試、Vite build與Chrome scripted browser QA通過。新增兩種訊息拒絕預排、未完成批次不發布、同批資訊隔離、下一次喚醒取得新歷史、舊局排程重啟相容及不同批次同時間不合併測試。瀏覽器確認五則公開訊息同組、閱讀焦點不自動輪替、手動切換、桌機首屏、四行泡泡、手機及私訊重播權限。首次browser QA因切換泡泡過場仍有兩個DOM元素而失敗，已改為等待過場完成再量測，重跑通過；已目視桌機截圖。未呼叫付費API、未恢復既有局；腳本結果不代表真實模型策略品質。

下一步：使用者停止原服務後執行npm.cmd start，重新整理瀏覽器並建立新局，才會套用90秒與當批訊息規則。90秒為遊戲時間，LLM運算等待仍暫停計時；既有局沿用原設定。這批修改不需切換開發模型，也無待決策事項。

交涉討論及D調查：使用者同意「移除預排訊息、保留稍後再思考」，要求先記錄待改，已寫docs/PENDING_NEGOTIATION_CHANGES.md，未修改執行邏輯。最新局至第4回合130000ms，D有15份完成決策、4則公開發言與3則私訊，多次回覆為準備投票或無行動；其他席位已公開催促D。D另有自稱C的模型輸出，輸入agentId及紀錄歸屬均為D，未發現跨席路由證據。查詢時paused且無pending，先前429後已恢復成功回覆。本次唯讀稽核、僅新增文件，未呼叫付費API、未恢復對局；不將推測的沉默動機當成事實。

首屏與短局修改：新增viewport.css，桌機以100dvh分配頁首／工具列／牌桌／操作／頁尾，對話歷史保留內部捲動；新局設定改為浮層，不撐高整頁。較矮視窗將計時器移至牌桌右上角，保留人物與四行發言泡泡的空間。泡泡由兩行增至四行，手機同步加高並下移人物避免遮擋。新局可選5／10／12局，後端接受5局且保留舊10–12局相容；原10局預設不改。五局完成後正常計分／冠軍判定，既有局設定不改寫。最新需求已追加REQUIREMENT第21節。

本次暫停另查明為同局ce3b730a在60000ms等待D（Gemini2.5FlashLite）：供應商Google AI Studio回HTTP429，上游暫時限流；A/B/C/E結果已保存，Qwen的1024推理預算已實際成功。程式無法解除上游限制。修正429不再立即連試三次，公開HTTP及SSE顯示安全限流原因；錯誤訊息改從仍未完成的快照讀取，避免已成功同伴先前的格式拒絕蓋掉真正錯誤。供應商原文留在私有稽核，不改寫歷史、不切換當局模型、不自動恢復付費局。

驗證：typecheck、web:check、106項離線測試、build通過。Chrome scripted QA確認UI選5局成功完局、1366×768／1440×900／1280×720／1280×600／1024×768桌機首屏完整、四行公開訊息不需捲動泡泡、計時器不遮蔽名牌與鎖牌；既有頭像、私訊隱藏、全知重播及手機寬度驗證保留。補測429警示出現時首屏仍完整。沒有付費API呼叫。下一步：重新啟動npm.cmd start載入後端5局與429處理，重新整理即可查看新版；目前暫停的舊局稍後手動繼續，只會補叫未成功的D。

劇場交涉UI完成：依使用者選定exec-ff17e970概念圖，改為五人並列、綠色橢圓牌桌、黃銅桌緣與獨立無人物溫室背景，導入既有透明表情PNG。PlayerSeat分離席位、頭像與參與者名稱，預留真人控制器；本次仍為觀戰版，未增加真人決策或修改遊戲規則。公開發言依序切換speaking與聚焦光暈，桌前／泡泡同步原文；公開揭曉得分後才用微笑／驚訝，私訊／策略／未揭曉投票不影響表情。換階段或重播清空發言；五席未揭曉均用中性鎖牌。新局設定可收合，右欄可篩選公開對話，手機三加二席位排列。背景以內建image_gen製作，提示及素材來源見docs/UI_THEATER.md。

驗證：102項離線測試、typecheck、web:check、build通過。Chrome scripted QA確認五席頭像與發言表情、隱藏／揭曉選色、私訊不公開、終局重播解鎖與重新隱藏、320至1920寬度無頁面橫向溢出、計時器不遮蔽名牌或選色牌、無JS或靜態資源錯誤。已目視檢查桌機與手機截圖，測試使用scripted controller，未呼叫付費遊戲模型、未恢復既有局。下一步：重新整理已運行的本機網頁即可讀取新版dist；尚未啟動服務者執行npm.cmd start。真人席位後續需加入控制器等待／提交／逾時及玩家私有操作流程，不能只新增一個外觀按鈕。

再次暫停的進一步診斷：ce3b730a仍停5000ms、B未完成，最新Qwen請求已帶reasoning.effort=low卻再次產生4096 reasoning tokens／finish_reason=length。前次low修正不足。唯讀查詢OpenRouter公開免金鑰GET /api/v1/models，Qwen3.8Flash的reasoning為mandatory:false、default_enabled:true、supports_max_tokens:true，未列supported_efforts；GLM5.3則明列max/high/low。依能力改用Qwen預設reasoning.max_tokens=1024，不再假定effort能限制Qwen用量；總max_tokens保持4096。自訂總額<=1024時預設effort:none，以免推理預算等於或超過總額；顯式使用者reasoning保持優先。未改寫既有遊戲／稽核、未呼叫付費生成API。官方參考：https://openrouter.ai/api/v1/models 與 https://openrouter.ai/docs/guides/best-practices/reasoning-tokens 。

本次驗證：99項離線測試、typecheck、web:check通過，涵蓋舊局載入、數值預算、低總額處理、明確設定優先與成功席不重叫。下一步：Ctrl+C停止原服務後npm.cmd start，重新整理頁面再手動繼續B；不自動重試付費對局。尚未以實際付費請求驗證供應商遵守1024上限。UI僅製作三個圖片構想，尚未實作介面。

本次再次暫停：唯讀查詢games.sqlite，最新局ce3b730a已前進到logicalTimeMs=5000，未完成者改為B（Qwen3.8Flash）；HTTP200、finish_reason=length，4096 completion tokens全部為reasoning，其餘A/C/D/E均已成功。上次GLM修正後E已能產生決策，但Qwen仍沿用未限制的推理預設。本次將Qwen3.8Flash納入未顯式設定reasoning時的low預設，於modelForSeat解析時生效，適用恢復舊局；不改寫資料庫設定、快照、原始稽核或成功結果，不提高4096上限。官方參數說明：https://openrouter.ai/docs/guides/best-practices/reasoning-tokens 。低推理是降低截斷風險的設定，並非保證供應商不截斷；未以付費API驗證。

驗證：typecheck、web:check與98項離線測試全部通過。新增保存舊局後的Qwen解析回歸，確認low預設、保留4096、其他席不受影響、顯式effort／推理token設定優先、原始設定無修改；既有截斷單次停止／成功席保留測試亦通過。README新增SQLite明文稽核表位置與唯讀查詢方式。下一步：使用者在原服務終端按Ctrl+C，執行npm.cmd start後重新整理頁面，手動按繼續對局；只重試尚未成功的B。未自動重啟服務或恢復付費對局。

頭像素材完成：A–E各中性／發言／微笑／疑惑／驚訝，共25張1254×1254獨立透明PNG，web/public/avatars；附manifest、完整prompt集合、原始提案與docs/avatar-gallery.html預覽。內建image_gen製作，未接入遊戲UI、未加入人設。assets:check通過25圖透明／尺寸／不重複驗證，瀏覽器確認25圖全部載入並目視檢查；typecheck、web:check、build及97項離線測試通過。遊戲API未呼叫。對局截斷修復已另推送98830ba，須重啟服務後由使用者決定是否恢復。

截斷修復驗證：97項離線測試、typecheck、web:check、build及scripted Chrome QA全部通過；測試確認token額度耗盡只嘗試一次、保留另外四席結果，GLM低推理預設不覆蓋使用者顯式設定。不呼叫付費API，服務須重啟後載入。

最新截斷修復：新局ce3b730a在第1回合等待E（GLM5.3），三次finish_reason=length，4096 completion tokens全為reasoning，無完整JSON；其餘四席已成功。modelForSeat對GLM5.3/Flash在使用者未指定reasoning時加low，保留4096上限及顯式設定。ProviderDecisionError分類輸出截斷／不可重試HTTP錯誤，coordinator不再對相同額度做三次無效重試；公開畫面僅顯示安全的額度錯誤說明，不洩漏個別策略／原文。沒有付費API驗證、不自動恢復對局。重啟服務後可由使用者重試E，四個已成功結果保留。原始API輸出及歷史不改寫。頭像資產另在製作中，不影響此修復。

本次預設模型修改驗證：typecheck、web:check、build、94項離線測試與Chrome scripted QA全部通過，沒有付費API呼叫。

最新五席預設：依使用者確認改成A GLM5.3Flash、B Qwen3.8Flash、C DeepSeekV3.2、D Gemini2.5FlashLite、E GLM5.3，新增至網頁模型選單並保留原Gemini選項。新局共同max_tokens暫設4096，避免先前65536預留問題；舊局設定與歷史不改動。服務重新啟動後建立新局生效，若另設GAME_CONFIG需同步調整該檔。不呼叫付費API驗證。

本次暫停修復驗證：typecheck、web:check通過，完整離線測試94項通過。服務尚未重啟、未自動恢復對局；重新啟動npm.cmd start後，使用者可按繼續對局，只重試未成功決策。

暫停修復：本機games.sqlite最新paused_error局的API皆回200，連續被Goal change needs reason拒絕。原因是輸出schema容許revisionReason=null，但coordinator在goal文字改寫時要求原因。新增依該席最後goal產生的分支schema：沿用原goal或填非空白原因；提示亦要求未變目標逐字沿用。保留後端嚴格驗證、原始稽核與pending快照，不補寫模型原因、不自動恢復付費對局。以mock回歸測試驗證請求包含條件及原文且不修改快照。服務需重新啟動載入修正，再由使用者按繼續對局。

最新語言修改：SYSTEM_PROMPT與JSON Schema的自然語言欄位要求繁體中文，涵蓋公開發言、私訊與策略備忘錄；即使歷史為英文仍用繁中回應，機器協定格式及原始歷史不改寫。新局預設promptVersion=v2-zh-TW。以既有mock測試檢查語言要求確實隨請求傳送、中文回應原樣解析；沒有付費API呼叫。

本輪最終驗證：npm.cmd run typecheck、web:check、build全部通過；npm.cmd test 91項通過；scripted Chrome QA通過；實際main server啟動後HTTP200並已停止preview。正式使用執行npm.cmd start。未進行額外付費API驗證，真實smoke保持中途停止。

最新成本指示：已停止付費多模型smoke（完成4回合、停在第5回合），不得自動resume。改為離線開發；必要API驗證只用便宜模型。詳見AGENTS.md與REAL_SMOKE_STATUS.md。先前「對局進行中」已由此停止紀錄取代。

最新T8工程：12格scripted矩陣、公開指標報告工具及Chrome瀏覽器QA已建立；91項測試、前後端型別、build與browser smoke通過。T6 b760232、T7 acac7dd已推送。真實五Gemini對局仍進行中，不提前宣稱終局成功；詳見T8_PROGRESS.md。

最新T7：完成依原logicalTime播放、倍速、公知／全知切換與seek；T6已推送 b760232。真實多模型smoke已啟動，五席均成功回應，正在完成回合；不提前宣稱真實驗收通過。詳見T7_PROGRESS.md。

最新 T6：本機 Vue 控制台／HTTP／SSE 已建立，五席不同 Gemini 預設已接線（使用者最新需求），88項測試、前後端型別與build通過。見 T6_PROGRESS.md。已偵測本機key，下一步真實smoke及T7/T8；不輸出憑證。

最新 T5：OpenRouter adapter、CLI 與原始輸出稽核已實作；型別檢查與85項 mock/scripted 測試通過。真正五 LLM 對局尚缺模型ID／本機key，T5完整驗收未完成。詳見 [T5_PROGRESS.md](T5_PROGRESS.md)。

最新 T4：型別檢查已通過，81 項 scripted 測試；套件與 Git 環境阻礙已解除。T1–T3 已推送 2c9ccf3，T4 詳見 [T4_PROGRESS.md](T4_PROGRESS.md)。下一步 T5 OpenRouter 與 CLI。下方為歷史紀錄，先前「安裝／型別／push 未成功」已被本次解決。

最新：T3 儲存／投影／重播服務已實作，75 項 scripted 測試通過；typecheck 仍受下載限制。版控 commit/push 因 .git 唯讀與 connector 404 未成功。詳見 [T3_PROGRESS.md](T3_PROGRESS.md)。下方保留 T1/T2 紀錄。

T1/T2 程式已實作；規則測試通過，**型別檢查尚未驗證成功，因此未達完整驗收**。

主要變更：

- package.json / tsconfig.json：Node 24、TypeScript strict；固定 typescript 5.9.3 與 @types/node 24.10.1。
- src/contracts：公開 DTO 與私有 controller 輸入分開；action discriminated union、runtime action/decision 驗證、wait／wake／策略摘要。
- src/domain/config.ts：完整 experimental config 驗證、五個唯一席位、單一 OpenRouter 模型與共同參數、拒絕未知覆寫欄位與缺失規則。
- src/domain/engine.ts：純批次 resolver / reducer，B/C 配置計分、少數派次數、雙層排名／平手、三階段、單次秘密投票、ready 撤回、截止、訊息阻止同批提前結束。
- src/application/ports.ts：事件存檔、批次版本／冪等結果、決策快照與排程 checkpoint 介面。
- configs/experimental.json / .env.example / README.md：模型留空待填；憑證僅環境變數；操作方式與資料邊界。

驗證：

- `npm.cmd test`：71 tests passed，0 failed。包含 32 票型 × B/C、零和總和、排名／平手、ready、非法／重複行動、截止與 10/12 回合。全為 scripted 工程測試，沒有真正 LLM 對局。
- `npm.cmd install --ignore-scripts --fetch-retries=0 --fetch-timeout=15000`：失敗，registry.npmjs.org 請求被環境拒絕（EACCES）。改 workspace cache 重試亦同。
- `npm.cmd run typecheck`：已嘗試，失敗於 `tsc` 未安裝；不能視為型別通過。Node 執行測試會移除型別，不能取代此檢查。
- 套件尚未成功安裝，沒有產生 package-lock.json。請在可存取 npm registry 的環境安裝後保存 lockfile。

決策／限制：

- 採使用者已確認實驗政策；保留 ReadyPolicy 可替換。暫採「有未送出訊息則延後提前結束」工程保護；排程器接線於 T4。
- domain 不呼叫 SDK、HTTP、資料庫或真實時鐘。createGame 接收已驗證 Rules；外部 JSON 必須經 parseConfig。
- 未建立 UI、LLM adapter、SQLite 實作或對外 projection；未呼叫付費 LLM。controller/store 目前只有介面。
- 未來完整事件封裝與 ACL 在 T3 處理，內部 DomainEvent 絕不可直接推送瀏覽器；T4 負責快照、未來行動、批次延遲與重試。

下一步：先成功執行 `npm.cmd install`、`npm.cmd run typecheck`，修正任何型別問題並保存 lockfile，再開始 T3 事件持久化與權限投影。只需讀本頁、contracts、domain、application/ports.ts 與 ARCHITECTURE.md 第 7–9 節。T3 重點驗收是私訊哨兵隔離、整批 transaction、重試冪等與按 cursor 重播。
