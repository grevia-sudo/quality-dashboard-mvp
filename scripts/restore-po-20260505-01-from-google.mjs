import mysql from "mysql2/promise";
import { createSign } from "node:crypto";
import fs from "node:fs/promises";
import { SHEET_NAME, SPREADSHEET_ID } from "./purchase-sheet-sync-helpers.mjs";

const TARGET_PO = "PO-20260505-01";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing");
}
if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing");
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
  const [[existing]] = await db.query(
    `SELECT COUNT(*) AS count FROM products WHERE poNumber = ?`,
    [TARGET_PO],
  );
  if (Number(existing.count ?? 0) > 0) {
    const summary = { poNumber: TARGET_PO, restored: 0, skipped: true, reason: "already_exists" };
    await fs.writeFile(new URL("../restore-po-20260505-01-result.json", import.meta.url), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  }

  const accessToken = await getGoogleAccessToken();
  const encodedRange = encodeURIComponent(`${SHEET_NAME}!A:AA`);
  const sheetResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodedRange}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const sheetJson = await sheetResponse.json();
  if (!sheetResponse.ok) {
    throw new Error(`讀取 Google Sheet 失敗：${JSON.stringify(sheetJson)}`);
  }

  const values = sheetJson.values ?? [];
  const rows = [];
  for (let index = 1; index < values.length; index += 1) {
    const row = values[index] ?? [];
    const poNumber = String(row[0] ?? "").trim();
    if (poNumber !== TARGET_PO) continue;
    rows.push({
      rowNumber: index + 1,
      poNumber,
      vendorName: String(row[1] ?? "").trim() || null,
      importedCategoryName: String(row[2] ?? "").trim() || null,
      batchNo: String(row[3] ?? "").trim() || null,
      serialNumber: String(row[4] ?? "").trim() || null,
      imei: String(row[5] ?? "").trim() || null,
      productName: String(row[6] ?? "").trim() || null,
    });
  }

  if (rows.length === 0) {
    throw new Error(`Google 採購單工作表中找不到 ${TARGET_PO}`);
  }

  const now = new Date();
  const insertValues = rows.map((row) => ({
    productCode: `RESTORED-${TARGET_PO}-${row.rowNumber}`,
    batchNo: row.batchNo,
    serialNumber: row.serialNumber,
    imei: row.imei,
    productName: row.productName,
    poNumber: row.poNumber,
    vendorName: row.vendorName,
    sheetRowNumber: row.rowNumber,
    lastSheetSyncedAt: now,
    importedCategoryName: row.importedCategoryName,
  }));

  await db.query(
    `
      INSERT INTO products (
        productCode, batchNo, serialNumber, imei, productName,
        poNumber, vendorName, sheetRowNumber, lastSheetSyncedAt, importedCategoryName
      ) VALUES ?
    `,
    [insertValues.map((row) => [
      row.productCode,
      row.batchNo,
      row.serialNumber,
      row.imei,
      row.productName,
      row.poNumber,
      row.vendorName,
      row.sheetRowNumber,
      row.lastSheetSyncedAt,
      row.importedCategoryName,
    ])],
  );

  const summary = {
    poNumber: TARGET_PO,
    restored: rows.length,
    skipped: false,
    firstRowNumber: rows[0]?.rowNumber ?? null,
    lastRowNumber: rows.at(-1)?.rowNumber ?? null,
  };
  await fs.writeFile(new URL("../restore-po-20260505-01-result.json", import.meta.url), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await db.end();
}
