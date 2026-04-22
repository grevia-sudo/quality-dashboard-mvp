import { describe, expect, it } from "vitest";
import {
  buildSheetRow,
  createInitialSheetValues,
  findMatchingRowNumber,
  mergeMissingCells,
  PURCHASE_SHEET_HEADER,
} from "../scripts/purchase-sheet-sync-helpers.mjs";

describe("purchase sheet sync helpers", () => {
  it("builds a sheet row with normalized blank-safe values", () => {
    expect(
      buildSheetRow({
        poNumber: "PO-1",
        vendorName: "綠途未來",
        importedCategoryName: "智慧型手機",
        batchNo: null,
        serialNumber: "SN-1",
        imei: undefined,
        productName: "",
        a1CompletedAt: "2026-04-22 10:30:00",
      }),
    ).toEqual(["PO-1", "綠途未來", "智慧型手機", "", "SN-1", "", "", "2026-04-22 10:30:00"]);
  });

  it("matches existing rows by IMEI first, then serial number, then batch number", () => {
    const values = [
      PURCHASE_SHEET_HEADER,
      ["PO-1", "綠途未來", "智慧型手機", "BATCH-1", "SN-1", "IMEI-1", "iPhone 13", "2026-04-22 10:30:00"],
      ["PO-2", "循環供應商", "平板", "BATCH-2", "SN-2", "", "iPad mini", ""],
    ];

    expect(findMatchingRowNumber(values, { imei: "IMEI-1", serialNumber: "SN-X", batchNo: "BATCH-X" })).toBe(2);
    expect(findMatchingRowNumber(values, { imei: "", serialNumber: "SN-2", batchNo: "BATCH-X" })).toBe(3);
    expect(findMatchingRowNumber(values, { imei: "", serialNumber: "", batchNo: "BATCH-1" })).toBe(2);
    expect(findMatchingRowNumber(values, { imei: "", serialNumber: "", batchNo: "" })).toBeNull();
  });

  it("fills only blank cells and preserves non-empty sheet values", () => {
    const existingRow = ["PO-1", "綠途未來", "智慧型手機", "", "SN-1", "IMEI-1", "現場已填品名", ""];
    const generatedRow = ["PO-1", "綠途未來", "智慧型手機", "BATCH-1", "SN-1", "IMEI-1", "iPhone 13", "2026-04-22 10:30:00"];

    expect(mergeMissingCells(existingRow, generatedRow)).toEqual([
      "PO-1",
      "綠途未來",
      "智慧型手機",
      "BATCH-1",
      "SN-1",
      "IMEI-1",
      "現場已填品名",
      "2026-04-22 10:30:00",
    ]);
  });

  it("creates the standard header row when the sheet is still empty", () => {
    expect(createInitialSheetValues(undefined)).toEqual([PURCHASE_SHEET_HEADER]);
    expect(createInitialSheetValues([])).toEqual([PURCHASE_SHEET_HEADER]);
  });
});
