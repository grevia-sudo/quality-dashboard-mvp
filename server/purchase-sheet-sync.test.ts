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
        a1CompletedAt: "2026-04-22T10:30:00.000Z",
        a1OperatorName: "Yana",
        a2CompletedAt: "2026-04-22T11:43:00.000Z",
        a2OperatorName: "Leo",
        bCompletedAt: "2026-04-22T12:08:00.000Z",
        bOperatorName: "Mia",
        cCompletedAt: "2026-04-22T13:15:00.000Z",
        bBatterySummary: "88, 電池異常",
        bFaultSummary: "正常",
        cFaultSummary: "破裂",
        cAppearanceSummary: "刮傷",
        cCameraSummary: "鏡頭刮傷",
      }),
    ).toEqual(["PO-1", "綠途未來", "智慧型手機", "", "SN-1", "", "", "2026/04/22 18:30", "Yana", "2026/04/22 19:43", "Leo", "2026/04/22 20:08", "88, 電池異常", "正常", "Mia", "2026/04/22 21:15", "N", "破裂", "刮傷", "鏡頭刮傷"]);
  });

  it("formats Date objects for the sheet using YYYY/MM/DD HH:mm", () => {
    expect(
      buildSheetRow({
        poNumber: "PO-2",
        vendorName: "綠途未來",
        importedCategoryName: "平板",
        batchNo: "BATCH-2",
        serialNumber: "SN-2",
        imei: "IMEI-2",
        productName: "iPad mini",
        a1CompletedAt: new Date("2026-04-22T01:05:00.000Z"),
        a1OperatorName: "Amy",
        a2CompletedAt: new Date("2026-04-22T02:43:00.000Z"),
        a2OperatorName: "Ben",
        bCompletedAt: new Date("2026-04-22T03:15:00.000Z"),
        bOperatorName: "Cody",
        cCompletedAt: new Date("2026-04-22T05:05:00.000Z"),
        bBatterySummary: "正常",
        bFaultSummary: "後標準相機故障, 鏡頭馬達故障/抖動",
        cModifiedPreviousStage: "Y",
        cModifiedBatterySummary: "75, 電池異常",
        cModifiedBFaultSummary: "觸控異常",
        cFaultSummary: "破裂",
        cAppearanceSummary: "刮傷",
        cCameraSummary: "鏡頭模糊",
      }),
    ).toEqual(["PO-2", "綠途未來", "平板", "BATCH-2", "SN-2", "IMEI-2", "iPad mini", "2026/04/22 09:05", "Amy", "2026/04/22 10:43", "Ben", "2026/04/22 11:15", "75, 電池異常", "觸控異常", "Cody", "2026/04/22 13:05", "Y", "破裂", "刮傷", "鏡頭模糊"]);
  });

  it("matches existing rows by IMEI first, then serial number, then batch number", () => {
    const values = [
      PURCHASE_SHEET_HEADER,
      ["PO-1", "綠途未來", "智慧型手機", "BATCH-1", "SN-1", "IMEI-1", "iPhone 13", "2026-04-22 10:30:00", "2026-04-22 11:45:00"],
      ["PO-2", "循環供應商", "平板", "BATCH-2", "SN-2", "", "iPad mini", "", ""],
    ];

    expect(findMatchingRowNumber(values, { imei: "IMEI-1", serialNumber: "SN-X", batchNo: "BATCH-X" })).toBe(2);
    expect(findMatchingRowNumber(values, { imei: "", serialNumber: "SN-2", batchNo: "BATCH-X" })).toBe(3);
    expect(findMatchingRowNumber(values, { imei: "", serialNumber: "", batchNo: "BATCH-1" })).toBe(2);
    expect(findMatchingRowNumber(values, { imei: "", serialNumber: "", batchNo: "" })).toBeNull();
  });

  it("fills only blank cells and preserves non-empty sheet values except H 到 T 欄由系統刷新", () => {
    const existingRow = ["PO-1", "綠途未來", "智慧型手機", "", "SN-1", "IMEI-1", "現場已填品名", "舊的 A1 時間", "舊的 A1 執行人", "舊的 A2 時間", "舊的 A2 執行人", "舊的 B 時間", "舊的電池資訊", "舊的故障資訊", "舊的 B 執行人", "舊的 C 時間", "舊的上一關修改標記", "舊的螢幕狀態", "舊的機身狀態", "舊的鏡頭狀態"];
    const generatedRow = ["PO-1", "綠途未來", "智慧型手機", "BATCH-1", "SN-1", "IMEI-1", "iPhone 13", "2026/04/22 18:30", "Yana", "2026/04/22 19:43", "Leo", "2026/04/22 20:08", "88, 電池異常", "正常", "Mia", "2026/04/22 21:15", "N", "正常", "正常", "正常"];

    expect(mergeMissingCells(existingRow, generatedRow)).toEqual([
      "PO-1",
      "綠途未來",
      "智慧型手機",
      "BATCH-1",
      "SN-1",
      "IMEI-1",
      "現場已填品名",
      "2026/04/22 18:30",
      "Yana",
      "2026/04/22 19:43",
      "Leo",
      "2026/04/22 20:08",
      "88, 電池異常",
      "正常",
      "Mia",
      "2026/04/22 21:15",
      "N",
      "正常",
      "正常",
      "正常",
    ]);
  });

  it("creates the standard header row when the sheet is still empty", () => {
    expect(PURCHASE_SHEET_HEADER).toEqual(["採購單號", "廠商", "商品分類", "商品批號", "商品序號", "IMEI", "品名", "點到貨時間", "A1執行人", "安裝軟體時間", "A2執行人", "軟體測試時間", "電池檢測", "B站故障狀態", "B站執行人", "測試時間", "是否修改B站的狀態回覆", "螢幕狀態", "機身狀態", "鏡頭狀態"]);
    expect(createInitialSheetValues(undefined)).toEqual([PURCHASE_SHEET_HEADER]);
    expect(createInitialSheetValues([])).toEqual([PURCHASE_SHEET_HEADER]);
  });
});
