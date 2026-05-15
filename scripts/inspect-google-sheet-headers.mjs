import { createSign } from 'node:crypto';

const spreadsheetIds = process.argv.slice(2);
if (spreadsheetIds.length === 0) {
  throw new Error('請提供至少一個 spreadsheetId');
}

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
    throw new Error(`取得 Google access token 失敗：${JSON.stringify(json)}`);
  }
  return json.access_token;
}

async function readSpreadsheet(token, spreadsheetId) {
  const metaResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title,sheets.properties(title,sheetId,gridProperties.rowCount,gridProperties.columnCount)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const metaJson = await metaResponse.json();
  if (!metaResponse.ok) {
    throw new Error(`讀取 spreadsheet metadata 失敗：${JSON.stringify(metaJson)}`);
  }

  const sheets = metaJson.sheets ?? [];
  const resultSheets = [];
  for (const sheet of sheets.slice(0, 10)) {
    const title = sheet.properties?.title;
    if (!title) continue;
    const valuesResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${title}!1:3`)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const valuesJson = await valuesResponse.json();
    if (!valuesResponse.ok) {
      resultSheets.push({
        title,
        error: valuesJson,
      });
      continue;
    }
    resultSheets.push({
      title,
      rowCount: sheet.properties?.gridProperties?.rowCount ?? null,
      columnCount: sheet.properties?.gridProperties?.columnCount ?? null,
      previewRows: valuesJson.values ?? [],
    });
  }

  return {
    spreadsheetId,
    title: metaJson.properties?.title ?? null,
    sheets: resultSheets,
  };
}

async function main() {
  const token = await getAccessToken();
  const results = [];
  for (const spreadsheetId of spreadsheetIds) {
    results.push(await readSpreadsheet(token, spreadsheetId));
  }
  console.log(JSON.stringify({ results }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
