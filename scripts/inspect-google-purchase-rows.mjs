import crypto from 'node:crypto';

const spreadsheetId = '15uKVOc13iVhs2ffT9FWgKti47s38Hl_Zyjht6o7HU_Y';
const sheetName = '採購單';
const targetBatches = ['00500025301', '00500025299'];
const targetRows = [422, 472];

function base64UrlEncode(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function getCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
  return JSON.parse(raw);
}

async function getAccessToken() {
  const credentials = getCredentials();
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64UrlEncode(JSON.stringify({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: credentials.token_uri || 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();
  const signature = signer.sign(credentials.private_key, 'base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const assertion = `${header}.${payload}.${signature}`;

  const response = await fetch(credentials.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) {
    throw new Error(result.error_description || result.error || 'Failed to get access token');
  }
  return result.access_token;
}

async function readRange(accessToken, range) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error?.message || 'Failed to read Google Sheets range');
  }
  return result.values ?? [];
}

async function main() {
  const token = await getAccessToken();
  const fullRows = await readRange(token, `${sheetName}!A:AD`);
  const rowSnapshots = {};
  for (const rowNumber of targetRows) {
    rowSnapshots[rowNumber] = fullRows[rowNumber - 1] ?? null;
  }
  const matchedRows = fullRows
    .map((row, index) => ({ rowNumber: index + 1, row }))
    .filter(({ row }) => targetBatches.includes(String(row?.[3] ?? '').trim()));

  process.stdout.write(JSON.stringify({
    spreadsheetId,
    sheetName,
    targetBatches,
    targetRows,
    matchedRows,
    rowSnapshots,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
