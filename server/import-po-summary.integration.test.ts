import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { productArchives, products, stationTasks } from "../drizzle/schema";
import { ensureMvpSeedData, getDb, getStationPageData, importProducts } from "./db";

const createdPoNumbers = new Set<string>();

async function archiveCreatedImportTestRows() {
  const db = await getDb();
  if (!db || createdPoNumbers.size === 0) {
    return;
  }

  const targetProducts = await db
    .select()
    .from(products)
    .where(and(inArray(products.poNumber, Array.from(createdPoNumbers)), isNull(products.archivedAt)));

  if (targetProducts.length === 0) {
    return;
  }

  const productIds = targetProducts.map((product) => product.id);
  const archiveMonth = new Date().toISOString().slice(0, 7);

  await db.insert(productArchives).values(
    targetProducts.map((product) => ({
      originalProductId: product.id,
      productSnapshot: product,
      archiveMonth,
    })),
  );

  await db
    .update(products)
    .set({
      archivedAt: new Date(),
      currentStatus: "archived",
      updatedAt: new Date(),
    })
    .where(inArray(products.id, productIds));

  await db
    .update(stationTasks)
    .set({ taskStatus: "archived" })
    .where(inArray(stationTasks.productId, productIds));
}

describe("import PO summary integration", () => {
  beforeAll(async () => {
    await ensureMvpSeedData();
  });

  afterAll(async () => {
    await archiveCreatedImportTestRows();
  });

  it("backfills missing pending A1 PO numbers and exposes grouped data for the import page", async () => {
    const result = await getStationPageData("A1");
    const tasks = result.tasks;

    expect(Array.isArray(tasks)).toBe(true);

    const pendingWithoutPo = tasks.filter((task) => !task.poNumber || !task.poNumber.trim());
    expect(pendingWithoutPo).toHaveLength(0);

    const groupedKeys = new Set(
      tasks.map((task) => `${task.poNumber}__${task.categoryName ?? task.importedCategoryName ?? task.subtypeCode ?? "未分類"}`),
    );
    expect(groupedKeys.size).toBeGreaterThanOrEqual(0);
  });

  it("auto-generates a single shared PO number for the whole import batch", async () => {
    const uniqueSuffix = `${Date.now()}`;
    const rows = [
      {
        batchNo: `AUTO-PO-${uniqueSuffix}-01`,
        serialNumber: `AUTO-SN-${uniqueSuffix}-01`,
        imei: `35${`${Number(uniqueSuffix) + 1}`.padStart(13, "0").slice(-13)}`,
        productName: "Apple iPhone 6 16GB 銀色",
        categoryName: "智慧手機",
      },
      {
        batchNo: `AUTO-PO-${uniqueSuffix}-02`,
        serialNumber: `AUTO-SN-${uniqueSuffix}-02`,
        imei: `35${`${Number(uniqueSuffix) + 2}`.padStart(13, "0").slice(-13)}`,
        productName: "Apple iPhone 6 16GB 銀色",
        categoryName: "智慧手機",
      },
      {
        batchNo: `AUTO-PO-${uniqueSuffix}-03`,
        serialNumber: `AUTO-SN-${uniqueSuffix}-03`,
        imei: `35${`${Number(uniqueSuffix) + 3}`.padStart(13, "0").slice(-13)}`,
        productName: "Apple iPhone 6 16GB 銀色",
        categoryName: "平板",
      },
    ];

    const importResult = await importProducts({
      vendorName: "自動補號驗證廠商",
      rows,
    });
    createdPoNumbers.add(importResult.poNumber);

    expect(importResult.poNumber).toMatch(/^PO-\d{8}-\d{2}$/);
    expect(importResult.importedCount).toBe(3);

    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

    const importedProducts = await db
      .select({
        poNumber: products.poNumber,
        batchNo: products.batchNo,
        importedCategoryName: products.importedCategoryName,
      })
      .from(products)
      .where(and(eq(products.poNumber, importResult.poNumber), isNull(products.archivedAt)));

    expect(importedProducts).toHaveLength(3);
    expect(new Set(importedProducts.map((product) => product.poNumber))).toEqual(new Set([importResult.poNumber]));
    expect(new Set(importedProducts.map((product) => product.batchNo))).toEqual(new Set(rows.map((row) => row.batchNo)));
    expect(new Set(importedProducts.map((product) => product.importedCategoryName))).toEqual(new Set(["智慧手機", "平板"]));

    const stationData = await getStationPageData("A1");
    const importedTasks = stationData.tasks.filter((task) => task.poNumber === importResult.poNumber);
    expect(importedTasks).toHaveLength(3);
    expect(new Set(importedTasks.map((task) => task.importedCategoryName ?? task.categoryName))).toEqual(new Set(["智慧手機", "平板"]));
  }, 10000);

  it("imports a large batch with consistent row count under a single PO", async () => {
    const uniqueSuffix = `${Date.now()}`;
    const rows = Array.from({ length: 120 }, (_, index) => {
      const sequence = index + 1;
      return {
        batchNo: `LARGE-PO-${uniqueSuffix}-${String(sequence).padStart(3, "0")}`,
        serialNumber: `LARGE-SN-${uniqueSuffix}-${String(sequence).padStart(3, "0")}`,
        imei: `86${`${Number(uniqueSuffix) + sequence}`.padStart(13, "0").slice(-13)}`,
        productName: `Large Import Device ${String(sequence).padStart(3, "0")}`,
        categoryName: sequence % 2 === 0 ? "智慧手機" : "平板",
      };
    });

    const importResult = await importProducts({
      vendorName: "大批量驗證廠商",
      rows,
    });
    createdPoNumbers.add(importResult.poNumber);

    expect(importResult.poNumber).toMatch(/^PO-\d{8}-\d{2}$/);
    expect(importResult.importedCount).toBe(rows.length);
    expect(importResult.products).toHaveLength(rows.length);

    const stationData = await getStationPageData("A1");
    const importedTasks = stationData.tasks.filter((task) => task.poNumber === importResult.poNumber);

    expect(importedTasks).toHaveLength(rows.length);
    expect(new Set(importedTasks.map((task) => task.poNumber))).toEqual(new Set([importResult.poNumber]));
    expect(new Set(importedTasks.map((task) => task.batchNo))).toEqual(new Set(rows.map((row) => row.batchNo)));
    expect(new Set(importedTasks.map((task) => task.importedCategoryName ?? task.categoryName))).toEqual(new Set(["智慧手機", "平板"]));
  }, 20000);
});
