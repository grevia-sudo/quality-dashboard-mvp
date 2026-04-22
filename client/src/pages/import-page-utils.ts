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

export type ParsedImportCsv = {
  rows: ImportDraftRow[];
  sharedVendorName: string;
  detectedVendorNames: string[];
  hasVendorColumn: boolean;
};

export function resolveImportedVendorName(currentVendorName: string, parsed: ParsedImportCsv) {
  if (parsed.sharedVendorName) {
    return parsed.sharedVendorName;
  }

  if (parsed.hasVendorColumn) {
    return "";
  }

  return currentVendorName;
}

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

type CsvHeaderKey = "vendorName" | "category" | "batchNo" | "serialNumber" | "imei" | "productName";

const HEADER_ALIASES: Record<CsvHeaderKey, string[]> = {
  vendorName: ["廠商", "供應商", "vendor", "vendorname", "supplier"],
  category: ["商品分類", "分類", "category", "productcategory"],
  batchNo: ["商品批號", "批號", "batchno", "batch", "lotno"],
  serialNumber: ["商品序號", "序號", "serialnumber", "serialno", "sn"],
  imei: ["imei"],
  productName: ["品名", "productname", "name", "modelname"],
};

function normalizeCategoryToken(rawValue: string) {
  return rawValue
    .trim()
    .toLowerCase()
    .replace(/\s*[／/]\s*/g, "/")
    .replace(/\s+/g, " ");
}

function normalizeHeaderToken(rawValue: string) {
  return rawValue
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/^["']+|["']+$/g, "")
    .replace(/[：:]/g, "")
    .replace(/\s+/g, "");
}

export function normalizeImportedCell(rawValue: string) {
  const trimmed = rawValue.replace(/^\uFEFF/, "").trim();
  const excelFormulaMatch = trimmed.match(/^="([\s\S]*)"$/);
  if (excelFormulaMatch) {
    return excelFormulaMatch[1].trim();
  }

  if (trimmed.startsWith("='") && trimmed.endsWith("'")) {
    return trimmed.slice(2, -1).trim();
  }

  if (trimmed.startsWith("=")) {
    return trimmed.slice(1).trim();
  }

  if (trimmed.startsWith("'")) {
    return trimmed.slice(1).trim();
  }

  return trimmed;
}

function parseDelimitedLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  let delimiter = ",";

  if (!line.includes(",") && line.includes("\t")) {
    delimiter = "\t";
  }

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      cells.push(normalizeImportedCell(current));
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(normalizeImportedCell(current));
  return cells;
}

function buildHeaderMap(cells: string[]) {
  const headerMap = new Map<CsvHeaderKey, number>();

  cells.forEach((cell, index) => {
    const normalized = normalizeHeaderToken(cell);
    (Object.keys(HEADER_ALIASES) as CsvHeaderKey[]).forEach((key) => {
      if (!headerMap.has(key) && HEADER_ALIASES[key].includes(normalized)) {
        headerMap.set(key, index);
      }
    });
  });

  return headerMap;
}

function getCell(cells: string[], headerMap: Map<CsvHeaderKey, number>, key: CsvHeaderKey) {
  const index = headerMap.get(key);
  if (index === undefined) {
    return "";
  }
  return cells[index] ?? "";
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

export function parseImportedCsvContent(input: string, categoryOptions: CategoryOption[]): ParsedImportCsv {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { rows: [], sharedVendorName: "", detectedVendorNames: [], hasVendorColumn: false };
  }

  const firstRowCells = parseDelimitedLine(lines[0]!);
  const headerMap = buildHeaderMap(firstRowCells);
  const hasStructuredHeader = headerMap.has("category") || headerMap.has("batchNo") || headerMap.has("serialNumber") || headerMap.has("imei") || headerMap.has("productName") || headerMap.has("vendorName");
  const hasVendorColumn = headerMap.has("vendorName");
  const dataLines = hasStructuredHeader ? lines.slice(1) : lines;
  const detectedVendorNames = new Set<string>();

  const rows = dataLines
    .map((line) => parseDelimitedLine(line))
    .map((cells) => {
      if (hasStructuredHeader) {
        const vendorName = getCell(cells, headerMap, "vendorName");
        if (vendorName) {
          detectedVendorNames.add(vendorName);
        }

        return {
          categoryId: findCategoryIdByLabel(getCell(cells, headerMap, "category"), categoryOptions),
          batchNo: getCell(cells, headerMap, "batchNo"),
          serialNumber: getCell(cells, headerMap, "serialNumber"),
          imei: getCell(cells, headerMap, "imei"),
          productName: getCell(cells, headerMap, "productName"),
        } satisfies ImportDraftRow;
      }

      const hasCategoryColumn = cells.length >= 5;
      const [first = "", second = "", third = "", fourth = "", fifth = ""] = cells;
      return hasCategoryColumn
        ? {
            categoryId: findCategoryIdByLabel(first, categoryOptions),
            batchNo: second,
            serialNumber: third,
            imei: fourth,
            productName: fifth,
          }
        : {
            categoryId: "",
            batchNo: first,
            serialNumber: second,
            imei: third,
            productName: fourth,
          };
    })
    .filter((row) => row.categoryId || row.batchNo || row.serialNumber || row.imei || row.productName);

  const vendorList = Array.from(detectedVendorNames.values());
  return {
    rows,
    sharedVendorName: vendorList.length === 1 ? vendorList[0]! : "",
    detectedVendorNames: vendorList,
    hasVendorColumn,
  };
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
