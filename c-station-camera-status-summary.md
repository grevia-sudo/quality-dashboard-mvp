# C 站鏡頭狀態本輪修改摘要

本輪已在專案中補上 **C 站鏡頭狀態** 的主要資料流，並依你的要求停止主動執行小規模測試，改由你後續手動驗證。這次修改的重點，是讓 C 站除了原本的 **螢幕狀態** 與 **機身外觀** 之外，再新增一個可多選的 **鏡頭狀態** 區塊，同時把管理後台的功能表設定與 Google Sheet 採購單同步一起接上。

| 範圍 | 已完成內容 |
| --- | --- |
| C 站作業頁 | 新增「C 站鏡頭狀態」區塊，使用啟用中的選項顯示核取方塊，並把選取結果帶入完成送出 payload。 |
| 管理後台 | 在「功能表設定」新增「C 站鏡頭狀態」卡片，可新增項目、調整排序、切換啟用狀態。 |
| 後端資料流 | `defectOptionType` 已擴充為 `camera`，`station.complete` 與 `completeStationTask` 已支援 `cameraOptionIds`。 |
| Google Sheet 同步 | 採購單同步欄位已重新整理為 **T 欄= C 站測試人員、U 欄= C 站完成時間、V 欄= 鏡頭狀態**。其中完成時間會維持 `YYYY/MM/DD HH:mm` 格式，鏡頭狀態未勾選時預設寫入「正常」。 |

目前已實作的檔案調整集中在以下位置：

| 檔案 | 說明 |
| --- | --- |
| `drizzle/schema.ts` | 將 defect option 類型擴充為 `fault / appearance / camera`。 |
| `server/routers.ts` | station 與 admin 的 API schema 新增 `camera` / `cameraOptionIds` 支援。 |
| `server/db.ts` | 新增 `cameraOptions` 查詢、C 站完成時的 `cameraLabels` 與 `cCameraSummary` 寫入。 |
| `client/src/pages/StationPage.tsx` | 新增 C 站鏡頭狀態 UI 與送出 payload。 |
| `client/src/pages/AdminPage.tsx` | 新增 C 站鏡頭狀態功能表設定區塊與統計。 |
| `scripts/purchase-sheet-sync-helpers.mjs` | 採購單表頭改為支援 **T=測試人員、U=完成時間、V=鏡頭狀態** 的輸出順序。 |
| `scripts/sync-purchase-sheet.mjs` | Google Sheet 範圍擴充為 **A:V**，並加入 `cOperatorName`、`cCompletedAt`、`cCameraSummary` 的查詢與回寫。 |

接下來建議你手動驗證三件事。第一，是在管理後台新增或啟用一個 C 站鏡頭狀態項目後，重新整理 C 站頁面，確認該選項會出現。第二，是在 C 站勾選一個以上鏡頭狀態後完成作業，確認流程能正常推進。第三，是到 Google Sheet 的採購單工作表查看對應列，確認 **T 欄** 會寫入 C 站測試人員、**U 欄** 會寫入 C 站完成時間、**V 欄** 會寫入鏡頭狀態；若鏡頭未勾選則應回寫「正常」。 
