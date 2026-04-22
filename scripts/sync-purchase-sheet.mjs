import { createSign } from "node:crypto";
import mysql from "mysql2/promise";
import {
  buildSheetRow,
  createInitialSheetValues,
  findMatchingRowNumber,
  mergeMissingCells,
  SHEET_NAME,
  SPREADSHEET_ID,
} from "./purchase-sheet-sync-helpers.mjs";

function parseServiceAccountCredentials() {
  const rawCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!rawCredentials) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON 不存在，無法執行 Google Sheet 背景同步");
  }

  const credentials = JSON.parse(rawCredentials);

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON 缺少 client_email 或 private_key");
  }

  return credentials;
}

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function createSignedJwt(credentials) {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT",
  };

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

async function getGoogleAccessToken() {
  const credentials = parseServiceAccountCredentials();
  const assertion = createSignedJwt(credentials);
  const tokenUri = credentials.token_uri ?? "https://oauth2.googleapis.com/token";

  const response = await fetch(tokenUri, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const result = await response.json();

  if (!response.ok || !result.access_token) {
    throw new Error(`Google access token 取得失敗：${JSON.stringify(result)}`);
  }

  return result.access_token;
}

async function callSheetsApi(accessToken, path, { method = "GET", query = {}, body } = {}) {
  const url = new URL(`https://sheets.googleapis.com/v4/${path}`);

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(`Google Sheets API 失敗：${JSON.stringify(result)}`);
  }

  return result;
}

async function getSheetValues(accessToken) {
  const encodedRange = encodeURIComponent(`${SHEET_NAME}!A:I`);

  return callSheetsApi(accessToken, `spreadsheets/${SPREADSHEET_ID}/values/${encodedRange}`);
}

async function updateSheetRow(accessToken, rowNumber, rowValues) {
  const encodedRange = encodeURIComponent(`${SHEET_NAME}!A${rowNumber}:I${rowNumber}`);

  return callSheetsApi(accessToken, `spreadsheets/${SPREADSHEET_ID}/values/${encodedRange}`, {
    method: "PUT",
    query: {
      valueInputOption: "RAW",
    },
    body: {
      values: [rowValues],
    },
  });
}

async function appendSheetRow(accessToken, rowValues) {
  const encodedRange = encodeURIComponent(`${SHEET_NAME}!A:I`);

  return callSheetsApi(accessToken, `spreadsheets/${SPREADSHEET_ID}/values/${encodedRange}:append`, {
    method: "POST",
    query: {
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
    },
    body: {
      values: [rowValues],
    },
  });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL 不存在，無法執行採購單同步");
  }

  const accessToken = await getGoogleAccessToken();
  const connection = await mysql.createConnection(process.env.DATABASE_URL);

  try {
    const [products] = await connection.query(
      `
        SELECT
          p.id,
          p.poNumber,
          p.vendorName,
          p.batchNo,
          p.serialNumber,
          p.imei,
          p.productName,
          p.importedCategoryName,
          p.sheetRowNumber,
          p.lastSheetSyncedAt,
          p.updatedAt,
          c.categoryName,
          a1.completedAt AS a1CompletedAt,
          a2.completedAt AS a2CompletedAt
        FROM products p
        LEFT JOIN product_categories c ON c.id = p.categoryId
        LEFT JOIN (
          SELECT \`productId\`, MAX(\`completedAt\`) AS \`completedAt\`
          FROM \`station_tasks\`
          WHERE \`stationCode\` = 'A1' AND \`stationTaskStatus\` = 'completed'
          GROUP BY \`productId\`
        ) a1 ON a1.productId = p.id
        LEFT JOIN (
          SELECT \`productId\`, MAX(\`completedAt\`) AS \`completedAt\`
          FROM \`station_tasks\`
          WHERE \`stationCode\` = 'A2' AND \`stationTaskStatus\` = 'completed'
          GROUP BY \`productId\`
        ) a2 ON a2.productId = p.id
        WHERE p.archivedAt IS NULL
          AND p.vendorName IS NOT NULL
          AND (p.importedCategoryName IS NOT NULL OR c.categoryName IS NOT NULL)
          AND (p.batchNo IS NOT NULL OR p.serialNumber IS NOT NULL OR p.imei IS NOT NULL)
          AND (
            p.lastSheetSyncedAt IS NULL
            OR p.updatedAt > p.lastSheetSyncedAt
            OR p.sheetRowNumber IS NULL
            OR (a1.completedAt IS NOT NULL AND (p.lastSheetSyncedAt IS NULL OR a1.completedAt > p.lastSheetSyncedAt))
            OR (a2.completedAt IS NOT NULL AND (p.lastSheetSyncedAt IS NULL OR a2.completedAt > p.lastSheetSyncedAt))
          )
        ORDER BY p.id ASC
      `,
    );

    const sheetResponse = await getSheetValues(accessToken);
    const normalizedValues = createInitialSheetValues(sheetResponse.values);

    let appendedCount = 0;
    let updatedCount = 0;

    for (const product of products) {
      const generatedRow = buildSheetRow(product);
      let rowNumber = product.sheetRowNumber ?? findMatchingRowNumber(normalizedValues, product);

      if (rowNumber) {
        const existingRow = normalizedValues[rowNumber - 1] ?? [];
        const mergedRow = mergeMissingCells(existingRow, generatedRow);

        await updateSheetRow(accessToken, rowNumber, mergedRow);
        normalizedValues[rowNumber - 1] = mergedRow;
        updatedCount += 1;
      } else {
        const appendedRowNumber = normalizedValues.length + 1;

        await appendSheetRow(accessToken, generatedRow);
        normalizedValues.push(generatedRow);
        rowNumber = appendedRowNumber;
        appendedCount += 1;
      }

      await connection.execute(
        `UPDATE products SET sheetRowNumber = ?, lastSheetSyncedAt = CURRENT_TIMESTAMP WHERE id = ?`,
        [rowNumber, product.id],
      );
    }

    await connection.execute(
      `UPDATE sheet_sync_jobs SET syncJobStatus = 'success', finishedAt = CURRENT_TIMESTAMP WHERE syncJobStatus = 'queued' AND targetSheetName = ?`,
      [SHEET_NAME],
    );

    console.log(
      JSON.stringify({
        success: true,
        sheetName: SHEET_NAME,
        processedCount: products.length,
        appendedCount,
        updatedCount,
      }),
    );
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ success: false, message: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
