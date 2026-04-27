import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not configured");
}

const parsed = new URL(databaseUrl);
const connection = await mysql.createConnection({
  host: parsed.hostname,
  port: parsed.port ? Number(parsed.port) : 3306,
  user: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
  database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
  ssl: { rejectUnauthorized: false },
  timezone: "Z",
});

const tables = [
  "productivity_score_details",
  "engineer_daily_productivity",
  "sampling_results",
  "station_events",
  "station_tasks",
  "import_batch_backups",
  "sheet_sync_jobs",
  "product_archives",
  "products",
  "productivity_target_configs",
  "category_station_flows",
  "station_rules",
  "defect_options",
  "product_name_options",
  "product_categories",
  "users",
];

try {
  await connection.query("SET FOREIGN_KEY_CHECKS = 0");

  for (const table of tables) {
    await connection.query(`TRUNCATE TABLE \`${table}\``);
  }

  const [rows] = await connection.query(
    `SELECT table_name AS tableName, table_rows AS approxRows
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name IN (${tables.map(() => "?").join(", ")})
     ORDER BY table_name`,
    tables,
  );

  console.log(JSON.stringify(rows, null, 2));
} finally {
  await connection.query("SET FOREIGN_KEY_CHECKS = 1");
  await connection.end();
}
