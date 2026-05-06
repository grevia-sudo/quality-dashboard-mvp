export type PendingStockMismatchBaseRow = {
  currentStationCode: string | null;
  currentStatus: string | null;
  poNumber: string | null;
  importedCategoryName: string | null;
  importedBrandName: string | null;
  sheetRowNumber?: number | null;
  lastSheetSyncedAt?: string | Date | null;
};

function hasGoogleSheetSyncPending(row: Pick<PendingStockMismatchBaseRow, "sheetRowNumber" | "lastSheetSyncedAt">) {
  return !row.sheetRowNumber || !row.lastSheetSyncedAt;
}

function hasEnteredPostA1Flow(row: Pick<PendingStockMismatchBaseRow, "currentStationCode" | "currentStatus">) {
  if (!row.currentStationCode || !row.currentStatus) {
    return false;
  }

  return !(row.currentStationCode === "A1" && row.currentStatus === "pending_a1")
    && row.currentStatus !== "completed"
    && row.currentStatus !== "archived";
}

export function getPendingStockMismatchMissingFields(
  row: Pick<PendingStockMismatchBaseRow, "poNumber" | "importedCategoryName" | "importedBrandName" | "sheetRowNumber" | "lastSheetSyncedAt">,
) {
  return [
    row.poNumber ? null : "採購單號",
    row.importedCategoryName ? null : "商品分類",
    row.importedBrandName ? null : "品牌",
    hasGoogleSheetSyncPending(row) ? "Google 回寫" : null,
  ].filter((value): value is string => Boolean(value));
}

export function isPendingStockImportMismatch(row: PendingStockMismatchBaseRow) {
  return hasEnteredPostA1Flow(row) && getPendingStockMismatchMissingFields(row).length > 0;
}

export function buildPendingStockMismatchSummary(row: PendingStockMismatchBaseRow) {
  const missingFields = getPendingStockMismatchMissingFields(row);
  const importMissingFields = missingFields.filter((field) => field !== "Google 回寫");
  const googleSyncPending = missingFields.includes("Google 回寫");

  let mismatchReason = "已刷入系統，等待背景回寫 Google";
  if (importMissingFields.length > 0 && googleSyncPending) {
    mismatchReason = `缺少${importMissingFields.join("、")}，已刷入系統但尚未完成匯入比對，Google 尚未回寫`;
  } else if (importMissingFields.length > 0) {
    mismatchReason = `缺少${importMissingFields.join("、")}，已刷入系統但尚未完成匯入比對`;
  }

  return {
    missingFields,
    missingFieldSummary: missingFields.join("、"),
    mismatchReason,
    googleSyncPending,
    googleSyncStatusLabel: googleSyncPending ? "尚未回寫 Google" : "Google 已回寫",
    flowStageLabel: importMissingFields.length > 0 ? "已刷入待補匯入" : "已刷入待同步",
  };
}
