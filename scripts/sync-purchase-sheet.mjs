import { createSign } from "node:crypto";
import mysql from "mysql2/promise";
import {
  buildSheetRow,
  createInitialSheetValues,
  findMatchingRowNumber,
  mergeMissingCells,
  SHEET_NAME,
  SPREADSHEET_ID,
  PURCHASE_SHEET_HEADER,
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
  const encodedRange = encodeURIComponent(`${SHEET_NAME}!A:T`);

  return callSheetsApi(accessToken, `spreadsheets/${SPREADSHEET_ID}/values/${encodedRange}`);
}

async function updateSheetRow(accessToken, rowNumber, rowValues) {
  const encodedRange = encodeURIComponent(`${SHEET_NAME}!A${rowNumber}:T${rowNumber}`);

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

async function updateSheetHeader(accessToken) {
  const encodedRange = encodeURIComponent(`${SHEET_NAME}!A1:T1`);

  return callSheetsApi(accessToken, `spreadsheets/${SPREADSHEET_ID}/values/${encodedRange}`, {
    method: "PUT",
    query: {
      valueInputOption: "RAW",
    },
    body: {
      values: [PURCHASE_SHEET_HEADER],
    },
  });
}

async function appendSheetRow(accessToken, rowValues) {
  const encodedRange = encodeURIComponent(`${SHEET_NAME}!A:T`);

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

export async function runPurchaseSheetSync() {
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
          a1Operator.a1OperatorName,
          a2.completedAt AS a2CompletedAt,
          a2Operator.a2OperatorName,
          b.completedAt AS bCompletedAt,
          bOperator.bOperatorName,
          cTask.completedAt AS cCompletedAt,
          bMeta.bBatterySummary,
          bMeta.bFaultSummary,
          cMeta.cModifiedPreviousStage,
          cMeta.cModifiedBatterySummary,
          cMeta.cModifiedBFaultSummary,
          cMeta.cFaultSummary,
          cMeta.cAppearanceSummary,
          cMeta.cCameraSummary
        FROM products p
        LEFT JOIN product_categories c ON c.id = p.categoryId
        LEFT JOIN (
          SELECT \`productId\`, MAX(\`completedAt\`) AS \`completedAt\`
          FROM \`station_tasks\`
          WHERE \`stationCode\` = 'A1' AND \`stationTaskStatus\` = 'completed'
          GROUP BY \`productId\`
        ) a1 ON a1.productId = p.id
        LEFT JOIN (
          SELECT latestA1.\`productId\`, COALESCE(u.\`name\`, '') AS a1OperatorName
          FROM \`station_events\` se
          INNER JOIN (
            SELECT \`productId\`, MAX(\`id\`) AS \`eventId\`
            FROM \`station_events\`
            WHERE \`stationCode\` = 'A1' AND \`stationEventType\` = 'complete'
            GROUP BY \`productId\`
          ) latestA1 ON latestA1.\`eventId\` = se.\`id\`
          LEFT JOIN \`users\` u ON u.\`id\` = se.\`operatorUserId\`
        ) a1Operator ON a1Operator.\`productId\` = p.id
        LEFT JOIN (
          SELECT \`productId\`, MAX(\`completedAt\`) AS \`completedAt\`
          FROM \`station_tasks\`
          WHERE \`stationCode\` = 'A2' AND \`stationTaskStatus\` = 'completed'
          GROUP BY \`productId\`
        ) a2 ON a2.productId = p.id
        LEFT JOIN (
          SELECT latestA2.\`productId\`, COALESCE(u.\`name\`, '') AS a2OperatorName
          FROM \`station_events\` se
          INNER JOIN (
            SELECT \`productId\`, MAX(\`id\`) AS \`eventId\`
            FROM \`station_events\`
            WHERE \`stationCode\` = 'A2' AND \`stationEventType\` = 'complete'
            GROUP BY \`productId\`
          ) latestA2 ON latestA2.\`eventId\` = se.\`id\`
          LEFT JOIN \`users\` u ON u.\`id\` = se.\`operatorUserId\`
        ) a2Operator ON a2Operator.\`productId\` = p.id
        LEFT JOIN (
          SELECT \`productId\`, MAX(\`completedAt\`) AS \`completedAt\`
          FROM \`station_tasks\`
          WHERE \`stationCode\` = 'B' AND \`stationTaskStatus\` = 'completed'
          GROUP BY \`productId\`
        ) b ON b.productId = p.id
        LEFT JOIN (
          SELECT latestBEvent.\`productId\`, COALESCE(u.\`name\`, '') AS bOperatorName
          FROM \`station_events\` se
          INNER JOIN (
            SELECT \`productId\`, MAX(\`id\`) AS \`eventId\`
            FROM \`station_events\`
            WHERE \`stationCode\` = 'B' AND \`stationEventType\` = 'complete'
            GROUP BY \`productId\`
          ) latestBEvent ON latestBEvent.\`eventId\` = se.\`id\`
          LEFT JOIN \`users\` u ON u.\`id\` = se.\`operatorUserId\`
        ) bOperator ON bOperator.\`productId\` = p.id
        LEFT JOIN (
          SELECT \`productId\`, MAX(\`completedAt\`) AS \`completedAt\`
          FROM \`station_tasks\`
          WHERE \`stationCode\` = 'C' AND \`stationTaskStatus\` = 'completed'
          GROUP BY \`productId\`
        ) cTask ON cTask.productId = p.id
        LEFT JOIN (
          SELECT
            latestB.\`productId\`,
            JSON_UNQUOTE(JSON_EXTRACT(st.\`metadata\`, '$.batterySummary')) AS bBatterySummary,
            JSON_UNQUOTE(JSON_EXTRACT(st.\`metadata\`, '$.faultSummary')) AS bFaultSummary
          FROM \`station_tasks\` st
          INNER JOIN (
            SELECT \`productId\`, MAX(\`completedAt\`) AS \`completedAt\`
            FROM \`station_tasks\`
            WHERE \`stationCode\` = 'B' AND \`stationTaskStatus\` = 'completed'
            GROUP BY \`productId\`
          ) latestB ON latestB.\`productId\` = st.\`productId\` AND latestB.\`completedAt\` = st.\`completedAt\`
          WHERE st.\`stationCode\` = 'B' AND st.\`stationTaskStatus\` = 'completed'
        ) bMeta ON bMeta.\`productId\` = p.id
        LEFT JOIN (
          SELECT
            latestC.\`productId\`,
            CASE
              WHEN JSON_EXTRACT(st.\`metadata\`, '$.applyBChanges') = true THEN 'Y'
              ELSE 'N'
            END AS cModifiedPreviousStage,
            JSON_UNQUOTE(JSON_EXTRACT(st.\`metadata\`, '$.cModifiedBatterySummary')) AS cModifiedBatterySummary,
            JSON_UNQUOTE(JSON_EXTRACT(st.\`metadata\`, '$.cModifiedBFaultSummary')) AS cModifiedBFaultSummary,
            JSON_UNQUOTE(JSON_EXTRACT(st.\`metadata\`, '$.cFaultSummary')) AS cFaultSummary,
            JSON_UNQUOTE(JSON_EXTRACT(st.\`metadata\`, '$.cAppearanceSummary')) AS cAppearanceSummary,
            JSON_UNQUOTE(JSON_EXTRACT(st.\`metadata\`, '$.cCameraSummary')) AS cCameraSummary
          FROM \`station_tasks\` st
          INNER JOIN (
            SELECT \`productId\`, MAX(\`completedAt\`) AS \`completedAt\`
            FROM \`station_tasks\`
            WHERE \`stationCode\` = 'C' AND \`stationTaskStatus\` = 'completed'
            GROUP BY \`productId\`
          ) latestC ON latestC.\`productId\` = st.\`productId\` AND latestC.\`completedAt\` = st.\`completedAt\`
          WHERE st.\`stationCode\` = 'C' AND st.\`stationTaskStatus\` = 'completed'
        ) cMeta ON cMeta.\`productId\` = p.id

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
            OR (b.completedAt IS NOT NULL AND (p.lastSheetSyncedAt IS NULL OR b.completedAt > p.lastSheetSyncedAt))
            OR (cTask.completedAt IS NOT NULL AND (p.lastSheetSyncedAt IS NULL OR cTask.completedAt > p.lastSheetSyncedAt))
          )
        ORDER BY p.id ASC
      `,
    );

    const sheetResponse = await getSheetValues(accessToken);
    const normalizedValues = createInitialSheetValues(sheetResponse.values);

    await updateSheetHeader(accessToken);
    normalizedValues[0] = PURCHASE_SHEET_HEADER;

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

const isDirectRun = process.argv[1] ? process.argv[1].endsWith("scripts/sync-purchase-sheet.mjs") : false;

if (isDirectRun) {
  runPurchaseSheetSync().catch((error) => {
    console.error(JSON.stringify({ success: false, message: error instanceof Error ? error.message : String(error) }));
    process.exit(1);
  });
}
