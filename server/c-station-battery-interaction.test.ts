// @vitest-environment jsdom
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as any).React = React;
import { fireEvent, render, screen } from "@testing-library/react";

const stationDetailData = {
  label: "C 站品檢",
  tasks: [
    {
      taskId: 101,
      productId: 501,
      productCode: "QC-101",
      productName: "iPhone 測試機",
      categoryName: "手機",
      importedCategoryName: "手機",
      subtypeCode: "PHONE",
      batchNo: "BATCH-101",
      serialNumber: "SERIAL-101",
      imei: "IMEI-101",
      currentStationCode: "C",
      taskStatus: "pending",
      isOverdue: false,
      inheritedBFaultOptionIds: [1],
      inheritedBatteryNote: "88",
      inheritedBatteryIssueLabels: ["電池異常"],
    },
  ],
  bFaultOptions: [
    { id: 1, label: "無法開機", active: true },
    { id: 2, label: "觸控異常", active: true },
  ],
  faultOptions: [
    { id: 11, label: "亮點", active: true },
  ],
  appearanceOptions: [
    { id: 21, label: "刮傷", active: true },
  ],
};

const invalidateMock = vi.fn();
const setDataMock = vi.fn();
const mutateMock = vi.fn();

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => React.createElement(
    "div",
    null,
    React.createElement("h1", null, title),
    children,
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => React.createElement("span", null, children),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, type = "button", ...props }: any) => React.createElement(
    "button",
    { type, onClick, ...props },
    children,
  ),
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children: React.ReactNode }) => React.createElement("section", null, children),
  CardHeader: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  CardTitle: ({ children }: { children: React.ReactNode }) => React.createElement("h2", null, children),
  CardContent: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange }: any) => React.createElement("input", {
    "aria-label": "checkbox",
    type: "checkbox",
    checked: Boolean(checked),
    onChange: (event: any) => onCheckedChange?.(event.target.checked),
  }),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? React.createElement("div", null, children) : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  DialogDescription: ({ children }: { children: React.ReactNode }) => React.createElement("p", null, children),
  DialogFooter: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  DialogHeader: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  DialogTitle: ({ children }: { children: React.ReactNode }) => React.createElement("h3", null, children),
}));

vi.mock("@/components/ui/input", () => ({
  Input: ({ value, onChange, placeholder }: any) => React.createElement("input", {
    "aria-label": placeholder ?? "input",
    value,
    onChange,
    placeholder,
  }),
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => React.createElement("div", null, "loading"),
}));

vi.mock("lucide-react", () => {
  const Icon = () => React.createElement("svg", { "aria-hidden": "true" });
  return {
    Boxes: Icon,
    ClipboardCheck: Icon,
    Gauge: Icon,
    PackagePlus: Icon,
    Search: Icon,
    ShieldAlert: Icon,
    ShieldCheck: Icon,
    Undo2: Icon,
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/station/C", vi.fn()],
  useRoute: () => [true, { stationCode: "C" }],
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      station: {
        detail: {
          invalidate: invalidateMock,
          setData: setDataMock,
        },
        list: {
          invalidate: invalidateMock,
        },
      },
      dashboard: {
        home: {
          invalidate: invalidateMock,
        },
      },
    }),
    station: {
      productNameOptions: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
      productCategoryOptions: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
      detail: {
        useQuery: () => ({ data: stationDetailData, isLoading: false }),
      },
      assignCategory: {
        useMutation: () => ({ isPending: false, mutate: mutateMock }),
      },
      complete: {
        useMutation: () => ({ isPending: false, mutate: mutateMock }),
      },
      receive: {
        useMutation: () => ({ isPending: false, mutate: mutateMock }),
      },
    },
  },
}));

import StationPage from "../client/src/pages/StationPage";

describe("C 站電池檢測互動", () => {
  beforeEach(() => {
    invalidateMock.mockReset();
    setDataMock.mockReset();
    mutateMock.mockReset();
  });

  it("預設只顯示電池摘要，按下修改後才出現可編輯欄位", () => {
    render(React.createElement(StationPage));

    expect(screen.getByText("88, 電池異常")).toBeTruthy();
    expect(screen.queryByText("檢測回覆")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "修改電池檢測" }));

    expect(screen.getByText("檢測回覆")).toBeTruthy();
    expect(screen.getByDisplayValue("88")).toBeTruthy();
    expect(screen.getByText("電池異常")).toBeTruthy();
  });
});
