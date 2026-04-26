# 各站 completedAt 時間來源盤點

目前已確認的程式現況如下：

| 節點 | 前端是否送出 businessDate | 後端 completedAt 來源 | stationEvents.businessDate 來源 |
| --- | --- | --- | --- |
| A1 | 否 | `completeA1ArrivalByScan()` 內的 `new Date()` | `todayDateString()` 組成的當日 00:00 |
| A2 / B / C / E | 否，`StationPage.tsx` 的 `basePayload` 未包含 businessDate | `completeStationTask()` 內的 `new Date()` | `todayDateString()` 組成的當日 00:00 |
| D | 否 | `submitSamplingResult()` 內的 `new Date()` | `todayDateString()` 組成的當日 00:00 |

這表示目前各站完成時間的真正來源其實相當一致：**都是後端在收到請求時直接用 `new Date()` 寫入**；前端並沒有傳入各站自己的完成日期。若後續仍出現 Google Sheet 時差問題，優先懷疑點會落在：

1. 資料庫連線或資料表 timestamp 欄位的時區解讀。
2. Google Sheet 同步腳本的查詢與格式化流程。
3. 個別欄位是否讀取到錯誤的站點 completedAt。

## 最新異常案例

剛以 `scripts/verify-stage-sheet-times.mjs` 實測最近已同步的案例，發現 **productId 360512 / serialNumber R5CW32ZDVJE / sheet row 17** 仍存在一筆真實異常：

| 欄位 | 資料庫預期 | Google Sheet 實際 | 是否一致 |
| --- | --- | --- | --- |
| A1（H 欄） | `2026/04/22 23:19` | `2026/04/22 23:19` | 是 |
| A2（J 欄） | `2026/04/23 23:52` | `2026/04/24 03:52` | 否，**快 4 小時** |
| B（L 欄） | `2026/04/24 17:39` | `2026/04/24 17:39` | 是 |
| C（U 欄） | `2026/04/26 14:26` | `2026/04/26 14:26` | 是 |

這代表目前問題不是所有站點都錯，而是**至少 A2 的既有資料仍可能保留舊格式或舊時區結果**。下一步需要追查：

1. 這筆 A2 是否在舊邏輯下先被寫入過 Google Sheet，後續沒有被 refresh。
2. `getSheetRefreshIndexes()` 對 A2 的覆寫條件是否在某些情境下沒有觸發。
3. `lastSheetSyncedAt` 與 `a2CompletedAt` 的先後關係，是否導致同步腳本誤判為不需要更新。

目前已可初步判斷成因：異常案例 `360512` 的 `lastSheetSyncedAt = 2026-04-26T06:26:36.000Z`，晚於 `a2CompletedAt = 2026-04-23T15:52:51.000Z`。因此當後續 C 站完成並再次觸發採購單同步時，`getSheetRefreshIndexes()` 只會刷新 C 站相關欄位，不會再回刷 A2 的 J/K 欄。若該列 A2 欄位先前曾在舊邏輯下寫入錯誤時區值，之後就會被保留下來，形成目前看到的 **只有 A2 還快 4 小時、但 B/C 已正常** 的現象。

## 修正與最終驗證

已完成兩個層面的修補。第一，調整 `scripts/purchase-sheet-sync-helpers.mjs` 的 `getSheetRefreshIndexes()`，讓較後段站點完成時，會一併回刷前段站點的**完成時間與執行人欄位**，避免像 A2 這種較早欄位因後續只刷新 C 站欄位而永久保留舊錯值。第二，新增 `scripts/repair-stage-sheet-times.mjs`，可直接以資料庫為準批次校正 Google Sheet 中既有歷史列的 A1～E 時間／人員欄位。

實際修復後，再次執行修復腳本已得到：

| 指標 | 結果 |
| --- | --- |
| 待修復列數 | `0` |
| 代表性異常案例 `360512` A2 欄位 | 已由 `2026/04/24 03:52` 校正為 `2026/04/23 23:52` |
| 最近驗證樣本 | `360516`、`360512`、`360521` 全部各站欄位一致 |

目前可合理判斷：**歷史上殘留的 4 小時偏移資料已被回填修正，且之後只要有較後段站點完成，也會連帶把前段時間欄位重新回刷，不會再讓舊錯值長期殘留。**
