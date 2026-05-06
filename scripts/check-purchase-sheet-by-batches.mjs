import { createSign } from "node:crypto";
import fs from "node:fs/promises";
import { SHEET_NAME, SPREADSHEET_ID } from "./purchase-sheet-sync-helpers.mjs";

const batches = ["00500024813", "00500024814", "00500024827", "00500024828"];
const rawCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
if (!rawCredentials) {
  throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON 不存在");
}
const credentials = JSON.parse(rawCredentials);

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function createSignedJwt() {
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

async function getAccessToken() {
  const response = await fetch(credentials.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: createSignedJwt(),
    }),
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) {
    throw new Error(JSON.stringify(result));
  }
  return result.access_token;
}

const accessToken = await getAccessToken();
const range = encodeURIComponent(`${SHEET_NAME}!A:AD`);
const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}`, {
  headers: { Authorization: `Bearer ${accessToken}` },
});
const result = await response.json();
if (!response.ok) {
  throw new Error(JSON.stringify(result));
}
const values = result.values ?? [];
const foundRows = [];
for (let index = 1; index < values.length; index += 1) {
  const row = values[index] ?? [];
  const batchNo = (row[3] ?? "").trim();
  if (batches.includes(batchNo)) {
    foundRows.push({
      rowNumber: index + 1,
      poNumber: row[0] ?? "",
      vendorName: row[1] ?? "",
      categoryName: row[2] ?? "",
      batchNo,
      serialNumber: row[4] ?? "",
      imei: row[5] ?? "",
      a1CompletedAt: row[9] ?? "",
      a1OperatorName: row[10] ?? "",
      rawRow: row,
    });
  }
}
const output = { batches, foundRows };
await fs.writeFile(new URL("../purchase-sheet-batch-lookup.json", import.meta.url), JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
