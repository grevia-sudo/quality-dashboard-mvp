import { describe, expect, it } from "vitest";
import { buildPendingPoSummary, findCategoryIdByLabel, parseImportedCsvContent, resolveImportedVendorName } from "../client/src/pages/import-page-utils";

describe("import page utils", () => {
  it("matches category labels even when CSV values contain spaced slashes", () => {
    const options = [
      { id: 4, categoryName: "智慧型手機", subtypeCode: "Android" },
      { id: 5, categoryName: "智慧型手機", subtypeCode: "iPhone" },
    ];

    expect(findCategoryIdByLabel("智慧型手機 / Android", options)).toBe("4");
    expect(findCategoryIdByLabel("智慧型手機/Android", options)).toBe("4");
    expect(findCategoryIdByLabel("Android", options)).toBe("4");
    expect(findCategoryIdByLabel("智慧型手機 ／ iPhone", options)).toBe("5");
    expect(findCategoryIdByLabel("智慧手機", options)).toBe("4");
    expect(findCategoryIdByLabel("手機", options)).toBe("4");
  });

  it("parses rows from user csv when category is written as 手機 and identifiers rely on serial number plus imei", () => {
    const options = [
      { id: 4, categoryName: "智慧型手機", subtypeCode: "Android" },
      { id: 5, categoryName: "智慧型手機", subtypeCode: "iPhone" },
    ];

    const parsed = parseImportedCsvContent(
      [
        "廠商,商品分類,商品批號,商品序號,IMEI,品名",
        "悠優,手機,,W56PJQ6J22,357140954529759,",
      ].join("\n"),
      options,
    );

    expect(parsed.sharedVendorName).toBe("悠優");
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      categoryId: "4",
      batchNo: "",
      serialNumber: "W56PJQ6J22",
      imei: "357140954529759",
      productName: "",
    });
  });

  it("parses vendor from CSV header rows and auto-fills shared vendor name", () => {
    const options = [
      { id: 4, categoryName: "智慧型手機", subtypeCode: "Android" },
    ];

    const parsed = parseImportedCsvContent(
      [
        "廠商,商品分類,商品批號,商品序號,IMEI,品名",
        "綠途未來股份有限公司,智慧型手機 / Android,B-001,S-001,IMEI-001,Galaxy A52",
        "綠途未來股份有限公司,智慧型手機 / Android,B-002,S-002,IMEI-002,Galaxy A53",
      ].join("\n"),
      options,
    );

    expect(parsed.sharedVendorName).toBe("綠途未來股份有限公司");
    expect(parsed.detectedVendorNames).toEqual(["綠途未來股份有限公司"]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]?.categoryId).toBe("4");
    expect(parsed.rows[0]?.batchNo).toBe("B-001");
  });

  it("handles BOM, quoted cells, and commas inside vendor names without misclassifying rows as empty", () => {
    const options = [
      { id: 4, categoryName: "智慧型手機", subtypeCode: "Android" },
    ];

    const parsed = parseImportedCsvContent(
      [
        "\uFEFF廠商,商品分類,商品批號,商品序號,IMEI,品名",
        '="綠途,未來股份有限公司","智慧型手機 / Android","B-370","S-370","IMEI-370","Galaxy, Enterprise"',
      ].join("\n"),
      options,
    );

    expect(parsed.sharedVendorName).toBe("綠途,未來股份有限公司");
    expect(parsed.detectedVendorNames).toEqual(["綠途,未來股份有限公司"]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      categoryId: "4",
      batchNo: "B-370",
      serialNumber: "S-370",
      imei: "IMEI-370",
      productName: "Galaxy, Enterprise",
    });
  });

  it("uses the actual CSV vendor value when the uploaded file contains a single shared vendor", () => {
    const options = [
      { id: 4, categoryName: "智慧型手機", subtypeCode: "Android" },
    ];

    const parsed = parseImportedCsvContent(
      [
        "廠商,商品分類,商品批號,商品序號,IMEI,品名",
        "悠優,智慧型手機 / Android,B-501,S-501,IMEI-501,Galaxy A55",
      ].join("\n"),
      options,
    );

    expect(parsed.sharedVendorName).toBe("悠優");
    expect(parsed.hasVendorColumn).toBe(true);
    expect(resolveImportedVendorName("綠途未來股份有限公司", parsed)).toBe("悠優");
  });

  it("clears the previous vendor when a new CSV has a vendor column but no single shared vendor", () => {
    const options = [
      { id: 4, categoryName: "智慧型手機", subtypeCode: "Android" },
    ];

    const parsed = parseImportedCsvContent(
      [
        "廠商,商品分類,商品批號,商品序號,IMEI,品名",
        "悠優,智慧型手機 / Android,B-601,S-601,IMEI-601,Galaxy A56",
        "另一家供應商,智慧型手機 / Android,B-602,S-602,IMEI-602,Galaxy A57",
      ].join("\n"),
      options,
    );

    expect(parsed.sharedVendorName).toBe("");
    expect(parsed.hasVendorColumn).toBe(true);
    expect(resolveImportedVendorName("綠途未來股份有限公司", parsed)).toBe("");
  });

  it("keeps the current vendor when the new CSV does not provide a vendor column", () => {
    const options = [
      { id: 4, categoryName: "智慧型手機", subtypeCode: "Android" },
    ];

    const parsed = parseImportedCsvContent(
      [
        "商品分類,商品批號,商品序號,IMEI,品名",
        "智慧型手機 / Android,B-701,S-701,IMEI-701,Galaxy A58",
      ].join("\n"),
      options,
    );

    expect(parsed.hasVendorColumn).toBe(false);
    expect(resolveImportedVendorName("悠優", parsed)).toBe("悠優");
  });

  it("groups pending rows by PO number and sums the full batch quantity", () => {
    const summary = buildPendingPoSummary([
      {
        productId: 1,
        productCode: "P-1",
        poNumber: "PO-20260422-10",
        categoryName: "智慧型手機",
        subtypeCode: "Android",
        batchNo: "B-1",
      },
      {
        productId: 2,
        productCode: "P-2",
        poNumber: "PO-20260422-10",
        categoryName: "智慧型手機",
        subtypeCode: "Android",
        batchNo: "B-2",
      },
      {
        productId: 3,
        productCode: "P-3",
        poNumber: "PO-20260422-10",
        categoryName: "智慧型手機",
        subtypeCode: "iPhone",
        batchNo: "B-3",
      },
    ]);

    expect(summary).toHaveLength(1);
    expect(summary[0]?.poNumber).toBe("PO-20260422-10");
    expect(summary[0]?.totalQuantity).toBe(3);
    expect(summary[0]?.details).toHaveLength(3);
    expect(summary[0]?.categoryLabel).toContain("智慧型手機 / Android");
  });
});
