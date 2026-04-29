import mysql from "mysql2/promise";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL 不存在");
}

const FLOW_TABLES = [
  "productivity_score_details",
  "sampling_results",
  "station_events",
  "station_tasks",
  "products",
  "engineer_daily_productivity",
  "sheet_sync_jobs",
  "import_batch_backups",
];

const PRESERVED_SETTING_TABLES = [
  "station_rules",
  "category_station_flows",
  "productivity_target_configs",
  "defect_options",
  "product_name_options",
  "product_name_catalog_entries",
  "product_categories",
  "support_task_compensations",
  "users",
];

const connection = await mysql.createConnection(process.env.DATABASE_URL);

async function getCounts(tables) {
  const result = {};
  for (const table of tables) {
    const [rows] = await connection.query(`SELECT COUNT(*) AS count FROM ${table}`);
    result[table] = Number(rows[0]?.count ?? 0);
  }
  return result;
}

try {
  const beforeFlowCounts = await getCounts(FLOW_TABLES);
  const beforePreservedCounts = await getCounts(PRESERVED_SETTING_TABLES);

  await connection.beginTransaction();
  await connection.query("DELETE FROM productivity_score_details");
  await connection.query("DELETE FROM sampling_results");
  await connection.query("DELETE FROM station_events");
  await connection.query("DELETE FROM station_tasks");
  await connection.query("DELETE FROM products");
  await connection.query("DELETE FROM engineer_daily_productivity");
  await connection.query("DELETE FROM sheet_sync_jobs");
  await connection.query("DELETE FROM import_batch_backups");
  await connection.commit();

  const afterFlowCounts = await getCounts(FLOW_TABLES);
  const afterPreservedCounts = await getCounts(PRESERVED_SETTING_TABLES);

  console.log(JSON.stringify({
    success: true,
    beforeFlowCounts,
    afterFlowCounts,
    beforePreservedCounts,
    afterPreservedCounts,
  }, null, 2));
} catch (error) {
  await connection.rollback();
  console.error(error);
  process.exitCode = 1;
} finally {
  await connection.end();
}
