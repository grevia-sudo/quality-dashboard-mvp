/** @vitest-environment jsdom */
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

const useRouteMock = vi.fn(() => [true, { stationCode: "C" }]);
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
  mutateAsync: vi.fn(),
});

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/station/C", setLocationMock],
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
      uploadEPhoto: {
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
    default: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  };
});

import StationPage from "../client/src/pages/StationPage";

describe("StationPage C 站承接 B 站故障點", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    productNameOptionsUseQueryMock.mockReturnValue({ data: [], isLoading: false });
    productCategoryOptionsUseQueryMock.mockReturnValue({ data: [], isLoading: false });
    stationDetailUseQueryMock.mockReturnValue({
      data: {
        label: "C 站品檢",
        tasks: [
          {
            taskId: 450225,
            productId: 390001,
            productCode: "P-1778118377731-750193",
            productName: "iPhone 測試機",
            batchNo: "00500024970",
            serialNumber: "C6KZLKJTN73D",
            imei: "353999107381929",
            poNumber: "PO-C-BFAULT-TEST",
            categoryName: "智慧手機",
            brandName: "Apple",
            subtypeCode: "iPhone",
            taskStatus: "returned",
            isOverdue: false,
            taskMetadata: {
              faultOptionIds: [40001],
              appearanceOptionIds: [40002],
              cameraOptionIds: [40003],
            },
            inheritedBFaultOptionIds: [30001],
            inheritedBFaultLabels: ["螢幕顯示"],
            inheritedBFaultSummary: "螢幕顯示",
            inheritedBatteryNote: "97%",
            inheritedBatteryIssueLabels: [],
            inheritedBatterySummary: "97%",
          },
        ],
        bFaultOptions: [
          {
            id: 30001,
            stationCode: "B",
            optionType: "fault",
            label: "螢幕顯示",
            active: true,
            sortOrder: 1,
          },
        ],
        faultOptions: [
          {
            id: 40001,
            stationCode: "C",
            optionType: "fault",
            label: "觸控異常",
            active: true,
            sortOrder: 1,
          },
        ],
        appearanceOptions: [
          {
            id: 40002,
            stationCode: "C",
            optionType: "appearance",
            label: "邊框刮傷",
            active: true,
            sortOrder: 1,
          },
        ],
        cameraOptions: [
          {
            id: 40003,
            stationCode: "C",
            optionType: "camera",
            label: "無法對焦",
            active: true,
            sortOrder: 1,
          },
        ],
      },
      isLoading: false,
      error: null,
    });
  });

  it("在 C 站切換到修改故障狀態後，會把承接自 B 站的故障點顯示為已勾選", () => {
    render(React.createElement(StationPage));

    fireEvent.change(screen.getByPlaceholderText("輸入商品批號後可快速定位 C 站待檢項目"), {
      target: { value: "00500024970" },
    });

    expect(screen.getByText("螢幕顯示")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "修改故障狀態" }));

    const checkbox = screen.getByRole("checkbox", { name: "螢幕顯示" });
    expect(checkbox.getAttribute("data-state")).toBe("checked");
  });

  it("D 站退回 C 站後，會保留上一次 C 站已勾選的故障、外觀與鏡頭狀態", () => {
    render(React.createElement(StationPage));

    fireEvent.change(screen.getByPlaceholderText("輸入商品批號後可快速定位 C 站待檢項目"), {
      target: { value: "00500024970" },
    });

    expect(screen.getByRole("checkbox", { name: "觸控異常" }).getAttribute("data-state")).toBe("checked");
    expect(screen.getByRole("checkbox", { name: "邊框刮傷" }).getAttribute("data-state")).toBe("checked");
    expect(screen.getByRole("checkbox", { name: "無法對焦" }).getAttribute("data-state")).toBe("checked");
  });
});
