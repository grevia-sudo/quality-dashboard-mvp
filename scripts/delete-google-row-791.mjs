import { createSign } from 'node:crypto';
import { SPREADSHEET_ID, SHEET_NAME } from './purchase-sheet-sync-helpers.mjs';

const TARGET_ROW_NUMBER = 791;
const rawCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
if (!rawCredentials) {
  throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON 不存在');
}
const credentials = JSON.parse(rawCredentials);

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function createSignedJwt() {
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

async function getAccessToken() {
  const response = await fetch(credentials.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: createSignedJwt(),
    }),
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) {
    throw new Error(JSON.stringify(result));
  }
  return result.access_token;
}

async function getSheetId(accessToken) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(JSON.stringify(result));
  }
  const sheet = (result.sheets ?? []).find((item) => item.properties?.title === SHEET_NAME);
  const sheetId = sheet?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) {
    throw new Error(`找不到工作表 ${SHEET_NAME}`);
  }
  return sheetId;
}

const accessToken = await getAccessToken();
const sheetId = await getSheetId(accessToken);
const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    requests: [
      {
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: TARGET_ROW_NUMBER - 1,
            endIndex: TARGET_ROW_NUMBER,
          },
        },
      },
    ],
  }),
});
const result = await response.json();
if (!response.ok) {
  throw new Error(JSON.stringify(result));
}
console.log(JSON.stringify({ deletedRowNumber: TARGET_ROW_NUMBER, replies: result.replies ?? [] }, null, 2));
