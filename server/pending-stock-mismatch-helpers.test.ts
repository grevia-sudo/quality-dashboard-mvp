import { describe, expect, it } from "vitest";
import { filterPendingStockMismatchRows, summarizePendingStockMismatchRows, type PendingStockMismatchRow } from "../client/src/pages/pending-stock-mismatch-filter";
import { buildPendingStockMismatchSummary, getPendingStockMismatchMissingFields, isPendingStockImportMismatch } from "./pending-stock-mismatch";

const rows: PendingStockMismatchRow[] = [
  {
    productId: 1,
    productCode: "P-1001",
    productName: "iPhone 15 Pro",
    batchNo: "BATCH-001",
    serialNumber: "SN-001",
    imei: "IMEI-001",
    poNumber: null,
    googleSyncStatusLabel: "尚未回寫 Google",
    flowStageLabel: "已刷入待補匯入",
    missingFields: ["採購單號", "商品分類", "Google 回寫"],
  },
  {
    productId: 2,
    productCode: "P-1002",
    productName: "Apple Watch",
    batchNo: "WATCH-002",
    serialNumber: "SN-002",
    imei: null,
    poNumber: "PO-002",
    googleSyncStatusLabel: "尚未回寫 Google",
    flowStageLabel: "已刷入待同步",
    missingFields: ["Google 回寫"],
  },
];

describe("pending stock mismatch helpers", () => {
  it("marks post-A1 rows with missing import data or pending Google sync as mismatches", () => {
    expect(isPendingStockImportMismatch({
      currentStationCode: "A2",
      currentStatus: "pending_a2",
      poNumber: null,
      importedCategoryName: "智慧型手機",
      importedBrandName: "Apple",
      sheetRowNumber: null,
      lastSheetSyncedAt: null,
    })).toBe(true);

    expect(isPendingStockImportMismatch({
      currentStationCode: "STOCK",
      currentStatus: "pending_stock",
      poNumber: "PO-001",
      importedCategoryName: "智慧型手機",
      importedBrandName: "Apple",
      sheetRowNumber: null,
      lastSheetSyncedAt: null,
    })).toBe(true);

    expect(isPendingStockImportMismatch({
      currentStationCode: "A1",
      currentStatus: "pending_a1",
      poNumber: null,
      importedCategoryName: "智慧型手機",
      importedBrandName: "Apple",
      sheetRowNumber: null,
      lastSheetSyncedAt: null,
    })).toBe(false);

    expect(isPendingStockImportMismatch({
      currentStationCode: "STOCK",
      currentStatus: "pending_stock",
      poNumber: "PO-001",
      importedCategoryName: "智慧型手機",
      importedBrandName: "Apple",
      sheetRowNumber: 18,
      lastSheetSyncedAt: "2026-05-05T12:45:51.000Z",
    })).toBe(false);
  });

  it("builds missing field summary and mismatch reason consistently", () => {
    const missingFields = getPendingStockMismatchMissingFields({
      poNumber: null,
      importedCategoryName: null,
      importedBrandName: "Apple",
      sheetRowNumber: null,
      lastSheetSyncedAt: null,
    });
    const summary = buildPendingStockMismatchSummary({
      currentStationCode: "A2",
      currentStatus: "pending_a2",
      poNumber: null,
      importedCategoryName: null,
      importedBrandName: "Apple",
      sheetRowNumber: null,
      lastSheetSyncedAt: null,
    });

    expect(missingFields).toEqual(["採購單號", "商品分類", "Google 回寫"]);
    expect(summary.missingFieldSummary).toBe("採購單號、商品分類、Google 回寫");
    expect(summary.mismatchReason).toBe("缺少採購單號、商品分類，已刷入系統但尚未完成匯入比對，Google 尚未回寫");
    expect(summary.googleSyncStatusLabel).toBe("尚未回寫 Google");
  });

  it("filters rows by keyword and missing field selection for the unsynced query page", () => {
    const filtered = filterPendingStockMismatchRows(rows, {
      searchKeyword: "watch",
      missingFieldFilter: "Google 回寫",
      vendorFilter: "",
      arrivalDateStart: "",
      arrivalDateEnd: "",
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.productCode).toBe("P-1002");
  });

  it("summarizes the filtered result counts shown on the page", () => {
    const summary = summarizePendingStockMismatchRows(rows);

    expect(summary).toEqual({
      total: 2,
      missingPo: 1,
      missingCategory: 1,
      missingBrand: 0,
      pendingGoogleSync: 2,
    });
  });
});
