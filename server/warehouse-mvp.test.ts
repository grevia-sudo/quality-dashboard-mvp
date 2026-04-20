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
  getStationPageData: vi.fn(async (stationCode: string) => ({ stationCode, label: `${stationCode} 測試站`, tasks: [] })),
  completeStationTask: vi.fn(async () => ({ success: true as const })),
  getSamplingQueue: vi.fn(async () => ({ stationCode: "D", label: "D 站抽樣", tasks: [] })),
  submitSamplingResult: vi.fn(async (input: unknown) => ({ success: true as const, input })),
  getAdminSetupData: vi.fn(async () => ({ users: [], rules: [], categories: [], targets: [], syncSummary: { queuedJobs: 0, targetSheetName: "手機檢測資料庫" }, archiveSummary: { retentionMonths: 6, candidateCount: 0, policy: "主表僅保留六個月內資料" } })),
}));

const {
  ensureMvpSeedData,
  archiveExpiredData,
  seedKpiForDemo,
  getStationOverviewData,
  getEngineerKpiSummary,
  getStationPageData,
  completeStationTask,
  getSamplingQueue,
  submitSamplingResult,
  getAdminSetupData,
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

  it("delegates station completion with authenticated operator id", async () => {
    const caller = appRouter.createCaller(createContext("user"));

    await caller.station.complete({
      taskId: 10,
      stationCode: "A1",
      productId: 99,
      categoryId: 3,
      subtypeCode: "iPhone",
      summary: "A1 完成",
    });

    expect(completeStationTask).toHaveBeenCalledWith({
      taskId: 10,
      stationCode: "A1",
      operatorUserId: 7,
      productId: 99,
      categoryId: 3,
      subtypeCode: "iPhone",
      summary: "A1 完成",
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
});
