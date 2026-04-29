import { and, inArray, isNull } from "drizzle-orm";
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

  it("returns only STOCK products that still miss import comparison fields", async () => {
    const uniqueSuffix = `${Date.now()}`;
    const rows = [
      {
        batchNo: `PENDING-STOCK-MISS-${uniqueSuffix}-01`,
        serialNumber: `PENDING-STOCK-SN-${uniqueSuffix}-01`,
        imei: `86${`${Number(uniqueSuffix) + 1}`.padStart(13, "0").slice(-13)}`,
        productName: "Apple iPhone 6 16GB 銀色",
        categoryName: "智慧型手機",
        brandName: "Apple",
      },
      {
        batchNo: `PENDING-STOCK-OK-${uniqueSuffix}-02`,
        serialNumber: `PENDING-STOCK-SN-${uniqueSuffix}-02`,
        imei: `86${`${Number(uniqueSuffix) + 2}`.padStart(13, "0").slice(-13)}`,
        productName: "Apple iPhone 6 16GB 銀色",
        categoryName: "智慧型手機",
        brandName: "Apple",
      },
      {
        batchNo: `PENDING-A2-MISS-${uniqueSuffix}-03`,
        serialNumber: `PENDING-STOCK-SN-${uniqueSuffix}-03`,
        imei: `86${`${Number(uniqueSuffix) + 3}`.padStart(13, "0").slice(-13)}`,
        productName: "Apple iPhone 6 16GB 銀色",
        categoryName: "智慧型手機",
        brandName: "Apple",
      },
    ] as const;

    rows.forEach((row) => createdBatchNos.add(row.batchNo));

    const importResult = await importProducts({
      vendorName: "待入庫待比對測試廠商",
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
    const missingStockProduct = productByBatchNo.get(rows[0].batchNo);
    const matchedStockProduct = productByBatchNo.get(rows[1].batchNo);
    const nonStockProduct = productByBatchNo.get(rows[2].batchNo);

    expect(missingStockProduct?.id).toBeTruthy();
    expect(matchedStockProduct?.id).toBeTruthy();
    expect(nonStockProduct?.id).toBeTruthy();

    await db
      .update(products)
      .set({
        currentStationCode: "STOCK",
        currentStatus: "pending_stock",
        poNumber: null,
        importedCategoryName: null,
        updatedAt: new Date(),
      })
      .where(inArray(products.id, [missingStockProduct!.id]));

    await db
      .update(products)
      .set({
        currentStationCode: "STOCK",
        currentStatus: "pending_stock",
        updatedAt: new Date(),
      })
      .where(inArray(products.id, [matchedStockProduct!.id]));

    await db
      .update(products)
      .set({
        currentStationCode: "A2",
        currentStatus: "pending_a2",
        poNumber: null,
        importedBrandName: null,
        updatedAt: new Date(),
      })
      .where(inArray(products.id, [nonStockProduct!.id]));

    await db.insert(stationTasks).values([
      {
        productId: missingStockProduct!.id,
        stationCode: "STOCK",
        taskStatus: "pending",
      },
      {
        productId: matchedStockProduct!.id,
        stationCode: "STOCK",
        taskStatus: "pending",
      },
    ]);

    const result = await getPendingStockImportMismatchProducts();
    const resultBatchNos = new Set(result.map((item) => item.batchNo));

    expect(resultBatchNos.has(rows[0].batchNo)).toBe(true);
    expect(resultBatchNos.has(rows[1].batchNo)).toBe(false);
    expect(resultBatchNos.has(rows[2].batchNo)).toBe(false);

    const mismatchRow = result.find((item) => item.batchNo === rows[0].batchNo);
    expect(mismatchRow?.currentStationCode).toBe("STOCK");
    expect(mismatchRow?.currentStatus).toBe("pending_stock");
    expect(mismatchRow?.missingFields).toEqual(["採購單號", "商品分類"]);
    expect(mismatchRow?.mismatchReason).toBe("缺少採購單號、商品分類，尚未完成匯入比對");
    expect(importResult.importedCount).toBe(3);
  }, 30000);
});
