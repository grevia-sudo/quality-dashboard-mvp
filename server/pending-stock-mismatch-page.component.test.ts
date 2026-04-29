// @vitest-environment jsdom
import React from "react";
(globalThis as any).React = React;
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useAuthMock = vi.fn(() => ({
  user: {
    id: 7,
    name: "Admin User",
    role: "admin",
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
    default: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
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
      user: {
        id: 7,
        name: "Admin User",
        role: "admin",
      },
    });
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

    expect(screen.getByText("正在載入未比對待入庫商品清單。")).toBeTruthy();
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

    expect(screen.getByText("目前沒有待入庫但尚未完成匯入比對的商品，表示待入庫清單已經清乾淨。")).toBeTruthy();
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

  it("renders rows and filters by keyword and missing field", () => {
    pendingStockMismatchesUseQueryMock.mockReturnValue({
      data: [
        {
          productId: 1,
          stockTaskId: 10,
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
          currentStationCode: "STOCK",
          currentStatus: "pending_stock",
          stockTaskStatus: "pending",
          arrivalAt: "2026-04-29T01:00:00.000Z",
          stockTaskCreatedAt: "2026-04-29T02:00:00.000Z",
          updatedAt: "2026-04-29T03:00:00.000Z",
          missingFields: ["採購單號", "商品分類"],
          mismatchReason: "缺少採購單號、商品分類，尚未完成匯入比對",
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
          importedBrandName: null,
          assignedCategoryName: "智慧手錶",
          assignedBrandName: "Apple",
          currentStationCode: "STOCK",
          currentStatus: "pending_stock",
          stockTaskStatus: "pending",
          arrivalAt: "2026-04-29T01:00:00.000Z",
          stockTaskCreatedAt: "2026-04-29T02:00:00.000Z",
          updatedAt: "2026-04-29T03:00:00.000Z",
          missingFields: ["品牌"],
          mismatchReason: "缺少品牌，尚未完成匯入比對",
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

    const searchField = screen.getByText("查詢關鍵字").parentElement?.querySelector("input");
    expect(searchField).toBeTruthy();

    fireEvent.change(searchField!, {
      target: { value: "watch" },
    });

    expect(screen.queryByText("iPhone 15 Pro")).toBeNull();
    expect(screen.getByText("Apple Watch")).toBeTruthy();

    fireEvent.change(screen.getByDisplayValue("全部缺漏"), {
      target: { value: "品牌" },
    });

    expect(screen.getByText("Apple Watch")).toBeTruthy();
    expect(screen.queryByText("iPhone 15 Pro")).toBeNull();
  });
});
