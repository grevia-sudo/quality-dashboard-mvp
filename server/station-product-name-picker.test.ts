import { describe, expect, it } from "vitest";
import { resolveA1ProductNamePickerState, type ProductNamePickerOption } from "../client/src/pages/station-product-name-picker";

const options: ProductNamePickerOption[] = [
  { id: 1, label: "Apple iPhone 15 Pro", active: true, sortOrder: 10, categoryName: "智慧型手機", brandName: "Apple", sourceRowNumber: 3 },
  { id: 2, label: "Apple iPhone 14", active: true, sortOrder: 20, categoryName: "智慧型手機", brandName: "Apple", sourceRowNumber: 4 },
  { id: 3, label: "Samsung Galaxy S24", active: true, sortOrder: 30, categoryName: "智慧型手機", brandName: "Samsung", sourceRowNumber: 5 },
  { id: 4, label: "Apple iPad Air", active: true, sortOrder: 40, categoryName: "平板電腦", brandName: "Apple", sourceRowNumber: 6 },
  { id: 5, label: "Apple iPhone 15 Pro", active: true, sortOrder: 50, categoryName: "智慧型手機", brandName: "Apple", sourceRowNumber: 7 },
];

describe("station product name picker helper", () => {
  it("returns only matched category and brand options when scoped matches exist", () => {
    const result = resolveA1ProductNamePickerState({
      keyword: "iphone",
      matchedCategoryName: "智慧型手機",
      matchedBrandName: "Apple",
      productNameOptions: options,
    });

    expect(result.usingFallbackAllOptions).toBe(false);
    expect(result.scopedMatchCount).toBe(3);
    expect(result.options.map((option) => option.label)).toEqual([
      "Apple iPhone 15 Pro",
      "Apple iPhone 14",
      "Apple iPhone 15 Pro",
    ]);
    expect(result.options.every((option) => option.categoryName === "智慧型手機" && option.brandName === "Apple")).toBe(true);
  });

  it("falls back to unique full catalog search when no scoped options exist", () => {
    const result = resolveA1ProductNamePickerState({
      keyword: "ipad",
      matchedCategoryName: "筆電",
      matchedBrandName: "Apple",
      productNameOptions: options,
    });

    expect(result.usingFallbackAllOptions).toBe(true);
    expect(result.scopedMatchCount).toBe(0);
    expect(result.options.map((option) => option.label)).toEqual(["Apple iPad Air"]);
  });
});
