import mysql from "mysql2/promise";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL 不存在");
}

const GROUPS = [
  { label: "站點規則", tables: ["station_rules"] },
  { label: "產能設定", tables: ["productivity_target_configs"] },
  { label: "功能表設定", tables: ["defect_options", "product_name_options"] },
  { label: "支援補償", tables: ["support_task_compensations"] },
  { label: "帳號管理", tables: ["users"] },
  { label: "品類設定", tables: ["product_categories", "category_station_flows", "product_name_catalog_entries"] },
];

const conn = await mysql.createConnection(process.env.DATABASE_URL);

try {
  const groups = [];
  for (const group of GROUPS) {
    const tableCounts = {};
    for (const table of group.tables) {
      const [rows] = await conn.query(`SELECT COUNT(*) AS count FROM ${table}`);
      tableCounts[table] = Number(rows[0]?.count ?? 0);
    }
    groups.push({
      label: group.label,
      tableCounts,
      hasAnyData: Object.values(tableCounts).some((count) => count > 0),
    });
  }

  const [flowRows] = await conn.query(`
    SELECT
      (SELECT COUNT(*) FROM products) AS products,
      (SELECT COUNT(*) FROM station_tasks) AS station_tasks,
      (SELECT COUNT(*) FROM station_events) AS station_events,
      (SELECT COUNT(*) FROM sampling_results) AS sampling_results,
      (SELECT COUNT(*) FROM sheet_sync_jobs) AS sheet_sync_jobs
  `);

  console.log(JSON.stringify({
    success: true,
    adminSettingGroups: groups,
    clearedFlowCounts: flowRows[0],
  }, null, 2));
} finally {
  await conn.end();
}
