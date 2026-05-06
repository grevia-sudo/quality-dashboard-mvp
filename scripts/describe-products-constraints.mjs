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
  const [rows] = await db.query(`
    SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products'
    ORDER BY ORDINAL_POSITION ASC
  `);
  await fs.writeFile(new URL('../products-constraints.json', import.meta.url), JSON.stringify(rows, null, 2));
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await db.end();
}
