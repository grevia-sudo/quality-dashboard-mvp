import { spawn } from "node:child_process";
import { createSign } from "node:crypto";
import { and, asc, count, desc, eq, gte, inArray, isNull, like, lte, notInArray, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { createPool } from "mysql2/promise";
import {
  categoryStationFlows,
  defectOptions,
  engineerDailyProductivity,
  importBatchBackups,
  InsertUser,
  productArchives,
  productCategories,
  productNameCatalogEntries,
  purchaseOrderDeletionLogs,
  productNameOptions,
  productivityScoreDetails,
  productivityTargetConfigs,
  products,
  samplingResults,
  sheetSyncJobs,
  stationEvents,
  stationRules,
  stationTasks,
  supportTaskCompensations,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { buildPendingStockMismatchSummary, isPendingStockImportMismatch } from "./pending-stock-mismatch";
import { markPurchaseOrderRowsDeletedInGoogleSheet } from "./purchase-sheet-delete-sync";

const STATION_CODES = ["A1", "A2", "B", "C", "D", "E", "STOCK"] as const;
const SUPPORT_COMPENSATION_INTERNAL_POINTS_PER_HOUR = 0.125;
const DISPLAY_POINTS_MULTIPLIER = 100;
type StationCode = (typeof STATION_CODES)[number];
type DefectOptionType = "fault" | "appearance" | "camera";

type SupportCompensationFilterInput = {
  startDate?: string | null;
  endDate?: string | null;
  userId?: number | null;
};

const PRODUCT_NAME_SYNC_SPREADSHEET_ID = "1lMd28O9G-14VQQd7-RRIF8Tr5RaOVa7fhI1fkLXAB0o";
const PRODUCT_NAME_SYNC_SHEET_NAME = "商品編碼列表";
const PRODUCT_NAME_SYNC_COLUMN_RANGE = `${PRODUCT_NAME_SYNC_SHEET_NAME}!H:N`;
const PURCHASE_SHEET_SYNC_DB_RETRYABLE_PATTERN = /ECONNRESET|PROTOCOL_CONNECTION_LOST|ETIMEDOUT|Connection lost|The server closed the connection/i;

function toDateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function toDisplayPoints(points: number) {
  return points * DISPLAY_POINTS_MULTIPLIER;
}

function dateKeyToDate(dateKey: string) {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function getSupportCompensationInternalPoints(hours: number) {
  return hours * SUPPORT_COMPENSATION_INTERNAL_POINTS_PER_HOUR;
}

function normalizeProductNameLabel(value: unknown) {
  if (value == null) {
    return null;
  }

  const text = String(value).trim();
  if (!text || text.toLowerCase() === "unnamed: 0") {
    return null;
  }

  return text.split(/\s+/).join(" ");
}

type ProductNameCatalogSyncRow = {
  label: string;
  categoryName: string;
  brandName: string;
  sourceRowNumber: number;
  sortOrder: number;
};

function getProductNameCatalogKey(input: { label: string; categoryName: string; brandName: string }) {
  return `${input.categoryName}__${input.brandName}__${input.label}`;
}

async function getProductNameCatalogEntriesFromGoogleSheet() {
  const accessToken = await getGoogleSheetsAccessToken();
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${PRODUCT_NAME_SYNC_SPREADSHEET_ID}/values/${encodeURIComponent(PRODUCT_NAME_SYNC_COLUMN_RANGE)}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const result = await response.json() as { values?: string[][]; error?: { message?: string } };

  if (!response.ok) {
    throw new Error(result.error?.message || "Failed to read product name catalog columns from Google Sheets");
  }

  const orderedEntries = new Map<string, ProductNameCatalogSyncRow>();
  (result.values ?? []).forEach((row, index) => {
    if (index < 2) {
      return;
    }

    const label = normalizeProductNameLabel(row?.[0]);
    const categoryName = normalizeOptionalText(row?.[4]);
    const brandName = normalizeOptionalText(row?.[6]);
    if (label && ["商品名稱", "品名", "商品名"].includes(label)) {
      return;
    }

    if (!label || !categoryName || !brandName) {
   return;
    }

    const key = getProductNameCatalogKey({ label, categoryName, brandName });
    if (orderedEntries.has(key)) {
      return;
    }

    orderedEntries.set(key, {
      label,
      categoryName,
      brandName,
      sourceRowNumber: index + 1,
      sortOrder: (orderedEntries.size + 1) * 10,
    });
  });

  return Array.from(orderedEntries.values());
}

type StationStatusSummary = {
  stationCode: StationCode;
  label: string;
  pendingCount: number;
  todayNewCount: number;
  overdueCount: number;
};

let _db: ReturnType<typeof createDatabaseClient> | null = null;
let purchaseSheetSyncTriggeredAt = 0;
let purchaseSheetSyncPromise: Promise<void> | null = null;
let purchaseSheetSyncWorkerStarted = false;
let purchaseSheetSyncWorkerTimer: ReturnType<typeof setTimeout> | null = null;
const PURCHASE_SHEET_SYNC_IDLE_POLL_MS = 30_000;
const PURCHASE_SHEET_SYNC_BUSY_POLL_MS = 5_000;
let stockSheetReconcileTriggeredAt = 0;
let stockSheetReconcilePromise: Promise<void> | null = null;
const STOCK_MATCH_SPREADSHEET_ID = "1JgtjGPwL8MXQLFUKi5OSx3wubgpSX4n4MFcj-iHgEW0";
const STOCK_MATCH_SHEET_ID = 806211245;
const STOCK_MATCH_SHEET_NAME = "進貨明細";

function createDatabaseClient(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  const databaseName = parsed.pathname.replace(/^\//, "");

  return drizzle(createPool({
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(databaseName),
    timezone: "Z",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: {
      rejectUnauthorized: false,
    },
  }));
}

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

function isRetryablePurchaseSheetSyncDbError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return PURCHASE_SHEET_SYNC_DB_RETRYABLE_PATTERN.test(message);
}

function waitForPurchaseSheetSyncDbRetry(delayMs: number) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function countQueuedSheetSyncJobs(filters?: { jobType?: string; targetSheetName?: string }) {
  const db = await getDb();
  if (!db) {
    return 0;
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const conditions = [eq(sheetSyncJobs.status, "queued")];

      if (filters?.jobType) {
        conditions.push(eq(sheetSyncJobs.jobType, filters.jobType));
      }

      if (filters?.targetSheetName) {
        conditions.push(eq(sheetSyncJobs.targetSheetName, filters.targetSheetName));
      }

      const rows = await db
        .select({ count: sql<number>`count(*)` })
        .from(sheetSyncJobs)
        .where(and(...conditions));

      return rows[0]?.count ?? 0;
    } catch (error) {
      if (attempt >= 3 || !isRetryablePurchaseSheetSyncDbError(error)) {
        throw error;
      }

      console.warn(`[purchase-sheet-sync] queued job count query failed (attempt ${attempt}/3), retrying`, error);
      await waitForPurchaseSheetSyncDbRetry(attempt * 400);
    }
  }

  return 0;
}

async function getQueuedPurchaseSheetSyncJobCount() {
  return countQueuedSheetSyncJobs({
    jobType: "purchase_sheet_sync",
    targetSheetName: "採購單",
  });
}

async function drainPurchaseSheetSyncQueueOnce() {
  const queuedCount = await getQueuedPurchaseSheetSyncJobCount();
  if (queuedCount <= 0) {
    return false;
  }

  purchaseSheetSyncTriggeredAt = Date.now();
  await runPurchaseSheetSyncInProcess();
  return true;
}

function schedulePurchaseSheetSyncWorker(delayMs: number) {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    return;
  }

  if (purchaseSheetSyncWorkerTimer) {
    clearTimeout(purchaseSheetSyncWorkerTimer);
  }

  purchaseSheetSyncWorkerTimer = setTimeout(async () => {
    purchaseSheetSyncWorkerTimer = null;

    try {
      const drained = await drainPurchaseSheetSyncQueueOnce();
      schedulePurchaseSheetSyncWorker(drained ? PURCHASE_SHEET_SYNC_BUSY_POLL_MS : PURCHASE_SHEET_SYNC_IDLE_POLL_MS);
    } catch (error) {
      console.error("[purchase-sheet-sync] worker cycle failed", error);
      schedulePurchaseSheetSyncWorker(PURCHASE_SHEET_SYNC_BUSY_POLL_MS);
    }
  }, Math.max(100, delayMs));
}

export function startPurchaseSheetSyncWorker() {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    return;
  }

  if (purchaseSheetSyncWorkerStarted) {
    return;
  }

  purchaseSheetSyncWorkerStarted = true;
  schedulePurchaseSheetSyncWorker(1_000);
}

function triggerPurchaseSheetSyncInBackground() {
  const now = Date.now();

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

  startPurchaseSheetSyncWorker();

  if (now - purchaseSheetSyncTriggeredAt < 2_000 && purchaseSheetSyncPromise) {
    return;
  }

  purchaseSheetSyncTriggeredAt = now;
  schedulePurchaseSheetSyncWorker(200);
}

function normalizeBatchMatchValue(value: unknown) {
  return typeof value === "string"
    ? value.trim().replace(/^'+/, "").replace(/\s+/g, "").toUpperCase()
    : "";
}

function buildImportRowIdentity(row: { batchNo?: unknown; serialNumber?: unknown; imei?: unknown }) {
  const batchNo = normalizeBatchMatchValue(row.batchNo);
  const serialNumber = normalizeBatchMatchValue(row.serialNumber);
  const imei = normalizeBatchMatchValue(row.imei);

  return [batchNo, serialNumber, imei].filter(Boolean).join("|");
}

function getGoogleServiceAccountCredentials() {
  const rawCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!rawCredentials) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing");
  }

  return JSON.parse(rawCredentials) as {
    client_email: string;
    private_key: string;
    token_uri?: string;
  };
}

function base64UrlEncode(value: string) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function getGoogleSheetsAccessToken() {
  const credentials = getGoogleServiceAccountCredentials();
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const unsignedToken = `${base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64UrlEncode(JSON.stringify({
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: credentials.token_uri ?? "https://oauth2.googleapis.com/token",
    exp: nowInSeconds + 3600,
    iat: nowInSeconds,
  }))}`;

  const signer = createSign("RSA-SHA256");
  signer.update(unsignedToken);
  signer.end();

  const signature = signer
    .sign(credentials.private_key, "base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const response = await fetch(credentials.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsignedToken}.${signature}`,
    }),
  });

  const result = await response.json() as { access_token?: string; error?: string; error_description?: string };
  if (!response.ok || !result.access_token) {
    throw new Error(result.error_description || result.error || "Failed to get Google Sheets access token");
  }

  return result.access_token;
}

async function readStockMatchedBatchNumbersFromSheet() {
  const accessToken = await getGoogleSheetsAccessToken();
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${STOCK_MATCH_SPREADSHEET_ID}/values/${encodeURIComponent(`${STOCK_MATCH_SHEET_NAME}!F:F`)}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const result = await response.json() as {
    values?: string[][];
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(result.error?.message || "Failed to read stock match sheet values");
  }

  const rawValues = result.values?.flat() ?? [];
  return new Set(rawValues.map((value) => normalizeBatchMatchValue(value)).filter(Boolean));
}

async function reconcilePendingStockFromSheet(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  const now = Date.now();
  if (stockSheetReconcilePromise) {
    return stockSheetReconcilePromise;
  }
  if (now - stockSheetReconcileTriggeredAt < 60_000) {
    return;
  }

  stockSheetReconcileTriggeredAt = now;
  stockSheetReconcilePromise = (async () => {
    try {
      const matchedBatchNumbers = await readStockMatchedBatchNumbersFromSheet();
      if (matchedBatchNumbers.size === 0) {
        return;
      }

      const pendingStockRows = await db
        .select({
          taskId: stationTasks.id,
          productId: products.id,
          batchNo: products.batchNo,
        })
        .from(stationTasks)
        .innerJoin(products, eq(stationTasks.productId, products.id))
        .where(and(
          eq(stationTasks.stationCode, "STOCK"),
          inArray(stationTasks.taskStatus, ["pending", "in_progress", "overdue", "returned"]),
          eq(products.currentStationCode, "STOCK"),
          eq(products.currentStatus, "pending_stock"),
          isNull(products.archivedAt),
        ));

      const matchedRows = pendingStockRows.filter((row) => matchedBatchNumbers.has(normalizeBatchMatchValue(row.batchNo)));
      if (matchedRows.length === 0) {
        return;
      }

      const completedAt = new Date();
      const businessDate = new Date(`${todayDateString()}T00:00:00`);

      await db
        .update(stationTasks)
        .set({
          taskStatus: "completed",
          completedAt,
          resultSummary: "外部進貨明細批號比對成功，自動移除待入庫",
          metadata: {
            autoRemovedBySheet: true,
            matchedSpreadsheetId: STOCK_MATCH_SPREADSHEET_ID,
            matchedSheetId: STOCK_MATCH_SHEET_ID,
            matchedColumn: "F",
          },
          updatedAt: completedAt,
        })
        .where(inArray(stationTasks.id, matchedRows.map((row) => row.taskId)));

      await db
        .update(products)
        .set({
          currentStatus: "completed",
          stockStatus: "stocked",
          updatedAt: completedAt,
        })
        .where(inArray(products.id, matchedRows.map((row) => row.productId)));

      await db.insert(stationEvents).values(matchedRows.map((row) => ({
        productId: row.productId,
        stationTaskId: row.taskId,
        stationCode: "STOCK" as const,
        eventType: "complete" as const,
        operatorUserId: null,
        businessDate,
        categoryId: null,
        subtypeCode: null,
        payload: {
          summary: "外部進貨明細批號比對成功，自動移除待入庫",
          matchedSpreadsheetId: STOCK_MATCH_SPREADSHEET_ID,
          matchedSheetId: STOCK_MATCH_SHEET_ID,
          matchedColumn: "F",
          batchNo: row.batchNo ?? null,
        },
      })));

      await db.insert(sheetSyncJobs).values({
        jobType: "purchase_sheet_sync",
        targetSheetName: "採購單",
        status: "queued",
      });

      triggerPurchaseSheetSyncInBackground();
    } catch (error) {
      console.error("[stock-sheet-reconcile] failed", error);
    } finally {
      stockSheetReconcilePromise = null;
    }
  })();

  return stockSheetReconcilePromise;
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
      _db = createDatabaseClient(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

function getOperationTimeContext(now = new Date()) {
  const businessDate = now.toISOString().slice(0, 10);
  return {
    now,
    businessDate,
    businessDateValue: new Date(`${businessDate}T00:00:00`),
  };
}

function todayDateString() {
  return getOperationTimeContext().businessDate;
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

const DEFAULT_CATEGORY_FLOW: StationCode[] = ["A1", "A2", "B", "C", "D", "E", "STOCK"];

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

async function getCategoryFlowCodes(categoryId?: number | null) {
  const db = await getDb();
  if (!db || !categoryId) {
    return DEFAULT_CATEGORY_FLOW;
  }

  const flowRows = await db
    .select({
      stationCode: categoryStationFlows.stationCode,
      stepOrder: categoryStationFlows.stepOrder,
    })
    .from(categoryStationFlows)
    .where(and(eq(categoryStationFlows.categoryId, categoryId), eq(categoryStationFlows.active, true)))
    .orderBy(asc(categoryStationFlows.stepOrder), asc(categoryStationFlows.id));

  return flowRows.length > 0 ? flowRows.map((row) => row.stationCode as StationCode) : DEFAULT_CATEGORY_FLOW;
}

async function resolveNextStationByCategory(categoryId: number | null | undefined, currentStationCode: StationCode) {
  const flowCodes = await getCategoryFlowCodes(categoryId);
  const currentIndex = flowCodes.indexOf(currentStationCode);
  if (currentIndex === -1) {
    return nextStationFor(currentStationCode);
  }

  return flowCodes[currentIndex + 1] ?? null;
}

async function resolveReworkStationByCategory(categoryId: number | null | undefined, currentStationCode: StationCode) {
  const flowCodes = await getCategoryFlowCodes(categoryId);
  const currentIndex = flowCodes.indexOf(currentStationCode);
  if (currentIndex <= 0) {
    return currentStationCode === "D" ? "C" : null;
  }

  return flowCodes[currentIndex - 1] ?? null;
}

async function ensureDefaultCategoryStationFlows(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, categoryIds: number[]) {
  if (categoryIds.length === 0) {
    return;
  }

  const existingRows = await db
    .select({
      categoryId: categoryStationFlows.categoryId,
      stationCode: categoryStationFlows.stationCode,
    })
    .from(categoryStationFlows)
    .where(inArray(categoryStationFlows.categoryId, categoryIds));

  const existingKeys = new Set(existingRows.map((row) => `${row.categoryId}-${row.stationCode}`));
  const values = categoryIds.flatMap((categoryId) => DEFAULT_CATEGORY_FLOW.map((stationCode, index) => ({
    categoryId,
    stationCode,
    stepOrder: index + 1,
    active: true,
  }))).filter((row) => !existingKeys.has(`${row.categoryId}-${row.stationCode}`));

  if (values.length > 0) {
    await db.insert(categoryStationFlows).values(values);
  }
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

function normalizeCatalogComparisonText(value?: string | null) {
  const normalized = normalizeOptionalText(value);
  return normalized ? normalized.toLocaleUpperCase("en-US") : null;
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

async function validateImportRowsAgainstProductCatalog(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  rows: Array<{
    categoryName: string | null;
    brandName: string | null;
    productName: string | null;
  }>,
) {
  const catalogRows = await db
    .select({
      categoryName: productNameCatalogEntries.categoryName,
      brandName: productNameCatalogEntries.brandName,
    })
    .from(productNameCatalogEntries)
    .where(eq(productNameCatalogEntries.active, true));

  if (catalogRows.length === 0) {
    return;
  }

  const categoryBrandKeys = new Set(
    catalogRows
      .map((row) => {
        const categoryName = normalizeOptionalText(row.categoryName);
        const brandName = normalizeCatalogComparisonText(row.brandName);
        return categoryName && brandName ? `${categoryName}__${brandName}` : null;
      })
      .filter((value): value is string => Boolean(value)),
  );

  rows.forEach((row, index) => {
    const categoryName = normalizeOptionalText(row.categoryName);
    const brandName = normalizeCatalogComparisonText(row.brandName);

    if (!categoryName || !brandName) {
      return;
    }

    const categoryBrandKey = `${categoryName}__${brandName}`;
    if (!categoryBrandKeys.has(categoryBrandKey)) {
      throw new Error(`第 ${index + 1} 筆資料驗證失敗：商品分類「${categoryName}」與品牌「${brandName}」不在商品編碼列表中，請重新匯入；本次匯入不成功`);
    }
  });
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

  const normalizedBatchNo = normalizeOptionalText(input.batchNo);
  const normalizedSerialNumber = normalizeOptionalText(input.serialNumber);
  const normalizedImei = normalizeOptionalText(input.imei);
  const normalizedProductName = normalizeOptionalText(input.productName);
  const { businessDateValue, now: completedAt } = getOperationTimeContext();

  let matchedProduct = await findPendingA1ProductByIdentity(db, input);
  if (!matchedProduct) {
    if (!normalizedBatchNo || !normalizedSerialNumber || !normalizedProductName) {
      return {
        success: false as const,
        message: "查無匯入資料時，需填寫商品批號、商品序號與品名，系統才能先建立流程商品並往下一站",
      };
    }

    const productCode = buildProductCode(completedAt.getTime(), input.operatorUserId);
    const insertedProduct = await db.insert(products).values({
      productCode,
      batchNo: normalizedBatchNo,
      serialNumber: normalizedSerialNumber,
      imei: normalizedImei,
      productName: normalizedProductName,
      currentStationCode: "A1",
      currentStatus: "pending_a1",
      inspectionSummary: "已刷入系統，待匯入比對與 Google 回寫",
    }).$returningId();

    const productId = insertedProduct[0]?.id;
    if (!productId) {
      return { success: false as const, message: "無法建立 A1 臨時商品，請稍後再試" };
    }

    const pendingTask = await ensurePendingA1Task(db, productId, businessDateValue, {
      source: "a1_scan_receive_without_import",
      awaitingImportMatch: true,
    });

    matchedProduct = {
      id: productId,
      productCode,
      poNumber: null,
      vendorName: null,
      importedCategoryName: null,
      batchNo: normalizedBatchNo,
      serialNumber: normalizedSerialNumber,
      imei: normalizedImei,
      productName: normalizedProductName,
      categoryId: null,
      currentStationCode: "A1" as const,
      currentStatus: "pending_a1" as const,
      pendingTaskId: pendingTask?.id ?? null,
    };
  }

  const nextBatchNo = mergeScannedIdentityField("商品批號", matchedProduct.batchNo, normalizedBatchNo);
  const nextSerialNumber = mergeScannedIdentityField("商品序號", matchedProduct.serialNumber, normalizedSerialNumber);
  const nextImei = mergeScannedIdentityField("IMEI", matchedProduct.imei, normalizedImei);
  const nextProductName = mergeScannedIdentityField("品名", matchedProduct.productName, normalizedProductName);
  const pendingTaskId = matchedProduct.pendingTaskId ?? (await ensurePendingA1Task(db, matchedProduct.id, businessDateValue, {
    source: matchedProduct.poNumber ? "a1_scan_receive" : "a1_scan_receive_without_import",
    awaitingImportMatch: matchedProduct.poNumber ? undefined : true,
  }))?.id;

  if (!pendingTaskId) {
    return { success: false as const, message: "找不到可完成的 A1 任務" };
  }

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
      inspectionSummary: matchedProduct.poNumber ? "A1 掃碼點到貨完成，待背景同步 Google" : "已刷入系統，待匯入比對與 Google 回寫",
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

  const textFields = ["username", "passwordHash", "name", "email", "loginMethod"] as const;
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

export async function getUserByUsername(username: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user by username: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

let lastEnsureMvpSeedDataAt = 0;
let lastArchiveExpiredDataAt = 0;

export async function ensureMvpSeedData() {
  if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
    return;
  }

  if (Date.now() - lastEnsureMvpSeedDataAt < 60_000) {
    return;
  }

  lastEnsureMvpSeedDataAt = Date.now();
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
  await ensureDefaultCategoryStationFlows(db, categories.map((item) => item.id));
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

  const catalogRows = await db
    .select({
      id: productNameCatalogEntries.id,
      label: productNameCatalogEntries.label,
      active: productNameCatalogEntries.active,
      sortOrder: productNameCatalogEntries.sortOrder,
      categoryName: productNameCatalogEntries.categoryName,
      brandName: productNameCatalogEntries.brandName,
      sourceRowNumber: productNameCatalogEntries.sourceRowNumber,
    })
    .from(productNameCatalogEntries)
    .where(eq(productNameCatalogEntries.active, true))
    .orderBy(asc(productNameCatalogEntries.sortOrder), asc(productNameCatalogEntries.id));

  if (catalogRows.length > 0) {
    return catalogRows;
  }

  return db
    .select({
      id: productNameOptions.id,
      label: productNameOptions.label,
      active: productNameOptions.active,
      sortOrder: productNameOptions.sortOrder,
      categoryName: sql<string | null>`null`,
      brandName: sql<string | null>`null`,
      sourceRowNumber: sql<number | null>`null`,
    })
    .from(productNameOptions)
    .where(eq(productNameOptions.active, true))
    .orderBy(asc(productNameOptions.sortOrder), asc(productNameOptions.id));
}

export async function getProductCategoryOptions() {
  const db = await getDb();
  if (!db) {
    return [];
  }

  return db
    .select()
    .from(productCategories)
    .where(eq(productCategories.active, true))
    .orderBy(asc(productCategories.categoryName), asc(productCategories.brandName), asc(productCategories.subtypeCode), asc(productCategories.id));
}

export async function assignProductCategoryToProduct(input: { productId: number; categoryId: number | null }) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  if (input.categoryId) {
    const categoryRows = await db
      .select({
        id: productCategories.id,
      })
      .from(productCategories)
      .where(eq(productCategories.id, input.categoryId))
      .limit(1);

    const category = categoryRows[0];
    if (!category) {
      throw new Error("指定的品類設定不存在");
    }
  }

  await db
    .update(products)
    .set({
      categoryId: input.categoryId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(products.id, input.productId));

  const rows = await db
    .select({
      productId: products.id,
      categoryId: products.categoryId,
      importedCategoryName: products.importedCategoryName,
      importedBrandName: products.importedBrandName,
      categoryName: productCategories.categoryName,
      brandName: productCategories.brandName,
      subtypeCode: productCategories.subtypeCode,
      currentStationCode: products.currentStationCode,
    })
    .from(products)
    .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
    .where(eq(products.id, input.productId))
    .limit(1);

  return rows[0] ?? null;
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
    return {
      stationCode,
      label: stationToLabel(stationCode),
      tasks: [],
      faultOptions: [],
      appearanceOptions: [],
      cameraOptions: [],
      bFaultOptions: [],
      recentAutoRemovedStockItems: [],
      poDeletionLogs: [],
    };
  }

  await ensureMvpSeedData();
  if (stationCode === "A1") {
    await backfillMissingImportPoNumbers(db);
  }

  if (stationCode === "STOCK") {
    await reconcilePendingStockFromSheet(db);
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
      importedBrandName: products.importedBrandName,
      categoryId: products.categoryId,
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
    stationCode === "B"
      ? getDefectOptions("B", "fault")
      : stationCode === "C" || stationCode === "D"
        ? getDefectOptions("C", "fault")
        : Promise.resolve([]),
    stationCode === "C" || stationCode === "D" ? getDefectOptions("C", "appearance") : Promise.resolve([]),
    stationCode === "C" || stationCode === "D" ? getDefectOptions("C", "camera") : Promise.resolve([]),
    stationCode === "C" || stationCode === "D" ? getDefectOptions("B", "fault") : Promise.resolve([]),
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
    : stationCode === "D"
      ? await (async () => {
          const productIds = rows.map((row) => row.productId);
          if (productIds.length === 0) {
            return rows.map((row) => ({
              ...row,
              inheritedBatterySummary: "正常",
              inheritedBFaultSummary: "正常",
              inheritedCFaultSummary: "正常",
              inheritedCAppearanceSummary: "正常",
              inheritedCCameraSummary: "正常",
              inheritedCInspectionSummary: "正常",
            }));
          }

          const [completedBRows, completedCRows] = await Promise.all([
            db
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
              .orderBy(desc(stationTasks.completedAt)),
            db
              .select({
                productId: stationTasks.productId,
                metadata: stationTasks.metadata,
                completedAt: stationTasks.completedAt,
              })
              .from(stationTasks)
              .where(and(
                inArray(stationTasks.productId, productIds),
                eq(stationTasks.stationCode, "C"),
                eq(stationTasks.taskStatus, "completed"),
              ))
              .orderBy(desc(stationTasks.completedAt)),
          ]);

          const latestBMetaByProductId = new Map<number, Record<string, unknown>>();
          for (const completedTask of completedBRows) {
            if (latestBMetaByProductId.has(completedTask.productId)) {
              continue;
            }
            latestBMetaByProductId.set(completedTask.productId, (completedTask.metadata ?? {}) as Record<string, unknown>);
          }

          const latestCMetaByProductId = new Map<number, Record<string, unknown>>();
          for (const completedTask of completedCRows) {
            if (latestCMetaByProductId.has(completedTask.productId)) {
              continue;
            }
            latestCMetaByProductId.set(completedTask.productId, (completedTask.metadata ?? {}) as Record<string, unknown>);
          }

          return rows.map((row) => {
            const taskMetadata = (row.taskMetadata ?? {}) as Record<string, unknown>;
            const latestBMetadata = latestBMetaByProductId.get(row.productId) ?? {};
            const latestCMetadata = latestCMetaByProductId.get(row.productId) ?? {};
            const inheritedBatterySummary = typeof (taskMetadata.batterySummary ?? latestBMetadata.batterySummary) === "string"
              && String(taskMetadata.batterySummary ?? latestBMetadata.batterySummary).trim()
              ? String(taskMetadata.batterySummary ?? latestBMetadata.batterySummary).trim()
              : [
                  typeof (taskMetadata.batteryNote ?? latestBMetadata.batteryNote) === "string"
                    ? String(taskMetadata.batteryNote ?? latestBMetadata.batteryNote).trim()
                    : "",
                  ...normalizeTextArray(taskMetadata.batteryIssueLabels ?? latestBMetadata.batteryIssueLabels),
                ].filter(Boolean).join(", ") || "正常";
            const inheritedBFaultSummary = typeof (taskMetadata.faultSummary ?? latestBMetadata.faultSummary) === "string"
              && String(taskMetadata.faultSummary ?? latestBMetadata.faultSummary).trim()
              ? String(taskMetadata.faultSummary ?? latestBMetadata.faultSummary).trim()
              : normalizeTextArray(taskMetadata.faultLabels ?? latestBMetadata.faultLabels).join(", ") || "正常";
            const inheritedCFaultSummary = typeof (taskMetadata.cFaultSummary ?? latestCMetadata.cFaultSummary) === "string"
              && String(taskMetadata.cFaultSummary ?? latestCMetadata.cFaultSummary).trim()
              ? String(taskMetadata.cFaultSummary ?? latestCMetadata.cFaultSummary).trim()
              : normalizeTextArray(taskMetadata.faultLabels ?? latestCMetadata.faultLabels).join(", ") || "正常";
            const inheritedCAppearanceSummary = typeof (taskMetadata.cAppearanceSummary ?? latestCMetadata.cAppearanceSummary) === "string"
              && String(taskMetadata.cAppearanceSummary ?? latestCMetadata.cAppearanceSummary).trim()
              ? String(taskMetadata.cAppearanceSummary ?? latestCMetadata.cAppearanceSummary).trim()
              : normalizeTextArray(taskMetadata.appearanceLabels ?? latestCMetadata.appearanceLabels).join(", ") || "正常";
            const inheritedCCameraSummary = typeof (taskMetadata.cCameraSummary ?? latestCMetadata.cCameraSummary) === "string"
              && String(taskMetadata.cCameraSummary ?? latestCMetadata.cCameraSummary).trim()
              ? String(taskMetadata.cCameraSummary ?? latestCMetadata.cCameraSummary).trim()
              : normalizeTextArray(taskMetadata.cameraLabels ?? latestCMetadata.cameraLabels).join(", ") || "正常";
            const inheritedCInspectionSummary = [inheritedCFaultSummary, inheritedCAppearanceSummary, inheritedCCameraSummary]
              .filter((value) => value && value !== "正常")
              .join(", ") || "正常";

            return {
              ...row,
              inheritedBatterySummary,
              inheritedBFaultSummary,
              inheritedCFaultSummary,
              inheritedCAppearanceSummary,
              inheritedCCameraSummary,
              inheritedCInspectionSummary,
            };
          });
        })()
      : rows;

  const recentAutoRemovedStockItems = stationCode === "STOCK"
    ? (await db
        .select({
          taskId: stationTasks.id,
          productId: products.id,
          productCode: products.productCode,
          batchNo: products.batchNo,
          serialNumber: products.serialNumber,
          imei: products.imei,
          productName: products.productName,
          completedAt: stationTasks.completedAt,
          resultSummary: stationTasks.resultSummary,
        })
        .from(stationTasks)
        .innerJoin(products, eq(stationTasks.productId, products.id))
        .where(and(
          eq(stationTasks.stationCode, "STOCK"),
          eq(stationTasks.taskStatus, "completed"),
          isNull(products.archivedAt),
        ))
        .orderBy(desc(stationTasks.completedAt), desc(stationTasks.id))
        .limit(12))
    : [];

  const poDeletionLogs = stationCode === "A1"
    ? await db
        .select({
          id: purchaseOrderDeletionLogs.id,
          poNumber: purchaseOrderDeletionLogs.poNumber,
          vendorName: purchaseOrderDeletionLogs.vendorName,
          deletedProducts: purchaseOrderDeletionLogs.deletedProducts,
          deletedTasks: purchaseOrderDeletionLogs.deletedTasks,
          deletedByName: purchaseOrderDeletionLogs.deletedByName,
          createdAt: purchaseOrderDeletionLogs.createdAt,
        })
        .from(purchaseOrderDeletionLogs)
        .orderBy(desc(purchaseOrderDeletionLogs.createdAt), desc(purchaseOrderDeletionLogs.id))
        .limit(20)
    : [];

  return {
    stationCode,
    label: stationToLabel(stationCode),
    tasks: nextRows,
    faultOptions,
    appearanceOptions,
    cameraOptions,
    bFaultOptions,
    recentAutoRemovedStockItems,
    poDeletionLogs,
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
    brandName?: string | null;
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
  const { businessDate, businessDateValue } = getOperationTimeContext();
  const importSeed = Date.now();
  const createdProducts: Array<{ id: number; productCode: string; productName: string | null }> = [];
  const normalizedRows = input.rows.map((row) => ({
    categoryName: normalizeOptionalText(row.categoryName),
    brandName: normalizeOptionalText(row.brandName),
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
    if (!row.brandName) {
      throw new Error(`第 ${index + 1} 列缺少品牌`);
    }
    if (!hasImportIdentity(row)) {
      throw new Error(`第 ${index + 1} 列至少要填寫商品批號、商品序號、IMEI 其中一項`);
    }
  }

  await validateImportRowsAgainstProductCatalog(db, normalizedRows);

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
            isNull(products.archivedAt),
            or(...identityConditions),
          ),
        )
    : [];

  const categoryOptions = await db
    .select({
      id: productCategories.id,
      categoryName: productCategories.categoryName,
      brandName: productCategories.brandName,
      subtypeCode: productCategories.subtypeCode,
    })
    .from(productCategories)
    .where(eq(productCategories.active, true));

  const categoryByKeyEntries: Array<[string, (typeof categoryOptions)[number]]> = [];
  categoryOptions.forEach((category) => {
    const normalizedBrand = normalizeCatalogComparisonText(category.brandName ?? category.subtypeCode ?? "");
    const normalizedCategory = normalizeOptionalText(category.categoryName);
    if (!normalizedCategory || !normalizedBrand) {
      return;
    }
    categoryByKeyEntries.push([`${normalizedCategory}__${normalizedBrand}`, category]);
  });
  const categoryByKey = new Map(categoryByKeyEntries);

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
  const importEventInserts: Array<{
    productId: number;
    stationCode: "A1";
    eventType: "enter";
    operatorUserId: number | null;
    businessDate: Date;
    categoryId: number | null;
    subtypeCode: null;
    payload: {
      summary: string;
      source: string;
      vendorName: string;
      poNumber: string;
    };
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
        importedBrandName: string;
        categoryId: number | null;
        currentStationCode: "A1";
        currentStatus: "pending_a1";
        inspectionSummary: string;
      };

  }> = [];

  for (let index = 0; index < normalizedRows.length; index += 1) {
    const row = normalizedRows[index]!;
    const categoryName = row.categoryName as string;
    const brandName = row.brandName as string;
    const matchedCategory = categoryByKey.get(
      `${normalizeOptionalText(categoryName)}__${normalizeCatalogComparisonText(brandName)}`,
    ) ?? null;
    const matchedProduct = (row.imei ? matchedByImei.get(row.imei) : undefined)
      ?? (row.serialNumber ? matchedBySerialNumber.get(row.serialNumber) : undefined)
      ?? (row.batchNo ? matchedByBatchNo.get(row.batchNo) : undefined)
      ?? null;

    if (matchedProduct) {
      const nextBatchNo = matchedProduct.batchNo ?? row.batchNo;
      const nextSerialNumber = matchedProduct.serialNumber ?? row.serialNumber;
      const nextImei = matchedProduct.imei ?? row.imei;
      const nextProductName = matchedProduct.productName ?? row.productName;
      const nextImportedCategoryName = categoryName;
      const nextImportedBrandName = matchedCategory?.brandName ?? brandName;
      const nextCategoryId = matchedCategory?.id ?? null;
      const nextPoNumber = matchedProduct.poNumber ?? resolvedPoNumber;
      const nextVendorName = matchedProduct.vendorName ?? vendorName;
      const nextArrivalAt = matchedProduct.arrivalAt ?? arrivalAt;

      const shouldResetToPendingA1 = matchedProduct.currentStationCode === "A1" && matchedProduct.currentStatus === "pending_a1";

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
          importedBrandName: nextImportedBrandName,
          categoryId: nextCategoryId,
          currentStationCode: shouldResetToPendingA1 ? "A1" : matchedProduct.currentStationCode,
          currentStatus: shouldResetToPendingA1 ? "pending_a1" : matchedProduct.currentStatus,
          inspectionSummary: nextPoNumber ? `PO:${nextPoNumber}` : matchedProduct.inspectionSummary,
          updatedAt: new Date(),
        })
        .where(eq(products.id, matchedProduct.id));

      importEventInserts.push({
        productId: matchedProduct.id,
        stationCode: "A1",
        eventType: "enter",
        operatorUserId: input.importedByUserId ?? null,
        businessDate: businessDateValue,
        categoryId: nextCategoryId,
        subtypeCode: null,
        payload: {
          summary: nextPoNumber ? `匯入更新，PO：${nextPoNumber}` : "匯入更新",
          source: "import_patch",
          vendorName,
          poNumber: nextPoNumber ?? resolvedPoNumber,
        },
      });

      if (shouldResetToPendingA1 && !pendingA1TaskProductIds.has(matchedProduct.id)) {
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
        importedBrandName: matchedCategory?.brandName ?? brandName,
        categoryId: matchedCategory?.id ?? null,
        currentStationCode: "A1",
        currentStatus: "pending_a1",
        inspectionSummary: `PO:${resolvedPoNumber}`,
      },
    });
  }

  if (pendingTaskInserts.length > 0) {
    await db.insert(stationTasks).values(pendingTaskInserts);
  }

  if (importEventInserts.length > 0) {
    await db.insert(stationEvents).values(importEventInserts);
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

    const importEventValues = insertedProducts.flatMap((product, offset) => {
      if (!product?.id) {
        return [];
      }
      const entry = chunk[offset];
      if (!entry) {
        return [];
      }

      return [{
        productId: product.id,
        stationCode: "A1" as const,
        eventType: "enter" as const,
        operatorUserId: input.importedByUserId ?? null,
        businessDate: businessDateValue,
        categoryId: entry.values.categoryId,
        subtypeCode: null,
        payload: {
          summary: resolvedPoNumber ? `匯入建立，PO：${resolvedPoNumber}` : "匯入建立",
          source: "import",
          vendorName,
        },
      }];
    });

    if (importEventValues.length > 0) {
      await db.insert(stationEvents).values(importEventValues);
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
  triggerPurchaseSheetSyncInBackground();
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

  const productRows = await db
    .select({
      categoryId: products.categoryId,
      poNumber: products.poNumber,
      importedCategoryName: products.importedCategoryName,
      importedBrandName: products.importedBrandName,
    })
    .from(products)
    .where(eq(products.id, input.productId))
    .limit(1);
  const productRow = productRows[0] ?? null;
  const effectiveCategoryId = input.categoryId ?? productRow?.categoryId ?? null;
  const nextStation = await resolveNextStationByCategory(effectiveCategoryId, input.stationCode);

  if (input.stationCode === "STOCK" && (!productRow?.poNumber || !productRow.importedCategoryName || !productRow.importedBrandName)) {
    return {
      success: false as const,
      message: "此商品尚未完成匯入比對，請先補匯入對應資料後再完成入庫",
    };
  }
  const { businessDateValue, now: completedAt } = getOperationTimeContext();
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
    categoryId: effectiveCategoryId,
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

  if (input.stationCode === "A2" || input.stationCode === "B" || input.stationCode === "C" || input.stationCode === "E") {
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

    const nextTaskResult = await db.insert(stationTasks).values({
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
    }).$returningId();

    if (nextStation === "STOCK") {
      await db.insert(stationEvents).values({
        productId: input.productId,
        stationTaskId: nextTaskResult[0]?.id ?? null,
        stationCode: "STOCK",
        eventType: "stock_ready",
        operatorUserId: input.operatorUserId,
        businessDate: businessDateValue,
        categoryId: effectiveCategoryId,
        subtypeCode: input.subtypeCode ?? null,
        payload: {
          summary: input.summary ?? `${stationToLabel(input.stationCode)} 完成後進入待入庫`,
          sourceStation: input.stationCode,
        },
      });
    }
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
  categoryId?: number | null;
  subtypeCode?: string | null;
  defectReason?: string;
  applyInspectionChanges?: boolean;
  batterySummary?: string;
  bFaultSummary?: string;
  cFaultSummary?: string;
  cAppearanceSummary?: string;
  cCameraSummary?: string;
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

  const effectiveCategoryId = input.categoryId ?? task.categoryId ?? null;
  const effectiveSubtypeCode = input.subtypeCode ?? task.subtypeCode ?? null;
  const passNextStation = await resolveNextStationByCategory(effectiveCategoryId, "D");
  const failReturnStation = await resolveReworkStationByCategory(effectiveCategoryId, "D") ?? "C";

  const { businessDateValue, now: completedAt } = getOperationTimeContext();
  const normalizedBatterySummary = normalizeOptionalText(input.batterySummary) ?? "正常";
  const normalizedBFaultSummary = normalizeOptionalText(input.bFaultSummary) ?? "正常";
  const normalizedCFaultSummary = normalizeOptionalText(input.cFaultSummary) ?? "正常";
  const normalizedCAppearanceSummary = normalizeOptionalText(input.cAppearanceSummary) ?? "正常";
  const normalizedCCameraSummary = normalizeOptionalText(input.cCameraSummary) ?? "正常";
  const applyInspectionChanges = Boolean(input.applyInspectionChanges);

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
      completedAt,
      resultSummary: input.passed ? `全檢通過，送往 ${stationToLabel(passNextStation ?? "STOCK")}` : `全檢不通過，返工回 ${stationToLabel(failReturnStation)}`,
      metadata: {
        defectReason: input.defectReason ?? null,
        applyInspectionChanges,
        batterySummary: normalizedBatterySummary,
        bFaultSummary: normalizedBFaultSummary,
        cFaultSummary: normalizedCFaultSummary,
        cAppearanceSummary: normalizedCAppearanceSummary,
        cCameraSummary: normalizedCCameraSummary,
      },
      updatedAt: completedAt,
    })
    .where(eq(stationTasks.id, input.taskId));

  await db.insert(stationEvents).values({
    productId: input.productId,
    stationTaskId: input.taskId,
    stationCode: "D",
    eventType: input.passed ? "sampling_pass" : "sampling_fail",
    operatorUserId: input.sampledByUserId,
    businessDate: businessDateValue,
    categoryId: effectiveCategoryId,
    subtypeCode: effectiveSubtypeCode,
    isRework: !input.passed,
    payload: {
      defectReason: input.defectReason ?? null,
      applyInspectionChanges,
      batterySummary: normalizedBatterySummary,
      bFaultSummary: normalizedBFaultSummary,
      cFaultSummary: normalizedCFaultSummary,
      cAppearanceSummary: normalizedCAppearanceSummary,
      cCameraSummary: normalizedCCameraSummary,
    },
  });

  await db.insert(sheetSyncJobs).values({
    jobType: input.passed ? "sampling_pass_sync" : "sampling_fail_sync",
    targetSheetName: "手機檢測資料庫",
    status: "queued",
  });

  await db.insert(sheetSyncJobs).values({
    jobType: "purchase_sheet_sync",
    targetSheetName: "採購單",
    status: "queued",
  });

  triggerPurchaseSheetSyncInBackground();

  if (input.passed) {
    if (passNextStation) {
      await db
        .update(products)
        .set({
          currentStationCode: passNextStation,
          currentStatus: statusForStation(passNextStation),
          updatedAt: completedAt,
        })
        .where(eq(products.id, input.productId));

      await db.insert(stationTasks).values({
        productId: input.productId,
        stationCode: passNextStation,
        taskStatus: "pending",
        dueDate: businessDateValue,
        resultSummary: `${stationToLabel(passNextStation)} 待處理`,
        metadata: {
          sourceStation: "D",
          sampled: true,
          dInspectionPassed: true,
          dInspectionOperatorUserId: input.sampledByUserId,
          dInspectionCompletedAt: completedAt,
          dInspectionModified: applyInspectionChanges,
          batterySummary: normalizedBatterySummary,
          bFaultSummary: normalizedBFaultSummary,
          cFaultSummary: normalizedCFaultSummary,
          cAppearanceSummary: normalizedCAppearanceSummary,
          cCameraSummary: normalizedCCameraSummary,
        },
      });
    }
  } else {
    await db
      .update(products)
      .set({
        currentStationCode: failReturnStation,
        currentStatus: statusForStation(failReturnStation),
        updatedAt: completedAt,
      })
      .where(eq(products.id, input.productId));

    await db.insert(stationTasks).values({
      productId: input.productId,
      stationCode: failReturnStation,
      taskStatus: "returned",
      dueDate: businessDateValue,
      resultSummary: `D 站全檢失敗返工回 ${stationToLabel(failReturnStation)}`,
      metadata: {
        sourceStation: "D",
        reason: input.defectReason ?? "全檢不通過",
        dInspectionPassed: false,
        dInspectionOperatorUserId: input.sampledByUserId,
        dInspectionCompletedAt: completedAt,
        dInspectionModified: applyInspectionChanges,
        batterySummary: normalizedBatterySummary,
        bFaultSummary: normalizedBFaultSummary,
        cFaultSummary: normalizedCFaultSummary,
        cAppearanceSummary: normalizedCAppearanceSummary,
        cCameraSummary: normalizedCCameraSummary,
      },
    });
  }

  return { success: true as const };
}

export async function createSupportCompensation(input: {
  businessDate: string;
  userId: number;
  supportTask: string;
  supportHours: number;
  notes?: string | null;
  createdByUserId: number;
}) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  await db.insert(supportTaskCompensations).values({
    businessDate: dateKeyToDate(input.businessDate),
    userId: input.userId,
    supportTask: input.supportTask.trim(),
    supportHours: input.supportHours.toFixed(2),
    notes: input.notes?.trim() || null,
    createdByUserId: input.createdByUserId,
  });

  return { success: true };
}

export async function listSupportCompensations(input?: SupportCompensationFilterInput) {
  const db = await getDb();
  if (!db) {
    return [];
  }

  const conditions = [];
  if (input?.startDate) {
    conditions.push(gte(supportTaskCompensations.businessDate, dateKeyToDate(input.startDate)));
  }
  if (input?.endDate) {
    conditions.push(lte(supportTaskCompensations.businessDate, dateKeyToDate(input.endDate)));
  }
  if (input?.userId) {
    conditions.push(eq(supportTaskCompensations.userId, input.userId));
  }

  return db
    .select({
      id: supportTaskCompensations.id,
      businessDate: supportTaskCompensations.businessDate,
      userId: supportTaskCompensations.userId,
      supportTask: supportTaskCompensations.supportTask,
      supportHours: supportTaskCompensations.supportHours,
      notes: supportTaskCompensations.notes,
      createdByUserId: supportTaskCompensations.createdByUserId,
      createdAt: supportTaskCompensations.createdAt,
      updatedAt: supportTaskCompensations.updatedAt,
      engineerName: users.name,
      engineerUsername: users.username,
      createdByName: sql<string>`creator.name`,
      createdByUsername: sql<string>`creator.username`,
    })
    .from(supportTaskCompensations)
    .innerJoin(users, eq(supportTaskCompensations.userId, users.id))
    .leftJoin(sql`users as creator`, sql`${supportTaskCompensations.createdByUserId} = creator.id`)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(supportTaskCompensations.businessDate), desc(supportTaskCompensations.createdAt), desc(supportTaskCompensations.id));
}

export async function deleteSupportCompensation(id: number) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  await db.delete(supportTaskCompensations).where(eq(supportTaskCompensations.id, id));
  return { success: true };
}

export async function getSupportCompensationPointsForUser(userId: number, dateKey: string) {
  const db = await getDb();
  if (!db) {
    return 0;
  }

  const rows = await db
    .select({
      supportHours: supportTaskCompensations.supportHours,
    })
    .from(supportTaskCompensations)
    .where(and(eq(supportTaskCompensations.userId, userId), eq(supportTaskCompensations.businessDate, dateKeyToDate(dateKey))));

  return rows.reduce((sum, row) => sum + getSupportCompensationInternalPoints(Number(row.supportHours)), 0);
}

export async function getEngineerKpiSummary(userId: number) {
  const db = await getDb();
  if (!db) {
    return {
      dailySummary: null,
      details: [],
      monthlySummary: {
        attendanceDays: 0,
        monthTotalPoints: 0,
        monthAvgPoints: 0,
        monthAvgRate: 0,
        monthTotalDisplayPoints: 0,
        monthAvgDisplayPoints: 0,
        monthSupportHours: 0,
        monthSupportPoints: 0,
        monthSupportDisplayPoints: 0,
      },
    };
  }

  await ensureMvpSeedData();
  const { businessDate, businessDateValue } = getOperationTimeContext();
  const monthPrefix = businessDate.slice(0, 7);

  const [detailRows, eventRows, samplingRows, supportRows] = await Promise.all([
    db
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
      .orderBy(desc(productivityScoreDetails.id)),
    db
      .select({
        productId: stationEvents.productId,
        stationCode: stationEvents.stationCode,
        eventType: stationEvents.eventType,
        isRework: stationEvents.isRework,
        businessDate: stationEvents.businessDate,
      })
      .from(stationEvents)
      .where(eq(stationEvents.operatorUserId, userId)),
    db
      .select({
        passed: samplingResults.passed,
        sampleDate: samplingResults.sampleDate,
        sampledByUserId: samplingResults.sampledByUserId,
      })
      .from(samplingResults)
      .where(eq(samplingResults.sampledByUserId, userId)),
    db
      .select({
        businessDate: supportTaskCompensations.businessDate,
        supportTask: supportTaskCompensations.supportTask,
        supportHours: supportTaskCompensations.supportHours,
        notes: supportTaskCompensations.notes,
      })
      .from(supportTaskCompensations)
      .where(eq(supportTaskCompensations.userId, userId))
      .orderBy(desc(supportTaskCompensations.businessDate), desc(supportTaskCompensations.id)),
  ]);

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
  const monthDetails = detailRows.filter((row) => toDateKey(row.businessDate).startsWith(monthPrefix));
  const dailyEvents = eventRows.filter((row) => toDateKey(row.businessDate) === businessDate);
  const dailySampling = samplingRows.filter((row) => toDateKey(row.sampleDate) === businessDate);
  const completedEvents = dailyEvents.filter((row) => row.eventType === "complete");
  const reworkEvents = dailyEvents.filter((row) => row.isRework);
  const dailySupportRows = supportRows.filter((row) => toDateKey(row.businessDate) === businessDate);
  const monthSupportRows = supportRows.filter((row) => toDateKey(row.businessDate).startsWith(monthPrefix));

  const productivityPoints = dailyDetails.reduce((sum, row) => sum + Number(row.earnedPoints), 0);
  const todaySupportHours = dailySupportRows.reduce((sum, row) => sum + Number(row.supportHours), 0);
  const todaySupportPoints = getSupportCompensationInternalPoints(todaySupportHours);
  const totalPoints = productivityPoints + todaySupportPoints;
  const rawAchievementRate = toDisplayPoints(totalPoints);
  const kpiAchievementRate = Math.min(rawAchievementRate, 100);
  const overAchievementRate = Math.max(rawAchievementRate - 100, 0);

  const attendanceDateSet = new Set<string>([
    ...monthDetails.map((row) => toDateKey(row.businessDate)),
    ...monthSupportRows.map((row) => toDateKey(row.businessDate)),
  ]);
  const attendanceDays = attendanceDateSet.size;
  const monthProductivityPoints = monthDetails.reduce((sum, row) => sum + Number(row.earnedPoints), 0);
  const monthSupportHours = monthSupportRows.reduce((sum, row) => sum + Number(row.supportHours), 0);
  const monthSupportPoints = getSupportCompensationInternalPoints(monthSupportHours);
  const monthTotalPoints = monthProductivityPoints + monthSupportPoints;
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

  const fairnessScore = Math.min(100, toDisplayPoints(monthAvgPoints));

  return {
    dailySummary: {
      businessDate: businessDateValue,
      totalPoints,
      displayPoints: toDisplayPoints(totalPoints),
      productivityPoints,
      productivityDisplayPoints: toDisplayPoints(productivityPoints),
      supportHours: todaySupportHours,
      supportPoints: todaySupportPoints,
      supportDisplayPoints: toDisplayPoints(todaySupportPoints),
      rawAchievementRate,
      kpiAchievementRate,
      overAchievementRate,
      dimensions: {
        productivity: {
          score: Math.min(kpiAchievementRate, 100),
          totalPoints,
          displayPoints: toDisplayPoints(totalPoints),
          supportDisplayPoints: toDisplayPoints(todaySupportPoints),
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
          monthAvgDisplayPoints: toDisplayPoints(monthAvgPoints),
        },
      },
      supportCompensations: dailySupportRows.map((row) => ({
        businessDate: row.businessDate,
        supportTask: row.supportTask,
        supportHours: Number(row.supportHours),
        supportPoints: getSupportCompensationInternalPoints(Number(row.supportHours)),
        supportDisplayPoints: toDisplayPoints(getSupportCompensationInternalPoints(Number(row.supportHours))),
        notes: row.notes,
      })),
    },
    details: dailyDetails,
    monthlySummary: {
      attendanceDays,
      monthTotalPoints,
      monthAvgPoints,
      monthAvgRate: toDisplayPoints(monthAvgPoints),
      monthTotalDisplayPoints: toDisplayPoints(monthTotalPoints),
      monthAvgDisplayPoints: toDisplayPoints(monthAvgPoints),
      monthSupportHours,
      monthSupportPoints,
      monthSupportDisplayPoints: toDisplayPoints(monthSupportPoints),
    },
  };
}

export async function seedKpiForDemo(userId: number) {
  if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
    return;
  }

  const db = await getDb();
  if (!db) return;

  await ensureMvpSeedData();
  const existing = await db.select({ count: sql<number>`count(*)` }).from(productivityScoreDetails).where(eq(productivityScoreDetails.userId, userId));
  if ((existing[0]?.count ?? 0) > 0) {
    return;
  }

  const { businessDate, businessDateValue } = getOperationTimeContext();
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
  if (Date.now() - lastArchiveExpiredDataAt < 60_000) {
    return { archivedCount: 0 };
  }

  lastArchiveExpiredDataAt = Date.now();
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

type AdminDateRangeInput = {
  startDate?: string | null;
  endDate?: string | null;
};

function getCurrentMonthStartDate(dateKey: string) {
  return `${dateKey.slice(0, 7)}-01`;
}

function normalizeAdminDateRange(input?: AdminDateRangeInput) {
  const todayKey = todayDateString();
  const normalizedStart = (input?.startDate ?? "").trim() || getCurrentMonthStartDate(todayKey);
  const normalizedEnd = (input?.endDate ?? "").trim() || todayKey;
  const [startDate, endDate] = normalizedStart <= normalizedEnd
    ? [normalizedStart, normalizedEnd]
    : [normalizedEnd, normalizedStart];

  return {
    todayKey,
    startDate,
    endDate,
  };
}

function isDateKeyWithinRange(dateKey: string, range: { startDate: string; endDate: string }) {
  return dateKey >= range.startDate && dateKey <= range.endDate;
}

async function getAdminEngineerKpiProgress(input?: AdminDateRangeInput) {
  const db = await getDb();
  if (!db) {
    return [];
  }

  const range = normalizeAdminDateRange(input);
  const [userRows, productivityRows, supportRows] = await Promise.all([
    db
      .select({
        id: users.id,
        username: users.username,
        name: users.name,
        role: users.role,
      })
      .from(users)
      .where(notInArray(users.role, ["admin"])),
    db
      .select({
        userId: engineerDailyProductivity.userId,
        businessDate: engineerDailyProductivity.businessDate,
        totalPoints: engineerDailyProductivity.totalPoints,
        kpiAchievementRate: engineerDailyProductivity.kpiAchievementRate,
        rawAchievementRate: engineerDailyProductivity.rawAchievementRate,
        overAchievementRate: engineerDailyProductivity.overAchievementRate,
        finalKpiScore: engineerDailyProductivity.finalKpiScore,
        attendanceFlag: engineerDailyProductivity.attendanceFlag,
      })
      .from(engineerDailyProductivity),
    db
      .select({
        userId: supportTaskCompensations.userId,
        businessDate: supportTaskCompensations.businessDate,
        supportHours: supportTaskCompensations.supportHours,
      })
      .from(supportTaskCompensations)
      .where(and(
        gte(supportTaskCompensations.businessDate, dateKeyToDate(range.startDate)),
        lte(supportTaskCompensations.businessDate, dateKeyToDate(range.endDate)),
      )),
  ]);

  const rangedRows = productivityRows.filter((row) => isDateKeyWithinRange(toDateKey(row.businessDate), range));
  const supportByUserDate = new Map<string, { supportHours: number; supportPoints: number }>();

  supportRows.forEach((row) => {
    const dateKey = toDateKey(row.businessDate);
    const key = `${row.userId}-${dateKey}`;
    const current = supportByUserDate.get(key) ?? { supportHours: 0, supportPoints: 0 };
    const hours = Number(row.supportHours);
    current.supportHours += hours;
    current.supportPoints += getSupportCompensationInternalPoints(hours);
    supportByUserDate.set(key, current);
  });

  return userRows
    .map((user) => {
      const rows = rangedRows.filter((row) => row.userId === user.id);
      const rowsByDate = new Map<string, (typeof rows)[number]>();
      rows.forEach((row) => {
        rowsByDate.set(toDateKey(row.businessDate), row);
      });

      const attendanceDateSet = new Set<string>();
      rows.forEach((row) => {
        if (row.attendanceFlag) {
          attendanceDateSet.add(toDateKey(row.businessDate));
        }
      });
      supportRows
        .filter((row) => row.userId === user.id)
        .forEach((row) => attendanceDateSet.add(toDateKey(row.businessDate)));

      const todaySupport = supportByUserDate.get(`${user.id}-${range.todayKey}`) ?? { supportHours: 0, supportPoints: 0 };
      const todayProductivityPoints = Number(rowsByDate.get(range.todayKey)?.totalPoints ?? 0);
      const todayPoints = todayProductivityPoints + todaySupport.supportPoints;
      const rangeSupportPoints = Array.from(supportByUserDate.entries())
        .filter(([key]) => key.startsWith(`${user.id}-`))
        .reduce((sum, [, value]) => sum + value.supportPoints, 0);
      const rangeSupportHours = Array.from(supportByUserDate.entries())
        .filter(([key]) => key.startsWith(`${user.id}-`))
        .reduce((sum, [, value]) => sum + value.supportHours, 0);
      const rangeProductivityPoints = rows.reduce((sum, row) => sum + Number(row.totalPoints), 0);
      const rangeTotalPoints = rangeProductivityPoints + rangeSupportPoints;
      const attendanceDays = attendanceDateSet.size;
      const monthAvgPoints = attendanceDays > 0 ? rangeTotalPoints / attendanceDays : 0;
      const avgKpiAchievementRate = attendanceDays > 0 ? Math.min(toDisplayPoints(monthAvgPoints), 100) : 0;
      const rawAchievementRate = toDisplayPoints(todayPoints);
      const overAchievementRate = Math.max(rawAchievementRate - 100, 0);
      const finalKpiScore = rows.length > 0 ? Number(rows[rows.length - 1]?.finalKpiScore ?? 0) : Math.min(rawAchievementRate, 100);

      return {
        userId: user.id,
        username: user.username ?? "-",
        name: user.name ?? user.username ?? `User-${user.id}`,
        role: user.role,
        attendanceDays,
        todayPoints,
        todayDisplayPoints: toDisplayPoints(todayPoints),
        todaySupportHours: todaySupport.supportHours,
        todaySupportPoints: todaySupport.supportPoints,
        todaySupportDisplayPoints: toDisplayPoints(todaySupport.supportPoints),
        monthTotalPoints: rangeTotalPoints,
        monthTotalDisplayPoints: toDisplayPoints(rangeTotalPoints),
        todayLabel: range.todayKey,
        rangeStartDate: range.startDate,
        rangeEndDate: range.endDate,
        monthAvgPoints,
        monthAvgDisplayPoints: toDisplayPoints(monthAvgPoints),
        rangeSupportHours,
        rangeSupportPoints,
        rangeSupportDisplayPoints: toDisplayPoints(rangeSupportPoints),
        avgKpiAchievementRate,
        rawAchievementRate,
        overAchievementRate,
        finalKpiScore,
      };
    })
    .sort((left, right) => right.monthTotalPoints - left.monthTotalPoints || right.finalKpiScore - left.finalKpiScore);
}

async function getAdminStationLeadTimes() {
  const db = await getDb();
  if (!db) {
    return [];
  }

  const rows = await db
    .select({
      stationCode: stationTasks.stationCode,
      taskCreatedAt: stationTasks.createdAt,
      taskCompletedAt: stationTasks.completedAt,
      arrivalAt: products.arrivalAt,
      importedAt: products.createdAt,
    })
    .from(stationTasks)
    .innerJoin(products, eq(stationTasks.productId, products.id))
    .where(isNull(products.archivedAt));

  const grouped = new Map<StationCode, { totalDays: number; shortestDays: number; longestDays: number; sampleCount: number }>();

  rows.forEach((row) => {
    const startAt = row.arrivalAt ?? row.importedAt;
    const endAt = row.taskCompletedAt ?? row.taskCreatedAt;
    const diffDays = Math.max(0, (endAt.getTime() - startAt.getTime()) / 86_400_000);
    const current = grouped.get(row.stationCode as StationCode) ?? {
      totalDays: 0,
      shortestDays: diffDays,
      longestDays: diffDays,
      sampleCount: 0,
    };

    current.totalDays += diffDays;
    current.shortestDays = Math.min(current.shortestDays, diffDays);
    current.longestDays = Math.max(current.longestDays, diffDays);
    current.sampleCount += 1;
    grouped.set(row.stationCode as StationCode, current);
  });

  return STATION_CODES.map((stationCode) => {
    const summary = grouped.get(stationCode) ?? { totalDays: 0, shortestDays: 0, longestDays: 0, sampleCount: 0 };
    return {
      stationCode,
      label: stationCode === "STOCK" ? "待入庫" : stationCode,
      sampleCount: summary.sampleCount,
      avgDaysFromImport: summary.sampleCount > 0 ? summary.totalDays / summary.sampleCount : 0,
      shortestDays: summary.shortestDays,
      longestDays: summary.longestDays,
    };
  });
}

async function getAdminCategoryStockCycleTimes() {
  const db = await getDb();
  if (!db) {
    return [];
  }

  const rows = await db
    .select({
      stockCreatedAt: stationTasks.createdAt,
      stockCompletedAt: stationTasks.completedAt,
      arrivalAt: products.arrivalAt,
      importedAt: products.createdAt,
      importedCategoryName: products.importedCategoryName,
      importedBrandName: products.importedBrandName,
      categoryName: productCategories.categoryName,
      brandName: productCategories.brandName,
    })
    .from(stationTasks)
    .innerJoin(products, eq(stationTasks.productId, products.id))
    .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
    .where(and(eq(stationTasks.stationCode, "STOCK"), isNull(products.archivedAt)));

  const grouped = new Map<string, { categoryName: string; brandName: string; totalDays: number; shortestDays: number; longestDays: number; sampleCount: number }>();

  rows.forEach((row) => {
    const categoryName = row.categoryName ?? row.importedCategoryName ?? "未分類";
    const brandName = row.brandName ?? row.importedBrandName ?? "未指定品牌";
    const startAt = row.arrivalAt ?? row.importedAt;
    const endAt = row.stockCompletedAt ?? row.stockCreatedAt;
    const diffDays = Math.max(0, (endAt.getTime() - startAt.getTime()) / 86_400_000);
    const key = `${categoryName}::${brandName}`;
    const current = grouped.get(key) ?? {
      categoryName,
      brandName,
      totalDays: 0,
      shortestDays: diffDays,
      longestDays: diffDays,
      sampleCount: 0,
    };

    current.totalDays += diffDays;
    current.shortestDays = Math.min(current.shortestDays, diffDays);
    current.longestDays = Math.max(current.longestDays, diffDays);
    current.sampleCount += 1;
    grouped.set(key, current);
  });

  return Array.from(grouped.values())
    .map((item) => ({
      categoryName: item.categoryName,
      brandName: item.brandName,
      sampleCount: item.sampleCount,
      avgDaysToStock: item.sampleCount > 0 ? item.totalDays / item.sampleCount : 0,
      shortestDays: item.shortestDays,
      longestDays: item.longestDays,
    }))
    .sort((left, right) => right.avgDaysToStock - left.avgDaysToStock || right.sampleCount - left.sampleCount);
}

export async function getCategoryStationFlowConfigs() {
  const db = await getDb();
  if (!db) {
    return [];
  }

  return db
    .select()
    .from(categoryStationFlows)
    .orderBy(asc(categoryStationFlows.categoryId), asc(categoryStationFlows.stepOrder), asc(categoryStationFlows.id));
}

export async function replaceCategoryStationFlow(input: { categoryId: number; stationCodes: StationCode[] }) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  const uniqueCodes = Array.from(new Set(input.stationCodes)).filter((code) => code !== undefined) as StationCode[];
  if (uniqueCodes.length === 0) {
    throw new Error("至少要保留一個流程節點");
  }

  if (uniqueCodes[0] !== "A1") {
    throw new Error("品類流程必須從 A1 開始");
  }

  if (uniqueCodes[uniqueCodes.length - 1] !== "STOCK") {
    throw new Error("品類流程必須以待入庫結束");
  }

  await db.delete(categoryStationFlows).where(eq(categoryStationFlows.categoryId, input.categoryId));
  await db.insert(categoryStationFlows).values(uniqueCodes.map((stationCode, index) => ({
    categoryId: input.categoryId,
    stationCode,
    stepOrder: index + 1,
    active: true,
  })));

  return getCategoryStationFlowConfigs();
}

export async function getPendingStockImportMismatchProducts() {
  const db = await getDb();
  if (!db) {
    return [];
  }

  await ensureMvpSeedData();

  const rows = await db
    .select({
      productId: products.id,
      productCode: products.productCode,
      poNumber: products.poNumber,
      vendorName: products.vendorName,
      batchNo: products.batchNo,
      serialNumber: products.serialNumber,
      imei: products.imei,
      productName: products.productName,
      arrivalAt: products.arrivalAt,
      currentStationCode: products.currentStationCode,
      currentStatus: products.currentStatus,
      importedCategoryName: products.importedCategoryName,
      importedBrandName: products.importedBrandName,
      assignedCategoryName: productCategories.categoryName,
      assignedBrandName: productCategories.brandName,
      sheetRowNumber: products.sheetRowNumber,
      lastSheetSyncedAt: products.lastSheetSyncedAt,
      updatedAt: products.updatedAt,
      stockTaskId: stationTasks.id,
      stockTaskStatus: stationTasks.taskStatus,
      stockTaskCreatedAt: stationTasks.createdAt,
    })
    .from(products)
    .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
    .leftJoin(
      stationTasks,
      and(
        eq(stationTasks.productId, products.id),
        eq(stationTasks.stationCode, "STOCK"),
        inArray(stationTasks.taskStatus, ["pending", "in_progress", "overdue", "returned"]),
      ),
    )
    .where(and(
      isNull(products.archivedAt),
      sql`NOT (${products.currentStationCode} = 'A1' AND ${products.currentStatus} = 'pending_a1')`,
      sql`${products.currentStatus} <> 'completed'`,
      sql`${products.currentStatus} <> 'archived'`,
      or(
        isNull(products.poNumber),
        isNull(products.importedCategoryName),
        isNull(products.importedBrandName),
        isNull(products.sheetRowNumber),
        isNull(products.lastSheetSyncedAt),
      ),
    ))
    .orderBy(desc(products.updatedAt), desc(products.id));

  return rows
    .filter((row) => isPendingStockImportMismatch(row))
    .map((row) => ({
      ...row,
      ...buildPendingStockMismatchSummary(row),
    }));
}

export async function getAdminSetupData(input?: AdminDateRangeInput) {
  const db = await getDb();
  const normalizedRange = normalizeAdminDateRange(input);
  if (!db) {
    return {
      users: [],
      rules: [],
      categories: [],
      targets: [],
      productNameOptions: [],
      kpiProgress: [],
      supportCompensations: [],
      stationLeadTimes: [],
      categoryStockCycleTimes: [],
      categoryFlows: [],
      kpiRange: {
        startDate: normalizedRange.startDate,
        endDate: normalizedRange.endDate,
      },
    };
  }

  await ensureMvpSeedData();
  const queuedSyncJobsCount = await countQueuedSheetSyncJobs();

  const archiveCandidates = await db
    .select({ count: sql<number>`count(*)` })
    .from(products)
    .where(and(isNull(products.archivedAt), sql`${products.createdAt} < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 6 MONTH)`));

  const [userRows, ruleRows, categoryRows, targetRows, defectOptionRows, productNameRows, kpiProgress, supportCompensations, stationLeadTimes, categoryStockCycleTimes, categoryFlows] = await Promise.all([
    db.select().from(users).orderBy(asc(users.id)),
    db.select().from(stationRules).orderBy(asc(stationRules.id)),
    db.select().from(productCategories).orderBy(asc(productCategories.categoryName), asc(productCategories.brandName), asc(productCategories.id)),
    db.select().from(productivityTargetConfigs).orderBy(asc(productivityTargetConfigs.id)),
    db.select().from(defectOptions).orderBy(asc(defectOptions.stationCode), asc(defectOptions.optionType), asc(defectOptions.sortOrder), asc(defectOptions.id)),
    db.select().from(productNameOptions).orderBy(asc(productNameOptions.sortOrder), asc(productNameOptions.id)),
    getAdminEngineerKpiProgress(normalizedRange),
    listSupportCompensations(normalizedRange),
    getAdminStationLeadTimes(),
    getAdminCategoryStockCycleTimes(),
    getCategoryStationFlowConfigs(),
  ]);

  return {
    users: userRows,
    rules: ruleRows,
    categories: categoryRows,
    targets: targetRows,
    defectOptions: defectOptionRows,
    productNameOptions: productNameRows,
    kpiProgress,
    supportCompensations,
    stationLeadTimes,
    categoryStockCycleTimes,
    categoryFlows,
    kpiRange: {
      startDate: normalizedRange.startDate,
      endDate: normalizedRange.endDate,
    },
    syncSummary: {
      queuedJobs: queuedSyncJobsCount,
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

export async function syncProductNameOptionsFromGoogleSheet() {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  const catalogEntries = await getProductNameCatalogEntriesFromGoogleSheet();
  if (catalogEntries.length === 0) {
    throw new Error("Google 試算表 H／L／N 欄沒有可同步的商品編碼資料");
  }

  const [existingOptionRows, existingCatalogRows] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(productNameOptions),
    db.select({ count: sql<number>`count(*)` }).from(productNameCatalogEntries),
  ]);

  const uniqueLabels = Array.from(new Map(catalogEntries.map((entry) => [entry.label, entry.label])).values());

  await db.delete(productNameCatalogEntries);
  await db.delete(productNameOptions);

  await db.insert(productNameCatalogEntries).values(catalogEntries.map((entry) => ({
    label: entry.label,
    categoryName: entry.categoryName,
    brandName: entry.brandName,
    sourceRowNumber: entry.sourceRowNumber,
    sortOrder: entry.sortOrder,
    active: true,
  })));

  await db.insert(productNameOptions).values(uniqueLabels.map((label, index) => ({
    label,
    active: true,
    sortOrder: (index + 1) * 10,
  })));

  return {
    spreadsheetId: PRODUCT_NAME_SYNC_SPREADSHEET_ID,
    sheetName: PRODUCT_NAME_SYNC_SHEET_NAME,
    columns: ["H", "L", "N"],
    deletedExistingLabels: existingOptionRows[0]?.count ?? 0,
    deletedExistingCatalogEntries: existingCatalogRows[0]?.count ?? 0,
    insertedLabels: uniqueLabels.length,
    insertedCatalogEntries: catalogEntries.length,
    firstInsertedLabels: uniqueLabels.slice(0, 20),
  };
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

  if (rows[0]) {
    await ensureDefaultCategoryStationFlows(db, [rows[0].id]);
  }

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
  await db.delete(categoryStationFlows).where(eq(categoryStationFlows.categoryId, id));
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
  await db.delete(categoryStationFlows).where(inArray(categoryStationFlows.categoryId, ids));
  await db.delete(productCategories).where(inArray(productCategories.id, ids));
  return { success: true as const, clearedCount: ids.length };
}

export async function getImportBatchBackups() {
  const db = await getDb();
  if (!db) {
    return [];
  }

  const backupRows = await db
    .select({
      id: importBatchBackups.id,
      poNumber: importBatchBackups.poNumber,
      vendorName: importBatchBackups.vendorName,
      backupLabel: importBatchBackups.backupLabel,
      productCount: importBatchBackups.productCount,
      createdAt: importBatchBackups.createdAt,
      restoredAt: importBatchBackups.restoredAt,
      createdByUserId: importBatchBackups.createdByUserId,
      restoredByUserId: importBatchBackups.restoredByUserId,
      snapshot: importBatchBackups.snapshot,
    })
    .from(importBatchBackups)
    .orderBy(desc(importBatchBackups.id))
    .limit(12);

  const poNumbers = Array.from(new Set(backupRows.map((row) => row.poNumber).filter(Boolean)));
  const currentRows = poNumbers.length > 0
    ? await db
      .select({
        poNumber: products.poNumber,
        batchNo: products.batchNo,
        serialNumber: products.serialNumber,
        imei: products.imei,
        currentStationCode: products.currentStationCode,
        currentStatus: products.currentStatus,
      })
      .from(products)
      .where(and(inArray(products.poNumber, poNumbers), isNull(products.archivedAt)))
    : [];

  const currentRowMap = currentRows.reduce((accumulator, row) => {
    const current = accumulator.get(row.poNumber ?? "") ?? [];
    current.push(row);
    accumulator.set(row.poNumber ?? "", current);
    return accumulator;
  }, new Map<string, typeof currentRows>());

  return backupRows.map((row) => {
    const snapshot = row.snapshot as ImportBackupSnapshot;
    const snapshotRows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
    const liveRows = currentRowMap.get(row.poNumber) ?? [];
    const snapshotKeys = new Set(snapshotRows.map((item) => buildImportRowIdentity(item)).filter(Boolean));
    const liveKeys = new Set(liveRows.map((item) => buildImportRowIdentity(item)).filter(Boolean));
    const matchedCount = Array.from(snapshotKeys).filter((identity) => liveKeys.has(identity)).length;
    const progressedCount = liveRows.filter((item) => item.currentStationCode !== "A1" || item.currentStatus !== "pending_a1").length;

    return {
      id: row.id,
      poNumber: row.poNumber,
      vendorName: row.vendorName,
      backupLabel: row.backupLabel,
      productCount: row.productCount,
      createdAt: row.createdAt,
      restoredAt: row.restoredAt,
      createdByUserId: row.createdByUserId,
      restoredByUserId: row.restoredByUserId,
      previewCount: snapshotRows.length,
      previewOverflowCount: Math.max(snapshotRows.length - 5, 0),
      previewRows: snapshotRows.slice(0, 5),
      diffSummary: {
        currentLiveCount: liveRows.length,
        matchedCount,
        missingFromCurrentCount: Math.max(snapshotKeys.size - matchedCount, 0),
        extraInCurrentCount: Math.max(liveKeys.size - matchedCount, 0),
        progressedCount,
      },
    };
  });
}

type ImportBackupSnapshot = {
  poNumber: string;
  vendorName: string;
  arrivalAt: string | null;
  rows: Array<{
    batchNo?: string | null;
    serialNumber?: string | null;
    imei?: string | null;
    productName?: string | null;
    categoryName: string;
    brandName: string;
  }>;
};

export async function createImportBatchBackup(input: {
  poNumber: string;
  createdByUserId: number;
  backupLabel?: string | null;
}) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  const normalizedPoNumber = normalizeOptionalText(input.poNumber);
  if (!normalizedPoNumber) {
    throw new Error("PO 單號為必填欄位");
  }

  const productRows = await db
    .select({
      id: products.id,
      poNumber: products.poNumber,
      vendorName: products.vendorName,
      arrivalAt: products.arrivalAt,
      batchNo: products.batchNo,
      serialNumber: products.serialNumber,
      imei: products.imei,
      productName: products.productName,
      importedCategoryName: products.importedCategoryName,
      importedBrandName: products.importedBrandName,
      categoryName: productCategories.categoryName,
      brandName: productCategories.brandName,
      currentStationCode: products.currentStationCode,
      currentStatus: products.currentStatus,
    })
    .from(products)
    .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
    .where(and(eq(products.poNumber, normalizedPoNumber), isNull(products.archivedAt)));

  if (productRows.length === 0) {
    throw new Error("找不到可備份的採購單資料");
  }

  const progressedProducts = productRows.filter((row) => row.currentStationCode !== "A1" || row.currentStatus !== "pending_a1");
  if (progressedProducts.length > 0) {
    throw new Error("目前僅支援備份尚未開始流轉的匯入批次，請先確認該 PO 的商品仍停留在 A1 待處理");
  }

  const snapshot: ImportBackupSnapshot = {
    poNumber: normalizedPoNumber,
    vendorName: productRows[0]?.vendorName ?? "",
    arrivalAt: productRows[0]?.arrivalAt ? new Date(productRows[0].arrivalAt).toISOString() : null,
    rows: productRows.map((row) => ({
      batchNo: row.batchNo,
      serialNumber: row.serialNumber,
      imei: row.imei,
      productName: row.productName,
      categoryName: row.importedCategoryName ?? row.categoryName ?? "未分類",
      brandName: row.importedBrandName ?? row.brandName ?? "未指定品牌",
    })),
  };

  await db.insert(importBatchBackups).values({
    poNumber: normalizedPoNumber,
    vendorName: snapshot.vendorName,
    backupLabel: normalizeOptionalText(input.backupLabel) ?? `${normalizedPoNumber} 匯入備份`,
    productCount: snapshot.rows.length,
    createdByUserId: input.createdByUserId,
    snapshot,
  });

  const rows = await db
    .select()
    .from(importBatchBackups)
    .where(eq(importBatchBackups.poNumber, normalizedPoNumber))
    .orderBy(desc(importBatchBackups.id))
    .limit(1);

  return rows[0] ?? null;
}

export async function restoreImportBatchBackup(input: {
  backupId: number;
  restoredByUserId: number;
}) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  const backup = (await db
    .select()
    .from(importBatchBackups)
    .where(eq(importBatchBackups.id, input.backupId))
    .limit(1))[0];

  if (!backup) {
    throw new Error("找不到指定備份");
  }

  const snapshot = backup.snapshot as ImportBackupSnapshot;
  if (!snapshot?.poNumber || !Array.isArray(snapshot.rows) || snapshot.rows.length === 0) {
    throw new Error("備份內容不完整，無法還原");
  }

  const existing = await db
    .select({ count: sql<number>`count(*)` })
    .from(products)
    .where(and(eq(products.poNumber, snapshot.poNumber), isNull(products.archivedAt)));
  if ((existing[0]?.count ?? 0) > 0) {
    throw new Error("目前資料庫已存在相同 PO 單號資料，請先刪除或更換備份再還原");
  }

  const restoreResult = await importProducts({
    poNumber: snapshot.poNumber,
    vendorName: snapshot.vendorName,
    arrivalAt: snapshot.arrivalAt ?? undefined,
    importedByUserId: input.restoredByUserId,
    rows: snapshot.rows,
  });

  await db
    .update(importBatchBackups)
    .set({
      restoredAt: new Date(),
      restoredByUserId: input.restoredByUserId,
    })
    .where(eq(importBatchBackups.id, input.backupId));

  return {
    success: true as const,
    backupId: backup.id,
    poNumber: snapshot.poNumber,
    restoredCount: restoreResult.importedCount,
  };
}

export async function getProductTraceByIdentity(keyword: string) {
  const db = await getDb();
  const normalizedKeyword = normalizeOptionalText(keyword);
  if (!db || !normalizedKeyword) {
    return [];
  }

  const productRows = await db
    .select({
      id: products.id,
      productCode: products.productCode,
      poNumber: products.poNumber,
      vendorName: products.vendorName,
      batchNo: products.batchNo,
      serialNumber: products.serialNumber,
      imei: products.imei,
      productName: products.productName,
      importedCategoryName: products.importedCategoryName,
      importedBrandName: products.importedBrandName,
      currentStationCode: products.currentStationCode,
      currentStatus: products.currentStatus,
      createdAt: products.createdAt,
      updatedAt: products.updatedAt,
      archivedAt: products.archivedAt,
      categoryName: productCategories.categoryName,
      brandName: productCategories.brandName,
    })
    .from(products)
    .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
    .where(and(
      isNull(products.archivedAt),
      or(
        eq(products.batchNo, normalizedKeyword),
        eq(products.serialNumber, normalizedKeyword),
        eq(products.imei, normalizedKeyword),
      ),
    ))
    .orderBy(desc(products.updatedAt))
    .limit(20);

  if (productRows.length === 0) {
    return [];
  }

  const productIds = productRows.map((row) => row.id);
  const [taskRows, eventRows] = await Promise.all([
    db
      .select({
        id: stationTasks.id,
        productId: stationTasks.productId,
        stationCode: stationTasks.stationCode,
        taskStatus: stationTasks.taskStatus,
        startedAt: stationTasks.startedAt,
        completedAt: stationTasks.completedAt,
        dueDate: stationTasks.dueDate,
        resultSummary: stationTasks.resultSummary,
        metadata: stationTasks.metadata,
        createdAt: stationTasks.createdAt,
        updatedAt: stationTasks.updatedAt,
      })
      .from(stationTasks)
      .where(inArray(stationTasks.productId, productIds))
      .orderBy(asc(stationTasks.productId), asc(stationTasks.id)),
    db
      .select({
        id: stationEvents.id,
        productId: stationEvents.productId,
        stationTaskId: stationEvents.stationTaskId,
        stationCode: stationEvents.stationCode,
        eventType: stationEvents.eventType,
        businessDate: stationEvents.businessDate,
        createdAt: stationEvents.createdAt,
        payload: stationEvents.payload,
        operatorName: users.name,
        operatorUsername: users.username,
      })
      .from(stationEvents)
      .leftJoin(users, eq(stationEvents.operatorUserId, users.id))
      .where(inArray(stationEvents.productId, productIds))
      .orderBy(asc(stationEvents.productId), asc(stationEvents.id)),
  ]);

  const taskMap = taskRows.reduce((accumulator, task) => {
    const current = accumulator.get(task.productId) ?? [];
    current.push(task);
    accumulator.set(task.productId, current);
    return accumulator;
  }, new Map<number, typeof taskRows>());

  const eventMap = eventRows.reduce((accumulator, event) => {
    const current = accumulator.get(event.productId) ?? [];
    current.push({
      id: event.id,
      stationTaskId: event.stationTaskId,
      stationCode: event.stationCode,
      eventType: event.eventType,
      businessDate: event.businessDate,
      createdAt: event.createdAt,
      operatorName: event.operatorName ?? event.operatorUsername ?? null,
      summary: typeof (event.payload as Record<string, unknown> | null)?.summary === "string"
        ? String((event.payload as Record<string, unknown>).summary)
        : null,
      payload: event.payload,
    });
    accumulator.set(event.productId, current);
    return accumulator;
  }, new Map<number, Array<{
    id: number;
    stationTaskId: number | null;
    stationCode: StationCode;
    eventType: string;
      businessDate: string | Date;

    createdAt: Date;
    operatorName: string | null;
    summary: string | null;
    payload: unknown;
  }>>());

  return productRows.map((product) => {
    const timeline = taskMap.get(product.id) ?? [];
    const events = eventMap.get(product.id) ?? [];
    const stockTask = timeline.find((task) => task.stationCode === "STOCK") ?? null;
    const importEvent = events.filter((event) => event.stationCode === "A1" && event.eventType === "enter").at(-1) ?? null;
    const pendingStockEvent = events.filter((event) => event.stationCode === "STOCK" && event.eventType === "stock_ready").at(-1) ?? null;
    const stockCompletedEvent = events.filter((event) => event.stationCode === "STOCK" && event.eventType === "complete").at(-1) ?? null;

    return {
      ...product,
      timeline,
      events,
      inventoryMovement: {
        importedAt: importEvent?.createdAt ?? product.createdAt,
        importSummary: importEvent?.summary ?? (product.poNumber ? `匯入建立，PO：${product.poNumber}` : "匯入建立"),
        importedOperatorName: importEvent?.operatorName ?? null,
        pendingStockAt: pendingStockEvent?.createdAt ?? stockTask?.createdAt ?? null,
        pendingStockSummary: pendingStockEvent?.summary ?? stockTask?.resultSummary ?? "待入庫 待處理",
        pendingStockOperatorName: pendingStockEvent?.operatorName ?? null,
        stockedAt: stockTask?.completedAt ?? stockCompletedEvent?.createdAt ?? null,
        stockedSummary: stockCompletedEvent?.summary ?? stockTask?.resultSummary ?? (product.currentStatus === "completed" ? "已完成入庫" : "尚未入庫"),
        stockedOperatorName: stockCompletedEvent?.operatorName ?? null,
      },
    };
  });
}

export async function deleteImportedPurchaseOrder(input: {
  poNumber: string;
  deletedByUserId?: number | null;
  deletedByName?: string | null;
}) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  const normalizedPoNumber = normalizeOptionalText(input.poNumber);
  if (!normalizedPoNumber) {
    throw new Error("PO 單號為必填欄位");
  }

  const productRows = await db
    .select({
      id: products.id,
      vendorName: products.vendorName,
      sheetRowNumber: products.sheetRowNumber,
      batchNo: products.batchNo,
      serialNumber: products.serialNumber,
      imei: products.imei,
      poNumber: products.poNumber,
    })
    .from(products)
    .where(eq(products.poNumber, normalizedPoNumber));
  const productIds = productRows.map((row) => row.id);
  if (productIds.length === 0) {
    return { success: true as const, poNumber: normalizedPoNumber, deletedProducts: 0, deletedTasks: 0 };
  }

  const stationEventRows = await db
    .select({ id: stationEvents.id })
    .from(stationEvents)
    .where(inArray(stationEvents.productId, productIds));
  const stationEventIds = stationEventRows.map((row) => row.id);

  if (stationEventIds.length > 0) {
    await db.delete(productivityScoreDetails).where(inArray(productivityScoreDetails.stationEventId, stationEventIds));
  }

  const stationTaskRows = await db
    .select({ id: stationTasks.id })
    .from(stationTasks)
    .where(inArray(stationTasks.productId, productIds));

  await db.delete(samplingResults).where(inArray(samplingResults.productId, productIds));
  await db.delete(stationEvents).where(inArray(stationEvents.productId, productIds));
  await db.delete(stationTasks).where(inArray(stationTasks.productId, productIds));
  await db.delete(productArchives).where(inArray(productArchives.originalProductId, productIds));
  const deletedProducts = await db.delete(products).where(inArray(products.id, productIds));

  const deletedProductCount = typeof deletedProducts === "number" ? deletedProducts : productIds.length;
  const deletedTaskCount = stationTaskRows.length;

  await db.insert(purchaseOrderDeletionLogs).values({
    poNumber: normalizedPoNumber,
    vendorName: productRows[0]?.vendorName ?? null,
    deletedProducts: deletedProductCount,
    deletedTasks: deletedTaskCount,
    deletedByUserId: input.deletedByUserId ?? null,
    deletedByName: normalizeOptionalText(input.deletedByName) ?? null,
  });

  let googleSheetSync: {
    success: boolean;
    skipped: boolean;
    updatedRowNumbers: number[];
    reason: string | null;
    errorMessage?: string;
  } = {
    success: true,
    skipped: true,
    updatedRowNumbers: [],
    reason: "not_attempted",
  };

  try {
    googleSheetSync = await markPurchaseOrderRowsDeletedInGoogleSheet({
      poNumber: normalizedPoNumber,
      products: productRows.map((row) => ({
        poNumber: row.poNumber,
        sheetRowNumber: row.sheetRowNumber,
        batchNo: row.batchNo,
        serialNumber: row.serialNumber,
        imei: row.imei,
      })),
    });
  } catch (error) {
    googleSheetSync = {
      success: false,
      skipped: true,
      updatedRowNumbers: [],
      reason: "google_sheet_sync_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
    console.error("[deleteImportedPurchaseOrder] failed to write deletion strike-through to Google Sheet", error);
  }

  const resultStatus = googleSheetSync.success && [null, "test_environment"].includes(googleSheetSync.reason)
    ? "success"
    : "partial_success";
  const googleSheetSyncMessage = resultStatus === "success"
    ? "已回寫 Google 並加上刪除線"
    : googleSheetSync.reason === "rows_not_found"
      ? "採購單已刪除，但找不到 Google 對應列，尚未加上刪除線"
      : googleSheetSync.reason === "google_sheet_sync_failed"
        ? "採購單已刪除，但回寫 Google 刪除線失敗"
        : "採購單已刪除，但 Google 回寫狀態需要人工確認";

  return {
    success: true as const,
    resultStatus,
    poNumber: normalizedPoNumber,
    deletedProducts: deletedProductCount,
    deletedTasks: deletedTaskCount,
    googleSheetSync,
    googleSheetSyncMessage,
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
  id?: number;
  stationCode: Exclude<StationCode, "STOCK">;
  categoryId: number;
  subtypeCode: string;
  dailyTargetQty: number;
  active: boolean;
}) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  const normalizedDailyTargetQty = Math.max(1, Math.trunc(input.dailyTargetQty));
  const normalizedSubtypeCode = normalizeOptionalText(input.subtypeCode);
  const baseUnitPoints = (1 / normalizedDailyTargetQty).toFixed(6);
  const effectiveFrom = new Date(`${todayDateString()}T00:00:00`);

  const categoryRows = await db
    .select({
      id: productCategories.id,
      brandName: productCategories.brandName,
      subtypeCode: productCategories.subtypeCode,
    })
    .from(productCategories)
    .where(eq(productCategories.id, input.categoryId))
    .limit(1);

  const category = categoryRows[0];
  if (!category) {
    throw new Error("指定品類不存在");
  }

  const resolvedSubtypeCode = normalizedSubtypeCode ?? category.brandName ?? category.subtypeCode;

  const existingTargetId = input.id
    ?? (
      await db
        .select({ id: productivityTargetConfigs.id })
        .from(productivityTargetConfigs)
        .where(and(eq(productivityTargetConfigs.stationCode, input.stationCode), eq(productivityTargetConfigs.categoryId, input.categoryId)))
        .orderBy(desc(productivityTargetConfigs.id))
        .limit(1)
    )[0]?.id;

  if (existingTargetId) {
    await db
      .update(productivityTargetConfigs)
      .set({
        stationCode: input.stationCode,
        categoryId: input.categoryId,
        subtypeCode: resolvedSubtypeCode,
        dailyTargetQty: normalizedDailyTargetQty,
        baseUnitPoints,
        active: input.active,
      })
      .where(eq(productivityTargetConfigs.id, existingTargetId));

    const rows = await db.select().from(productivityTargetConfigs).where(eq(productivityTargetConfigs.id, existingTargetId)).limit(1);
    return rows[0] ?? null;
  }

  await db.insert(productivityTargetConfigs).values({
    stationCode: input.stationCode,
    categoryId: input.categoryId,
    subtypeCode: resolvedSubtypeCode,
    dailyTargetQty: normalizedDailyTargetQty,
    baseUnitPoints,
    effectiveFrom,
    active: input.active,
  });

  const rows = await db
    .select()
    .from(productivityTargetConfigs)
    .where(and(eq(productivityTargetConfigs.stationCode, input.stationCode), eq(productivityTargetConfigs.categoryId, input.categoryId)))
    .orderBy(desc(productivityTargetConfigs.id))
    .limit(1);
  return rows[0] ?? null;
}
