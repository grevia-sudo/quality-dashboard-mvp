import fs from 'node:fs';
import path from 'node:path';

const PROJECT_DIR = '/home/ubuntu/quality-dashboard-mvp';
const SHEET_JSON_PATH = path.join(PROJECT_DIR, 'tmp', 'purchase_sheet_values.json');
const ANALYSIS_PATH = path.join(PROJECT_DIR, 'tmp', 'manual_duplicate_identity_analysis_batch2.json');
const OUTPUT_BATCH_PATH = path.join(PROJECT_DIR, 'tmp', 'manual_duplicate_resolution_batch_batch2.json');
const OUTPUT_REPORT_PATH = path.join(PROJECT_DIR, 'tmp', 'manual_duplicate_resolution_report_batch2.json');
const SHEET_NAME = '採購單';

const PO_COL = 0;
const VENDOR_COL = 1;
const CATEGORY_COL = 2;
const BATCH_COL = 3;
const SERIAL_COL = 4;
const IMEI_COL = 5;
const PRODUCT_NAME_COL = 6;
const NOTE_COL = 30;

function normalize(value) {
  const str = String(value ?? '').trim();
  return str === 'NULL' ? '' : str;
}

const sheet = JSON.parse(fs.readFileSync(SHEET_JSON_PATH, 'utf8'));
const analysis = JSON.parse(fs.readFileSync(ANALYSIS_PATH, 'utf8'));
const rows = sheet.values || [];

const byKey = new Map();
for (const item of analysis.results || []) {
  byKey.set(item.key, item);
}

const updates = [];
const actions = [];

for (let i = 1; i < rows.length; i += 1) {
  const rowNumber = i + 1;
  const row = rows[i] || [];
  const currentSerial = normalize(row[SERIAL_COL]);
  const currentImei = normalize(row[IMEI_COL]);
  const key = byKey.has(currentSerial) ? currentSerial : (byKey.has(currentImei) ? currentImei : '');
  if (!key) continue;

  const item = byKey.get(key);
  if (!item || item.decision === 'manual_review' || item.decision === 'no_candidate') continue;
  const chosen = (item.candidates || []).find((candidate) => String(candidate.id) === String(item.chosenId)) || item.candidates?.[0];
  if (!chosen) continue;

  const target = {
    poNumber: normalize(chosen.poNumber),
    vendorName: normalize(chosen.vendorName),
    categoryName: normalize(chosen.importedCategoryName),
    batchNo: normalize(chosen.batchNo),
    serialNumber: normalize(chosen.serialNumber),
    imei: normalize(chosen.imei),
    productName: normalize(chosen.productName),
  };

  const current = {
    poNumber: normalize(row[PO_COL]),
    vendorName: normalize(row[VENDOR_COL]),
    categoryName: normalize(row[CATEGORY_COL]),
    batchNo: normalize(row[BATCH_COL]),
    serialNumber: currentSerial,
    imei: currentImei,
    productName: normalize(row[PRODUCT_NAME_COL]),
    note: normalize(row[NOTE_COL]),
  };

  const diffs = [
    ['A', 'poNumber'],
    ['B', 'vendorName'],
    ['C', 'categoryName'],
    ['D', 'batchNo'],
    ['E', 'serialNumber'],
    ['F', 'imei'],
    ['G', 'productName'],
  ].filter(([, field]) => current[field] !== target[field]);

  for (const [col, field] of diffs) {
    updates.push({ range: `${SHEET_NAME}!${col}${rowNumber}`, values: [[target[field]]] });
  }

  const note = `${item.reason}；已依人工規則保留系統商品:${chosen.productCode}`;
  if (note !== current.note) {
    updates.push({ range: `${SHEET_NAME}!AE${rowNumber}`, values: [[note]] });
  }

  actions.push({
    key,
    rowNumber,
    decision: item.decision,
    chosenId: chosen.id,
    chosenProductCode: chosen.productCode,
    updatedColumns: diffs.map(([col]) => col).concat(note !== current.note ? ['AE'] : []),
    note,
  });
}

const batch = { valueInputOption: 'RAW', data: updates };
const report = {
  generatedAt: new Date().toISOString(),
  updatedRows: actions.length,
  totalUpdates: updates.length,
  actions,
};

fs.writeFileSync(OUTPUT_BATCH_PATH, JSON.stringify(batch, null, 2) + '\n');
fs.writeFileSync(OUTPUT_REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ outputBatchPath: OUTPUT_BATCH_PATH, outputReportPath: OUTPUT_REPORT_PATH, updatedRows: actions.length, totalUpdates: updates.length }, null, 2));
