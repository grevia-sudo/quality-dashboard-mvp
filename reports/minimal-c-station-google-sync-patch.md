# C 站資料未寫回 Google 的最小修改版程式碼

這份 patch 只做**最小風險止血**，目標不是重寫整個同步架構，而是先避免像 `00500025301`、`00500025299` 這種「系統顯示 C 已完成，但 Google 採購單 C 欄位仍為空白」的情況再次發生。

## 修改目標

目前最可疑的點，不是沒有入列同步，也不是 Google API 明確失敗，而是 **C 站欄位刷新條件過於保守**。因此最小修改版只做兩件事：

| 檔案 | 修改目的 |
|---|---|
| `scripts/purchase-sheet-sync-helpers.mjs` | 只要本地已有 C 站資料，就強制刷新 C 區塊欄位，不再讓 Google 舊空白被保留 |
| `scripts/sync-purchase-sheet.mjs` | 在寫回後做一次輕量驗證；若本地有 C 完成時間、但 Google 該列 C 完成時間仍空白，直接視為失敗 |

## Patch 1：強制刷新 C 區塊欄位

請在 `scripts/purchase-sheet-sync-helpers.mjs` 中，找到目前用來判斷 refresh indexes 的函式，將 C 區塊改成下列寫法。

```js
function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function hasCStageData(product) {
  return (
    hasValue(product.cCompletedAt) ||
    hasValue(product.cOperatorName) ||
    hasValue(product.cFaultSummary) ||
    hasValue(product.cAppearanceSummary) ||
    hasValue(product.cLensSummary) ||
    hasValue(product.cFinalStatus) ||
    hasValue(product.cModifiedBStatusFlag)
  );
}
```

接著把原本 `getSheetRefreshIndexes(product)` 中判斷 C 站欄位是否要刷新的那段，改成下面這個版本。

```js
export function getSheetRefreshIndexes(product) {
  const refreshIndexes = new Set();

  // 其餘 A1 / A2 / B / D / E 原本邏輯保持不動

  const cShouldRefresh = hasCStageData(product);

  if (cShouldRefresh) {
    // 依你目前採購單欄位配置，把 C 站相關欄位全部納入
    // 下面 index 名稱請替換成你專案中現有的常數或實際索引
    ;[
      SHEET_INDEXES.cOperatorName,
      SHEET_INDEXES.cCompletedAt,
      SHEET_INDEXES.cFinalStatus,
      SHEET_INDEXES.cFaultSummary,
      SHEET_INDEXES.cAppearanceSummary,
      SHEET_INDEXES.cLensSummary,
      SHEET_INDEXES.cModifiedBStatusFlag,
    ].forEach((index) => {
      if (Number.isInteger(index)) {
        refreshIndexes.add(index);
      }
    });
  }

  return [...refreshIndexes].sort((a, b) => a - b);
}
```

這一段的核心意義是：**只要本地商品已有任何 C 站資料，就不要再相信 Google 舊值**。這樣即使 `lastSheetSyncedAt` 或批次快照判斷失準，也不會把 C 欄位留成空白。

## Patch 2：同步後加一個最小驗證

再來請在 `scripts/sync-purchase-sheet.mjs` 裡，實際呼叫 Google 更新成功之後、把 job 標成 success 之前，加入下列輕量驗證。

```js
function isBlankCell(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function assertCStageWritten(product, writtenRow) {
  const localHasCCompleted = !isBlankCell(product.cCompletedAt);
  if (!localHasCCompleted) return;

  const googleCCompletedAt = writtenRow[SHEET_INDEXES.cCompletedAt];
  if (isBlankCell(googleCCompletedAt)) {
    throw new Error(
      `Google 採購單 C 欄位未寫入：productId=${product.id}, batch=${product.batchNumber ?? ''}`
    );
  }
}
```

然後在每筆商品完成列值組裝並更新到 Google 之後，補一行驗證：

```js
const generatedRow = buildSheetRow(product, existingSheetRow);
await updateSheetRow(sheetClient, targetRowNumber, generatedRow);
assertCStageWritten(product, generatedRow);
```

如果你目前更新流程不是 `generatedRow` 直接送出，而是先 merge 再 batch update，也一樣在**最終送出的 row array** 上驗證即可。重點不是讀回 Google，而是先確保「你這次要寫出去的內容」真的含有 C 完成時間。這是最小成本、但能立即抓出假成功的方法。

## 為什麼這樣改是最小風險

這版 patch 的好處，是它**不改資料表、不改 job schema、不改整個 worker 架構**。它只是在原本流程上補兩個保護：一個保證 C 欄位應刷就刷，另一個保證 success 前至少先驗證這筆 row 不是空的。

| 修法 | 風險 | 效果 |
|---|---|---|
| 強制刷新 C 區塊 | 低 | 直接避免 Google 舊空白覆蓋本地新值 |
| success 前驗證 C 欄位 | 低 | 阻止「job success 但 C 欄位沒值」 |
| 重構 job 改為 product 級同步 | 高 | 更完整，但不是最小修改 |

## 建議補的測試

如果你要一起補測試，最少補下面兩個案例就夠止血。

| 測試名稱 | 驗證內容 |
|---|---|
| `should_refresh_c_indexes_when_c_stage_has_data` | 只要 `cCompletedAt` 或 `cMeta` 有值，C 區塊索引就必須被加入 refreshIndexes |
| `should_throw_when_c_completed_but_generated_row_still_has_blank_c_completed_at` | 本地已有 C 完成時間，但最終 row 的 C 完成時間欄位仍空白時，應拋錯而不是標 success |

## 建議套用順序

建議你先只套用 Patch 1 與 Patch 2。這樣可以先止血，再觀察是否還會出現新的 C 漏寫案例。如果止血後仍偶發，就代表下一步要處理的才是**同步快照過舊**與**job 粒度太粗**，那時再往 `sheet_sync_jobs` 綁 productIds 的方向重構即可。
