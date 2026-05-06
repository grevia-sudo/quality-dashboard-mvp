export type PendingStockMismatchRow = {
  productCode: string | null;
  productName: string | null;
  batchNo: string | null;
  serialNumber: string | null;
  imei: string | null;
  poNumber: string | null;
  vendorName?: string | null;
  importedCategoryName?: string | null;
  importedBrandName?: string | null;
  assignedCategoryName?: string | null;
  assignedBrandName?: string | null;
  currentStationCode?: string | null;
  currentStatus?: string | null;
  productId?: number;
  stockTaskId?: number | null;
  stockTaskStatus?: string | null;
  arrivalAt?: string | Date | null;
  stockTaskCreatedAt?: string | Date | null;
  updatedAt?: string | Date | null;
  sheetRowNumber?: number | null;
  lastSheetSyncedAt?: string | Date | null;
  mismatchReason?: string;
  googleSyncPending?: boolean;
  googleSyncStatusLabel?: string;
  flowStageLabel?: string;
  bBatterySummary?: string | null;
  bFaultSummary?: string | null;
  cFaultSummary?: string | null;
  cAppearanceSummary?: string | null;
  cCameraSummary?: string | null;
  cInspectionSummary?: string | null;
  missingFields: string[];
};

export type PendingStockMismatchMissingFieldFilter = "all" | "採購單號" | "商品分類" | "品牌" | "Google 回寫";

export type PendingStockMismatchFilter = {
  searchKeyword: string;
  missingFieldFilter: PendingStockMismatchMissingFieldFilter;
  vendorFilter: string;
  arrivalDateStart: string;
  arrivalDateEnd: string;
};

function normalizeKeyword(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeDateValue(value: PendingStockMismatchRow["arrivalAt"]) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function escapeCsvCell(value: string | null | undefined) {
  const normalized = value ?? "";
  return `"${normalized.replaceAll('"', '""')}"`;
}

export function getPendingStockMismatchVendorOptions(rows: PendingStockMismatchRow[]) {
  return Array.from(new Set(rows.map((row) => row.vendorName?.trim()).filter((value): value is string => Boolean(value))))
    .sort((left, right) => left.localeCompare(right, "zh-Hant"));
}

export function filterPendingStockMismatchRows(rows: PendingStockMismatchRow[], filter: PendingStockMismatchFilter) {
  const keyword = normalizeKeyword(filter.searchKeyword);
  const normalizedVendorFilter = (filter.vendorFilter ?? "").trim();
  const startDate = filter.arrivalDateStart ? new Date(`${filter.arrivalDateStart}T00:00:00`) : null;
  const endDate = filter.arrivalDateEnd ? new Date(`${filter.arrivalDateEnd}T23:59:59.999`) : null;

  return rows.filter((row) => {
    const matchesKeyword = !keyword || [
      row.productCode,
      row.productName,
      row.batchNo,
      row.serialNumber,
      row.imei,
      row.poNumber,
      row.vendorName,
      row.googleSyncStatusLabel,
      row.flowStageLabel,
      row.bBatterySummary,
      row.bFaultSummary,
      row.cFaultSummary,
      row.cAppearanceSummary,
      row.cCameraSummary,
      row.cInspectionSummary,
    ].some((value) => normalizeKeyword(value).includes(keyword));

    const matchesMissingField = filter.missingFieldFilter === "all" || row.missingFields.includes(filter.missingFieldFilter);
    const matchesVendor = !normalizedVendorFilter || (row.vendorName ?? "") === normalizedVendorFilter;

    const arrivalDate = normalizeDateValue(row.arrivalAt);
    const matchesArrivalDateStart = !startDate || (arrivalDate ? arrivalDate >= startDate : false);
    const matchesArrivalDateEnd = !endDate || (arrivalDate ? arrivalDate <= endDate : false);

    return matchesKeyword && matchesMissingField && matchesVendor && matchesArrivalDateStart && matchesArrivalDateEnd;
  });
}

export function summarizePendingStockMismatchRows(rows: PendingStockMismatchRow[]) {
  return {
    total: rows.length,
    missingPo: rows.filter((row) => row.missingFields.includes("採購單號")).length,
    missingCategory: rows.filter((row) => row.missingFields.includes("商品分類")).length,
    missingBrand: rows.filter((row) => row.missingFields.includes("品牌")).length,
    pendingGoogleSync: rows.filter((row) => row.missingFields.includes("Google 回寫")).length,
  };
}

export function exportPendingStockMismatchRowsToCsv(rows: PendingStockMismatchRow[]) {
  const header = [
    "產品編號",
    "品名",
    "流程狀態",
    "Google 回寫狀態",
    "PO單號",
    "廠商",
    "批號",
    "序號",
    "IMEI",
    "匯入分類",
    "匯入品牌",
    "指定品類",
    "指定品牌",
    "Google 列號",
    "B站電池結果",
    "B站功能結果",
    "C站功能結果",
    "C站外觀結果",
    "C站相機結果",
    "C站總結",
    "最後回寫時間",
    "缺漏欄位",
    "比對說明",
    "到貨時間",
    "最後更新",
  ];

  const lines = rows.map((row) => {
    const arrivalDate = normalizeDateValue(row.arrivalAt);
    const updatedAt = normalizeDateValue(row.updatedAt);
    const lastSheetSyncedAt = normalizeDateValue(row.lastSheetSyncedAt ?? null);
    return [
      row.productCode,
      row.productName,
      row.flowStageLabel,
      row.googleSyncStatusLabel,
      row.poNumber,
      row.vendorName,
      row.batchNo,
      row.serialNumber,
      row.imei,
      row.importedCategoryName,
      row.importedBrandName,
      row.assignedCategoryName,
      row.assignedBrandName,
      row.sheetRowNumber ? String(row.sheetRowNumber) : "",
      row.bBatterySummary,
      row.bFaultSummary,
      row.cFaultSummary,
      row.cAppearanceSummary,
      row.cCameraSummary,
      row.cInspectionSummary,
      lastSheetSyncedAt ? lastSheetSyncedAt.toISOString() : "",
      row.missingFields.join("、"),
      row.mismatchReason,
      arrivalDate ? toDateInputValue(arrivalDate) : "",
      updatedAt ? updatedAt.toISOString() : "",
    ].map((value) => escapeCsvCell(value)).join(",");
  });

  return [header.map((value) => escapeCsvCell(value)).join(","), ...lines].join("\n");
}
