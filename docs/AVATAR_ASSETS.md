# 玩家圖檔交付

五人 × 中性／發言／微笑／疑惑／驚訝，共25張獨立透明PNG，位於web/public/avatars/A至E。未接入遊戲UI。外觀依使用者確認的概念圖，使用內建image_gen生成與編修，沒有使用CLI影像API。

交付實際尺寸全部為1254×1254，PNG總計約31.8MiB。瀏覽器已確認預覽頁25張全數解碼載入，並目視檢查角色及表情一致性。

- 素材與使用說明：[avatars README](../web/public/avatars/README.md)
- 離線預覽：[avatar-gallery.html](avatar-gallery.html)
- URL索引：[manifest.json](../web/public/avatars/manifest.json)
- 完整提示集合：[AVATAR_PROMPTS.json](AVATAR_PROMPTS.json)
- 原始造型提案：[players-concept-v1.png](art/players-concept-v1.png)

`npm.cmd run assets:check` 已唯讀驗證25張PNG的簽名、可解碼、透明像素、可見像素、角色內尺寸一致及各表情雜湊不重複。原圖不經程式裁切、縮放或去背。生成圖可能有細微線條差異；表情只是視覺素材，不代表模型人格／隱藏動機。

QA結果保存在ignored .npm-cache/avatar-qa/results.json。後續UI直接依manifest切換單張圖即可；不需切割五人拼圖，也不固定綁定任何LLM品牌。
