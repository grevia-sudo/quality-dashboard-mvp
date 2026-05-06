import mysql from "mysql2/promise";
import fs from "node:fs/promises";

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
  const tables = ["products", "station_tasks", "station_events", "sampling_results", "product_archives", "productivity_score_details"];
  const [rows] = await db.query(
    `
      SELECT TABLE_NAME, COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${tables.map(() => "?").join(", ")})
      ORDER BY TABLE_NAME ASC, ORDINAL_POSITION ASC
    `,
    tables,
  );
  await fs.writeFile(new URL("../cleanup-table-columns.json", import.meta.url), JSON.stringify(rows, null, 2));
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await db.end();
}
