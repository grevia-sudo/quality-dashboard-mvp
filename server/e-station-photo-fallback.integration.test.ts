import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { productArchives, products, sheetSyncJobs, stationTasks } from "../drizzle/schema";

const { spawnMock, storagePutMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(() => ({
    unref: vi.fn(),
  })),
  storagePutMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("./storage", () => ({
  storagePut: storagePutMock,
}));

import { completeStationTask, ensureMvpSeedData, getDb, runEStationPhotoSyncInProcess } from "./db";

const createdProductIds = new Set<number>();

function uniqueDigits(seed: number, length: number) {
  return `${seed}`.padStart(length, "0").slice(-length);
}

async function archiveCreatedTestRows() {
  const db = await getDb();
  if (!db || createdProductIds.size === 0) {
    return;
  }

  const targetProducts = await db
    .select()
    .from(products)
    .where(and(inArray(products.id, Array.from(createdProductIds)), isNull(products.archivedAt)));

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

async function createPendingEStationTask(seed: number) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  const productCode = `E-BG-${seed}`;
  const batchNo = `E-BG-BATCH-${seed}`;
  const serialNumber = `E-BG-SN-${seed}`;
  const imei = `95${uniqueDigits(seed + 1, 13)}`;

  const productInsert = await db.insert(products).values({
    productCode,
    poNumber: `PO-E-BG-${seed}`,
    vendorName: "E站背景同步測試廠商",
    batchNo,
    serialNumber,
    imei,
    productName: "E站背景同步測試手機",
    currentStationCode: "E",
    currentStatus: "pending_e",
    sheetRowNumber: 2,
  }).$returningId();

  const productId = productInsert[0]?.id;
  if (!productId) {
    throw new Error("Failed to create E station test product");
  }
  createdProductIds.add(productId);

  const taskInsert = await db.insert(stationTasks).values({
    productId,
    stationCode: "E",
    taskStatus: "pending",
    dueDate: new Date().toISOString().slice(0, 10),
    resultSummary: "E站待處理",
  }).$returningId();

  const taskId = taskInsert[0]?.id;
  if (!taskId) {
    throw new Error("Failed to create pending E station task");
  }

  return {
    productId,
    taskId,
  };
}

function createTestPhoto(fileName: string) {
  return {
    fileName,
    mimeType: "image/jpeg",
    dataUrl: "data:image/jpeg;base64,aGVsbG8=",
  };
}

describe("E 站照片背景同步整合", () => {
  beforeAll(async () => {
    await ensureMvpSeedData();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    storagePutMock.mockReset();
    vi.stubGlobal("fetch", vi.fn(() => {
      throw new Error("E 站完成流程不應同步呼叫 Google API");
    }));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await archiveCreatedTestRows();
    createdProductIds.clear();
  });

  it("完成 E 站時會先返回成功並建立 STOCK 任務，照片改由背景工作稍後處理", async () => {
    const { productId, taskId } = await createPendingEStationTask(Date.now());
    const result = await completeStationTask({
      taskId,
      stationCode: "E",
      operatorUserId: 1,
      productId,
      summary: "E 測試完成",
      eFrontPhoto: createTestPhoto("front.jpg"),
      eBackPhoto: createTestPhoto("back.jpg"),
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("照片已排入背景同步");

    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

    const completedTask = await db
      .select({ metadata: stationTasks.metadata })
      .from(stationTasks)
      .where(and(eq(stationTasks.productId, productId), eq(stationTasks.stationCode, "E"), eq(stationTasks.taskStatus, "completed")))
      .limit(1);

    const nextTask = await db
      .select({ stationCode: stationTasks.stationCode, taskStatus: stationTasks.taskStatus })
      .from(stationTasks)
      .where(and(eq(stationTasks.productId, productId), eq(stationTasks.stationCode, "STOCK"), eq(stationTasks.taskStatus, "pending")))
      .limit(1);

    const queuedJobs = await db
      .select({ jobType: sheetSyncJobs.jobType, status: sheetSyncJobs.status })
      .from(sheetSyncJobs)
      .where(eq(sheetSyncJobs.jobType, "e_station_photo_sync"));

    const productRow = await db
      .select({ currentStationCode: products.currentStationCode, currentStatus: products.currentStatus })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);

    const metadata = completedTask[0]?.metadata as Record<string, unknown>;
    expect(metadata.ePhotoSyncStatus).toBe("queued_background");
    expect(metadata.ePhotoSyncMessage).toBe("E 站照片已排入背景同步佇列");
    expect(metadata.eFrontPhotoUrl).toBeUndefined();
    expect(metadata.eBackPhotoUrl).toBeUndefined();
    expect(metadata.ePhotoPendingUploads).toBeTruthy();
    expect(nextTask[0]?.stationCode).toBe("STOCK");
    expect(nextTask[0]?.taskStatus).toBe("pending");
    expect(queuedJobs.some((job) => job.jobType === "e_station_photo_sync" && job.status === "queued")).toBe(true);
    expect(productRow[0]?.currentStationCode).toBe("STOCK");
    expect(productRow[0]?.currentStatus).toBe("pending_stock");
  }, 20000);

  it("背景 worker 會消化 E 站照片同步 job 並更新同步狀態", async () => {
    storagePutMock.mockImplementation(async (relKey: string) => ({
      key: relKey,
      url: `/manus-storage/${relKey}`,
    }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "sheets-token" }), { status: 200 });
      }
      if (url.includes("sheets.googleapis.com")) {
        return new Response(JSON.stringify({ updatedRange: "採購單!AC2:AD2" }), { status: 200 });
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { productId, taskId } = await createPendingEStationTask(Date.now() + 1000);
    await completeStationTask({
      taskId,
      stationCode: "E",
      operatorUserId: 1,
      productId,
      summary: "E 測試完成",
      eFrontPhoto: createTestPhoto("front.jpg"),
      eBackPhoto: createTestPhoto("back.jpg"),
    });

    await runEStationPhotoSyncInProcess();

    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

    const completedTask = await db
      .select({ metadata: stationTasks.metadata })
      .from(stationTasks)
      .where(and(eq(stationTasks.productId, productId), eq(stationTasks.stationCode, "E"), eq(stationTasks.taskStatus, "completed")))
      .limit(1);

    const metadata = completedTask[0]?.metadata as Record<string, unknown>;
    expect(storagePutMock).toHaveBeenCalled();
    expect(metadata.ePhotoSyncStatus).toBe("background_completed");
    expect(metadata.ePhotoPendingUploads).toBeUndefined();
    expect(String(metadata.eFrontPhotoUrl)).toContain("/manus-storage/");
    expect(String(metadata.eBackPhotoUrl)).toContain("/manus-storage/");
  }, 20000);

  it("若背景 worker 持續寫入照片儲存失敗，最終會標記背景同步失敗但不阻斷已建立的下一站任務", async () => {
    storagePutMock.mockRejectedValue(new Error("storage unavailable"));

    const { productId, taskId } = await createPendingEStationTask(Date.now() + 2000);
    await completeStationTask({
      taskId,
      stationCode: "E",
      operatorUserId: 1,
      productId,
      summary: "E 測試完成",
      eFrontPhoto: createTestPhoto("front.jpg"),
      eBackPhoto: createTestPhoto("back.jpg"),
    });

    await runEStationPhotoSyncInProcess();

    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

    const completedTask = await db
      .select({ metadata: stationTasks.metadata })
      .from(stationTasks)
      .where(and(eq(stationTasks.id, taskId), eq(stationTasks.stationCode, "E")))
      .limit(1);

    const nextTask = await db
      .select({ id: stationTasks.id })
      .from(stationTasks)
      .where(and(eq(stationTasks.productId, productId), eq(stationTasks.stationCode, "STOCK"), eq(stationTasks.taskStatus, "pending")))
      .limit(1);

    const metadata = completedTask[0]?.metadata as Record<string, unknown>;
    expect(metadata.ePhotoSyncStatus).toBe("background_failed");
    expect(String(metadata.ePhotoSyncMessage)).toContain("請手動補傳");
    expect(metadata.ePhotoSyncAttempts).toBe(3);
    expect(nextTask).toHaveLength(1);
  }, 20000);
});
