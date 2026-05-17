# KPI 口徑差異核對（2026-05-17）

本次僅核對目前系統**實際採用**的 KPI 目標值來源，不修改任何 KPI 設定資料。

## 結論

目前系統對於 **智慧型手機 × Apple** 的啟用中產能設定，實際採用：

| 站點 | 目前啟用 dailyTargetQty | 對應 baseUnitPoints | 結論 |
|---|---:|---:|---|
| C | 159 | 0.006289 | 系統目前標準是 **159**，不是 160 |
| E | 400 | 0.002500 | 系統目前標準是 **400**，不是 300 |

## 依據

第一，資料庫 `productivity_target_configs` 目前對 `categoryName = 智慧型手機`、`brandName = Apple`、`stationCode in (C, E)` 的啟用列只有兩筆：

| id | stationCode | categoryName | brandName | subtypeCode | dailyTargetQty | active | effectiveFrom |
|---:|---|---|---|---|---:|---:|---|
| 30009 | C | 智慧型手機 | Apple | Apple | 159 | 1 | 2026-04-28 |
| 30064 | E | 智慧型手機 | Apple | Apple | 400 | 1 | 2026-04-28 |

第二，`server/db.ts` 的 `updateProductivityTarget()` 會直接把 `dailyTargetQty` 正規化後寫入 `productivity_target_configs`，並同步把 `baseUnitPoints` 算成 `1 / dailyTargetQty`。也就是說，後台設定值本身就是 KPI 分數口徑的來源，而不是另外存在一套隱藏公式。

第三，Google KPI 聚合函式 `buildAdminEngineerKpiProgressFromGoogleRows()` 會依商品實際對到的 `categoryId + subtypeCode + stationCode + 生效日期` 去解析 target config，最後直接使用該列的 `baseUnitPoints` 計分。因此只要目前 active 設定是 C=159、E=400，KPI 畫面就會照這兩個值計算。

## 差異判讀

從目前資料來看，**300** 與 **160** 都不是系統目前對「智慧型手機 × Apple」啟用中的正式設定值**。因此若使用者手算得到 E=300、C=160，較可能代表：

1. 手算依據的是舊版口徑或現場慣例，而不是目前後台設定；或
2. 手算是以不同品類/品牌的目標值混算；或
3. 後台應該更新設定，但尚未在 `productivity_target_configs` 內落地。

## 建議

如果要以**目前系統實際設定**為準，最終標準應採：**C = 159、E = 400**。

如果現場確認真正要改成 **C = 160、E = 300**，則不應再調整 KPI 聚合程式；應直接更新管理後台的 `productivity_target_configs`，讓設定值與現場口徑一致，這樣 Google KPI、後台 KPI 與報表才會一起一致。
