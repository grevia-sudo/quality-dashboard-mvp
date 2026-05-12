import { afterAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { completeStationTask, deleteImportedPurchaseOrder, getDb } from "./db";
import {
  engineerDailyProductivity,
  products,
  productivityScoreDetails,
  samplingResults,
  stationEvents,
  stationTasks,
  users,
  purchaseOrderDeletionLogs,
} from "../drizzle/schema";

const createdPoNumbers = new Set<string>();
const createdUserOpenIds = new Set<string>();

async function cleanupCreatedRows() {
  const db = await getDb();
  if (!db) return;

  if (createdPoNumbers.size > 0) {
    const poNumbers = Array.from(createdPoNumbers);
    const productRows = await db
      .select({ id: products.id })
      .from(products)
      .where(inArray(products.poNumber, poNumbers));
    const productIds = productRows.map((row) => row.id);

    if (productIds.length > 0) {
      const eventRows = await db
        .select({ id: stationEvents.id })
        .from(stationEvents)
        .where(inArray(stationEvents.productId, productIds));
      const eventIds = eventRows.map((row) => row.id);

      if (eventIds.length > 0) {
        await db.delete(productivityScoreDetails).where(inArray(productivityScoreDetails.stationEventId, eventIds));
      }

      await db.delete(samplingResults).where(inArray(samplingResults.productId, productIds));
      await db.delete(stationEvents).where(inArray(stationEvents.productId, productIds));
      await db.delete(stationTasks).where(inArray(stationTasks.productId, productIds));
      await db.delete(products).where(inArray(products.id, productIds));
    }

    await db.delete(purchaseOrderDeletionLogs).where(inArray(purchaseOrderDeletionLogs.poNumber, poNumbers));
  }

  if (createdUserOpenIds.size > 0) {
    await db.delete(users).where(inArray(users.openId, Array.from(createdUserOpenIds)));
  }
}

afterAll(async () => {
  await cleanupCreatedRows();
});

describe("deleteImportedPurchaseOrder integration", () => {
  it("deletes dependent event, sampling, score detail, task, and product rows without FK errors", async () => {
    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const poNumber = `PO-DELETE-IT-${uniqueSuffix}`;
    const openId = `delete-po-admin-${uniqueSuffix}`;
    createdPoNumbers.add(poNumber);
    createdUserOpenIds.add(openId);

    await db.insert(users).values({
      openId,
      username: `delete-po-admin-${uniqueSuffix}`,
      name: "Delete PO Admin",
      loginMethod: "password",
      role: "admin",
    });

    const actorRows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.openId, openId))
      .limit(1);
    const actor = actorRows[0];
    if (!actor) {
      throw new Error("Failed to create actor user");
    }

    await db.insert(products).values([
      {
        productCode: `PO-DELETE-PRODUCT-1-${uniqueSuffix}`,
        poNumber,
        vendorName: "Delete Test Vendor",
        productName: "Delete Test Device 1",
        sheetRowNumber: 18,
        currentStationCode: "A1",
        currentStatus: "pending_a1",
      },
      {
        productCode: `PO-DELETE-PRODUCT-2-${uniqueSuffix}`,
        poNumber,
        vendorName: "Delete Test Vendor",
        productName: "Delete Test Device 2",
        sheetRowNumber: 19,
        currentStationCode: "A1",
        currentStatus: "pending_a1",
      },
    ]);

    const insertedProducts = await db
      .select({ id: products.id, productCode: products.productCode })
      .from(products)
      .where(eq(products.poNumber, poNumber));

    expect(insertedProducts).toHaveLength(2);

    await db.insert(stationTasks).values(
      insertedProducts.map((product) => ({
        productId: product.id,
        stationCode: "A1" as const,
        taskStatus: "completed" as const,
        dueDate: new Date("2026-05-04T00:00:00Z"),
        completedAt: new Date("2026-05-04T01:00:00Z"),
        resultSummary: "Delete integration task",
      })),
    );

    const insertedTasks = await db
      .select({ id: stationTasks.id, productId: stationTasks.productId })
      .from(stationTasks)
      .where(inArray(stationTasks.productId, insertedProducts.map((product) => product.id)));

    await db.insert(stationEvents).values(
      insertedTasks.map((task) => ({
        productId: task.productId,
        stationTaskId: task.id,
        stationCode: "A1" as const,
        eventType: "complete" as const,
        operatorUserId: actor.id,
        businessDate: new Date("2026-05-04T00:00:00Z"),
      })),
    );

    const insertedEvents = await db
      .select({ id: stationEvents.id, productId: stationEvents.productId })
      .from(stationEvents)
      .where(inArray(stationEvents.productId, insertedProducts.map((product) => product.id)));

    await db.insert(samplingResults).values({
      productId: insertedProducts[0]!.id,
      stationTaskId: insertedTasks.find((task) => task.productId === insertedProducts[0]!.id)?.id ?? null,
      sampledByUserId: actor.id,
      sampleDate: new Date("2026-05-04T00:00:00Z"),
      passed: true,
      reworkToStationCode: "C",
    });

    const businessDate = new Date("2026-05-04T00:00:00Z");

    await db.insert(productivityScoreDetails).values({
      businessDate,
      userId: actor.id,
      stationEventId: insertedEvents[0]!.id,
      productId: insertedProducts[0]!.id,
      stationCode: "A1",
      completedQty: 1,
      baseUnitPoints: "1.000000",
      reworkFactor: "1.0000",
      qualityFactor: "1.0000",
      earnedPoints: "1.000000",
    });

    await db.insert(engineerDailyProductivity).values({
      businessDate,
      userId: actor.id,
      attendanceFlag: true,
      totalPoints: "1.500000",
      rawAchievementRate: "150.00",
      kpiAchievementRate: "100.00",
      overAchievementRate: "50.00",
      samplingFailRate: "0.0000",
      reworkRate: "0.0000",
      overdueCount: 0,
      avgProcessHours: "0.00",
      attendanceFairnessFactor: "1.0000",
      finalKpiScore: "100.000000",
    });

    const result = await deleteImportedPurchaseOrder({
      poNumber,
      deletedByUserId: actor.id,
      deletedByName: "Delete PO Admin",
    });

    expect(result.success).toBe(true);
    expect(result.deletedProducts).toBe(2);
    expect(result.deletedTasks).toBe(2);
    expect(result.googleSheetSync).toMatchObject({
      success: true,
      skipped: true,
      deletedRowNumbers: [18, 19],
      reason: "test_environment",
    });

    const [remainingProducts, remainingTasks, remainingEvents, remainingSampling, remainingScores, remainingDailySummaries, deletionLogs] = await Promise.all([
      db.select({ id: products.id }).from(products).where(eq(products.poNumber, poNumber)),
      db.select({ id: stationTasks.id }).from(stationTasks).where(inArray(stationTasks.productId, insertedProducts.map((product) => product.id))),
      db.select({ id: stationEvents.id }).from(stationEvents).where(inArray(stationEvents.productId, insertedProducts.map((product) => product.id))),
      db.select({ id: samplingResults.id }).from(samplingResults).where(eq(samplingResults.productId, insertedProducts[0]!.id)),
      db.select({ id: productivityScoreDetails.id }).from(productivityScoreDetails).where(eq(productivityScoreDetails.productId, insertedProducts[0]!.id)),
      db.select({ id: engineerDailyProductivity.id }).from(engineerDailyProductivity).where(and(eq(engineerDailyProductivity.userId, actor.id), eq(engineerDailyProductivity.businessDate, businessDate))),
      db.select().from(purchaseOrderDeletionLogs).where(eq(purchaseOrderDeletionLogs.poNumber, poNumber)),
    ]);

    expect(remainingProducts).toHaveLength(0);
    expect(remainingTasks).toHaveLength(0);
    expect(remainingEvents).toHaveLength(0);
    expect(remainingSampling).toHaveLength(0);
    expect(remainingScores).toHaveLength(0);
    expect(remainingDailySummaries).toHaveLength(0);
    expect(deletionLogs).toHaveLength(1);
    expect(deletionLogs[0]).toMatchObject({
      poNumber,
      deletedProducts: 2,
      deletedTasks: 2,
      deletedByUserId: actor.id,
      deletedByName: "Delete PO Admin",
    });

    createdPoNumbers.delete(poNumber);
    await db.delete(purchaseOrderDeletionLogs).where(eq(purchaseOrderDeletionLogs.poNumber, poNumber));
    createdUserOpenIds.delete(openId);
    await db.delete(users).where(eq(users.openId, openId));
  }, 20000);

  it("rejects stale station completion submissions after the purchase order has been deleted", async () => {
    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const poNumber = `PO-DELETE-STALE-${uniqueSuffix}`;
    const openId = `delete-po-stale-${uniqueSuffix}`;
    createdPoNumbers.add(poNumber);
    createdUserOpenIds.add(openId);

    await db.insert(users).values({
      openId,
      username: `delete-po-stale-${uniqueSuffix}`,
      name: "Delete PO Stale Admin",
      loginMethod: "password",
      role: "admin",
    });

    const actorRows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.openId, openId))
      .limit(1);
    const actor = actorRows[0];
    if (!actor) {
      throw new Error("Failed to create actor user");
    }

    await db.insert(products).values({
      productCode: `PO-DELETE-STALE-PRODUCT-${uniqueSuffix}`,
      poNumber,
      vendorName: "Delete Test Vendor",
      productName: "Delete Stale Device",
      currentStationCode: "A1",
      currentStatus: "pending_a1",
    });

    const insertedProductRows = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.poNumber, poNumber))
      .limit(1);
    const insertedProduct = insertedProductRows[0];
    if (!insertedProduct) {
      throw new Error("Failed to create stale product row");
    }

    await db.insert(stationTasks).values({
      productId: insertedProduct.id,
      stationCode: "A1",
      taskStatus: "pending",
      dueDate: new Date("2026-05-04T00:00:00Z"),
      resultSummary: "待處理",
    });

    const insertedTaskRows = await db
      .select({ id: stationTasks.id })
      .from(stationTasks)
      .where(and(eq(stationTasks.productId, insertedProduct.id), eq(stationTasks.stationCode, "A1")))
      .limit(1);
    const insertedTask = insertedTaskRows[0];
    if (!insertedTask) {
      throw new Error("Failed to create stale task row");
    }

    await deleteImportedPurchaseOrder({
      poNumber,
      deletedByUserId: actor.id,
      deletedByName: "Delete PO Stale Admin",
    });

    const staleResult = await completeStationTask({
      taskId: insertedTask.id,
      stationCode: "A1",
      operatorUserId: actor.id,
      productId: insertedProduct.id,
      summary: "使用舊分頁送出",
    });

    expect(staleResult).toMatchObject({
      success: false,
      message: "此作業已失效，商品已不存在或已封存，請重新整理頁面",
    });

    const [eventsAfterDelete, tasksAfterDelete, productsAfterDelete] = await Promise.all([
      db.select({ id: stationEvents.id }).from(stationEvents).where(eq(stationEvents.productId, insertedProduct.id)),
      db.select({ id: stationTasks.id }).from(stationTasks).where(eq(stationTasks.productId, insertedProduct.id)),
      db.select({ id: products.id }).from(products).where(eq(products.id, insertedProduct.id)),
    ]);

    expect(eventsAfterDelete).toHaveLength(0);
    expect(tasksAfterDelete).toHaveLength(0);
    expect(productsAfterDelete).toHaveLength(0);

    createdPoNumbers.delete(poNumber);
    await db.delete(purchaseOrderDeletionLogs).where(eq(purchaseOrderDeletionLogs.poNumber, poNumber));
    createdUserOpenIds.delete(openId);
    await db.delete(users).where(eq(users.openId, openId));
  }, 20000);
});
