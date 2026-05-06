import mysql from "mysql2/promise";
import { createSign } from "node:crypto";
import fs from "node:fs/promises";
import { SHEET_NAME, SPREADSHEET_ID } from "./purchase-sheet-sync-helpers.mjs";

const retainedPoNumbers = ["PO-20260506-02", "PO-20260505-01"];

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
  const [dbRows] = await db.query(`
    SELECT poNumber, COUNT(*) AS productCount
    FROM products
    WHERE archivedAt IS NULL AND poNumber IS NOT NULL AND TRIM(poNumber) <> ''
    GROUP BY poNumber
    ORDER BY poNumber ASC
  `);

  const accessToken = await getGoogleAccessToken();
  const range = encodeURIComponent(`${SHEET_NAME}!A:AA`);
  const sheetResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const sheetJson = await sheetResponse.json();
  if (!sheetResponse.ok) {
    throw new Error(`讀取 Google Sheet 失敗：${JSON.stringify(sheetJson)}`);
  }

  const values = sheetJson.values ?? [];
  const googleMap = new Map();
  for (let index = 1; index < values.length; index += 1) {
    const row = values[index] ?? [];
    const poNumber = String(row[0] ?? "").trim();
    if (!poNumber) continue;
    const current = googleMap.get(poNumber) ?? { poNumber, rowCount: 0, rowNumbers: [] };
    current.rowCount += 1;
    current.rowNumbers.push(index + 1);
    googleMap.set(poNumber, current);
  }

  const googleRows = Array.from(googleMap.values()).sort((a, b) => a.poNumber.localeCompare(b.poNumber));
  const dbOnly = dbRows.filter((row) => !googleMap.has(row.poNumber));
  const googleOnly = googleRows.filter((row) => !dbRows.some((dbRow) => dbRow.poNumber === row.poNumber));
  const nonRetainedDb = dbRows.filter((row) => !retainedPoNumbers.includes(row.poNumber));
  const nonRetainedGoogle = googleRows.filter((row) => !retainedPoNumbers.includes(row.poNumber));

  const result = {
    retainedPoNumbers,
    dbRows,
    googleRows,
    dbOnly,
    googleOnly,
    nonRetainedDb,
    nonRetainedGoogle,
  };

  await fs.writeFile(new URL("../purchase-order-inventory.json", import.meta.url), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await db.end();
}
