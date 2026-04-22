import { describe, expect, it } from "vitest";
import { buildPendingPoSummary, parseImportedCsvContent } from "./import-page-utils";

describe("import page utils", () => {
  it("parses tab-delimited CSV rows and keeps the original category text", () => {
    const parsed = parseImportedCsvContent(
      [
        "廠商\t商品分類\t商品批號\t商品序號\tIMEI\t品名",
        "悠優\t智慧手機\t\tW56PJQ6J22\t357140954529759\t",
      ].join("\n"),
    );

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toEqual({
      categoryName: "智慧手機",
      batchNo: "",
      serialNumber: "W56PJQ6J22",
      imei: "357140954529759",
      productName: "",
    });
  });

  it("groups pending rows by PO number and summarizes categories without brand labels", () => {
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
