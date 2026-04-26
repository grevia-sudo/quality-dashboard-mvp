import mysql from "mysql2/promise";
import { createSign } from "node:crypto";
import { formatSheetDateTime, SPREADSHEET_ID, SHEET_NAME } from "./purchase-sheet-sync-helpers.mjs";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing");
}
if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing");
}

function parseServiceAccountCredentials() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON 缺少 client_email 或 private_key");
  }
  return credentials;
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

  const unsignedToken = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedToken);
  signer.end();
  const signature = signer.sign(credentials.private_key, "base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${unsignedToken}.${signature}`;
}

async function getGoogleAccessToken() {
  const credentials = parseServiceAccountCredentials();
  const assertion = createSignedJwt(credentials);
  const response = await fetch(credentials.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const result = await response.json();
  if (!response.ok || !result.access_token) {
    throw new Error(`Google access token 取得失敗：${JSON.stringify(result)}`);
  }

  return result.access_token;
}

async function getSheetRow(accessToken, rowNumber) {
  const range = encodeURIComponent(`${SHEET_NAME}!A${rowNumber}:AA${rowNumber}`);
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}?valueRenderOption=FORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(`Google Sheets API 失敗：${JSON.stringify(result)}`);
  }
  return result.values?.[0] ?? [];
}

const parsed = new URL(process.env.DATABASE_URL);
const connection = await mysql.createConnection({
  host: parsed.hostname,
  port: parsed.port ? Number(parsed.port) : 3306,
  user: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
  database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
  timezone: "Z",
  ssl: { rejectUnauthorized: false },
});

try {
  const [rows] = await connection.query(`
    SELECT
      p.id AS productId,
      p.poNumber,
      p.batchNo,
      p.serialNumber,
      p.imei,
      p.sheetRowNumber,
      st.completedAt AS eCompletedAt,
      COALESCE(u.name, '') AS eOperatorName
    FROM station_tasks st
    INNER JOIN products p ON p.id = st.productId
    LEFT JOIN station_events se ON se.stationTaskId = st.id AND se.stationCode = 'E' AND se.stationEventType = 'complete'
    LEFT JOIN users u ON u.id = se.operatorUserId
    WHERE st.stationCode = 'E'
      AND st.stationTaskStatus = 'completed'
      AND p.archivedAt IS NULL
      AND p.sheetRowNumber IS NOT NULL
      AND p.poNumber IS NOT NULL
    ORDER BY st.completedAt DESC
    LIMIT 5
  `);

  const accessToken = await getGoogleAccessToken();
  const results = [];
  for (const row of rows) {
    const sheetRow = await getSheetRow(accessToken, row.sheetRowNumber);
    const expectedTime = formatSheetDateTime(row.eCompletedAt);
    const actualTime = String(sheetRow[25] ?? "").trim();
    const actualOperator = String(sheetRow[26] ?? "").trim();
    const expectedOperator = String(row.eOperatorName ?? "").trim();

    results.push({
      productId: row.productId,
      poNumber: row.poNumber,
      batchNo: row.batchNo,
      serialNumber: row.serialNumber,
      imei: row.imei,
      sheetRowNumber: row.sheetRowNumber,
      expectedTime,
      actualTime,
      expectedOperator,
      actualOperator,
      timeMatches: expectedTime === actualTime,
      operatorMatches: expectedOperator === actualOperator,
    });
  }

  console.log(JSON.stringify(results, null, 2));
} finally {
  await connection.end();
}
