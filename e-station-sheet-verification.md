# E 站 Google Sheet 完成時間與回寫驗證

本輪針對 **E 站抹除完成後的 Google Sheet 回寫** 進行盤點與實測，確認採購單工作表目前的欄位對應為：**Z 欄 = E 站抹除完成時間**、**AA 欄 = E 站測試人員**。同步格式由 `scripts/purchase-sheet-sync-helpers.mjs` 的 `PURCHASE_SHEET_HEADER` 與 `buildSheetRow()` 決定，其中 `eCompletedAt` 會寫入第 26 欄、`eOperatorName` 會寫入第 27 欄，並透過 `formatSheetDateTime()` 轉成 `YYYY/MM/DD HH:mm` 的台北時區格式。

## 最新驗證案例

| 項目 | 值 |
| --- | --- |
| 商品序號 | `YLXGHQXR36` |
| 採購單號 | `PO-20260422-41` |
| Google Sheet 列號 | `9` |
| 資料庫 E 站完成時間（UTC） | `2026-04-23T17:12:24.000Z` |
| 預期寫回時間（台北） | `2026/04/24 01:12` |
| Google Sheet Z 欄實際值 | `2026/04/24 01:12` |
| 預期測試人員 | `綠途未來股份有限公司` |
| Google Sheet AA 欄實際值 | `綠途未來股份有限公司` |
| 比對結果 | **時間一致、執行人一致** |

## 本輪補強

本輪另外補上一個可重複執行的驗證腳本 `scripts/verify-e-sheet-sync.mjs`，可直接從資料庫抓出最近已同步的 E 站案例，再向 Google Sheet 讀回對應列，比對 Z/AA 欄是否與資料庫一致。同時也在 `server/purchase-sheet-sync.test.ts` 新增單元測試，明確驗證 E 站時間與執行人會落在尾端兩欄，且 E 站更新時 refresh indexes 會正確覆蓋 25、26 兩個欄位。

## 結論

目前 E 站的 Google Sheet 回寫邏輯已可正常運作，且本次實測案例證明：**Z 欄會寫入正確的現場時間，AA 欄會寫入對應的執行人員**。因此，先前 E 站完成時間時差與回寫未確證的問題，在目前版本中已具備可驗證的程式證據與實際資料證據。
