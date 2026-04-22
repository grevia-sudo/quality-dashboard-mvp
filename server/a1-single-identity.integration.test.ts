import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { productArchives, products, sheetSyncJobs, stationTasks } from "../drizzle/schema";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(() => ({
    unref: vi.fn(),
  })),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

import { completeA1ArrivalByScan, ensureMvpSeedData, getDb, getStationPageData, importProducts } from "./db";

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
        categoryName: "智慧手機",
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
    expect(result.categoryName).toBe("智慧手機");

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

  it("writes productName back to the product record when A1 scan includes a selected name", async () => {
    const seed = Date.now();
    const serialNumber = `WITH-NAME-${seed}`;
    const selectedProductName = "Apple iPhone 6 16GB 銀色";
    const { importedProduct } = await importSingleIdentityRow({
      poNumber: `TEST-A1-NAME-${seed}`,
      row: {
        serialNumber,
        categoryName: "智慧手機",
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
        categoryName: "智慧手機",
        productName: "Serial Only Device",
      },
    });

    const result = await completeA1ArrivalByScan({
      operatorUserId: 1,
      serialNumber,
    });

    expect(result.success).toBe(true);
    expect(result.productId).toBe(importedProduct.id);
    expect(result.categoryName).toBe("智慧手機");

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
        categoryName: "平板",
        productName: "Batch Only Device",
      },
    });

    const result = await completeA1ArrivalByScan({
      operatorUserId: 1,
      batchNo,
    });

    expect(result.success).toBe(true);
    expect(result.productId).toBe(importedProduct.id);
    expect(result.categoryName).toBe("平板");

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
        categoryName: "智慧手機",
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
