import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";

const dbMocks = vi.hoisted(() => ({
  ensureMvpSeedData: vi.fn(async () => undefined),
  archiveExpiredData: vi.fn(async () => ({ archivedCount: 0 })),
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
  importProducts: vi.fn(async (input: unknown) => ({ success: true as const, importedCount: 1, products: [], ...((typeof input === "object" && input) ? input : {}) })),
  getSamplingQueue: vi.fn(async () => ({ stationCode: "D", label: "D 站抽樣", tasks: [] })),
  submitSamplingResult: vi.fn(async (input: unknown) => ({ success: true as const, input })),
  getAdminSetupData: vi.fn(async () => ({ users: [], rules: [], categories: [], targets: [], defectOptions: [], productNameOptions: [{ id: 1, label: "iPhone 13", active: true, sortOrder: 10 }], syncSummary: { queuedJobs: 0, targetSheetName: "採購單" }, archiveSummary: { retentionMonths: 6, candidateCount: 0, policy: "主表僅保留六個月內資料" } })),
  upsertDefectOption: vi.fn(async (input: unknown) => ({ success: true as const, input })),
  createProductNameOption: vi.fn(async (input: unknown) => ({ id: 99, active: true, sortOrder: 60, ...(typeof input === "object" && input ? input : {}) })),
  deleteProductNameOption: vi.fn(async (id: number) => ({ success: true as const, id })),
  updateStationRule: vi.fn(async (input: unknown) => ({ success: true as const, input })),
  updateProductivityTarget: vi.fn(async (input: unknown) => ({ success: true as const, input })),
}));

const {
  ensureMvpSeedData,
  archiveExpiredData,
  seedKpiForDemo,
  getStationOverviewData,
  getEngineerKpiSummary,
  getStationPageData,
  getDefectOptions,
  getProductCategoryOptions,
  getProductNameOptions,
  completeStationTask,
  importProducts,
  getSamplingQueue,
  submitSamplingResult,
  getAdminSetupData,
  upsertDefectOption,
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

  it("allows engineers to create a single A1 arrival record", async () => {
    const caller = appRouter.createCaller(createContext("user"));

    await caller.station.receive({
      poNumber: "PO-20260421-01",
      vendorName: "綠途未來",
      arrivalAt: "2026-04-21T09:30",
      batchNo: "BATCH-240421-01",
      serialNumber: "SN-1001",
      imei: "356000000000001",
      productName: "iPhone 13",
      categoryName: "智慧手機",
    });

    expect(importProducts).toHaveBeenCalledWith({
      poNumber: "PO-20260421-01",
      vendorName: "綠途未來",
      arrivalAt: "2026-04-21T09:30",
      importedByUserId: 7,
      rows: [
        {
          batchNo: "BATCH-240421-01",
          serialNumber: "SN-1001",
          imei: "356000000000001",
          productName: "iPhone 13",
          categoryName: "智慧手機",
        },
      ],
    });
  });

  it("allows protected users to batch import products with a shared PO number", async () => {
    const caller = appRouter.createCaller(createContext("user"));

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
        },
      ],
    });
  });

  it("allows batch import without manually entering a PO number", async () => {
    const caller = appRouter.createCaller(createContext("user"));

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
        },
      ],
    });
  });

  it("submits sampling result with authenticated sampler id", async () => {
    const caller = appRouter.createCaller(createContext("user"));

    await caller.sampling.submit({
      taskId: 20,
      productId: 88,
      passed: false,
      defectReason: "外觀異常",
    });

    expect(submitSamplingResult).toHaveBeenCalledWith({
      taskId: 20,
      productId: 88,
      sampledByUserId: 7,
      passed: false,
      defectReason: "外觀異常",
    });
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
      dailyTargetQty: 150,
      baseUnitPoints: "0.006667",
      active: true,
    });

    expect(updateProductivityTarget).toHaveBeenCalledWith({
      id: 2,
      stationCode: "B",
      dailyTargetQty: 150,
      baseUnitPoints: "0.006667",
      active: true,
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

  it("loads sampling queue", async () => {
    const caller = appRouter.createCaller(createContext("user"));

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
