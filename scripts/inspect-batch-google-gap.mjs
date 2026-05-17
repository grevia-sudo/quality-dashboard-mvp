import mysql from 'mysql2/promise';

const targetBatches = ['00500025301', '00500025299'];

function findExistingColumn(columnRows, candidates) {
  const existing = new Set(columnRows.map((row) => String(row.Field)));
  return candidates.find((name) => existing.has(name)) ?? null;
}

function pickRowValue(row, candidates) {
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      return row[key];
    }
  }
  return null;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing');
  }

  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  try {
    const [productColumns] = await connection.query('SHOW COLUMNS FROM products');
    const [taskColumns] = await connection.query('SHOW COLUMNS FROM station_tasks');
    const [syncColumns] = await connection.query('SHOW COLUMNS FROM sheet_sync_jobs');

    const productIdColumn = findExistingColumn(productColumns, ['id']);
    const batchColumn = findExistingColumn(productColumns, ['batchNo', 'batch_no']);
    if (!productIdColumn || !batchColumn) {
      throw new Error(`products 缺少必要欄位：id=${productIdColumn}, batch=${batchColumn}`);
    }

    const [productRows] = await connection.execute(
      `SELECT * FROM products WHERE \`${batchColumn}\` IN (?, ?) ORDER BY \`${productIdColumn}\``,
      targetBatches,
    );

    const normalizedProductRows = productRows.map((row) => ({
      id: pickRowValue(row, ['id']),
      productCode: pickRowValue(row, ['productCode', 'product_code']),
      poNumber: pickRowValue(row, ['poNumber', 'po_number']),
      batchNo: pickRowValue(row, ['batchNo', 'batch_no']),
      serialNumber: pickRowValue(row, ['serialNumber', 'serial_number']),
      imei: pickRowValue(row, ['imei']),
      currentStationCode: pickRowValue(row, ['currentStationCode', 'current_station_code']),
      currentStatus: pickRowValue(row, ['currentStatus', 'current_status']),
      sheetRowNumber: pickRowValue(row, ['sheetRowNumber', 'sheet_row_number']),
      lastSheetSyncedAt: pickRowValue(row, ['lastSheetSyncedAt', 'last_sheet_synced_at']),
      inspectionSummary: pickRowValue(row, ['inspectionSummary', 'inspection_summary']),
      updatedAt: pickRowValue(row, ['updatedAt', 'updated_at']),
      createdAt: pickRowValue(row, ['createdAt', 'created_at']),
    }));

    const productIds = normalizedProductRows.map((row) => row.id).filter(Boolean);
    let taskRows = [];
    if (productIds.length > 0) {
      const taskProductIdColumn = findExistingColumn(taskColumns, ['productId', 'product_id']);
      const taskIdColumn = findExistingColumn(taskColumns, ['id']);
      if (taskProductIdColumn && taskIdColumn) {
        const placeholders = productIds.map(() => '?').join(', ');
        const [rows] = await connection.execute(
          `SELECT * FROM station_tasks WHERE \`${taskProductIdColumn}\` IN (${placeholders}) ORDER BY \`${taskIdColumn}\``,
          productIds,
        );
        taskRows = rows;
      }
    }

    let syncRows = [];
    if (syncColumns.some((row) => String(row.Field) === 'payload')) {
      const syncIdColumn = findExistingColumn(syncColumns, ['id']) ?? 'id';
      const [rows] = await connection.execute(
        `SELECT * FROM sheet_sync_jobs WHERE JSON_SEARCH(payload, 'one', ?, NULL, '$**.batchNo') IS NOT NULL OR JSON_SEARCH(payload, 'one', ?, NULL, '$**.batchNo') IS NOT NULL ORDER BY \`${syncIdColumn}\` DESC LIMIT 50`,
        targetBatches,
      );
      syncRows = rows;
    }

    process.stdout.write(JSON.stringify({
      targetBatches,
      productColumns: productColumns.map((row) => row.Field),
      taskColumns: taskColumns.map((row) => row.Field),
      syncColumns: syncColumns.map((row) => row.Field),
      normalizedProductRows,
      rawTaskRows: taskRows,
      rawSyncRows: syncRows,
    }, null, 2));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
