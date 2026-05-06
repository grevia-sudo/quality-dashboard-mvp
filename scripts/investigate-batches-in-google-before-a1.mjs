import mysql from "mysql2/promise";
import fs from "node:fs/promises";

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
  const placeholders = targetBatches.map(() => "?").join(", ");
  const [products] = await db.query(
    `
      SELECT
        p.id,
        p.productCode,
        p.poNumber,
        p.vendorName,
        p.importedCategoryName,
        p.importedBrandName,
        p.batchNo,
        p.serialNumber,
        p.imei,
        p.sheetRowNumber,
        p.lastSheetSyncedAt,
        p.updatedAt,
        a1.completedAt AS a1CompletedAt,
        a2.completedAt AS a2CompletedAt,
        b.completedAt AS bCompletedAt,
        c.completedAt AS cCompletedAt,
        d.completedAt AS dCompletedAt,
        e.completedAt AS eCompletedAt
      FROM products p
      LEFT JOIN (SELECT productId, MAX(completedAt) AS completedAt FROM station_tasks WHERE stationCode='A1' AND stationTaskStatus='completed' GROUP BY productId) a1 ON a1.productId = p.id
      LEFT JOIN (SELECT productId, MAX(completedAt) AS completedAt FROM station_tasks WHERE stationCode='A2' AND stationTaskStatus='completed' GROUP BY productId) a2 ON a2.productId = p.id
      LEFT JOIN (SELECT productId, MAX(completedAt) AS completedAt FROM station_tasks WHERE stationCode='B' AND stationTaskStatus='completed' GROUP BY productId) b ON b.productId = p.id
      LEFT JOIN (SELECT productId, MAX(completedAt) AS completedAt FROM station_tasks WHERE stationCode='C' AND stationTaskStatus='completed' GROUP BY productId) c ON c.productId = p.id
      LEFT JOIN (SELECT productId, MAX(completedAt) AS completedAt FROM station_tasks WHERE stationCode='D' AND stationTaskStatus='completed' GROUP BY productId) d ON d.productId = p.id
      LEFT JOIN (SELECT productId, MAX(completedAt) AS completedAt FROM station_tasks WHERE stationCode='E' AND stationTaskStatus='completed' GROUP BY productId) e ON e.productId = p.id
      WHERE p.batchNo IN (${placeholders})
      ORDER BY p.batchNo ASC, p.id ASC
    `,
    targetBatches,
  );

  const [events] = await db.query(
    `
      SELECT
        p.batchNo,
        se.productId,
        se.stationCode,
        se.stationEventType,
        se.createdAt,
        se.payload
      FROM station_events se
      INNER JOIN products p ON p.id = se.productId
      WHERE p.batchNo IN (${placeholders})
      ORDER BY p.batchNo ASC, se.createdAt ASC, se.id ASC
    `,
    targetBatches,
  );

  const [jobColumns] = await db.query(
    `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sheet_sync_jobs'
      ORDER BY ORDINAL_POSITION ASC
    `,
  );

  const [jobs] = await db.query(
    `
      SELECT *
      FROM sheet_sync_jobs
      ORDER BY id DESC
      LIMIT 20
    `,
  );

  const result = {
    targetBatches,
    matchedProducts: products,
    relatedStationEvents: events,
    sheetSyncJobColumns: jobColumns,
    recentSheetSyncJobsRaw: jobs,
  };

  await fs.writeFile(
    new URL("../batch-google-before-a1-investigation.json", import.meta.url),
    JSON.stringify(result, null, 2),
  );

  console.log(JSON.stringify(result, null, 2));
} finally {
  await db.end();
}
