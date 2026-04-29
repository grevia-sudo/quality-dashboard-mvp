import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { importBatchBackups, products, stationEvents, stationTasks, users } from "../drizzle/schema";
import {
  completeA1ArrivalByScan,
  completeStationTask,
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

async function getActorUser() {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  const firstUser = (await db.select({ id: users.id, name: users.name }).from(users).limit(1))[0];
  if (!firstUser?.id) {
    throw new Error("No seeded user found for integration tests");
  }

  return firstUser;
}

async function getActorUserId() {
  const actor = await getActorUser();
  return actor.id;
}

async function getLatestPendingTaskId(productId: number, stationCode: "A2" | "B" | "C" | "D" | "E" | "STOCK") {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  const pendingTask = (await db
    .select({ id: stationTasks.id })
    .from(stationTasks)
    .where(and(
      eq(stationTasks.productId, productId),
      eq(stationTasks.stationCode, stationCode),
      eq(stationTasks.taskStatus, "pending"),
    ))
    .orderBy(desc(stationTasks.id))
    .limit(1))[0];

  return pendingTask?.id ?? null;
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
          categoryName: "智慧型手機",
          brandName: "Apple",
        },
        {
          batchNo: `BACKUP-BATCH-${uniqueSuffix}-02`,
          serialNumber: `BACKUP-SN-${uniqueSuffix}-02`,
          imei: `86${`${Number(uniqueSuffix) + 2}`.padStart(13, "0").slice(-13)}`,
          productName: "Backup Device 02",
          categoryName: "智慧型手機",
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
    const backupSummary = backupList.find((item) => item.poNumber === importResult.poNumber);
    expect(backupSummary).toBeTruthy();
    expect(backupSummary?.previewCount).toBe(2);
    expect(backupSummary?.previewOverflowCount).toBe(0);
    expect(backupSummary?.previewRows).toHaveLength(2);
    expect(backupSummary?.previewRows[0]).toMatchObject({
      batchNo: `BACKUP-BATCH-${uniqueSuffix}-01`,
      serialNumber: `BACKUP-SN-${uniqueSuffix}-01`,
      categoryName: "智慧型手機",
      brandName: "Apple",
    });
    expect(backupSummary?.diffSummary).toMatchObject({
      currentLiveCount: 2,
      matchedCount: 2,
      missingFromCurrentCount: 0,
      extraInCurrentCount: 0,
      progressedCount: 0,
    });

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

  it("calculates backup diff summary when current rows diverge from the saved snapshot", async () => {
    const actorUserId = await getActorUserId();
    const uniqueSuffix = `${Date.now()}`;
    const poNumber = `PO-BACKUP-DIFF-${uniqueSuffix}`;
    const imported = await importProducts({
      poNumber,
      vendorName: "差異驗證廠商",
      rows: [
        {
          batchNo: `DIFF-BATCH-${uniqueSuffix}-01`,
          serialNumber: `DIFF-SN-${uniqueSuffix}-01`,
          imei: `89${`${Number(uniqueSuffix) + 1}`.padStart(13, "0").slice(-13)}`,
          productName: "Diff Device 01",
          categoryName: "智慧型手機",
          brandName: "Apple",
        },
        {
          batchNo: `DIFF-BATCH-${uniqueSuffix}-02`,
          serialNumber: `DIFF-SN-${uniqueSuffix}-02`,
          imei: `89${`${Number(uniqueSuffix) + 2}`.padStart(13, "0").slice(-13)}`,
          productName: "Diff Device 02",
          categoryName: "智慧型手機",
          brandName: "Apple",
        },
        {
          batchNo: `DIFF-BATCH-${uniqueSuffix}-03`,
          serialNumber: `DIFF-SN-${uniqueSuffix}-03`,
          imei: `89${`${Number(uniqueSuffix) + 3}`.padStart(13, "0").slice(-13)}`,
          productName: "Diff Device 03",
          categoryName: "智慧型手機",
          brandName: "Apple",
        },
        {
          batchNo: `DIFF-BATCH-${uniqueSuffix}-04`,
          serialNumber: `DIFF-SN-${uniqueSuffix}-04`,
          imei: `89${`${Number(uniqueSuffix) + 4}`.padStart(13, "0").slice(-13)}`,
          productName: "Diff Device 04",
          categoryName: "智慧型手機",
          brandName: "Apple",
        },
        {
          batchNo: `DIFF-BATCH-${uniqueSuffix}-05`,
          serialNumber: `DIFF-SN-${uniqueSuffix}-05`,
          imei: `89${`${Number(uniqueSuffix) + 5}`.padStart(13, "0").slice(-13)}`,
          productName: "Diff Device 05",
          categoryName: "智慧型手機",
          brandName: "Apple",
        },
        {
          batchNo: `DIFF-BATCH-${uniqueSuffix}-06`,
          serialNumber: `DIFF-SN-${uniqueSuffix}-06`,
          imei: `89${`${Number(uniqueSuffix) + 6}`.padStart(13, "0").slice(-13)}`,
          productName: "Diff Device 06",
          categoryName: "智慧型手機",
          brandName: "Apple",
        },
      ],
    });
    createdPoNumbers.add(imported.poNumber);

    await createImportBatchBackup({
      poNumber: imported.poNumber,
      createdByUserId: actorUserId,
      backupLabel: "差異快照",
    });

    await completeA1ArrivalByScan({
      operatorUserId: actorUserId,
      batchNo: `DIFF-BATCH-${uniqueSuffix}-01`,
      serialNumber: `DIFF-SN-${uniqueSuffix}-01`,
      productName: "Diff Device 01",
    });

    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

    await db
      .update(products)
      .set({
        batchNo: `DIFF-BATCH-${uniqueSuffix}-EXTRA`,
        serialNumber: `DIFF-SN-${uniqueSuffix}-EXTRA`,
        imei: `89${`${Number(uniqueSuffix) + 9}`.padStart(13, "0").slice(-13)}`,
      })
      .where(and(eq(products.poNumber, imported.poNumber), eq(products.batchNo, `DIFF-BATCH-${uniqueSuffix}-06`)));

    const backupList = await getImportBatchBackups();
    const backupSummary = backupList.find((item) => item.poNumber === imported.poNumber);
    expect(backupSummary?.previewCount).toBe(6);
    expect(backupSummary?.previewRows).toHaveLength(5);
    expect(backupSummary?.previewOverflowCount).toBe(1);
    expect(backupSummary?.diffSummary).toMatchObject({
      currentLiveCount: 6,
      matchedCount: 5,
      missingFromCurrentCount: 1,
      extraInCurrentCount: 1,
      progressedCount: 1,
    });
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
          categoryName: "智慧型手機",
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

  it("returns complete product trace results for batch or serial lookups, including timeline ordering, events, empty results, and inventory movement metadata", async () => {
    const actor = await getActorUser();
    const actorUserId = actor.id;
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
          categoryName: "智慧型手機",
          brandName: "Apple",
        },
        {
          batchNo: `TRACE-BATCH-${uniqueSuffix}-02`,
          serialNumber: sharedSerial,
          imei: `88${`${Number(uniqueSuffix) + 2}`.padStart(13, "0").slice(-13)}`,
          productName: null,
          categoryName: "智慧型手機",
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

    const tracedProductId = batchMatch[0]?.id ?? 0;
    for (const stationCode of ["A2", "B", "C", "D", "E"] as const) {
      const pendingTaskId = await getLatestPendingTaskId(tracedProductId, stationCode);
      expect(pendingTaskId).toBeTruthy();

      const completeResult = await completeStationTask({
        taskId: pendingTaskId ?? 0,
        stationCode,
        operatorUserId: actorUserId,
        productId: tracedProductId,
        summary: `${stationCode} 測試完成`,
      });

      expect(completeResult.success).toBe(true);
    }

    const stockTaskId = await getLatestPendingTaskId(tracedProductId, "STOCK");
    expect(stockTaskId).toBeTruthy();

    const completeStockResult = await completeStationTask({
      taskId: stockTaskId ?? 0,
      stationCode: "STOCK",
      operatorUserId: actorUserId,
      productId: tracedProductId,
      summary: "待入庫完成",
    });

    expect(completeStockResult.success).toBe(true);

    const [movementTrace] = await getProductTraceByIdentity(`TRACE-BATCH-${uniqueSuffix}-01`);
    expect(movementTrace?.inventoryMovement.importedAt).toBeTruthy();
    expect(movementTrace?.inventoryMovement.importSummary).toContain("匯入建立");
    expect(movementTrace?.inventoryMovement.importedOperatorName).toBeNull();
    expect(movementTrace?.inventoryMovement.pendingStockAt).toBeTruthy();
    expect(movementTrace?.inventoryMovement.pendingStockSummary).toContain("E 測試完成");
    expect(movementTrace?.inventoryMovement.pendingStockOperatorName).toBe(actor.name);
    expect(movementTrace?.inventoryMovement.stockedAt).toBeTruthy();
    expect(movementTrace?.inventoryMovement.stockedSummary).toContain("待入庫完成");
    expect(movementTrace?.inventoryMovement.stockedOperatorName).toBe(actor.name);
  }, 30000);
});
