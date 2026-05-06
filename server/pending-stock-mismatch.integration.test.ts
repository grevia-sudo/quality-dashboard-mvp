import { and, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { productArchives, products, stationTasks } from "../drizzle/schema";
import { ensureMvpSeedData, getDb, getPendingStockImportMismatchProducts, importProducts, syncProductNameOptionsFromGoogleSheet } from "./db";

const createdBatchNos = new Set<string>();

async function archiveCreatedRows() {
  const db = await getDb();
  if (!db || createdBatchNos.size === 0) {
    return;
  }

  const targetProducts = await db
    .select()
    .from(products)
    .where(and(inArray(products.batchNo, Array.from(createdBatchNos)), isNull(products.archivedAt)));

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

describe("pending stock mismatch integration", () => {
  beforeAll(async () => {
    await ensureMvpSeedData();
    await syncProductNameOptionsFromGoogleSheet();
  }, 30000);

  afterAll(async () => {
    await archiveCreatedRows();
  });

  it("returns post-A1 products that still miss import comparison data or Google sync", async () => {
    const uniqueSuffix = `${Date.now()}`;
    const rows = [
      {
        batchNo: `A2-MISS-${uniqueSuffix}-01`,
        serialNumber: `A2-MISS-SN-${uniqueSuffix}-01`,
        imei: `86${`${Number(uniqueSuffix) + 1}`.padStart(13, "0").slice(-13)}`,
        productName: "Apple iPhone 6 16GB 銀色",
        categoryName: "智慧型手機",
        brandName: "Apple",
      },
      {
        batchNo: `STOCK-UNSYNC-${uniqueSuffix}-02`,
        serialNumber: `STOCK-UNSYNC-SN-${uniqueSuffix}-02`,
        imei: `86${`${Number(uniqueSuffix) + 2}`.padStart(13, "0").slice(-13)}`,
        productName: "Apple iPhone 6 16GB 銀色",
        categoryName: "智慧型手機",
        brandName: "Apple",
      },
      {
        batchNo: `SYNCED-OK-${uniqueSuffix}-03`,
        serialNumber: `SYNCED-OK-SN-${uniqueSuffix}-03`,
        imei: `86${`${Number(uniqueSuffix) + 3}`.padStart(13, "0").slice(-13)}`,
        productName: "Apple iPhone 6 16GB 銀色",
        categoryName: "智慧型手機",
        brandName: "Apple",
      },
    ] as const;

    rows.forEach((row) => createdBatchNos.add(row.batchNo));

    const importResult = await importProducts({
      vendorName: "已刷入未同步測試廠商",
      rows: [...rows],
    });

    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

    const importedProducts = await db
      .select({
        id: products.id,
        batchNo: products.batchNo,
      })
      .from(products)
      .where(and(inArray(products.batchNo, rows.map((row) => row.batchNo)), isNull(products.archivedAt)));

    const productByBatchNo = new Map(importedProducts.map((product) => [product.batchNo ?? "", product]));
    const a2MismatchProduct = productByBatchNo.get(rows[0].batchNo);
    const stockUnsyncedProduct = productByBatchNo.get(rows[1].batchNo);
    const syncedProduct = productByBatchNo.get(rows[2].batchNo);

    expect(a2MismatchProduct?.id).toBeTruthy();
    expect(stockUnsyncedProduct?.id).toBeTruthy();
    expect(syncedProduct?.id).toBeTruthy();

    await db
      .update(products)
      .set({
        currentStationCode: "A2",
        currentStatus: "pending_a2",
        poNumber: null,
        importedCategoryName: null,
        sheetRowNumber: null,
        lastSheetSyncedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(products.id, a2MismatchProduct!.id));

    await db
      .update(products)
      .set({
        currentStationCode: "STOCK",
        currentStatus: "pending_stock",
        sheetRowNumber: null,
        lastSheetSyncedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(products.id, stockUnsyncedProduct!.id));

    await db
      .update(products)
      .set({
        currentStationCode: "STOCK",
        currentStatus: "pending_stock",
        sheetRowNumber: 188,
        lastSheetSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(products.id, syncedProduct!.id));

    await db.insert(stationTasks).values([
      {
        productId: stockUnsyncedProduct!.id,
        stationCode: "STOCK",
        taskStatus: "pending",
      },
      {
        productId: syncedProduct!.id,
        stationCode: "STOCK",
        taskStatus: "pending",
      },
    ]);

    const result = await getPendingStockImportMismatchProducts();
    const resultBatchNos = new Set(result.map((item) => item.batchNo));

    expect(resultBatchNos.has(rows[0].batchNo)).toBe(true);
    expect(resultBatchNos.has(rows[1].batchNo)).toBe(true);
    expect(resultBatchNos.has(rows[2].batchNo)).toBe(false);

    const a2Row = result.find((item) => item.batchNo === rows[0].batchNo);
    expect(a2Row?.currentStationCode).toBe("A2");
    expect(a2Row?.currentStatus).toBe("pending_a2");
    expect(a2Row?.missingFields).toEqual(["採購單號", "商品分類", "Google 回寫"]);
    expect(a2Row?.mismatchReason).toBe("缺少採購單號、商品分類，已刷入系統但尚未完成匯入比對，Google 尚未回寫");

    const stockRow = result.find((item) => item.batchNo === rows[1].batchNo);
    expect(stockRow?.currentStationCode).toBe("STOCK");
    expect(stockRow?.missingFields).toEqual(["Google 回寫"]);
    expect(stockRow?.mismatchReason).toBe("已刷入系統，等待背景回寫 Google");
    expect(importResult.importedCount).toBe(3);
  }, 30000);
});
