import { and, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defectOptions, productArchives, products, stationTasks } from "../drizzle/schema";
import { ensureMvpSeedData, getDb, getStationPageData, submitSamplingResult } from "./db";

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

describe("D 站退回 C 站故障狀態保留 integration", () => {
  beforeAll(async () => {
    await ensureMvpSeedData();
  });

  afterAll(async () => {
    await archiveCreatedRows();
  });

  it("D 站全檢失敗退回 C 站後，會保留上一輪 C 站的故障、外觀與鏡頭 option ids", async () => {
    const uniqueSuffix = `${Date.now()}`;
    const poNumber = `PO-D-RETURN-${uniqueSuffix}`;
    const batchNo = `D-RETURN-${uniqueSuffix}`;
    createdPoNumbers.add(poNumber);

    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

    const [cFaultOption, cAppearanceOption, cCameraOption, bFaultOption] = await Promise.all([
      db.select({ id: defectOptions.id, label: defectOptions.label }).from(defectOptions).where(and(eq(defectOptions.stationCode, "C"), eq(defectOptions.optionType, "fault"), eq(defectOptions.active, true))).limit(1),
      db.select({ id: defectOptions.id, label: defectOptions.label }).from(defectOptions).where(and(eq(defectOptions.stationCode, "C"), eq(defectOptions.optionType, "appearance"), eq(defectOptions.active, true))).limit(1),
      db.select({ id: defectOptions.id, label: defectOptions.label }).from(defectOptions).where(and(eq(defectOptions.stationCode, "C"), eq(defectOptions.optionType, "camera"), eq(defectOptions.active, true))).limit(1),
      db.select({ id: defectOptions.id, label: defectOptions.label }).from(defectOptions).where(and(eq(defectOptions.stationCode, "B"), eq(defectOptions.optionType, "fault"), eq(defectOptions.active, true))).limit(1),
    ]);

    expect(cFaultOption[0]?.id).toBeTruthy();
    expect(cAppearanceOption[0]?.id).toBeTruthy();
    expect(cCameraOption[0]?.id).toBeTruthy();
    expect(bFaultOption[0]?.id).toBeTruthy();

    const insertedProduct = await db.insert(products).values({
      productCode: `P-D-RETURN-${uniqueSuffix}`,
      poNumber,
      vendorName: "D 站返工回 C 驗證",
      batchNo,
      serialNumber: `D-RETURN-SN-${uniqueSuffix}`,
      imei: `92${`${uniqueSuffix}`.padStart(13, "0").slice(-13)}`,
      productName: "D Return To C Device",
      currentStationCode: "D",
      currentStatus: "pending_d",
      importedCategoryName: "智慧手機",
      importedBrandName: "Apple",
    }).$returningId();

    const productId = insertedProduct[0]?.id;
    expect(productId).toBeTruthy();

    await db.insert(stationTasks).values([
      {
        productId: productId!,
        stationCode: "C",
        taskStatus: "completed",
        dueDate: new Date(),
        completedAt: new Date(),
        resultSummary: "C 站品檢完成",
        metadata: {
          bFaultOptionIds: [bFaultOption[0]!.id],
          bFaultLabels: [bFaultOption[0]!.label],
          batteryNote: "91%",
          batteryIssueLabels: [],
          batterySummary: "91%",
          faultOptionIds: [cFaultOption[0]!.id],
          appearanceOptionIds: [cAppearanceOption[0]!.id],
          cameraOptionIds: [cCameraOption[0]!.id],
          faultLabels: [cFaultOption[0]!.label],
          appearanceLabels: [cAppearanceOption[0]!.label],
          cameraLabels: [cCameraOption[0]!.label],
          cFaultSummary: cFaultOption[0]!.label,
          cAppearanceSummary: cAppearanceOption[0]!.label,
          cCameraSummary: cCameraOption[0]!.label,
          cInspectionSummary: [cFaultOption[0]!.label, cAppearanceOption[0]!.label, cCameraOption[0]!.label].join(", "),
          applyBChanges: false,
        },
      },
      {
        productId: productId!,
        stationCode: "D",
        taskStatus: "pending",
        dueDate: new Date(),
        resultSummary: "D 站待全檢",
        metadata: {
          batterySummary: "91%",
          bFaultSummary: bFaultOption[0]!.label,
          cFaultSummary: cFaultOption[0]!.label,
          cAppearanceSummary: cAppearanceOption[0]!.label,
          cCameraSummary: cCameraOption[0]!.label,
        },
      },
    ]);

    const dTask = await db
      .select({ id: stationTasks.id })
      .from(stationTasks)
      .where(and(eq(stationTasks.productId, productId!), eq(stationTasks.stationCode, "D"), eq(stationTasks.taskStatus, "pending")))
      .limit(1);

    const result = await submitSamplingResult({
      taskId: dTask[0]!.id,
      productId: productId!,
      sampledByUserId: 1,
      passed: false,
      defectReason: "功能異常需返工",
      batterySummary: "91%",
      bFaultSummary: bFaultOption[0]!.label,
      cFaultSummary: cFaultOption[0]!.label,
      cAppearanceSummary: cAppearanceOption[0]!.label,
      cCameraSummary: cCameraOption[0]!.label,
    });

    expect(result.success).toBe(true);

    const cStationData = await getStationPageData("C");
    const returnedTask = cStationData.tasks.find((task) => task.batchNo === batchNo) as (typeof cStationData.tasks[number] & {
      taskMetadata?: {
        faultOptionIds?: number[];
        appearanceOptionIds?: number[];
        cameraOptionIds?: number[];
        bFaultOptionIds?: number[];
      };
      inheritedBFaultOptionIds?: number[];
    }) | undefined;

    expect(returnedTask?.taskStatus).toBe("returned");
    expect(returnedTask?.taskMetadata?.faultOptionIds).toEqual([cFaultOption[0]!.id]);
    expect(returnedTask?.taskMetadata?.appearanceOptionIds).toEqual([cAppearanceOption[0]!.id]);
    expect(returnedTask?.taskMetadata?.cameraOptionIds).toEqual([cCameraOption[0]!.id]);
    expect(returnedTask?.taskMetadata?.bFaultOptionIds).toEqual([bFaultOption[0]!.id]);
    expect(returnedTask?.inheritedBFaultOptionIds).toEqual([bFaultOption[0]!.id]);
  }, 20000);
});
