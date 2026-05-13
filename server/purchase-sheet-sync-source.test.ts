import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("purchase sheet sync source", () => {
  it("does not filter out awaiting-import products just because vendor or category is missing", () => {
    const source = readFileSync(path.resolve(__dirname, "../scripts/sync-purchase-sheet.mjs"), "utf8");
    expect(source).toContain("AND (p.batchNo IS NOT NULL OR p.serialNumber IS NOT NULL OR p.imei IS NOT NULL)");
    expect(source).not.toContain("AND p.vendorName IS NOT NULL");
    expect(source).not.toContain("AND (p.importedCategoryName IS NOT NULL OR c.categoryName IS NOT NULL)");
  });
});
