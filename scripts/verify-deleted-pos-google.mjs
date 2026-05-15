import { SPREADSHEET_ID, SHEET_NAME } from './purchase-sheet-sync-helpers.mjs';

const TARGET_POS = Array.from(new Set([
  'TEST-A1-IMEI-1778749381829',
  'PO-KPI-WRITE-1778749381827',
  'PO-20260514-04',
  'PO-STOCK-BLOCK-1778749390586',
  'PO-KPI-FALLBACK-1778749392323-fallback',
  'PO-BACKUP-EDGE-1778749392638',
  'PO-20260514-05',
  'PO-20260514-07',
  'PO-20260514-12',
  'TEST-A1-DUP-GUARD-1778749412041',
  'TEST-A1-NAME-1778749416728',
  'TEST-A1-SN-1778749418491',
  'PO-KPI-MISSING-GOOGLE-1778749418051-missing-google',
  'PO-KPI-D-SAMPLING-PASS-1778750585732-d-sampling-pass',
  'PO-KPI-MISSING-GOOGLE-1778750592526-missing-google',
  'PO-KPI-IDEMPOTENT-1778750598137-idempotent',
]));

function base64Url(input) {
  return Buffer.from(JSON.stringify(input)).toString('base64url');
}

function parseCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
  }
  const credentials = JSON.parse(raw);
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT_JSON');
  }
  return credentials;
}

async function getAccessToken() {
  const credentials = parseCredentials();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: credentials.token_uri ?? 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };
  const unsignedToken = `${base64Url(header)}.${base64Url(payload)}`;
  const signer = await import('node:crypto');
  const signature = signer.sign('RSA-SHA256', Buffer.from(unsignedToken), credentials.private_key).toString('base64url');
  const assertion = `${unsignedToken}.${signature}`;

  const response = await fetch(credentials.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to get access token: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function main() {
  const token = await getAccessToken();
  const range = `${SHEET_NAME}!A:AD`;
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to read purchase sheet: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const values = Array.isArray(data.values) ? data.values : [];
  const matches = [];

  for (let index = 1; index < values.length; index += 1) {
    const row = values[index] ?? [];
    const poNumber = `${row[0] ?? ''}`.trim();
    if (TARGET_POS.includes(poNumber)) {
      matches.push({
        rowNumber: index + 1,
        poNumber,
        batchNo: `${row[3] ?? ''}`.trim(),
        serialNumber: `${row[4] ?? ''}`.trim(),
        imei: `${row[5] ?? ''}`.trim(),
        productName: `${row[6] ?? ''}`.trim(),
      });
    }
  }

  console.log(JSON.stringify({ totalMatches: matches.length, matches }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
