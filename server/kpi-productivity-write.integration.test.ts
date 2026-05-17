import { and, eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  engineerDailyProductivity,
  productCategories,
  productivityScoreDetails,
  productArchives,
  products,
  samplingResults,
  stationEvents,
  stationTasks,
  supportTaskCompensations,
  users,
} from "../drizzle/schema";
import { backfillProductivityFromCompletedEvents, completeStationTask, ensureMvpSeedData, getDb, importProducts, submitSamplingResult } from "./db";

const createdPoNumbers = new Set<string>();
const createdUserIds: number[] = [];
const originalFetch = global.fetch;

function createTestPhoto(fileName: string) {
  return {
    fileName,
    mimeType: "image/jpeg",
    dataUrl: "data:image/jpeg;base64,aGVsbG8=",
  };
}

function mockGooglePurchaseSheetBatches(batches: string[]) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({
        access_token: "fake-google-token",
        expires_in: 3600,
        token_type: "Bearer",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("sheets.googleapis.com")) {
      return new Response(JSON.stringify({
        values: [
          ["PO", "Vendor", "Arrived", "批號", "序號", "IMEI", "品名"],
          ...batches.map((batch, index) => [
            `PO-MOCK-${index + 1}`,
            "Mock Vendor",
            "",
            batch,
            `MOCK-SERIAL-${index + 1}`,
            "",
            `Mock Product ${index + 1}`,
          ]),
        ],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unexpected fetch URL in test: ${url}`);
  }) as typeof fetch;
}

async function cleanupCreatedRows() {
  const db = await getDb();
  if (!db) {
    return;
  }

  if (createdPoNumbers.size > 0) {
    const targetProducts = await db
      .select({ id: products.id })
      .from(products)
      .where(inArray(products.poNumber, Array.from(createdPoNumbers)));

    const productIds = targetProducts.map((row) => row.id);
    if (productIds.length > 0) {
      await db.delete(productivityScoreDetails).where(inArray(productivityScoreDetails.productId, productIds));
      await db.delete(samplingResults).where(inArray(samplingResults.productId, productIds));
      await db.delete(stationEvents).where(inArray(stationEvents.productId, productIds));
      await db.delete(stationTasks).where(inArray(stationTasks.productId, productIds));
      await db.delete(productArchives).where(inArray(productArchives.originalProductId, productIds));
      await db.delete(products).where(inArray(products.id, productIds));
    }

    createdPoNumbers.clear();
  }

  if (createdUserIds.length > 0) {
    await db.delete(engineerDailyProductivity).where(inArray(engineerDailyProductivity.userId, createdUserIds));
      await db.delete(productivityScoreDetails).where(inArray(productivityScoreDetails.userId, createdUserIds));
    await db.delete(users).where(inArray(users.id, createdUserIds));
    createdUserIds.length = 0;
  }
}

afterEach(async () => {
  await cleanupCreatedRows();
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("station productivity persistence", () => {
  it("writes productivity detail and daily aggregate after completing a station task with configured targets", async () => {
    await ensureMvpSeedData();

    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

    const uniqueSuffix = `${Date.now()}`;
    const engineerOpenId = `kpi-writer-${uniqueSuffix}`;

    await db.insert(users).values({
      openId: engineerOpenId,
      username: `kpi-writer-${uniqueSuffix}`,
      name: "KPI Writer",
      loginMethod: "password",
      role: "engineer",
    });

    const engineerRow = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.openId, engineerOpenId))
      .limit(1);

    const engineerId = engineerRow[0]?.id;
    expect(engineerId).toBeTruthy();
    if (!engineerId) {
      return;
    }

    createdUserIds.push(engineerId);

    const poNumber = `PO-KPI-WRITE-${uniqueSuffix}`;
    createdPoNumbers.add(poNumber);

    await importProducts({
      poNumber,
      vendorName: "KPI 測試廠商",
      rows: [
        {
          batchNo: `KPI-BATCH-${uniqueSuffix}`,
          serialNumber: `KPI-SN-${uniqueSuffix}`,
          imei: `86${`${Date.now()}`.padStart(13, "0").slice(-13)}`,
          productName: "iPhone KPI Test",
          categoryName: "智慧型手機",
          brandName: "Apple",
        },
      ],
    });

    const a1Task = await db
      .select({
        taskId: stationTasks.id,
        productId: stationTasks.productId,
        categoryId: products.categoryId,
        subtypeCode: productCategories.subtypeCode,
      })
      .from(stationTasks)
      .innerJoin(products, eq(stationTasks.productId, products.id))
      .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
      .where(and(
        eq(products.poNumber, poNumber),
        eq(stationTasks.stationCode, "A1"),
        eq(stationTasks.taskStatus, "pending"),
      ))
      .limit(1);

    expect(a1Task[0]).toBeTruthy();

    const supportRowsBefore = await db
      .select({ id: supportTaskCompensations.id })
      .from(supportTaskCompensations)
      .where(eq(supportTaskCompensations.userId, engineerId));

    mockGooglePurchaseSheetBatches([`KPI-BATCH-${uniqueSuffix}`]);

    await completeStationTask({
      taskId: a1Task[0]?.taskId ?? 0,
      stationCode: "A1",
      operatorUserId: engineerId,
      productId: a1Task[0]?.productId ?? 0,
      categoryId: a1Task[0]?.categoryId ?? null,
      subtypeCode: a1Task[0]?.subtypeCode ?? null,
      summary: "KPI 寫入驗證",
    });

    const supportRowsAfter = await db
      .select({ id: supportTaskCompensations.id })
      .from(supportTaskCompensations)
      .where(eq(supportTaskCompensations.userId, engineerId));

    expect(supportRowsAfter).toHaveLength(supportRowsBefore.length);

    const detailRows = await db
      .select()
      .from(productivityScoreDetails)
      .where(and(
        eq(productivityScoreDetails.userId, engineerId),
        eq(productivityScoreDetails.productId, a1Task[0]?.productId ?? 0),
        eq(productivityScoreDetails.stationCode, "A1"),
      ));

    expect(detailRows).toHaveLength(1);
    expect(detailRows[0]?.targetConfigId).not.toBeNull();
    expect(detailRows[0]?.completedQty).toBe(1);
    expect(Number(detailRows[0]?.baseUnitPoints ?? 0)).toBeGreaterThan(0);
    expect(Number(detailRows[0]?.earnedPoints ?? 0)).toBeGreaterThan(0);

    const aggregateRows = await db
      .select()
      .from(engineerDailyProductivity)
      .where(and(
        eq(engineerDailyProductivity.userId, engineerId),
        eq(engineerDailyProductivity.businessDate, detailRows[0]!.businessDate),
      ))
      .limit(1);

    expect(aggregateRows).toHaveLength(1);
    expect(aggregateRows[0]?.attendanceFlag).toBe(true);
    expect(Number(aggregateRows[0]?.totalPoints ?? 0)).toBeCloseTo(Number(detailRows[0]?.earnedPoints ?? 0), 6);
    expect(Number(aggregateRows[0]?.rawAchievementRate ?? 0)).toBeGreaterThan(0);
    expect(Number(aggregateRows[0]?.kpiAchievementRate ?? 0)).toBeGreaterThan(0);
  }, 20000);

  it("still writes B station productivity when categoryId is empty but brand can be inferred from imported fields and product name", async () => {
    await ensureMvpSeedData();

    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

    const uniqueSuffix = `${Date.now()}-fallback`;
    const engineerOpenId = `kpi-fallback-${uniqueSuffix}`;

    await db.insert(users).values({
      openId: engineerOpenId,
      username: `kpi-fallback-${uniqueSuffix}`,
      name: "KPI Fallback",
      loginMethod: "password",
      role: "engineer",
    });

    const engineerRow = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.openId, engineerOpenId))
      .limit(1);

    const engineerId = engineerRow[0]?.id;
    expect(engineerId).toBeTruthy();
    if (!engineerId) {
      return;
    }

    createdUserIds.push(engineerId);

    const poNumber = `PO-KPI-FALLBACK-${uniqueSuffix}`;
    createdPoNumbers.add(poNumber);

    await importProducts({
      poNumber,
      vendorName: "KPI 補判測試廠商",
      rows: [
        {
          batchNo: `KPI-FALLBACK-BATCH-${uniqueSuffix}`,
          serialNumber: `KPI-FALLBACK-SN-${uniqueSuffix}`,
          imei: `97${`${Date.now()}`.padStart(13, "0").slice(-13)}`,
          productName: "Apple iPhone 13 Pro 256GB",
          categoryName: "智慧型手機",
          brandName: "Apple",
        },
      ],
    });

    const a1Task = await db
      .select({
        taskId: stationTasks.id,
        productId: stationTasks.productId,
        categoryId: products.categoryId,
        subtypeCode: productCategories.subtypeCode,
      })
      .from(stationTasks)
      .innerJoin(products, eq(stationTasks.productId, products.id))
      .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
      .where(and(eq(products.poNumber, poNumber), eq(stationTasks.stationCode, "A1"), eq(stationTasks.taskStatus, "pending")))
      .limit(1);

    expect(a1Task[0]).toBeTruthy();

    mockGooglePurchaseSheetBatches([`KPI-FALLBACK-BATCH-${uniqueSuffix}`]);

    await completeStationTask({
      taskId: a1Task[0]?.taskId ?? 0,
      stationCode: "A1",
      operatorUserId: engineerId,
      productId: a1Task[0]?.productId ?? 0,
      categoryId: a1Task[0]?.categoryId ?? null,
      subtypeCode: a1Task[0]?.subtypeCode ?? null,
      summary: "A1 完成，前往 A2",
    });

    const a2Task = await db
      .select({
        taskId: stationTasks.id,
        productId: stationTasks.productId,
        categoryId: products.categoryId,
        subtypeCode: productCategories.subtypeCode,
      })
      .from(stationTasks)
      .innerJoin(products, eq(stationTasks.productId, products.id))
      .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
      .where(and(eq(products.poNumber, poNumber), eq(stationTasks.stationCode, "A2"), eq(stationTasks.taskStatus, "pending")))
      .limit(1);

    expect(a2Task[0]).toBeTruthy();

    mockGooglePurchaseSheetBatches([`KPI-FALLBACK-BATCH-${uniqueSuffix}`]);

    await completeStationTask({
      taskId: a2Task[0]?.taskId ?? 0,
      stationCode: "A2",
      operatorUserId: engineerId,
      productId: a2Task[0]?.productId ?? 0,
      categoryId: a2Task[0]?.categoryId ?? null,
      subtypeCode: a2Task[0]?.subtypeCode ?? null,
      summary: "A2 完成，前往 B",
    });

    await db
      .update(products)
      .set({
        categoryId: null,
        importedBrandName: null,
        importedCategoryName: "智慧型手機",
      })
      .where(eq(products.id, a1Task[0]?.productId ?? 0));

    const bTask = await db
      .select({
        taskId: stationTasks.id,
        productId: stationTasks.productId,
      })
      .from(stationTasks)
      .innerJoin(products, eq(stationTasks.productId, products.id))
      .where(and(eq(products.poNumber, poNumber), eq(stationTasks.stationCode, "B"), eq(stationTasks.taskStatus, "pending")))
      .limit(1);

    expect(bTask[0]).toBeTruthy();

    mockGooglePurchaseSheetBatches([`KPI-FALLBACK-BATCH-${uniqueSuffix}`]);

    await completeStationTask({
      taskId: bTask[0]?.taskId ?? 0,
      stationCode: "B",
      operatorUserId: engineerId,
      productId: bTask[0]?.productId ?? 0,
      categoryId: null,
      subtypeCode: null,
      summary: "B 站補判分類後完成",
    });

    const bDetailRows = await db
      .select()
      .from(productivityScoreDetails)
      .where(and(
        eq(productivityScoreDetails.userId, engineerId),
        eq(productivityScoreDetails.productId, bTask[0]?.productId ?? 0),
        eq(productivityScoreDetails.stationCode, "B"),
      ));

    expect(bDetailRows).toHaveLength(1);
    expect(bDetailRows[0]?.categoryId).toBe(a1Task[0]?.categoryId ?? null);
    expect(Number(bDetailRows[0]?.earnedPoints ?? 0)).toBeGreaterThan(0);

    const refreshedProduct = (await db
      .select({
        categoryId: products.categoryId,
        importedBrandName: products.importedBrandName,
      })
      .from(products)
      .where(eq(products.id, bTask[0]?.productId ?? 0))
      .limit(1))[0];

    expect(refreshedProduct?.categoryId).toBe(a1Task[0]?.categoryId ?? null);
    expect(refreshedProduct?.importedBrandName).toBe("Apple");
  }, 20000);

  it("does not disable KPI details when Google purchase sheet includes the batch with a different zero-padded format", async () => {
    await ensureMvpSeedData();

    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

    const uniqueSuffix = `${Date.now()}-google-guard`;
    const engineerOpenId = `kpi-google-guard-${uniqueSuffix}`;

    await db.insert(users).values({
      openId: engineerOpenId,
      username: `kpi-google-guard-${uniqueSuffix}`,
      name: "KPI Google Guard",
      loginMethod: "password",
      role: "engineer",
    });

    const engineerRow = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.openId, engineerOpenId))
      .limit(1);

    const engineerId = engineerRow[0]?.id;
    expect(engineerId).toBeTruthy();
    if (!engineerId) {
      return;
    }

    createdUserIds.push(engineerId);

    const poNumber = `PO-KPI-GOOGLE-GUARD-${uniqueSuffix}`;
    createdPoNumbers.add(poNumber);
    const dbBatchNo = `005${Date.now().toString().slice(-8)}`;
    const googleBatchNo = String(Number(dbBatchNo));

    await importProducts({
      poNumber,
      vendorName: "KPI Google Guard Vendor",
      rows: [
        {
          batchNo: dbBatchNo,
          serialNumber: `KPI-GOOGLE-GUARD-SN-${uniqueSuffix}`,
          imei: `96${`${Date.now()}`.padStart(13, "0").slice(-13)}`,
          productName: "Apple iPhone Guard",
          categoryName: "智慧型手機",
          brandName: "Apple",
        },
      ],
    });

    const seededTask = (await db
      .select({
        taskId: stationTasks.id,
        productId: stationTasks.productId,
        categoryId: products.categoryId,
        subtypeCode: productCategories.subtypeCode,
      })
      .from(stationTasks)
      .innerJoin(products, eq(stationTasks.productId, products.id))
      .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
      .where(and(eq(products.poNumber, poNumber), eq(stationTasks.stationCode, "A1"), eq(stationTasks.taskStatus, "pending")))
      .limit(1))[0];

    expect(seededTask).toBeTruthy();

    const businessDateValue = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    const insertedEvent = await db.insert(stationEvents).values({
      productId: seededTask?.productId ?? 0,
      stationTaskId: seededTask?.taskId ?? null,
      stationCode: "A1",
      eventType: "complete",
      operatorUserId: engineerId,
      businessDate: businessDateValue,
      categoryId: seededTask?.categoryId ?? null,
      subtypeCode: seededTask?.subtypeCode ?? null,
      countForProductivity: true,
      payload: { summary: "Google 主表批號準入回歸測試" },
    }).$returningId();

    mockGooglePurchaseSheetBatches([googleBatchNo]);

    await backfillProductivityFromCompletedEvents(db, { userId: engineerId });

    const detailRows = await db
      .select({ id: productivityScoreDetails.id })
      .from(productivityScoreDetails)
      .where(eq(productivityScoreDetails.stationEventId, insertedEvent[0]?.id ?? 0));

    expect(detailRows).toHaveLength(1);

    const eventRow = (await db
      .select({ countForProductivity: stationEvents.countForProductivity })
      .from(stationEvents)
      .where(eq(stationEvents.id, insertedEvent[0]?.id ?? 0))
      .limit(1))[0];

    expect(eventRow?.countForProductivity).toBe(true);
  }, 20000);

  it("creates productivity detail for D station sampling_pass events when the Google purchase sheet contains the batch", async () => {
    await ensureMvpSeedData();

    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

    const uniqueSuffix = `${Date.now()}-d-sampling-pass`;
    const engineerOpenId = `kpi-d-sampling-pass-${uniqueSuffix}`;

    await db.insert(users).values({
      openId: engineerOpenId,
      username: `kpi-d-sampling-pass-${uniqueSuffix}`,
      name: "KPI D Sampling Pass",
      loginMethod: "password",
      role: "engineer",
    });

    const engineerRow = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.openId, engineerOpenId))
      .limit(1);

    const engineerId = engineerRow[0]?.id;
    expect(engineerId).toBeTruthy();
    if (!engineerId) {
      return;
    }

    createdUserIds.push(engineerId);

    const poNumber = `PO-KPI-D-SAMPLING-PASS-${uniqueSuffix}`;
    createdPoNumbers.add(poNumber);
    const googleBatchNo = `KPI-D-SAMPLING-PASS-BATCH-${uniqueSuffix}`;

    await importProducts({
      poNumber,
      vendorName: "KPI D Sampling Pass Vendor",
      rows: [
        {
          batchNo: googleBatchNo,
          serialNumber: `KPI-D-SAMPLING-PASS-SN-${uniqueSuffix}`,
          imei: `97${`${Date.now()}`.padStart(13, "0").slice(-13)}`,
          productName: "Apple iPhone D Sampling Pass",
          categoryName: "智慧型手機",
          brandName: "Apple",
        },
      ],
    });

    const seededProduct = (await db
      .select({
        productId: products.id,
        categoryId: products.categoryId,
        subtypeCode: productCategories.subtypeCode,
      })
      .from(products)
      .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
      .where(eq(products.poNumber, poNumber))
      .limit(1))[0];

    expect(seededProduct).toBeTruthy();

    const businessDateValue = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    const insertedEvent = await db.insert(stationEvents).values({
      productId: seededProduct?.productId ?? 0,
      stationTaskId: null,
      stationCode: "D",
      eventType: "sampling_pass",
      operatorUserId: engineerId,
      businessDate: businessDateValue,
      categoryId: seededProduct?.categoryId ?? null,
      subtypeCode: seededProduct?.subtypeCode ?? null,
      countForProductivity: true,
      payload: { summary: "D 站抽檢通過應納入 KPI" },
    }).$returningId();

    mockGooglePurchaseSheetBatches([googleBatchNo]);

    await backfillProductivityFromCompletedEvents(db, { userId: engineerId });

    const detailRows = await db
      .select({
        id: productivityScoreDetails.id,
        stationCode: productivityScoreDetails.stationCode,
      })
      .from(productivityScoreDetails)
      .where(eq(productivityScoreDetails.stationEventId, insertedEvent[0]?.id ?? 0));

    expect(detailRows).toHaveLength(1);
    expect(detailRows[0]?.stationCode).toBe("D");
  }, 20000);

  it("does not create productivity detail when Google purchase sheet does not contain the batch", async () => {
    await ensureMvpSeedData();

    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

    const uniqueSuffix = `${Date.now()}-missing-google`;
    const engineerOpenId = `kpi-missing-google-${uniqueSuffix}`;

    await db.insert(users).values({
      openId: engineerOpenId,
      username: `kpi-missing-google-${uniqueSuffix}`,
      name: "KPI Missing Google",
      loginMethod: "password",
      role: "engineer",
    });

    const engineerRow = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.openId, engineerOpenId))
      .limit(1);

    const engineerId = engineerRow[0]?.id;
    expect(engineerId).toBeTruthy();
    if (!engineerId) {
      return;
    }

    createdUserIds.push(engineerId);

    const poNumber = `PO-KPI-MISSING-GOOGLE-${uniqueSuffix}`;
    createdPoNumbers.add(poNumber);
    const batchNo = `KPI-MISSING-GOOGLE-BATCH-${uniqueSuffix}`;

    await importProducts({
      poNumber,
      vendorName: "KPI Missing Google Vendor",
      rows: [
        {
          batchNo,
          serialNumber: `KPI-MISSING-GOOGLE-SN-${uniqueSuffix}`,
          imei: `99${`${Date.now()}`.padStart(13, "0").slice(-13)}`,
          productName: "Apple iPhone Missing",
          categoryName: "智慧型手機",
          brandName: "Apple",
        },
      ],
    });

    const seededTask = (await db
      .select({
        taskId: stationTasks.id,
        productId: stationTasks.productId,
        categoryId: products.categoryId,
        subtypeCode: productCategories.subtypeCode,
      })
      .from(stationTasks)
      .innerJoin(products, eq(stationTasks.productId, products.id))
      .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
      .where(and(eq(products.poNumber, poNumber), eq(stationTasks.stationCode, "A1"), eq(stationTasks.taskStatus, "pending")))
      .limit(1))[0];

    expect(seededTask).toBeTruthy();

    const businessDateValue = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    const insertedEvent = await db.insert(stationEvents).values({
      productId: seededTask?.productId ?? 0,
      stationTaskId: seededTask?.taskId ?? null,
      stationCode: "A1",
      eventType: "complete",
      operatorUserId: engineerId,
      businessDate: businessDateValue,
      categoryId: seededTask?.categoryId ?? null,
      subtypeCode: seededTask?.subtypeCode ?? null,
      countForProductivity: true,
      payload: { summary: "Google 主表缺批號不得寫入 KPI" },
    }).$returningId();

    mockGooglePurchaseSheetBatches([]);

    await backfillProductivityFromCompletedEvents(db, { userId: engineerId });

    const detailRows = await db
      .select({ id: productivityScoreDetails.id })
      .from(productivityScoreDetails)
      .where(eq(productivityScoreDetails.stationEventId, insertedEvent[0]?.id ?? 0));

    expect(detailRows).toHaveLength(0);

    const eventRow = (await db
      .select({ countForProductivity: stationEvents.countForProductivity })
      .from(stationEvents)
      .where(eq(stationEvents.id, insertedEvent[0]?.id ?? 0))
      .limit(1))[0];

    expect(eventRow?.countForProductivity).toBe(false);
  }, 20000);

  it("does not duplicate productivity details when backfill is executed repeatedly for the same engineer", async () => {
    await ensureMvpSeedData();

    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

    const uniqueSuffix = `${Date.now()}-idempotent`;
    const engineerOpenId = `kpi-idempotent-${uniqueSuffix}`;

    await db.insert(users).values({
      openId: engineerOpenId,
      username: `kpi-idempotent-${uniqueSuffix}`,
      name: "KPI Idempotent",
      loginMethod: "password",
      role: "engineer",
    });

    const engineerRow = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.openId, engineerOpenId))
      .limit(1);

    const engineerId = engineerRow[0]?.id;
    expect(engineerId).toBeTruthy();
    if (!engineerId) {
      return;
    }

    createdUserIds.push(engineerId);

    const poNumber = `PO-KPI-IDEMPOTENT-${uniqueSuffix}`;
    createdPoNumbers.add(poNumber);

    await importProducts({
      poNumber,
      vendorName: "KPI 冪等測試廠商",
      rows: [
        {
          batchNo: `KPI-IDEMPOTENT-BATCH-${uniqueSuffix}`,
          serialNumber: `KPI-IDEMPOTENT-SN-${uniqueSuffix}`,
          imei: `98${`${Date.now()}`.padStart(13, "0").slice(-13)}`,
          productName: "Apple iPhone 14 128GB",
          categoryName: "智慧型手機",
          brandName: "Apple",
        },
      ],
    });

    const a1Task = await db
      .select({
        taskId: stationTasks.id,
        productId: stationTasks.productId,
        categoryId: products.categoryId,
        subtypeCode: productCategories.subtypeCode,
      })
      .from(stationTasks)
      .innerJoin(products, eq(stationTasks.productId, products.id))
      .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
      .where(and(eq(products.poNumber, poNumber), eq(stationTasks.stationCode, "A1"), eq(stationTasks.taskStatus, "pending")))
      .limit(1);

    mockGooglePurchaseSheetBatches([`KPI-IDEMPOTENT-BATCH-${uniqueSuffix}`]);

    await completeStationTask({
      taskId: a1Task[0]?.taskId ?? 0,
      stationCode: "A1",
      operatorUserId: engineerId,
      productId: a1Task[0]?.productId ?? 0,
      categoryId: a1Task[0]?.categoryId ?? null,
      subtypeCode: a1Task[0]?.subtypeCode ?? null,
      summary: "A1 完成，驗證回補冪等性",
    });

    const createdDetail = (await db
      .select({ stationEventId: productivityScoreDetails.stationEventId })
      .from(productivityScoreDetails)
      .where(and(
        eq(productivityScoreDetails.userId, engineerId),
        eq(productivityScoreDetails.productId, a1Task[0]?.productId ?? 0),
        eq(productivityScoreDetails.stationCode, "A1"),
      )))[0];

    expect(createdDetail?.stationEventId).toBeTruthy();

    await db.delete(productivityScoreDetails).where(eq(productivityScoreDetails.stationEventId, createdDetail?.stationEventId ?? 0));

    await backfillProductivityFromCompletedEvents(db, { userId: engineerId });
    await backfillProductivityFromCompletedEvents(db, { userId: engineerId });

    const detailRowsAfterBackfill = await db
      .select({
        id: productivityScoreDetails.id,
        stationEventId: productivityScoreDetails.stationEventId,
      })
      .from(productivityScoreDetails)
      .where(and(
        eq(productivityScoreDetails.userId, engineerId),
        eq(productivityScoreDetails.productId, a1Task[0]?.productId ?? 0),
        eq(productivityScoreDetails.stationCode, "A1"),
      ));

    expect(detailRowsAfterBackfill).toHaveLength(1);
    expect(detailRowsAfterBackfill[0]?.stationEventId).toBe(createdDetail?.stationEventId ?? null);
  }, 20000);

  it("counts KPI for every tracked station in the default A1→A2→B→C→D→E flow without touching real Google data", async () => {
    await ensureMvpSeedData();

    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

    const uniqueSuffix = `${Date.now()}-all-stations`;
    const engineerOpenId = `kpi-all-stations-${uniqueSuffix}`;
    const batchNo = `KPI-ALL-STATIONS-BATCH-${uniqueSuffix}`;

    await db.insert(users).values({
      openId: engineerOpenId,
      username: `kpi-all-stations-${uniqueSuffix}`,
      name: "KPI All Stations",
      loginMethod: "password",
      role: "engineer",
    });

    const engineerRow = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.openId, engineerOpenId))
      .limit(1);

    const engineerId = engineerRow[0]?.id;
    expect(engineerId).toBeTruthy();
    if (!engineerId) {
      return;
    }

    createdUserIds.push(engineerId);

    const poNumber = `PO-KPI-ALL-STATIONS-${uniqueSuffix}`;
    createdPoNumbers.add(poNumber);

    await importProducts({
      poNumber,
      vendorName: "KPI 全站驗證測試廠商",
      rows: [
        {
          batchNo,
          serialNumber: `KPI-ALL-STATIONS-SN-${uniqueSuffix}`,
          imei: `95${`${Date.now()}`.padStart(13, "0").slice(-13)}`,
          productName: "Apple iPhone KPI All Stations",
          categoryName: "智慧型手機",
          brandName: "Apple",
        },
      ],
    });

    mockGooglePurchaseSheetBatches([batchNo]);

    const getPendingTask = async (stationCode: "A1" | "A2" | "B" | "C" | "D" | "E") => (await db
      .select({
        taskId: stationTasks.id,
        productId: stationTasks.productId,
        categoryId: products.categoryId,
        subtypeCode: productCategories.subtypeCode,
      })
      .from(stationTasks)
      .innerJoin(products, eq(stationTasks.productId, products.id))
      .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
      .where(and(
        eq(products.poNumber, poNumber),
        eq(stationTasks.stationCode, stationCode),
        eq(stationTasks.taskStatus, "pending"),
      ))
      .limit(1))[0];

    const a1Task = await getPendingTask("A1");
    expect(a1Task).toBeTruthy();
    const a1Result = await completeStationTask({
      taskId: a1Task?.taskId ?? 0,
      stationCode: "A1",
      operatorUserId: engineerId,
      productId: a1Task?.productId ?? 0,
      categoryId: a1Task?.categoryId ?? null,
      subtypeCode: a1Task?.subtypeCode ?? null,
      summary: "A1 全站 KPI 驗證完成",
    });
    expect(a1Result.success).toBe(true);

    const a2Task = await getPendingTask("A2");
    expect(a2Task).toBeTruthy();
    const a2Result = await completeStationTask({
      taskId: a2Task?.taskId ?? 0,
      stationCode: "A2",
      operatorUserId: engineerId,
      productId: a2Task?.productId ?? 0,
      categoryId: a2Task?.categoryId ?? null,
      subtypeCode: a2Task?.subtypeCode ?? null,
      summary: "A2 全站 KPI 驗證完成",
    });
    expect(a2Result.success).toBe(true);

    const bTask = await getPendingTask("B");
    expect(bTask).toBeTruthy();
    const bResult = await completeStationTask({
      taskId: bTask?.taskId ?? 0,
      stationCode: "B",
      operatorUserId: engineerId,
      productId: bTask?.productId ?? 0,
      categoryId: bTask?.categoryId ?? null,
      subtypeCode: bTask?.subtypeCode ?? null,
      summary: "B 全站 KPI 驗證完成",
    });
    expect(bResult.success).toBe(true);

    const cTask = await getPendingTask("C");
    expect(cTask).toBeTruthy();
    const cResult = await completeStationTask({
      taskId: cTask?.taskId ?? 0,
      stationCode: "C",
      operatorUserId: engineerId,
      productId: cTask?.productId ?? 0,
      categoryId: cTask?.categoryId ?? null,
      subtypeCode: cTask?.subtypeCode ?? null,
      summary: "C 全站 KPI 驗證完成",
    });
    expect(cResult.success).toBe(true);

    const dTask = await getPendingTask("D");
    expect(dTask).toBeTruthy();
    const samplingResult = await submitSamplingResult({
      taskId: dTask?.taskId ?? 0,
      productId: dTask?.productId ?? 0,
      sampledByUserId: engineerId,
      passed: true,
      categoryId: dTask?.categoryId ?? null,
      subtypeCode: dTask?.subtypeCode ?? null,
      cFaultSummary: "正常",
      cAppearanceSummary: "正常",
      cCameraSummary: "正常",
    });
    expect(samplingResult.success).toBe(true);

    await backfillProductivityFromCompletedEvents(db, { userId: engineerId });

    const eTask = await getPendingTask("E");
    expect(eTask).toBeTruthy();
    const eResult = await completeStationTask({
      taskId: eTask?.taskId ?? 0,
      stationCode: "E",
      operatorUserId: engineerId,
      productId: eTask?.productId ?? 0,
      categoryId: eTask?.categoryId ?? null,
      subtypeCode: eTask?.subtypeCode ?? null,
      summary: "E 全站 KPI 驗證完成",
      eFrontPhoto: createTestPhoto("front.jpg"),
      eBackPhoto: createTestPhoto("back.jpg"),
    });
    expect(eResult.success).toBe(true);

    const detailRows = await db
      .select({
        stationCode: productivityScoreDetails.stationCode,
        completedQty: productivityScoreDetails.completedQty,
        earnedPoints: productivityScoreDetails.earnedPoints,
      })
      .from(productivityScoreDetails)
      .where(and(
        eq(productivityScoreDetails.userId, engineerId),
        eq(productivityScoreDetails.productId, a1Task?.productId ?? 0),
      ));

    const stationCodes = detailRows.map((row) => row.stationCode).sort();
    expect(stationCodes).toEqual(["A1", "A2", "B", "C", "D", "E"]);
    detailRows.forEach((row) => {
      expect(row.completedQty).toBe(1);
      expect(Number(row.earnedPoints ?? 0)).toBeGreaterThan(0);
    });

    const aggregateRows = await db
      .select({
        totalPoints: engineerDailyProductivity.totalPoints,
        rawAchievementRate: engineerDailyProductivity.rawAchievementRate,
      })
      .from(engineerDailyProductivity)
      .where(eq(engineerDailyProductivity.userId, engineerId));

    expect(aggregateRows).toHaveLength(1);
    expect(Number(aggregateRows[0]?.totalPoints ?? 0)).toBeGreaterThan(0);
    expect(Number(aggregateRows[0]?.rawAchievementRate ?? 0)).toBeGreaterThan(0);
  }, 60000);
});
