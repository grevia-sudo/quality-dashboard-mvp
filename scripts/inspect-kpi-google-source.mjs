import { createSign } from 'node:crypto';

const spreadsheetId = '1b4qgaASYNkfWJUUB8XM5wK8vLynxai5IkSqBnn8JGR0';
const sheetNames = ['手機檢測資料庫', '表單回應 1'];

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function parseCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON 不存在');
  const credentials = JSON.parse(raw);
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON 缺少 client_email 或 private_key');
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
  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(credentials.private_key, 'base64url');

  const response = await fetch(credentials.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const json = await response.json();
  if (!response.ok || !json.access_token) {
    throw new Error(`取得 token 失敗：${JSON.stringify(json)}`);
  }
  return json.access_token;
}

async function readRange(token, sheetName, rangeA1) {
  const range = encodeURIComponent(`${sheetName}!${rangeA1}`);
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueRenderOption=FORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`讀取 ${sheetName}!${rangeA1} 失敗：${JSON.stringify(json)}`);
  }
  return json.values ?? [];
}

async function main() {
  const token = await getAccessToken();
  const result = {};
  for (const sheetName of sheetNames) {
    result[sheetName] = {
      head: await readRange(token, sheetName, 'A1:Z8'),
    };
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
