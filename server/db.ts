import { spawn } from "node:child_process";
import { and, asc, count, desc, eq, gte, inArray, isNull, like, lte, notInArray, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  defectOptions,
  engineerDailyProductivity,
  InsertUser,
  productArchives,
  productCategories,
  productNameOptions,
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
type DefectOptionType = "fault" | "appearance" | "camera";

type StationStatusSummary = {
  stationCode: StationCode;
  label: string;
  pendingCount: number;
  todayNewCount: number;
  overdueCount: number;
};

let _db: ReturnType<typeof drizzle> | null = null;
let purchaseSheetSyncTriggeredAt = 0;
let purchaseSheetSyncPromise: Promise<void> | null = null;

async function runPurchaseSheetSyncInProcess() {
  if (purchaseSheetSyncPromise) {
    return purchaseSheetSyncPromise;
  }

  purchaseSheetSyncPromise = (async () => {
    try {
      // @ts-expect-error runtime import of reusable ESM sync script
      const { runPurchaseSheetSync } = await import("../scripts/sync-purchase-sheet.mjs");
      await runPurchaseSheetSync();
    } catch (error) {
      console.error("[purchase-sheet-sync] background sync failed", error);
    } finally {
      purchaseSheetSyncPromise = null;
    }
  })();

  return purchaseSheetSyncPromise;
}

function triggerPurchaseSheetSyncInBackground() {
  const now = Date.now();
  if (now - purchaseSheetSyncTriggeredAt < 10_000) {
    return;
  }

  purchaseSheetSyncTriggeredAt = now;

  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    const command = "cd /home/ubuntu/quality-dashboard-mvp && pnpm sync:purchase-sheet >/tmp/quality-dashboard-purchase-sheet-sync.log 2>&1";
    const child = spawn("bash", ["-lc", command], {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        HOME: process.env.HOME ?? "/home/ubuntu",
        GOOGLE_WORKSPACE_CLI_TOKEN: process.env.GOOGLE_WORKSPACE_CLI_TOKEN,
        GOOGLE_DRIVE_TOKEN: process.env.GOOGLE_DRIVE_TOKEN,
      },
    });

    child.unref();
    return;
  }

  void runPurchaseSheetSyncInProcess();
}

function queueA1CompletionSideEffectsInBackground(input: {
  productId: number;
  stationTaskId: number;
  operatorUserId: number;
  businessDate: Date;
  completedAt: Date;
  categoryId?: number | null;
  nextStation?: StationCode | null;
}) {
  void (async () => {
    const db = await getDb();
    if (!db) {
      return;
    }

    await db
      .update(stationTasks)
      .set({
        taskStatus: "completed",
        completedAt: input.completedAt,
        resultSummary: "A1 掃碼點到貨完成",
        updatedAt: input.completedAt,
      })
      .where(eq(stationTasks.id, input.stationTaskId));

    await db.insert(stationEvents).values({
      productId: input.productId,
      stationTaskId: input.stationTaskId,
      stationCode: "A1",
      eventType: "complete",
      operatorUserId: input.operatorUserId,
      businessDate: input.businessDate,
      categoryId: input.categoryId ?? null,
      subtypeCode: null,
      payload: {
        summary: "A1 掃碼點到貨完成",
        faultOptionIds: [],
        appearanceOptionIds: [],
        faultLabels: [],
        appearanceLabels: [],
      },
    });

    if (input.nextStation) {
      await db.insert(stationTasks).values({
        productId: input.productId,
        stationCode: input.nextStation,
        taskStatus: "pending",
        dueDate: input.businessDate,
        resultSummary: `${stationToLabel(input.nextStation)} 待處理`,
        metadata: {
          sourceStation: "A1",
          faultLabels: [],
          appearanceLabels: [],
        },
      });
    }

    await db.insert(sheetSyncJobs).values([
      {
        jobType: "station_task_sync",
        targetSheetName: "手機檢測資料庫",
        status: "queued",
      },
      {
        jobType: "purchase_sheet_sync",
        targetSheetName: "採購單",
        status: "queued",
      },
    ]);

    triggerPurchaseSheetSyncInBackground();
  })().catch((error) => {
    console.error("[A1 Completion Background Sync] Failed to persist side effects", error);
  });
}

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
  const desiredOptions: Array<{ stationCode: "B" | "C"; optionType: "fault" | "appearance" | "camera"; label: string; sortOrder: number }> = [
    { stationCode: "B", optionType: "fault", label: "無法開機", sortOrder: 10 },
    { stationCode: "B", optionType: "fault", label: "觸控異常", sortOrder: 20 },
    { stationCode: "B", optionType: "fault", label: "電池健康異常", sortOrder: 30 },
    { stationCode: "C", optionType: "fault", label: "破裂", sortOrder: 10 },
    { stationCode: "C", optionType: "fault", label: "刮傷", sortOrder: 20 },
    { stationCode: "C", optionType: "appearance", label: "破裂", sortOrder: 10 },
    { stationCode: "C", optionType: "appearance", label: "刮傷", sortOrder: 20 },
    { stationCode: "C", optionType: "camera", label: "破裂", sortOrder: 10 },
    { stationCode: "C", optionType: "camera", label: "刮傷", sortOrder: 20 },
  ];

  const existingOptions = await db.select().from(defectOptions);
  if (existingOptions.length === 0) {
    await db.insert(defectOptions).values(desiredOptions);
    return;
  }

  for (const desiredOption of desiredOptions) {
    const matchedOption = existingOptions.find((option) => (
      option.stationCode === desiredOption.stationCode
      && option.optionType === desiredOption.optionType
      && Number(option.sortOrder ?? 0) === desiredOption.sortOrder
    ));

    if (!matchedOption) {
      await db.insert(defectOptions).values(desiredOption);
      continue;
    }

    if (matchedOption.label !== desiredOption.label) {
      await db
        .update(defectOptions)
        .set({ label: desiredOption.label, active: true, updatedAt: new Date() })
        .where(eq(defectOptions.id, matchedOption.id));
    }
  }
}

async function seedProductNameOptionsIfNeeded(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  const existingOptions = await db.select({ count: sql<number>`count(*)` }).from(productNameOptions);
  if ((existingOptions[0]?.count ?? 0) > 0) {
    return;
  }

  await db.insert(productNameOptions).values([
    { label: "iPhone 13", sortOrder: 10 },
    { label: "iPhone 12", sortOrder: 20 },
    { label: "iPhone 11", sortOrder: 30 },
    { label: "Galaxy S22", sortOrder: 40 },
    { label: "Pixel 8", sortOrder: 50 },
  ]);
}

function buildProductCode(seed: number, index: number) {
  return `P-${seed}-${String(index + 1).padStart(3, "0")}`;
}

function formatPoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function parsePoSequence(poNumber: string | null | undefined, prefix: string) {
  if (!poNumber?.startsWith(`${prefix}-`)) {
    return 0;
  }

  const sequence = Number(poNumber.slice(prefix.length + 1));
  return Number.isInteger(sequence) && sequence > 0 ? sequence : 0;
}

async function generateAutoPoNumber(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  dateSeed: Date,
  reservedPoNumbers: Set<string> = new Set(),
) {
  const prefix = `PO-${formatPoDate(dateSeed)}`;
  const existingRows = await db
    .select({ poNumber: products.poNumber })
    .from(products)
    .where(like(products.poNumber, `${prefix}-%`));

  let maxSequence = 0;
  for (const row of existingRows) {
    maxSequence = Math.max(maxSequence, parsePoSequence(row.poNumber, prefix));
  }
  reservedPoNumbers.forEach((poNumber) => {
    maxSequence = Math.max(maxSequence, parsePoSequence(poNumber, prefix));
  });

  return `${prefix}-${String(maxSequence + 1).padStart(2, "0")}`;
}

function normalizeOptionalText(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseArrivalAt(value?: string | Date | null) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function hasImportIdentity(input: { batchNo?: string | null; serialNumber?: string | null; imei?: string | null }) {
  return Boolean(
    normalizeOptionalText(input.batchNo)
    || normalizeOptionalText(input.serialNumber)
    || normalizeOptionalText(input.imei),
  );
}

async function findPendingA1ProductByIdentity(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  input: { batchNo?: string | null; serialNumber?: string | null; imei?: string | null },
) {
  const imei = normalizeOptionalText(input.imei);
  const serialNumber = normalizeOptionalText(input.serialNumber);
  const batchNo = normalizeOptionalText(input.batchNo);
  const matchConditions = [];
  if (imei) {
    matchConditions.push(eq(products.imei, imei));
  }
  if (serialNumber) {
    matchConditions.push(eq(products.serialNumber, serialNumber));
  }
  if (batchNo) {
    matchConditions.push(eq(products.batchNo, batchNo));
  }

  if (matchConditions.length === 0) {
    return null;
  }

  const rows = await db
    .select({
      id: products.id,
      productCode: products.productCode,
      poNumber: products.poNumber,
      vendorName: products.vendorName,
      importedCategoryName: products.importedCategoryName,
      batchNo: products.batchNo,
      serialNumber: products.serialNumber,
      imei: products.imei,
      productName: products.productName,
      categoryId: products.categoryId,
      currentStationCode: products.currentStationCode,
      currentStatus: products.currentStatus,
      pendingTaskId: stationTasks.id,
    })
    .from(products)
    .leftJoin(
      stationTasks,
      and(
        eq(stationTasks.productId, products.id),
        eq(stationTasks.stationCode, "A1"),
        inArray(stationTasks.taskStatus, ["pending", "in_progress", "overdue", "returned"]),
      ),
    )
    .where(
      and(
        eq(products.currentStationCode, "A1"),
        isNull(products.archivedAt),
        or(...matchConditions),
      ),
    )
    .orderBy(sql`
      CASE
        WHEN ${imei} IS NOT NULL AND ${products.imei} = ${imei} THEN 0
        WHEN ${serialNumber} IS NOT NULL AND ${products.serialNumber} = ${serialNumber} THEN 1
        WHEN ${batchNo} IS NOT NULL AND ${products.batchNo} = ${batchNo} THEN 2
        ELSE 9
      END
    `)
    .limit(1);

  return rows[0] ?? null;
}

async function ensurePendingA1Task(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  productId: number,
  businessDateValue: Date,
  metadata: Record<string, unknown>,
) {
  const existingTask = await db
    .select()
    .from(stationTasks)
    .where(
      and(
        eq(stationTasks.productId, productId),
        eq(stationTasks.stationCode, "A1"),
        inArray(stationTasks.taskStatus, ["pending", "in_progress", "overdue", "returned"]),
      ),
    )
    .limit(1);

  if (existingTask[0]) {
    return existingTask[0];
  }

  await db.insert(stationTasks).values({
    productId,
    stationCode: "A1",
    taskStatus: "pending",
    dueDate: businessDateValue,
    resultSummary: "A1 點到貨待處理",
    metadata,
  });

  const createdTask = await db
    .select()
    .from(stationTasks)
    .where(
      and(
        eq(stationTasks.productId, productId),
        eq(stationTasks.stationCode, "A1"),
      ),
    )
    .orderBy(desc(stationTasks.id))
    .limit(1);

  return createdTask[0] ?? null;
}

function mergeScannedIdentityField(fieldLabel: string, currentValue?: string | null, incomingValue?: string | null) {
  const normalizedCurrent = normalizeOptionalText(currentValue);
  const normalizedIncoming = normalizeOptionalText(incomingValue);

  if (!normalizedIncoming) {
    return normalizedCurrent;
  }

  if (!normalizedCurrent) {
    return normalizedIncoming;
  }

  if (normalizedCurrent === normalizedIncoming) {
    return normalizedCurrent;
  }

  throw new Error(`${fieldLabel} 與既有待點貨資料不一致，請確認掃碼內容是否正確`);
}

export async function completeA1ArrivalByScan(input: {
  operatorUserId: number;
  batchNo?: string | null;
  serialNumber?: string | null;
  imei?: string | null;
  productName?: string | null;
}) {
  const db = await getDb();
  if (!db) {
    return { success: false as const, message: "Database unavailable" };
  }

  if (!hasImportIdentity(input)) {
    return { success: false as const, message: "商品批號、商品序號、IMEI 至少要填一項" };
  }

  const matchedProduct = await findPendingA1ProductByIdentity(db, input);
  if (!matchedProduct) {
    return { success: false as const, message: "找不到符合批號、序號或 IMEI 的 A1 待處理商品" };
  }

  const nextBatchNo = mergeScannedIdentityField("商品批號", matchedProduct.batchNo, input.batchNo);
  const nextSerialNumber = mergeScannedIdentityField("商品序號", matchedProduct.serialNumber, input.serialNumber);
  const nextImei = mergeScannedIdentityField("IMEI", matchedProduct.imei, input.imei);
  const nextProductName = mergeScannedIdentityField("品名", matchedProduct.productName, input.productName);
  const businessDateValue = new Date(`${todayDateString()}T00:00:00`);
  const pendingTaskId = matchedProduct.pendingTaskId ?? (await ensurePendingA1Task(db, matchedProduct.id, businessDateValue, {
    source: "a1_scan_receive",
  }))?.id;

  if (!pendingTaskId) {
    return { success: false as const, message: "找不到可完成的 A1 任務" };
  }

  const completedAt = new Date();
  const nextStation = nextStationFor("A1");

  await db
    .update(products)
    .set({
      batchNo: nextBatchNo,
      serialNumber: nextSerialNumber,
      imei: nextImei,
      productName: nextProductName,
      currentStationCode: nextStation ?? matchedProduct.currentStationCode,
      currentStatus: nextStation ? statusForStation(nextStation) : matchedProduct.currentStatus,
      updatedAt: completedAt,
    })
    .where(eq(products.id, matchedProduct.id));

  queueA1CompletionSideEffectsInBackground({
    productId: matchedProduct.id,
    stationTaskId: pendingTaskId,
    operatorUserId: input.operatorUserId,
    businessDate: businessDateValue,
    completedAt,
    categoryId: matchedProduct.categoryId ?? null,
    nextStation,
  });

  return {
    success: true as const,
    nextStationCode: "A2" as const,
    productId: matchedProduct.id,
    productCode: matchedProduct.productCode,
    poNumber: matchedProduct.poNumber,
    vendorName: matchedProduct.vendorName,
    categoryName: matchedProduct.importedCategoryName,
  };
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
  await seedProductNameOptionsIfNeeded(db);

  const existingProducts = await db.select({ count: sql<number>`count(*)` }).from(products);
  if ((existingProducts[0]?.count ?? 0) > 0) {
    return;
  }

  const today = todayDateString();
  const todayDate = new Date(`${today}T00:00:00`);

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

export async function getProductNameOptions() {
  const db = await getDb();
  if (!db) {
    return [];
  }

  await ensureMvpSeedData();
  return db
    .select()
    .from(productNameOptions)
    .where(eq(productNameOptions.active, true))
    .orderBy(asc(productNameOptions.sortOrder), asc(productNameOptions.id));
}

export async function getProductCategoryOptions() {
  const db = await getDb();
  if (!db) {
    return [];
  }

  await ensureMvpSeedData();
  return db
    .select()
    .from(productCategories)
    .where(eq(productCategories.active, true))
    .orderBy(asc(productCategories.categoryName), asc(productCategories.brandName), asc(productCategories.subtypeCode), asc(productCategories.id));
}

async function backfillMissingImportPoNumbers(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  const pendingRows = await db
    .select({
      id: products.id,
      vendorName: products.vendorName,
      arrivalAt: products.arrivalAt,
      createdAt: products.createdAt,
    })
    .from(products)
    .where(
      and(
        eq(products.currentStationCode, "A1"),
        eq(products.currentStatus, "pending_a1"),
        isNull(products.archivedAt),
        sql`(${products.poNumber} is null or ${products.poNumber} = '')`,
      ),
    )
    .orderBy(asc(products.createdAt), asc(products.id));

  if (pendingRows.length === 0) {
    return 0;
  }

  const groupedRows = new Map<string, typeof pendingRows>();
  for (const row of pendingRows) {
    const createdDate = row.createdAt.toISOString().slice(0, 10);
    const arrivalKey = row.arrivalAt ? row.arrivalAt.toISOString() : "";
    const groupKey = [row.vendorName ?? "", arrivalKey, createdDate].join("|");
    const current = groupedRows.get(groupKey) ?? [];
    current.push(row);
    groupedRows.set(groupKey, current);
  }

  const reservedPoNumbers = new Set<string>();
  for (const rows of Array.from(groupedRows.values())) {
    const seedDate = rows[0]?.arrivalAt ?? rows[0]?.createdAt ?? new Date();
    const poNumber = await generateAutoPoNumber(db, seedDate, reservedPoNumbers);
    reservedPoNumbers.add(poNumber);

    await db
      .update(products)
      .set({
        poNumber,
        inspectionSummary: `PO:${poNumber}`,
        updatedAt: new Date(),
      })
      .where(inArray(products.id, rows.map((row: (typeof pendingRows)[number]) => row.id)));
  }

  return pendingRows.length;
}

function normalizeTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function normalizeNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "number" && Number.isFinite(item)) {
        return item;
      }

      if (typeof item === "string" && item.trim()) {
        const parsed = Number(item);
        return Number.isFinite(parsed) ? parsed : null;
      }

      return null;
    })
    .filter((item): item is number => item !== null);
}

export async function getStationPageData(stationCode: StationCode) {
  const db = await getDb();
  if (!db) {
    return { stationCode, label: stationToLabel(stationCode), tasks: [], faultOptions: [], appearanceOptions: [], cameraOptions: [], bFaultOptions: [] };
  }

  await ensureMvpSeedData();
  if (stationCode === "A1") {
    await backfillMissingImportPoNumbers(db);
  }

  const rows = await db
    .select({
      taskId: stationTasks.id,
      taskStatus: stationTasks.taskStatus,
      isOverdue: stationTasks.isOverdue,
      productId: products.id,
      productCode: products.productCode,
      poNumber: products.poNumber,
      batchNo: products.batchNo,
      serialNumber: products.serialNumber,
      imei: products.imei,
      productName: products.productName,
      importedCategoryName: products.importedCategoryName,
      currentStationCode: products.currentStationCode,
      subtypeCode: productCategories.subtypeCode,
      categoryName: productCategories.categoryName,
      brandName: productCategories.brandName,
      taskMetadata: stationTasks.metadata,
    })
    .from(stationTasks)
    .innerJoin(products, eq(stationTasks.productId, products.id))
    .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
    .where(and(
      eq(stationTasks.stationCode, stationCode),
      eq(products.currentStationCode, stationCode),
      inArray(stationTasks.taskStatus, ["pending", "in_progress", "overdue", "returned"]),
    ))
    .orderBy(desc(stationTasks.isOverdue), asc(stationTasks.id));

  const [faultOptions, appearanceOptions, cameraOptions, bFaultOptions] = await Promise.all([
    stationCode === "B" || stationCode === "C" ? getDefectOptions(stationCode, "fault") : Promise.resolve([]),
    stationCode === "C" ? getDefectOptions(stationCode, "appearance") : Promise.resolve([]),
    stationCode === "C" ? getDefectOptions(stationCode, "camera") : Promise.resolve([]),
    stationCode === "C" ? getDefectOptions("B", "fault") : Promise.resolve([]),
  ]);

  const nextRows = stationCode === "C"
    ? await (async () => {
        const productIds = rows.map((row) => row.productId);
        if (productIds.length === 0) {
          return rows.map((row) => ({
            ...row,
            inheritedBFaultOptionIds: [],
            inheritedBFaultLabels: [],
            inheritedBatteryNote: "",
            inheritedBatteryIssueLabels: [],
            inheritedBatterySummary: "正常",
            inheritedBFaultSummary: "正常",
          }));
        }

        const completedBRows = await db
          .select({
            productId: stationTasks.productId,
            metadata: stationTasks.metadata,
            completedAt: stationTasks.completedAt,
          })
          .from(stationTasks)
          .where(and(
            inArray(stationTasks.productId, productIds),
            eq(stationTasks.stationCode, "B"),
            eq(stationTasks.taskStatus, "completed"),
          ))
          .orderBy(desc(stationTasks.completedAt));

        const latestBMetaByProductId = new Map<number, Record<string, unknown>>();
        for (const completedTask of completedBRows) {
          if (latestBMetaByProductId.has(completedTask.productId)) {
            continue;
          }

          latestBMetaByProductId.set(completedTask.productId, (completedTask.metadata ?? {}) as Record<string, unknown>);
        }

        return rows.map((row) => {
          const taskMetadata = (row.taskMetadata ?? {}) as Record<string, unknown>;
          const latestBMetadata = latestBMetaByProductId.get(row.productId) ?? {};
          const inheritedBFaultOptionIds = normalizeNumberArray(taskMetadata.bFaultOptionIds ?? latestBMetadata.faultOptionIds);
          const inheritedBFaultLabels = normalizeTextArray(taskMetadata.bFaultLabels ?? latestBMetadata.faultLabels);
          const inheritedBatteryIssueLabels = normalizeTextArray(taskMetadata.batteryIssueLabels ?? latestBMetadata.batteryIssueLabels);
          const inheritedBatteryNote = typeof (taskMetadata.batteryNote ?? latestBMetadata.batteryNote) === "string"
            ? String(taskMetadata.batteryNote ?? latestBMetadata.batteryNote).trim()
            : "";
          const inheritedBatterySummary = typeof latestBMetadata.batterySummary === "string" && latestBMetadata.batterySummary.trim()
            ? latestBMetadata.batterySummary.trim()
            : [inheritedBatteryNote, ...inheritedBatteryIssueLabels].filter(Boolean).join(", ") || "正常";
          const inheritedBFaultSummary = typeof latestBMetadata.faultSummary === "string" && latestBMetadata.faultSummary.trim()
            ? latestBMetadata.faultSummary.trim()
            : inheritedBFaultLabels.join(", ") || "正常";

          return {
            ...row,
            inheritedBFaultOptionIds,
            inheritedBFaultLabels,
            inheritedBatteryNote,
            inheritedBatteryIssueLabels,
            inheritedBatterySummary,
            inheritedBFaultSummary,
          };
        });
      })()
    : rows;

  return {
    stationCode,
    label: stationToLabel(stationCode),
    tasks: nextRows,
    faultOptions,
    appearanceOptions,
    cameraOptions,
    bFaultOptions,
  };
}

export async function importProducts(input: {
  poNumber?: string | null;
  vendorName?: string | null;
  arrivalAt?: string | Date | null;
  importedByUserId?: number | null;
  rows: Array<{
    batchNo?: string | null;
    serialNumber?: string | null;
    imei?: string | null;
    productName?: string | null;
    categoryName?: string | null;
  }>;
}) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  await ensureMvpSeedData();

  const vendorName = normalizeOptionalText(input.vendorName);
  if (!vendorName) {
    throw new Error("廠商為必填欄位");
  }

  const arrivalAt = parseArrivalAt(input.arrivalAt);
  const resolvedPoNumber = normalizeOptionalText(input.poNumber) ?? await generateAutoPoNumber(db, arrivalAt ?? new Date());
  const businessDate = todayDateString();
  const businessDateValue = new Date(`${businessDate}T00:00:00`);
  const importSeed = Date.now();
  const createdProducts: Array<{ id: number; productCode: string; productName: string | null }> = [];
  const normalizedRows = input.rows.map((row) => ({
    categoryName: normalizeOptionalText(row.categoryName),
    batchNo: normalizeOptionalText(row.batchNo),
    serialNumber: normalizeOptionalText(row.serialNumber),
    imei: normalizeOptionalText(row.imei),
    productName: normalizeOptionalText(row.productName),
  }));

  for (let index = 0; index < normalizedRows.length; index += 1) {
    const row = normalizedRows[index]!;
    if (!row.categoryName) {
      throw new Error(`第 ${index + 1} 列缺少商品分類`);
    }
    if (!hasImportIdentity(row)) {
      throw new Error(`第 ${index + 1} 列至少要填寫商品批號、商品序號、IMEI 其中一項`);
    }
  }

  const imeis = Array.from(new Set(normalizedRows.map((row) => row.imei).filter((value): value is string => Boolean(value))));
  const serialNumbers = Array.from(new Set(normalizedRows.map((row) => row.serialNumber).filter((value): value is string => Boolean(value))));
  const batchNumbers = Array.from(new Set(normalizedRows.map((row) => row.batchNo).filter((value): value is string => Boolean(value))));
  const identityConditions = [
    ...(imeis.length > 0 ? [inArray(products.imei, imeis)] : []),
    ...(serialNumbers.length > 0 ? [inArray(products.serialNumber, serialNumbers)] : []),
    ...(batchNumbers.length > 0 ? [inArray(products.batchNo, batchNumbers)] : []),
  ];

  const matchedProducts = identityConditions.length > 0
    ? await db
        .select()
        .from(products)
        .where(
          and(
            eq(products.currentStationCode, "A1"),
            isNull(products.archivedAt),
            or(...identityConditions),
          ),
        )
    : [];

  const matchedByImei = new Map<string, (typeof matchedProducts)[number]>();
  const matchedBySerialNumber = new Map<string, (typeof matchedProducts)[number]>();
  const matchedByBatchNo = new Map<string, (typeof matchedProducts)[number]>();

  for (const product of matchedProducts) {
    if (product.imei && !matchedByImei.has(product.imei)) {
      matchedByImei.set(product.imei, product);
    }
    if (product.serialNumber && !matchedBySerialNumber.has(product.serialNumber)) {
      matchedBySerialNumber.set(product.serialNumber, product);
    }
    if (product.batchNo && !matchedByBatchNo.has(product.batchNo)) {
      matchedByBatchNo.set(product.batchNo, product);
    }
  }

  const matchedProductIds = Array.from(new Set(matchedProducts.map((product) => product.id)));
  const pendingA1TaskProductIds = new Set<number>();
  if (matchedProductIds.length > 0) {
    const existingTasks = await db
      .select({ productId: stationTasks.productId })
      .from(stationTasks)
      .where(
        and(
          inArray(stationTasks.productId, matchedProductIds),
          eq(stationTasks.stationCode, "A1"),
          inArray(stationTasks.taskStatus, ["pending", "in_progress", "overdue", "returned"]),
        ),
      );

    for (const task of existingTasks) {
      pendingA1TaskProductIds.add(task.productId);
    }
  }

  const pendingTaskInserts: Array<{
    productId: number;
    stationCode: "A1";
    taskStatus: "pending";
    dueDate: Date;
    resultSummary: string;
    metadata: Record<string, unknown>;
  }> = [];
  const newProductEntries: Array<{
    productCode: string;
    productName: string | null;
      values: {
        productCode: string;
        poNumber: string;
        vendorName: string;
        batchNo: string | null;
        serialNumber: string | null;
        imei: string | null;
        productName: string | null;
        arrivalAt: Date | null;
        importedCategoryName: string;
        categoryId: null;
        currentStationCode: "A1";
        currentStatus: "pending_a1";
        inspectionSummary: string;
      };

  }> = [];

  for (let index = 0; index < normalizedRows.length; index += 1) {
    const row = normalizedRows[index]!;
    const categoryName = row.categoryName as string;
    const matchedProduct = (row.imei ? matchedByImei.get(row.imei) : undefined)
      ?? (row.serialNumber ? matchedBySerialNumber.get(row.serialNumber) : undefined)
      ?? (row.batchNo ? matchedByBatchNo.get(row.batchNo) : undefined)
      ?? null;

    if (matchedProduct) {
      const nextBatchNo = matchedProduct.batchNo ?? row.batchNo;
      const nextSerialNumber = matchedProduct.serialNumber ?? row.serialNumber;
      const nextImei = matchedProduct.imei ?? row.imei;
      const nextProductName = matchedProduct.productName ?? row.productName;
      const nextImportedCategoryName = matchedProduct.importedCategoryName ?? categoryName;
      const nextPoNumber = matchedProduct.poNumber ?? resolvedPoNumber;
      const nextVendorName = matchedProduct.vendorName ?? vendorName;
      const nextArrivalAt = matchedProduct.arrivalAt ?? arrivalAt;

      await db
        .update(products)
        .set({
          poNumber: nextPoNumber,
          vendorName: nextVendorName,
          batchNo: nextBatchNo,
          serialNumber: nextSerialNumber,
          imei: nextImei,
          productName: nextProductName,
          arrivalAt: nextArrivalAt,
          importedCategoryName: nextImportedCategoryName,
          categoryId: null,
          currentStationCode: "A1",
          currentStatus: "pending_a1",
          inspectionSummary: nextPoNumber ? `PO:${nextPoNumber}` : matchedProduct.inspectionSummary,
          updatedAt: new Date(),
        })
        .where(eq(products.id, matchedProduct.id));

      if (!pendingA1TaskProductIds.has(matchedProduct.id)) {
        pendingTaskInserts.push({
          productId: matchedProduct.id,
          stationCode: "A1",
          taskStatus: "pending",
          dueDate: businessDateValue,
          resultSummary: "A1 點到貨待處理",
          metadata: {
            source: "import_patch",
            poNumber: nextPoNumber ?? null,
          },
        });
        pendingA1TaskProductIds.add(matchedProduct.id);
      }

      createdProducts.push({
        id: matchedProduct.id,
        productCode: matchedProduct.productCode,
        productName: nextProductName,
      });
      continue;
    }

    const productCode = buildProductCode(importSeed, index);
    newProductEntries.push({
      productCode,
      productName: row.productName,
      values: {
        productCode,
        poNumber: resolvedPoNumber,
        vendorName,
        batchNo: row.batchNo,
        serialNumber: row.serialNumber,
        imei: row.imei,
        productName: row.productName,
        arrivalAt,
        importedCategoryName: categoryName,
        categoryId: null,
        currentStationCode: "A1",
        currentStatus: "pending_a1",
        inspectionSummary: `PO:${resolvedPoNumber}`,
      },
    });
  }

  if (pendingTaskInserts.length > 0) {
    await db.insert(stationTasks).values(pendingTaskInserts);
  }

  const insertChunkSize = 200;
  for (let index = 0; index < newProductEntries.length; index += insertChunkSize) {
    const chunk = newProductEntries.slice(index, index + insertChunkSize);
    const insertedProducts = await db.insert(products).values(chunk.map((entry) => entry.values)).$returningId();
    const taskValues = insertedProducts.flatMap((product, offset) => (
      product?.id
        ? [{
            productId: product.id,
            stationCode: "A1" as const,
            taskStatus: "pending" as const,
            dueDate: businessDateValue,
            resultSummary: "A1 點到貨待處理",
            metadata: {
              source: "import",
              poNumber: resolvedPoNumber,
            },
          }]
        : []
    ));

    if (taskValues.length > 0) {
      await db.insert(stationTasks).values(taskValues);
    }

    insertedProducts.forEach((product, offset) => {
      if (!product?.id) {
        return;
      }
      const entry = chunk[offset];
      if (!entry) {
        return;
      }
      createdProducts.push({
        id: product.id,
        productCode: entry.productCode,
        productName: entry.productName,
      });
    });
  }

  await db.insert(sheetSyncJobs).values({
    jobType: "purchase_sheet_sync",
    targetSheetName: "採購單",
    status: "queued",
  });

  return {
    success: true as const,
    importedCount: createdProducts.length,
    poNumber: resolvedPoNumber,
    vendorName,
    arrivalAt,
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
  cameraOptionIds?: number[];
  bFaultOptionIds?: number[];
  batteryNote?: string;
  batteryIssueLabels?: Array<"電池膨脹" | "副廠電池" | "電池異常">;
  applyBChanges?: boolean;
}) {
  const db = await getDb();
  if (!db) {
    return { success: false as const, message: "Database unavailable" };
  }

  const nextStation = nextStationFor(input.stationCode);
  const businessDate = todayDateString();
  const businessDateValue = new Date(`${businessDate}T00:00:00`);
  const completedAt = new Date();
  const currentStationOptionIds = Array.from(new Set([
    ...(input.faultOptionIds ?? []),
    ...(input.appearanceOptionIds ?? []),
    ...(input.cameraOptionIds ?? []),
  ]));
  const bFaultOptionIds = Array.from(new Set(input.bFaultOptionIds ?? []));
  const queriedOptionIds = Array.from(new Set([...currentStationOptionIds, ...bFaultOptionIds]));
  const selectedOptions = queriedOptionIds.length
    ? await db.select().from(defectOptions).where(inArray(defectOptions.id, queriedOptionIds))
    : [];
  const currentStationOptions = selectedOptions.filter((option) => !bFaultOptionIds.includes(option.id));
  const carriedBOptions = selectedOptions.filter((option) => bFaultOptionIds.includes(option.id));
  const faultLabels = currentStationOptions.filter((option) => option.optionType === "fault").map((option) => option.label);
  const appearanceLabels = currentStationOptions.filter((option) => option.optionType === "appearance").map((option) => option.label);
  const cameraLabels = currentStationOptions.filter((option) => option.optionType === "camera").map((option) => option.label);
  const bFaultLabels = carriedBOptions.filter((option) => option.optionType === "fault").map((option) => option.label);
  const batteryNote = input.batteryNote?.trim() || undefined;
  const batteryIssueLabels = Array.from(new Set(input.batteryIssueLabels ?? []));
  const batterySummary = input.stationCode === "B" || input.stationCode === "C"
    ? [batteryNote, ...batteryIssueLabels].filter(Boolean).join(", ") || "正常"
    : undefined;
  const faultSummary = input.stationCode === "B"
    ? faultLabels.join(", ") || "正常"
    : undefined;
  const carriedBFaultSummary = input.stationCode === "C"
    ? bFaultLabels.join(", ") || "正常"
    : undefined;
  const cFaultSummary = input.stationCode === "C"
    ? faultLabels.join(", ") || "正常"
    : undefined;
  const cAppearanceSummary = input.stationCode === "C"
    ? appearanceLabels.join(", ") || "正常"
    : undefined;
  const cCameraSummary = input.stationCode === "C"
    ? cameraLabels.join(", ") || "正常"
    : undefined;
  const cInspectionSummary = input.stationCode === "C"
    ? [...faultLabels, ...appearanceLabels, ...cameraLabels].filter(Boolean).join(", ") || "正常"
    : undefined;
  const applyBChanges = input.stationCode === "C" ? Boolean(input.applyBChanges) : false;

  await db
    .update(stationTasks)
    .set({
      taskStatus: "completed",
      completedAt,
      resultSummary: input.summary ?? "已完成站點作業",
      metadata: {
        summary: input.summary ?? "已完成站點作業",
        faultOptionIds: input.faultOptionIds ?? [],
        appearanceOptionIds: input.appearanceOptionIds ?? [],
        cameraOptionIds: input.cameraOptionIds ?? [],
        bFaultOptionIds,
        faultLabels,
        appearanceLabels,
        cameraLabels,
        bFaultLabels,
        batteryNote,
        batteryIssueLabels,
        batterySummary,
        faultSummary,
        cFaultSummary,
        cAppearanceSummary,
        cCameraSummary,
        cInspectionSummary,
        applyBChanges,
        cModifiedBatterySummary: applyBChanges ? batterySummary : undefined,
        cModifiedBFaultSummary: applyBChanges ? carriedBFaultSummary : undefined,
      },
      updatedAt: completedAt,
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
        cameraOptionIds: input.cameraOptionIds ?? [],
        bFaultOptionIds,
        faultLabels,
        appearanceLabels,
        cameraLabels,
        bFaultLabels,
        batteryNote,
        batteryIssueLabels,
        batterySummary,
        faultSummary,
        cFaultSummary,
        cAppearanceSummary,
        cCameraSummary,
        cInspectionSummary,
        applyBChanges,
        cModifiedBatterySummary: applyBChanges ? batterySummary : undefined,
        cModifiedBFaultSummary: applyBChanges ? carriedBFaultSummary : undefined,
      },

  });

  await db.insert(sheetSyncJobs).values({
    jobType: "station_task_sync",
    targetSheetName: "手機檢測資料庫",
    status: "queued",
  });

  if (input.stationCode === "A2" || input.stationCode === "B" || input.stationCode === "C") {
    await db.insert(sheetSyncJobs).values({
      jobType: "purchase_sheet_sync",
      targetSheetName: "採購單",
      status: "queued",
    });

    triggerPurchaseSheetSyncInBackground();
  }

  if (nextStation) {
    await db
      .update(products)
      .set({
        currentStationCode: nextStation,
        currentStatus: statusForStation(nextStation),
        updatedAt: completedAt,
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
        bFaultOptionIds,
        bFaultLabels,
        batteryNote,
        batteryIssueLabels,
        batterySummary,
        faultSummary: applyBChanges ? carriedBFaultSummary : undefined,
        applyBChanges,
      },
    });
  } else {
    await db
      .update(products)
      .set({
        currentStatus: "completed",
        stockStatus: "stocked",
        updatedAt: completedAt,
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
    return { users: [], rules: [], categories: [], targets: [], productNameOptions: [] };
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
    categories: await db.select().from(productCategories).orderBy(asc(productCategories.categoryName), asc(productCategories.brandName), asc(productCategories.id)),
    targets: await db.select().from(productivityTargetConfigs).orderBy(asc(productivityTargetConfigs.id)),
    defectOptions: await db.select().from(defectOptions).orderBy(asc(defectOptions.stationCode), asc(defectOptions.optionType), asc(defectOptions.sortOrder), asc(defectOptions.id)),
    productNameOptions: await db.select().from(productNameOptions).orderBy(asc(productNameOptions.sortOrder), asc(productNameOptions.id)),
    syncSummary: {
      queuedJobs: queuedSyncJobs[0]?.count ?? 0,
      targetSheetName: "採購單",
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

export async function createProductNameOption(input: { label: string }) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  const normalizedLabel = input.label.trim();
  if (!normalizedLabel) {
    throw new Error("Product name is required");
  }

  const existing = await db
    .select()
    .from(productNameOptions)
    .where(eq(productNameOptions.label, normalizedLabel))
    .limit(1);
  if (existing[0]) {
    return existing[0];
  }

  const currentMaxSortOrder = await db.select({ value: sql<number>`coalesce(max(${productNameOptions.sortOrder}), 0)` }).from(productNameOptions);
  await db.insert(productNameOptions).values({
    label: normalizedLabel,
    active: true,
    sortOrder: (currentMaxSortOrder[0]?.value ?? 0) + 10,
  });

  const rows = await db
    .select()
    .from(productNameOptions)
    .where(eq(productNameOptions.label, normalizedLabel))
    .orderBy(desc(productNameOptions.id))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteProductNameOption(id: number) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  await db.delete(productNameOptions).where(eq(productNameOptions.id, id));
  return { success: true as const };
}

export async function createProductCategoryOption(input: { categoryName: string; brandName: string }) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  const normalizedCategoryName = normalizeOptionalText(input.categoryName);
  const normalizedBrandName = normalizeOptionalText(input.brandName);
  if (!normalizedCategoryName || !normalizedBrandName) {
    throw new Error("商品類別與品牌皆為必填欄位");
  }

  const existing = await db
    .select()
    .from(productCategories)
    .where(and(eq(productCategories.categoryName, normalizedCategoryName), eq(productCategories.brandName, normalizedBrandName)))
    .limit(1);
  if (existing[0]) {
    return existing[0];
  }

  await db.insert(productCategories).values({
    categoryName: normalizedCategoryName,
    subtypeCode: normalizedBrandName,
    brandName: normalizedBrandName,
    active: true,
  });

  const rows = await db
    .select()
    .from(productCategories)
    .where(and(eq(productCategories.categoryName, normalizedCategoryName), eq(productCategories.brandName, normalizedBrandName)))
    .orderBy(desc(productCategories.id))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteProductCategoryOption(id: number) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  await db.update(products).set({ categoryId: null, updatedAt: new Date() }).where(eq(products.categoryId, id));
  await db.update(stationEvents).set({ categoryId: null, subtypeCode: null }).where(eq(stationEvents.categoryId, id));
  await db.delete(productivityScoreDetails).where(eq(productivityScoreDetails.categoryId, id));
  await db.delete(productivityTargetConfigs).where(eq(productivityTargetConfigs.categoryId, id));
  await db.delete(productCategories).where(eq(productCategories.id, id));
  return { success: true as const };
}

export async function clearProductCategoryOptions() {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  const rows = await db.select({ id: productCategories.id }).from(productCategories);
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) {
    return { success: true as const, clearedCount: 0 };
  }

  await db.update(products).set({ categoryId: null, updatedAt: new Date() }).where(inArray(products.categoryId, ids));
  await db.update(stationEvents).set({ categoryId: null, subtypeCode: null }).where(inArray(stationEvents.categoryId, ids));
  await db.delete(productivityScoreDetails).where(inArray(productivityScoreDetails.categoryId, ids));
  await db.delete(productivityTargetConfigs).where(inArray(productivityTargetConfigs.categoryId, ids));
  await db.delete(productCategories).where(inArray(productCategories.id, ids));
  return { success: true as const, clearedCount: ids.length };
}

export async function deleteImportedPurchaseOrder(poNumber: string) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  const normalizedPoNumber = normalizeOptionalText(poNumber);
  if (!normalizedPoNumber) {
    throw new Error("PO 單號為必填欄位");
  }

  const productRows = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.poNumber, normalizedPoNumber));
  const productIds = productRows.map((row) => row.id);
  if (productIds.length === 0) {
    return { success: true as const, poNumber: normalizedPoNumber, deletedProducts: 0, deletedTasks: 0 };
  }

  const deletedTasks = await db.delete(stationTasks).where(inArray(stationTasks.productId, productIds));
  await db.delete(stationEvents).where(inArray(stationEvents.productId, productIds));
  await db.delete(samplingResults).where(inArray(samplingResults.productId, productIds));
  await db.delete(productivityScoreDetails).where(inArray(productivityScoreDetails.productId, productIds));
  const deletedProducts = await db.delete(products).where(inArray(products.id, productIds));

  return {
    success: true as const,
    poNumber: normalizedPoNumber,
    deletedProducts: typeof deletedProducts === "number" ? deletedProducts : productIds.length,
    deletedTasks: typeof deletedTasks === "number" ? deletedTasks : 0,
  };
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
