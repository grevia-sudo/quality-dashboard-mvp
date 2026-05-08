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

describe("C 站承接 B 站故障點 integration", () => {
  beforeAll(async () => {
    await ensureMvpSeedData();
  });

  afterAll(async () => {
    await archiveCreatedRows();
  });

  it("在待檢 C 站任務的 bFault metadata 為空時，仍會回退帶出 B 站已完成故障點", async () => {
    const uniqueSuffix = `${Date.now()}`;
    const poNumber = `PO-C-BFAULT-${uniqueSuffix}`;
    const batchNo = `C-BFAULT-${uniqueSuffix}`;
    createdPoNumbers.add(poNumber);

    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

    const bFaultOption = await db
      .select({
        id: defectOptions.id,
        label: defectOptions.label,
      })
      .from(defectOptions)
      .where(and(eq(defectOptions.stationCode, "B"), eq(defectOptions.optionType, "fault"), eq(defectOptions.active, true)))
      .limit(1);

    expect(bFaultOption[0]?.id).toBeTruthy();

    const insertedProduct = await db.insert(products).values({
      productCode: `P-C-BFAULT-${uniqueSuffix}`,
      poNumber,
      vendorName: "C 站承接測試",
      batchNo,
      serialNumber: `C-BFAULT-SN-${uniqueSuffix}`,
      imei: `93${`${uniqueSuffix}`.padStart(13, "0").slice(-13)}`,
      productName: "C Station Carryover Device",
      currentStationCode: "C",
      currentStatus: "pending_c",
      importedCategoryName: "智慧手機",
      importedBrandName: "Apple",
    }).$returningId();

    const productId = insertedProduct[0]?.id;
    expect(productId).toBeTruthy();

    await db.insert(stationTasks).values([
      {
        productId: productId!,
        stationCode: "B",
        taskStatus: "completed",
        dueDate: new Date(),
        completedAt: new Date(),
        resultSummary: "B 站軟體測試完成",
        metadata: {
          faultOptionIds: [bFaultOption[0]!.id],
          faultLabels: [bFaultOption[0]!.label],
          faultSummary: bFaultOption[0]!.label,
          batteryNote: "97%",
          batteryIssueLabels: [],
          batterySummary: "97%",
          applyBChanges: false,
        },
      },
      {
        productId: productId!,
        stationCode: "C",
        taskStatus: "pending",
        dueDate: new Date(),
        resultSummary: "C 站待品檢",
        metadata: {
          sourceStation: "B",
          bFaultOptionIds: [],
          bFaultLabels: [],
          batteryNote: "97%",
          batteryIssueLabels: [],
          batterySummary: "97%",
          applyBChanges: false,
        },
      },
    ]);

    const cStationData = await getStationPageData("C");
    const targetTask = cStationData.tasks.find((task) => task.batchNo === batchNo);

    expect(targetTask?.inheritedBFaultOptionIds).toEqual([bFaultOption[0]!.id]);
    expect(targetTask?.inheritedBFaultLabels).toEqual([bFaultOption[0]!.label]);
    expect(targetTask?.inheritedBFaultSummary).toBe(bFaultOption[0]!.label);
  }, 20000);
});
