export type ProductNamePickerOption = {
  id: number;
  label: string;
  active: boolean;
  sortOrder: number;
  categoryName: string | null;
  brandName: string | null;
  sourceRowNumber: number | null;
};

export function resolveA1ProductNamePickerState(input: {
  keyword: string;
  matchedCategoryName: string | null;
  matchedBrandName: string | null;
  productNameOptions: ProductNamePickerOption[];
}) {
  const normalizedKeyword = input.keyword.trim().toLowerCase();
  const scopedOptions = input.matchedCategoryName && input.matchedBrandName
    ? input.productNameOptions.filter((option) => option.categoryName === input.matchedCategoryName && option.brandName === input.matchedBrandName)
    : [];
  const filteredScopedOptions = normalizedKeyword
    ? scopedOptions.filter((option) => option.label.toLowerCase().includes(normalizedKeyword))
    : scopedOptions;

  if (filteredScopedOptions.length > 0) {
    return {
      options: filteredScopedOptions.slice(0, 20),
      usingFallbackAllOptions: false,
      scopedMatchCount: scopedOptions.length,
    };
  }

  const fallbackOptions = Array.from(new Map(
    input.productNameOptions
      .filter((option) => !normalizedKeyword || option.label.toLowerCase().includes(normalizedKeyword))
      .map((option) => [option.label, option]),
  ).values()).slice(0, 20);

  return {
    options: fallbackOptions,
    usingFallbackAllOptions: Boolean(input.matchedCategoryName && input.matchedBrandName && scopedOptions.length === 0),
    scopedMatchCount: scopedOptions.length,
  };
}
