/** @vitest-environment jsdom */
import React from "react";
(globalThis as any).React = React;
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jsQrMock = vi.fn();

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
const completeMutateMock = vi.fn();
const uploadEPhotoMutateAsyncMock = vi.fn().mockResolvedValue({
  success: true,
  reference: {
    mimeType: "image/jpeg",
    fileName: "test-1.jpg",
    driveFileId: "fake-drive-id",
    driveUrl: "https://drive.google.com/file/d/fake-drive-id/view",
  },
});
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

vi.mock("jsqr", () => ({
  default: (...args: unknown[]) => jsQrMock(...args),
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
      uploadEPhoto: {
        useMutation: () => ({
          isPending: false,
          mutateAsync: uploadEPhotoMutateAsyncMock,
        }),
      },
      complete: {
        useMutation: () => ({
          isPending: false,
          mutate: completeMutateMock,
        }),
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
  let getUserMediaMock: ReturnType<typeof vi.fn>;
  let cameraTrackStopMock: ReturnType<typeof vi.fn>;
  let browserGlobal: typeof globalThis & {
    window?: typeof globalThis;
    BarcodeDetector?: new (options?: { formats?: string[] }) => MockBarcodeDetectorInstance;
    requestAnimationFrame?: (callback: FrameRequestCallback) => number;
    cancelAnimationFrame?: (handle: number) => void;
  };
  let originalImage: typeof Image;
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
  let originalPlay: typeof HTMLMediaElement.prototype.play;
  let originalToDataURL: typeof HTMLCanvasElement.prototype.toDataURL;
  let originalVideoWidth: PropertyDescriptor | undefined;
  let originalVideoHeight: PropertyDescriptor | undefined;
  let originalVideoReadyState: PropertyDescriptor | undefined;
  let originalMediaDevices: MediaDevices | undefined;

  const restoreDescriptor = (target: object, key: string, descriptor?: PropertyDescriptor) => {
    if (descriptor) {
      Object.defineProperty(target, key, descriptor);
      return;
    }

    delete (target as Record<string, unknown>)[key];
  };

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    globalThis.Image = originalImage;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    HTMLCanvasElement.prototype.toDataURL = originalToDataURL;
    HTMLMediaElement.prototype.play = originalPlay;
    restoreDescriptor(HTMLVideoElement.prototype, "videoWidth", originalVideoWidth);
    restoreDescriptor(HTMLVideoElement.prototype, "videoHeight", originalVideoHeight);
    restoreDescriptor(HTMLVideoElement.prototype, "readyState", originalVideoReadyState);
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: originalMediaDevices,
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    originalImage = globalThis.Image;
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    originalPlay = HTMLMediaElement.prototype.play;
    originalVideoWidth = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, "videoWidth");
    originalVideoHeight = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, "videoHeight");
    originalVideoReadyState = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, "readyState");
    originalMediaDevices = globalThis.navigator.mediaDevices;

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
    cameraTrackStopMock = vi.fn();
    getUserMediaMock = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: cameraTrackStopMock }],
    });

    browserGlobal = globalThis as typeof globalThis & {
      window?: typeof globalThis;
      BarcodeDetector?: new (options?: { formats?: string[] }) => MockBarcodeDetectorInstance;
      requestAnimationFrame?: (callback: FrameRequestCallback) => number;
      cancelAnimationFrame?: (handle: number) => void;
    };
    browserGlobal.window = browserGlobal;
    browserGlobal.requestAnimationFrame = (callback) => {
      callback(0);
      return 1;
    };
    browserGlobal.cancelAnimationFrame = vi.fn();

    vi.stubGlobal("window", browserGlobal);
    vi.stubGlobal("createImageBitmap", createImageBitmapMock);
    vi.stubGlobal("Image", class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      width = 480;
      height = 480;

      set src(_value: string) {
        setTimeout(() => {
          this.onload?.();
        }, 0);
      }
    });

    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: getUserMediaMock },
    });
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
      configurable: true,
      get: () => 480,
    });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
      configurable: true,
      get: () => 480,
    });
    Object.defineProperty(HTMLVideoElement.prototype, "readyState", {
      configurable: true,
      get: () => HTMLMediaElement.HAVE_ENOUGH_DATA,
    });
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray(480 * 480 * 4),
      })),
    } as unknown as CanvasRenderingContext2D));
    HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "data:image/jpeg;base64,mock-photo-data");
    browserGlobal.BarcodeDetector = vi.fn(() => ({
      detect: detectMock,
    }));
    jsQrMock.mockReset();
  });

  it("opens the live camera scanner and returns to E station after detecting a QR code", async () => {
    render(React.createElement(StationPage));

    fireEvent.click(screen.getByRole("button", { name: "開啟相機掃描 QR" }));

    await waitFor(() => {
      expect(getUserMediaMock).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("E-BATCH-001")).toBeTruthy();
    });

    expect(detectMock).toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalledWith("已從 QR 辨識到 E-BATCH-001，請確認抹除完成後再推進下一站");
    await waitFor(() => {
      expect(cameraTrackStopMock).toHaveBeenCalled();
    });
  });

  it("falls back to jsQR decoding during live scan when BarcodeDetector is unavailable", async () => {
    delete browserGlobal.BarcodeDetector;
    jsQrMock.mockReturnValue({ data: "E-BATCH-001" });
    render(React.createElement(StationPage));

    fireEvent.click(screen.getByRole("button", { name: "開啟相機掃描 QR" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("E-BATCH-001")).toBeTruthy();
    });

    expect(jsQrMock).toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalledWith("已從 QR 辨識到 E-BATCH-001，請確認抹除完成後再推進下一站");
  });

  it("shows a clear error when camera access cannot be obtained", async () => {
    getUserMediaMock.mockRejectedValueOnce(new Error("無法開啟相機，請確認相機權限後再試"));
    render(React.createElement(StationPage));

    fireEvent.click(screen.getByRole("button", { name: "開啟相機掃描 QR" }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("無法開啟相機，請確認相機權限後再試");
    });
  });

  it("still supports photo upload fallback when live camera is unavailable", async () => {
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });
    delete browserGlobal.BarcodeDetector;
    jsQrMock.mockReturnValue({ data: "E-BATCH-001" });
    const { container } = render(React.createElement(StationPage));
    const captureInput = container.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement | null;

    expect(screen.getByRole("button", { name: "拍照掃描 QR" })).toBeTruthy();
    expect(captureInput).toBeTruthy();

    fireEvent.change(captureInput!, {
      target: { files: [new File(["mock-image"], "safari-qr.jpg", { type: "image/jpeg" })] },
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("E-BATCH-001")).toBeTruthy();
    });

    expect(jsQrMock).toHaveBeenCalled();
  });

  it("shows a clear error when the photo fallback cannot recognize the QR code", async () => {
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });
    delete browserGlobal.BarcodeDetector;
    jsQrMock.mockReturnValue(null);
    const { container } = render(React.createElement(StationPage));
    const captureInput = container.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement | null;

    expect(captureInput).toBeTruthy();
    fireEvent.change(captureInput!, {
      target: { files: [new File(["mock-image"], "unrecognized-qr.jpg", { type: "image/jpeg" })] },
    });

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("照片中找不到可辨識的 QR，請重新拍攝並讓 QR 置中清晰");
    });
  });

  it("shows retry upload action and allows re-upload after E station photo pre-upload failure", async () => {
    uploadEPhotoMutateAsyncMock
      .mockRejectedValueOnce(new Error("網路連線逾時"))
      .mockResolvedValueOnce({
        success: true,
        reference: {
          mimeType: "image/jpeg",
          fileName: "test-front.jpg",
          driveFileId: "retry-success-id",
          driveUrl: "https://drive.google.com/file/d/retry-success-id/view",
        },
      });

    const { container } = render(React.createElement(StationPage));
    const photoInputs = Array.from(container.querySelectorAll('input[type="file"][capture="environment"]')).slice(-2) as HTMLInputElement[];

    expect(photoInputs.length).toBe(2);
    fireEvent.change(photoInputs[0]!, {
      target: { files: [new File(["mock-image"], "front-photo.jpg", { type: "image/jpeg" })] },
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "重試上傳" })).toBeTruthy();
    });
    expect(screen.getByText("正面照片尚未同步到 Google Drive：網路連線逾時。請點「重試上傳」後再完成；若仍失敗，請重新拍照。")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "重試上傳" }));

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith("正面照片已同步到 Google Drive", {
        position: "top-center",
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "重試上傳" })).toBeNull();
    });
  });

  it("blocks E station completion when any photo has not synced successfully to Google Drive", async () => {
    uploadEPhotoMutateAsyncMock
      .mockRejectedValueOnce(new Error("Google Drive 暫時無法連線"))
      .mockResolvedValueOnce({
        success: true,
        reference: {
          mimeType: "image/jpeg",
          fileName: "test-back.jpg",
          driveFileId: "back-success-id",
          driveUrl: "https://drive.google.com/file/d/back-success-id/view",
        },
      });

    const { container } = render(React.createElement(StationPage));
    const photoInputs = Array.from(container.querySelectorAll('input[type="file"][capture="environment"]')).slice(-2) as HTMLInputElement[];

    expect(photoInputs.length).toBe(2);

    fireEvent.change(photoInputs[0]!, {
      target: { files: [new File(["mock-image"], "front-photo.jpg", { type: "image/jpeg" })] },
    });
    fireEvent.change(photoInputs[1]!, {
      target: { files: [new File(["mock-image"], "back-photo.jpg", { type: "image/jpeg" })] },
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "重試上傳" })).toBeTruthy();
    });
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith("反面照片已同步到 Google Drive", {
        position: "top-center",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "完成抹除並推進下一站" }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("正面照片尚未成功同步到 Google Drive，請先點「重試上傳」或重新拍照後再完成。", {
        position: "top-center",
      });
    });
    expect(completeMutateMock).not.toHaveBeenCalled();
  });
});
