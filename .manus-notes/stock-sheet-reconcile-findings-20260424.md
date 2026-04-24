# 待入庫 Google Sheet 比對驗證紀錄

## 已確認的來源

- Spreadsheet ID：`1JgtjGPwL8MXQLFUKi5OSx3wubgpSX4n4MFcj-iHgEW0`
- 工作表：`進貨明細`
- 比對欄位：`F`
- GID：`806211245`

## 存取結果

使用 service account 直接讀取 Spreadsheet metadata 成功，且 `gid=806211245` 對應標題為 `進貨明細`。

使用一次性腳本直接讀取 `進貨明細!F:F` 成功，表示目前 service account 已可讀取該欄資料。

## 自動移除待入庫驗證

使用一次性腳本 `scripts/verify-stock-sheet-reconcile.mjs` 建立一筆待入庫測試資料：

- 測試批號：`00500007550`
- 建立前：`currentStatus = pending_stock`、`taskStatus = pending`
- 觸發方式：呼叫 `getStationPageData("STOCK")`
- 觸發後：`currentStatus = completed`、`stockStatus = stocked`、`taskStatus = completed`
- 結果摘要：`外部進貨明細批號比對成功，自動移除待入庫`
- 事件紀錄：已寫入 `station_events`，包含 `matchedSpreadsheetId`、`matchedSheetId = 806211245`、`matchedColumn = F`
- 清單結果：`stockTaskStillVisible = false`

## 日誌觀察

最新檢查時只看到較早時間點的舊錯誤紀錄：

- `[2026-04-24T01:43:23.719Z] [stock-sheet-reconcile] failed Error: Request had insufficient authentication scopes.`

在本次成功驗證之後，未再觀察到新的同類錯誤紀錄。
