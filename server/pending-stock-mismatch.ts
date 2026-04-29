export type PendingStockMismatchBaseRow = {
  currentStationCode: string | null;
  currentStatus: string | null;
  poNumber: string | null;
  importedCategoryName: string | null;
  importedBrandName: string | null;
};

export function getPendingStockMismatchMissingFields(row: Pick<PendingStockMismatchBaseRow, "poNumber" | "importedCategoryName" | "importedBrandName">) {
  return [
    row.poNumber ? null : "採購單號",
    row.importedCategoryName ? null : "商品分類",
    row.importedBrandName ? null : "品牌",
  ].filter((value): value is string => Boolean(value));
}

export function isPendingStockImportMismatch(row: PendingStockMismatchBaseRow) {
  return row.currentStationCode === "STOCK"
    && row.currentStatus === "pending_stock"
    && getPendingStockMismatchMissingFields(row).length > 0;
}

export function buildPendingStockMismatchSummary(row: PendingStockMismatchBaseRow) {
  const missingFields = getPendingStockMismatchMissingFields(row);
  return {
    missingFields,
    missingFieldSummary: missingFields.join("、"),
    mismatchReason: `缺少${missingFields.join("、")}，尚未完成匯入比對`,
  };
}
