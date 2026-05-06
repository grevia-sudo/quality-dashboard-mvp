import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { products, stationEvents, stationTasks } from "../drizzle/schema.ts";
import { getDb } from "../server/db.ts";

const target = "fy7gg9pqqw";
const db = await getDb();

if (!db) {
  throw new Error("資料庫連線不可用");
}

const identityWhere = or(
  eq(products.serialNumber, target),
  eq(products.batchNo, target),
  eq(products.imei, target),
);

const productRows = await db
  .select({
    id: products.id,
    productCode: products.productCode,
    poNumber: products.poNumber,
    vendorName: products.vendorName,
    batchNo: products.batchNo,
    serialNumber: products.serialNumber,
    imei: products.imei,
    productName: products.productName,
    currentStationCode: products.currentStationCode,
    currentStatus: products.currentStatus,
    createdAt: products.createdAt,
    updatedAt: products.updatedAt,
    archivedAt: products.archivedAt,
  })
  .from(products)
  .where(and(isNull(products.archivedAt), identityWhere))
  .orderBy(desc(products.id));

const archivedRows = await db
  .select({
    id: products.id,
    productCode: products.productCode,
    poNumber: products.poNumber,
    batchNo: products.batchNo,
    serialNumber: products.serialNumber,
    imei: products.imei,
    archivedAt: products.archivedAt,
    updatedAt: products.updatedAt,
  })
  .from(products)
  .where(identityWhere)
  .orderBy(desc(products.id));

const productIds = archivedRows.map((row) => row.id);

const taskRows = productIds.length
  ? await db
      .select({
        id: stationTasks.id,
        productId: stationTasks.productId,
        stationCode: stationTasks.stationCode,
        taskStatus: stationTasks.taskStatus,
        createdAt: stationTasks.createdAt,
        updatedAt: stationTasks.updatedAt,
        completedAt: stationTasks.completedAt,
        resultSummary: stationTasks.resultSummary,
      })
      .from(stationTasks)
      .where(inArray(stationTasks.productId, productIds))
      .orderBy(desc(stationTasks.id))
  : [];

const eventRows = productIds.length
  ? await db
      .select({
        id: stationEvents.id,
        productId: stationEvents.productId,
        stationCode: stationEvents.stationCode,
        eventType: stationEvents.eventType,
        payload: stationEvents.payload,
        createdAt: stationEvents.createdAt,
        operatorUserId: stationEvents.operatorUserId,
      })
      .from(stationEvents)
      .where(inArray(stationEvents.productId, productIds))
      .orderBy(desc(stationEvents.id))
  : [];

console.log(JSON.stringify({ target, productRows, archivedRows, taskRows, eventRows }, null, 2));
