import mysql from "mysql2/promise";
import { createSign } from "node:crypto";
import { formatSheetDateTime, SPREADSHEET_ID, SHEET_NAME } from "./purchase-sheet-sync-helpers.mjs";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing");
if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing");

function normalizeSheetDateTime(value) {
  const text = String(value ?? "").trim();
  const match = /^(\d{4}\/\d{2}\/\d{2})\s+(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return text;
  return `${match[1]} ${match[2].padStart(2, "0")}:${match[3]}`;
}

function parseCreds() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  if (!credentials.client_email || !credentials.private_key) throw new Error("invalid GOOGLE_SERVICE_ACCOUNT_JSON");
  return credentials;
}

function b64url(value) {
  return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function accessToken() {
  const credentials = parseCreds();
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: credentials.token_uri ?? "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  }))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(credentials.private_key, "base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const assertion = `${unsigned}.${signature}`;
  const response = await fetch(credentials.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const json = await response.json();
  if (!response.ok || !json.access_token) throw new Error(JSON.stringify(json));
  return json.access_token;
}

async function readRow(token, rowNumber) {
  const range = encodeURIComponent(`${SHEET_NAME}!A${rowNumber}:AD${rowNumber}`);
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}?valueRenderOption=FORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(json));
  return json.values?.[0] ?? [];
}

const limit = Number(process.argv[2] || "50");
if (!Number.isFinite(limit) || limit <= 0) throw new Error("驗證筆數必須是正整數");

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
  const [rows] = await db.query(`
    SELECT
      p.id AS productId,
      p.poNumber,
      p.serialNumber,
      p.imei,
      p.sheetRowNumber,
      a1.completedAt AS a1CompletedAt,
      a2.completedAt AS a2CompletedAt,
      b.completedAt AS bCompletedAt,
      c.completedAt AS cCompletedAt,
      d.completedAt AS dCompletedAt,
      e.completedAt AS eCompletedAt
    FROM products p
    LEFT JOIN (SELECT productId, MAX(completedAt) AS completedAt FROM station_tasks WHERE stationCode='A1' AND stationTaskStatus='completed' GROUP BY productId) a1 ON a1.productId = p.id
    LEFT JOIN (SELECT productId, MAX(completedAt) AS completedAt FROM station_tasks WHERE stationCode='A2' AND stationTaskStatus='completed' GROUP BY productId) a2 ON a2.productId = p.id
    LEFT JOIN (SELECT productId, MAX(completedAt) AS completedAt FROM station_tasks WHERE stationCode='B' AND stationTaskStatus='completed' GROUP BY productId) b ON b.productId = p.id
    LEFT JOIN (SELECT productId, MAX(completedAt) AS completedAt FROM station_tasks WHERE stationCode='C' AND stationTaskStatus='completed' GROUP BY productId) c ON c.productId = p.id
    LEFT JOIN (SELECT productId, MAX(completedAt) AS completedAt FROM station_tasks WHERE stationCode='D' AND stationTaskStatus='completed' GROUP BY productId) d ON d.productId = p.id
    LEFT JOIN (SELECT productId, MAX(completedAt) AS completedAt FROM station_tasks WHERE stationCode='E' AND stationTaskStatus='completed' GROUP BY productId) e ON e.productId = p.id
    WHERE p.archivedAt IS NULL AND p.sheetRowNumber IS NOT NULL
      AND (
        a1.completedAt IS NOT NULL OR a2.completedAt IS NOT NULL OR b.completedAt IS NOT NULL
        OR c.completedAt IS NOT NULL OR d.completedAt IS NOT NULL OR e.completedAt IS NOT NULL
      )
    ORDER BY COALESCE(e.completedAt, d.completedAt, c.completedAt, b.completedAt, a2.completedAt, a1.completedAt) DESC
    LIMIT ${Math.floor(limit)}
  `);

  const token = await accessToken();
  const stageColumns = {
    a1CompletedAt: 7,
    a2CompletedAt: 9,
    bCompletedAt: 11,
    cCompletedAt: 20,
    dCompletedAt: 23,
    eCompletedAt: 25,
  };

  const results = [];
  let mismatchCount = 0;
  for (const row of rows) {
    const sheetRow = await readRow(token, row.sheetRowNumber);
    const stages = Object.entries(stageColumns).map(([field, index]) => ({
      field,
      expected: row[field] ? formatSheetDateTime(row[field]) : "",
      actual: normalizeSheetDateTime(sheetRow[index] ?? ""),
      matches: (row[field] ? formatSheetDateTime(row[field]) : "") === normalizeSheetDateTime(sheetRow[index] ?? ""),
    }));
    mismatchCount += stages.filter((stage) => !stage.matches).length;
    results.push({
      productId: row.productId,
      poNumber: row.poNumber,
      serialNumber: row.serialNumber,
      imei: row.imei,
      sheetRowNumber: row.sheetRowNumber,
      stages,
    });
  }

  console.log(JSON.stringify({ checkedCount: results.length, mismatchCount, results }, null, 2));
} finally {
  await db.end();
}
