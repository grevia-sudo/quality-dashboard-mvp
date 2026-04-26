import { and, eq, inArray, isNull } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { importBatchBackups, products, stationEvents, stationTasks, users } from "../drizzle/schema";
import {
  completeA1ArrivalByScan,
  createImportBatchBackup,
  deleteImportedPurchaseOrder,
  ensureMvpSeedData,
  getDb,
  getImportBatchBackups,
  getProductTraceByIdentity,
  importProducts,
  restoreImportBatchBackup,
} from "./db";

const createdPoNumbers = new Set<string>();

async function getActorUserId() {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  const firstUser = (await db.select({ id: users.id }).from(users).limit(1))[0];
  if (!firstUser?.id) {
    throw new Error("No seeded user found for integration tests");
  }

  return firstUser.id;
}

async function cleanupCreatedRows() {
  const db = await getDb();
  if (!db) {
    return;
  }

  const poNumbers = Array.from(createdPoNumbers);
  for (const poNumber of poNumbers) {
    try {
      await deleteImportedPurchaseOrder(poNumber);
    } catch {
      // ignore cleanup failures for already-deleted rows
    }
  }

  if (poNumbers.length > 0) {
    await db.delete(importBatchBackups).where(inArray(importBatchBackups.poNumber, poNumbers));
  }

  createdPoNumbers.clear();
}

describe("admin backup and product trace integration", () => {
  beforeAll(async () => {
    await ensureMvpSeedData();
  });

  afterEach(async () => {
    await cleanupCreatedRows();
  });

  it("creates a reusable import backup snapshot and restores products plus pending A1 tasks", async () => {
    const actorUserId = await getActorUserId();
    const uniqueSuffix = `${Date.now()}`;
    const poNumber = `PO-BACKUP-${uniqueSuffix}`;
    const importResult = await importProducts({
      poNumber,
      vendorName: "備份驗證廠商",
      arrivalAt: "2026-04-26T09:30",
      rows: [
        {
          batchNo: `BACKUP-BATCH-${uniqueSuffix}-01`,
          serialNumber: `BACKUP-SN-${uniqueSuffix}-01`,
          imei: `86${`${Number(uniqueSuffix) + 1}`.padStart(13, "0").slice(-13)}`,
          productName: "Backup Device 01",
          categoryName: "智慧手機",
          brandName: "Apple",
        },
        {
          batchNo: `BACKUP-BATCH-${uniqueSuffix}-02`,
          serialNumber: `BACKUP-SN-${uniqueSuffix}-02`,
          imei: `86${`${Number(uniqueSuffix) + 2}`.padStart(13, "0").slice(-13)}`,
          productName: "Backup Device 02",
          categoryName: "智慧手機",
          brandName: "Apple",
        },
      ],
    });
    createdPoNumbers.add(importResult.poNumber);

    const backup = await createImportBatchBackup({
      poNumber: importResult.poNumber,
      createdByUserId: actorUserId,
      backupLabel: "上傳前快照",
    });

    expect(backup?.poNumber).toBe(importResult.poNumber);
    expect((backup?.snapshot as { rows?: unknown[] })?.rows).toHaveLength(2);

    const backupList = await getImportBatchBackups();
    expect(backupList.some((item) => item.poNumber === importResult.poNumber)).toBe(true);

    const deleted = await deleteImportedPurchaseOrder(importResult.poNumber);
    expect(deleted.deletedProducts).toBe(2);

    const restoreResult = await restoreImportBatchBackup({
      backupId: backup?.id ?? 0,
      restoredByUserId: actorUserId,
    });

    expect(restoreResult.restoredCount).toBe(2);

    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

    const restoredProducts = await db
      .select({
        id: products.id,
        poNumber: products.poNumber,
        batchNo: products.batchNo,
        currentStationCode: products.currentStationCode,
        currentStatus: products.currentStatus,
      })
      .from(products)
      .where(and(eq(products.poNumber, importResult.poNumber), isNull(products.archivedAt)));

    const restoredTasks = await db
      .select({
        id: stationTasks.id,
        productId: stationTasks.productId,
        stationCode: stationTasks.stationCode,
        taskStatus: stationTasks.taskStatus,
      })
      .from(stationTasks)
      .where(inArray(stationTasks.productId, restoredProducts.map((product) => product.id)));

    expect(restoredProducts).toHaveLength(2);
    expect(new Set(restoredProducts.map((product) => product.currentStationCode))).toEqual(new Set(["A1"]));
    expect(new Set(restoredProducts.map((product) => product.currentStatus))).toEqual(new Set(["pending_a1"]));
    expect(restoredTasks).toHaveLength(2);
    expect(new Set(restoredTasks.map((task) => `${task.stationCode}:${task.taskStatus}`))).toEqual(new Set(["A1:pending"]));

    await expect(restoreImportBatchBackup({
      backupId: backup?.id ?? 0,
      restoredByUserId: actorUserId,
    })).rejects.toThrow("目前資料庫已存在相同 PO 單號資料");
  }, 15000);

  it("handles backup edge cases for missing PO, progressed batches, and missing backup ids", async () => {
    const actorUserId = await getActorUserId();
    const uniqueSuffix = `${Date.now()}`;
    const poNumber = `PO-BACKUP-EDGE-${uniqueSuffix}`;
    const batchNo = `EDGE-BATCH-${uniqueSuffix}`;
    const serialNumber = `EDGE-SN-${uniqueSuffix}`;

    await expect(createImportBatchBackup({
      poNumber: `PO-NOT-FOUND-${uniqueSuffix}`,
      createdByUserId: actorUserId,
    })).rejects.toThrow("找不到可備份的採購單資料");

    const importResult = await importProducts({
      poNumber,
      vendorName: "邊界驗證廠商",
      rows: [
        {
          batchNo,
          serialNumber,
          imei: `87${`${Number(uniqueSuffix) + 1}`.padStart(13, "0").slice(-13)}`,
          productName: "Edge Device",
          categoryName: "智慧手機",
          brandName: "Apple",
        },
      ],
    });
    createdPoNumbers.add(importResult.poNumber);

    const firstBackup = await createImportBatchBackup({
      poNumber: importResult.poNumber,
      createdByUserId: actorUserId,
      backupLabel: "第一次備份",
    });
    const secondBackup = await createImportBatchBackup({
      poNumber: importResult.poNumber,
      createdByUserId: actorUserId,
      backupLabel: "第二次備份",
    });

    expect(secondBackup?.id).toBeGreaterThan(firstBackup?.id ?? 0);

    await completeA1ArrivalByScan({
      operatorUserId: actorUserId,
      batchNo,
      serialNumber,
      productName: "Edge Device",
    });

    await expect(createImportBatchBackup({
      poNumber: importResult.poNumber,
      createdByUserId: actorUserId,
    })).rejects.toThrow("目前僅支援備份尚未開始流轉的匯入批次");

    await expect(restoreImportBatchBackup({
      backupId: 999999999,
      restoredByUserId: actorUserId,
    })).rejects.toThrow("找不到指定備份");
  }, 15000);

  it("returns complete product trace results for batch or serial lookups, including timeline ordering, events, and empty results", async () => {
    const actorUserId = await getActorUserId();
    const uniqueSuffix = `${Date.now()}`;
    const sharedSerial = `TRACE-SN-${uniqueSuffix}`;
    const importResult = await importProducts({
      poNumber: `PO-TRACE-${uniqueSuffix}`,
      vendorName: "追蹤驗證廠商",
      rows: [
        {
          batchNo: `TRACE-BATCH-${uniqueSuffix}-01`,
          serialNumber: sharedSerial,
          imei: `88${`${Number(uniqueSuffix) + 1}`.padStart(13, "0").slice(-13)}`,
          productName: "Trace Device 01",
          categoryName: "智慧手機",
          brandName: "Apple",
        },
        {
          batchNo: `TRACE-BATCH-${uniqueSuffix}-02`,
          serialNumber: sharedSerial,
          imei: `88${`${Number(uniqueSuffix) + 2}`.padStart(13, "0").slice(-13)}`,
          productName: null,
          categoryName: "智慧手機",
          brandName: "Apple",
        },
      ],
    });
    createdPoNumbers.add(importResult.poNumber);

    await completeA1ArrivalByScan({
      operatorUserId: actorUserId,
      batchNo: `TRACE-BATCH-${uniqueSuffix}-01`,
      serialNumber: sharedSerial,
      productName: "Trace Device 01",
    });

    const serialMatches = await getProductTraceByIdentity(sharedSerial);
    const batchMatch = await getProductTraceByIdentity(`TRACE-BATCH-${uniqueSuffix}-01`);
    const emptyMatch = await getProductTraceByIdentity(`TRACE-NOT-FOUND-${uniqueSuffix}`);

    expect(serialMatches.length).toBeGreaterThanOrEqual(2);
    expect(batchMatch).toHaveLength(1);
    expect(emptyMatch).toEqual([]);

    const [firstMatch] = serialMatches;
    expect(firstMatch?.timeline.length).toBeGreaterThan(0);
    expect(firstMatch?.timeline.map((task) => task.id)).toEqual([...firstMatch?.timeline.map((task) => task.id) ?? []].sort((left, right) => left - right));
    expect(firstMatch?.events.map((event) => event.id)).toEqual([...firstMatch?.events.map((event) => event.id) ?? []].sort((left, right) => left - right));
    expect(serialMatches.some((product) => (product.events?.length ?? 0) > 0)).toBe(true);
    expect(serialMatches.some((product) => product.productName === null)).toBe(true);

    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

    const tracedProductIds = serialMatches.map((product) => product.id);
    const tracedEvents = await db
      .select({
        productId: stationEvents.productId,
        stationCode: stationEvents.stationCode,
      })
      .from(stationEvents)
      .where(inArray(stationEvents.productId, tracedProductIds));

    expect(tracedEvents.length).toBeGreaterThan(0);
    expect(new Set(batchMatch[0]?.timeline.map((task) => task.stationCode) ?? [])).toContain("A1");
  }, 15000);
});
