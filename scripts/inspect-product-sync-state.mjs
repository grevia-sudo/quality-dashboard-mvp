import mysql from "mysql2/promise";

const productId = Number(process.argv[2] || "0");
if (!productId) throw new Error("請提供 productId");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing");

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
  const [rows] = await db.query(`
    SELECT
      p.id,
      p.poNumber,
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
    WHERE p.id = ?
  `, [productId]);

  console.log(JSON.stringify(rows[0] ?? null, null, 2));
} finally {
  await db.end();
}
