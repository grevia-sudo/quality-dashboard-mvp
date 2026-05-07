import { and, eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  engineerDailyProductivity,
  productCategories,
  productivityScoreDetails,
  products,
  stationEvents,
  stationTasks,
  supportTaskCompensations,
  users,
} from "../drizzle/schema";
import { completeStationTask, ensureMvpSeedData, getDb, importProducts } from "./db";

const createdPoNumbers = new Set<string>();
const createdUserIds: number[] = [];

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
      await db.delete(stationEvents).where(inArray(stationEvents.productId, productIds));
      await db.delete(stationTasks).where(inArray(stationTasks.productId, productIds));
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
});
