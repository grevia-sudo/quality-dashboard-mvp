import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

const PROJECT_DIR = '/home/ubuntu/quality-dashboard-mvp';
const SHEET_JSON_PATH = path.join(PROJECT_DIR, 'tmp', 'purchase_sheet_values.json');
const REPORT_PATH = path.join(PROJECT_DIR, 'tmp', 'purchase_sheet_reconcile_report.json');
const BATCH_PATH = path.join(PROJECT_DIR, 'tmp', 'purchase_sheet_reconcile_batch.json');
const SPREADSHEET_ID = '15uKVOc13iVhs2ffT9FWgKti47s38Hl_Zyjht6o7HU_Y';
const SHEET_NAME = '採購單';
const NOW = new Date().toISOString();

const PO_COL = 0;
const VENDOR_COL = 1;
const CATEGORY_COL = 2;
const BATCH_COL = 3;
const SERIAL_COL = 4;
const IMEI_COL = 5;
const PRODUCT_NAME_COL = 6;
const NOTE_COL = 30;
const TOTAL_COLS = 31;

function normalize(value) {
  return String(value ?? '').trim();
}

function addMapCount(map, key) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + 1);
}

function pushMapList(map, key, value) {
  if (!key) return;
  const list = map.get(key) || [];
  list.push(value);
  map.set(key, list);
}

function uniqueBy(list, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function isTestLike(product) {
  const joined = [product.productCode, product.poNumber, product.vendorName, product.productName]
    .map(normalize)
    .join(' ')
    .toLowerCase();
  return joined.includes('測試') || joined.includes('test') || joined.includes('fallback') || joined.includes('e-bg-');
}

function preferNonTest(list) {
  const nonTest = list.filter((item) => !isTestLike(item));
  return nonTest.length > 0 ? nonTest : list;
}

function noteText(parts) {
  return parts.filter(Boolean).join('；');
}

function pickCanonicalCandidate({ currentBatch, currentSerial, currentImei, rowMappedCandidates, identityCandidates, batchCandidates }) {
  const identityPool = preferNonTest(identityCandidates);

  const exactBoth = uniqueBy(
    identityPool.filter((candidate) => currentSerial && currentImei && normalize(candidate.serialNumber) === currentSerial && normalize(candidate.imei) === currentImei),
    (candidate) => String(candidate.id),
  );
  if (exactBoth.length === 1) return { mode: 'exact_both', candidate: exactBoth[0] };

  const exactSerial = uniqueBy(
    identityPool.filter((candidate) => currentSerial && normalize(candidate.serialNumber) === currentSerial),
    (candidate) => String(candidate.id),
  );
  if (exactSerial.length === 1) return { mode: 'exact_serial', candidate: exactSerial[0] };

  const exactImei = uniqueBy(
    identityPool.filter((candidate) => currentImei && normalize(candidate.imei) === currentImei),
    (candidate) => String(candidate.id),
  );
  if (exactImei.length === 1) return { mode: 'exact_imei', candidate: exactImei[0] };

  const exactBatch = uniqueBy(
    preferNonTest(batchCandidates).filter((candidate) => currentBatch && normalize(candidate.batchNo) === currentBatch),
    (candidate) => String(candidate.id),
  );
  if (exactBatch.length === 1) return { mode: 'exact_batch', candidate: exactBatch[0] };

  const rowMapped = uniqueBy(preferNonTest(rowMappedCandidates), (candidate) => String(candidate.id));
  if (rowMapped.length === 1) return { mode: 'row_mapping', candidate: rowMapped[0] };

  const fallbackUnique = uniqueBy(identityPool, (candidate) => String(candidate.id));
  if (fallbackUnique.length === 1) return { mode: 'identity_pool_single', candidate: fallbackUnique[0] };

  return { mode: 'ambiguous', candidate: null };
}

const raw = JSON.parse(fs.readFileSync(SHEET_JSON_PATH, 'utf8'));
const rows = raw.values || [];

const connection = await mysql.createConnection(process.env.DATABASE_URL);
const [products] = await connection.execute(`
  SELECT
    id,
    productCode,
    poNumber,
    vendorName,
    importedCategoryName,
    batchNo,
    serialNumber,
    imei,
    productName,
    sheetRowNumber,
    productStatus,
    stationCode,
    updatedAt
  FROM products
  WHERE archivedAt IS NULL
  ORDER BY id ASC
`);
await connection.end();

const systemBatchCounts = new Map();
const systemSerialCounts = new Map();
const systemImeiCounts = new Map();
const systemByBatch = new Map();
const systemBySerial = new Map();
const systemByImei = new Map();
const systemByRow = new Map();

for (const product of products) {
  const batch = normalize(product.batchNo);
  const serial = normalize(product.serialNumber);
  const imei = normalize(product.imei);
  const rowNumber = Number(product.sheetRowNumber || 0);
  addMapCount(systemBatchCounts, batch);
  addMapCount(systemSerialCounts, serial);
  addMapCount(systemImeiCounts, imei);
  pushMapList(systemByBatch, batch, product);
  pushMapList(systemBySerial, serial, product);
  pushMapList(systemByImei, imei, product);
  if (rowNumber > 0) {
    pushMapList(systemByRow, String(rowNumber), product);
  }
}

const sheetBatchCounts = new Map();
const sheetSerialCounts = new Map();
const sheetImeiCounts = new Map();
for (let i = 1; i < rows.length; i += 1) {
  const row = rows[i] || [];
  addMapCount(sheetBatchCounts, normalize(row[BATCH_COL]));
  addMapCount(sheetSerialCounts, normalize(row[SERIAL_COL]));
  addMapCount(sheetImeiCounts, normalize(row[IMEI_COL]));
}

const updates = [];
const report = {
  spreadsheetId: SPREADSHEET_ID,
  sheetName: SHEET_NAME,
  generatedAt: NOW,
  summary: {
    comparedRows: 0,
    matchedRows: 0,
    alignedRows: 0,
    annotatedOnlyRows: 0,
    missingInSystemRows: 0,
    ambiguousRows: 0,
    appendedMissingSystemRows: 0,
    totalUpdates: 0,
  },
  actions: [],
};

for (let i = 1; i < rows.length; i += 1) {
  const rowNumber = i + 1;
  const row = rows[i] || [];
  const currentPo = normalize(row[PO_COL]);
  const currentVendor = normalize(row[VENDOR_COL]);
  const currentCategory = normalize(row[CATEGORY_COL]);
  const currentBatch = normalize(row[BATCH_COL]);
  const currentSerial = normalize(row[SERIAL_COL]);
  const currentImei = normalize(row[IMEI_COL]);
  const currentProductName = normalize(row[PRODUCT_NAME_COL]);
  const currentAe = normalize(row[NOTE_COL]);
  const hasAnyIdentity = Boolean(currentBatch || currentSerial || currentImei);

  if (!hasAnyIdentity) {
    continue;
  }

  report.summary.comparedRows += 1;

  const rowMappedCandidates = systemByRow.get(String(rowNumber)) || [];
  const batchCandidates = systemByBatch.get(currentBatch) || [];
  const identityCandidates = uniqueBy(
    [
      ...batchCandidates,
      ...(systemBySerial.get(currentSerial) || []),
      ...(systemByImei.get(currentImei) || []),
      ...rowMappedCandidates,
    ],
    (candidate) => String(candidate.id),
  );

  const { mode, candidate } = pickCanonicalCandidate({
    currentBatch,
    currentSerial,
    currentImei,
    rowMappedCandidates,
    identityCandidates,
    batchCandidates,
  });

  const noteParts = [];
  if (currentBatch && (sheetBatchCounts.get(currentBatch) || 0) > 1) noteParts.push(`Google批號重複${sheetBatchCounts.get(currentBatch)}列`);
  if (currentSerial && (sheetSerialCounts.get(currentSerial) || 0) > 1) noteParts.push(`Google序號重複${sheetSerialCounts.get(currentSerial)}列`);
  if (currentImei && (sheetImeiCounts.get(currentImei) || 0) > 1) noteParts.push(`GoogleIMEI重複${sheetImeiCounts.get(currentImei)}列`);
  if (currentBatch && (systemBatchCounts.get(currentBatch) || 0) > 1) noteParts.push(`系統批號重複${systemBatchCounts.get(currentBatch)}筆`);
  if (currentSerial && (systemSerialCounts.get(currentSerial) || 0) > 1) noteParts.push(`系統序號重複${systemSerialCounts.get(currentSerial)}筆`);
  if (currentImei && (systemImeiCounts.get(currentImei) || 0) > 1) noteParts.push(`系統IMEI重複${systemImeiCounts.get(currentImei)}筆`);

  if (!candidate) {
    const reason = identityCandidates.length === 0
      ? '系統查無對應商品，請先確認是否尚未匯入系統'
      : '無法唯一對應系統商品，請人工確認';
    const note = noteText([...noteParts, reason]);
    if (note !== currentAe) {
      updates.push({ range: `${SHEET_NAME}!AE${rowNumber}`, values: [[note]] });
    }
    report.summary.annotatedOnlyRows += 1;
    if (identityCandidates.length === 0) {
      report.summary.missingInSystemRows += 1;
    } else {
      report.summary.ambiguousRows += 1;
    }
    report.actions.push({
      rowNumber,
      action: 'annotate_only',
      mode,
      currentBatch,
      currentSerial,
      currentImei,
      note,
    });
    continue;
  }

  report.summary.matchedRows += 1;

  const targetPo = normalize(candidate.poNumber);
  const targetVendor = normalize(candidate.vendorName);
  const targetCategory = normalize(candidate.importedCategoryName);
  const targetBatch = normalize(candidate.batchNo);
  const targetSerial = normalize(candidate.serialNumber);
  const targetImei = normalize(candidate.imei);
  const targetProductName = normalize(candidate.productName);
  const allowValueAlignment = mode !== 'row_mapping';
  const diffFields = [];
  if (allowValueAlignment && targetPo && currentPo !== targetPo) diffFields.push({ col: 'A', field: 'poNumber', value: targetPo });
  if (allowValueAlignment && targetVendor && currentVendor !== targetVendor) diffFields.push({ col: 'B', field: 'vendorName', value: targetVendor });
  if (allowValueAlignment && targetCategory && currentCategory !== targetCategory) diffFields.push({ col: 'C', field: 'importedCategoryName', value: targetCategory });
  if (allowValueAlignment && targetBatch && currentBatch !== targetBatch) diffFields.push({ col: 'D', field: 'batchNo', value: targetBatch });
  if (allowValueAlignment && targetSerial && currentSerial !== targetSerial) diffFields.push({ col: 'E', field: 'serialNumber', value: targetSerial });
  if (allowValueAlignment && targetImei && currentImei !== targetImei) diffFields.push({ col: 'F', field: 'imei', value: targetImei });
  if (allowValueAlignment && targetProductName && currentProductName !== targetProductName) diffFields.push({ col: 'G', field: 'productName', value: targetProductName });

  for (const diff of diffFields) {
    updates.push({ range: `${SHEET_NAME}!${diff.col}${rowNumber}`, values: [[diff.value]] });
  }

  const note = noteText([
    ...noteParts,
    allowValueAlignment
      ? (diffFields.length > 0 ? `已依系統更新識別欄位(${mode})` : `系統已有對應資料(${mode})`)
      : `系統疑似對應此列，但僅靠 row 映射判定，暫不自動改值`,
    `系統商品:${candidate.productCode}`,
  ]);

  if (note !== currentAe) {
    updates.push({ range: `${SHEET_NAME}!AE${rowNumber}`, values: [[note]] });
  }

  if (allowValueAlignment && diffFields.length > 0) {
    report.summary.alignedRows += 1;
  } else {
    report.summary.annotatedOnlyRows += 1;
  }

  report.actions.push({
    rowNumber,
    action: allowValueAlignment && diffFields.length > 0 ? 'align_and_annotate' : 'annotate_only',
    mode,
    productId: candidate.id,
    productCode: candidate.productCode,
    before: { poNumber: currentPo, vendorName: currentVendor, categoryName: currentCategory, batchNo: currentBatch, serialNumber: currentSerial, imei: currentImei, productName: currentProductName },
    after: { poNumber: targetPo, vendorName: targetVendor, categoryName: targetCategory, batchNo: targetBatch, serialNumber: targetSerial, imei: targetImei, productName: targetProductName },
    note,
  });
}

const sheetIdentitySet = new Set();
for (let i = 1; i < rows.length; i += 1) {
  const row = rows[i] || [];
  const batch = normalize(row[BATCH_COL]);
  const serial = normalize(row[SERIAL_COL]);
  const imei = normalize(row[IMEI_COL]);
  if (batch) sheetIdentitySet.add(`B:${batch}`);
  if (serial) sheetIdentitySet.add(`S:${serial}`);
  if (imei) sheetIdentitySet.add(`I:${imei}`);
}

const missingProducts = products.filter((product) => {
  const batch = normalize(product.batchNo);
  const serial = normalize(product.serialNumber);
  const imei = normalize(product.imei);
  const exists = (batch && sheetIdentitySet.has(`B:${batch}`))
    || (serial && sheetIdentitySet.has(`S:${serial}`))
    || (imei && sheetIdentitySet.has(`I:${imei}`));
  return !exists;
});

let appendRowNumber = rows.length + 1;
for (const product of missingProducts) {
  const note = noteText([
    '系統有商品但 Google 尚未建立資料列，已自動補寫',
    !normalize(product.poNumber) ? '系統缺少採購單號' : '',
    !normalize(product.vendorName) ? '系統缺少廠商' : '',
    !normalize(product.importedCategoryName) ? '系統缺少分類' : '',
    `系統商品:${normalize(product.productCode)}`,
  ]);
  const rowValues = Array(TOTAL_COLS).fill('');
  rowValues[PO_COL] = normalize(product.poNumber);
  rowValues[VENDOR_COL] = normalize(product.vendorName);
  rowValues[CATEGORY_COL] = normalize(product.importedCategoryName);
  rowValues[BATCH_COL] = normalize(product.batchNo);
  rowValues[SERIAL_COL] = normalize(product.serialNumber);
  rowValues[IMEI_COL] = normalize(product.imei);
  rowValues[PRODUCT_NAME_COL] = normalize(product.productName);
  rowValues[NOTE_COL] = note;
  updates.push({ range: `${SHEET_NAME}!A${appendRowNumber}:AE${appendRowNumber}`, values: [rowValues] });
  report.summary.appendedMissingSystemRows += 1;
  report.actions.push({
    rowNumber: appendRowNumber,
    action: 'append_missing_system_row',
    mode: 'system_only',
    productId: product.id,
    productCode: product.productCode,
    after: { poNumber: rowValues[PO_COL], vendorName: rowValues[VENDOR_COL], categoryName: rowValues[CATEGORY_COL], batchNo: rowValues[BATCH_COL], serialNumber: rowValues[SERIAL_COL], imei: rowValues[IMEI_COL], productName: rowValues[PRODUCT_NAME_COL] },
    note,
  });
  appendRowNumber += 1;
}

const batchBody = {
  valueInputOption: 'RAW',
  data: updates,
};
report.summary.totalUpdates = updates.length;

fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(BATCH_PATH, JSON.stringify(batchBody, null, 2) + '\n');

console.log(JSON.stringify({
  spreadsheetId: SPREADSHEET_ID,
  reportPath: REPORT_PATH,
  batchPath: BATCH_PATH,
  summary: report.summary,
}, null, 2));
