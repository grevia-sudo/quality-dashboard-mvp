import mysql from "mysql2/promise";
import { createSign } from "node:crypto";
import { SPREADSHEET_ID, SHEET_NAME, buildSheetRow } from "./purchase-sheet-sync-helpers.mjs";

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
async function readRows(token, rowNumbers) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchGet?ranges=${rowNumbers.map((row) => encodeURIComponent(`${SHEET_NAME}!A${row}:AD${row}`)).join("&ranges=")}&valueRenderOption=FORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(json));
  return json.valueRanges ?? [];
}
async function updateRow(token, rowNumber, values) {
  const range = encodeURIComponent(`${SHEET_NAME}!A${rowNumber}:AD${rowNumber}`);
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: [values] }),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(json));
  return json;
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
  const [rows] = await db.query(`
    SELECT
      p.id,
      p.poNumber,
      p.vendorName,
      p.importedCategoryName,
      p.batchNo,
      p.serialNumber,
      p.imei,
      p.productName,
      p.sheetRowNumber,
      a1.completedAt AS a1CompletedAt,
      a1Operator.a1OperatorName,
      a2.completedAt AS a2CompletedAt,
      a2Operator.a2OperatorName,
      b.completedAt AS bCompletedAt,
      bOperator.bOperatorName,
      cTask.completedAt AS cCompletedAt,
      cOperator.cOperatorName,
      dTask.completedAt AS dCompletedAt,
      dOperator.dOperatorName,
      eTask.completedAt AS eCompletedAt,
      eOperator.eOperatorName
    FROM products p
    LEFT JOIN (
      SELECT productId, MAX(completedAt) AS completedAt
      FROM station_tasks
      WHERE stationCode = 'A1' AND stationTaskStatus = 'completed'
      GROUP BY productId
    ) a1 ON a1.productId = p.id
    LEFT JOIN (
      SELECT latestA1.productId, COALESCE(u.name, '') AS a1OperatorName
      FROM station_events se
      INNER JOIN (
        SELECT productId, MAX(id) AS eventId
        FROM station_events
        WHERE stationCode = 'A1' AND stationEventType = 'complete'
        GROUP BY productId
      ) latestA1 ON latestA1.eventId = se.id
      LEFT JOIN users u ON u.id = se.operatorUserId
    ) a1Operator ON a1Operator.productId = p.id
    LEFT JOIN (
      SELECT productId, MAX(completedAt) AS completedAt
      FROM station_tasks
      WHERE stationCode = 'A2' AND stationTaskStatus = 'completed'
      GROUP BY productId
    ) a2 ON a2.productId = p.id
    LEFT JOIN (
      SELECT latestA2.productId, COALESCE(u.name, '') AS a2OperatorName
      FROM station_events se
      INNER JOIN (
        SELECT productId, MAX(id) AS eventId
        FROM station_events
        WHERE stationCode = 'A2' AND stationEventType = 'complete'
        GROUP BY productId
      ) latestA2 ON latestA2.eventId = se.id
      LEFT JOIN users u ON u.id = se.operatorUserId
    ) a2Operator ON a2Operator.productId = p.id
    LEFT JOIN (
      SELECT productId, MAX(completedAt) AS completedAt
      FROM station_tasks
      WHERE stationCode = 'B' AND stationTaskStatus = 'completed'
      GROUP BY productId
    ) b ON b.productId = p.id
    LEFT JOIN (
      SELECT latestB.productId, COALESCE(u.name, '') AS bOperatorName
      FROM station_events se
      INNER JOIN (
        SELECT productId, MAX(id) AS eventId
        FROM station_events
        WHERE stationCode = 'B' AND stationEventType = 'complete'
        GROUP BY productId
      ) latestB ON latestB.eventId = se.id
      LEFT JOIN users u ON u.id = se.operatorUserId
    ) bOperator ON bOperator.productId = p.id
    LEFT JOIN (
      SELECT productId, MAX(completedAt) AS completedAt
      FROM station_tasks
      WHERE stationCode = 'C' AND stationTaskStatus = 'completed'
      GROUP BY productId
    ) cTask ON cTask.productId = p.id
    LEFT JOIN (
      SELECT latestC.productId, COALESCE(u.name, '') AS cOperatorName
      FROM station_events se
      INNER JOIN (
        SELECT productId, MAX(id) AS eventId
        FROM station_events
        WHERE stationCode = 'C' AND stationEventType = 'complete'
        GROUP BY productId
      ) latestC ON latestC.eventId = se.id
      LEFT JOIN users u ON u.id = se.operatorUserId
    ) cOperator ON cOperator.productId = p.id
    LEFT JOIN (
      SELECT productId, MAX(completedAt) AS completedAt
      FROM station_tasks
      WHERE stationCode = 'D' AND stationTaskStatus = 'completed'
      GROUP BY productId
    ) dTask ON dTask.productId = p.id
    LEFT JOIN (
      SELECT latestD.productId, COALESCE(u.name, '') AS dOperatorName
      FROM station_events se
      INNER JOIN (
        SELECT productId, MAX(id) AS eventId
        FROM station_events
        WHERE stationCode = 'D' AND stationEventType IN ('sampling_pass', 'sampling_fail')
        GROUP BY productId
      ) latestD ON latestD.eventId = se.id
      LEFT JOIN users u ON u.id = se.operatorUserId
    ) dOperator ON dOperator.productId = p.id
    LEFT JOIN (
      SELECT productId, MAX(completedAt) AS completedAt
      FROM station_tasks
      WHERE stationCode = 'E' AND stationTaskStatus = 'completed'
      GROUP BY productId
    ) eTask ON eTask.productId = p.id
    LEFT JOIN (
      SELECT latestE.productId, COALESCE(u.name, '') AS eOperatorName
      FROM station_events se
      INNER JOIN (
        SELECT productId, MAX(id) AS eventId
        FROM station_events
        WHERE stationCode = 'E' AND stationEventType = 'complete'
        GROUP BY productId
      ) latestE ON latestE.eventId = se.id
      LEFT JOIN users u ON u.id = se.operatorUserId
    ) eOperator ON eOperator.productId = p.id
    WHERE p.archivedAt IS NULL
      AND p.sheetRowNumber IS NOT NULL
      AND (p.vendorName IS NOT NULL)
      AND (p.importedCategoryName IS NOT NULL)
      AND (p.batchNo IS NOT NULL OR p.serialNumber IS NOT NULL OR p.imei IS NOT NULL)
      AND (
        a1.completedAt IS NOT NULL OR a2.completedAt IS NOT NULL OR b.completedAt IS NOT NULL
        OR cTask.completedAt IS NOT NULL OR dTask.completedAt IS NOT NULL OR eTask.completedAt IS NOT NULL
      )
    ORDER BY COALESCE(eTask.completedAt, dTask.completedAt, cTask.completedAt, b.completedAt, a2.completedAt, a1.completedAt) DESC
    LIMIT 50
  `);

  const token = await accessToken();
  const valueRanges = await readRows(token, rows.map((row) => row.sheetRowNumber));
  const currentByRow = new Map();
  for (const range of valueRanges) {
    const match = /!(?:A)?(\d+):AD\1$/.exec(range.range || "");
    if (!match) continue;
    currentByRow.set(Number(match[1]), range.values?.[0] ?? []);
  }

  const repairs = [];
  for (const row of rows) {
    const expected = buildSheetRow(row);
    const actual = currentByRow.get(row.sheetRowNumber) ?? [];
    const mismatches = [];
    for (const index of [7, 8, 9, 10, 11, 14, 15, 19, 20, 23, 24, 25, 26]) {
      const normalizedActual = normalizeSheetDateTime(actual[index] ?? "");
      const normalizedExpected = normalizeSheetDateTime(expected[index] ?? "");
      if (normalizedActual !== normalizedExpected) {
        mismatches.push({ index, expected: normalizedExpected, actual: normalizedActual });
      }
    }
    if (mismatches.length > 0) {
      await updateRow(token, row.sheetRowNumber, expected);
      repairs.push({ productId: row.id, sheetRowNumber: row.sheetRowNumber, mismatches });
    }
  }

  console.log(JSON.stringify({ repairedCount: repairs.length, repairs }, null, 2));
} finally {
  await db.end();
}
