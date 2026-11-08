# 劇場交涉介面

依使用者選定的 `exec-ff17e970-e44c-4743-8c70-6471cf21b951.png` 概念實作。五位人物並列，前景為橢圓綠色牌桌與黃銅桌緣；場景、人物、文字及操作分層，不把概念圖當成整張網頁背景。

## 互動與資訊界線

- 五席頭像沿用 `web/public/avatars` 的獨立透明 PNG。席位、人物和參與者名稱由 `PlayerSeat.vue` 分別接收，預留日後真人控制器加入；本次尚未實作真人輸入、投票或身分驗證。
- 即時收到的本回合公開訊息依事件順序輪播，每則約6.5秒；對應席位顯示發言表情、光暈與標記。上方泡泡及桌前字幕均顯示原文，長訊息可捲動，完整紀錄留在右側。換局、換階段、換回合或切換重播會清除發言佇列。
- 頁面載入既有歷史不會假裝模型正在發言；語音條是視覺標記，沒有音訊或額外 API 呼叫。
- 投票階段保持中性表情。只有公開揭曉後，才依本輪公開得分增減使用微笑／驚訝；不用表情推測秘密策略。疑惑素材暫未自動觸發。
- 桌前鎖牌僅表示選色未揭曉，不能據此判斷某席是否已送出決策；五席統一揭曉後才顯示紅／藍。終局全知重播仍由既有後端權限控制。
- 右側可篩選全部紀錄或公開對話；開局設定收在「新對局 ＋」。手機採三席加兩席排列。尊重系統減少動態效果設定，頭像載入失敗顯示席位替代圖。

## 背景素材與生成提示

使用內建 `image_gen`，不是 CLI。參考上述選定概念圖，只取環境氣氛，無人物與文字。

- 圖檔：[`web/public/scenes/conservatory-v1.png`](../web/public/scenes/conservatory-v1.png)
- 原始生成位置：`C:/Users/Mystic/.codex/generated_images/01a1b85a-8ce0-7161-abc4-273b387585d1/exec-a191e6c3-44a7-4465-829d-84a77d68c0a6.png`
- 提示原文：

```text
Use case: illustration-story. Create a separate background environment illustration asset for this approved browser game UI reference. Reference is visual atmosphere only. Landscape 16:9. EMPTY nighttime Victorian conservatory negotiation room, graphic novel painterly illustration consistent with reference. Tall dark iron framed arched windows across background, misty blue green night beyond, dark ivy foliage at side margins, central slim brass architectural divider, muted deep forest green and near black palette, diffuse moonlight, restrained warm brass glints. Perspective camera eye height of seated spectator, symmetrical front view. Background is a subtle atmospheric layer BEHIND five existing foreground illustrated characters. Keep center and lower half visually quiet and dark for readability. NO PEOPLE, NO FACES, NO HEADS, NO CHARACTERS, NO TABLE, NO CHAIRS, NO FURNITURE in foreground, NO text, NO UI, NO labels, NO logo, NO buttons, no timer, no decorative frame. Only the empty architectural backdrop. Detailed but soft contrast, no bright distracting focal points. This asset will be cropped with CSS background-size cover.
```

## 驗證與後續

桌機版後續調整為依100dvh配置可用高度，涵蓋牌桌、字幕、操作列、頁尾與右側紀錄；低高度螢幕將計時器移到牌桌右上方。泡泡現在可顯示四行，新局設定使用浮層。桌機不需整頁捲動，歷史紀錄與超長訊息可在各自區域捲動。5／10／12局可於新局設定選擇。手機維持較適合閱讀的直向排列。

離線規則／串接／表情隱私測試102項、前後端型別檢查、build通過。Chrome scripted QA涵蓋開局、五席PNG載入、發言表情、揭曉前鎖牌、揭曉後顏色、即時私訊保密、全知重播開關、320／390／768／1100／1440／1920寬度與計時器不遮蔽名牌或選色牌，無頁面錯誤或靜態資源失敗。實際截圖已目視檢查；截圖來自腳本對局，不代表模型策略。

下一步為真人席位：先定義真人控制器的等待／提交／逾時行為，再增加僅該玩家可見的操作與私訊介面。觀戰版目前不顯示尚未接線的真人按鈕。
