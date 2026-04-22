import { describe, expect, it } from "vitest";
import { buildPendingPoSummary, parseImportedCsvContent, resolveImportedVendorName } from "../client/src/pages/import-page-utils";

describe("import page utils", () => {
  it("parses rows from user csv and keeps the original category text", () => {
    const parsed = parseImportedCsvContent(
      [
        "廠商,商品分類,商品批號,商品序號,IMEI,品名",
        "悠優,智慧手機,,W56PJQ6J22,357140954529759,",
      ].join("\n"),
    );

    expect(parsed.sharedVendorName).toBe("悠優");
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      categoryName: "智慧手機",
      batchNo: "",
      serialNumber: "W56PJQ6J22",
      imei: "357140954529759",
      productName: "",
    });
  });

  it("parses vendor from CSV header rows and auto-fills shared vendor name", () => {
    const parsed = parseImportedCsvContent(
      [
        "廠商,商品分類,商品批號,商品序號,IMEI,品名",
        "綠途未來股份有限公司,智慧手機,B-001,S-001,IMEI-001,Galaxy A52",
        "綠途未來股份有限公司,平板,B-002,S-002,IMEI-002,Galaxy Tab",
      ].join("\n"),
    );

    expect(parsed.sharedVendorName).toBe("綠途未來股份有限公司");
    expect(parsed.detectedVendorNames).toEqual(["綠途未來股份有限公司"]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]?.categoryName).toBe("智慧手機");
    expect(parsed.rows[1]?.categoryName).toBe("平板");
  });

  it("handles BOM, quoted cells, and commas inside vendor names without misclassifying rows as empty", () => {
    const parsed = parseImportedCsvContent(
      [
        "\uFEFF廠商,商品分類,商品批號,商品序號,IMEI,品名",
        '="綠途,未來股份有限公司","智慧手機","B-370","S-370","IMEI-370","Galaxy, Enterprise"',
      ].join("\n"),
    );

    expect(parsed.sharedVendorName).toBe("綠途,未來股份有限公司");
    expect(parsed.detectedVendorNames).toEqual(["綠途,未來股份有限公司"]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      categoryName: "智慧手機",
      batchNo: "B-370",
      serialNumber: "S-370",
      imei: "IMEI-370",
      productName: "Galaxy, Enterprise",
    });
  });

  it("uses the actual CSV vendor value when the uploaded file contains a single shared vendor", () => {
    const parsed = parseImportedCsvContent(
      [
        "廠商,商品分類,商品批號,商品序號,IMEI,品名",
        "悠優,智慧手機,B-501,S-501,IMEI-501,Galaxy A55",
      ].join("\n"),
    );

    expect(parsed.sharedVendorName).toBe("悠優");
    expect(parsed.hasVendorColumn).toBe(true);
    expect(resolveImportedVendorName("綠途未來股份有限公司", parsed)).toBe("悠優");
  });

  it("clears the previous vendor when a new CSV has a vendor column but no single shared vendor", () => {
    const parsed = parseImportedCsvContent(
      [
        "廠商,商品分類,商品批號,商品序號,IMEI,品名",
        "悠優,智慧手機,B-601,S-601,IMEI-601,Galaxy A56",
        "另一家供應商,平板,B-602,S-602,IMEI-602,Galaxy Tab S9",
      ].join("\n"),
    );

    expect(parsed.sharedVendorName).toBe("");
    expect(parsed.hasVendorColumn).toBe(true);
    expect(resolveImportedVendorName("綠途未來股份有限公司", parsed)).toBe("");
  });

  it("keeps the current vendor when the new CSV does not provide a vendor column", () => {
    const parsed = parseImportedCsvContent(
      [
        "商品類別,商品批號,商品序號,IMEI,品名",
        "智慧手機,B-701,S-701,IMEI-701,Galaxy A58",
      ].join("\n"),
    );

    expect(parsed.hasVendorColumn).toBe(false);
    expect(resolveImportedVendorName("悠優", parsed)).toBe("悠優");
  });

  it("groups pending rows by PO number and falls back to imported category text", () => {
    const summary = buildPendingPoSummary([
      {
        productId: 1,
        productCode: "P-1",
        poNumber: "PO-20260422-10",
        importedCategoryName: "智慧手機",
        batchNo: "B-1",
      },
      {
        productId: 2,
        productCode: "P-2",
        poNumber: "PO-20260422-10",
        categoryName: "智慧手機",
        batchNo: "B-2",
      },
      {
        productId: 3,
        productCode: "P-3",
        poNumber: "PO-20260422-10",
        importedCategoryName: "平板",
        batchNo: "B-3",
      },
    ]);

    expect(summary).toHaveLength(1);
    expect(summary[0]?.poNumber).toBe("PO-20260422-10");
    expect(summary[0]?.totalQuantity).toBe(3);
    expect(summary[0]?.details).toHaveLength(3);
    expect(summary[0]?.categoryLabel).toBe("智慧手機、平板");
  });
});
