import { afterAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { deleteImportedPurchaseOrder, getDb } from "./db";
import {
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
        currentStationCode: "A1",
        currentStatus: "pending_a1",
      },
      {
        productCode: `PO-DELETE-PRODUCT-2-${uniqueSuffix}`,
        poNumber,
        vendorName: "Delete Test Vendor",
        productName: "Delete Test Device 2",
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

    await db.insert(productivityScoreDetails).values({
      businessDate: new Date("2026-05-04T00:00:00Z"),
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

    const result = await deleteImportedPurchaseOrder({
      poNumber,
      deletedByUserId: actor.id,
      deletedByName: "Delete PO Admin",
    });

    expect(result.success).toBe(true);
    expect(result.deletedProducts).toBe(2);
    expect(result.deletedTasks).toBe(2);

    const [remainingProducts, remainingTasks, remainingEvents, remainingSampling, remainingScores, deletionLogs] = await Promise.all([
      db.select({ id: products.id }).from(products).where(eq(products.poNumber, poNumber)),
      db.select({ id: stationTasks.id }).from(stationTasks).where(inArray(stationTasks.productId, insertedProducts.map((product) => product.id))),
      db.select({ id: stationEvents.id }).from(stationEvents).where(inArray(stationEvents.productId, insertedProducts.map((product) => product.id))),
      db.select({ id: samplingResults.id }).from(samplingResults).where(eq(samplingResults.productId, insertedProducts[0]!.id)),
      db.select({ id: productivityScoreDetails.id }).from(productivityScoreDetails).where(eq(productivityScoreDetails.productId, insertedProducts[0]!.id)),
      db.select().from(purchaseOrderDeletionLogs).where(eq(purchaseOrderDeletionLogs.poNumber, poNumber)),
    ]);

    expect(remainingProducts).toHaveLength(0);
    expect(remainingTasks).toHaveLength(0);
    expect(remainingEvents).toHaveLength(0);
    expect(remainingSampling).toHaveLength(0);
    expect(remainingScores).toHaveLength(0);
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
});
