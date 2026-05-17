export const SPREADSHEET_ID = "15uKVOc13iVhs2ffT9FWgKti47s38Hl_Zyjht6o7HU_Y";
export const SHEET_NAME = "採購單";
export const PURCHASE_SHEET_HEADER = ["採購單號", "廠商", "商品分類", "商品批號", "商品序號", "IMEI", "品名", "點到貨時間", "A1執行人", "安裝軟體時間", "A2執行人", "軟體測試時間", "電池檢測", "B站故障狀態", "B站執行人", "測試時間", "是否修改B站的狀態回覆", "螢幕狀態", "機身狀態", "C站測試人員", "C站完成時間", "鏡頭狀態", "D站是否修改檢查結果", "D站完成時間", "D站檢測者", "E站抹除完成時間", "E站測試人員", "E站照片同步狀態", "E站正面照片", "E站反面照片"];

export const SHEET_INDEXES = {
  cStageTime: 15,
  cModifiedPreviousStage: 16,
  cFaultSummary: 17,
  cAppearanceSummary: 18,
  cOperatorName: 19,
  cCompletedAt: 20,
  cCameraSummary: 21,
};

const C_STAGE_REFRESH_INDEXES = [7, 8, 9, 10, 11, 14, 12, 13, 15, 16, 17, 18, 19, 20, 21];

export function stringifyCell(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

export function normalizeBatchNo(value) {
  return stringifyCell(value)
    .replace(/^'+/, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function normalizeBatchNoKey(value) {
  const normalized = normalizeBatchNo(value);
  if (!normalized) {
    return "";
  }

  if (/^\d+$/.test(normalized)) {
    return normalized.replace(/^0+(?=\d)/, "");
  }

  return normalized;
}

function normalizeIdentityCell(value) {
  return stringifyCell(value)
    .replace(/^'+/, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function isSameBatchNo(left, right) {
  const leftKey = normalizeBatchNoKey(left);
  const rightKey = normalizeBatchNoKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
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
  const cAppliedPreviousStageChanges = String(product.cModifiedPreviousStage ?? "").trim().toUpperCase() === "Y";
  const dAppliedInspectionChanges = String(product.dModifiedInspection ?? "").trim().toUpperCase() === "Y";
  const resolvedBatterySummary = dAppliedInspectionChanges
    ? (product.dBatterySummary ?? product.cModifiedBatterySummary ?? product.bBatterySummary ?? "正常")
    : cAppliedPreviousStageChanges
      ? (product.cModifiedBatterySummary ?? product.bBatterySummary ?? "正常")
      : (product.bBatterySummary ?? "正常");
  const resolvedBFaultSummary = dAppliedInspectionChanges
    ? (product.dBFaultSummary ?? product.cModifiedBFaultSummary ?? product.bFaultSummary ?? "正常")
    : cAppliedPreviousStageChanges
      ? (product.cModifiedBFaultSummary ?? product.bFaultSummary ?? "正常")
      : (product.bFaultSummary ?? "正常");
  const resolvedCFaultSummary = dAppliedInspectionChanges
    ? (product.dCFaultSummary ?? product.cFaultSummary ?? "正常")
    : (product.cFaultSummary ?? "正常");
  const resolvedCAppearanceSummary = dAppliedInspectionChanges
    ? (product.dCAppearanceSummary ?? product.cAppearanceSummary ?? "正常")
    : (product.cAppearanceSummary ?? "正常");
  const resolvedCCameraSummary = dAppliedInspectionChanges
    ? (product.dCCameraSummary ?? product.cCameraSummary ?? "正常")
    : (product.cCameraSummary ?? "正常");

  return [
    stringifyCell(product.poNumber),
    stringifyCell(product.vendorName),
    stringifyCell(product.categoryName ?? product.importedCategoryName),
    stringifyCell(product.batchNo),
    stringifyCell(product.serialNumber),
    stringifyCell(product.imei),
    stringifyCell(product.productName),
    formatSheetDateTime(product.a1CompletedAt),
    stringifyCell(product.a1OperatorName),
    formatSheetDateTime(product.a2CompletedAt),
    stringifyCell(product.a2OperatorName),
    formatSheetDateTime(product.bCompletedAt),
    stringifyCell(resolvedBatterySummary),
    stringifyCell(resolvedBFaultSummary),
    stringifyCell(product.bOperatorName),
    formatSheetDateTime(product.cCompletedAt),
    stringifyCell(cAppliedPreviousStageChanges ? "Y" : "N"),
    stringifyCell(resolvedCFaultSummary),
    stringifyCell(resolvedCAppearanceSummary),
    stringifyCell(product.cOperatorName),
    formatSheetDateTime(product.cCompletedAt),
    stringifyCell(resolvedCCameraSummary),
    stringifyCell(dAppliedInspectionChanges ? "Y" : "N"),
    formatSheetDateTime(product.dCompletedAt),
    stringifyCell(product.dOperatorName),
    formatSheetDateTime(product.eCompletedAt),
    stringifyCell(product.eOperatorName),
    stringifyCell(product.eFrontPhotoUrl && product.eBackPhotoUrl ? "Y" : ""),
    stringifyCell(product.eFrontPhotoUrl),
    stringifyCell(product.eBackPhotoUrl),
  ];
}

function hasValue(value) {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return true;
}

function hasCStageData(product) {
  return (
    hasValue(product?.cCompletedAt) ||
    hasValue(product?.cOperatorName) ||
    hasValue(product?.cFaultSummary) ||
    hasValue(product?.cAppearanceSummary) ||
    hasValue(product?.cCameraSummary) ||
    hasValue(product?.cModifiedPreviousStage) ||
    hasValue(product?.cModifiedBatterySummary) ||
    hasValue(product?.cModifiedBFaultSummary)
  );
}

function isSheetDateNewer(candidate, lastSyncedAt) {
  if (!candidate || !lastSyncedAt) {
    return false;
  }

  const candidateDate = candidate instanceof Date ? candidate : new Date(candidate);
  if (Number.isNaN(candidateDate.getTime())) {
    return false;
  }

  return candidateDate.getTime() > lastSyncedAt.getTime();
}

export function getSheetRefreshIndexes(product) {
  const refreshIndexes = new Set();

  if (!product) {
    for (let index = 7; index <= 29; index += 1) {
      refreshIndexes.add(index);
    }
    return refreshIndexes;
  }

  const lastSyncedAt = product.lastSheetSyncedAt ? new Date(product.lastSheetSyncedAt) : null;
  if (!lastSyncedAt || Number.isNaN(lastSyncedAt.getTime())) {
    for (let index = 7; index <= 29; index += 1) {
      refreshIndexes.add(index);
    }
    return refreshIndexes;
  }

  const stageUpdated = {
    a1: isSheetDateNewer(product.a1CompletedAt, lastSyncedAt) || isSheetDateNewer(product.updatedAt, lastSyncedAt),
    a2: isSheetDateNewer(product.a2CompletedAt, lastSyncedAt),
    b: isSheetDateNewer(product.bCompletedAt, lastSyncedAt),
    c: isSheetDateNewer(product.cCompletedAt, lastSyncedAt) || hasCStageData(product),
    d: isSheetDateNewer(product.dCompletedAt, lastSyncedAt),
    e: isSheetDateNewer(product.eCompletedAt, lastSyncedAt),
  };

  if (stageUpdated.a1) {
    [7, 8].forEach((index) => refreshIndexes.add(index));
  }
  if (stageUpdated.a2) {
    [7, 8, 9, 10].forEach((index) => refreshIndexes.add(index));
  }
  if (stageUpdated.b) {
    [7, 8, 9, 10, 11, 12, 13, 14].forEach((index) => refreshIndexes.add(index));
  }
  if (stageUpdated.c) {
    C_STAGE_REFRESH_INDEXES.forEach((index) => refreshIndexes.add(index));
  }
  if (stageUpdated.d) {
    [7, 8, 9, 10, 11, 14, 15, 19, 20, 12, 13, 17, 18, 21, 22, 23, 24].forEach((index) => refreshIndexes.add(index));
  }
  if (stageUpdated.e) {
    [7, 8, 9, 10, 11, 14, 15, 19, 20, 23, 24, 25, 26, 27, 28, 29].forEach((index) => refreshIndexes.add(index));
  }

  return refreshIndexes;
}

export function mergeMissingCells(existingRow, generatedRow, product) {
  const refreshIndexes = getSheetRefreshIndexes(product);

  return generatedRow.map((value, index) => {
    const existingValue = stringifyCell(existingRow[index]);

    if (refreshIndexes.has(index)) {
      return value;
    }

    return existingValue || value;
  });
}

export function matchesSheetRow(row, product) {
  const imei = normalizeIdentityCell(product.imei);
  const serialNumber = normalizeIdentityCell(product.serialNumber);
  const batchNo = normalizeBatchNo(product.batchNo);
  const rowBatchNo = normalizeBatchNo(row?.[3]);
  const rowSerialNumber = normalizeIdentityCell(row?.[4]);
  const rowImei = normalizeIdentityCell(row?.[5]);

  if (isSameBatchNo(batchNo, rowBatchNo)) {
    return true;
  }

  if (serialNumber && imei && rowSerialNumber && rowImei && rowSerialNumber === serialNumber && rowImei === imei) {
    return true;
  }

  return false;
}

export function findMatchingRowNumber(values, product) {
  for (let index = 1; index < values.length; index += 1) {
    const row = values[index] ?? [];

    if (matchesSheetRow(row, product)) {
      return index + 1;
    }
  }

  return null;
}

export function createInitialSheetValues(values) {
  return Array.isArray(values) && values.length > 0 ? values : [PURCHASE_SHEET_HEADER];
}
