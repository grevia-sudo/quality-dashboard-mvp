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
  mismatchReason?: string;
  missingFields: string[];
};

export type PendingStockMismatchFilter = {
  searchKeyword: string;
  missingFieldFilter: "all" | "採購單號" | "商品分類" | "品牌";
};

export function filterPendingStockMismatchRows(rows: PendingStockMismatchRow[], filter: PendingStockMismatchFilter) {
  const keyword = filter.searchKeyword.trim().toLowerCase();

  return rows.filter((row) => {
    const matchesKeyword = !keyword || [
      row.productCode,
      row.productName,
      row.batchNo,
      row.serialNumber,
      row.imei,
      row.poNumber,
    ].some((value) => value?.toLowerCase().includes(keyword));
    const matchesMissingField = filter.missingFieldFilter === "all" || row.missingFields.includes(filter.missingFieldFilter);
    return matchesKeyword && matchesMissingField;
  });
}

export function summarizePendingStockMismatchRows(rows: PendingStockMismatchRow[]) {
  return {
    total: rows.length,
    missingPo: rows.filter((row) => row.missingFields.includes("採購單號")).length,
    missingCategory: rows.filter((row) => row.missingFields.includes("商品分類")).length,
    missingBrand: rows.filter((row) => row.missingFields.includes("品牌")).length,
  };
}
