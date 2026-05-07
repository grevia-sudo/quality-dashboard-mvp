// @vitest-environment jsdom
import React from "react";
(globalThis as any).React = React;
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useAuthMock = vi.fn(() => ({
  user: {
    id: 7,
    name: "Admin User",
    role: "admin",
  },
}));

const useRouteMock = vi.fn(() => [true, { stationCode: "stock" }]);
const setLocationMock = vi.fn();
const stationDetailUseQueryMock = vi.fn();
const productNameOptionsUseQueryMock = vi.fn();
const productCategoryOptionsUseQueryMock = vi.fn();
const useUtilsMock = vi.fn(() => ({
  station: {
    detail: {
      invalidate: vi.fn(),
      setData: vi.fn(),
    },
    list: {
      invalidate: vi.fn(),
    },
  },
  dashboard: {
    home: {
      invalidate: vi.fn(),
    },
  },
  sampling: {
    queue: {
      invalidate: vi.fn(),
    },
  },
}));

const mutationMockFactory = () => ({
  isPending: false,
  mutate: vi.fn(),
});

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/station/stock", setLocationMock],
  useRoute: () => useRouteMock(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => useUtilsMock(),
    station: {
      productNameOptions: {
        useQuery: (...args: unknown[]) => productNameOptionsUseQueryMock(...args),
      },
      productCategoryOptions: {
        useQuery: (...args: unknown[]) => productCategoryOptionsUseQueryMock(...args),
      },
      detail: {
        useQuery: (...args: unknown[]) => stationDetailUseQueryMock(...args),
      },
      assignCategory: {
        useMutation: () => mutationMockFactory(),
      },
      complete: {
        useMutation: () => mutationMockFactory(),
      },
      receive: {
        useMutation: () => mutationMockFactory(),
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

import StationPage from "../client/src/pages/StationPage";

describe("StationPage stock detail component", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    productNameOptionsUseQueryMock.mockReturnValue({ data: [], isLoading: false });
    productCategoryOptionsUseQueryMock.mockReturnValue({ data: [], isLoading: false });
    stationDetailUseQueryMock.mockReturnValue({
      data: {
        label: "待入庫",
        tasks: [
          {
            taskId: 801,
            productId: 901,
            productCode: "P-901",
            productName: "iPhone 15 Pro",
            batchNo: "BATCH-901",
            serialNumber: "SN-901",
            imei: "IMEI-901",
            poNumber: "PO-901",
            categoryName: "智慧手機",
            brandName: "Apple",
            importedCategoryName: "智慧手機",
            importedBrandName: "Apple",
            subtypeCode: "iPhone",
            taskStatus: "pending",
            isOverdue: false,
          },
        ],
        recentAutoRemovedStockItems: [
          {
            taskId: 802,
            productId: 902,
            productCode: "P-902",
            productName: "iPhone 14",
            batchNo: "BATCH-902",
            serialNumber: "SN-902",
            imei: "IMEI-902",
            completedAt: "2026-05-07T09:00:00.000Z",
            resultSummary: "外部進貨明細批號比對成功，自動移除待入庫",
          },
        ],
      },
      isLoading: false,
      error: null,
    });
  });

  it("renders stock detail preview cards and keeps auto-removed items in a separate section", () => {
    render(React.createElement(StationPage));

    expect(screen.getByText("待入庫詳細清單")).toBeTruthy();
    expect(screen.getAllByText("iPhone 15 Pro").length).toBeGreaterThan(0);
    expect(screen.getByText("產品代碼：P-901")).toBeTruthy();
    expect(screen.getAllByText("匯出 CSV").length).toBeGreaterThan(0);
    expect(screen.getByText("最近自動移除待入庫")).toBeTruthy();
    expect(screen.getByText("iPhone 14")).toBeTruthy();
    expect(screen.getByText("外部進貨明細批號比對成功，自動移除待入庫")).toBeTruthy();
    expect(screen.getByTestId("dashboard-nav").textContent).toContain("匯入作業");
    expect(screen.getByTestId("dashboard-nav").textContent).toContain("待入庫待比對");
  });
});
