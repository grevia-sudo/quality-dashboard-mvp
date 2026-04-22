import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const connection = await mysql.createConnection(DATABASE_URL);

const targetSerial = process.argv[2] ?? "G6TDT0YH0F0Y";

async function time(label, fn) {
  const started = performance.now();
  const result = await fn();
  const elapsed = Number((performance.now() - started).toFixed(2));
  return { label, elapsed, result };
}

const lookupSql = `
  SELECT
    p.id,
    p.productCode,
    p.poNumber,
    p.vendorName,
    p.importedCategoryName,
    p.batchNo,
    p.serialNumber,
    p.imei,
    p.productName,
    p.categoryId,
    p.stationCode,
    p.productStatus,
    st.id AS pendingTaskId
  FROM products p
  LEFT JOIN station_tasks st
    ON st.\`productId\` = p.id
    AND st.\`stationCode\` = 'A1'
    AND st.\`stationTaskStatus\` IN ('pending', 'in_progress', 'overdue', 'returned')
  WHERE p.\`stationCode\` = 'A1'
    AND p.\`archivedAt\` IS NULL
    AND p.\`serialNumber\` = ?
  ORDER BY CASE
    WHEN p.\`serialNumber\` = ? THEN 1
    ELSE 9
  END
  LIMIT 1
`;

const explainRows = await connection.query(`EXPLAIN ${lookupSql}`, [targetSerial, targetSerial]);

const lookup = await time("lookup", async () => {
  const [rows] = await connection.query(lookupSql, [targetSerial, targetSerial]);
  return rows[0] ?? null;
});

if (!lookup.result) {
  console.log(JSON.stringify({ targetSerial, explainRows: explainRows[0], error: "not found" }, null, 2));
  await connection.end();
  process.exit(0);
}

const completedAt = new Date();
const productId = lookup.result.id;
const pendingTaskId = lookup.result.pendingTaskId;

const productUpdate = await time("product_update", async () => {
  const [result] = await connection.query(
    `UPDATE products
     SET \`stationCode\` = 'A2', \`productStatus\` = 'pending_a2', \`updatedAt\` = ?
     WHERE \`id\` = ?`,
    [completedAt, productId],
  );
  return result;
});

const taskUpdate = pendingTaskId
  ? await time("task_update", async () => {
      const [result] = await connection.query(
        `UPDATE station_tasks
         SET \`stationTaskStatus\` = 'completed', \`completedAt\` = ?, \`resultSummary\` = 'A1 掃碼點到貨完成', \`updatedAt\` = ?
         WHERE \`id\` = ?`,
        [completedAt, completedAt, pendingTaskId],
      );
      return result;
    })
  : { label: "task_update", elapsed: -1, result: "missing pendingTaskId" };

console.log(JSON.stringify({
  targetSerial,
  explain: explainRows[0],
  lookup: { elapsed: lookup.elapsed, productId, pendingTaskId },
  productUpdate: { elapsed: productUpdate.elapsed },
  taskUpdate: { elapsed: taskUpdate.elapsed },
}, null, 2));

await connection.end();
