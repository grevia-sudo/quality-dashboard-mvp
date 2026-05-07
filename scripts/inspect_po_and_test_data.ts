import { eq, like, or, sql } from "drizzle-orm";
import { products, purchaseOrderDeletionLogs, stationEvents, stationTasks, users } from "../drizzle/schema";
import { getDb } from "../server/db";

async function main() {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  const [testProducts, testUsers, deletedPoProducts, deletedPoDeletionLogs, deletedPoEventCounts, deletedPoTaskCounts] = await Promise.all([
    db.select({
      id: products.id,
      poNumber: products.poNumber,
      productCode: products.productCode,
      batchNo: products.batchNo,
      serialNumber: products.serialNumber,
      archivedAt: products.archivedAt,
      currentStatus: products.currentStatus,
    })
      .from(products)
      .where(or(
        like(products.poNumber, "PO-KPI-WRITE-%"),
        like(products.poNumber, "PO-TEST-%"),
        like(products.batchNo, "KPI-BATCH-%"),
        like(products.serialNumber, "KPI-SN-%"),
      )),
    db.select({
      id: users.id,
      openId: users.openId,
      username: users.username,
      name: users.name,
      role: users.role,
    })
      .from(users)
      .where(or(
        like(users.openId, "kpi-writer-%"),
        like(users.openId, "support-admin-%"),
        like(users.openId, "support-engineer-%"),
        like(users.username, "kpi-writer-%"),
        like(users.username, "support-admin-%"),
        like(users.username, "support-engineer-%"),
      )),
    db.select({
      id: products.id,
      poNumber: products.poNumber,
      productCode: products.productCode,
      currentStationCode: products.currentStationCode,
      currentStatus: products.currentStatus,
      archivedAt: products.archivedAt,
      updatedAt: products.updatedAt,
    })
      .from(products)
      .where(eq(products.poNumber, "PO-20260506-02")),
    db.select({
      id: purchaseOrderDeletionLogs.id,
      poNumber: purchaseOrderDeletionLogs.poNumber,
      deletedProducts: purchaseOrderDeletionLogs.deletedProducts,
      deletedTasks: purchaseOrderDeletionLogs.deletedTasks,
      deletedByName: purchaseOrderDeletionLogs.deletedByName,
      createdAt: purchaseOrderDeletionLogs.createdAt,
    }).from(purchaseOrderDeletionLogs).where(eq(purchaseOrderDeletionLogs.poNumber, "PO-20260506-02")),
    db.select({
      stationCode: stationEvents.stationCode,
      eventType: stationEvents.eventType,
      total: sql<number>`count(*)`,
    })
      .from(stationEvents)
      .innerJoin(products, eq(stationEvents.productId, products.id))
      .where(eq(products.poNumber, "PO-20260506-02"))
      .groupBy(stationEvents.stationCode, stationEvents.eventType),
    db.select({
      stationCode: stationTasks.stationCode,
      taskStatus: stationTasks.taskStatus,
      total: sql<number>`count(*)`,
    })
      .from(stationTasks)
      .innerJoin(products, eq(stationTasks.productId, products.id))
      .where(eq(products.poNumber, "PO-20260506-02"))
      .groupBy(stationTasks.stationCode, stationTasks.taskStatus),
  ]);

  console.log(JSON.stringify({
    testProductsCount: testProducts.length,
    testProductsPreview: testProducts.slice(0, 10),
    testUsersCount: testUsers.length,
    testUsersPreview: testUsers.slice(0, 10),
    deletedPo: {
      productCount: deletedPoProducts.length,
      productPreview: deletedPoProducts.slice(0, 10),
      deletionLogCount: deletedPoDeletionLogs.length,
      deletionLogs: deletedPoDeletionLogs,
      eventCounts: deletedPoEventCounts,
      taskCounts: deletedPoTaskCounts,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
