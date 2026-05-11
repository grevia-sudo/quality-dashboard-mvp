import mysql from "mysql2/promise";
import { createSign } from "node:crypto";
import fs from "node:fs/promises";
import { SHEET_NAME, SPREADSHEET_ID } from "./purchase-sheet-sync-helpers.mjs";

const TARGET_PO = "PO-20260508-01";
const RESULT_PATH = new URL("../restore-po-20260508-01-result.json", import.meta.url);

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing");
}
if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing");
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

async function getGoogleAccessToken() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const response = await fetch(credentials.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: createSignedJwt(credentials),
    }),
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) {
    throw new Error(`Google access token 取得失敗：${JSON.stringify(result)}`);
  }
  return result.access_token;
}

function normalizeCell(value) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function inferBrandName(productName) {
  if (!productName) {
    return null;
  }
  if (/^Redmi\b/i.test(productName)) {
    return "Redmi";
  }
  if (/^Xiaomi\b/i.test(productName)) {
    return "Xiaomi";
  }
  return null;
}

const parsed = new URL(process.env.DATABASE_URL);
const db = await mysql.createConnection({
  host: parsed.hostname,
  port: parsed.port ? Number(parsed.port) : 3306,
  user: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
  database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
  timezone: "Z",
  ssl: { rejectUnauthorized: false },
  multipleStatements: false,
});

try {
  const [[existing]] = await db.query(
    "SELECT COUNT(*) AS count FROM products WHERE poNumber = ? AND archivedAt IS NULL",
    [TARGET_PO],
  );
  if (Number(existing.count ?? 0) > 0) {
    const summary = { poNumber: TARGET_PO, restored: 0, skipped: true, reason: "already_exists" };
    await fs.writeFile(RESULT_PATH, JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  }

  const accessToken = await getGoogleAccessToken();
  const encodedRange = encodeURIComponent(`${SHEET_NAME}!A:AE`);
  const sheetResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodedRange}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const sheetJson = await sheetResponse.json();
  if (!sheetResponse.ok) {
    throw new Error(`讀取 Google Sheet 失敗：${JSON.stringify(sheetJson)}`);
  }

  const values = sheetJson.values ?? [];
  const rows = [];
  for (let index = 1; index < values.length; index += 1) {
    const row = values[index] ?? [];
    const poNumber = normalizeCell(row[0]);
    if (poNumber !== TARGET_PO) continue;
    rows.push({
      rowNumber: index + 1,
      poNumber,
      vendorName: normalizeCell(row[1]),
      importedCategoryName: normalizeCell(row[2]),
      batchNo: normalizeCell(row[3]),
      serialNumber: normalizeCell(row[4]),
      imei: normalizeCell(row[5]),
      productName: normalizeCell(row[6]),
    });
  }

  if (rows.length === 0) {
    throw new Error(`Google 採購單工作表中找不到 ${TARGET_PO}`);
  }

  const labels = Array.from(new Set(rows.map((row) => row.productName).filter(Boolean)));
  const labelPlaceholders = labels.map(() => "?").join(", ");
  const [catalogRows] = labels.length > 0
    ? await db.query(
        `SELECT label, categoryName, brandName, active FROM product_name_catalog_entries WHERE label IN (${labelPlaceholders})`,
        labels,
      )
    : [[]];

  const catalogMap = new Map();
  for (const entry of catalogRows) {
    const label = normalizeCell(entry.label);
    if (!label) continue;
    const existingEntries = catalogMap.get(label) ?? [];
    existingEntries.push({
      categoryName: normalizeCell(entry.categoryName),
      brandName: normalizeCell(entry.brandName),
      active: Number(entry.active ?? 0) === 1,
    });
    catalogMap.set(label, existingEntries);
  }

  const categoryBrandPairs = new Map();
  for (const row of rows) {
    const labelEntries = row.productName ? (catalogMap.get(row.productName) ?? []) : [];
    const activeExactEntries = labelEntries.filter((entry) => entry.active && entry.categoryName === row.importedCategoryName);
    const exactBrand = activeExactEntries.length === 1 ? activeExactEntries[0].brandName : null;
    const importedBrandName = exactBrand ?? inferBrandName(row.productName);
    const pairKey = `${row.importedCategoryName ?? ""}__${importedBrandName ?? ""}`;
    if (row.importedCategoryName && importedBrandName && !categoryBrandPairs.has(pairKey)) {
      categoryBrandPairs.set(pairKey, {
        categoryName: row.importedCategoryName,
        brandName: importedBrandName,
      });
    }
    row.importedBrandName = importedBrandName;
  }

  const pairValues = Array.from(categoryBrandPairs.values());
  const categoryMap = new Map();
  if (pairValues.length > 0) {
    const whereClause = pairValues.map(() => "(categoryName = ? AND brandName = ? AND active = 1)").join(" OR ");
    const params = pairValues.flatMap((pair) => [pair.categoryName, pair.brandName]);
    const [categoryRows] = await db.query(
      `SELECT id, categoryName, brandName FROM product_categories WHERE ${whereClause}`,
      params,
    );
    for (const row of categoryRows) {
      const key = `${normalizeCell(row.categoryName) ?? ""}__${normalizeCell(row.brandName) ?? ""}`;
      categoryMap.set(key, Number(row.id));
    }
  }

  const now = new Date();
  const insertValues = rows.map((row) => {
    const categoryKey = `${row.importedCategoryName ?? ""}__${row.importedBrandName ?? ""}`;
    const categoryId = categoryMap.get(categoryKey) ?? null;
    return {
      productCode: `RESTORED-${TARGET_PO}-${String(row.rowNumber).padStart(4, "0")}`,
      batchNo: row.batchNo,
      serialNumber: row.serialNumber,
      imei: row.imei,
      productName: row.productName,
      poNumber: row.poNumber,
      vendorName: row.vendorName,
      sheetRowNumber: row.rowNumber,
      lastSheetSyncedAt: now,
      importedCategoryName: row.importedCategoryName,
      importedBrandName: row.importedBrandName,
      categoryId,
      stationCode: "A1",
      productStatus: "pending_a1",
    };
  });

  await db.beginTransaction();
  try {
    const [productInsertResult] = await db.query(
      `
        INSERT INTO products (
          productCode, batchNo, serialNumber, imei, productName,
          poNumber, vendorName, sheetRowNumber, lastSheetSyncedAt,
          importedCategoryName, importedBrandName, categoryId,
          stationCode, productStatus
        ) VALUES ?
      `,
      [insertValues.map((row) => [
        row.productCode,
        row.batchNo,
        row.serialNumber,
        row.imei,
        row.productName,
        row.poNumber,
        row.vendorName,
        row.sheetRowNumber,
        row.lastSheetSyncedAt,
        row.importedCategoryName,
        row.importedBrandName,
        row.categoryId,
        row.stationCode,
        row.productStatus,
      ])],
    );

    const insertedCount = Number(productInsertResult.affectedRows ?? 0);
    const [insertedRows] = await db.query(
      `SELECT id, productCode FROM products WHERE poNumber = ? AND archivedAt IS NULL ORDER BY id ASC`,
      [TARGET_PO],
    );

    const taskValues = insertedRows.map((row) => [Number(row.id), "A1", "pending"]);
    if (taskValues.length > 0) {
      await db.query(
        `INSERT INTO station_tasks (productId, stationCode, stationTaskStatus) VALUES ?`,
        [taskValues],
      );
    }

    await db.commit();

    const missingBrandCount = insertValues.filter((row) => !row.importedBrandName).length;
    const resolvedCategoryCount = insertValues.filter((row) => row.categoryId !== null).length;
    const summary = {
      poNumber: TARGET_PO,
      restoredProducts: insertedCount,
      restoredA1Tasks: taskValues.length,
      firstRowNumber: rows[0]?.rowNumber ?? null,
      lastRowNumber: rows.at(-1)?.rowNumber ?? null,
      missingBrandCount,
      resolvedCategoryCount,
      skipped: false,
    };
    await fs.writeFile(RESULT_PATH, JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    await db.rollback();
    throw error;
  }
} finally {
  await db.end();
}
