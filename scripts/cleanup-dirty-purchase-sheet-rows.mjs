import { createSign } from "node:crypto";
import mysql from "mysql2/promise";
import { SHEET_NAME, SPREADSHEET_ID } from "./purchase-sheet-sync-helpers.mjs";

const TARGET_PO_PATTERNS = [/^PO-BACKUP/, /^PO-TRACE/, /^PO-STOCK-BLOCK/];
const TARGET_VENDOR_NAMES = new Set([
  "手動指定 D 站跨站驗證",
  "手動指定保留驗證",
  "手動指定跨站驗證",
  "追蹤驗證廠商",
  "邊界驗證廠商",
  "品牌大小寫驗證廠商",
  "自動補號驗證廠商",
  "待入庫前補匯入廠商",
  "備份驗證廠商",
  "差異驗證廠商",
]);

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing");
}
if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing");
}

function shouldCleanRow(poNumber, vendorName) {
  const normalizedPoNumber = String(poNumber ?? "").trim();
  const normalizedVendorName = String(vendorName ?? "").trim();
  return TARGET_PO_PATTERNS.some((pattern) => pattern.test(normalizedPoNumber)) || TARGET_VENDOR_NAMES.has(normalizedVendorName);
}

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function createSignedJwt(credentials) {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: credentials.token_uri ?? "https://oauth2.googleapis.com/token",
    exp: nowInSeconds + 3600,
    iat: nowInSeconds,
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedToken);
  signer.end();
  const signature = signer
    .sign(credentials.private_key, "base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${unsignedToken}.${signature}`;
}

async function getGoogleAccessToken() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const response = await fetch(credentials.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: createSignedJwt(credentials),
    }),
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) {
    throw new Error(`Google access token 取得失敗：${JSON.stringify(result)}`);
  }
  return result.access_token;
}

async function callSheetsApi(accessToken, path, { method = "GET", body, query = {} } = {}) {
  const url = new URL(`https://sheets.googleapis.com/v4/${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(`Google Sheets API 失敗：${JSON.stringify(result)}`);
  }
  return result;
}

async function getSheetId(accessToken) {
  const result = await callSheetsApi(accessToken, `spreadsheets/${SPREADSHEET_ID}`, {
    query: { fields: "sheets.properties(sheetId,title)" },
  });
  const matched = (result.sheets ?? []).find((sheet) => sheet.properties?.title === SHEET_NAME);
  const sheetId = matched?.properties?.sheetId;
  if (typeof sheetId !== "number") {
    throw new Error(`找不到分頁 ${SHEET_NAME}`);
  }
  return sheetId;
}

function chunk(array, size) {
  const output = [];
  for (let index = 0; index < array.length; index += size) {
    output.push(array.slice(index, index + size));
  }
  return output;
}

const parsed = new URL(process.env.DATABASE_URL);
const db = await mysql.createConnection({
  host: parsed.hostname,
  port: parsed.port ? Number(parsed.port) : 3306,
  user: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
  database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
  timezone: "Z",
  ssl: { rejectUnauthorized: false },
});

try {
  const [dbProducts] = await db.query(`
    SELECT id, poNumber, vendorName
    FROM products
    WHERE poNumber IS NOT NULL AND TRIM(poNumber) <> ''
    ORDER BY poNumber ASC, id ASC
  `);

  const targetDbProducts = dbProducts.filter((row) => shouldCleanRow(row.poNumber, row.vendorName));
  const targetProductIds = targetDbProducts.map((row) => row.id);

  const accessToken = await getGoogleAccessToken();
  const [sheetId, sheetData] = await Promise.all([
    getSheetId(accessToken),
    callSheetsApi(accessToken, `spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(`${SHEET_NAME}!A:AD`)}`),
  ]);

  const values = sheetData.values ?? [];
  const targetGoogleRows = [];
  for (let index = 1; index < values.length; index += 1) {
    const row = values[index] ?? [];
    const poNumber = String(row[0] ?? "").trim();
    const vendorName = String(row[1] ?? "").trim();
    if (!poNumber) continue;
    if (!shouldCleanRow(poNumber, vendorName)) continue;
    targetGoogleRows.push({ rowNumber: index + 1, poNumber, vendorName });
  }

  if (targetProductIds.length > 0) {
    const placeholders = targetProductIds.map(() => "?").join(", ");
    await db.query(`DELETE FROM productivity_score_details WHERE productId IN (${placeholders})`, targetProductIds);
    await db.query(`DELETE FROM sampling_results WHERE productId IN (${placeholders})`, targetProductIds);
    await db.query(`DELETE FROM station_events WHERE productId IN (${placeholders})`, targetProductIds);
    await db.query(`DELETE FROM station_tasks WHERE productId IN (${placeholders})`, targetProductIds);
    await db.query(`DELETE FROM product_archives WHERE originalProductId IN (${placeholders})`, targetProductIds);
    await db.query(`DELETE FROM products WHERE id IN (${placeholders})`, targetProductIds);
  }

  const deleteRequests = targetGoogleRows
    .map((row) => row.rowNumber)
    .sort((a, b) => b - a)
    .map((rowNumber) => ({
      deleteDimension: {
        range: {
          sheetId,
          dimension: "ROWS",
          startIndex: rowNumber - 1,
          endIndex: rowNumber,
        },
      },
    }));

  for (const requests of chunk(deleteRequests, 200)) {
    if (requests.length === 0) continue;
    await callSheetsApi(accessToken, `spreadsheets/${SPREADSHEET_ID}:batchUpdate`, {
      method: "POST",
      body: { requests },
    });
  }

  const summary = {
    deletedDbProducts: targetDbProducts.length,
    deletedGoogleRows: targetGoogleRows.length,
    deletedPoNumbers: Array.from(new Set(targetGoogleRows.map((row) => row.poNumber))).sort(),
  };

  console.log(JSON.stringify(summary, null, 2));
} finally {
  await db.end();
}
