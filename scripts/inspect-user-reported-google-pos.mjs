import { createSign } from "node:crypto";
import { SHEET_NAME, SPREADSHEET_ID } from "./purchase-sheet-sync-helpers.mjs";

const TARGET_POS = Array.from(new Set([
  "TEST-A1-IMEI-1778826816380",
  "PO-BACKUP-1778826816943",
  "PO-20260515-02",
  "PO-NO-IMPORT-1778826818660",
  "PO-BACKUP-DIFF-1778826821042",
  "PO-STOCK-BLOCK-1778826826056",
  "PO-20260515-03",
  "PO-BACKUP-EDGE-1778826827794",
  "PO-20260515-04",
  "PO-20260515-05",
  "PO-TRACE-1778826834298",
  "PO-20260515-06",
  "PO-20260515-07",
  "PO-20260515-08",
  "PO-20260515-09",
  "PO-20260515-10",
  "PO-KPI-GOOGLE-GUARD-1778826846072-google-guard",
  "TEST-A1-DUP-GUARD-1778826849221",
  "TEST-A1-NAME-1778826854207",
  "TEST-A1-SN-1778826856016",
  "TEST-A1-BATCH-1778826857819",
  "TEST-A1-GHOST-1778826859856",
  "PO-GOOGLE-BLANK-1778826861695",
  "PO-GOOGLE-BATCH-1778826866888",
  "PO-A1-RENAME-1778826869516",
  "PO-E-RESTORE-1778826873289",
  "PO-BATCH-GUARD-1778826897044",
  "PO-BATCH-BASE-NORMALIZED-1778826900251",
  "PO-BATCH-BASE-1778826903894",
  "PO-A1-NAME-1778826926539",
]));

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
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
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
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing");
  }
  const credentials = JSON.parse(raw);
  const response = await fetch(credentials.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: createSignedJwt(credentials),
    }),
  });
  const json = await response.json();
  if (!response.ok || !json.access_token) {
    throw new Error(`Failed to get Google token: ${JSON.stringify(json)}`);
  }
  return json.access_token;
}

async function main() {
  const token = await getGoogleAccessToken();
  const range = encodeURIComponent(`${SHEET_NAME}!A:AD`);
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}?valueRenderOption=FORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(JSON.stringify(json));
  }

  const rows = json.values ?? [];
  const matches = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    const poNumber = String(row[0] ?? "").trim();
    if (!TARGET_POS.includes(poNumber)) {
      continue;
    }
    matches.push({
      rowNumber: index + 1,
      poNumber,
      vendorName: String(row[1] ?? "").trim(),
      batchNo: String(row[3] ?? "").trim(),
      serialNumber: String(row[4] ?? "").trim(),
      imei: String(row[5] ?? "").trim(),
      productName: String(row[6] ?? "").trim(),
    });
  }

  const grouped = Object.fromEntries(TARGET_POS.map((poNumber) => [
    poNumber,
    matches.filter((item) => item.poNumber === poNumber),
  ]));

  console.log(JSON.stringify({
    targetPoCount: TARGET_POS.length,
    matchedGoogleRowCount: matches.length,
    matchedPoCount: Object.values(grouped).filter((items) => items.length > 0).length,
    grouped,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
