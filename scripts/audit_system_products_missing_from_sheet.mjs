import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

const SHEET_JSON_PATH = path.join('/home/ubuntu/quality-dashboard-mvp', 'tmp', 'purchase_sheet_values.json');

function normalize(value) {
  return String(value ?? '').trim();
}

const raw = JSON.parse(fs.readFileSync(SHEET_JSON_PATH, 'utf8'));
const rows = raw.values || [];

const identitySet = new Set();
for (let i = 1; i < rows.length; i += 1) {
  const row = rows[i] || [];
  const batch = normalize(row[3]);
  const serial = normalize(row[4]);
  const imei = normalize(row[5]);
  if (batch) identitySet.add(`B:${batch}`);
  if (serial) identitySet.add(`S:${serial}`);
  if (imei) identitySet.add(`I:${imei}`);
}

const connection = await mysql.createConnection(process.env.DATABASE_URL);
const [products] = await connection.execute(`
  SELECT id, productCode, poNumber, batchNo, serialNumber, imei, sheetRowNumber, lastSheetSyncedAt
  FROM products
  WHERE archivedAt IS NULL
    AND (batchNo IS NOT NULL OR serialNumber IS NOT NULL OR imei IS NOT NULL)
  ORDER BY id ASC
`);
await connection.end();

const missing = [];
for (const product of products) {
  const batch = normalize(product.batchNo);
  const serial = normalize(product.serialNumber);
  const imei = normalize(product.imei);
  const exists = (batch && identitySet.has(`B:${batch}`))
    || (serial && identitySet.has(`S:${serial}`))
    || (imei && identitySet.has(`I:${imei}`));
  if (!exists) {
    missing.push({
      id: product.id,
      productCode: product.productCode,
      poNumber: product.poNumber,
      batchNo: batch,
      serialNumber: serial,
      imei,
      sheetRowNumber: product.sheetRowNumber,
      lastSheetSyncedAt: product.lastSheetSyncedAt,
    });
  }
}

console.log(JSON.stringify({
  totalProducts: products.length,
  missingCount: missing.length,
  sampleMissing: missing.slice(0, 30),
}, null, 2));
