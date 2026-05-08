// @vitest-environment jsdom
import React from "react";
(globalThis as any).React = React;
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockBarcodeDetectorInstance = {
  detect: ReturnType<typeof vi.fn>;
};

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const useAuthMock = vi.fn(() => ({
  user: {
    id: 8,
    name: "E Station User",
    role: "engineer",
  },
}));
const useRouteMock = vi.fn(() => [true, { stationCode: "E" }]);
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
  useLocation: () => ["/station/E", setLocationMock],
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

describe("StationPage E 站 QR camera scan", () => {
  let detectMock: ReturnType<typeof vi.fn>;
  let createImageBitmapMock: ReturnType<typeof vi.fn>;
  let mockBitmap: { close: ReturnType<typeof vi.fn> };
  let browserGlobal: typeof globalThis & {
    window?: typeof globalThis;
    BarcodeDetector?: new (options?: { formats?: string[] }) => MockBarcodeDetectorInstance;
    requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  };

  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    productNameOptionsUseQueryMock.mockReturnValue({ data: [], isLoading: false });
    productCategoryOptionsUseQueryMock.mockReturnValue({ data: [], isLoading: false });
    stationDetailUseQueryMock.mockReturnValue({
      data: {
        label: "E 站抹除",
        tasks: [
          {
            taskId: 901,
            productId: 1001,
            productCode: "P-1001",
            productName: "iPhone 15 Pro",
            batchNo: "E-BATCH-001",
            serialNumber: "SN-1001",
            imei: "IMEI-1001",
            poNumber: "PO-20260508-01",
            taskStatus: "pending",
            isOverdue: false,
          },
        ],
        recentAutoRemovedStockItems: [],
        faultOptions: [],
        appearanceOptions: [],
        cameraOptions: [],
        bFaultOptions: [],
      },
      isLoading: false,
      error: null,
    });

    detectMock = vi.fn().mockResolvedValue([{ rawValue: "E-BATCH-001" }]);
    mockBitmap = { close: vi.fn() };
    createImageBitmapMock = vi.fn().mockResolvedValue(mockBitmap);

    browserGlobal = globalThis as typeof globalThis & {
      window?: typeof globalThis;
      BarcodeDetector?: new (options?: { formats?: string[] }) => MockBarcodeDetectorInstance;
      requestAnimationFrame?: (callback: FrameRequestCallback) => number;
    };
    browserGlobal.window = browserGlobal;
    browserGlobal.requestAnimationFrame = (callback) => {
      callback(0);
      return 0;
    };

    vi.stubGlobal("window", browserGlobal);
    vi.stubGlobal("createImageBitmap", createImageBitmapMock);
    browserGlobal.BarcodeDetector = vi.fn(() => ({
      detect: detectMock,
    }));
  });

  it("fills the E station scan input after taking a QR photo", async () => {
    const { container } = render(React.createElement(StationPage));

    expect(screen.getByText("拍照掃描 QR")).toBeTruthy();
    const captureInput = container.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement | null;
    expect(captureInput).toBeTruthy();

    const file = new File(["mock-image"], "qr.jpg", { type: "image/jpeg" });
    fireEvent.change(captureInput!, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByDisplayValue("E-BATCH-001")).toBeTruthy();
    });

    expect(createImageBitmapMock).toHaveBeenCalledWith(file);
    expect(detectMock).toHaveBeenCalled();
    expect(mockBitmap.close).toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalledWith("已從 QR 辨識到 E-BATCH-001，請確認抹除完成後再推進下一站");
  });

  it("shows a clear error when the QR photo cannot be recognized", async () => {
    detectMock.mockResolvedValueOnce([]);
    const { container } = render(React.createElement(StationPage));
    const captureInput = container.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement | null;
    expect(captureInput).toBeTruthy();

    fireEvent.change(captureInput!, {
      target: { files: [new File(["mock-image"], "blurred-qr.jpg", { type: "image/jpeg" })] },
    });

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("照片中找不到可辨識的 QR，請重新拍攝並讓 QR 置中清晰");
    });
  });

  it("falls back to manual input guidance when the browser does not support BarcodeDetector", () => {
    delete browserGlobal.BarcodeDetector;
    render(React.createElement(StationPage));

    expect(screen.getByText("目前瀏覽器不支援拍照辨識 QR，請改用掃碼槍或手動輸入批號。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "拍照掃描 QR" }));
    expect(toastErrorMock).toHaveBeenCalledWith("目前裝置不支援拍照辨識 QR，請改用支援 Chromium 的手持裝置，或先以掃碼槍輸入批號");
  });
});
