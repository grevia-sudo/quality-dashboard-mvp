import mysql from "mysql2/promise";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing");
}

const parsed = new URL(process.env.DATABASE_URL);
const connection = await mysql.createConnection({
  host: parsed.hostname,
  port: parsed.port ? Number(parsed.port) : 3306,
  user: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
  database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
  timezone: "Z",
  ssl: { rejectUnauthorized: false },
});

try {
  const [rows] = await connection.query(`
    SELECT
      p.id AS productId,
      p.poNumber,
      p.batchNo,
      p.serialNumber,
      p.imei,
      p.sheetRowNumber,
      p.lastSheetSyncedAt,
      p.updatedAt AS productUpdatedAt,
      st.id AS taskId,
      st.completedAt AS eCompletedAt,
      st.updatedAt AS taskUpdatedAt,
      st.resultSummary,
      u.name AS operatorName,
      se.createdAt AS eventCreatedAt,
      se.businessDate
    FROM station_tasks st
    INNER JOIN products p ON p.id = st.productId
    LEFT JOIN station_events se ON se.stationTaskId = st.id AND se.stationCode = 'E' AND se.stationEventType = 'complete'
    LEFT JOIN users u ON u.id = se.operatorUserId
    WHERE st.stationCode = 'E' AND st.stationTaskStatus = 'completed' AND p.archivedAt IS NULL
    ORDER BY st.completedAt DESC
    LIMIT 10
  `);

  console.log(JSON.stringify(rows, null, 2));
} finally {
  await connection.end();
}
