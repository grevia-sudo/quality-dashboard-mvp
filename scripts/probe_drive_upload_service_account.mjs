import { createSign } from 'node:crypto';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const FOLDER_ID = '1PPdt4swkmSav8G6k2Dfpk55OBPJk4srW';

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function getCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing');
  const credentials = JSON.parse(raw);
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('service account credentials are incomplete');
  }
  return credentials;
}

async function getAccessToken(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: credentials.client_email,
    scope: DRIVE_SCOPE,
    aud: credentials.token_uri ?? 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
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

  const response = await fetch(credentials.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsignedToken}.${signature}`,
    }),
  });

  const result = await response.json();
  if (!response.ok || !result.access_token) {
    throw new Error(`token exchange failed: ${JSON.stringify(result)}`);
  }
  return result.access_token;
}

const credentials = getCredentials();
const accessToken = await getAccessToken(credentials);
const boundary = `boundary-${Date.now()}`;
const metadata = {
  name: `service-account-probe-${Date.now()}.txt`,
  parents: [FOLDER_ID],
};
const body = [
  `--${boundary}`,
  'Content-Type: application/json; charset=UTF-8',
  '',
  JSON.stringify(metadata),
  `--${boundary}`,
  'Content-Type: text/plain',
  '',
  'probe upload from service account',
  `--${boundary}--`,
].join('\r\n');

const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,parents,webViewLink', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': `multipart/related; boundary=${boundary}`,
  },
  body,
});

const text = await response.text();
let json;
try {
  json = JSON.parse(text);
} catch {
  json = { raw: text };
}

console.log(JSON.stringify({ ok: response.ok, status: response.status, json }, null, 2));
