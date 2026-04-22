# 採購單每日同步說明

本專案已將 **本地資料庫補寫 Google Sheet「採購單」工作表** 的邏輯抽成可重建腳本。同步目標試算表為：`15uKVOc13iVhs2ffT9FWgKti47s38Hl_Zyjht6o7HU_Y`，工作表名稱為 **採購單**。

## 同步規則

系統只會處理同時符合下列條件的資料列：已填 **廠商**、已選 **商品分類**，且 **商品批號／商品序號／IMEI** 至少一項有值。若資料已對應到試算表既有列，系統會依 **IMEI → 商品序號 → 商品批號** 的順序比對，找到列後只補上工作表中仍為空白的欄位，不覆寫使用者已填寫的非空內容。若找不到既有列，才會在工作表尾端新增一列。

| 工作表欄位 | 本地資料來源 |
| --- | --- |
| 採購單號 | `products.poNumber` |
| 廠商 | `products.vendorName` |
| 商品分類 | `product_categories.subtypeCode`，若無則退回 `categoryName` |
| 商品批號 | `products.batchNo` |
| 商品序號 | `products.serialNumber` |
| IMEI | `products.imei` |
| 品名 | `products.productName` |

## 手動執行

在專案根目錄執行以下指令即可手動補寫一次：

```bash
pnpm sync:purchase-sheet
```

成功時會輸出 JSON 摘要，例如 `processedCount`、`appendedCount`、`updatedCount`。

## 每日排程重建方式

目前環境已建立每日排程，預設於 **每日 01:00（系統時區）** 執行同步。若需要在新環境重建，請重新建立同等排程，內容為：在 `/home/ubuntu/quality-dashboard-mvp` 執行 `pnpm sync:purchase-sheet`。

## 驗證建議

建議至少用一筆以下情境驗證：先匯入只含 **廠商、商品分類、IMEI** 的資料，再到 A1 補上 **商品批號、商品序號、品名**，之後執行同步。預期結果是同一列被補齊缺漏欄位，而不是新增第二列，也不會覆蓋工作表中既有的非空內容。
