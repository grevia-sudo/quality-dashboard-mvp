import { and, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defectOptions, productArchives, products, stationTasks } from "../drizzle/schema";
import { ensureMvpSeedData, getDb, getStationPageData } from "./db";

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

describe("D 站回填 C 站原始勾選 integration", () => {
  beforeAll(async () => {
    await ensureMvpSeedData();
  });

  afterAll(async () => {
    await archiveCreatedRows();
  });

  it("當 D 站 task metadata 與摘要文字不一致時，查詢結果仍保留原始 C 站 option ids 供畫面優先回填", async () => {
    const uniqueSuffix = `${Date.now()}`;
    const poNumber = `PO-D-PREFILL-${uniqueSuffix}`;
    const batchNo = `D-PREFILL-${uniqueSuffix}`;
    createdPoNumbers.add(poNumber);

    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

    const [cFaultOptionRows, cAppearanceOptionRows, cCameraOptionRows] = await Promise.all([
      db.select({ id: defectOptions.id, label: defectOptions.label }).from(defectOptions).where(and(eq(defectOptions.stationCode, "C"), eq(defectOptions.optionType, "fault"), eq(defectOptions.active, true))).limit(2),
      db.select({ id: defectOptions.id, label: defectOptions.label }).from(defectOptions).where(and(eq(defectOptions.stationCode, "C"), eq(defectOptions.optionType, "appearance"), eq(defectOptions.active, true))).limit(2),
      db.select({ id: defectOptions.id, label: defectOptions.label }).from(defectOptions).where(and(eq(defectOptions.stationCode, "C"), eq(defectOptions.optionType, "camera"), eq(defectOptions.active, true))).limit(2),
    ]);

    expect(cFaultOptionRows.length).toBeGreaterThan(1);
    expect(cAppearanceOptionRows.length).toBeGreaterThan(1);
    expect(cCameraOptionRows.length).toBeGreaterThan(1);

    const selectedFault = cFaultOptionRows[0]!;
    const conflictingFault = cFaultOptionRows[1]!;
    const selectedAppearance = cAppearanceOptionRows[0]!;
    const conflictingAppearance = cAppearanceOptionRows[1]!;
    const selectedCamera = cCameraOptionRows[0]!;
    const conflictingCamera = cCameraOptionRows[1]!;

    const insertedProduct = await db.insert(products).values({
      productCode: `P-D-PREFILL-${uniqueSuffix}`,
      poNumber,
      vendorName: "D 站回填驗證",
      batchNo,
      serialNumber: `D-PREFILL-SN-${uniqueSuffix}`,
      imei: `93${`${uniqueSuffix}`.padStart(13, "0").slice(-13)}`,
      productName: "D Prefill Metadata Device",
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
          faultOptionIds: [selectedFault.id],
          appearanceOptionIds: [selectedAppearance.id],
          cameraOptionIds: [selectedCamera.id],
          faultLabels: [selectedFault.label],
          appearanceLabels: [selectedAppearance.label],
          cameraLabels: [selectedCamera.label],
          cFaultSummary: selectedFault.label,
          cAppearanceSummary: selectedAppearance.label,
          cCameraSummary: selectedCamera.label,
          cInspectionSummary: [selectedFault.label, selectedAppearance.label, selectedCamera.label].join(", "),
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
          faultOptionIds: [selectedFault.id],
          appearanceOptionIds: [selectedAppearance.id],
          cameraOptionIds: [selectedCamera.id],
          cFaultSummary: conflictingFault.label,
          cAppearanceSummary: conflictingAppearance.label,
          cCameraSummary: conflictingCamera.label,
        },
      },
    ]);

    const dStationData = await getStationPageData("D");
    const dTask = dStationData.tasks.find((task) => task.batchNo === batchNo) as (typeof dStationData.tasks[number] & {
      taskMetadata?: {
        faultOptionIds?: number[];
        appearanceOptionIds?: number[];
        cameraOptionIds?: number[];
      };
    }) | undefined;

    expect(dTask).toBeTruthy();
    expect(dTask?.taskMetadata?.faultOptionIds).toEqual([selectedFault.id]);
    expect(dTask?.taskMetadata?.appearanceOptionIds).toEqual([selectedAppearance.id]);
    expect(dTask?.taskMetadata?.cameraOptionIds).toEqual([selectedCamera.id]);
    expect(dTask?.inheritedCFaultSummary).toBe(conflictingFault.label);
    expect(dTask?.inheritedCAppearanceSummary).toBe(conflictingAppearance.label);
    expect(dTask?.inheritedCCameraSummary).toBe(conflictingCamera.label);
  }, 20000);
});
