// @vitest-environment jsdom
import React from "react";
(globalThis as any).React = React;
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useAuthMock = vi.fn(() => ({
  loading: false,
  user: {
    id: 7,
    name: "Supervisor User",
    role: "supervisor",
  },
}));

const setLocationMock = vi.fn();
const pendingStockMismatchesUseQueryMock = vi.fn();

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/admin/pending-stock-mismatches", setLocationMock],
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    admin: {
      pendingStockMismatches: {
        useQuery: (...args: unknown[]) => pendingStockMismatchesUseQueryMock(...args),
      },
    },
  },
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

import PendingStockMismatchPage from "../client/src/pages/PendingStockMismatchPage";

describe("PendingStockMismatchPage component", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({
      loading: false,
      user: {
        id: 7,
        name: "Supervisor User",
        role: "supervisor",
      },
    });
  });

  it("renders management nav entry and does not auto-redirect for supervisor users", () => {
    pendingStockMismatchesUseQueryMock.mockReturnValue({
      data: [],
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });

    render(React.createElement(PendingStockMismatchPage));

    expect(screen.getByTestId("dashboard-nav").textContent).toContain("已刷入未同步");
    expect(screen.getByTestId("dashboard-nav").textContent).toContain("管理後台");
    expect(setLocationMock).not.toHaveBeenCalled();
  });

  it("renders loading state", () => {
    pendingStockMismatchesUseQueryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });

    render(React.createElement(PendingStockMismatchPage));

    expect(screen.getByText("正在載入已刷入但未同步的商品清單。")).toBeTruthy();
  });

  it("renders empty state", () => {
    pendingStockMismatchesUseQueryMock.mockReturnValue({
      data: [],
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });

    render(React.createElement(PendingStockMismatchPage));

    expect(screen.getByText("目前沒有已刷入但尚未完成匯入比對或 Google 回寫的商品。")).toBeTruthy();
  });

  it("renders error state", () => {
    pendingStockMismatchesUseQueryMock.mockReturnValue({
      data: [],
      isLoading: false,
      isFetching: false,
      error: new Error("query failed"),
      refetch: vi.fn(),
    });

    render(React.createElement(PendingStockMismatchPage));

    expect(screen.getByText("清單讀取失敗：query failed")).toBeTruthy();
  });

  it("renders rows, shows Google sync status, and filters by keyword and missing field", () => {
    pendingStockMismatchesUseQueryMock.mockReturnValue({
      data: [
        {
          productId: 1,
          stockTaskId: null,
          productCode: "P-1001",
          productName: "iPhone 15 Pro",
          poNumber: null,
          vendorName: "Vendor A",
          batchNo: "BATCH-001",
          serialNumber: "SN-001",
          imei: "IMEI-001",
          importedCategoryName: null,
          importedBrandName: "Apple",
          assignedCategoryName: "智慧型手機",
          assignedBrandName: "Apple",
          currentStationCode: "A2",
          currentStatus: "pending_a2",
          stockTaskStatus: null,
          arrivalAt: "2026-04-29T01:00:00.000Z",
          stockTaskCreatedAt: null,
          updatedAt: "2026-04-29T03:00:00.000Z",
          sheetRowNumber: null,
          lastSheetSyncedAt: null,
          googleSyncStatusLabel: "尚未回寫 Google",
          flowStageLabel: "已刷入待補匯入",
          bBatterySummary: "耗電偏快",
          bFaultSummary: "藍牙異常",
          cFaultSummary: "Face ID 異常",
          cAppearanceSummary: "邊框刮傷",
          cCameraSummary: "前鏡頭模糊",
          cInspectionSummary: "Face ID 異常, 邊框刮傷, 前鏡頭模糊",
          missingFields: ["採購單號", "商品分類", "Google 回寫"],
          mismatchReason: "缺少採購單號、商品分類，已刷入系統但尚未完成匯入比對，Google 尚未回寫",
        },
        {
          productId: 2,
          stockTaskId: 11,
          productCode: "P-1002",
          productName: "Apple Watch",
          poNumber: "PO-002",
          vendorName: "Vendor B",
          batchNo: "WATCH-002",
          serialNumber: "SN-002",
          imei: "IMEI-002",
          importedCategoryName: "智慧手錶",
          importedBrandName: "Apple",
          assignedCategoryName: "智慧手錶",
          assignedBrandName: "Apple",
          currentStationCode: "STOCK",
          currentStatus: "pending_stock",
          stockTaskStatus: "pending",
          arrivalAt: "2026-04-29T01:00:00.000Z",
          stockTaskCreatedAt: "2026-04-29T02:00:00.000Z",
          updatedAt: "2026-04-29T03:00:00.000Z",
          sheetRowNumber: null,
          lastSheetSyncedAt: null,
          googleSyncStatusLabel: "尚未回寫 Google",
          flowStageLabel: "已刷入待同步",
          bBatterySummary: "正常",
          bFaultSummary: "正常",
          cFaultSummary: "正常",
          cAppearanceSummary: "正常",
          cCameraSummary: "正常",
          cInspectionSummary: "正常",
          missingFields: ["Google 回寫"],
          mismatchReason: "已刷入系統，等待背景回寫 Google",
        },
      ],
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });

    render(React.createElement(PendingStockMismatchPage));

    expect(screen.getByText("iPhone 15 Pro")).toBeTruthy();
    expect(screen.getByText("Apple Watch")).toBeTruthy();
    expect(screen.getAllByText("尚未回寫 Google").length).toBeGreaterThan(0);
    expect(screen.getByText("等待背景回寫")).toBeTruthy();
    expect(screen.getByText("B站電池：耗電偏快")).toBeTruthy();
    expect(screen.getByText("C站外觀：邊框刮傷")).toBeTruthy();

    const searchField = screen.getByText("查詢關鍵字").parentElement?.querySelector("input");
    expect(searchField).toBeTruthy();

    fireEvent.change(searchField!, {
      target: { value: "watch" },
    });

    expect(screen.queryByText("iPhone 15 Pro")).toBeNull();
    expect(screen.getByText("Apple Watch")).toBeTruthy();

    fireEvent.change(screen.getByDisplayValue("全部缺漏"), {
      target: { value: "Google 回寫" },
    });

    expect(screen.getByText("Apple Watch")).toBeTruthy();
  });
});
