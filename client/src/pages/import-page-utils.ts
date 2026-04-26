export type ImportDraftRow = {
  categoryName: string;
  brandName: string;
  batchNo: string;
  serialNumber: string;
  imei: string;
  productName: string;
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
  importedCategoryName?: string | null;
  importedBrandName?: string | null;
  brandName?: string | null;
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
    categoryName: string | null;
    brandName: string | null;
  }>;
};

type CsvHeaderKey = "vendorName" | "categoryName" | "brandName" | "batchNo" | "serialNumber" | "imei" | "productName";

const HEADER_ALIASES: Record<CsvHeaderKey, string[]> = {
  vendorName: ["廠商", "供應商", "vendor", "vendorname", "supplier"],
  categoryName: ["商品分類", "分類", "category", "productcategory", "商品類別", "類別"],
  brandName: ["品牌", "brand", "brandname"],
  batchNo: ["商品批號", "批號", "batchno", "batch", "lotno"],
  serialNumber: ["商品序號", "序號", "serialnumber", "serialno", "sn"],
  imei: ["imei"],
  productName: ["品名", "productname", "name", "modelname"],
};

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

function toDraftRow(categoryName: string, brandName: string, batchNo: string, serialNumber: string, imei: string, productName: string) {
  return {
    categoryName: normalizeImportedCell(categoryName),
    brandName: normalizeImportedCell(brandName),
    batchNo: normalizeImportedCell(batchNo),
    serialNumber: normalizeImportedCell(serialNumber),
    imei: normalizeImportedCell(imei),
    productName: normalizeImportedCell(productName),
  } satisfies ImportDraftRow;
}

export function parseImportedCsvContent(input: string): ParsedImportCsv {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { rows: [], sharedVendorName: "", detectedVendorNames: [], hasVendorColumn: false };
  }

  const firstRowCells = parseDelimitedLine(lines[0]!);
  const headerMap = buildHeaderMap(firstRowCells);
  const hasStructuredHeader = headerMap.size > 0;
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

        return toDraftRow(
          getCell(cells, headerMap, "categoryName"),
          getCell(cells, headerMap, "brandName"),
          getCell(cells, headerMap, "batchNo"),
          getCell(cells, headerMap, "serialNumber"),
          getCell(cells, headerMap, "imei"),
          getCell(cells, headerMap, "productName"),
        );
      }

      const [categoryName = "", brandName = "", batchNo = "", serialNumber = "", imei = "", productName = ""] = cells;
      return toDraftRow(categoryName, brandName, batchNo, serialNumber, imei, productName);
    })
    .filter((row) => row.categoryName || row.brandName || row.batchNo || row.serialNumber || row.imei || row.productName);

  const vendorList = Array.from(detectedVendorNames.values());
  return {
    rows,
    sharedVendorName: vendorList.length === 1 ? vendorList[0]! : "",
    detectedVendorNames: vendorList,
    hasVendorColumn,
  };
}

function formatSummary(labels: string[], fallback: string) {
  const uniqueLabels = Array.from(new Set(labels.filter(Boolean)));
  if (uniqueLabels.length === 0) {
    return fallback;
  }
  if (uniqueLabels.length === 1) {
    return uniqueLabels[0]!;
  }
  if (uniqueLabels.length === 2) {
    return uniqueLabels.join("、");
  }
  return `${uniqueLabels[0]} 等 ${uniqueLabels.length} 項`;
}

export function buildPendingPoSummary(tasks: PendingTaskLike[]) {
  const summaryMap = new Map<string, PendingPoSummaryRow & { categoryLabels: string[] }>();

  for (const task of tasks) {
    const poNumber = task.poNumber?.trim() || "系統補號中";
    const categoryName = task.categoryName?.trim() || task.importedCategoryName?.trim() || "未分類";
    const brandName = task.brandName?.trim() || task.importedBrandName?.trim() || "未指定品牌";
    const current = summaryMap.get(poNumber) ?? {
      key: poNumber,
      poNumber,
      categoryLabel: `${categoryName} × ${brandName}`,
      totalQuantity: 0,
      details: [],
      categoryLabels: [],
    };

    current.totalQuantity += 1;
      current.categoryLabels.push(`${categoryName} × ${brandName}`);
      current.details.push({
      productId: task.productId,
      productCode: task.productCode,
      productName: task.productName ?? null,
      batchNo: task.batchNo ?? null,
      serialNumber: task.serialNumber ?? null,
        imei: task.imei ?? null,
        categoryName: task.categoryName ?? task.importedCategoryName ?? null,
        brandName: task.brandName ?? task.importedBrandName ?? null,
      });
    summaryMap.set(poNumber, current);
  }

  return Array.from(summaryMap.values())
    .map(({ categoryLabels, ...item }) => ({
      ...item,
      categoryLabel: formatSummary(categoryLabels, "未分類"),
    }))
    .sort((left, right) => {
      if (left.poNumber !== right.poNumber) {
        return right.poNumber.localeCompare(left.poNumber);
      }
      return right.totalQuantity - left.totalQuantity;
    });
}
