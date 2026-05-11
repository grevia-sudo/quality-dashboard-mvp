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

function isTestLike(product) {
  const joined = [product.productCode, product.poNumber, product.vendorName, product.productName]
    .map(normalize)
    .join(' ')
    .toLowerCase();
  return joined.includes('測試') || joined.includes('test') || joined.includes('fallback') || joined.includes('e-bg-');
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

function noteText(parts) {
  return parts.filter(Boolean).join('；');
}

function pickCanonicalCandidate({ rowNumber, currentSerial, currentImei, rowMappedCandidates, identityCandidates }) {
  const nonTestIdentity = identityCandidates.filter((candidate) => !isTestLike(candidate));
  const identityPool = nonTestIdentity.length > 0 ? nonTestIdentity : identityCandidates;
  const exactBoth = uniqueBy(
    identityPool.filter((candidate) => normalize(candidate.serialNumber) === currentSerial && normalize(candidate.imei) === currentImei),
    (candidate) => String(candidate.id),
  );
  if (exactBoth.length === 1) return { mode: 'exact_both', candidate: exactBoth[0] };

  const rowMapped = uniqueBy(
    rowMappedCandidates.filter((candidate) => !isTestLike(candidate)),
    (candidate) => String(candidate.id),
  );
  if (rowMapped.length === 1) return { mode: 'row_mapping', candidate: rowMapped[0] };
  if (rowMappedCandidates.length === 1) return { mode: 'row_mapping_test_like', candidate: rowMappedCandidates[0] };

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

  return { mode: 'ambiguous', candidate: null };
}

const raw = JSON.parse(fs.readFileSync(SHEET_JSON_PATH, 'utf8'));
const rows = raw.values || [];
const header = rows[0] || [];
const SERIAL_COL = 4;
const IMEI_COL = 5;
const BATCH_COL = 3;
const NOTE_COL = 30;

const connection = await mysql.createConnection(process.env.DATABASE_URL);
const [products] = await connection.execute(`
  SELECT
    id,
    productCode,
    poNumber,
    vendorName,
    batchNo,
    serialNumber,
    imei,
    productName,
    sheetRowNumber,
    productStatus,
    stationCode,
    updatedAt
  FROM products
  ORDER BY id ASC
`);
await connection.end();

const systemSerialCounts = new Map();
const systemImeiCounts = new Map();
const systemBySerial = new Map();
const systemByImei = new Map();
const systemByRow = new Map();

for (const product of products) {
  const serial = normalize(product.serialNumber);
  const imei = normalize(product.imei);
  const rowNumber = Number(product.sheetRowNumber || 0);
  addMapCount(systemSerialCounts, serial);
  addMapCount(systemImeiCounts, imei);
  pushMapList(systemBySerial, serial, product);
  pushMapList(systemByImei, imei, product);
  if (rowNumber > 0) {
    pushMapList(systemByRow, String(rowNumber), product);
  }
}

const sheetSerialCounts = new Map();
const sheetImeiCounts = new Map();
for (let i = 1; i < rows.length; i += 1) {
  const row = rows[i] || [];
  addMapCount(sheetSerialCounts, normalize(row[SERIAL_COL]));
  addMapCount(sheetImeiCounts, normalize(row[IMEI_COL]));
}

const updates = [];
const report = {
  spreadsheetId: SPREADSHEET_ID,
  sheetName: SHEET_NAME,
  generatedAt: NOW,
  summary: {
    comparedRows: rows.length - 1,
    duplicateRelatedRows: 0,
    resolvedBySystem: 0,
    annotatedOnly: 0,
    skippedRows: 0,
    totalUpdates: 0,
  },
  actions: [],
};

for (let i = 1; i < rows.length; i += 1) {
  const rowNumber = i + 1;
  const row = rows[i] || [];
  const currentBatch = normalize(row[BATCH_COL]);
  const currentSerial = normalize(row[SERIAL_COL]);
  const currentImei = normalize(row[IMEI_COL]);
  const currentAe = normalize(row[NOTE_COL]);

  const googleSerialDup = currentSerial && (sheetSerialCounts.get(currentSerial) || 0) > 1;
  const googleImeiDup = currentImei && (sheetImeiCounts.get(currentImei) || 0) > 1;
  const systemSerialDup = currentSerial && (systemSerialCounts.get(currentSerial) || 0) > 1;
  const systemImeiDup = currentImei && (systemImeiCounts.get(currentImei) || 0) > 1;
  const duplicateRelated = googleSerialDup || googleImeiDup || systemSerialDup || systemImeiDup;

  if (!duplicateRelated) {
    report.summary.skippedRows += 1;
    continue;
  }

  report.summary.duplicateRelatedRows += 1;
  const rowMappedCandidates = systemByRow.get(String(rowNumber)) || [];
  const identityCandidates = uniqueBy(
    [
      ...(systemBySerial.get(currentSerial) || []),
      ...(systemByImei.get(currentImei) || []),
      ...rowMappedCandidates,
    ],
    (candidate) => String(candidate.id),
  );

  const { mode, candidate } = pickCanonicalCandidate({ rowNumber, currentSerial, currentImei, rowMappedCandidates, identityCandidates });
  const noteParts = [];
  if (googleSerialDup) noteParts.push(`Google序號重複${sheetSerialCounts.get(currentSerial)}列`);
  if (googleImeiDup) noteParts.push(`GoogleIMEI重複${sheetImeiCounts.get(currentImei)}列`);
  if (systemSerialDup) noteParts.push(`系統序號重複${systemSerialCounts.get(currentSerial)}筆`);
  if (systemImeiDup) noteParts.push(`系統IMEI重複${systemImeiCounts.get(currentImei)}筆`);

  if (!candidate) {
    const note = noteText([...noteParts, '無法唯一對應系統商品，請人工確認']);
    if (note !== currentAe) {
      updates.push({ range: `${SHEET_NAME}!AE${rowNumber}`, values: [[note]] });
    }
    report.summary.annotatedOnly += 1;
    report.actions.push({ rowNumber, action: 'annotate_only', mode, currentBatch, currentSerial, currentImei, note });
    continue;
  }

  const targetBatch = normalize(candidate.batchNo);
  const targetSerial = normalize(candidate.serialNumber);
  const targetImei = normalize(candidate.imei);
  const allowValueAlignment = mode !== 'row_mapping' && mode !== 'row_mapping_test_like';
  const diffFields = [];
  if (allowValueAlignment && targetBatch && currentBatch !== targetBatch) diffFields.push({ col: 'D', field: 'batchNo', value: targetBatch });
  if (allowValueAlignment && targetSerial && currentSerial !== targetSerial) diffFields.push({ col: 'E', field: 'serialNumber', value: targetSerial });
  if (allowValueAlignment && targetImei && currentImei !== targetImei) diffFields.push({ col: 'F', field: 'imei', value: targetImei });

  for (const diff of diffFields) {
    updates.push({ range: `${SHEET_NAME}!${diff.col}${rowNumber}`, values: [[diff.value]] });
  }

  const note = noteText([
    ...noteParts,
    allowValueAlignment
      ? (diffFields.length > 0 ? `已依系統對齊(${mode})` : `系統已確認(${mode})`)
      : `row 映射可疑，暫不自動改值(${mode})`,
    `系統商品:${candidate.productCode}`,
  ]);
  if (note !== currentAe) {
    updates.push({ range: `${SHEET_NAME}!AE${rowNumber}`, values: [[note]] });
  }

  if (allowValueAlignment && diffFields.length > 0) {
    report.summary.resolvedBySystem += 1;
  } else {
    report.summary.annotatedOnly += 1;
  }
  report.actions.push({
    rowNumber,
    action: allowValueAlignment && diffFields.length > 0 ? 'align_and_annotate' : 'annotate_only',
    mode,
    productId: candidate.id,
    productCode: candidate.productCode,
    before: { batchNo: currentBatch, serialNumber: currentSerial, imei: currentImei },
    after: { batchNo: targetBatch, serialNumber: targetSerial, imei: targetImei },
    note,
  });
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
