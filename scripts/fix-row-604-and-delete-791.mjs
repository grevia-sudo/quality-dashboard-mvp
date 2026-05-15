import mysql from 'mysql2/promise';
import { createSign } from 'node:crypto';
import { buildSheetRow, findMatchingRowNumber, SHEET_NAME, SPREADSHEET_ID } from './purchase-sheet-sync-helpers.mjs';

const NO_IMPORT_BATCH = 'NO-IMPORT-BATCH-1778749383598';
const CANONICAL_BATCH = 'Q49QF04603';
const MISBOUND_BATCH = '00500025410';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing');
if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function createSignedJwt(credentials) {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: credentials.token_uri ?? 'https://oauth2.googleapis.com/token',
    exp: nowInSeconds + 3600,
    iat: nowInSeconds,
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();
  const signature = signer
    .sign(credentials.private_key, 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${unsignedToken}.${signature}`;
}

async function getGoogleAccessToken() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const response = await fetch(credentials.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: createSignedJwt(credentials),
    }),
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) {
    throw new Error(`Google access token 取得失敗：${JSON.stringify(result)}`);
  }
  return result.access_token;
}

async function callSheetsApi(accessToken, path, { method = 'GET', body, query = {} } = {}) {
  const url = new URL(`https://sheets.googleapis.com/v4/${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Google Sheets API 失敗：${JSON.stringify(result)}`);
  return result;
}

async function getSheetId(accessToken) {
  const result = await callSheetsApi(accessToken, `spreadsheets/${SPREADSHEET_ID}`, {
    query: { fields: 'sheets.properties(sheetId,title)' },
  });
  const matched = (result.sheets ?? []).find((sheet) => sheet.properties?.title === SHEET_NAME);
  const sheetId = matched?.properties?.sheetId;
  if (typeof sheetId !== 'number') throw new Error(`找不到分頁 ${SHEET_NAME}`);
  return sheetId;
}

async function getSheetValues(accessToken) {
  const result = await callSheetsApi(accessToken, `spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(`${SHEET_NAME}!A:AD`)}`);
  return result.values ?? [];
}

async function appendSheetRow(accessToken, rowValues) {
  return callSheetsApi(accessToken, `spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(`${SHEET_NAME}!A:AD`)}:append`, {
    method: 'POST',
    query: {
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      includeValuesInResponse: 'false',
    },
    body: { values: [rowValues] },
  });
}

const parsed = new URL(process.env.DATABASE_URL);
const db = await mysql.createConnection({
  host: parsed.hostname,
  port: parsed.port ? Number(parsed.port) : 3306,
  user: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
  database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
  timezone: 'Z',
  ssl: { rejectUnauthorized: false },
});

const summary = {
  deletedNoImport: null,
  repaired604: null,
};

try {
  const accessToken = await getGoogleAccessToken();
  const sheetId = await getSheetId(accessToken);
  let values = await getSheetValues(accessToken);

  const [noImportRows] = await db.query(
    `SELECT id, poNumber, batchNo, sheetRowNumber FROM products WHERE batchNo = ? ORDER BY id ASC`,
    [NO_IMPORT_BATCH],
  );
  const noImportProductIds = noImportRows.map((row) => row.id);
  const noImportGoogleRows = [];
  for (let index = 1; index < values.length; index += 1) {
    const row = values[index] ?? [];
    if (String(row[3] ?? '').trim() === NO_IMPORT_BATCH) {
      noImportGoogleRows.push(index + 1);
    }
  }

  if (noImportGoogleRows.length > 0) {
    const requests = noImportGoogleRows
      .sort((a, b) => b - a)
      .map((rowNumber) => ({
        deleteDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber },
        },
      }));
    await callSheetsApi(accessToken, `spreadsheets/${SPREADSHEET_ID}:batchUpdate`, {
      method: 'POST',
      body: { requests },
    });
  }

  if (noImportProductIds.length > 0) {
    const placeholders = noImportProductIds.map(() => '?').join(', ');
    await db.query(`DELETE FROM productivity_score_details WHERE productId IN (${placeholders})`, noImportProductIds);
    await db.query(`DELETE FROM sampling_results WHERE productId IN (${placeholders})`, noImportProductIds);
    await db.query(`DELETE FROM station_events WHERE productId IN (${placeholders})`, noImportProductIds);
    await db.query(`DELETE FROM station_tasks WHERE productId IN (${placeholders})`, noImportProductIds);
    await db.query(`DELETE FROM product_archives WHERE originalProductId IN (${placeholders})`, noImportProductIds);
    await db.query(`DELETE FROM products WHERE id IN (${placeholders})`, noImportProductIds);
  }

  summary.deletedNoImport = {
    deletedProductIds: noImportProductIds,
    deletedGoogleRows: noImportGoogleRows,
  };

  values = await getSheetValues(accessToken);
  const [repairRows] = await db.query(
    `SELECT id, poNumber, vendorName, importedCategoryName, batchNo, serialNumber, imei, productName, sheetRowNumber
     FROM products
     WHERE batchNo IN (?, ?)
     ORDER BY createdAt ASC`,
    [CANONICAL_BATCH, MISBOUND_BATCH],
  );

  const canonical = repairRows.find((row) => row.batchNo === CANONICAL_BATCH);
  const misbound = repairRows.find((row) => row.batchNo === MISBOUND_BATCH);
  if (!canonical || !misbound) {
    throw new Error('找不到 604 修正所需的產品資料');
  }

  const canonicalRow = values[603] ?? [];
  if (String(canonicalRow[3] ?? '').trim() !== CANONICAL_BATCH) {
    throw new Error(`第 604 列目前批號不是 ${CANONICAL_BATCH}，實際為 ${String(canonicalRow[3] ?? '').trim()}`);
  }

  const matchBeforeRepair = findMatchingRowNumber(values, misbound);
  await db.execute(`UPDATE products SET sheetRowNumber = NULL, lastSheetSyncedAt = NULL WHERE id = ?`, [misbound.id]);

  let appendedRowNumber = null;
  if (!matchBeforeRepair) {
    const generatedRow = buildSheetRow(misbound);
    await appendSheetRow(accessToken, generatedRow);
    values.push(generatedRow);
    appendedRowNumber = values.length;
    await db.execute(`UPDATE products SET sheetRowNumber = ?, lastSheetSyncedAt = CURRENT_TIMESTAMP WHERE id = ?`, [appendedRowNumber, misbound.id]);
  }

  summary.repaired604 = {
    canonicalProductId: canonical.id,
    canonicalSheetRowNumber: canonical.sheetRowNumber,
    misboundProductId: misbound.id,
    misboundPreviousSheetRowNumber: misbound.sheetRowNumber,
    matchBeforeRepair,
    appendedRowNumber,
  };

  console.log(JSON.stringify(summary, null, 2));
} finally {
  await db.end();
}
