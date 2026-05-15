import { createSign } from 'node:crypto';

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function parseCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON 不存在');
  }
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
    scope: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets.readonly',
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
    throw new Error(`取得 Google access token 失敗：${JSON.stringify(json)}`);
  }
  return json.access_token;
}

async function main() {
  const token = await getAccessToken();
  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q', "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
  url.searchParams.set('fields', 'files(id,name,createdTime,modifiedTime,owners(displayName,emailAddress),driveId)');
  url.searchParams.set('pageSize', '200');
  url.searchParams.set('orderBy', 'modifiedTime desc');

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`列出 Google Sheets 失敗：${JSON.stringify(json)}`);
  }
  console.log(JSON.stringify(json, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
