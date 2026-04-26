import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";

const dbMocks = vi.hoisted(() => ({
  ensureMvpSeedData: vi.fn(async () => undefined),
  archiveExpiredData: vi.fn(async () => ({ archivedCount: 0 })),
  assignProductCategoryToProduct: vi.fn(async (input: unknown) => ({ success: true as const, ...(typeof input === "object" && input ? input : {}) })),
  seedKpiForDemo: vi.fn(async () => undefined),
  getStationOverviewData: vi.fn(async () => [
    { stationCode: "A1", label: "A1 點到貨", pendingCount: 3, todayNewCount: 1, overdueCount: 0 },
  ]),
  getEngineerKpiSummary: vi.fn(async () => ({
    dailySummary: {
      businessDate: new Date("2026-04-20T00:00:00Z"),
      totalPoints: 1.11665,
      rawAchievementRate: 111.67,
      kpiAchievementRate: 100,
      overAchievementRate: 11.67,
    },
    details: [],
    monthlySummary: {
      attendanceDays: 1,
      monthTotalPoints: 1.11665,
      monthAvgPoints: 1.11665,
      monthAvgRate: 111.67,
    },
  })),
  getStationPageData: vi.fn(async (stationCode: string) => ({ stationCode, label: `${stationCode} 測試站`, tasks: [], faultOptions: [], appearanceOptions: [] })),
  getDefectOptions: vi.fn(async (stationCode: string, optionType: string) => [{ id: 1, stationCode, optionType, label: "觸控異常", active: true, sortOrder: 10 }]),
  getProductCategoryOptions: vi.fn(async () => [{ id: 3, categoryName: "手機", subtypeCode: "iPhone", active: true }]),
  getProductNameOptions: vi.fn(async () => [{ id: 1, label: "iPhone 13", active: true, sortOrder: 10 }]),
  completeStationTask: vi.fn(async () => ({ success: true as const })),
  completeA1ArrivalByScan: vi.fn(async (input: unknown) => ({ success: true as const, productCode: "P-100001", nextStationCode: "A2", ...((typeof input === "object" && input) ? input : {}) })),
  importProducts: vi.fn(async (input: unknown) => ({ success: true as const, importedCount: 1, products: [], ...((typeof input === "object" && input) ? input : {}) })),
  getSamplingQueue: vi.fn(async () => ({ stationCode: "D", label: "D 站抽樣", tasks: [] })),
  submitSamplingResult: vi.fn(async (input: unknown) => ({ success: true as const, input })),
  getAdminSetupData: vi.fn(async (input?: { startDate?: string; endDate?: string }) => ({ users: [], rules: [], categories: [{ id: 3, categoryName: "智慧手機", brandName: "Apple", subtypeCode: "Apple", active: true }], targets: [], defectOptions: [], categoryFlows: [{ categoryId: 3, stationCode: "A1", stepOrder: 1 }, { categoryId: 3, stationCode: "C", stepOrder: 2 }, { categoryId: 3, stationCode: "D", stepOrder: 3 }, { categoryId: 3, stationCode: "E", stepOrder: 4 }, { categoryId: 3, stationCode: "STOCK", stepOrder: 5 }], kpiProgress: [{ userId: 7, name: "Demo User", role: "user", monthTotalPoints: 12.5, avgKpiAchievementRate: 83.3, attendanceDays: 18, finalKpiScore: 88 }], stationLeadTimes: [{ stationCode: "C", avgDaysFromImport: 1.5, sampleCount: 12 }], categoryStockCycleTimes: [{ categoryId: 3, categoryName: "智慧手機", brandName: "Apple", avgDaysToStock: 3.2, sampleCount: 10 }], kpiRange: { startDate: input?.startDate ?? "2026-04-01", endDate: input?.endDate ?? "2026-04-30" }, productNameOptions: [{ id: 1, label: "iPhone 13", active: true, sortOrder: 10 }], syncSummary: { queuedJobs: 0, targetSheetName: "採購單" }, archiveSummary: { retentionMonths: 6, candidateCount: 0, policy: "主表僅保留六個月內資料" } })),
  upsertDefectOption: vi.fn(async (input: unknown) => ({ success: true as const, input })),
  replaceCategoryStationFlow: vi.fn(async (input: unknown) => ({ success: true as const, input })),
  createProductNameOption: vi.fn(async (input: unknown) => ({ id: 99, active: true, sortOrder: 60, ...(typeof input === "object" && input ? input : {}) })),
  deleteProductNameOption: vi.fn(async (id: number) => ({ success: true as const, id })),
  updateStationRule: vi.fn(async (input: unknown) => ({ success: true as const, input })),
  updateProductivityTarget: vi.fn(async (input: unknown) => ({ success: true as const, input })),
}));

const {
  ensureMvpSeedData,
  archiveExpiredData,
  assignProductCategoryToProduct,
  seedKpiForDemo,
  getStationOverviewData,
  getEngineerKpiSummary,
  getStationPageData,
  getDefectOptions,
  getProductCategoryOptions,
  getProductNameOptions,
  completeStationTask,
  completeA1ArrivalByScan,
  importProducts,
  getSamplingQueue,
  submitSamplingResult,
  getAdminSetupData,
  upsertDefectOption,
  replaceCategoryStationFlow,
  createProductNameOption,
  deleteProductNameOption,
  updateStationRule,
  updateProductivityTarget,
} = dbMocks;

vi.mock("./db", () => dbMocks);

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createContext(role: AuthenticatedUser["role"] = "user"): TrpcContext {
  return {
    user: {
      id: 7,
      openId: "demo-open-id",
      email: "demo@example.com",
      name: "Demo User",
      loginMethod: "manus",
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

describe("warehouse MVP router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes engineers to operations home with station overview and KPI summary", async () => {
    const caller = appRouter.createCaller(createContext("user"));

    const result = await caller.dashboard.home();

    expect(result.roleLanding).toBe("operations");
    expect(ensureMvpSeedData).toHaveBeenCalled();
    expect(getStationOverviewData).toHaveBeenCalled();
    expect(getEngineerKpiSummary).toHaveBeenCalledWith(7);
    expect(result.stations[0]?.stationCode).toBe("A1");
  });

  it("routes admins to management dashboard", async () => {
    const caller = appRouter.createCaller(createContext("admin"));

    const result = await caller.dashboard.home();

    expect(result.roleLanding).toBe("dashboard");
  });

  it("allows only admins to fetch admin setup data and exposes analytics fields", async () => {
    const adminCaller = appRouter.createCaller(createContext("admin"));
    const adminResult = await adminCaller.admin.setup();

    expect(adminResult.categoryFlows[0]?.stationCode).toBe("A1");
    expect(adminResult.kpiProgress[0]?.monthTotalPoints).toBe(12.5);
    expect(adminResult.stationLeadTimes[0]?.stationCode).toBe("C");
    expect(adminResult.categoryStockCycleTimes[0]?.brandName).toBe("Apple");
    expect(adminResult.kpiRange.startDate).toBe("2026-04-01");
    expect(getAdminSetupData).toHaveBeenCalledWith({ startDate: undefined, endDate: undefined });

    const userCaller = appRouter.createCaller(createContext("user"));
    await expect(userCaller.admin.setup()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("passes KPI date range filters to the admin setup data layer", async () => {
    const caller = appRouter.createCaller(createContext("admin"));

    const result = await caller.admin.setup({
      startDate: "2026-04-10",
      endDate: "2026-04-20",
    });

    expect(getAdminSetupData).toHaveBeenLastCalledWith({
      startDate: "2026-04-10",
      endDate: "2026-04-20",
    });
    expect(result.kpiRange).toEqual({
      startDate: "2026-04-10",
      endDate: "2026-04-20",
    });
  });

  it("delegates category station flow replacement to the admin data layer", async () => {
    const caller = appRouter.createCaller(createContext("admin"));

    await caller.admin.replaceCategoryStationFlow({
      categoryId: 3,
      stationCodes: ["A1", "C", "D", "E", "STOCK"],
    });

    expect(replaceCategoryStationFlow).toHaveBeenCalledWith({
      categoryId: 3,
      stationCodes: ["A1", "C", "D", "E", "STOCK"],
    });
  });

  it("delegates station category assignment with authenticated product selection", async () => {
    const caller = appRouter.createCaller(createContext("user"));

    await caller.station.assignCategory({
      productId: 99,
      categoryId: 3,
    });

    expect(assignProductCategoryToProduct).toHaveBeenCalledWith({
      productId: 99,
      categoryId: 3,
    });
  });

  it("delegates station completion with defect selections and authenticated operator id", async () => {
    const caller = appRouter.createCaller(createContext("user"));

    await caller.station.complete({
      taskId: 10,
      stationCode: "C",
      productId: 99,
      categoryId: 3,
      subtypeCode: "iPhone",
      summary: "C 完成",
      faultOptionIds: [1, 2],
      appearanceOptionIds: [5],
    });

    expect(completeStationTask).toHaveBeenCalledWith({
      taskId: 10,
      stationCode: "C",
      operatorUserId: 7,
      productId: 99,
      categoryId: 3,
      subtypeCode: "iPhone",
      summary: "C 完成",
      faultOptionIds: [1, 2],
      appearanceOptionIds: [5],
    });
  });

  it("allows engineers to complete A1 by scanning existing identifiers", async () => {
    const caller = appRouter.createCaller(createContext("user"));

    await caller.station.receive({
      batchNo: "BATCH-240421-01",
      serialNumber: "SN-1001",
      imei: "356000000000001",
      productName: "iPhone 13",
    });

    expect(completeA1ArrivalByScan).toHaveBeenCalledWith({
      operatorUserId: 7,
      batchNo: "BATCH-240421-01",
      serialNumber: "SN-1001",
      imei: "356000000000001",
      productName: "iPhone 13",
    });
  });

  it("allows management roles to batch import products with a shared PO number", async () => {
    const caller = appRouter.createCaller(createContext("manager"));

    await caller.station.importBatch({
      poNumber: "PO-20260421-01",
      vendorName: "綠途未來",
      arrivalAt: "2026-04-21T10:00",
      rows: [
        {
          batchNo: "BATCH-240421-01",
          serialNumber: "SN-1001",
          imei: "356000000000001",
          productName: "iPhone 13",
          categoryName: "智慧手機",
          brandName: "Apple",
        },
      ],
    });

    expect(importProducts).toHaveBeenCalledWith({
      poNumber: "PO-20260421-01",
      vendorName: "綠途未來",
      arrivalAt: "2026-04-21T10:00",
      importedByUserId: 7,
      rows: [
        {
          batchNo: "BATCH-240421-01",
          serialNumber: "SN-1001",
          imei: "356000000000001",
          productName: "iPhone 13",
          categoryName: "智慧手機",
          brandName: "Apple",
        },
      ],
    });
  });

  it("allows supervisors to batch import without manually entering a PO number", async () => {
    const caller = appRouter.createCaller(createContext("supervisor"));

    await caller.station.importBatch({
      vendorName: "綠途未來",
      arrivalAt: "2026-04-21T10:00",
      rows: [
        {
          batchNo: "BATCH-240421-02",
          serialNumber: "SN-1002",
          imei: "356000000000002",
          productName: "iPhone 13",
          categoryName: "智慧手機",
          brandName: "Apple",
        },
      ],
    });

    expect(importProducts).toHaveBeenLastCalledWith({
      poNumber: undefined,
      vendorName: "綠途未來",
      arrivalAt: "2026-04-21T10:00",
      importedByUserId: 7,
      rows: [
        {
          batchNo: "BATCH-240421-02",
          serialNumber: "SN-1002",
          imei: "356000000000002",
          productName: "iPhone 13",
          categoryName: "智慧手機",
          brandName: "Apple",
        },
      ],
    });
  });

  it("submits sampling result with authenticated management role id", async () => {
    const caller = appRouter.createCaller(createContext("manager"));

    await caller.sampling.submit({
      taskId: 20,
      productId: 88,
      passed: false,
      categoryId: 3,
      subtypeCode: "iPhone",
      defectReason: "外觀異常",
    });

    expect(submitSamplingResult).toHaveBeenCalledWith({
      taskId: 20,
      productId: 88,
      sampledByUserId: 7,
      passed: false,
      categoryId: 3,
      subtypeCode: "iPhone",
      defectReason: "外觀異常",
    });
  });

  it("forbids regular users from import and sampling routes reserved for management roles", async () => {
    const caller = appRouter.createCaller(createContext("user"));

    await expect(caller.station.importBatch({
      vendorName: "綠途未來",
      arrivalAt: "2026-04-21T10:00",
      rows: [
        {
          batchNo: "BATCH-240421-09",
          serialNumber: "SN-1099",
          imei: "356000000000099",
          productName: "iPhone 13",
          categoryName: "智慧手機",
          brandName: "Apple",
        },
      ],
    })).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(caller.sampling.queue()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.sampling.submit({
      taskId: 20,
      productId: 88,
      passed: false,
      categoryId: 3,
      subtypeCode: "iPhone",
      defectReason: "外觀異常",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows admins to query configurable defect options", async () => {
    const caller = appRouter.createCaller(createContext("admin"));

    await caller.admin.getDefectOptions({
      stationCode: "B",
      optionType: "fault",
    });

    expect(getDefectOptions).toHaveBeenCalledWith("B", "fault");
  });

  it("loads product name and category options for import and A1 dropdowns", async () => {
    const caller = appRouter.createCaller(createContext("user"));

    await caller.station.productNameOptions();
    await caller.station.productCategoryOptions();

    expect(getProductNameOptions).toHaveBeenCalled();
    expect(getProductCategoryOptions).toHaveBeenCalled();
  });

  it("allows admins to upsert defect options", async () => {
    const caller = appRouter.createCaller(createContext("admin"));

    await caller.admin.upsertDefectOption({
      stationCode: "C",
      optionType: "appearance",
      label: "邊框刮傷",
      active: true,
      sortOrder: 30,
    });

    expect(upsertDefectOption).toHaveBeenCalledWith({
      stationCode: "C",
      optionType: "appearance",
      label: "邊框刮傷",
      active: true,
      sortOrder: 30,
    });
  });

  it("allows admins to import products in bulk", async () => {
    const caller = appRouter.createCaller(createContext("admin"));

    await caller.admin.importProducts({
      poNumber: "PO-20260421-02",
      vendorName: "循環供應商",
      arrivalAt: "2026-04-21T14:00",
      rows: [
        {
          batchNo: "BATCH-240421-02",
          serialNumber: "SN-1002",
          imei: "356000000000002",
          productName: "Galaxy S22",
          categoryName: "智慧手機",
          brandName: "Samsung",
        },
      ],
    });

    expect(importProducts).toHaveBeenCalledWith({
      poNumber: "PO-20260421-02",
      vendorName: "循環供應商",
      arrivalAt: "2026-04-21T14:00",
      importedByUserId: 7,
      rows: [
        {
          batchNo: "BATCH-240421-02",
          serialNumber: "SN-1002",
          imei: "356000000000002",
          productName: "Galaxy S22",
          categoryName: "智慧手機",
          brandName: "Samsung",
        },
      ],
    });
  });

  it("allows admins to create product name options", async () => {
    const caller = appRouter.createCaller(createContext("admin"));

    await caller.admin.createProductNameOption({
      label: "iPhone 14 Pro",
    });

    expect(createProductNameOption).toHaveBeenCalledWith({
      label: "iPhone 14 Pro",
    });
  });

  it("allows admins to delete product name options", async () => {
    const caller = appRouter.createCaller(createContext("admin"));

    await caller.admin.deleteProductNameOption({
      id: 9,
    });

    expect(deleteProductNameOption).toHaveBeenCalledWith(9);
  });

  it("allows admins to update station rules", async () => {
    const caller = appRouter.createCaller(createContext("admin"));

    await caller.admin.updateStationRule({
      id: 1,
      routeKey: "default",
      nextStationCode: "A2",
      allowReworkToCode: "C",
      active: true,
      notes: "A1 完成後進入 A2",
    });

    expect(updateStationRule).toHaveBeenCalledWith({
      id: 1,
      routeKey: "default",
      nextStationCode: "A2",
      allowReworkToCode: "C",
      active: true,
      notes: "A1 完成後進入 A2",
    });
  });

  it("allows admins to update productivity targets", async () => {
    const caller = appRouter.createCaller(createContext("admin"));

    await caller.admin.updateProductivityTarget({
      id: 2,
      stationCode: "B",
      categoryId: 8,
      subtypeCode: "Apple",
      dailyTargetQty: 150,
      active: true,
    });

    expect(updateProductivityTarget).toHaveBeenCalledWith({
      id: 2,
      stationCode: "B",
      categoryId: 8,
      subtypeCode: "Apple",
      dailyTargetQty: 150,
      active: true,
    });
  });

  it("allows admins to save all admin settings through one mutation", async () => {
    const caller = appRouter.createCaller(createContext("admin"));

    const result = await caller.admin.saveAllSettings({
      rules: [
        {
          id: 1,
          routeKey: "default",
          nextStationCode: "A2",
          allowReworkToCode: "C",
          active: true,
          notes: "A1 完成後進入 A2",
        },
      ],
      targets: [
        {
          id: 2,
          stationCode: "B",
          categoryId: 8,
          subtypeCode: "Apple",
          dailyTargetQty: 150,
          active: true,
        },
      ],
      defectOptions: [
        {
          stationCode: "C",
          optionType: "appearance",
          label: "邊框刮傷",
          active: true,
          sortOrder: 30,
        },
      ],
      categoryFlows: [
        {
          categoryId: 3,
          stationCodes: ["A1", "C", "D", "E", "STOCK"],
        },
      ],
    });

    expect(updateStationRule).toHaveBeenCalledWith({
      id: 1,
      routeKey: "default",
      nextStationCode: "A2",
      allowReworkToCode: "C",
      active: true,
      notes: "A1 完成後進入 A2",
    });
    expect(updateProductivityTarget).toHaveBeenCalledWith({
      id: 2,
      stationCode: "B",
      categoryId: 8,
      subtypeCode: "Apple",
      dailyTargetQty: 150,
      active: true,
    });
    expect(upsertDefectOption).toHaveBeenCalledWith({
      stationCode: "C",
      optionType: "appearance",
      label: "邊框刮傷",
      active: true,
      sortOrder: 30,
    });
    expect(replaceCategoryStationFlow).toHaveBeenCalledWith({
      categoryId: 3,
      stationCodes: ["A1", "C", "D", "E", "STOCK"],
    });
    expect(result).toEqual({
      success: true,
      savedCounts: {
        rules: 1,
        targets: 1,
        defectOptions: 1,
        categoryFlows: 1,
      },
    });
  });

  it("loads admin setup with archive and seed checks", async () => {
    const caller = appRouter.createCaller(createContext("admin"));

    await caller.admin.setup();

    expect(ensureMvpSeedData).toHaveBeenCalled();
    expect(archiveExpiredData).toHaveBeenCalled();
    expect(getAdminSetupData).toHaveBeenCalled();
  });

  it("loads station detail data for the requested station", async () => {
    const caller = appRouter.createCaller(createContext("user"));

    await caller.station.detail({ stationCode: "B" });

    expect(getStationPageData).toHaveBeenCalledWith("B");
  });

  it("loads sampling queue for management roles", async () => {
    const caller = appRouter.createCaller(createContext("manager"));

    await caller.sampling.queue();

    expect(getSamplingQueue).toHaveBeenCalled();
  });

  it("seeds KPI demo data when engineers open KPI page", async () => {
    const caller = appRouter.createCaller(createContext("user"));

    await caller.engineer.kpi();

    expect(seedKpiForDemo).toHaveBeenCalledWith(7);
    expect(getEngineerKpiSummary).toHaveBeenCalledWith(7);
  });
});
