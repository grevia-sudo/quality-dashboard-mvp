import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { archiveExpiredData, getDb } from "./db";
import { productArchives, products, stationTasks } from "../drizzle/schema";

const productCode = `ARCHIVE-TEST-${Date.now()}`;
let productId: number | null = null;

beforeAll(async () => {
  const db = await getDb();
  if (!db) {
    throw new Error("Database connection is required for archive integration test");
  }

  const insertedProducts = await db.insert(products).values({
    productCode,
    productName: "Archive Test Device",
    currentStationCode: "C",
    currentStatus: "pending_c",
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
  }).$returningId();

  productId = insertedProducts[0]?.id ?? null;
  if (!productId) {
    throw new Error("Failed to create archive test product");
  }

  await db.insert(stationTasks).values({
    productId,
    stationCode: "C",
    taskStatus: "pending",
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db || !productId) return;

  await db.delete(stationTasks).where(eq(stationTasks.productId, productId));
  await db.delete(productArchives).where(eq(productArchives.originalProductId, productId));
  await db.delete(products).where(eq(products.id, productId));
});

describe("archiveExpiredData", () => {
  it("archives products older than six months and marks related tasks as archived", async () => {
    const db = await getDb();
    if (!db || !productId) {
      throw new Error("Database connection is required for archive integration test");
    }

    const result = await archiveExpiredData();

    expect(result.archivedCount).toBeGreaterThan(0);

    const archivedRows = await db.select().from(productArchives).where(eq(productArchives.originalProductId, productId));
    const productRows = await db.select().from(products).where(eq(products.id, productId));
    const taskRows = await db.select().from(stationTasks).where(eq(stationTasks.productId, productId));

    expect(archivedRows.length).toBeGreaterThan(0);
    expect(archivedRows[0]?.productSnapshot).toMatchObject({ productCode });
    expect(productRows[0]?.archivedAt).toBeTruthy();
    expect(taskRows[0]?.taskStatus).toBe("archived");
  });
});
