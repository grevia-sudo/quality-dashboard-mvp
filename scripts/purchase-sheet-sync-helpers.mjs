export const SPREADSHEET_ID = "15uKVOc13iVhs2ffT9FWgKti47s38Hl_Zyjht6o7HU_Y";
export const SHEET_NAME = "採購單";
export const PURCHASE_SHEET_HEADER = ["採購單號", "廠商", "商品分類", "商品批號", "商品序號", "IMEI", "品名", "點到貨時間", "安裝完成時間", "B站完成時間", "電池檢測", "B站故障狀態"];

export function stringifyCell(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

export function formatSheetDateTime(value) {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return stringifyCell(value);
  }

  const formatter = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  const hour = String(parts.hour ?? "").padStart(2, "0");
  const minute = String(parts.minute ?? "").padStart(2, "0");

  return `${parts.year}/${parts.month}/${parts.day} ${hour}:${minute}`;
}

export function buildSheetRow(product) {
  return [
    stringifyCell(product.poNumber),
    stringifyCell(product.vendorName),
    stringifyCell(product.categoryName ?? product.importedCategoryName),
    stringifyCell(product.batchNo),
    stringifyCell(product.serialNumber),
    stringifyCell(product.imei),
    stringifyCell(product.productName),
    formatSheetDateTime(product.a1CompletedAt),
    formatSheetDateTime(product.a2CompletedAt),
    formatSheetDateTime(product.bCompletedAt),
    stringifyCell(product.bBatterySummary ?? "正常"),
    stringifyCell(product.bFaultSummary ?? "正常"),
  ];
}

export function mergeMissingCells(existingRow, generatedRow) {
  return generatedRow.map((value, index) => {
    const existingValue = stringifyCell(existingRow[index]);

    if (index === 7 || index === 8 || index === 9 || index === 10 || index === 11) {
      return value || existingValue;
    }

    return existingValue || value;
  });
}

export function findMatchingRowNumber(values, product) {
  const imei = stringifyCell(product.imei);
  const serialNumber = stringifyCell(product.serialNumber);
  const batchNo = stringifyCell(product.batchNo);

  for (let index = 1; index < values.length; index += 1) {
    const row = values[index] ?? [];
    const rowBatchNo = stringifyCell(row[3]);
    const rowSerialNumber = stringifyCell(row[4]);
    const rowImei = stringifyCell(row[5]);

    if (imei && rowImei && rowImei === imei) {
      return index + 1;
    }
    if (serialNumber && rowSerialNumber && rowSerialNumber === serialNumber) {
      return index + 1;
    }
    if (batchNo && rowBatchNo && rowBatchNo === batchNo) {
      return index + 1;
    }
  }

  return null;
}

export function createInitialSheetValues(values) {
  return Array.isArray(values) && values.length > 0 ? values : [PURCHASE_SHEET_HEADER];
}
