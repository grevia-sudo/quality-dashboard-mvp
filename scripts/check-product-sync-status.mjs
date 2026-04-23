import mysql from "mysql2/promise";

const serialNumber = process.argv[2];

if (!serialNumber) {
  throw new Error("請提供商品序號");
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL 不存在");
}

const connection = await mysql.createConnection(process.env.DATABASE_URL);

try {
  const [rows] = await connection.query(
    `
      SELECT
        p.id,
        p.poNumber,
        p.vendorName,
        p.batchNo,
        p.serialNumber,
        p.imei,
        p.productName,
        p.sheetRowNumber,
        p.lastSheetSyncedAt,
        p.updatedAt,
        c.categoryName,
        cTask.completedAt AS cCompletedAt,
        cTask.stationTaskStatus AS cTaskStatus,
        cTask.stationCode AS cTaskStationCode,
        eTask.id AS eTaskId,
        eTask.completedAt AS eCompletedAt,
        eTask.stationTaskStatus AS eTaskStatus,
        eTask.resultSummary AS eResultSummary,
        JSON_UNQUOTE(JSON_EXTRACT(cTask.metadata, '$.cCameraSummary')) AS cCameraSummary,
        JSON_UNQUOTE(JSON_EXTRACT(cTask.metadata, '$.cFaultSummary')) AS cFaultSummary,
        JSON_UNQUOTE(JSON_EXTRACT(cTask.metadata, '$.cAppearanceSummary')) AS cAppearanceSummary,
        JSON_UNQUOTE(JSON_EXTRACT(cTask.metadata, '$.cModifiedBatterySummary')) AS cModifiedBatterySummary,
        JSON_UNQUOTE(JSON_EXTRACT(cTask.metadata, '$.cModifiedBFaultSummary')) AS cModifiedBFaultSummary,
        se.id AS cCompleteEventId,
        u.name AS cOperatorName,
        eEvent.id AS eCompleteEventId,
        eOperator.name AS eOperatorName
      FROM products p
      LEFT JOIN product_categories c ON c.id = p.categoryId
      LEFT JOIN station_tasks cTask ON cTask.productId = p.id AND cTask.stationCode = 'C'
      LEFT JOIN station_events se ON se.stationTaskId = cTask.id AND se.stationCode = 'C' AND se.stationEventType = 'complete'
      LEFT JOIN users u ON u.id = se.operatorUserId
      LEFT JOIN station_tasks eTask ON eTask.productId = p.id AND eTask.stationCode = 'E'
      LEFT JOIN station_events eEvent ON eEvent.stationTaskId = eTask.id AND eEvent.stationCode = 'E' AND eEvent.stationEventType = 'complete'
      LEFT JOIN users eOperator ON eOperator.id = eEvent.operatorUserId
      WHERE p.serialNumber = ?
      ORDER BY eTask.completedAt DESC, eEvent.id DESC, cTask.completedAt DESC, se.id DESC
      LIMIT 10
    `,
    [serialNumber],
  );

  console.log(JSON.stringify(rows, null, 2));
} finally {
  await connection.end();
}
