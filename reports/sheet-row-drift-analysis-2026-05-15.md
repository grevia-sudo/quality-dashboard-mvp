# `sheetRowNumber` 跑位風險分析與預防措施

本報告針對回收品檢系統 MVP 目前使用的 `products.sheetRowNumber` 機制，整理**所有主要可能導致跑位的操作類型**，並提出**不進行任何 Google Sheets 寫入**前提下可落地的程式層預防方案。結論先講在前：目前的 `sheetRowNumber` 本質上是**Google 採購單的絕對列號快照**，只要 Google 主表在該筆資料上方發生插列、刪列、移動或重排，而資料庫沒有同步重編，既有 row 綁定就會立刻過時。[1] [2]

本次已確認的實際案例，就是 **Google 第 604 列被手動刪除後，下方所有列號整體前移 1 列，但資料庫仍保留舊 row**，因此 `PO-20260514-03` 的整段 `sheetRowNumber` 由 `681–777` 變成實際應為 `680–776`。這是最典型也最危險的一類：**上方結構變更造成下方整段固定位移**。

| 類型 | 具體操作 | 對列號的影響模式 | 是否已在本案發生 | 風險等級 |
| --- | --- | --- | --- | --- |
| 結構性位移 | 在 Google 刪除列 | 下方所有列 `-N` | 是 | 高 |
| 結構性位移 | 在 Google 插入列 | 下方所有列 `+N` | 尚未確認，但一定可能 | 高 |
| 非固定重排 | 在 Google 移動列、剪下貼上、排序 | 受影響資料列重新分配，不是固定偏移 | 尚未確認，但一定可能 | 高 |
| 寫入競爭 | 同步程序用舊快照 append / update | 新增列號或重找結果可能即刻過時 | 尚未證實，但程式上存在可能 | 中高 |
| 誤重綁 | 以批號優先重找命中錯列 | 看起來像 row 跑位，實際是重綁錯列 | 已有相近風險案例 | 中高 |
| 部分失敗 | Google 寫入成功但 DB 未更新，或反之 | DB 與主表 row 記錄分離 | 已見背景同步連線中斷類型問題 | 中 |

## 一、會直接導致 `sheetRowNumber` 跑位的操作

最直接的一類，是**任何會改變 Google 實際列序的操作**。因為系統把 row number 存進資料庫，後續多數流程又會優先相信這個數字，所以只要表格結構先變、資料庫後變，跑位就會發生。[1] [2]

### 1. 手動刪除 Google 列

這是本次已確認根因。只要刪除發生在某筆商品的上方，該筆以下所有列號都會整體前移。例如刪除第 604 列，原本第 681 列的資料會實際移到第 680 列，但 DB 仍記 681。這會造成兩種後果：其一，背景同步若尚未執行，任何依賴舊 row 的流程都會先讀錯列；其二，A1 補錄防重若要求「同批號空白列且必須是同一 row」，就會被舊 row 卡住。[2] [5]

### 2. 手動插入 Google 列

這與刪列相反。若在某段資料上方插入 1 列，該段以下的 `sheetRowNumber` 都會整體 `+1` 過時。這種情況在症狀上會跟本次案例完全對稱：系統以為資料在第 680 列，但 Google 實際已在第 681 列。因為目前 `sync-purchase-sheet.mjs` 只在同步當下才有機會偵測 stored row 是否失準並重找，其他先發生的業務流程仍可能先吃到舊值。[2]

### 3. 手動移動列、剪下貼上、排序整張表或局部區段

這一類比刪列、插列更危險，因為它不是「整段固定偏移」，而是**局部重排**。系統原本記錄的列號可能仍然存在，但那一列已經是別的商品。`sync-purchase-sheet.mjs` 會先檢查 stored row 是否仍為同一筆，若不是才進入全表重找；然而在這個重新對位發生前，其他流程仍可能先讀到錯列。[2] 更麻煩的是，若 Google 上存在同批號多列，重找時又採用批號優先規則，就可能把商品綁到另一筆同批號列，而不是單純「少 1 / 多 1」。[3]

### 4. 系統端的列刪除同步

`server/purchase-sheet-delete-sync.ts` 目前是**真的發出 `deleteDimension` 刪列**，而不是只做刪除線標記。[4] 這代表即便不是使用者手動刪列，只要系統刪除了某些採購單對應列，這些列下方的所有商品 row 也會整體前移。雖然程式有把待刪 row 由大到小排序，以避免「同一批刪除請求彼此影響」[4]，但它**不會在刪完後同步重編所有其他仍存在商品的 `sheetRowNumber`**。因此，只要之後沒有立刻跑完整的重找與回填，下方資料仍然會處於過時狀態。

## 二、會間接造成「看起來像跑位」的操作

第二類不是 Google 表格真的移動了列，而是**系統用舊快照、弱匹配或部分失敗狀態，讓 DB 中的 row 記錄與 Google 真實位置分離**。這在外觀上也會表現成 `sheetRowNumber` 跑位。

### 5. 背景同步使用舊快照後再 append

`scripts/sync-purchase-sheet.mjs` 會先一次讀入整張表成 `normalizedValues`，之後用這份快照決定要更新既有列，還是 append 新列；若找不到，會直接把新列號當成 `normalizedValues.length + 1`。[2] 這意味著若在**讀表之後、append 之前**，Google 上又有其他人或其他流程插入／刪除／append 了列，本地計算出的 `appendedRowNumber` 就可能立刻過時。

這個風險在「單一程序、單一寫入者」時較低，但目前 `server/db.ts` 的背景同步保護只是一個**程序內 Promise 鎖**，能避免同一個 Node 行程同時重入，卻沒有資料庫層或分散式鎖來保證跨程序唯一執行。[1] 再加上同步腳本最後是把所有 queued job 一次標記為 success，而不是先 claim 單一 job 再執行，[2] 如果未來同時存在多個 worker 或多個部署實例，理論上就有「兩邊拿到不同快照，各自 append」的風險。

### 6. 背景同步中途失敗，Google 與 DB 只更新了一邊

同步腳本是在成功 update / append 後，才 `UPDATE products SET sheetRowNumber = ?, lastSheetSyncedAt = CURRENT_TIMESTAMP`。[2] 這樣的順序可以避免 DB 先記錄一個尚未寫成功的 row，但也帶來另一種不一致：如果 Google 端已成功 append，而 DB 更新時資料庫連線中斷，就會出現「Google 已有新列、DB 仍保留舊 row 或 null」的狀態。這不一定是固定偏移，但它會讓後續流程看到失真的 `sheetRowNumber`，症狀上與跑位相似。

### 7. 以批號優先的重新對位，命中錯列

`matchesSheetRow()` 目前只要**批號相同就直接視為同一列**，其次才是序號與 IMEI 同時吻合。[3] 這個設計在「Google 主表只有一列同批號」時很方便，因為可以把固定偏移的列快速找回來；但當 Google 中存在重複批號、測試殘留列、被刪除 PO 留下的同批號舊列、或人工複製資料時，重新對位就可能命中錯列。

這種情況下，Google 的實際列號未必有變，但**DB 中的 `sheetRowNumber` 會被重新綁到另一列**，對現場來說仍然會被解讀為 row 跑位。這也是為什麼本輪分析不應只看「有沒有刪列」，還要把「重找時綁錯列」視為同級風險。

### 8. 既有 row 非空時仍被直接信任，不做再驗證

`resolvePurchaseSheetRowNumber()` 在 `sheetRowNumber` 已存在時，會**直接回傳既有值，不會先驗證該列是否仍為同一筆**。[6] 這代表像 E 站照片回寫這類流程，只要產品身上有舊 row，就可能直接寫到錯列，根本不會啟動重找。這不是造成跑位的源頭，但它會讓**原本只是 row 過時**的問題，進一步變成**實際寫錯列**。

## 三、哪些操作其實不是 row 跑位的真正成因

為了避免後續排查方向失焦，也需要區分幾類常被誤認為跑位、但本質不同的情況。

| 情況 | 是否改變 Google 列號 | 是否會表現成 row 問題 | 正確定義 |
| --- | --- | --- | --- |
| 單純修改儲存格值 | 否 | 低 | 內容異常，不是 row 跑位 |
| Google 寫入失敗但完全未寫入 | 否 | 中 | 同步失敗，不是位移 |
| DB 產品狀態未推進到下一站 | 否 | 中 | 流程狀態異常，不是 row 位移 |
| 重找邏輯命中錯列 | 否（或不一定） | 高 | 對位錯誤，外觀上像跑位 |

因此，後續若再遇到「A1 被擋」「照片寫錯列」「某 PO 只剩少數列看起來對得上」等症狀，不應第一時間只問有沒有刪列，而要同時確認：是否發生過插列／移動／排序、是否有背景同步 append 競爭、是否存在同批號舊列、以及該流程有沒有在寫入前驗證 stored row 是否仍然正確。

## 四、建議的預防措施

真正可行的防線，不是禁止一切 row 變動，而是把系統從「**盲信舊 row**」改成「**先驗證、再重找、最後才寫入**」，並且把高風險流程中的重找策略做得更保守。

### 建議一：所有依賴 `sheetRowNumber` 的寫入前，都先做輕量 row 驗證

這是優先級最高的一項。具體做法是：凡是要用 `sheetRowNumber` 對 Google 讀／寫前，先讀取該 row 的 A:F 或 A:G，確認批號、序號、IMEI 至少命中安全條件；若不命中，就不要直接沿用，而是進入全表重找。這能覆蓋 A1 補錄、防重判斷、E 站照片回寫，以及背景同步 update 既有列等場景。[2] [5] [6]

### 建議二：將「stored row 驗證 + 全表重找」抽成共用 helper

目前有些流程會重找，有些不會；有些只在 `sheetRowNumber` 為 null 才重找，有些則完全依賴既有值。這會導致同一種 row 漂移在不同流程下有不同後果。建議新增一個統一 helper，例如 `resolveVerifiedPurchaseSheetRowNumber()`，流程如下：先驗 stored row；不符則用 identity / batch 進行全表重找；若找到新 row，回傳新值並由呼叫端決定是否同步更新 DB；若找不到，才視為真正找不到列。這能讓 A1、防重、E 站與背景同步使用同一套準則。

### 建議三：把重找規則從「批號命中即可」提升為「分層信心制」

目前 `matchesSheetRow()` 只要同批號即視為命中。[3] 這雖然有利於補救固定偏移，但在重複批號存在時風險太高。建議改成分層判定：

| 信心層級 | 建議條件 | 處理方式 |
| --- | --- | --- |
| 高 | 序號命中，或 IMEI 命中，或序號+IMEI 同時命中 | 直接接受 |
| 中 | 批號命中且該批號在整張表唯一 | 接受，但記錄來源 |
| 低 | 只有批號命中，但同批號多列 | 不自動重綁，回報衝突 |
| 禁止 | 批號命中但 PO / 其他關鍵欄位顯著矛盾 | 視為錯列，不接受 |

這樣可以避免「為了修 row 漂移，反而把商品綁去另一筆同批號列」。

### 建議四：A1 補錄前先做 row 重新確認，而不是直接拿 `matchedProduct.sheetRowNumber`

目前 A1 的 `allowBlankIdentitySupplementRowNumber` 直接使用 `matchedProduct?.sheetRowNumber`。[5] 一旦這個值過時，合法補錄就會被擋。建議改為：A1 在送入 `findGooglePurchaseSheetBatchConflict()` 前，先透過共用 helper 對 matched product 做一次輕量 row 驗證；若原 row 已失準，就先取得新 row，再把新 row 當成 allowed supplement target。這是本案最能直接解決現場「明明同一筆卻刷不進去」的措施。

### 建議五：E 站照片回寫不得再盲信非空 row

`resolvePurchaseSheetRowNumber()` 目前在 row 非空時直接回傳。[6] 建議改為與前述共用 helper 接軌：非空不等於可信，仍需先驗證該 row 的 identity。這樣即使 Google 主表先前被插列或刪列，E 站照片也不會直接寫錯 AC、AD。

### 建議六：背景同步 append 前後加入「再確認」與「不以本地推算 row 為唯一真值」

目前 append 新列後，row 直接用 `normalizedValues.length + 1` 推定。[2] 建議在 append 後再用 response 或立即重讀定位新列，至少不要把「append 前本地快照長度」當成最終真值。如果考量效能，也可只對 append 分支做再確認，而不是每次 update 都重讀。

### 建議七：增加 row 漂移偵測與告警，而不是等現場 A1 被卡才發現

由於本次已證明 row 漂移可能呈現「整段固定 -1」，建議新增一個唯讀稽核程序，定期抽樣或掃描近期活躍商品，檢查 `sheetRowNumber` 對應列是否仍為同一筆；若連續多筆出現同一方向的固定偏移，就標示為「疑似整段漂移」。這類偵測不需要寫入 Google，只需要讀表與更新本地告警紀錄即可。

### 建議八：從中長期架構上，降低對絕對列號的依賴

若要根治，最終方向仍是把 `sheetRowNumber` 降級為**快取欄位**，而不是主識別。系統真正的對位主鍵應該來自較穩定的業務識別，例如批號 + 序號 / IMEI 的組合，或未來可考慮在本地維護一份 Google mirror 對照資料。[1] 只要絕對列號仍是第一優先識別，Google 任何上方結構變更都會持續製造同類事件。

## 五、建議的實作優先順序

若要控制風險並盡快止血，我建議先做以下順序，而不是一次大改整個同步架構。

| 優先級 | 建議措施 | 原因 |
| --- | --- | --- |
| P0 | A1 防重前先驗證/重找 row | 直接解決現場刷入阻擋 |
| P0 | E 站照片回寫前驗證 stored row | 避免把照片寫到錯列 |
| P1 | 共用 `resolveVerifiedPurchaseSheetRowNumber()` | 統一所有流程的 row 信任邏輯 |
| P1 | 重找規則改為分層信心制 | 降低同批號誤綁 |
| P1 | append 分支再確認最終 row | 降低同步競爭造成的新漂移 |
| P2 | 新增 row 漂移稽核/告警 | 提早發現整段位移 |
| P3 | 中長期改為 business identity 主導、row 為快取 | 根治絕對列號脆弱性 |

## 結論

本次 `sheetRowNumber` 跑位問題，**已確認根因之一是 Google 上方列被刪除後，DB 的絕對列號未同步重編**。但若只把問題理解成「手動刪列」，仍然太狹窄。任何會改變列序的操作——包括插列、移動、排序、系統端 deleteDimension——都會造成相同風險；而同步快照過時、批號優先重找、以及對非空 row 的盲信，則會把這些風險放大成誤阻擋、誤重綁或實際寫錯列。[2] [3] [4] [5] [6]

因此，最重要的預防方向不是「假設 row 永遠不變」，而是讓系統在每次關鍵操作前都先回答一個問題：**資料庫現在記的這個 row，是否仍然是同一筆商品？** 只要這一層驗證補起來，再配合更保守的重找策略與 append 後再確認，即使未來 Google 主表再次發生列序變動，也能把影響從「整段流程卡住或寫錯列」縮小成「單筆可自我修正」。

## References

[1]: file:///home/ubuntu/quality-dashboard-mvp/server/db.ts "server/db.ts"
[2]: file:///home/ubuntu/quality-dashboard-mvp/scripts/sync-purchase-sheet.mjs "scripts/sync-purchase-sheet.mjs"
[3]: file:///home/ubuntu/quality-dashboard-mvp/scripts/purchase-sheet-sync-helpers.mjs "scripts/purchase-sheet-sync-helpers.mjs"
[4]: file:///home/ubuntu/quality-dashboard-mvp/server/purchase-sheet-delete-sync.ts "server/purchase-sheet-delete-sync.ts"
[5]: file:///home/ubuntu/quality-dashboard-mvp/server/db.ts#L2212-L2358 "A1 Google 批號衝突與補錄放寬邏輯"
[6]: file:///home/ubuntu/quality-dashboard-mvp/server/db.ts#L1261-L1305 "E 站照片回寫 row 解析邏輯"
