export type StationStockExportRow = {
  productCode: string;
  productName?: string | null;
  categoryName?: string | null;
  importedCategoryName?: string | null;
  subtypeCode?: string | null;
  brandName?: string | null;
  importedBrandName?: string | null;
  batchNo?: string | null;
  serialNumber?: string | null;
  imei?: string | null;
  poNumber?: string | null;
  taskStatus?: string | null;
  isOverdue?: boolean;
};

function escapeCsvCell(value: string | null | undefined) {
  const normalized = value ?? "";
  return `"${normalized.replaceAll('"', '""')}"`;
}

function resolveCategoryLabel(row: StationStockExportRow) {
  return [row.categoryName ?? row.importedCategoryName ?? row.subtypeCode ?? "-", row.brandName ?? row.importedBrandName ?? ""]
    .filter(Boolean)
    .join(" × ");
}

function resolveImportComparisonLabel(row: StationStockExportRow) {
  const missingFields: string[] = [];

  if (!row.poNumber) {
    missingFields.push("PO");
  }
  if (!row.importedCategoryName) {
    missingFields.push("商品分類");
  }
  if (!row.importedBrandName) {
    missingFields.push("品牌");
  }

  return missingFields.length === 0 ? "已完成匯入比對" : `尚未完成：缺少${missingFields.join("、")}`;
}

export function exportStationStockRowsToCsv(rows: StationStockExportRow[]) {
  const header = ["產品代碼", "品名", "品類", "批號", "序號", "IMEI", "採購單號", "匯入比對", "狀態"];
  const lines = rows.map((row) => [
    row.productCode,
    row.productName ?? "",
    resolveCategoryLabel(row),
    row.batchNo ?? "",
    row.serialNumber ?? "",
    row.imei ?? "",
    row.poNumber ?? "",
    resolveImportComparisonLabel(row),
    row.isOverdue ? "逾期" : (row.taskStatus ?? ""),
  ].map((value) => escapeCsvCell(value)).join(","));

  return [header.map((value) => escapeCsvCell(value)).join(","), ...lines].join("\n");
}

export function createUtf8CsvBlob(csvContent: string) {
  return new Blob(["\uFEFF", csvContent], { type: "text/csv;charset=utf-8;" });
}
