import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dbSource = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const stationPageSource = readFileSync(new URL("../client/src/pages/StationPage.tsx", import.meta.url), "utf8");
const pendingPageSource = readFileSync(new URL("../client/src/pages/PendingStockMismatchPage.tsx", import.meta.url), "utf8");
const stockExportSource = readFileSync(new URL("../client/src/pages/station-stock-export.ts", import.meta.url), "utf8");

describe("A1 duplicate batch guard and pending stock B/C summaries", () => {
  it("blocks duplicate batch numbers during A1 and import flows with normalized batch keys", () => {
    expect(dbSource).toContain("async function findOtherActiveProductByBatchNo(");
    expect(dbSource).toContain("商品批號 ${normalizedBatchNo} 已存在於");
    expect(dbSource).toContain("商品批號 ${nextBatchNo} 已存在於");
    expect(dbSource).toContain("const normalizedBatchNumberKeys = new Set(batchNumbers.map((value) => normalizeBatchMatchValue(value)).filter(Boolean));");
    expect(dbSource).toContain("const duplicatedBatchProduct = normalizedRowBatchKey ? activeProductByBatchNo.get(normalizedRowBatchKey) ?? null : null;");
    expect(dbSource).toContain("if (matchedProduct && row.batchNo && normalizeBatchMatchValue(matchedProduct.batchNo) === normalizedRowBatchKey)");
  });

  it("hydrates stock and pending mismatch data with latest B/C summaries", () => {
    expect(dbSource).toContain("async function getLatestBcInspectionSummariesByProductIds(");
    expect(dbSource).toContain('stationCode === "STOCK"');
    expect(dbSource).toContain("bBatterySummary");
    expect(dbSource).toContain("cInspectionSummary");
  });

  it("shows and exports B/C summaries on stock-related pages", () => {
    expect(stationPageSource).toContain("B站結果");
    expect(stationPageSource).toContain('getTaskSummaryText(task, "bFaultSummary")');
    expect(pendingPageSource).toContain("B/C 檢測結果");
    expect(pendingPageSource).toContain("B站電池：");
    expect(stockExportSource).toContain("B站電池結果");
    expect(stockExportSource).toContain("C站總結");
  });
});
