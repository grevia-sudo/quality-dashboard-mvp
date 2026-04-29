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
    missingFields: ["採購單號", "商品分類"],
  },
  {
    productId: 2,
    productCode: "P-1002",
    productName: "Apple Watch",
    batchNo: "WATCH-002",
    serialNumber: "SN-002",
    imei: null,
    poNumber: "PO-002",
    missingFields: ["品牌"],
  },
];

describe("pending stock mismatch helpers", () => {
  it("marks only STOCK + pending_stock rows with missing import data as mismatches", () => {
    expect(isPendingStockImportMismatch({
      currentStationCode: "STOCK",
      currentStatus: "pending_stock",
      poNumber: null,
      importedCategoryName: "智慧型手機",
      importedBrandName: "Apple",
    })).toBe(true);

    expect(isPendingStockImportMismatch({
      currentStationCode: "A2",
      currentStatus: "pending_a2",
      poNumber: null,
      importedCategoryName: "智慧型手機",
      importedBrandName: "Apple",
    })).toBe(false);

    expect(isPendingStockImportMismatch({
      currentStationCode: "STOCK",
      currentStatus: "pending_stock",
      poNumber: "PO-001",
      importedCategoryName: "智慧型手機",
      importedBrandName: "Apple",
    })).toBe(false);
  });

  it("builds missing field summary and mismatch reason consistently", () => {
    const missingFields = getPendingStockMismatchMissingFields({
      poNumber: null,
      importedCategoryName: null,
      importedBrandName: "Apple",
    });
    const summary = buildPendingStockMismatchSummary({
      currentStationCode: "STOCK",
      currentStatus: "pending_stock",
      poNumber: null,
      importedCategoryName: null,
      importedBrandName: "Apple",
    });

    expect(missingFields).toEqual(["採購單號", "商品分類"]);
    expect(summary.missingFieldSummary).toBe("採購單號、商品分類");
    expect(summary.mismatchReason).toBe("缺少採購單號、商品分類，尚未完成匯入比對");
  });

  it("filters rows by keyword and missing field selection for the pending stock page", () => {
    const filtered = filterPendingStockMismatchRows(rows, {
      searchKeyword: "watch",
      missingFieldFilter: "品牌",
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
      missingBrand: 1,
    });
  });
});
