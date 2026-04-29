import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { productArchives, productCategories, products, sheetSyncJobs, stationTasks } from "../drizzle/schema";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(() => ({
    unref: vi.fn(),
  })),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

import { completeA1ArrivalByScan, completeStationTask, ensureMvpSeedData, getDb, getStationPageData, importProducts } from "./db";

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

function uniqueDigits(seed: number, length: number) {
  return `${seed}`.padStart(length, "0").slice(-length);
}

async function waitForQueuedJobTypes(expectedJobTypes: string[]) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const queuedJobs = await db
      .select({
        jobType: sheetSyncJobs.jobType,
        status: sheetSyncJobs.status,
      })
      .from(sheetSyncJobs)
      .where(eq(sheetSyncJobs.status, "queued"));

    if (expectedJobTypes.every((jobType) => queuedJobs.some((job) => job.jobType === jobType))) {
      return queuedJobs;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for queued jobs: ${expectedJobTypes.join(", ")}`);
}

async function importSingleIdentityRow(input: {
  poNumber: string;
  row: {
    batchNo?: string;
    serialNumber?: string;
    imei?: string;
    categoryName: string;
    brandName: string;
    productName: string;
  };
}) {
  const importResult = await importProducts({
    poNumber: input.poNumber,
    vendorName: "A1 單識別碼驗證廠商",
    rows: [input.row],
  });

  createdPoNumbers.add(importResult.poNumber);

  const importedProductId = importResult.products[0]?.id;
  if (!importedProductId) {
    throw new Error("Imported product id not found");
  }

  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  const importedProduct = await db
    .select()
    .from(products)
    .where(eq(products.id, importedProductId))
    .limit(1);

  if (!importedProduct[0]) {
    throw new Error("Imported product not found");
  }

  return {
    importResult,
    importedProduct: importedProduct[0],
  };
}

async function getPendingTaskSnapshot(productId: number, stationCode: "A2" | "B" | "C" | "D" | "E" | "STOCK") {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const rows = await db
      .select({
        taskId: stationTasks.id,
        productId: stationTasks.productId,
        categoryId: products.categoryId,
        subtypeCode: productCategories.subtypeCode,
      })
      .from(stationTasks)
      .innerJoin(products, eq(stationTasks.productId, products.id))
      .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
      .where(and(eq(stationTasks.productId, productId), eq(stationTasks.stationCode, stationCode), eq(stationTasks.taskStatus, "pending")))
      .limit(1);

    if (rows[0]) {
      return rows[0];
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return null;
}

describe("A1 single-identity scan integration", () => {
  beforeAll(async () => {
    await ensureMvpSeedData();
  });

  afterAll(async () => {
    await archiveCreatedImportTestRows();
  });

  it("matches and completes A1 with only IMEI, keeping other identities empty", async () => {
    const seed = Date.now();
    const imei = `35${uniqueDigits(seed + 1, 13)}`;
    const { importedProduct } = await importSingleIdentityRow({
      poNumber: `TEST-A1-IMEI-${seed}`,
      row: {
        imei,
         categoryName: "智慧型手機",
        brandName: "Apple",
        productName: "IMEI Only Device",
      },
    });

    const result = await completeA1ArrivalByScan({
      operatorUserId: 1,
      imei,
    });

    expect(result.success).toBe(true);
    expect(result.productId).toBe(importedProduct.id);
    expect(result.poNumber).toBe(importedProduct.poNumber);
    expect(result.vendorName).toBe("A1 單識別碼驗證廠商");
    expect(result.categoryName).toBe("智慧型手機");

    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

    const refreshedProduct = await db
      .select({
        id: products.id,
        batchNo: products.batchNo,
        serialNumber: products.serialNumber,
        imei: products.imei,
        currentStationCode: products.currentStationCode,
        currentStatus: products.currentStatus,
      })
      .from(products)
      .where(eq(products.id, importedProduct.id))
      .limit(1);

    const a1Task = await db
      .select({
        taskStatus: stationTasks.taskStatus,
        completedAt: stationTasks.completedAt,
      })
      .from(stationTasks)
      .where(and(eq(stationTasks.productId, importedProduct.id), eq(stationTasks.stationCode, "A1")))
      .orderBy(stationTasks.id)
      .limit(1);

    const a2Task = await db
      .select({
        taskStatus: stationTasks.taskStatus,
      })
      .from(stationTasks)
      .where(and(eq(stationTasks.productId, importedProduct.id), eq(stationTasks.stationCode, "A2")))
      .orderBy(stationTasks.id)
      .limit(1);

    const queuedJobs = await waitForQueuedJobTypes(["station_task_sync", "purchase_sheet_sync"]);

    expect(refreshedProduct[0]).toMatchObject({
      id: importedProduct.id,
      batchNo: null,
      serialNumber: null,
      imei,
      currentStationCode: "A2",
      currentStatus: "pending_a2",
    });
    expect(a1Task[0]?.taskStatus).toBe("completed");
    expect(a1Task[0]?.completedAt).toBeInstanceOf(Date);
    expect(a2Task[0]?.taskStatus).toBe("pending");
    expect(queuedJobs.some((job) => job.jobType === "station_task_sync")).toBe(true);
    expect(queuedJobs.some((job) => job.jobType === "purchase_sheet_sync")).toBe(true);
  }, 10000);

  it("creates a flow item when A1 has no imported row yet, and later import patches metadata without resetting the station", async () => {
    const seed = Date.now();
    const batchNo = `NO-IMPORT-BATCH-${seed}`;
    const serialNumber = `NO-IMPORT-SN-${seed}`;
    const imei = `93${uniqueDigits(seed + 1, 13)}`;
    const productName = "No Import Flow Device";

    const receiveResult = await completeA1ArrivalByScan({
      operatorUserId: 1,
      batchNo,
      serialNumber,
      imei,
      productName,
    });

    expect(receiveResult.success).toBe(true);
    expect(receiveResult.poNumber ?? null).toBeNull();

    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

    const beforeImport = await db
      .select({
        id: products.id,
        poNumber: products.poNumber,
        vendorName: products.vendorName,
        importedCategoryName: products.importedCategoryName,
        importedBrandName: products.importedBrandName,
        currentStationCode: products.currentStationCode,
        currentStatus: products.currentStatus,
      })
      .from(products)
      .where(eq(products.id, receiveResult.productId ?? 0))
      .limit(1);

    expect(beforeImport[0]).toMatchObject({
      poNumber: null,
      vendorName: null,
      importedCategoryName: null,
      importedBrandName: null,
      currentStationCode: "A2",
      currentStatus: "pending_a2",
    });

    const manualImportPo = `PO-NO-IMPORT-${seed}`;
    const importResult = await importProducts({
      poNumber: manualImportPo,
      vendorName: "後補匯入廠商",
      rows: [{
        batchNo,
        serialNumber,
        imei,
        productName,
        categoryName: "智慧型手機",
        brandName: "Apple",
      }],
    });
    createdPoNumbers.add(importResult.poNumber);

    const afterImport = await db
      .select({
        id: products.id,
        poNumber: products.poNumber,
        vendorName: products.vendorName,
        importedCategoryName: products.importedCategoryName,
        importedBrandName: products.importedBrandName,
        currentStationCode: products.currentStationCode,
        currentStatus: products.currentStatus,
      })
      .from(products)
      .where(eq(products.id, receiveResult.productId ?? 0))
      .limit(1);

    const a1Tasks = await db
      .select({
        taskStatus: stationTasks.taskStatus,
      })
      .from(stationTasks)
      .where(and(eq(stationTasks.productId, receiveResult.productId ?? 0), eq(stationTasks.stationCode, "A1")));

    const a2Tasks = await db
      .select({
        taskStatus: stationTasks.taskStatus,
      })
      .from(stationTasks)
      .where(and(eq(stationTasks.productId, receiveResult.productId ?? 0), eq(stationTasks.stationCode, "A2")));

    expect(importResult.products[0]?.id).toBe(receiveResult.productId);
    expect(afterImport[0]).toMatchObject({
      poNumber: manualImportPo,
      vendorName: "後補匯入廠商",
      importedCategoryName: "智慧型手機",
      importedBrandName: "Apple",
      currentStationCode: "A2",
      currentStatus: "pending_a2",
    });
    expect(a1Tasks.map((task) => task.taskStatus)).toContain("completed");
    expect(a1Tasks.map((task) => task.taskStatus)).not.toContain("pending");
    expect(a2Tasks.map((task) => task.taskStatus)).toContain("pending");
  }, 15000);

  it("allows no-import products to keep flowing until STOCK, but blocks stock-in before import matching is completed", async () => {
    const seed = Date.now();
    const batchNo = `FLOW-STOCK-BATCH-${seed}`;
    const serialNumber = `FLOW-STOCK-SN-${seed}`;
    const imei = `95${uniqueDigits(seed + 1, 13)}`;
    const productName = "No Import To Stock Device";

    const receiveResult = await completeA1ArrivalByScan({
      operatorUserId: 1,
      batchNo,
      serialNumber,
      imei,
      productName,
    });

    expect(receiveResult.success).toBe(true);
    const productId = receiveResult.productId ?? 0;

    for (const stationCode of ["A2", "B", "C", "D", "E"] as const) {
      const pendingTask = await getPendingTaskSnapshot(productId, stationCode);
      expect(pendingTask).not.toBeNull();

      const completeResult = await completeStationTask({
        taskId: pendingTask?.taskId ?? 0,
        stationCode,
        operatorUserId: 1,
        productId,
        categoryId: pendingTask?.categoryId ?? null,
        subtypeCode: pendingTask?.subtypeCode ?? null,
        summary: `${stationCode} 測試完成`,
      });

      expect(completeResult.success).toBe(true);
    }

    const stockTaskBeforeImport = await getPendingTaskSnapshot(productId, "STOCK");
    expect(stockTaskBeforeImport).not.toBeNull();

    const blockedStockResult = await completeStationTask({
      taskId: stockTaskBeforeImport?.taskId ?? 0,
      stationCode: "STOCK",
      operatorUserId: 1,
      productId,
      categoryId: stockTaskBeforeImport?.categoryId ?? null,
      subtypeCode: stockTaskBeforeImport?.subtypeCode ?? null,
      summary: "待入庫完成前檢查",
    });

    expect(blockedStockResult.success).toBe(false);
    expect(blockedStockResult.message).toContain("尚未完成匯入比對");

    const manualImportPo = `PO-STOCK-BLOCK-${seed}`;
    const importResult = await importProducts({
      poNumber: manualImportPo,
      vendorName: "待入庫前補匯入廠商",
      rows: [{
        batchNo,
        serialNumber,
        imei,
        productName,
        categoryName: "智慧型手機",
        brandName: "Apple",
      }],
    });
    createdPoNumbers.add(importResult.poNumber);

    const stockTaskAfterImport = await getPendingTaskSnapshot(productId, "STOCK");
    expect(stockTaskAfterImport).not.toBeNull();

    const completedStockResult = await completeStationTask({
      taskId: stockTaskAfterImport?.taskId ?? 0,
      stationCode: "STOCK",
      operatorUserId: 1,
      productId,
      categoryId: stockTaskAfterImport?.categoryId ?? null,
      subtypeCode: stockTaskAfterImport?.subtypeCode ?? null,
      summary: "補匯入後完成待入庫",
    });

    expect(completedStockResult.success).toBe(true);

    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

    const finalProduct = await db
      .select({
        poNumber: products.poNumber,
        currentStationCode: products.currentStationCode,
        currentStatus: products.currentStatus,
        stockStatus: products.stockStatus,
      })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);

    expect(finalProduct[0]).toMatchObject({
      poNumber: manualImportPo,
      currentStationCode: "STOCK",
      currentStatus: "completed",
      stockStatus: "stocked",
    });
  }, 30000);

  it("writes productName back to the product record when A1 scan includes a selected name", async () => {
    const seed = Date.now();
    const serialNumber = `WITH-NAME-${seed}`;
    const selectedProductName = "Apple iPhone 6 16GB 銀色";
    const { importedProduct } = await importSingleIdentityRow({
      poNumber: `TEST-A1-NAME-${seed}`,
      row: {
        serialNumber,
        categoryName: "智慧型手機",
        brandName: "Apple",
        productName: "",
      },
    });

    const result = await completeA1ArrivalByScan({
      operatorUserId: 1,
      serialNumber,
      productName: selectedProductName,
    });

    expect(result.success).toBe(true);
    expect(result.productId).toBe(importedProduct.id);

    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

    const refreshedProduct = await db
      .select({
        serialNumber: products.serialNumber,
        productName: products.productName,
        currentStationCode: products.currentStationCode,
        currentStatus: products.currentStatus,
      })
      .from(products)
      .where(eq(products.id, importedProduct.id))
      .limit(1);

    expect(refreshedProduct[0]).toMatchObject({
      serialNumber,
      productName: selectedProductName,
      currentStationCode: "A2",
      currentStatus: "pending_a2",
    });
  }, 10000);

  it("matches and completes A1 with only serial number, keeping other identities empty", async () => {
    const seed = Date.now();
    const serialNumber = `ONLY-SN-${seed}`;
    const { importedProduct } = await importSingleIdentityRow({
      poNumber: `TEST-A1-SN-${seed}`,
      row: {
        serialNumber,
        categoryName: "智慧型手機",
        brandName: "Apple",
        productName: "Serial Only Device",
      },
    });

    const result = await completeA1ArrivalByScan({
      operatorUserId: 1,
      serialNumber,
    });

    expect(result.success).toBe(true);
    expect(result.productId).toBe(importedProduct.id);
    expect(result.categoryName).toBe("智慧型手機");

    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

    const refreshedProduct = await db
      .select({
        batchNo: products.batchNo,
        serialNumber: products.serialNumber,
        imei: products.imei,
        currentStationCode: products.currentStationCode,
        currentStatus: products.currentStatus,
      })
      .from(products)
      .where(eq(products.id, importedProduct.id))
      .limit(1);

    const a1Task = await db
      .select({
        taskStatus: stationTasks.taskStatus,
        completedAt: stationTasks.completedAt,
      })
      .from(stationTasks)
      .where(and(eq(stationTasks.productId, importedProduct.id), eq(stationTasks.stationCode, "A1")))
      .orderBy(stationTasks.id)
      .limit(1);

    expect(refreshedProduct[0]).toMatchObject({
      batchNo: null,
      serialNumber,
      imei: null,
      currentStationCode: "A2",
      currentStatus: "pending_a2",
    });
    expect(a1Task[0]?.taskStatus).toBe("completed");
    expect(a1Task[0]?.completedAt).toBeInstanceOf(Date);
  }, 10000);

  it("matches and completes A1 with only batch number, keeping other identities empty", async () => {
    const seed = Date.now();
    const batchNo = `ONLY-BATCH-${seed}`;
    const { importedProduct } = await importSingleIdentityRow({
      poNumber: `TEST-A1-BATCH-${seed}`,
      row: {
        batchNo,
        categoryName: "智慧型手機",
        brandName: "Apple",
        productName: "Batch Only Device",
      },
    });

    const result = await completeA1ArrivalByScan({
      operatorUserId: 1,
      batchNo,
    });

    expect(result.success).toBe(true);
    expect(result.productId).toBe(importedProduct.id);
    expect(result.categoryName).toBe("智慧型手機");

    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

    const refreshedProduct = await db
      .select({
        batchNo: products.batchNo,
        serialNumber: products.serialNumber,
        imei: products.imei,
        currentStationCode: products.currentStationCode,
        currentStatus: products.currentStatus,
      })
      .from(products)
      .where(eq(products.id, importedProduct.id))
      .limit(1);

    const a1Task = await db
      .select({
        taskStatus: stationTasks.taskStatus,
        completedAt: stationTasks.completedAt,
      })
      .from(stationTasks)
      .where(and(eq(stationTasks.productId, importedProduct.id), eq(stationTasks.stationCode, "A1")))
      .orderBy(stationTasks.id)
      .limit(1);

    expect(refreshedProduct[0]).toMatchObject({
      batchNo,
      serialNumber: null,
      imei: null,
      currentStationCode: "A2",
      currentStatus: "pending_a2",
    });
    expect(a1Task[0]?.taskStatus).toBe("completed");
    expect(a1Task[0]?.completedAt).toBeInstanceOf(Date);
  }, 10000);

  it("keeps A1 station detail free of products already moved to A2 even before background task cleanup finishes", async () => {
    const seed = Date.now();
    const serialNumber = `A1-GHOST-${uniqueDigits(seed, 10)}`;
    const { importedProduct } = await importSingleIdentityRow({
      poNumber: `TEST-A1-GHOST-${seed}`,
      row: {
        serialNumber,
        categoryName: "智慧型手機",
        brandName: "Apple",
        productName: "Ghost Guard Device",
      },
    });

    const result = await completeA1ArrivalByScan({
      operatorUserId: 1,
      serialNumber,
    });

    expect(result.success).toBe(true);

    const stationData = await getStationPageData("A1");
    expect(stationData.tasks.some((task) => task.productId === importedProduct.id)).toBe(false);
  }, 10000);

  it("does not spawn duplicate background sync processes during these assertions", () => {
    expect(spawnMock).toHaveBeenCalled();
  });
});
