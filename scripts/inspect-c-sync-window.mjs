import mysql from 'mysql2/promise';

const batches = ['00500025301', '00500025299'];

function addMinutes(dateValue, deltaMinutes) {
  return new Date(new Date(dateValue).getTime() + deltaMinutes * 60 * 1000);
}

function findColumn(columns, candidates) {
  const existing = new Set(columns.map((row) => String(row.Field)));
  return candidates.find((name) => existing.has(name)) ?? null;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing');
  const connection = await mysql.createConnection(process.env.DATABASE_URL);
  try {
    const [productCols] = await connection.query('SHOW COLUMNS FROM products');
    const [taskCols] = await connection.query('SHOW COLUMNS FROM station_tasks');
    const [syncCols] = await connection.query('SHOW COLUMNS FROM sheet_sync_jobs');

    const productIdCol = findColumn(productCols, ['id']);
    const batchCol = findColumn(productCols, ['batchNo', 'batch_no']);
    const rowCol = findColumn(productCols, ['sheetRowNumber', 'sheet_row_number']);
    const taskProductIdCol = findColumn(taskCols, ['productId', 'product_id']);
    const taskStatusCol = findColumn(taskCols, ['taskStatus', 'stationTaskStatus', 'task_status']);
    const taskCompletedCol = findColumn(taskCols, ['completedAt', 'completed_at']);
    const taskUpdatedCol = findColumn(taskCols, ['updatedAt', 'updated_at']);
    const taskResultCol = findColumn(taskCols, ['resultSummary', 'result_summary']);
    const syncStatusCol = findColumn(syncCols, ['status', 'syncJobStatus', 'sync_job_status']);
    const syncQueuedCol = findColumn(syncCols, ['queuedAt', 'queued_at']);
    const syncStartedCol = findColumn(syncCols, ['startedAt', 'started_at']);
    const syncFinishedCol = findColumn(syncCols, ['finishedAt', 'finished_at']);
    const syncErrorCol = findColumn(syncCols, ['errorMessage', 'error_message']);

    const [productRows] = await connection.execute(
      `SELECT \`${productIdCol}\` AS id, \`${batchCol}\` AS batchNo${rowCol ? `, \`${rowCol}\` AS sheetRowNumber` : ''}
       FROM products
       WHERE \`${batchCol}\` IN (?, ?)
       ORDER BY \`${batchCol}\``,
      batches,
    );
    const productIds = productRows.map((row) => row.id);
    if (!productIds.length) {
      process.stdout.write(JSON.stringify({ batches, productRows: [], cTasks: [], syncJobsByWindow: [] }, null, 2));
      return;
    }

    const placeholders = productIds.map(() => '?').join(', ');
    const [cTasks] = await connection.execute(
      `SELECT id, \`${taskProductIdCol}\` AS productId, stationCode, \`${taskStatusCol}\` AS taskStatus, \`${taskCompletedCol}\` AS completedAt, \`${taskUpdatedCol}\` AS updatedAt, \`${taskResultCol}\` AS resultSummary, metadata
       FROM station_tasks
       WHERE \`${taskProductIdCol}\` IN (${placeholders}) AND stationCode = 'C'
       ORDER BY \`${taskCompletedCol}\` ASC`,
      productIds,
    );

    const syncJobsByWindow = [];
    for (const task of cTasks) {
      if (!task.completedAt) continue;
      const start = addMinutes(task.completedAt, -3);
      const end = addMinutes(task.completedAt, 3);
      const [jobs] = await connection.execute(
        `SELECT id, jobType, targetSheetName, \`${syncStatusCol}\` AS status, \`${syncQueuedCol}\` AS queuedAt, \`${syncStartedCol}\` AS startedAt, \`${syncFinishedCol}\` AS finishedAt, \`${syncErrorCol}\` AS errorMessage
         FROM sheet_sync_jobs
         WHERE \`${syncQueuedCol}\` BETWEEN ? AND ?
         ORDER BY \`${syncQueuedCol}\` ASC, id ASC`,
        [start, end],
      );
      syncJobsByWindow.push({
        productId: task.productId,
        cTaskId: task.id,
        completedAt: task.completedAt,
        windowStart: start,
        windowEnd: end,
        jobs,
      });
    }

    process.stdout.write(JSON.stringify({
      batches,
      productRows,
      cTasks,
      syncJobsByWindow,
      columns: {
        productIdCol,
        batchCol,
        rowCol,
        taskProductIdCol,
        taskStatusCol,
        taskCompletedCol,
        syncStatusCol,
        syncQueuedCol,
      },
    }, null, 2));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
