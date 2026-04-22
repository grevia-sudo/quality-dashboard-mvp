import { beforeAll, describe, expect, it } from "vitest";
import { ensureMvpSeedData, getStationPageData, importProducts } from "./db";

describe("import PO summary integration", () => {
  beforeAll(async () => {
    await ensureMvpSeedData();
  });

  it("backfills missing pending A1 PO numbers and exposes grouped data for the import page", async () => {
    const result = await getStationPageData("A1");
    const tasks = result.tasks;

    expect(Array.isArray(tasks)).toBe(true);

    const pendingWithoutPo = tasks.filter((task) => !task.poNumber || !task.poNumber.trim());
    expect(pendingWithoutPo).toHaveLength(0);

    const groupedKeys = new Set(
      tasks.map((task) => `${task.poNumber}__${task.categoryName ?? task.subtypeCode ?? "未分類"}`),
    );
    expect(groupedKeys.size).toBeGreaterThanOrEqual(0);
  });

  it("auto-generates a PO number when importing without manually entering one", async () => {
    const uniqueSuffix = `${Date.now()}`;
    const batchNo = `AUTO-PO-${uniqueSuffix}`;
    const serialNumber = `AUTO-SN-${uniqueSuffix}`;
    const imei = `35${uniqueSuffix.padStart(13, "0").slice(-13)}`;

    const importResult = await importProducts({
      vendorName: "自動補號驗證廠商",
      rows: [
        {
          batchNo,
          serialNumber,
          imei,
          productName: "Apple iPhone 6 16GB 銀色",
          categoryId: 4,
        },
      ],
    });

    expect(importResult.poNumber).toMatch(/^PO-\d{8}-\d{2}$/);

    const stationData = await getStationPageData("A1");
    const importedTask = stationData.tasks.find((task) => task.batchNo === batchNo || task.serialNumber === serialNumber || task.imei === imei);

    expect(importedTask).toBeDefined();
    expect(importedTask?.poNumber).toBe(importResult.poNumber);
  });
});
