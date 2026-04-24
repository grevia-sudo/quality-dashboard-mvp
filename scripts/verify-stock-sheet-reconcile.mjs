import { and, eq, inArray } from "drizzle-orm";
import { getDb, getStationPageData } from "../server/db.ts";
import { products, stationEvents, stationTasks } from "../drizzle/schema.ts";

const matchedBatchNo = process.argv[2] ?? "00500007550";
const uniqueSeed = Date.now();
const productCode = `STOCK-VERIFY-${uniqueSeed}`;

const db = await getDb();
if (!db) {
  throw new Error("Database is not available");
}

let productId = null;
let taskId = null;

try {
  const insertedProducts = await db.insert(products).values({
    productCode,
    batchNo: matchedBatchNo,
    productName: "Stock Sheet Reconcile Verify",
    currentStationCode: "STOCK",
    currentStatus: "pending_stock",
    stockStatus: "pending",
    wipeStatus: "completed",
  }).$returningId();

  productId = insertedProducts[0]?.id ?? null;
  if (!productId) {
    throw new Error("Failed to insert verify product");
  }

  const insertedTasks = await db.insert(stationTasks).values({
    productId,
    stationCode: "STOCK",
    taskStatus: "pending",
    resultSummary: "待入庫 Google Sheet 自動比對驗證",
  }).$returningId();

  taskId = insertedTasks[0]?.id ?? null;
  if (!taskId) {
    throw new Error("Failed to insert verify stock task");
  }

  const before = await db
    .select({
      productId: products.id,
      currentStatus: products.currentStatus,
      currentStationCode: products.currentStationCode,
      stockStatus: products.stockStatus,
      taskId: stationTasks.id,
      taskStatus: stationTasks.taskStatus,
      resultSummary: stationTasks.resultSummary,
    })
    .from(products)
    .innerJoin(stationTasks, eq(stationTasks.productId, products.id))
    .where(and(eq(products.id, productId), eq(stationTasks.id, taskId)))
    .limit(1);

  const stationData = await getStationPageData("STOCK");

  const after = await db
    .select({
      productId: products.id,
      currentStatus: products.currentStatus,
      currentStationCode: products.currentStationCode,
      stockStatus: products.stockStatus,
      taskId: stationTasks.id,
      taskStatus: stationTasks.taskStatus,
      resultSummary: stationTasks.resultSummary,
      metadata: stationTasks.metadata,
    })
    .from(products)
    .innerJoin(stationTasks, eq(stationTasks.productId, products.id))
    .where(and(eq(products.id, productId), eq(stationTasks.id, taskId)))
    .limit(1);

  const events = await db
    .select({
      id: stationEvents.id,
      eventType: stationEvents.eventType,
      stationCode: stationEvents.stationCode,
      payload: stationEvents.payload,
    })
    .from(stationEvents)
    .where(eq(stationEvents.productId, productId));

  console.log(JSON.stringify({
    matchedBatchNo,
    before: before[0] ?? null,
    after: after[0] ?? null,
    stockTaskStillVisible: stationData.tasks.some((task) => task.productId === productId),
    stationDataTaskCount: stationData.tasks.length,
    events,
  }, null, 2));
} finally {
  if (productId) {
    await db.delete(stationEvents).where(eq(stationEvents.productId, productId));
    await db.delete(stationTasks).where(eq(stationTasks.productId, productId));
    await db.delete(products).where(eq(products.id, productId));
  } else if (taskId) {
    await db.delete(stationTasks).where(inArray(stationTasks.id, [taskId]));
  }
}
