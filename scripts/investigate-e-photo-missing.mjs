import mysql from "mysql2/promise";

const batchNos = [
  "01900000011",
  "01900000010",
  "01900000009",
  "01900000005",
  "01900000002",
  "01900000017",
  "01900000003",
  "01900000018",
  "01900000007",
  "01900000031",
  "01900000008",
  "01900000004",
  "01900000014",
  "01900000001",
  "01900000006",
  "01900000013",
  "01900000015",
  "01900000032",
  "01900000016",
  "01900000028",
  "01900000019",
  "01900000020",
  "01900000021",
  "01900000025",
  "01900000029",
  "01900000024",
  "01900000027",
  "01900000026",
  "01900000022",
  "01900000030",
  "01900000023",
];

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing");
}

const connection = await mysql.createConnection(process.env.DATABASE_URL);

try {
  const placeholders = batchNos.map(() => "?").join(", ");
  const orderBy = batchNos.map(() => "?").join(", ");
  const sql = `
    SELECT p.id AS product_id,
           p.productCode AS product_code,
           p.batchNo AS batch_no,
           p.serialNumber AS serial_number,
           p.imei AS imei,
           p.poNumber AS po_number,
           p.stationCode AS current_station_code,
           p.productStatus AS current_status,
           p.sheetRowNumber AS sheet_row_number,
           p.lastSheetSyncedAt AS last_sheet_synced_at,
           e.id AS e_task_id,
           e.stationTaskStatus AS e_task_status,
           e.completedAt AS e_completed_at,
           e.updatedAt AS e_updated_at,
           JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.ePhotoSyncStatus')) AS e_photo_sync_status,
           JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.ePhotoSyncMessage')) AS e_photo_sync_message,
           JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.ePhotoSyncAttempts')) AS e_photo_sync_attempts,
           JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.eFrontPhotoUrl')) AS e_front_photo_url,
           JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.eBackPhotoUrl')) AS e_back_photo_url,
           JSON_LENGTH(JSON_EXTRACT(e.metadata, '$.ePhotoPendingUploads')) AS pending_upload_payload,
           JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.eFrontPhoto.driveUrl')) AS legacy_front_drive_url,
           JSON_UNQUOTE(JSON_EXTRACT(e.metadata, '$.eBackPhoto.driveUrl')) AS legacy_back_drive_url
    FROM products p
    LEFT JOIN (
      SELECT st1.*
      FROM station_tasks st1
      INNER JOIN (
        SELECT productId, MAX(id) AS latest_id
        FROM station_tasks
        WHERE stationCode = 'E'
        GROUP BY productId
      ) latest ON latest.latest_id = st1.id
    ) e ON e.productId = p.id
    WHERE p.archivedAt IS NULL
      AND p.batchNo IN (${placeholders})
    ORDER BY FIELD(p.batchNo, ${orderBy})
  `;

  const [rows] = await connection.query(sql, [...batchNos, ...batchNos]);
  const normalized = rows.map((row) => ({
    ...row,
    has_front_photo_url: Boolean(row.e_front_photo_url || row.legacy_front_drive_url),
    has_back_photo_url: Boolean(row.e_back_photo_url || row.legacy_back_drive_url),
  }));

  const summary = normalized.reduce((acc, row) => {
    const key = row.e_photo_sync_status || "NO_STATUS";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  console.log(JSON.stringify({
    total: normalized.length,
    summary,
    rows: normalized,
  }, null, 2));
} finally {
  await connection.end();
}
