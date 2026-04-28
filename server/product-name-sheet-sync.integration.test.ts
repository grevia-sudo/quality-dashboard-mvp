import { describe, expect, it } from "vitest";
import { getProductNameOptions, syncProductNameOptionsFromGoogleSheet } from "./db";

describe("product name sheet sync integration", () => {
  it("syncs 商品編碼列表 H／L／N 欄 into local catalog and picker options", async () => {
    const result = await syncProductNameOptionsFromGoogleSheet();
    const options = await getProductNameOptions();

    expect(result.sheetName).toBe("商品編碼列表");
    expect(result.columns).toEqual(["H", "L", "N"]);
    expect(result.insertedLabels).toBeGreaterThan(100);
    expect(result.insertedCatalogEntries).toBeGreaterThanOrEqual(result.insertedLabels);
    expect(result.firstInsertedLabels.length).toBeGreaterThan(0);
    expect(options.length).toBeGreaterThanOrEqual(result.insertedCatalogEntries);
    expect(options.some((option) => option.label.includes("iPhone"))).toBe(true);
    expect(options.some((option) => option.label.includes("iPhone") && Boolean(option.categoryName) && Boolean(option.brandName))).toBe(true);
    expect(options.some((option) => option.brandName === "Apple")).toBe(true);
  }, 30000);
});
