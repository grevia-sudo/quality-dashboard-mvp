import mysql from "mysql2/promise";

const TARGETS = [
  {
    key: "batch_00500023929",
    label: "批號 00500023929",
    whereSql: "p.batchNo = ?",
    value: "00500023929",
    requiredStatus: {
      stationCode: "STOCK",
      stockStatus: "stocked",
    },
    requiredEvent: {
      stationCode: "STOCK",
      eventType: "complete",
      summaryIncludes: "自動移除待入庫",
    },
  },
  {
    key: "serial_adsfhiuahfpiu",
    label: "序號 adsfhiuahfpiu",
    whereSql: "p.serialNumber = ?",
    value: "adsfhiuahfpiu",
    requiredStatus: {
      stationCode: "STOCK",
      stockStatus: "pending",
    },
    requiredEvent: {
      stationCode: "E",
      eventType: "complete",
      summaryIncludes: "E 站抹除 完成",
    },
  },
];

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL 不存在");
}

const connection = await mysql.createConnection(process.env.DATABASE_URL);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  const results = [];

  for (const target of TARGETS) {
    const [productRows] = await connection.query(
      `
        SELECT
          p.id,
          p.poNumber,
          p.batchNo,
          p.serialNumber,
          p.stationCode,
          p.productStatus,
          p.stockStatus,
          p.sheetRowNumber,
          p.lastSheetSyncedAt,
          p.updatedAt
        FROM products p
        WHERE ${target.whereSql}
        ORDER BY p.id DESC
        LIMIT 1
      `,
      [target.value],
    );

    const product = productRows[0] ?? null;
    assert(product, `${target.label} 找不到對應商品資料`);
    assert(product.sheetRowNumber !== null, `${target.label} 尚未取得 Google Sheet row number`);
    assert(product.lastSheetSyncedAt !== null, `${target.label} 尚未更新 lastSheetSyncedAt`);
    assert(product.stationCode === target.requiredStatus.stationCode, `${target.label} stationCode 不符合預期：${product.stationCode}`);
    assert(product.stockStatus === target.requiredStatus.stockStatus, `${target.label} stockStatus 不符合預期：${product.stockStatus}`);

    const [eventRows] = await connection.query(
      `
        SELECT
          se.id,
          se.stationCode,
          se.stationEventType AS eventType,
          se.createdAt,
          JSON_UNQUOTE(JSON_EXTRACT(se.payload, '$.summary')) AS summary
        FROM station_events se
        WHERE se.productId = ?
        ORDER BY se.id DESC
      `,
      [product.id],
    );

    const matchedEvent = eventRows.find((event) => (
      event.stationCode === target.requiredEvent.stationCode
      && event.eventType === target.requiredEvent.eventType
      && typeof event.summary === "string"
      && event.summary.includes(target.requiredEvent.summaryIncludes)
    ));

    assert(matchedEvent, `${target.label} 找不到符合條件的 ${target.requiredEvent.stationCode}/${target.requiredEvent.eventType} 事件`);

    results.push({
      key: target.key,
      label: target.label,
      product,
      matchedEvent,
    });
  }

  const [jobRows] = await connection.query(
    `
      SELECT
        id,
        jobType,
        targetSheetName,
        syncJobStatus AS status,
        queuedAt,
        startedAt,
        finishedAt,
        errorMessage
      FROM sheet_sync_jobs
      WHERE jobType = 'purchase_sheet_sync'
      ORDER BY id DESC
      LIMIT 20
    `,
  );

  const successJobs = jobRows.filter((job) => job.status === "success");
  assert(successJobs.length > 0, "找不到成功完成的 purchase_sheet_sync 工作");

  const failedTargets = results.filter((item) => {
    const syncedAt = item.product.lastSheetSyncedAt;
    return !successJobs.some((job) => job.finishedAt !== null && syncedAt !== null && String(job.finishedAt) >= String(syncedAt));
  });

  assert(failedTargets.length === 0, `以下目標缺少晚於 lastSheetSyncedAt 的成功 purchase_sheet_sync 工作：${failedTargets.map((item) => item.label).join("、")}`);

  console.log(JSON.stringify({
    verifiedAt: new Date().toISOString(),
    targets: results,
    successJobs: successJobs.slice(0, 10),
  }, null, 2));
} finally {
  await connection.end();
}
