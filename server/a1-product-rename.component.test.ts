// @vitest-environment jsdom
import React from "react";
(globalThis as any).React = React;
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const useAuthMock = vi.fn(() => ({
  user: {
    id: 1,
    name: "A1 User",
    role: "engineer",
  },
}));
const useRouteMock = vi.fn(() => [true, { stationCode: "A1" }]);
const setLocationMock = vi.fn();
const stationDetailUseQueryMock = vi.fn();
const productNameOptionsUseQueryMock = vi.fn();
const productCategoryOptionsUseQueryMock = vi.fn();
const searchProductForRenameUseQueryMock = vi.fn();
const updateProductNameMutateMock = vi.fn();
const useUtilsMock = vi.fn(() => ({
  station: {
    detail: {
      invalidate: vi.fn(),
      setData: vi.fn(),
    },
    list: {
      invalidate: vi.fn(),
    },
    searchProductForRename: {
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

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/station/A1", setLocationMock],
  useRoute: () => useRouteMock(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
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
      searchProductForRename: {
        useQuery: (...args: unknown[]) => searchProductForRenameUseQueryMock(...args),
      },
      detail: {
        useQuery: (...args: unknown[]) => stationDetailUseQueryMock(...args),
      },
      assignCategory: {
        useMutation: () => ({ isPending: false, mutate: vi.fn() }),
      },
      complete: {
        useMutation: () => ({ isPending: false, mutate: vi.fn() }),
      },
      receive: {
        useMutation: () => ({ isPending: false, mutate: vi.fn() }),
      },
      updateProductName: {
        useMutation: () => ({ isPending: false, mutate: updateProductNameMutateMock }),
      },
      restoreToD: {
        useMutation: () => ({ isPending: false, mutate: vi.fn() }),
      },
      uploadEPhoto: {
        useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
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

const baseDetailData = {
  tasks: [],
  faultOptions: [],
  bFaultOptions: [],
  appearanceOptions: [],
  cameraOptions: [],
  recentAutoRemovedStockItems: [],
};

describe("StationPage A1 product rename", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    updateProductNameMutateMock.mockReset();
    setLocationMock.mockReset();
    stationDetailUseQueryMock.mockReturnValue({
      data: baseDetailData,
      isLoading: false,
      error: null,
    });
    productNameOptionsUseQueryMock.mockReturnValue({ data: [], isLoading: false, error: null });
    productCategoryOptionsUseQueryMock.mockReturnValue({ data: [], isLoading: false, error: null });
    searchProductForRenameUseQueryMock.mockImplementation((input: { keyword: string }) => {
      if (input.keyword === "SN-EDIT-001") {
        return {
          data: [
            {
              productId: 101,
              productCode: "P-EDIT-001",
              productName: "舊品名",
              batchNo: "BATCH-001",
              serialNumber: "SN-EDIT-001",
              imei: null,
              currentStationCode: "C",
              currentStatus: "pending_c",
              importedCategoryName: "智慧型手機",
              importedBrandName: "Apple",
              categoryName: "智慧型手機",
              brandName: "Apple",
            },
          ],
          isLoading: false,
          error: null,
        };
      }

      if (input.keyword === "SN-ERROR-001") {
        return {
          data: [],
          isLoading: false,
          error: new Error("查詢服務暫時異常"),
        };
      }

      return {
        data: [],
        isLoading: false,
        error: null,
      };
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("allows A1 users to search by serial number and trigger product name update", async () => {
    render(React.createElement(StationPage));

    const renameSearchInput = screen.getByPlaceholderText("輸入商品序號或產品代碼（品號）") as HTMLInputElement;
    fireEvent.change(renameSearchInput, { target: { value: "SN-EDIT-001" } });

    expect(await screen.findByText("P-EDIT-001")).toBeTruthy();
    const nameInput = screen.getByDisplayValue("舊品名") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "新測試品名" } });
    fireEvent.click(screen.getByRole("button", { name: "更新品名" }));

    await waitFor(() => {
      expect(updateProductNameMutateMock).toHaveBeenCalledWith({
        productId: 101,
        productName: "新測試品名",
      });
    });
  });

  it("shows a clear error state when rename search fails", async () => {
    render(React.createElement(StationPage));

    const renameSearchInput = screen.getByPlaceholderText("輸入商品序號或產品代碼（品號）") as HTMLInputElement;
    fireEvent.change(renameSearchInput, { target: { value: "SN-ERROR-001" } });

    expect(await screen.findByText("搜尋失敗：查詢服務暫時異常")).toBeTruthy();
  });
});
