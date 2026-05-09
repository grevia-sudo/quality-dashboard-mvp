// @vitest-environment jsdom
import React from "react";
(globalThis as any).React = React;
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setLocationMock = vi.fn();
const useAuthMock = vi.fn();
const setupUseQueryMock = vi.fn();
const importBackupsUseQueryMock = vi.fn();
const productTraceUseQueryMock = vi.fn();
let currentLocation = "/admin/menus";

vi.mock("wouter", () => ({
  useLocation: () => [currentLocation, setLocationMock],
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/adminProductTrace", () => ({
  analyzeProductTraceResults: () => [],
}));

vi.mock("@/components/DashboardLayout", async () => {
  const actual = await vi.importActual<typeof import("../client/src/components/DashboardLayout")>("../client/src/components/DashboardLayout");
  return {
    ...actual,
    default: ({ children, navItems }: { children: React.ReactNode; navItems?: Array<{ label: string }> }) => React.createElement(
      "div",
      null,
      React.createElement(
        "nav",
        { "data-testid": "dashboard-nav" },
        ...(navItems ?? []).map((item) => React.createElement("span", { key: item.label }, item.label)),
      ),
      children,
    ),
  };
});

vi.mock("@/lib/trpc", () => {
  const buildMutation = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  });

  return {
    trpc: {
      useUtils: () => ({
        admin: { setup: { invalidate: vi.fn() } },
        station: {
          productCategoryOptions: { invalidate: vi.fn() },
          productNameOptions: { invalidate: vi.fn() },
        },
      }),
      admin: {
        setup: {
          useQuery: (...args: unknown[]) => setupUseQueryMock(...args),
        },
        importBackups: {
          useQuery: (...args: unknown[]) => importBackupsUseQueryMock(...args),
        },
        productTrace: {
          useQuery: (...args: unknown[]) => productTraceUseQueryMock(...args),
        },
        saveAllSettings: { useMutation: buildMutation },
        createProductNameOption: { useMutation: buildMutation },
        syncProductNameOptionsFromSheet: { useMutation: buildMutation },
        deleteProductNameOption: { useMutation: buildMutation },
        createProductCategoryOption: { useMutation: buildMutation },
        deleteProductCategoryOption: { useMutation: buildMutation },
        clearProductCategoryOptions: { useMutation: buildMutation },
        createImportBackup: { useMutation: buildMutation },
        restoreImportBackup: { useMutation: buildMutation },
        deleteImportedPurchaseOrder: { useMutation: buildMutation },
        createUser: { useMutation: buildMutation },
        createSupportCompensation: { useMutation: buildMutation },
        deleteSupportCompensation: { useMutation: buildMutation },
      },
    },
  };
});

import AdminPage from "../client/src/pages/AdminPage";

describe("admin menu settings layout component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentLocation = "/admin/menus";
    useAuthMock.mockReturnValue({
      loading: false,
      user: {
        id: 1,
        name: "Admin",
        role: "admin",
      },
    });
    setupUseQueryMock.mockReturnValue({
      isLoading: false,
      data: {
        rules: [],
        targets: [],
        defectOptions: [
          { id: 1, stationCode: "B", optionType: "fault", label: "無法開機", active: true, sortOrder: 1 },
          { id: 2, stationCode: "C", optionType: "fault", label: "觸控異常", active: true, sortOrder: 2 },
          { id: 3, stationCode: "C", optionType: "appearance", label: "邊框刮傷", active: true, sortOrder: 3 },
          { id: 4, stationCode: "C", optionType: "camera", label: "無法對焦", active: false, sortOrder: 4 },
        ],
        categoryFlows: [],
        categories: [
          { id: 11, categoryName: "智慧型手機", brandName: "Apple", subtypeCode: "Apple" },
        ],
        kpiRange: { startDate: "2026-04-01", endDate: "2026-04-30" },
        kpiProgress: [
          {
            userId: 9,
            name: "巧克力",
            username: "Qc.8",
            role: "supervisor",
            attendanceDays: 2,
            todayPoints: 0,
            todayDisplayPoints: 0,
            monthTotalPoints: 0,
            monthTotalDisplayPoints: 0,
            monthAvgPoints: 0,
            monthAvgDisplayPoints: 0,
            avgKpiAchievementRate: 0,
            finalKpiScore: 0,
          },
        ],
        supportCompensations: [],
        stationLeadTimes: [],
        categoryStockCycleTimes: [],
        users: [{ id: 2, name: "工程師", username: "engineer", role: "engineer" }],
        productNameOptions: [{ id: 1, label: "iPhone 15 Pro", sortOrder: 1 }],
      },
    });
    importBackupsUseQueryMock.mockReturnValue({ data: [], isLoading: false });
    productTraceUseQueryMock.mockReturnValue({ data: [], isLoading: false });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the wider horizontal menu-setting editor on the menus section", () => {
    render(React.createElement(AdminPage));

    expect(screen.getByTestId("dashboard-nav").textContent).toContain("管理後台");
    expect(screen.getByText("功能表設定改成與 C 站作業相同的寬版編輯節奏。每個項目會以橫向列呈現，方便直接調整名稱、排序與啟用狀態，不需要在狹長卡片中反覆上下捲動。")).toBeTruthy();
    expect(screen.getAllByText("新增一個項目").length).toBe(4);
    expect(screen.getAllByText("項目名稱").length).toBeGreaterThan(0);
    expect(screen.getAllByText("排序").length).toBeGreaterThan(0);
    expect(screen.getAllByText("狀態").length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue("無法開機")).toBeTruthy();
    expect(screen.getByDisplayValue("觸控異常")).toBeTruthy();
    expect(screen.getByDisplayValue("邊框刮傷")).toBeTruthy();
    expect(screen.getByDisplayValue("無法對焦")).toBeTruthy();
  });

  it("shows supervisor roles in the KPI progress table without downgrading them to engineer", () => {
    currentLocation = "/admin";
    render(React.createElement(AdminPage));

    expect(screen.getByText("巧克力")).toBeTruthy();
    expect(screen.getByText("Qc.8")).toBeTruthy();
    expect(screen.getByText("supervisor")).toBeTruthy();
  });

  it("keeps the menus route focused on menu settings only without rendering KPI or capacity sections", () => {
    render(React.createElement(AdminPage));

    expect(screen.getByText("目前功能：功能表設定")).toBeTruthy();
    expect(screen.queryByText("全員 KPI 進度")).toBeNull();
    expect(screen.queryByText("產能設定")).toBeNull();
    expect(screen.getByText("功能表設定改成與 C 站作業相同的寬版編輯節奏。每個項目會以橫向列呈現，方便直接調整名稱、排序與啟用狀態，不需要在狹長卡片中反覆上下捲動。")).toBeTruthy();
  });

  it("allows supervisor users to access the admin page content", () => {
    currentLocation = "/admin";
    useAuthMock.mockReturnValue({
      loading: false,
      user: {
        id: 9,
        name: "巧克力",
        role: "supervisor",
      },
    });

    render(React.createElement(AdminPage));

    expect(screen.getByTestId("dashboard-nav").textContent).toContain("管理後台");
    expect(screen.queryByText("管理後台需主管、經理或 admin 權限")).toBeNull();
    expect(screen.getByText("全員 KPI 進度")).toBeTruthy();
  });
});
