import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  defectOptions,
  engineerDailyProductivity,
  InsertUser,
  productArchives,
  productCategories,
  productivityScoreDetails,
  productivityTargetConfigs,
  products,
  samplingResults,
  sheetSyncJobs,
  stationEvents,
  stationRules,
  stationTasks,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

const STATION_CODES = ["A1", "A2", "B", "C", "D", "E", "STOCK"] as const;
type StationCode = (typeof STATION_CODES)[number];
type DefectOptionType = "fault" | "appearance";

type StationStatusSummary = {
  stationCode: StationCode;
  label: string;
  pendingCount: number;
  todayNewCount: number;
  overdueCount: number;
};

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function stationToLabel(code: StationCode) {
  return {
    A1: "A1 點到貨",
    A2: "A2 安裝",
    B: "B 站軟測",
    C: "C 站品檢",
    D: "D 站抽樣",
    E: "E 站抹除",
    STOCK: "待入庫",
  }[code];
}

function nextStationFor(code: StationCode): StationCode | null {
  const mapping: Record<StationCode, StationCode | null> = {
    A1: "A2",
    A2: "B",
    B: "C",
    C: "D",
    D: "E",
    E: "STOCK",
    STOCK: null,
  };

  return mapping[code];
}

function statusForStation(code: StationCode) {
  return {
    A1: "pending_a1",
    A2: "pending_a2",
    B: "pending_b",
    C: "pending_c",
    D: "pending_d",
    E: "pending_e",
    STOCK: "pending_stock",
  }[code] as
    | "pending_a1"
    | "pending_a2"
    | "pending_b"
    | "pending_c"
    | "pending_d"
    | "pending_e"
    | "pending_stock";
}

async function seedDefectOptionsIfNeeded(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  const existingOptions = await db.select({ count: sql<number>`count(*)` }).from(defectOptions);
  if ((existingOptions[0]?.count ?? 0) > 0) {
    return;
  }

  await db.insert(defectOptions).values([
    { stationCode: "B", optionType: "fault", label: "無法開機", sortOrder: 10 },
    { stationCode: "B", optionType: "fault", label: "觸控異常", sortOrder: 20 },
    { stationCode: "B", optionType: "fault", label: "電池健康異常", sortOrder: 30 },
    { stationCode: "C", optionType: "fault", label: "鏡頭故障", sortOrder: 10 },
    { stationCode: "C", optionType: "fault", label: "Face ID / 指紋異常", sortOrder: 20 },
    { stationCode: "C", optionType: "appearance", label: "螢幕刮傷", sortOrder: 10 },
    { stationCode: "C", optionType: "appearance", label: "邊框凹傷", sortOrder: 20 },
  ]);
}

function buildProductCode(seed: number, index: number) {
  return `P-${seed}-${String(index + 1).padStart(3, "0")}`;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  const values: InsertUser = {
    openId: user.openId,
  };
  const updateSet: Record<string, unknown> = {};

  const textFields = ["name", "email", "loginMethod"] as const;
  type TextField = (typeof textFields)[number];

  const assignNullable = (field: TextField) => {
    const value = user[field];
    if (value === undefined) return;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  };

  textFields.forEach(assignNullable);

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  if (!values.lastSignedIn) {
    values.lastSignedIn = new Date();
  }

  if (Object.keys(updateSet).length === 0) {
    updateSet.lastSignedIn = new Date();
  }

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function ensureMvpSeedData() {
  const db = await getDb();
  if (!db) return;

  await seedDefectOptionsIfNeeded(db);

  const existingProducts = await db.select({ count: sql<number>`count(*)` }).from(products);
  if ((existingProducts[0]?.count ?? 0) > 0) {
    return;
  }

  const today = todayDateString();
  const todayDate = new Date(`${today}T00:00:00`);

  await db.insert(productCategories).values([
    { categoryName: "智慧型手機", subtypeCode: "iPhone", brandName: "Apple" },
    { categoryName: "智慧型手機", subtypeCode: "Android", brandName: "Android" },
  ]);

  const categories = await db.select().from(productCategories).orderBy(asc(productCategories.id));
  const iphone = categories.find((item) => item.subtypeCode === "iPhone");
  const android = categories.find((item) => item.subtypeCode === "Android");

  await db.insert(stationRules).values([
    { stationCode: "A1", routeKey: "default", nextStationCode: "A2", allowReworkToCode: "A1", notes: "A1 完成後進入 A2" },
    { stationCode: "A2", routeKey: "default", nextStationCode: "B", allowReworkToCode: "A1", notes: "A2 完成後進入 B" },
    { stationCode: "B", routeKey: "default", nextStationCode: "C", allowReworkToCode: "A2", notes: "B 完成後進入 C" },
    { stationCode: "C", routeKey: "default", nextStationCode: "D", allowReworkToCode: "C", notes: "C 完成後進入 D" },
    { stationCode: "D", routeKey: "default", nextStationCode: "E", allowReworkToCode: "C", notes: "D 失敗返工回 C" },
    { stationCode: "E", routeKey: "default", nextStationCode: "STOCK", allowReworkToCode: "C", notes: "E 完成後待入庫" },
    { stationCode: "STOCK", routeKey: "default", active: true, notes: "待入庫結案" },
  ]);

  if (iphone && android) {
    await db.insert(productivityTargetConfigs).values([
      { stationCode: "A1", categoryId: iphone.id, subtypeCode: "iPhone", dailyTargetQty: 300, baseUnitPoints: "0.003333", effectiveFrom: todayDate },
      { stationCode: "A1", categoryId: android.id, subtypeCode: "Android", dailyTargetQty: 200, baseUnitPoints: "0.005000", effectiveFrom: todayDate },
      { stationCode: "B", categoryId: iphone.id, subtypeCode: "iPhone", dailyTargetQty: 150, baseUnitPoints: "0.006667", effectiveFrom: todayDate },
      { stationCode: "B", categoryId: android.id, subtypeCode: "Android", dailyTargetQty: 100, baseUnitPoints: "0.010000", effectiveFrom: todayDate },
      { stationCode: "C", categoryId: iphone.id, subtypeCode: "iPhone", dailyTargetQty: 180, baseUnitPoints: "0.005556", effectiveFrom: todayDate },
      { stationCode: "C", categoryId: android.id, subtypeCode: "Android", dailyTargetQty: 140, baseUnitPoints: "0.007143", effectiveFrom: todayDate },
      { stationCode: "E", categoryId: iphone.id, subtypeCode: "iPhone", dailyTargetQty: 220, baseUnitPoints: "0.004545", effectiveFrom: todayDate },
      { stationCode: "E", categoryId: android.id, subtypeCode: "Android", dailyTargetQty: 180, baseUnitPoints: "0.005556", effectiveFrom: todayDate },
    ]);
  }

  await db.insert(products).values([
    {
      productCode: "P-100001",
      batchNo: "BATCH-240420-01",
      serialNumber: "SN-IP-001",
      imei: "356000000000001",
      productName: "iPhone 13",
      categoryId: iphone?.id,
      currentStationCode: "A1",
      currentStatus: "pending_a1",
    },
    {
      productCode: "P-100002",
      batchNo: "BATCH-240420-01",
      serialNumber: "SN-AN-001",
      imei: "356000000000002",
      productName: "Galaxy S22",
      categoryId: android?.id,
      currentStationCode: "B",
      currentStatus: "pending_b",
    },
    {
      productCode: "P-100003",
      batchNo: "BATCH-240420-02",
      serialNumber: "SN-IP-002",
      imei: "356000000000003",
      productName: "iPhone 12",
      categoryId: iphone?.id,
      currentStationCode: "C",
      currentStatus: "pending_c",
    },
    {
      productCode: "P-100004",
      batchNo: "BATCH-240420-02",
      serialNumber: "SN-AN-002",
      imei: "356000000000004",
      productName: "Pixel 8",
      categoryId: android?.id,
      currentStationCode: "D",
      currentStatus: "pending_d",
    },
    {
      productCode: "P-100005",
      batchNo: "BATCH-240420-03",
      serialNumber: "SN-IP-003",
      imei: "356000000000005",
      productName: "iPhone 11",
      categoryId: iphone?.id,
      currentStationCode: "E",
      currentStatus: "pending_e",
    },
  ]);

  const seededProducts = await db.select().from(products).orderBy(asc(products.id));
  await db.insert(stationTasks).values(
    seededProducts.map((product, index) => ({
      productId: product.id,
      stationCode: product.currentStationCode,
      taskStatus: (index === 1 ? "overdue" : "pending") as "overdue" | "pending",
      dueDate: todayDate,
      isOverdue: index === 1,
      resultSummary: "MVP seed task",
      metadata: { source: "seed" },
    })),
  );
}

export async function getStationOverviewData() {
  const db = await getDb();
  if (!db) {
    return STATION_CODES.map((code) => ({
      stationCode: code,
      label: stationToLabel(code),
      pendingCount: 0,
      todayNewCount: 0,
      overdueCount: 0,
    } satisfies StationStatusSummary));
  }

  await ensureMvpSeedData();
  const tasks = await db.select().from(stationTasks);
  const today = todayDateString();
  const todayDate = new Date(`${today}T00:00:00`);

  return STATION_CODES.map((code) => {
    const taskRows = tasks.filter((task) => task.stationCode === code && task.taskStatus !== "completed" && task.taskStatus !== "archived");
    const pendingCount = taskRows.length;
    const todayNewCount = taskRows.filter((task) => String(task.createdAt).slice(0, 10) === today).length;
    const overdueCount = taskRows.filter((task) => task.isOverdue || task.taskStatus === "overdue").length;

    return {
      stationCode: code,
      label: stationToLabel(code),
      pendingCount,
      todayNewCount,
      overdueCount,
    } satisfies StationStatusSummary;
  });
}

export async function getDefectOptions(stationCode: StationCode, optionType: DefectOptionType) {
  const db = await getDb();
  if (!db) {
    return [];
  }

  await ensureMvpSeedData();
  return db
    .select()
    .from(defectOptions)
    .where(and(eq(defectOptions.stationCode, stationCode), eq(defectOptions.optionType, optionType)))
    .orderBy(asc(defectOptions.sortOrder), asc(defectOptions.id));
}

export async function getStationPageData(stationCode: StationCode) {
  const db = await getDb();
  if (!db) {
    return { stationCode, label: stationToLabel(stationCode), tasks: [], faultOptions: [], appearanceOptions: [] };
  }

  await ensureMvpSeedData();
  const rows = await db
    .select({
      taskId: stationTasks.id,
      taskStatus: stationTasks.taskStatus,
      isOverdue: stationTasks.isOverdue,
      productId: products.id,
      productCode: products.productCode,
      batchNo: products.batchNo,
      serialNumber: products.serialNumber,
      imei: products.imei,
      productName: products.productName,
      currentStationCode: products.currentStationCode,
      subtypeCode: productCategories.subtypeCode,
      categoryName: productCategories.categoryName,
    })
    .from(stationTasks)
    .innerJoin(products, eq(stationTasks.productId, products.id))
    .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
    .where(and(eq(stationTasks.stationCode, stationCode), inArray(stationTasks.taskStatus, ["pending", "in_progress", "overdue", "returned"])))
    .orderBy(desc(stationTasks.isOverdue), asc(stationTasks.id));

  const [faultOptions, appearanceOptions] = await Promise.all([
    stationCode === "B" || stationCode === "C" ? getDefectOptions(stationCode, "fault") : Promise.resolve([]),
    stationCode === "C" ? getDefectOptions(stationCode, "appearance") : Promise.resolve([]),
  ]);

  return {
    stationCode,
    label: stationToLabel(stationCode),
    tasks: rows,
    faultOptions,
    appearanceOptions,
  };
}

export async function importProducts(input: {
  poNumber?: string | null;
  importedByUserId?: number | null;
  rows: Array<{
    batchNo?: string | null;
    serialNumber?: string | null;
    imei?: string | null;
    productName: string;
    categoryId?: number | null;
  }>;
}) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  await ensureMvpSeedData();
  const businessDate = todayDateString();
  const businessDateValue = new Date(`${businessDate}T00:00:00`);
  const importSeed = Date.now();
  const createdProducts: Array<{ id: number; productCode: string; productName: string | null }> = [];

  for (let index = 0; index < input.rows.length; index += 1) {
    const row = input.rows[index]!;
    const productCode = buildProductCode(importSeed, index);
    await db.insert(products).values({
      productCode,
      batchNo: row.batchNo ?? null,
      serialNumber: row.serialNumber ?? null,
      imei: row.imei ?? null,
      productName: row.productName,
      categoryId: row.categoryId ?? null,
      currentStationCode: "A1",
      currentStatus: "pending_a1",
      inspectionSummary: input.poNumber ? `PO:${input.poNumber}` : null,
    });

    const created = await db.select().from(products).where(eq(products.productCode, productCode)).limit(1);
    const product = created[0];
    if (!product) continue;

    createdProducts.push({ id: product.id, productCode: product.productCode, productName: product.productName ?? null });

    await db.insert(stationTasks).values({
      productId: product.id,
      stationCode: "A1",
      taskStatus: "pending",
      dueDate: businessDateValue,
      resultSummary: "A1 點到貨待處理",
      metadata: {
        source: "import",
        poNumber: input.poNumber ?? null,
      },
    });
  }

  await db.insert(sheetSyncJobs).values({
    jobType: "product_import_sync",
    targetSheetName: "手機檢測資料庫",
    status: "queued",
  });

  return {
    success: true as const,
    importedCount: createdProducts.length,
    poNumber: input.poNumber ?? null,
    products: createdProducts,
  };
}

export async function completeStationTask(input: {
  taskId: number;
  stationCode: StationCode;
  operatorUserId: number;
  productId: number;
  categoryId?: number | null;
  subtypeCode?: string | null;
  summary?: string;
  faultOptionIds?: number[];
  appearanceOptionIds?: number[];
}) {
  const db = await getDb();
  if (!db) {
    return { success: false as const, message: "Database unavailable" };
  }

  const nextStation = nextStationFor(input.stationCode);
  const businessDate = todayDateString();
  const businessDateValue = new Date(`${businessDate}T00:00:00`);
  const selectedOptionIds = Array.from(new Set([...(input.faultOptionIds ?? []), ...(input.appearanceOptionIds ?? [])]));
  const selectedOptions = selectedOptionIds.length
    ? await db.select().from(defectOptions).where(inArray(defectOptions.id, selectedOptionIds))
    : [];
  const faultLabels = selectedOptions.filter((option) => option.optionType === "fault").map((option) => option.label);
  const appearanceLabels = selectedOptions.filter((option) => option.optionType === "appearance").map((option) => option.label);

  await db
    .update(stationTasks)
    .set({
      taskStatus: "completed",
      completedAt: new Date(),
      resultSummary: input.summary ?? "已完成站點作業",
      updatedAt: new Date(),
    })
    .where(eq(stationTasks.id, input.taskId));

  await db.insert(stationEvents).values({
    productId: input.productId,
    stationTaskId: input.taskId,
    stationCode: input.stationCode,
    eventType: "complete",
    operatorUserId: input.operatorUserId,
    businessDate: businessDateValue,
    categoryId: input.categoryId ?? null,
    subtypeCode: input.subtypeCode ?? null,
    payload: {
      summary: input.summary ?? "已完成站點作業",
      faultOptionIds: input.faultOptionIds ?? [],
      appearanceOptionIds: input.appearanceOptionIds ?? [],
      faultLabels,
      appearanceLabels,
    },
  });

  await db.insert(sheetSyncJobs).values({
    jobType: "station_task_sync",
    targetSheetName: "手機檢測資料庫",
    status: "queued",
  });

  if (nextStation) {
    await db
      .update(products)
      .set({
        currentStationCode: nextStation,
        currentStatus: statusForStation(nextStation),
        updatedAt: new Date(),
      })
      .where(eq(products.id, input.productId));

    await db.insert(stationTasks).values({
      productId: input.productId,
      stationCode: nextStation,
      taskStatus: "pending",
      dueDate: businessDateValue,
      resultSummary: `${stationToLabel(nextStation)} 待處理`,
      metadata: {
        sourceStation: input.stationCode,
        faultLabels,
        appearanceLabels,
      },
    });
  } else {
    await db
      .update(products)
      .set({
        currentStatus: "completed",
        stockStatus: "stocked",
        updatedAt: new Date(),
      })
      .where(eq(products.id, input.productId));
  }

  return { success: true as const };
}

export async function getSamplingQueue() {
  return getStationPageData("D");
}

export async function submitSamplingResult(input: {
  taskId: number;
  productId: number;
  sampledByUserId: number;
  passed: boolean;
  defectReason?: string;
}) {
  const db = await getDb();
  if (!db) {
    return { success: false as const, message: "Database unavailable" };
  }

  const taskRows = await db
    .select({
      productId: stationTasks.productId,
      stationCode: stationTasks.stationCode,
      categoryId: products.categoryId,
      subtypeCode: productCategories.subtypeCode,
    })
    .from(stationTasks)
    .innerJoin(products, eq(stationTasks.productId, products.id))
    .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
    .where(eq(stationTasks.id, input.taskId))
    .limit(1);

  const task = taskRows[0];
  if (!task) {
    return { success: false as const, message: "Task not found" };
  }

  const businessDate = todayDateString();
  const businessDateValue = new Date(`${businessDate}T00:00:00`);

  await db.insert(samplingResults).values({
    productId: input.productId,
    stationTaskId: input.taskId,
    sampledByUserId: input.sampledByUserId,
    sampleDate: businessDateValue,
    passed: input.passed,
    defectReason: input.defectReason ?? null,
    reworkToStationCode: "C",
  });

  await db
    .update(stationTasks)
    .set({
      taskStatus: "completed",
      completedAt: new Date(),
      resultSummary: input.passed ? "抽樣通過" : "抽樣不通過，返工回 C",
      updatedAt: new Date(),
    })
    .where(eq(stationTasks.id, input.taskId));

  await db.insert(stationEvents).values({
    productId: input.productId,
    stationTaskId: input.taskId,
    stationCode: "D",
    eventType: input.passed ? "sampling_pass" : "sampling_fail",
    operatorUserId: input.sampledByUserId,
    businessDate: businessDateValue,
    categoryId: task.categoryId ?? null,
    subtypeCode: task.subtypeCode ?? null,
    isRework: !input.passed,
    payload: { defectReason: input.defectReason ?? null },
  });

  await db.insert(sheetSyncJobs).values({
    jobType: input.passed ? "sampling_pass_sync" : "sampling_fail_sync",
    targetSheetName: "手機檢測資料庫",
    status: "queued",
  });

  if (input.passed) {
    await db
      .update(products)
      .set({
        currentStationCode: "E",
        currentStatus: "pending_e",
        updatedAt: new Date(),
      })
      .where(eq(products.id, input.productId));

    await db.insert(stationTasks).values({
      productId: input.productId,
      stationCode: "E",
      taskStatus: "pending",
      dueDate: businessDateValue,
      resultSummary: "E 站待抹除",
      metadata: { sourceStation: "D", sampled: true },
    });
  } else {
    await db
      .update(products)
      .set({
        currentStationCode: "C",
        currentStatus: "pending_c",
        updatedAt: new Date(),
      })
      .where(eq(products.id, input.productId));

    await db.insert(stationTasks).values({
      productId: input.productId,
      stationCode: "C",
      taskStatus: "returned",
      dueDate: businessDateValue,
      resultSummary: "D 站抽樣失敗返工回 C",
      metadata: { sourceStation: "D", reason: input.defectReason ?? "抽樣不通過" },
    });
  }

  return { success: true as const };
}

export async function getEngineerKpiSummary(userId: number) {
  const db = await getDb();
  if (!db) {
    return {
      dailySummary: null,
      details: [],
      monthlySummary: { attendanceDays: 0, monthTotalPoints: 0, monthAvgPoints: 0, monthAvgRate: 0 },
    };
  }

  await ensureMvpSeedData();
  const businessDate = todayDateString();
  const businessDateValue = new Date(`${businessDate}T00:00:00`);
  const monthPrefix = businessDate.slice(0, 7);
  const toDateKey = (value: Date) => value.toISOString().slice(0, 10);

  const detailRows = await db
    .select({
      stationCode: productivityScoreDetails.stationCode,
      subtypeCode: productivityScoreDetails.subtypeCode,
      completedQty: productivityScoreDetails.completedQty,
      earnedPoints: productivityScoreDetails.earnedPoints,
      baseUnitPoints: productivityScoreDetails.baseUnitPoints,
      businessDate: productivityScoreDetails.businessDate,
    })
    .from(productivityScoreDetails)
    .where(eq(productivityScoreDetails.userId, userId))
    .orderBy(desc(productivityScoreDetails.id));

  const eventRows = await db
    .select({
      productId: stationEvents.productId,
      stationCode: stationEvents.stationCode,
      eventType: stationEvents.eventType,
      isRework: stationEvents.isRework,
      businessDate: stationEvents.businessDate,
    })
    .from(stationEvents)
    .where(eq(stationEvents.operatorUserId, userId));

  const samplingRows = await db
    .select({
      passed: samplingResults.passed,
      sampleDate: samplingResults.sampleDate,
      sampledByUserId: samplingResults.sampledByUserId,
    })
    .from(samplingResults)
    .where(eq(samplingResults.sampledByUserId, userId));

  const userProductIds = Array.from(new Set(eventRows.map((row) => row.productId)));
  const relatedTasks = userProductIds.length
    ? await db
        .select({
          productId: stationTasks.productId,
          stationCode: stationTasks.stationCode,
          isOverdue: stationTasks.isOverdue,
          createdAt: stationTasks.createdAt,
          updatedAt: stationTasks.updatedAt,
          taskStatus: stationTasks.taskStatus,
        })
        .from(stationTasks)
        .where(inArray(stationTasks.productId, userProductIds))
    : [];

  const dailyDetails = detailRows.filter((row) => toDateKey(row.businessDate) === businessDate);
  const monthDetails = detailRows.filter((row) => row.businessDate.toISOString().slice(0, 7) === monthPrefix);
  const dailyEvents = eventRows.filter((row) => toDateKey(row.businessDate) === businessDate);
  const dailySampling = samplingRows.filter((row) => toDateKey(row.sampleDate) === businessDate);
  const completedEvents = dailyEvents.filter((row) => row.eventType === "complete");
  const reworkEvents = dailyEvents.filter((row) => row.isRework);

  const totalPoints = dailyDetails.reduce((sum, row) => sum + Number(row.earnedPoints), 0);
  const rawAchievementRate = totalPoints * 100;
  const kpiAchievementRate = Math.min(rawAchievementRate, 100);
  const overAchievementRate = Math.max(rawAchievementRate - 100, 0);
  const attendanceDays = new Set(monthDetails.map((row) => toDateKey(row.businessDate))).size;
  const monthTotalPoints = monthDetails.reduce((sum, row) => sum + Number(row.earnedPoints), 0);
  const monthAvgPoints = attendanceDays > 0 ? monthTotalPoints / attendanceDays : 0;

  const failedSamples = dailySampling.filter((row) => !row.passed).length;
  const totalSamples = dailySampling.length;
  const defectRate = totalSamples > 0 ? failedSamples / totalSamples : 0;
  const reworkRate = completedEvents.length > 0 ? reworkEvents.length / completedEvents.length : 0;
  const qualityScore = Math.max(0, 100 - defectRate * 100 - reworkRate * 50);

  const taskMap = new Map(relatedTasks.map((task) => [`${task.productId}-${task.stationCode}`, task]));
  const matchedTasks = completedEvents
    .map((event) => taskMap.get(`${event.productId}-${event.stationCode}`))
    .filter((task): task is (typeof relatedTasks)[number] => Boolean(task));
  const overdueHandledCount = matchedTasks.filter((task) => task.isOverdue).length;
  const avgProcessingHours = matchedTasks.length > 0
    ? matchedTasks.reduce((sum, task) => sum + (task.updatedAt.getTime() - task.createdAt.getTime()) / 36e5, 0) / matchedTasks.length
    : 0;
  const timelinessScore = Math.max(0, 100 - overdueHandledCount * 10 - avgProcessingHours * 5);

  const fairnessScore = Math.min(100, monthAvgPoints * 100);

  return {
    dailySummary: {
      businessDate: businessDateValue,
      totalPoints,
      rawAchievementRate,
      kpiAchievementRate,
      overAchievementRate,
      dimensions: {
        productivity: {
          score: Math.min(kpiAchievementRate, 100),
          totalPoints,
        },
        quality: {
          score: qualityScore,
          defectRate,
          reworkRate,
        },
        timeliness: {
          score: timelinessScore,
          overdueHandledCount,
          avgProcessingHours,
        },
        fairness: {
          score: fairnessScore,
          monthAvgPoints,
        },
      },
    },
    details: dailyDetails,
    monthlySummary: {
      attendanceDays,
      monthTotalPoints,
      monthAvgPoints,
      monthAvgRate: monthAvgPoints * 100,
    },
  };
}

export async function seedKpiForDemo(userId: number) {
  const db = await getDb();
  if (!db) return;

  await ensureMvpSeedData();
  const existing = await db.select({ count: sql<number>`count(*)` }).from(productivityScoreDetails).where(eq(productivityScoreDetails.userId, userId));
  if ((existing[0]?.count ?? 0) > 0) {
    return;
  }

  const businessDate = todayDateString();
  const businessDateValue = new Date(`${businessDate}T00:00:00`);
  const categoryRows = await db.select().from(productCategories);
  const iphone = categoryRows.find((item) => item.subtypeCode === "iPhone");
  const android = categoryRows.find((item) => item.subtypeCode === "Android");
  const productRows = await db.select().from(products).limit(4);

  const events = await db.insert(stationEvents).values([
    {
      productId: productRows[0]?.id ?? 1,
      stationCode: "A1",
      eventType: "complete",
      operatorUserId: userId,
      businessDate: businessDateValue,
      categoryId: iphone?.id ?? null,
      subtypeCode: "iPhone",
    },
    {
      productId: productRows[1]?.id ?? 2,
      stationCode: "A1",
      eventType: "complete",
      operatorUserId: userId,
      businessDate: businessDateValue,
      categoryId: android?.id ?? null,
      subtypeCode: "Android",
    },
    {
      productId: productRows[2]?.id ?? 3,
      stationCode: "B",
      eventType: "complete",
      operatorUserId: userId,
      businessDate: businessDateValue,
      categoryId: iphone?.id ?? null,
      subtypeCode: "iPhone",
    },
    {
      productId: productRows[3]?.id ?? 4,
      stationCode: "B",
      eventType: "complete",
      operatorUserId: userId,
      businessDate: businessDateValue,
      categoryId: android?.id ?? null,
      subtypeCode: "Android",
    },
  ]);

  const eventRows = await db.select().from(stationEvents).where(and(eq(stationEvents.operatorUserId, userId), eq(stationEvents.businessDate, businessDateValue))).orderBy(desc(stationEvents.id)).limit(4);

  await db.insert(productivityScoreDetails).values([
    {
      businessDate: businessDateValue,
      userId,
      stationEventId: eventRows[3]?.id ?? 1,
      productId: productRows[0]?.id ?? 1,
      stationCode: "A1",
      categoryId: iphone?.id ?? null,
      subtypeCode: "iPhone",
      completedQty: 100,
      baseUnitPoints: "0.003333",
      reworkFactor: "1.0000",
      qualityFactor: "1.0000",
      earnedPoints: "0.333300",
    },
    {
      businessDate: businessDateValue,
      userId,
      stationEventId: eventRows[2]?.id ?? 1,
      productId: productRows[1]?.id ?? 2,
      stationCode: "A1",
      categoryId: android?.id ?? null,
      subtypeCode: "Android",
      completedQty: 50,
      baseUnitPoints: "0.005000",
      reworkFactor: "1.0000",
      qualityFactor: "1.0000",
      earnedPoints: "0.250000",
    },
    {
      businessDate: businessDateValue,
      userId,
      stationEventId: eventRows[1]?.id ?? 1,
      productId: productRows[2]?.id ?? 3,
      stationCode: "B",
      categoryId: iphone?.id ?? null,
      subtypeCode: "iPhone",
      completedQty: 50,
      baseUnitPoints: "0.006667",
      reworkFactor: "1.0000",
      qualityFactor: "1.0000",
      earnedPoints: "0.333350",
    },
    {
      businessDate: businessDateValue,
      userId,
      stationEventId: eventRows[0]?.id ?? 1,
      productId: productRows[3]?.id ?? 4,
      stationCode: "B",
      categoryId: android?.id ?? null,
      subtypeCode: "Android",
      completedQty: 20,
      baseUnitPoints: "0.010000",
      reworkFactor: "1.0000",
      qualityFactor: "1.0000",
      earnedPoints: "0.200000",
    },
  ]);

  await db.insert(engineerDailyProductivity).values({
    businessDate: businessDateValue,
    userId,
    totalPoints: "1.116650",
    rawAchievementRate: "111.67",
    kpiAchievementRate: "100.00",
    overAchievementRate: "11.67",
    samplingFailRate: "0.0100",
    reworkRate: "0.0200",
    overdueCount: 1,
    avgProcessHours: "1.80",
    attendanceFairnessFactor: "1.0000",
    finalKpiScore: "96.670000",
  }).onDuplicateKeyUpdate({
    set: {
      totalPoints: "1.116650",
      rawAchievementRate: "111.67",
      kpiAchievementRate: "100.00",
      overAchievementRate: "11.67",
      samplingFailRate: "0.0100",
      reworkRate: "0.0200",
      overdueCount: 1,
      avgProcessHours: "1.80",
      attendanceFairnessFactor: "1.0000",
      finalKpiScore: "96.670000",
    },
  });
}

export async function archiveExpiredData() {
  const db = await getDb();
  if (!db) {
    return { archivedCount: 0 };
  }

  const expiredProducts = await db
    .select()
    .from(products)
    .where(and(isNull(products.archivedAt), sql`${products.createdAt} < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 6 MONTH)`))
    .limit(100);

  if (expiredProducts.length === 0) {
    return { archivedCount: 0 };
  }

  const archiveMonth = new Date().toISOString().slice(0, 7);
  const productIds = expiredProducts.map((item) => item.id);

  await db.insert(productArchives).values(
    expiredProducts.map((product) => ({
      originalProductId: product.id,
      productSnapshot: product,
      archiveMonth,
    })),
  );

  await db
    .update(products)
    .set({ archivedAt: new Date() })
    .where(inArray(products.id, productIds));

  await db
    .update(stationTasks)
    .set({ taskStatus: "archived" })
    .where(inArray(stationTasks.productId, productIds));

  return { archivedCount: expiredProducts.length };
}

export async function getAdminSetupData() {
  const db = await getDb();
  if (!db) {
    return { users: [], rules: [], categories: [], targets: [] };
  }

  await ensureMvpSeedData();
  const queuedSyncJobs = await db
    .select({ count: sql<number>`count(*)` })
    .from(sheetSyncJobs)
    .where(eq(sheetSyncJobs.status, "queued"));

  const archiveCandidates = await db
    .select({ count: sql<number>`count(*)` })
    .from(products)
    .where(and(isNull(products.archivedAt), sql`${products.createdAt} < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 6 MONTH)`));

  return {
    users: await db.select().from(users).orderBy(asc(users.id)),
    rules: await db.select().from(stationRules).orderBy(asc(stationRules.id)),
    categories: await db.select().from(productCategories).orderBy(asc(productCategories.id)),
    targets: await db.select().from(productivityTargetConfigs).orderBy(asc(productivityTargetConfigs.id)),
    defectOptions: await db.select().from(defectOptions).orderBy(asc(defectOptions.stationCode), asc(defectOptions.optionType), asc(defectOptions.sortOrder), asc(defectOptions.id)),
    syncSummary: {
      queuedJobs: queuedSyncJobs[0]?.count ?? 0,
      targetSheetName: "手機檢測資料庫",
    },
    archiveSummary: {
      retentionMonths: 6,
      candidateCount: archiveCandidates[0]?.count ?? 0,
      policy: "主表僅保留六個月內資料，超過六個月資料移入歷史資料表。",
    },
  };
}

export async function upsertDefectOption(input: {
  id?: number;
  stationCode: StationCode;
  optionType: DefectOptionType;
  label: string;
  active: boolean;
  sortOrder: number;
}) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  if (input.id) {
    await db
      .update(defectOptions)
      .set({
        stationCode: input.stationCode,
        optionType: input.optionType,
        label: input.label,
        active: input.active,
        sortOrder: input.sortOrder,
      })
      .where(eq(defectOptions.id, input.id));

    const rows = await db.select().from(defectOptions).where(eq(defectOptions.id, input.id)).limit(1);
    return rows[0] ?? null;
  }

  await db.insert(defectOptions).values({
    stationCode: input.stationCode,
    optionType: input.optionType,
    label: input.label,
    active: input.active,
    sortOrder: input.sortOrder,
  });

  const rows = await db
    .select()
    .from(defectOptions)
    .where(and(eq(defectOptions.stationCode, input.stationCode), eq(defectOptions.optionType, input.optionType), eq(defectOptions.label, input.label)))
    .orderBy(desc(defectOptions.id))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateStationRule(input: {
  id: number;
  routeKey: string;
  nextStationCode: StationCode | null;
  allowReworkToCode: StationCode | null;
  active: boolean;
  notes?: string | null;
}) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  await db
    .update(stationRules)
    .set({
      routeKey: input.routeKey,
      nextStationCode: input.nextStationCode,
      allowReworkToCode: input.allowReworkToCode,
      active: input.active,
      notes: input.notes ?? null,
    })
    .where(eq(stationRules.id, input.id));

  const rows = await db.select().from(stationRules).where(eq(stationRules.id, input.id)).limit(1);
  return rows[0] ?? null;
}

export async function updateProductivityTarget(input: {
  id: number;
  stationCode: StationCode;
  dailyTargetQty: number;
  baseUnitPoints: string;
  active: boolean;
}) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  await db
    .update(productivityTargetConfigs)
    .set({
      stationCode: input.stationCode,
      dailyTargetQty: input.dailyTargetQty,
      baseUnitPoints: input.baseUnitPoints,
      active: input.active,
    })
    .where(eq(productivityTargetConfigs.id, input.id));

  const rows = await db.select().from(productivityTargetConfigs).where(eq(productivityTargetConfigs.id, input.id)).limit(1);
  return rows[0] ?? null;
}
