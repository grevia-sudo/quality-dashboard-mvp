// @vitest-environment jsdom
import React from "react";
(globalThis as any).React = React;
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useAuthMock = vi.fn(() => ({
  user: {
    id: 7,
    name: "Admin User",
    role: "admin",
  },
  loading: false,
}));

const setLocationMock = vi.fn();
const samplingQueueUseQueryMock = vi.fn();
const stationDetailUseQueryMock = vi.fn();
const productCategoryOptionsUseQueryMock = vi.fn();
const useUtilsMock = vi.fn(() => ({
  sampling: {
    queue: {
      invalidate: vi.fn(),
    },
  },
  station: {
    detail: {
      invalidate: vi.fn(),
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
}));

const mutationMockFactory = () => ({
  isPending: false,
  mutate: vi.fn(),
});

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: (...args: unknown[]) => useAuthMock(...args),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/sampling", setLocationMock],
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => useUtilsMock(),
    sampling: {
      queue: {
        useQuery: (...args: unknown[]) => samplingQueueUseQueryMock(...args),
      },
      submit: {
        useMutation: () => mutationMockFactory(),
      },
    },
    station: {
      detail: {
        useQuery: (...args: unknown[]) => stationDetailUseQueryMock(...args),
      },
      productCategoryOptions: {
        useQuery: (...args: unknown[]) => productCategoryOptionsUseQueryMock(...args),
      },
      assignCategory: {
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

import SamplingPage from "../client/src/pages/SamplingPage";

describe("SamplingPage D station list layout", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    productCategoryOptionsUseQueryMock.mockReturnValue({ data: [], isLoading: false, error: null });

    samplingQueueUseQueryMock.mockReturnValue({
      data: {
        tasks: [
          {
            taskId: 101,
            productId: 501,
            productCode: "P-D-101",
            productName: "iPhone 15 128GB",
            batchNo: "BATCH-PENDING-001",
            serialNumber: "SN-PENDING-001",
            imei: "IMEI-PENDING-001",
            categoryName: "智慧手機",
            brandName: "Apple",
            importedCategoryName: "智慧手機",
            importedBrandName: "Apple",
            subtypeCode: "iPhone",
            inheritedBatterySummary: "蓄電異常",
            inheritedBFaultSummary: "Face ID 異常",
            inheritedCFaultSummary: "螢幕刮傷",
            inheritedCAppearanceSummary: "機身磨損",
            inheritedCCameraSummary: "正常",
          },
        ],
      },
      isLoading: false,
      error: null,
    });

    stationDetailUseQueryMock.mockReturnValue({
      data: {
        faultOptions: [],
        appearanceOptions: [],
        cameraOptions: [],
        bFaultOptions: [],
        dTodayCompletedTasks: [
          {
            taskId: 102,
            productId: 502,
            productCode: "P-D-102",
            productName: "iPhone 14 256GB",
            batchNo: "BATCH-COMPLETED-001",
            serialNumber: "SN-COMPLETED-001",
            imei: "IMEI-COMPLETED-001",
            categoryName: "智慧手機",
            brandName: "Apple",
            importedCategoryName: "智慧手機",
            importedBrandName: "Apple",
            subtypeCode: "iPhone",
            inheritedBatterySummary: "85%",
            inheritedBFaultSummary: "已改為正常",
            inheritedCFaultSummary: "正常",
            inheritedCAppearanceSummary: "已改為正常",
            inheritedCCameraSummary: "鏡頭入塵",
          },
        ],
      },
      isLoading: false,
      error: null,
    });
  });

  it("keeps searched case as original detail card and shows separate pending/completed tables below", () => {
    render(React.createElement(SamplingPage));

    expect(screen.getByText("當日未完成清單")).toBeTruthy();
    expect(screen.getByText("當日已完成清單")).toBeTruthy();
    expect(screen.getByText("BATCH-PENDING-001")).toBeTruthy();
    expect(screen.getByText("BATCH-COMPLETED-001")).toBeTruthy();
    expect(screen.getByText("電池：蓄電異常｜功能：Face ID 異常")).toBeTruthy();
    expect(screen.getByText("功能：正常｜外觀：已改為正常｜相機：鏡頭入塵")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("輸入商品批號、商品序號或產品編號"), {
      target: { value: "BATCH-PENDING-001" },
    });

    expect(screen.getByText("全檢通過，送往 E 站")).toBeTruthy();
    expect(screen.getByText("全檢不通過，返工回 C 站")).toBeTruthy();
    expect(screen.getAllByText("iPhone 15 128GB").length).toBeGreaterThan(0);
    expect(screen.getByText("當日未完成清單")).toBeTruthy();
    expect(screen.getByText("當日已完成清單")).toBeTruthy();
  });

  it("prefills C-station checkboxes in D station from task metadata option ids", () => {
    samplingQueueUseQueryMock.mockReturnValue({
      data: {
        tasks: [
          {
            taskId: 201,
            productId: 601,
            productCode: "P-D-201",
            productName: "iPhone 13 128GB",
            batchNo: "BATCH-PREFILL-001",
            serialNumber: "SN-PREFILL-001",
            imei: "IMEI-PREFILL-001",
            categoryName: "智慧手機",
            brandName: "Apple",
            importedCategoryName: "智慧手機",
            importedBrandName: "Apple",
            subtypeCode: "iPhone",
            inheritedBatterySummary: "正常",
            inheritedBFaultSummary: "正常",
            inheritedCFaultSummary: "摘要文字故意不同",
            inheritedCAppearanceSummary: "另一個摘要",
            inheritedCCameraSummary: "正常",
            taskMetadata: {
              faultOptionIds: [9001],
              appearanceOptionIds: [9102],
              cameraOptionIds: [9201],
            },
          },
        ],
      },
      isLoading: false,
      error: null,
    });

    stationDetailUseQueryMock.mockReturnValue({
      data: {
        faultOptions: [
          { id: 9001, label: "螢幕亮點", active: true },
          { id: 9002, label: "螢幕刮傷", active: true },
        ],
        appearanceOptions: [
          { id: 9101, label: "邊框磨損", active: true },
          { id: 9102, label: "破裂", active: true },
        ],
        cameraOptions: [
          { id: 9201, label: "鏡頭入塵", active: true },
          { id: 9202, label: "鏡頭刮傷", active: true },
        ],
        bFaultOptions: [],
        dTodayCompletedTasks: [],
      },
      isLoading: false,
      error: null,
    });

    render(React.createElement(SamplingPage));

    fireEvent.change(screen.getByPlaceholderText("輸入商品批號、商品序號或產品編號"), {
      target: { value: "BATCH-PREFILL-001" },
    });

    fireEvent.click(screen.getByRole("button", { name: "修改 C 站結果" }));

    expect(within(screen.getByText("螢幕亮點").closest("label") as HTMLElement).getByRole("checkbox").getAttribute("data-state")).toBe("checked");
    expect(within(screen.getByText("破裂").closest("label") as HTMLElement).getByRole("checkbox").getAttribute("data-state")).toBe("checked");
    expect(within(screen.getByText("鏡頭入塵").closest("label") as HTMLElement).getByRole("checkbox").getAttribute("data-state")).toBe("checked");
    expect(within(screen.getByText("螢幕刮傷").closest("label") as HTMLElement).getByRole("checkbox").getAttribute("data-state")).toBe("unchecked");
    expect(within(screen.getByText("邊框磨損").closest("label") as HTMLElement).getByRole("checkbox").getAttribute("data-state")).toBe("unchecked");
  });
});
