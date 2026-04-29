import { desc, eq, or, inArray } from "drizzle-orm";
import { getDb } from "../server/db.ts";
import { products, sheetSyncJobs, stationEvents, stationTasks } from "../drizzle/schema.ts";

const db = await getDb();
if (!db) throw new Error("Database unavailable");

const productRows = await db
  .select({
    id: products.id,
    poNumber: products.poNumber,
    batchNo: products.batchNo,
    serialNumber: products.serialNumber,
    imei: products.imei,
    productName: products.productName,
    currentStationCode: products.currentStationCode,
    currentStatus: products.currentStatus,
    stockStatus: products.stockStatus,
    sheetRowNumber: products.sheetRowNumber,
    lastSheetSyncedAt: products.lastSheetSyncedAt,
    createdAt: products.createdAt,
    updatedAt: products.updatedAt,
  })
  .from(products)
  .where(or(eq(products.serialNumber, "adsfhiuahfpiu"), eq(products.batchNo, "00500023929")))
  .orderBy(desc(products.id));

const productIds = productRows.map((row) => row.id);
const taskRows = productIds.length === 0 ? [] : await db
  .select({
    id: stationTasks.id,
    productId: stationTasks.productId,
    stationCode: stationTasks.stationCode,
    taskStatus: stationTasks.taskStatus,
    createdAt: stationTasks.createdAt,
    completedAt: stationTasks.completedAt,
    resultSummary: stationTasks.resultSummary,
  })
  .from(stationTasks)
  .where(inArray(stationTasks.productId, productIds))
  .orderBy(desc(stationTasks.id));

const eventRows = productIds.length === 0 ? [] : await db
  .select({
    id: stationEvents.id,
    productId: stationEvents.productId,
    stationCode: stationEvents.stationCode,
    eventType: stationEvents.eventType,
    createdAt: stationEvents.createdAt,
    payload: stationEvents.payload,
  })
  .from(stationEvents)
  .where(inArray(stationEvents.productId, productIds))
  .orderBy(desc(stationEvents.id));

const jobRows = await db
  .select({
    id: sheetSyncJobs.id,
    jobType: sheetSyncJobs.jobType,
    status: sheetSyncJobs.status,
    queuedAt: sheetSyncJobs.queuedAt,
    startedAt: sheetSyncJobs.startedAt,
    finishedAt: sheetSyncJobs.finishedAt,
    errorMessage: sheetSyncJobs.errorMessage,
  })
  .from(sheetSyncJobs)
  .where(eq(sheetSyncJobs.jobType, "purchase_sheet_sync"))
  .orderBy(desc(sheetSyncJobs.id))
  .limit(10);

console.log(JSON.stringify({ productRows, taskRows, eventRows, jobRows }, null, 2));
