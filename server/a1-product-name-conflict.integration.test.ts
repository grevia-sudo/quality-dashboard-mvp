import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { products } from "../drizzle/schema";
import { completeA1ArrivalByScan, ensureMvpSeedData, getDb, importProducts } from "./db";

describe("A1 product name conflict handling", () => {
  it("allows A1 completion when serial number matches an imported product but the onsite product name differs", async () => {
    await ensureMvpSeedData();
    const uniqueSuffix = `${Date.now()}`;
    const serialNumber = `A1-NAME-CONFLICT-SN-${uniqueSuffix}`;
    const batchNo = `A1-NAME-CONFLICT-BATCH-${uniqueSuffix}`;
    const importedName = "iPhone 12 mini 256 白";
    const onsiteName = "iPhone 12 mini 256G 白色";

    const importResult = await importProducts({
      poNumber: `PO-A1-NAME-${uniqueSuffix}`,
      vendorName: "品名衝突測試廠商",
      rows: [
        {
          batchNo: null,
          serialNumber,
          imei: `93${`${Number(uniqueSuffix) + 1}`.padStart(13, "0").slice(-13)}`,
          productName: importedName,
          categoryName: "智慧型手機",
          brandName: "Apple",
        },
      ],
    });

    expect(importResult.importedCount).toBe(1);

    const result = await completeA1ArrivalByScan({
      operatorUserId: 1,
      batchNo,
      serialNumber,
      productName: onsiteName,
    });

    expect(result.success).toBe(true);

    const db = await getDb();
    expect(db).toBeTruthy();

    const row = await db!
      .select({
        batchNo: products.batchNo,
        serialNumber: products.serialNumber,
        productName: products.productName,
        currentStationCode: products.currentStationCode,
      })
      .from(products)
      .where(and(
        eq(products.poNumber, `PO-A1-NAME-${uniqueSuffix}`),
        eq(products.serialNumber, serialNumber),
        isNull(products.archivedAt),
      ))
      .limit(1);

    expect(row[0]?.batchNo).toBe(batchNo);
    expect(row[0]?.serialNumber).toBe(serialNumber);
    expect(row[0]?.productName).toBe(onsiteName);
    expect(row[0]?.currentStationCode).toBe("A2");
  }, 20000);
});
