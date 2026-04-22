import mysql from "mysql2/promise";

async function main() {
  const batchNo = process.argv[2];
  if (!batchNo) {
    throw new Error("用法：node scripts/verify-a2-sheet-row.mjs <batchNo>");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL 不存在");
  }

  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  try {
    const sql = [
      "SELECT",
      "  p.id,",
      "  p.`poNumber` AS poNumber,",
      "  p.`batchNo` AS batchNo,",
      "  p.`currentStationCode` AS currentStationCode,",
      "  p.`currentStatus` AS currentStatus,",
      "  p.`sheetRowNumber` AS sheetRowNumber,",
      "  a2.completedAt AS a2CompletedAt",
      "FROM products p",
      "LEFT JOIN (",
      "  SELECT `productId`, MAX(`completedAt`) AS completedAt",
      "  FROM station_tasks",
      "  WHERE `stationCode` = 'A2' AND `stationTaskStatus` = 'completed'",
      "  GROUP BY `productId`",
      ") a2 ON a2.productId = p.id",
      "WHERE p.`batchNo` = ?",
      "ORDER BY p.id DESC",
      "LIMIT 1",
    ].join("\n");

    const [rows] = await connection.query(sql, [batchNo]);
    console.log(JSON.stringify(rows[0] ?? null, null, 2));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
