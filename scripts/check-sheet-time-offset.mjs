import mysql from "mysql2/promise";
import { formatSheetDateTime } from "./purchase-sheet-sync-helpers.mjs";

const serialNumber = process.argv[2] ?? "YLXGHQXR36";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL 不存在");
}

const parsed = new URL(databaseUrl);
const databaseName = parsed.pathname.replace(/^\//, "");
const connection = await mysql.createConnection({
  host: parsed.hostname,
  port: parsed.port ? Number(parsed.port) : 3306,
  user: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
  database: decodeURIComponent(databaseName),
  timezone: "Z",
  ssl: {
    rejectUnauthorized: false,
  },
});

try {
  const [rows] = await connection.query(
    `
      SELECT
        p.id,
        p.productCode,
        p.serialNumber,
        p.batchNo,
        p.updatedAt AS productUpdatedAt,
        e.completedAt AS eCompletedAt,
        d.completedAt AS dCompletedAt,
        cTask.completedAt AS cCompletedAt,
        b.completedAt AS bCompletedAt,
        a2.completedAt AS a2CompletedAt,
        a1.completedAt AS a1CompletedAt
      FROM products p
      LEFT JOIN (
        SELECT productId, MAX(completedAt) AS completedAt
        FROM station_tasks
        WHERE stationCode = 'E' AND stationTaskStatus = 'completed'
        GROUP BY productId
      ) e ON e.productId = p.id
      LEFT JOIN (
        SELECT productId, MAX(completedAt) AS completedAt
        FROM station_tasks
        WHERE stationCode = 'D' AND stationTaskStatus = 'completed'
        GROUP BY productId
      ) d ON d.productId = p.id
      LEFT JOIN (
        SELECT productId, MAX(completedAt) AS completedAt
        FROM station_tasks
        WHERE stationCode = 'C' AND stationTaskStatus = 'completed'
        GROUP BY productId
      ) cTask ON cTask.productId = p.id
      LEFT JOIN (
        SELECT productId, MAX(completedAt) AS completedAt
        FROM station_tasks
        WHERE stationCode = 'B' AND stationTaskStatus = 'completed'
        GROUP BY productId
      ) b ON b.productId = p.id
      LEFT JOIN (
        SELECT productId, MAX(completedAt) AS completedAt
        FROM station_tasks
        WHERE stationCode = 'A2' AND stationTaskStatus = 'completed'
        GROUP BY productId
      ) a2 ON a2.productId = p.id
      LEFT JOIN (
        SELECT productId, MAX(completedAt) AS completedAt
        FROM station_tasks
        WHERE stationCode = 'A1' AND stationTaskStatus = 'completed'
        GROUP BY productId
      ) a1 ON a1.productId = p.id
      WHERE p.serialNumber = ?
      LIMIT 1
    `,
    [serialNumber],
  );

  const row = rows[0];
  if (!row) {
    console.log(JSON.stringify({ serialNumber, found: false }, null, 2));
  } else {
    console.log(JSON.stringify({
      serialNumber,
      found: true,
      raw: row,
      formatted: {
        a1: formatSheetDateTime(row.a1CompletedAt),
        a2: formatSheetDateTime(row.a2CompletedAt),
        b: formatSheetDateTime(row.bCompletedAt),
        c: formatSheetDateTime(row.cCompletedAt),
        d: formatSheetDateTime(row.dCompletedAt),
        e: formatSheetDateTime(row.eCompletedAt),
      },
      runtime: {
        nowIso: new Date().toISOString(),
        nowTaipei: formatSheetDateTime(new Date()),
      },
    }, null, 2));
  }
} finally {
  await connection.end();
}
