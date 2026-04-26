import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { productArchives, productCategories, products, stationEvents, stationTasks } from "../drizzle/schema";
import { assignProductCategoryToProduct, completeStationTask, createProductCategoryOption, ensureMvpSeedData, getDb, getStationPageData, importProducts, replaceCategoryStationFlow, submitSamplingResult } from "./db";

const createdPoNumbers = new Set<string>();

async function archiveCreatedRows() {
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

describe("manual category assignment integration", () => {
  beforeAll(async () => {
    await ensureMvpSeedData();
  });

  afterAll(async () => {
    await archiveCreatedRows();
  });

  it("applies saved category station flows to determine the next station", async () => {
    const uniqueSuffix = `${Date.now()}-flow`;
    const watchCategory = await createProductCategoryOption({ categoryName: "智慧手錶", brandName: "Apple" });
    await replaceCategoryStationFlow({
      categoryId: watchCategory?.id ?? 0,
      stationCodes: ["A1", "C", "D", "E", "STOCK"],
    });

    const importResult = await importProducts({
      vendorName: "品類流程整合驗證",
      rows: [
        {
          batchNo: `FLOW-${uniqueSuffix}`,
          serialNumber: `FLOW-SN-${uniqueSuffix}`,
          imei: `95${`${Date.now()}`.padStart(13, "0").slice(-13)}`,
          productName: "Watch Flow Device",
          categoryName: "智慧手錶",
          brandName: "Apple",
        },
      ],
    });
    createdPoNumbers.add(importResult.poNumber);

    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

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
      .where(and(eq(products.poNumber, importResult.poNumber), eq(stationTasks.stationCode, "A1"), eq(stationTasks.taskStatus, "pending")))
      .limit(1);

    await completeStationTask({
      taskId: a1Task[0]?.taskId ?? 0,
      stationCode: "A1",
      operatorUserId: 1,
      productId: a1Task[0]?.productId ?? 0,
      categoryId: a1Task[0]?.categoryId ?? null,
      subtypeCode: a1Task[0]?.subtypeCode ?? null,
      summary: "依品類流程從 A1 推進",
    });

    const cStationData = await getStationPageData("C");
    const a2StationData = await getStationPageData("A2");
    const bStationData = await getStationPageData("B");

    expect(cStationData.tasks.some((task) => task.batchNo === `FLOW-${uniqueSuffix}`)).toBe(true);
    expect(a2StationData.tasks.some((task) => task.batchNo === `FLOW-${uniqueSuffix}`)).toBe(false);
    expect(bStationData.tasks.some((task) => task.batchNo === `FLOW-${uniqueSuffix}`)).toBe(false);
  }, 20000);

  it("carries manually assigned category settings from D to E and back to C", async () => {
    const uniqueSuffix = `${Date.now()}`;
    const manualCategory = await createProductCategoryOption({ categoryName: "智慧手機", brandName: "Apple" });
    const rows = [
      {
        batchNo: `MANUAL-D-${uniqueSuffix}-PASS`,
        serialNumber: `MANUAL-D-SN-${uniqueSuffix}-PASS`,
        imei: `94${`${Number(uniqueSuffix) + 1}`.padStart(13, "0").slice(-13)}`,
        productName: "Manual D Pass Device",
        categoryName: "原始手機",
        brandName: "OriginalBrand",
      },
      {
        batchNo: `MANUAL-D-${uniqueSuffix}-FAIL`,
        serialNumber: `MANUAL-D-SN-${uniqueSuffix}-FAIL`,
        imei: `94${`${Number(uniqueSuffix) + 2}`.padStart(13, "0").slice(-13)}`,
        productName: "Manual D Fail Device",
        categoryName: "原始手機",
        brandName: "OriginalBrand",
      },
    ];

    const importResult = await importProducts({
      vendorName: "手動指定 D 站跨站驗證",
      rows,
    });
    createdPoNumbers.add(importResult.poNumber);

    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

    const importedProducts = await db
      .select({
        id: products.id,
        batchNo: products.batchNo,
        importedCategoryName: products.importedCategoryName,
        importedBrandName: products.importedBrandName,
      })
      .from(products)
      .where(and(eq(products.poNumber, importResult.poNumber), isNull(products.archivedAt)));

    expect(importedProducts).toHaveLength(2);

    const importedProductIds = importedProducts.map((product) => product.id);
    await assignProductCategoryToProduct({
      productId: importedProductIds[0]!,
      categoryId: manualCategory?.id ?? null,
    });
    await assignProductCategoryToProduct({
      productId: importedProductIds[1]!,
      categoryId: manualCategory?.id ?? null,
    });

    await db
      .update(products)
      .set({
        currentStationCode: "D",
        updatedAt: new Date(),
      })
      .where(inArray(products.id, importedProductIds));

    await db
      .update(stationTasks)
      .set({
        taskStatus: "completed",
        completedAt: new Date(),
        resultSummary: "測試資料已推進至 D",
      })
      .where(and(inArray(stationTasks.productId, importedProductIds), eq(stationTasks.stationCode, "A1")));

    await db.insert(stationTasks).values(importedProducts.map((product) => ({
      productId: product.id,
      stationCode: "D",
      taskStatus: "pending",
      dueDate: new Date(),
      resultSummary: "D 站待全檢",
      metadata: {},
    })));

    const dTasks = await db
      .select({
        taskId: stationTasks.id,
        productId: stationTasks.productId,
        batchNo: products.batchNo,
      })
      .from(stationTasks)
      .innerJoin(products, eq(stationTasks.productId, products.id))
      .where(and(inArray(stationTasks.productId, importedProductIds), eq(stationTasks.stationCode, "D"), eq(stationTasks.taskStatus, "pending")));

    const passTask = dTasks.find((task) => task.batchNo === rows[0]?.batchNo);
    const failTask = dTasks.find((task) => task.batchNo === rows[1]?.batchNo);

    await submitSamplingResult({
      taskId: passTask?.taskId ?? 0,
      productId: passTask?.productId ?? 0,
      sampledByUserId: 1,
      passed: true,
      categoryId: manualCategory?.id ?? null,
      subtypeCode: manualCategory?.subtypeCode ?? null,
      batterySummary: "正常",
      bFaultSummary: "正常",
      cFaultSummary: "正常",
      cAppearanceSummary: "正常",
      cCameraSummary: "正常",
    });

    await submitSamplingResult({
      taskId: failTask?.taskId ?? 0,
      productId: failTask?.productId ?? 0,
      sampledByUserId: 1,
      passed: false,
      categoryId: manualCategory?.id ?? null,
      subtypeCode: manualCategory?.subtypeCode ?? null,
      defectReason: "抽驗未通過",
      batterySummary: "正常",
      bFaultSummary: "正常",
      cFaultSummary: "正常",
      cAppearanceSummary: "正常",
      cCameraSummary: "正常",
    });

    const eStationData = await getStationPageData("E");
    const cStationData = await getStationPageData("C");
    const movedToE = eStationData.tasks.find((task) => task.batchNo === rows[0]?.batchNo);
    const reworkedToC = cStationData.tasks.find((task) => task.batchNo === rows[1]?.batchNo);

    expect(movedToE?.categoryName).toBe("智慧手機");
    expect(movedToE?.brandName).toBe("Apple");
    expect(movedToE?.importedCategoryName).toBe("原始手機");
    expect(movedToE?.importedBrandName).toBe("OriginalBrand");
    expect(reworkedToC?.categoryName).toBe("智慧手機");
    expect(reworkedToC?.brandName).toBe("Apple");
    expect(reworkedToC?.importedCategoryName).toBe("原始手機");
    expect(reworkedToC?.importedBrandName).toBe("OriginalBrand");

    const dEvents = await db
      .select({
        productId: stationEvents.productId,
        categoryId: stationEvents.categoryId,
        subtypeCode: stationEvents.subtypeCode,
      })
      .from(stationEvents)
      .where(and(inArray(stationEvents.productId, importedProductIds), eq(stationEvents.stationCode, "D")))
      .orderBy(desc(stationEvents.id));

    expect(dEvents).toHaveLength(2);
    expect(new Set(dEvents.map((event) => event.categoryId))).toEqual(new Set([manualCategory?.id ?? null]));
    expect(new Set(dEvents.map((event) => event.subtypeCode))).toEqual(new Set([manualCategory?.subtypeCode ?? null]));
  }, 20000);
});
