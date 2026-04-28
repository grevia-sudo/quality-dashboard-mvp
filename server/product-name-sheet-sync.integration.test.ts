import { describe, expect, it } from "vitest";
import { getProductNameOptions, syncProductNameOptionsFromGoogleSheet } from "./db";

describe("product name sheet sync integration", () => {
  it("syncs 商品編碼列表 H 欄 into product_name_options", async () => {
    const result = await syncProductNameOptionsFromGoogleSheet();
    const options = await getProductNameOptions();

    expect(result.sheetName).toBe("商品編碼列表");
    expect(result.column).toBe("H");
    expect(result.insertedLabels).toBeGreaterThan(100);
    expect(result.firstInsertedLabels.length).toBeGreaterThan(0);
    expect(options.length).toBe(result.insertedLabels);
    expect(options.some((option) => option.label.includes("iPhone"))).toBe(true);
    expect(options.some((option) => option.label.includes("Samsung"))).toBe(true);
  }, 30000);
});
