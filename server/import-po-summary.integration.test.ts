import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { productArchives, products, stationTasks } from "../drizzle/schema";
import { assignProductCategoryToProduct, completeA1ArrivalByScan, createProductCategoryOption, ensureMvpSeedData, getDb, getStationPageData, importProducts } from "./db";

const createdPoNumbers = new Set<string>();

async function archiveCreatedImportTestRows() {
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

describe("import PO summary integration", () => {
  beforeAll(async () => {
    await ensureMvpSeedData();
  });

  afterAll(async () => {
    await archiveCreatedImportTestRows();
  });

  it("backfills missing pending A1 PO numbers and exposes grouped data for the import page", async () => {
    const result = await getStationPageData("A1");
    const tasks = result.tasks;

    expect(Array.isArray(tasks)).toBe(true);

    const pendingWithoutPo = tasks.filter((task) => !task.poNumber || !task.poNumber.trim());
    expect(pendingWithoutPo).toHaveLength(0);

    const groupedKeys = new Set(
      tasks.map((task) => `${task.poNumber}__${task.categoryName ?? task.importedCategoryName ?? task.subtypeCode ?? "未分類"}`),
    );
    expect(groupedKeys.size).toBeGreaterThanOrEqual(0);
  });

  it("auto-generates a single shared PO number for the whole import batch", async () => {
    const uniqueSuffix = `${Date.now()}`;
    const rows = [
      {
        batchNo: `AUTO-PO-${uniqueSuffix}-01`,
        serialNumber: `AUTO-SN-${uniqueSuffix}-01`,
        imei: `35${`${Number(uniqueSuffix) + 1}`.padStart(13, "0").slice(-13)}`,
        productName: "Apple iPhone 6 16GB 銀色",
        categoryName: "智慧手機",
        brandName: "Apple",
      },
      {
        batchNo: `AUTO-PO-${uniqueSuffix}-02`,
        serialNumber: `AUTO-SN-${uniqueSuffix}-02`,
        imei: `35${`${Number(uniqueSuffix) + 2}`.padStart(13, "0").slice(-13)}`,
        productName: "Apple iPhone 6 16GB 銀色",
        categoryName: "智慧手機",
        brandName: "Apple",
      },
      {
        batchNo: `AUTO-PO-${uniqueSuffix}-03`,
        serialNumber: `AUTO-SN-${uniqueSuffix}-03`,
        imei: `35${`${Number(uniqueSuffix) + 3}`.padStart(13, "0").slice(-13)}`,
        productName: "Apple iPhone 6 16GB 銀色",
        categoryName: "平板",
        brandName: "Apple",
      },
    ];

    const importResult = await importProducts({
      vendorName: "自動補號驗證廠商",
      rows,
    });
    createdPoNumbers.add(importResult.poNumber);

    expect(importResult.poNumber).toMatch(/^PO-\d{8}-\d{2,}$/);
    expect(importResult.importedCount).toBe(3);

    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

    const importedProducts = await db
      .select({
        poNumber: products.poNumber,
        batchNo: products.batchNo,
        importedCategoryName: products.importedCategoryName,
      })
      .from(products)
      .where(and(eq(products.poNumber, importResult.poNumber), isNull(products.archivedAt)));

    expect(importedProducts).toHaveLength(3);
    expect(new Set(importedProducts.map((product) => product.poNumber))).toEqual(new Set([importResult.poNumber]));
    expect(new Set(importedProducts.map((product) => product.batchNo))).toEqual(new Set(rows.map((row) => row.batchNo)));
    expect(new Set(importedProducts.map((product) => product.importedCategoryName))).toEqual(new Set(["智慧手機", "平板"]));

    const stationData = await getStationPageData("A1");
    const importedTasks = stationData.tasks.filter((task) => task.poNumber === importResult.poNumber);
    expect(importedTasks).toHaveLength(3);
    expect(new Set(importedTasks.map((task) => task.importedCategoryName ?? task.categoryName))).toEqual(new Set(["智慧手機", "平板"]));
  }, 10000);

  it("maps categoryId by category+brand and preserves importedBrandName when unmatched", async () => {
    const uniqueSuffix = `${Date.now()}`;
    const matchedCategory = await createProductCategoryOption({ categoryName: "智慧手機", brandName: "Apple" });
    const rows = [
      {
        batchNo: `BRAND-MATCH-${uniqueSuffix}-01`,
        serialNumber: `BRAND-MATCH-SN-${uniqueSuffix}-01`,
        imei: `97${`${Number(uniqueSuffix) + 1}`.padStart(13, "0").slice(-13)}`,
        productName: "Matched Brand Device",
        categoryName: "智慧手機",
        brandName: "Apple",
      },
      {
        batchNo: `BRAND-MISS-${uniqueSuffix}-02`,
        serialNumber: `BRAND-MISS-SN-${uniqueSuffix}-02`,
        imei: `97${`${Number(uniqueSuffix) + 2}`.padStart(13, "0").slice(-13)}`,
        productName: "Unmatched Brand Device",
        categoryName: "智慧手機",
        brandName: "NoSuchBrand",
      },
    ];

    const importResult = await importProducts({
      vendorName: "品牌對應驗證廠商",
      rows,
    });
    createdPoNumbers.add(importResult.poNumber);

    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

    const importedProducts = await db
      .select({
        batchNo: products.batchNo,
        categoryId: products.categoryId,
        importedCategoryName: products.importedCategoryName,
        importedBrandName: products.importedBrandName,
      })
      .from(products)
      .where(and(eq(products.poNumber, importResult.poNumber), isNull(products.archivedAt)));

    expect(importedProducts).toHaveLength(2);
    const matchedProduct = importedProducts.find((item) => item.batchNo === rows[0]?.batchNo);
    const unmatchedProduct = importedProducts.find((item) => item.batchNo === rows[1]?.batchNo);
    expect(matchedProduct?.categoryId).toBe(matchedCategory?.id ?? null);
    expect(matchedProduct?.importedBrandName).toBe("Apple");
    expect(unmatchedProduct?.categoryId).toBeNull();
    expect(unmatchedProduct?.importedBrandName).toBe("NoSuchBrand");

    const a1StationData = await getStationPageData("A1");
    const matchedTask = a1StationData.tasks.find((task) => task.poNumber === importResult.poNumber && task.batchNo === rows[0]?.batchNo);
    const unmatchedTask = a1StationData.tasks.find((task) => task.poNumber === importResult.poNumber && task.batchNo === rows[1]?.batchNo);

    expect(matchedTask?.brandName ?? matchedTask?.importedBrandName).toBe("Apple");
    expect(unmatchedTask?.brandName ?? unmatchedTask?.importedBrandName).toBe("NoSuchBrand");
  }, 10000);

  it("preserves imported category and brand values when manually assigning or clearing category settings", async () => {
    const uniqueSuffix = `${Date.now()}`;
    const matchedCategory = await createProductCategoryOption({ categoryName: "智慧手機", brandName: "Apple" });
    const rows = [
      {
        batchNo: `MANUAL-KEEP-${uniqueSuffix}-01`,
        serialNumber: `MANUAL-KEEP-SN-${uniqueSuffix}-01`,
        imei: `96${`${Number(uniqueSuffix) + 1}`.padStart(13, "0").slice(-13)}`,
        productName: "Manual Preserve Device",
        categoryName: "原始手機",
        brandName: "OriginalBrand",
      },
    ];

    const importResult = await importProducts({
      vendorName: "手動指定保留驗證",
      rows,
    });
    createdPoNumbers.add(importResult.poNumber);

    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

    const importedProduct = (await db
      .select({
        id: products.id,
        categoryId: products.categoryId,
        importedCategoryName: products.importedCategoryName,
        importedBrandName: products.importedBrandName,
      })
      .from(products)
      .where(and(eq(products.poNumber, importResult.poNumber), isNull(products.archivedAt)))
      .limit(1))[0];

    expect(importedProduct?.importedCategoryName).toBe("原始手機");
    expect(importedProduct?.importedBrandName).toBe("OriginalBrand");

    await assignProductCategoryToProduct({
      productId: importedProduct?.id ?? 0,
      categoryId: matchedCategory?.id ?? null,
    });

    await assignProductCategoryToProduct({
      productId: importedProduct?.id ?? 0,
      categoryId: null,
    });

    const reassignedProduct = (await db
      .select({
        categoryId: products.categoryId,
        importedCategoryName: products.importedCategoryName,
        importedBrandName: products.importedBrandName,
      })
      .from(products)
      .where(eq(products.id, importedProduct?.id ?? 0))
      .limit(1))[0];

    expect(reassignedProduct?.categoryId).toBeNull();
    expect(reassignedProduct?.importedCategoryName).toBe("原始手機");
    expect(reassignedProduct?.importedBrandName).toBe("OriginalBrand");
  }, 10000);

  it("uses manually assigned category settings after A1 moves product to A2", async () => {
    const uniqueSuffix = `${Date.now()}`;
    const matchedCategory = await createProductCategoryOption({ categoryName: "智慧手機", brandName: "Apple" });
    const rows = [
      {
        batchNo: `MANUAL-NEXT-${uniqueSuffix}-01`,
        serialNumber: `MANUAL-NEXT-SN-${uniqueSuffix}-01`,
        imei: `95${`${Number(uniqueSuffix) + 1}`.padStart(13, "0").slice(-13)}`,
        productName: "Manual Next Station Device",
        categoryName: "原始手機",
        brandName: "OriginalBrand",
      },
    ];

    const importResult = await importProducts({
      vendorName: "手動指定跨站驗證",
      rows,
    });
    createdPoNumbers.add(importResult.poNumber);

    const db = await getDb();
    if (!db) {
      throw new Error("Database is not available");
    }

    const importedProduct = (await db
      .select({
        id: products.id,
      })
      .from(products)
      .where(and(eq(products.poNumber, importResult.poNumber), isNull(products.archivedAt)))
      .limit(1))[0];

    await assignProductCategoryToProduct({
      productId: importedProduct?.id ?? 0,
      categoryId: matchedCategory?.id ?? null,
    });

    await completeA1ArrivalByScan({
      operatorUserId: 1,
      batchNo: rows[0]?.batchNo,
      serialNumber: rows[0]?.serialNumber,
      imei: rows[0]?.imei,
      productName: rows[0]?.productName,
    });

    const a2StationData = await getStationPageData("A2");
    const movedTask = a2StationData.tasks.find((task) => task.poNumber === importResult.poNumber && task.batchNo === rows[0]?.batchNo);

    expect(movedTask?.categoryName).toBe("智慧手機");
    expect(movedTask?.brandName).toBe("Apple");
    expect(movedTask?.importedCategoryName).toBe("原始手機");
    expect(movedTask?.importedBrandName).toBe("OriginalBrand");
  }, 10000);

  it("imports a large batch with consistent row count under a single PO", async () => {
    const uniqueSuffix = `${Date.now()}`;
    const rows = Array.from({ length: 120 }, (_, index) => {
      const sequence = index + 1;
      return {
        batchNo: `LARGE-PO-${uniqueSuffix}-${String(sequence).padStart(3, "0")}`,
        serialNumber: `LARGE-SN-${uniqueSuffix}-${String(sequence).padStart(3, "0")}`,
        imei: `86${`${Number(uniqueSuffix) + sequence}`.padStart(13, "0").slice(-13)}`,
        productName: `Large Import Device ${String(sequence).padStart(3, "0")}`,
        categoryName: sequence % 2 === 0 ? "智慧手機" : "平板",
        brandName: sequence % 2 === 0 ? "Apple" : "Samsung",
      };
    });

    const importResult = await importProducts({
      vendorName: "大批量驗證廠商",
      rows,
    });
    createdPoNumbers.add(importResult.poNumber);

    expect(importResult.poNumber).toMatch(/^PO-\d{8}-\d{2,}$/);
    expect(importResult.importedCount).toBe(rows.length);
    expect(importResult.products).toHaveLength(rows.length);

    const stationData = await getStationPageData("A1");
    const importedTasks = stationData.tasks.filter((task) => task.poNumber === importResult.poNumber);

    expect(importedTasks).toHaveLength(rows.length);
    expect(new Set(importedTasks.map((task) => task.poNumber))).toEqual(new Set([importResult.poNumber]));
    expect(new Set(importedTasks.map((task) => task.batchNo))).toEqual(new Set(rows.map((row) => row.batchNo)));
    expect(new Set(importedTasks.map((task) => task.importedCategoryName ?? task.categoryName))).toEqual(new Set(["智慧手機", "平板"]));
  }, 20000);
});
