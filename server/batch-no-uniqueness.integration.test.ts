import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { products } from "../drizzle/schema";
import { completeA1ArrivalByScan, ensureMvpSeedData, getDb, importProducts } from "./db";

describe("batch number uniqueness guard", () => {
  it("blocks A1 receive when another active product already uses the same batch number", async () => {
    await ensureMvpSeedData();
    const uniqueSuffix = `${Date.now()}`;

    const importResult = await importProducts({
      poNumber: `PO-BATCH-GUARD-${uniqueSuffix}`,
      vendorName: "批號唯一測試廠商",
      rows: [
        {
          batchNo: `BATCH-GUARD-${uniqueSuffix}-01`,
          serialNumber: `BATCH-GUARD-SN-${uniqueSuffix}-01`,
          imei: `91${`${Number(uniqueSuffix) + 1}`.padStart(13, "0").slice(-13)}`,
          productName: "Batch Guard Device 01",
          categoryName: "智慧型手機",
          brandName: "Apple",
        },
        {
          batchNo: `BATCH-GUARD-${uniqueSuffix}-02`,
          serialNumber: `BATCH-GUARD-SN-${uniqueSuffix}-02`,
          imei: `91${`${Number(uniqueSuffix) + 2}`.padStart(13, "0").slice(-13)}`,
          productName: "Batch Guard Device 02",
          categoryName: "智慧型手機",
          brandName: "Apple",
        },
      ],
    });

    expect(importResult.importedCount).toBe(2);

    const result = await completeA1ArrivalByScan({
      operatorUserId: 1,
      batchNo: `BATCH-GUARD-${uniqueSuffix}-01`,
      serialNumber: `BATCH-GUARD-SN-${uniqueSuffix}-02`,
      productName: "Batch Guard Device 02",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain(`商品批號 BATCH-GUARD-${uniqueSuffix}-01 已存在於`);

    const db = await getDb();
    expect(db).toBeTruthy();
    const secondProduct = await db!
      .select({
        batchNo: products.batchNo,
        serialNumber: products.serialNumber,
      })
      .from(products)
      .where(and(
        eq(products.poNumber, `PO-BATCH-GUARD-${uniqueSuffix}`),
        eq(products.serialNumber, `BATCH-GUARD-SN-${uniqueSuffix}-02`),
        isNull(products.archivedAt),
      ))
      .limit(1);

    expect(secondProduct[0]?.batchNo).toBe(`BATCH-GUARD-${uniqueSuffix}-02`);
  }, 20000);

  it("blocks import rows that reuse an existing active batch number", async () => {
    await ensureMvpSeedData();
    const uniqueSuffix = `${Date.now()}`;
    const reusedBatchNo = `IMPORT-BATCH-GUARD-${uniqueSuffix}`;

    await importProducts({
      poNumber: `PO-BATCH-BASE-${uniqueSuffix}`,
      vendorName: "批號唯一測試廠商",
      rows: [
        {
          batchNo: reusedBatchNo,
          serialNumber: `IMPORT-BATCH-SN-${uniqueSuffix}-01`,
          imei: `92${`${Number(uniqueSuffix) + 1}`.padStart(13, "0").slice(-13)}`,
          productName: "Import Guard Device 01",
          categoryName: "智慧型手機",
          brandName: "Apple",
        },
      ],
    });

    await expect(importProducts({
      poNumber: `PO-BATCH-DUP-${uniqueSuffix}`,
      vendorName: "批號唯一測試廠商",
      rows: [
        {
          batchNo: reusedBatchNo,
          serialNumber: `IMPORT-BATCH-SN-${uniqueSuffix}-02`,
          imei: `92${`${Number(uniqueSuffix) + 2}`.padStart(13, "0").slice(-13)}`,
          productName: "Import Guard Device 02",
          categoryName: "智慧型手機",
          brandName: "Apple",
        },
      ],
    })).rejects.toThrow(`商品批號 ${reusedBatchNo} 已存在於`);
  }, 20000);
});
