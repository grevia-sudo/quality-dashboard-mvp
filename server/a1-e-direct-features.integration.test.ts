import { and, eq, isNull } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { products, stationTasks } from "../drizzle/schema";
import {
  completeA1ArrivalByScan,
  ensureMvpSeedData,
  getDb,
  importProducts,
  restoreEProductToD,
  searchProductsForA1Rename,
  updateProductNameByA1Search,
} from "./db";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("A1 and E direct feature regressions", () => {
  it("allows A1 receive to supplement the same imported Google row when that row only has a matching batch and blank serial/imei", async () => {
    await ensureMvpSeedData();
    const uniqueSuffix = `${Date.now()}`;
    const batchNo = `GOOGLE-BLANK-BATCH-${uniqueSuffix}`;
    const serialNumber = `GOOGLE-BLANK-SERIAL-${uniqueSuffix}`;
    const imei = `93${`${Number(uniqueSuffix) + 1}`.padStart(13, "0").slice(-13)}`;
    const productName = "Google Blank Identity Device";

    const importResult = await importProducts({
      poNumber: `PO-GOOGLE-BLANK-${uniqueSuffix}`,
      vendorName: "Google Blank Vendor",
      rows: [
        {
          batchNo,
          serialNumber: null,
          imei: null,
          productName: null,
          categoryName: "智慧型手機",
          brandName: "Apple",
        },
      ],
    });

    const db = await getDb();
    expect(db).toBeTruthy();

    const importedProduct = (await db!
      .select({
        id: products.id,
        stationCode: products.currentStationCode,
        productStatus: products.currentStatus,
        sheetRowNumber: products.sheetRowNumber,
      })
      .from(products)
      .where(and(
        eq(products.poNumber, importResult.poNumber),
        eq(products.batchNo, batchNo),
        isNull(products.archivedAt),
      ))
      .limit(1))[0];

    expect(importedProduct).toBeTruthy();
    expect(importedProduct?.stationCode).toBe("A1");
    expect(importedProduct?.productStatus).toBe("pending_a1");

    await db!
      .update(products)
      .set({ sheetRowNumber: 2 })
      .where(eq(products.id, importedProduct!.id));

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({
          access_token: "fake-google-token",
          expires_in: 3600,
          token_type: "Bearer",
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("sheets.googleapis.com")) {
        return new Response(JSON.stringify({
          values: [
            ["PO", "Vendor", "Arrived", "批號", "序號", "IMEI", "品名"],
            [
              importResult.poNumber,
              "Google Blank Vendor",
              "",
              batchNo,
              "",
              "",
              "",
            ],
          ],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`Unexpected fetch URL in test: ${url}`);
    }) as typeof fetch;

    const result = await completeA1ArrivalByScan({
      operatorUserId: 1,
      batchNo,
      serialNumber,
      imei,
      productName,
    });

    expect(result.success).toBe(true);
    expect(result.productId).toBe(importedProduct?.id);

    const refreshedProduct = (await db!
      .select({
        batchNo: products.batchNo,
        serialNumber: products.serialNumber,
        imei: products.imei,
        productName: products.productName,
        stationCode: products.currentStationCode,
        productStatus: products.currentStatus,
        sheetRowNumber: products.sheetRowNumber,
      })
      .from(products)
      .where(eq(products.id, importedProduct!.id))
      .limit(1))[0];

    expect(refreshedProduct).toMatchObject({
      batchNo,
      serialNumber,
      imei,
      productName,
      stationCode: "A2",
      productStatus: "pending_a2",
      sheetRowNumber: 2,
    });
  }, 20000);

  it("blocks A1 receive when Google purchase sheet already has the same batch number with another identity", async () => {
    await ensureMvpSeedData();
    const uniqueSuffix = `${Date.now()}`;

    await importProducts({
      poNumber: `PO-GOOGLE-BATCH-${uniqueSuffix}`,
      vendorName: "Google Batch Guard Vendor",
      rows: [
        {
          batchNo: `LOCAL-BATCH-${uniqueSuffix}`,
          serialNumber: `LOCAL-SERIAL-${uniqueSuffix}`,
          imei: `93${`${Number(uniqueSuffix) + 1}`.padStart(13, "0").slice(-13)}`,
          productName: "Local Imported Device",
          categoryName: "智慧型手機",
          brandName: "Apple",
        },
      ],
    });

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({
          access_token: "fake-google-token",
          expires_in: 3600,
          token_type: "Bearer",
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("sheets.googleapis.com")) {
        return new Response(JSON.stringify({
          values: [
            ["PO", "Vendor", "Arrived", "批號", "序號", "IMEI", "品名"],
            [
              `PO-GOOGLE-SHEET-${uniqueSuffix}`,
              "Google Vendor",
              "",
              `GOOGLE-DUP-BATCH-${uniqueSuffix}`,
              `GOOGLE-SERIAL-${uniqueSuffix}`,
              "",
              "Google Existing Device",
            ],
          ],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error(`Unexpected fetch URL in test: ${url}`);
    }) as typeof fetch;

    const result = await completeA1ArrivalByScan({
      operatorUserId: 1,
      batchNo: `GOOGLE-DUP-BATCH-${uniqueSuffix}`,
      serialNumber: `LOCAL-SERIAL-${uniqueSuffix}`,
      productName: "Local Imported Device",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain(`商品批號 GOOGLE-DUP-BATCH-${uniqueSuffix} 已存在於 Google 採購單第 2 列`);
  }, 20000);

  it("searches cross-station products by serial number or product code and updates the product name", async () => {
    await ensureMvpSeedData();
    const uniqueSuffix = `${Date.now()}`;

    await importProducts({
      poNumber: `PO-A1-RENAME-${uniqueSuffix}`,
      vendorName: "Rename Vendor",
      rows: [
        {
          batchNo: `RENAME-BATCH-${uniqueSuffix}`,
          serialNumber: `RENAME-SERIAL-${uniqueSuffix}`,
          imei: `94${`${Number(uniqueSuffix) + 1}`.padStart(13, "0").slice(-13)}`,
          productName: "Old Product Name",
          categoryName: "智慧型手機",
          brandName: "Apple",
        },
      ],
    });

    const db = await getDb();
    expect(db).toBeTruthy();

    const productRow = (await db!
      .select({ id: products.id, productCode: products.productCode })
      .from(products)
      .where(and(
        eq(products.poNumber, `PO-A1-RENAME-${uniqueSuffix}`),
        eq(products.serialNumber, `RENAME-SERIAL-${uniqueSuffix}`),
        isNull(products.archivedAt),
      ))
      .limit(1))[0];

    expect(productRow).toBeTruthy();

    await db!
      .update(products)
      .set({
        currentStationCode: "C",
        currentStatus: "pending_c",
      })
      .where(eq(products.id, productRow!.id));

    const serialSearchResult = await searchProductsForA1Rename(`RENAME-SERIAL-${uniqueSuffix}`);
    expect(serialSearchResult).toHaveLength(1);
    expect(serialSearchResult[0]?.currentStationCode).toBe("C");
    expect(serialSearchResult[0]?.productName).toBe("Old Product Name");

    const productCodeSearchResult = await searchProductsForA1Rename(productRow!.productCode);
    expect(productCodeSearchResult).toHaveLength(1);
    expect(productCodeSearchResult[0]?.productCode).toBe(productRow!.productCode);

    const updateResult = await updateProductNameByA1Search({
      productId: productRow!.id,
      productName: "Updated Product Name",
      operatorUserId: 1,
    });

    expect(updateResult.success).toBe(true);
    expect(updateResult.productName).toBe("Updated Product Name");

    const updatedProduct = (await db!
      .select({ productName: products.productName })
      .from(products)
      .where(eq(products.id, productRow!.id))
      .limit(1))[0];

    expect(updatedProduct?.productName).toBe("Updated Product Name");
  }, 20000);

  it("restores a single E-station case back to D and archives the E task", async () => {
    await ensureMvpSeedData();
    const uniqueSuffix = `${Date.now()}`;

    await importProducts({
      poNumber: `PO-E-RESTORE-${uniqueSuffix}`,
      vendorName: "Restore Vendor",
      rows: [
        {
          batchNo: `RESTORE-BATCH-${uniqueSuffix}`,
          serialNumber: `RESTORE-SERIAL-${uniqueSuffix}`,
          imei: `95${`${Number(uniqueSuffix) + 1}`.padStart(13, "0").slice(-13)}`,
          productName: "Restore Device",
          categoryName: "智慧型手機",
          brandName: "Apple",
        },
      ],
    });

    const db = await getDb();
    expect(db).toBeTruthy();

    const productRow = (await db!
      .select({ id: products.id })
      .from(products)
      .where(and(
        eq(products.poNumber, `PO-E-RESTORE-${uniqueSuffix}`),
        eq(products.serialNumber, `RESTORE-SERIAL-${uniqueSuffix}`),
        isNull(products.archivedAt),
      ))
      .limit(1))[0];

    expect(productRow).toBeTruthy();

    await db!
      .update(products)
      .set({
        currentStationCode: "E",
        currentStatus: "pending_e",
      })
      .where(eq(products.id, productRow!.id));

    await db!.insert(stationTasks).values({
      productId: productRow!.id,
      stationCode: "E",
      taskStatus: "pending",
      dueDate: new Date(),
      resultSummary: null,
      metadata: { seededByTest: true },
    });

    const eTask = (await db!
      .select({ id: stationTasks.id })
      .from(stationTasks)
      .where(and(
        eq(stationTasks.productId, productRow!.id),
        eq(stationTasks.stationCode, "E"),
        eq(stationTasks.taskStatus, "pending"),
      ))
      .orderBy(stationTasks.id)
      .limit(1))[0];

    expect(eTask).toBeTruthy();

    const restoreResult = await restoreEProductToD({
      taskId: eTask!.id,
      productId: productRow!.id,
      operatorUserId: 1,
    });

    expect(restoreResult.success).toBe(true);

    const restoredProduct = (await db!
      .select({
        currentStationCode: products.currentStationCode,
        currentStatus: products.currentStatus,
      })
      .from(products)
      .where(eq(products.id, productRow!.id))
      .limit(1))[0];

    expect(restoredProduct?.currentStationCode).toBe("D");
    expect(restoredProduct?.currentStatus).toBe("pending_d");

    const archivedETask = (await db!
      .select({ taskStatus: stationTasks.taskStatus, resultSummary: stationTasks.resultSummary })
      .from(stationTasks)
      .where(eq(stationTasks.id, eTask!.id))
      .limit(1))[0];

    expect(archivedETask?.taskStatus).toBe("archived");
    expect(archivedETask?.resultSummary).toBe("E 站人工還原到 D 站");

    const dTask = (await db!
      .select({ stationCode: stationTasks.stationCode, taskStatus: stationTasks.taskStatus, resultSummary: stationTasks.resultSummary })
      .from(stationTasks)
      .where(and(
        eq(stationTasks.productId, productRow!.id),
        eq(stationTasks.stationCode, "D"),
        eq(stationTasks.taskStatus, "returned"),
      ))
      .limit(1))[0];

    expect(dTask?.stationCode).toBe("D");
    expect(dTask?.taskStatus).toBe("returned");
    expect(dTask?.resultSummary).toBe("由 E 站人工還原回 D 站");
  }, 20000);
});
