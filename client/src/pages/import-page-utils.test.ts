import { describe, expect, it } from "vitest";
import { buildPendingPoSummary, findCategoryIdByLabel } from "./import-page-utils";

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
