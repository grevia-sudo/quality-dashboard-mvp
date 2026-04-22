export type ImportDraftRow = {
  categoryId: string;
  batchNo: string;
  serialNumber: string;
  imei: string;
  productName: string;
};

export type CategoryOption = {
  id: number;
  categoryName: string;
  subtypeCode: string;
};

export type PendingTaskLike = {
  productId: number;
  productCode: string;
  productName?: string | null;
  batchNo?: string | null;
  serialNumber?: string | null;
  imei?: string | null;
  poNumber?: string | null;
  categoryName?: string | null;
  subtypeCode?: string | null;
};

export type PendingPoSummaryRow = {
  key: string;
  poNumber: string;
  categoryLabel: string;
  totalQuantity: number;
  details: Array<{
    productId: number;
    productCode: string;
    productName: string | null;
    batchNo: string | null;
    serialNumber: string | null;
    imei: string | null;
  }>;
};

function normalizeCategoryToken(rawValue: string) {
  return rawValue
    .trim()
    .toLowerCase()
    .replace(/\s*[／/]\s*/g, "/")
    .replace(/\s+/g, " ");
}

export function findCategoryIdByLabel(rawValue: string, categoryOptions: CategoryOption[]) {
  const normalized = normalizeCategoryToken(rawValue);
  if (!normalized) {
    return "";
  }

  const matched = categoryOptions.find((option) => {
    const categoryName = normalizeCategoryToken(option.categoryName);
    const subtypeCode = normalizeCategoryToken(option.subtypeCode);
    const combinedCompact = `${categoryName}/${subtypeCode}`;
    const combinedDisplay = normalizeCategoryToken(`${option.categoryName} / ${option.subtypeCode}`);
    return normalized === categoryName || normalized === subtypeCode || normalized === combinedCompact || normalized === combinedDisplay;
  });

  return matched ? String(matched.id) : "";
}

function formatCategorySummary(categoryLabels: string[]) {
  const labels = Array.from(new Set(categoryLabels.filter(Boolean)));
  if (labels.length === 0) {
    return "未分類";
  }
  if (labels.length === 1) {
    return labels[0]!;
  }
  if (labels.length === 2) {
    return labels.join("、");
  }
  return `${labels[0]} 等 ${labels.length} 類`;
}

export function buildPendingPoSummary(tasks: PendingTaskLike[]) {
  const summaryMap = new Map<string, PendingPoSummaryRow & { categoryLabels: string[] }>();

  for (const task of tasks) {
    const poNumber = task.poNumber?.trim() || "系統補號中";
    const categoryLabel = [task.categoryName, task.subtypeCode].filter(Boolean).join(" / ") || task.subtypeCode || task.categoryName || "未分類";
    const current = summaryMap.get(poNumber) ?? {
      key: poNumber,
      poNumber,
      categoryLabel,
      totalQuantity: 0,
      details: [],
      categoryLabels: [],
    };

    current.totalQuantity += 1;
    current.categoryLabels.push(categoryLabel);
    current.details.push({
      productId: task.productId,
      productCode: task.productCode,
      productName: task.productName ?? null,
      batchNo: task.batchNo ?? null,
      serialNumber: task.serialNumber ?? null,
      imei: task.imei ?? null,
    });
    summaryMap.set(poNumber, current);
  }

  return Array.from(summaryMap.values())
    .map(({ categoryLabels, ...item }) => ({
      ...item,
      categoryLabel: formatCategorySummary(categoryLabels),
    }))
    .sort((left, right) => {
      if (left.poNumber !== right.poNumber) {
        return right.poNumber.localeCompare(left.poNumber);
      }
      return right.totalQuantity - left.totalQuantity;
    });
}
