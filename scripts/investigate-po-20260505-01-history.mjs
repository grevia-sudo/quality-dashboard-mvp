import mysql from "mysql2/promise";
import fs from "node:fs/promises";

const poNumber = "PO-20260505-01";
const targetBatches = ["00500024813", "00500024814", "00500024827", "00500024828"];

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing");
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
});

try {
  const [deletionLogs] = await db.query(
    `
      SELECT *
      FROM purchase_order_deletion_logs
      WHERE poNumber = ?
      ORDER BY id DESC
    `,
    [poNumber],
  );

  const [backups] = await db.query(
    `
      SELECT id, poNumber, vendorName, backupLabel, productCount, createdByUserId, restoredAt, restoredByUserId, createdAt
      FROM import_batch_backups
      WHERE poNumber = ?
      ORDER BY id DESC
    `,
    [poNumber],
  );

  const [backupSnapshots] = await db.query(
    `
      SELECT id, poNumber, snapshot
      FROM import_batch_backups
      WHERE poNumber = ?
      ORDER BY id DESC
      LIMIT 2
    `,
    [poNumber],
  );

  const [archiveMatches] = await db.query(
    `
      SELECT id, originalProductId, archivedAt, archiveMonth, productSnapshot
      FROM product_archives
      WHERE JSON_UNQUOTE(JSON_EXTRACT(productSnapshot, '$.poNumber')) = ?
         OR JSON_UNQUOTE(JSON_EXTRACT(productSnapshot, '$.batchNo')) IN (${targetBatches.map(() => '?').join(', ')})
      ORDER BY id DESC
      LIMIT 20
    `,
    [poNumber, ...targetBatches],
  );

  const [recentPurchaseSyncJobs] = await db.query(
    `
      SELECT id, jobType, targetSheetName, syncJobStatus, queuedAt, startedAt, finishedAt, errorMessage
      FROM sheet_sync_jobs
      WHERE jobType = 'purchase_sheet_sync'
      ORDER BY id DESC
      LIMIT 50
    `,
  );

  const result = {
    poNumber,
    targetBatches,
    deletionLogs,
    backups,
    backupSnapshots,
    archiveMatches,
    recentPurchaseSyncJobs,
  };

  await fs.writeFile(new URL("../po-20260505-01-history.json", import.meta.url), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await db.end();
}
