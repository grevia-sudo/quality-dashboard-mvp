// @vitest-environment jsdom
import React from "react";
(globalThis as any).React = React;
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setLocationMock = vi.fn();
const useAuthMock = vi.fn();
const stationDetailUseQueryMock = vi.fn();
const productNameOptionsUseQueryMock = vi.fn();
const deletePoMutateMock = vi.fn();
const importMutateMock = vi.fn();

vi.mock("wouter", () => ({
  useLocation: () => ["/import", setLocationMock],
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: (...args: unknown[]) => useAuthMock(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
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

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      station: {
        list: { invalidate: vi.fn() },
        detail: { invalidate: vi.fn() },
      },
      dashboard: {
        home: { invalidate: vi.fn() },
      },
    }),
    station: {
      productNameOptions: {
        useQuery: (...args: unknown[]) => productNameOptionsUseQueryMock(...args),
      },
      detail: {
        useQuery: (...args: unknown[]) => stationDetailUseQueryMock(...args),
      },
      importBatch: {
        useMutation: () => ({
          mutate: importMutateMock,
          isPending: false,
        }),
      },
    },
    admin: {
      deleteImportedPurchaseOrder: {
        useMutation: () => ({
          mutate: deletePoMutateMock,
          isPending: false,
        }),
      },
    },
  },
}));

import ImportPage from "../client/src/pages/ImportPage";

function createPendingTask(poNumber: string) {
  return {
    productId: 101,
    productCode: "P-101",
    productName: "iPhone 15 Pro",
    batchNo: "BATCH-101",
    serialNumber: "SN-101",
    imei: "IMEI-101",
    poNumber,
    categoryName: "智慧型手機",
    importedCategoryName: "智慧型手機",
    importedBrandName: "Apple",
    brandName: "Apple",
  };
}

describe("ImportPage purchase-order delete access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    productNameOptionsUseQueryMock.mockReturnValue({
      data: [],
      isLoading: false,
      refetch: vi.fn(),
    });
    stationDetailUseQueryMock.mockReturnValue({
      data: {
        tasks: [createPendingTask("PO-20260430-05")],
        poDeletionLogs: [
          {
            id: 91,
            poNumber: "PO-20260429-09",
            vendorName: "悠優",
            deletedProducts: 12,
            deletedTasks: 12,
            deletedByName: "佳珉",
            createdAt: "2026-05-01T11:30:00.000Z",
          },
        ],
      },
      isLoading: false,
      refetch: vi.fn(),
    });
    vi.stubGlobal("confirm", vi.fn(() => true));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows deletion record columns and lets admin delete purchase orders", () => {
    useAuthMock.mockReturnValue({
      loading: false,
      user: {
        id: 1,
        name: "Admin User",
        role: "admin",
      },
    });

    render(React.createElement(ImportPage));

    expect(screen.getByText("刪除操作紀錄")).toBeTruthy();
    expect(screen.getByText("操作者")).toBeTruthy();
    expect(screen.getByText("佳珉")).toBeTruthy();
    expect(screen.getByText(/已刪除 12 筆商品／12 筆任務/)).toBeTruthy();

    const deleteButton = screen.getByRole("button", { name: "刪除" });
    expect(deleteButton).toBeTruthy();
    fireEvent.click(deleteButton);

    expect(globalThis.confirm).toHaveBeenCalled();
    expect(deletePoMutateMock).toHaveBeenCalledWith({ poNumber: "PO-20260430-05" });
  });

  it("hides delete action for non-admin management users", () => {
    useAuthMock.mockReturnValue({
      loading: false,
      user: {
        id: 2,
        name: "Manager User",
        role: "manager",
      },
    });

    render(React.createElement(ImportPage));

    expect(screen.queryByRole("button", { name: "刪除" })).toBeNull();
    expect(screen.getByText("PO-20260430-05")).toBeTruthy();
    expect(screen.getByText("操作者")).toBeTruthy();
    expect(screen.getByText("佳珉")).toBeTruthy();
  });
});
