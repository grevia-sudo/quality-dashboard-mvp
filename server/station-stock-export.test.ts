import { describe, expect, it } from "vitest";
import { createUtf8CsvBlob, exportStationStockRowsToCsv } from "../client/src/pages/station-stock-export";

describe("station stock export helpers", () => {
  it("builds stock csv rows with import comparison summary", () => {
    const csv = exportStationStockRowsToCsv([
      {
        productCode: "P-1001",
        productName: "iPhone 15 Pro",
        categoryName: "智慧手機",
        brandName: "Apple",
        batchNo: "BATCH-001",
        serialNumber: "SN-001",
        imei: "IMEI-001",
        poNumber: null,
        importedCategoryName: null,
        importedBrandName: "Apple",
        taskStatus: "pending",
        isOverdue: false,
        bBatterySummary: "耗電偏快",
        bFaultSummary: "藍牙異常",
        cFaultSummary: "Face ID 異常",
        cAppearanceSummary: "邊框刮傷",
        cCameraSummary: "前鏡頭模糊",
        cInspectionSummary: "Face ID 異常, 邊框刮傷, 前鏡頭模糊",
      },
      {
        productCode: "P-1002",
        productName: "Galaxy Tab",
        importedCategoryName: "平板",
        importedBrandName: "Samsung",
        batchNo: "BATCH-002",
        serialNumber: "SN-002",
        imei: "IMEI-002",
        poNumber: "PO-002",
        taskStatus: "pending",
        isOverdue: true,
        bBatterySummary: "正常",
        bFaultSummary: "正常",
        cFaultSummary: "正常",
        cAppearanceSummary: "正常",
        cCameraSummary: "正常",
        cInspectionSummary: "正常",
      },
    ]);

    const lines = csv.split("\n");
    expect(lines[0]).toContain('"產品代碼","品名","品類","批號","序號","IMEI","採購單號","B站電池結果","B站功能結果","C站功能結果","C站外觀結果","C站相機結果","C站總結","匯入比對","狀態"');
    expect(lines[1]).toContain('"P-1001","iPhone 15 Pro","智慧手機 × Apple"');
    expect(lines[1]).toContain('"耗電偏快","藍牙異常","Face ID 異常","邊框刮傷","前鏡頭模糊","Face ID 異常, 邊框刮傷, 前鏡頭模糊"');
    expect(lines[1]).toContain('"尚未完成：缺少PO、商品分類"');
    expect(lines[2]).toContain('"P-1002","Galaxy Tab","平板 × Samsung"');
    expect(lines[2]).toContain('"正常","正常","正常","正常","正常","正常","已完成匯入比對","逾期"');
  });

  it("creates utf8 csv blob with bom prefix", async () => {
    const blob = createUtf8CsvBlob('"欄位"\n"中文"');
    const buffer = Buffer.from(await blob.arrayBuffer());

    expect(Array.from(buffer.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(buffer.toString("utf8")).toContain("欄位");
    expect(buffer.toString("utf8")).toContain("中文");
  });
});
