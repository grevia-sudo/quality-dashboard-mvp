import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const connection = await mysql.createConnection(databaseUrl);

const tables = [
  "productivity_score_details",
  "sampling_results",
  "station_events",
  "station_tasks",
  "sheet_sync_jobs",
  "product_archives",
  "engineer_daily_productivity",
  "productivity_target_configs",
  "products",
  "station_rules",
  "product_categories",
  "users",
];

try {
  await connection.query("SET FOREIGN_KEY_CHECKS = 0");

  for (const table of tables) {
    await connection.query(`DROP TABLE IF EXISTS \`${table}\``);
  }

  await connection.query("DELETE FROM __drizzle_migrations").catch(() => undefined);
  await connection.query("SET FOREIGN_KEY_CHECKS = 1");
  console.log("MVP schema tables reset complete.");
} finally {
  await connection.end();
}
