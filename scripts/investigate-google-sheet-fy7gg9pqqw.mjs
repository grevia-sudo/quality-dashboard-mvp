import mysql from "mysql2/promise";

const target = "FY7GG9PQQW";
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("缺少 DATABASE_URL");
}

const connection = await mysql.createConnection(databaseUrl);

try {
  const [productRows] = await connection.query(
    `
      SELECT
        id,
        productCode,
        poNumber,
        vendorName,
        batchNo,
        serialNumber,
        imei,
        productName,
        importedCategoryName,
        importedBrandName,
        stationCode,
        productStatus,
        sheetRowNumber,
        lastSheetSyncedAt,
        createdAt,
        updatedAt
      FROM products
      WHERE archivedAt IS NULL
        AND (UPPER(serialNumber) = UPPER(?) OR UPPER(batchNo) = UPPER(?) OR UPPER(imei) = UPPER(?))
      ORDER BY id DESC
    `,
    [target, target, target],
  );

  const [latestJobs] = await connection.query(
    `
      SELECT id, jobType, targetSheetName, syncJobStatus, queuedAt, startedAt, finishedAt, errorMessage
      FROM sheet_sync_jobs
      WHERE targetSheetName = '採購單'
      ORDER BY id DESC
      LIMIT 12
    `,
  );

  console.log(JSON.stringify({ target, productRows, latestJobs }, null, 2));
} finally {
  await connection.end();
}
