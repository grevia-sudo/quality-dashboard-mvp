import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { productArchives, products, stationTasks } from "../drizzle/schema";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(() => ({
    unref: vi.fn(),
  })),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("node:crypto", () => ({
  createSign: () => ({
    update: vi.fn(),
    end: vi.fn(),
    sign: vi.fn(() => "signed-test-token=="),
  }),
}));

const { storagePutMock } = vi.hoisted(() => ({
  storagePutMock: vi.fn(),
}));

vi.mock("./storage", () => ({
  storagePut: storagePutMock,
}));

import { completeStationTask, ensureMvpSeedData, getDb } from "./db";

const createdProductIds = new Set<number>();
const originalGoogleCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

function createJsonResponse(payload: unknown, ok = true, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as Response;
}

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

  const productCode = `E-FALLBACK-${seed}`;
  const batchNo = `E-FALLBACK-BATCH-${seed}`;
  const serialNumber = `E-FALLBACK-SN-${seed}`;
  const imei = `95${uniqueDigits(seed + 1, 13)}`;

  const productInsert = await db.insert(products).values({
    productCode,
    poNumber: `PO-E-FALLBACK-${seed}`,
    vendorName: "E站整合測試廠商",
    batchNo,
    serialNumber,
    imei,
    productName: "E站同步備援測試手機",
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

describe("E 站照片同步備援整合", () => {
  beforeAll(async () => {
    await ensureMvpSeedData();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    storagePutMock.mockReset();
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: "sheet-sync-test@example.com",
      private_key: "-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----\n",
      token_uri: "https://oauth2.googleapis.com/token",
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await archiveCreatedTestRows();
    createdProductIds.clear();
    if (originalGoogleCredentials === undefined) {
      delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    } else {
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON = originalGoogleCredentials;
    }
  });

  it("在 Google Drive upload 失敗時仍完成 E 站並改存 manus-storage 網址", async () => {
    storagePutMock
      .mockResolvedValueOnce({ key: "station/front.jpg", url: "/manus-storage/station/front.jpg" })
      .mockResolvedValueOnce({ key: "station/back.jpg", url: "/manus-storage/station/back.jpg" });

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);

      if (url.includes("oauth2.googleapis.com/token")) {
        return createJsonResponse({ access_token: "google-token" });
      }

      if (url.includes("googleapis.com/upload/drive/v3/files")) {
        return createJsonResponse({ error: { message: "Google Drive API has not been used in project before or it is disabled." } }, false, 403);
      }

      if (url.includes("sheets.googleapis.com") && init?.method === "PUT") {
        return createJsonResponse({ updatedRange: "採購單!AC2:AD2" });
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });

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
    expect(result.message).toContain("改存系統備援空間");
    expect(storagePutMock).toHaveBeenCalledTimes(2);

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
    expect(metadata.ePhotoSyncStatus).toBe("storage_fallback");
    expect(String(metadata.eFrontPhotoUrl)).toContain("/manus-storage/");
    expect(String(metadata.eBackPhotoUrl)).toContain("/manus-storage/");
  }, 20000);

  it("在 Google Sheet 回寫失敗時仍完成 E 站且保留原本 Drive 網址", async () => {
    let driveUploadCount = 0;
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);

      if (url.includes("oauth2.googleapis.com/token")) {
        return createJsonResponse({ access_token: "google-token" });
      }

      if (url.includes("googleapis.com/upload/drive/v3/files")) {
        driveUploadCount += 1;
        return createJsonResponse({
          id: driveUploadCount === 1 ? "front-id" : "back-id",
          webViewLink: driveUploadCount === 1
            ? "https://drive.google.com/file/d/front-id/view"
            : "https://drive.google.com/file/d/back-id/view",
        });
      }

      if (url.includes("sheets.googleapis.com") && init?.method === "PUT") {
        return createJsonResponse({ error: { message: "回寫 E 站照片連結到採購單失敗" } }, false, 500);
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const { productId, taskId } = await createPendingEStationTask(Date.now() + 1000);
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
    expect(result.message).toContain("採購單照片連結回寫失敗");
    expect(storagePutMock).not.toHaveBeenCalled();

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
    expect(metadata.ePhotoSyncStatus).toBe("sheet_write_failed");
    expect(String(metadata.eFrontPhotoUrl)).toContain("drive.google.com");
    expect(String(metadata.eBackPhotoUrl)).toContain("drive.google.com");
  }, 20000);
});
