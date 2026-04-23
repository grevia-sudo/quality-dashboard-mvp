import DashboardLayout, { type DashboardNavItem } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { Boxes, ClipboardCheck, Gauge, PackagePlus, Search, ShieldCheck, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation, useRoute } from "wouter";

const navItems: DashboardNavItem[] = [
  { label: "站點總覽", path: "/operations", icon: Boxes },
  { label: "匯入作業", path: "/import", icon: PackagePlus },
  { label: "D 站抽樣", path: "/sampling", icon: ClipboardCheck },
  { label: "工程師 KPI", path: "/kpi", icon: Gauge },
  { label: "管理後台", path: "/admin", icon: ShieldCheck },
];

const stationCodes = ["A1", "A2", "B", "C", "E", "STOCK"] as const;
type StationCode = (typeof stationCodes)[number];

type BatteryIssueLabel = (typeof B_BATTERY_ISSUE_OPTIONS)[number];

type OptionSelections = {
  faultOptionIds: number[];
  appearanceOptionIds: number[];
  cameraOptionIds: number[];
  bFaultOptionIds: number[];
  batteryNote: string;
  batteryIssueLabels: BatteryIssueLabel[];
  isEditingBFaults: boolean;
  hasOpenedBFaultEditor: boolean;
  hasOpenedBatteryEditor: boolean;
};

const defaultSelections = (): OptionSelections => ({
  faultOptionIds: [],
  appearanceOptionIds: [],
  cameraOptionIds: [],
  bFaultOptionIds: [],
  batteryNote: "",
  batteryIssueLabels: [],
  isEditingBFaults: false,
  hasOpenedBFaultEditor: false,
  hasOpenedBatteryEditor: false,
});

const normalizeIdList = (values: number[]) => Array.from(new Set(values)).sort((left, right) => left - right);
const normalizeTextList = (values: string[]) => Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right, "zh-Hant"));
const summarizeTextResult = (values: string[]) => values.map((value) => value.trim()).filter(Boolean).join(", ") || "正常";

const B_BATTERY_ISSUE_OPTIONS = ["電池膨脹", "副廠電池", "電池異常"] as const;

export function normalizeStationCodeParam(value?: string | null): StationCode | null {
  if (!value) return null;

  const normalized = value.replace(/^:/, "").trim().toUpperCase();
  return stationCodes.includes(normalized as StationCode) ? (normalized as StationCode) : null;
}

export default function StationPage() {
  const [, params] = useRoute<{ stationCode: string }>("/station/:stationCode");
  const rawStationCode = params?.stationCode;
  const normalizedStationCode = normalizeStationCodeParam(rawStationCode);
  const stationCode = normalizedStationCode ?? "A1";
  const [, setLocation] = useLocation();
  const [keyword, setKeyword] = useState("");
  const [arrivalForm, setArrivalForm] = useState({
    batchNo: "",
    serialNumber: "",
    imei: "",
    productName: "",
  });
  const [selectedOptions, setSelectedOptions] = useState<Record<number, OptionSelections>>({});
  const [productNamePickerOpen, setProductNamePickerOpen] = useState(false);
  const [batteryDialogTaskId, setBatteryDialogTaskId] = useState<number | null>(null);
  const batchNoInputRef = useRef<HTMLInputElement | null>(null);
  const quickScanInputRef = useRef<HTMLInputElement | null>(null);
  const utils = trpc.useUtils();
  const productNameOptionsQuery = trpc.station.productNameOptions.useQuery(undefined, {
    retry: false,
  });
  const detailQuery = trpc.station.detail.useQuery(
    { stationCode },
    {
      retry: false,
    },
  );
  const productNameOptions = productNameOptionsQuery.data ?? [];

  const invalidateStationData = async () => {
    await utils.station.detail.invalidate({ stationCode });
    await utils.station.list.invalidate();
    await utils.dashboard.home.invalidate();
  };

  const refreshA1StationDataInBackground = () => {
    void utils.station.detail.invalidate({ stationCode: "A1" });
    void utils.station.detail.invalidate({ stationCode: "A2" });
    void utils.station.list.invalidate();
    void utils.dashboard.home.invalidate();
  };

  const refreshStationDataInBackground = (currentStationCode: StationCode, nextStationCode?: StationCode | "D" | null) => {
    void utils.station.detail.invalidate({ stationCode: currentStationCode });
    if (nextStationCode) {
      void utils.station.detail.invalidate({ stationCode: nextStationCode });
    }
    void utils.station.list.invalidate();
    void utils.dashboard.home.invalidate();
  };

  const removeCompletedTaskFromCache = (currentStationCode: StationCode, productId?: number | null) => {
    if (!productId) {
      return;
    }

    utils.station.detail.setData({ stationCode: currentStationCode }, (current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        tasks: current.tasks.filter((task) => task.productId !== productId),
      };
    });
  };

  const focusBatchInput = () => {
    window.requestAnimationFrame(() => {
      batchNoInputRef.current?.focus();
      batchNoInputRef.current?.select();
    });
  };

  const focusQuickScanInput = () => {
    window.requestAnimationFrame(() => {
      quickScanInputRef.current?.focus();
      quickScanInputRef.current?.select();
    });
  };

  const playA2SuccessTone = () => {
    if (typeof window === "undefined") {
      return;
    }

    const AudioContextConstructor = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextConstructor) {
      return;
    }

    const audioContext = new AudioContextConstructor();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    const startTime = audioContext.currentTime;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(1046.5, startTime);
    oscillator.frequency.exponentialRampToValueAtTime(1318.5, startTime + 0.12);

    gainNode.gain.setValueAtTime(0.0001, startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.16, startTime + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.18);

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.start(startTime);
    oscillator.stop(startTime + 0.2);
    oscillator.onended = () => {
      void audioContext.close().catch(() => undefined);
    };
  };

  const submitA1Receive = () => {
    if (receiveMutation.isPending || !canReceiveA1) {
      return;
    }

    receiveMutation.mutate({
      batchNo: arrivalForm.batchNo.trim() || undefined,
      serialNumber: arrivalForm.serialNumber.trim() || undefined,
      imei: arrivalForm.imei.trim() || undefined,
      productName: arrivalForm.productName.trim() || undefined,
    });
  };

  const handleA1ScanSubmitKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    submitA1Receive();
  };

  const submitA2ScanComplete = () => {
    if (stationCode !== "A2" || completeMutation.isPending) {
      return;
    }

    const normalizedScanValue = keyword.trim().toLowerCase();
    if (!normalizedScanValue) {
      return;
    }

    const matchedTask = (detailQuery.data?.tasks ?? []).find((task) => (
      [task.batchNo, task.productCode, task.serialNumber, task.imei]
        .filter((candidate): candidate is string => Boolean(candidate?.trim()))
        .some((candidate) => candidate.trim().toLowerCase() === normalizedScanValue)
    ));

    if (!matchedTask) {
      toast.error("找不到符合的 A2 待處理商品");
      focusQuickScanInput();
      return;
    }

    completeMutation.mutate({
      taskId: matchedTask.taskId,
      stationCode: "A2",
      productId: matchedTask.productId,
      categoryId: undefined,
      subtypeCode: matchedTask.subtypeCode ?? null,
      summary: `${detailQuery.data?.label ?? "A2 安裝"} 掃碼完成`,
    });
  };

  const handleStationScanInputKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (stationCode !== "A2" || event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    submitA2ScanComplete();
  };

  const completeMutation = trpc.station.complete.useMutation({
    onSuccess: (_result, variables) => {
      setSelectedOptions({});

      if (variables.stationCode === "A2") {
        removeCompletedTaskFromCache("A2", variables.productId);
        setKeyword("");
        playA2SuccessTone();
        toast.success("A2 已完成並推進下一站，請直接掃描下一筆");
        focusQuickScanInput();
        refreshStationDataInBackground("A2", "B");
        return;
      }

      if (variables.stationCode === "B") {
        removeCompletedTaskFromCache("B", variables.productId);
        setBatteryDialogTaskId(null);
        setKeyword("");
        toast.success("B 站軟體測試已完成並推進下一站，請直接輸入下一筆批號");
        focusQuickScanInput();
        refreshStationDataInBackground("B", "C");
        return;
      }

      if (variables.stationCode === "C") {
        removeCompletedTaskFromCache("C", variables.productId);
        setBatteryDialogTaskId(null);
        setKeyword("");
        toast.success("C 站品檢已完成並推進下一站，請直接輸入下一筆批號");
        focusQuickScanInput();
        refreshStationDataInBackground("C", "D");
        return;
      }

      toast.success("站點作業已完成");
      void invalidateStationData();
    },
    onError: (error) => {
      toast.error(error.message || "站點作業更新失敗");
    },
  });

  const receiveMutation = trpc.station.receive.useMutation({
    onSuccess: (result) => {
      if (!result.success) {
        toast.error(result.message || "A1 點到貨處理失敗");
        return;
      }

      removeCompletedTaskFromCache("A1", result.productId);
      toast.success(`${result.productCode ?? "商品"} 已完成 A1 點到貨，請直接掃描下一筆`);
      setProductNamePickerOpen(false);
      setArrivalForm({ batchNo: "", serialNumber: "", imei: "", productName: "" });
      focusBatchInput();
      refreshA1StationDataInBackground();
    },
    onError: (error) => {
      toast.error(error.message || "A1 點到貨處理失敗");
      setProductNamePickerOpen(false);
      focusBatchInput();
    },
  });

  useEffect(() => {
    if (!rawStationCode || rawStationCode !== stationCode) {
      setLocation(`/station/${stationCode}`);
    }
  }, [rawStationCode, setLocation, stationCode]);

  useEffect(() => {
    if (stationCode === "A1" && !detailQuery.isLoading) {
      focusBatchInput();
    }

    if ((stationCode === "A2" || stationCode === "B" || stationCode === "C") && !detailQuery.isLoading) {
      focusQuickScanInput();
    }
  }, [detailQuery.isLoading, stationCode]);

  useEffect(() => {
    setSelectedOptions((prev) => {
      const tasks = detailQuery.data?.tasks ?? [];
      let changed = false;
      const next = { ...prev };

      for (const task of tasks) {
        if (next[task.taskId]) {
          continue;
        }

        const carryoverTask = task as typeof task & {
          inheritedBFaultOptionIds?: number[];
          inheritedBatteryNote?: string;
          inheritedBatteryIssueLabels?: BatteryIssueLabel[];
        };

        next[task.taskId] = {
          faultOptionIds: [],
          appearanceOptionIds: [],
          cameraOptionIds: [],
          bFaultOptionIds: carryoverTask.inheritedBFaultOptionIds ?? [],
          batteryNote: carryoverTask.inheritedBatteryNote ?? "",
          batteryIssueLabels: carryoverTask.inheritedBatteryIssueLabels ?? [],
          isEditingBFaults: false,
          hasOpenedBFaultEditor: false,
          hasOpenedBatteryEditor: false,
        };
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [detailQuery.data?.tasks]);

  const filteredTasks = useMemo(() => {
    const tasks = detailQuery.data?.tasks ?? [];
    return tasks.filter((task) => {
      const text = `${task.productCode} ${task.productName ?? ""} ${task.batchNo ?? ""} ${task.serialNumber ?? ""} ${task.imei ?? ""}`.toLowerCase();
      return text.includes(keyword.toLowerCase());
    });
  }, [detailQuery.data?.tasks, keyword]);

  const filteredProductNameOptions = useMemo(() => {
    const normalizedKeyword = arrivalForm.productName.trim().toLowerCase();
    if (!normalizedKeyword) {
      return productNameOptions.slice(0, 20);
    }

    return productNameOptions
      .filter((option) => option.label.toLowerCase().includes(normalizedKeyword))
      .slice(0, 20);
  }, [arrivalForm.productName, productNameOptions]);

  const pendingCategorySummary = useMemo(() => {
    const summaryMap = new Map<string, { label: string; count: number }>();

    for (const task of detailQuery.data?.tasks ?? []) {
      const label = task.categoryName ?? task.importedCategoryName ?? task.subtypeCode ?? "未分類";
      const current = summaryMap.get(label);
      summaryMap.set(label, {
        label,
        count: (current?.count ?? 0) + 1,
      });
    }

    return Array.from(summaryMap.values()).sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.label.localeCompare(right.label, "zh-Hant");
    });
  }, [detailQuery.data?.tasks]);

  const pendingTotalCount = detailQuery.data?.tasks.length ?? 0;

  const toggleSelection = (taskId: number, key: "faultOptionIds" | "appearanceOptionIds" | "cameraOptionIds" | "bFaultOptionIds", optionId: number, checked: boolean) => {
    setSelectedOptions((prev) => {
      const current = prev[taskId] ?? defaultSelections();
      const currentList = current[key];
      const nextList = checked ? Array.from(new Set([...currentList, optionId])) : currentList.filter((id) => id !== optionId);

      return {
        ...prev,
        [taskId]: {
          ...current,
          [key]: nextList,
        },
      };
    });
  };

  const updateBatteryNote = (taskId: number, nextValue: string) => {
    setSelectedOptions((prev) => {
      const current = prev[taskId] ?? defaultSelections();
      return {
        ...prev,
        [taskId]: {
          ...current,
          batteryNote: nextValue,
        },
      };
    });
  };

  const toggleBatteryIssueLabel = (taskId: number, label: BatteryIssueLabel, checked: boolean) => {
    setSelectedOptions((prev) => {
      const current = prev[taskId] ?? defaultSelections();
      const nextLabels = checked
        ? Array.from(new Set([...current.batteryIssueLabels, label]))
        : current.batteryIssueLabels.filter((item) => item !== label);

      return {
        ...prev,
        [taskId]: {
          ...current,
          batteryIssueLabels: nextLabels,
        },
      };
    });
  };

  const getTaskSelections = (taskId: number) => selectedOptions[taskId] ?? defaultSelections();

  const setBFaultEditing = (taskId: number, isEditingBFaults: boolean) => {
    setSelectedOptions((prev) => {
      const current = prev[taskId] ?? defaultSelections();
      return {
        ...prev,
        [taskId]: {
          ...current,
          isEditingBFaults,
          hasOpenedBFaultEditor: current.hasOpenedBFaultEditor || isEditingBFaults,
        },
      };
    });
  };

  const openBatteryEditor = (taskId: number) => {
    setSelectedOptions((prev) => {
      const current = prev[taskId] ?? defaultSelections();
      return {
        ...prev,
        [taskId]: {
          ...current,
          hasOpenedBatteryEditor: true,
        },
      };
    });
    setBatteryDialogTaskId(taskId);
  };

  const submitStationCompletion = (task: (typeof filteredTasks)[number]) => {
    const selections = getTaskSelections(task.taskId);
    const basePayload = {
      taskId: task.taskId,
      stationCode,
      productId: task.productId,
      categoryId: undefined,
      subtypeCode: task.subtypeCode ?? null,
      summary: stationCode === "B" ? "B 站軟體測試完成" : stationCode === "C" ? "C 站品檢完成" : `${detailQuery.data?.label} 完成`,
      faultOptionIds: selections.faultOptionIds,
      appearanceOptionIds: selections.appearanceOptionIds,
      cameraOptionIds: selections.cameraOptionIds,
    };

    if (stationCode === "B") {
      completeMutation.mutate({
        ...basePayload,
        batteryNote: selections.batteryNote,
        batteryIssueLabels: selections.batteryIssueLabels,
      });
      return;
    }

    if (stationCode === "C") {
      const carryoverTask = task as typeof task & {
        inheritedBFaultOptionIds?: number[];
        inheritedBatteryNote?: string;
        inheritedBatteryIssueLabels?: BatteryIssueLabel[];
      };
      const originalBFaultOptionIds = normalizeIdList(carryoverTask.inheritedBFaultOptionIds ?? []);
      const originalBatteryIssueLabels = normalizeTextList(carryoverTask.inheritedBatteryIssueLabels ?? []);
      const nextBFaultOptionIds = normalizeIdList(selections.bFaultOptionIds);
      const nextBatteryIssueLabels = normalizeTextList(selections.batteryIssueLabels);
      const nextBatteryNote = selections.batteryNote.trim();
      const originalBatteryNote = (carryoverTask.inheritedBatteryNote ?? "").trim();
      const hasBatteryChanges = selections.hasOpenedBatteryEditor && (
        nextBatteryNote !== originalBatteryNote
        || JSON.stringify(nextBatteryIssueLabels) !== JSON.stringify(originalBatteryIssueLabels)
      );
      const hasBFaultChanges = selections.hasOpenedBFaultEditor
        && JSON.stringify(nextBFaultOptionIds) !== JSON.stringify(originalBFaultOptionIds);
      const hasBChanges = hasBatteryChanges || hasBFaultChanges;
      const applyBChanges = hasBChanges
        ? window.confirm("是否修改電池／非螢幕功能狀態？按下「確定」會將更新後的電池檢測與 B 站故障狀態回寫到 Google Sheet M/N 欄，並在 Q 欄標記 Y。")
        : false;

      completeMutation.mutate({
        ...basePayload,
        bFaultOptionIds: applyBChanges ? selections.bFaultOptionIds : carryoverTask.inheritedBFaultOptionIds ?? [],
        batteryNote: applyBChanges ? selections.batteryNote : carryoverTask.inheritedBatteryNote ?? undefined,
        batteryIssueLabels: applyBChanges ? selections.batteryIssueLabels : carryoverTask.inheritedBatteryIssueLabels ?? [],
        applyBChanges,
      });
      return;
    }

    completeMutation.mutate(basePayload);
  };

  const canReceiveA1 = Boolean(
    arrivalForm.batchNo.trim() || arrivalForm.serialNumber.trim() || arrivalForm.imei.trim(),
  );

  if (detailQuery.isLoading) {
    return <div className="grid gap-4 p-6"><Skeleton className="h-28 rounded-3xl" /><Skeleton className="h-40 rounded-3xl" /></div>;
  }

  return (
    <DashboardLayout title={detailQuery.data?.label ?? "站點作業"} navItems={navItems}>
      <div className="space-y-6">
        <Card className="rounded-[28px] border-0 bg-[#eef2f7] shadow-sm">
          <CardContent className="flex flex-col gap-4 p-8 md:flex-row md:items-end md:justify-between">
            <div>
              <Badge className="bg-white/80 text-slate-700">掃碼、補錄與推進下一站</Badge>
              <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-900">{detailQuery.data?.label}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">支援站內搜尋與快速完工。A1 站可直接補齊已匯入商品的缺漏欄位；B 站可補記電池檢測與非螢幕功能狀態；C 站則會承接 B 站資料，補記螢幕狀態與機身外觀，並可視需要修正上一站紀錄。</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" className="rounded-2xl" onClick={() => setLocation("/import")}>
                <PackagePlus className="mr-2 h-4 w-4" /> 匯入作業
              </Button>
              <Button variant="outline" className="rounded-2xl" onClick={() => setLocation("/operations")}>
                <Undo2 className="mr-2 h-4 w-4" /> 返回站點總覽
              </Button>
            </div>
          </CardContent>
        </Card>

        {stationCode === "A1" ? (
          <div className="space-y-6">
            <Card className="rounded-[28px] border-0 bg-white shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold">目前待點貨商品分類與數量</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-3 rounded-[24px] bg-slate-50 p-4 text-sm text-slate-600">
                  <Badge className="bg-slate-900 text-white">待點貨總數 {pendingTotalCount}</Badge>
                  <span>匯入完成後，A1 可先依商品分類確認目前待處理分布，再開始逐筆點到貨。</span>
                </div>
                {pendingCategorySummary.length > 0 ? (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {pendingCategorySummary.map((item) => (
                      <div key={item.label} className="rounded-[24px] bg-[#eef2f7] p-4 shadow-sm">
                        <p className="text-xs font-medium tracking-wide text-slate-500">商品分類</p>
                        <p className="mt-2 text-base font-bold text-slate-900">{item.label}</p>
                        <p className="mt-3 text-sm text-slate-600">待點貨數量 <span className="font-bold text-slate-900">{item.count}</span></p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[24px] bg-slate-50 p-4 text-sm text-slate-600">目前沒有待點貨商品，完成匯入後會在這裡顯示各商品分類的待處理數量。</div>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-[28px] border-0 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-bold">A1 點到貨新增／補齊</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <form
                  className="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitA1Receive();
                  }}
                >
                  <div className="rounded-[24px] bg-slate-50 p-4 text-sm leading-7 text-slate-600">
                    A1 改為掃碼補齊模式。只要刷入商品批號、商品序號或 IMEI 任一欄位，系統就會優先比對既有匯入資料；若需要，也可同步指定品名。完成後系統會直接完成 A1 並留在本頁，方便現場立即掃描下一筆。
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <label className="space-y-2 text-sm text-slate-600">
                      <span>商品批號</span>
                      <Input
                        ref={batchNoInputRef}
                        autoFocus
                        value={arrivalForm.batchNo}
                        onChange={(event) => setArrivalForm((prev) => ({ ...prev, batchNo: event.target.value }))}
                        onKeyDown={handleA1ScanSubmitKey}
                        className="h-14 rounded-2xl border-0 bg-slate-50 text-base"
                        placeholder="掃描批號後可直接按 Enter"
                      />
                    </label>
                    <label className="space-y-2 text-sm text-slate-600">
                      <span>商品序號</span>
                      <Input
                        value={arrivalForm.serialNumber}
                        onChange={(event) => setArrivalForm((prev) => ({ ...prev, serialNumber: event.target.value }))}
                        onKeyDown={handleA1ScanSubmitKey}
                        className="h-14 rounded-2xl border-0 bg-slate-50 text-base"
                        placeholder="可補刷序號以補齊資料"
                      />
                    </label>
                    <label className="space-y-2 text-sm text-slate-600">
                      <span>IMEI</span>
                      <Input
                        value={arrivalForm.imei}
                        onChange={(event) => setArrivalForm((prev) => ({ ...prev, imei: event.target.value }))}
                        onKeyDown={handleA1ScanSubmitKey}
                        className="h-14 rounded-2xl border-0 bg-slate-50 text-base"
                        placeholder="可補刷 IMEI 以補齊資料"
                      />
                    </label>
                    <label className="space-y-2 text-sm text-slate-600">
                      <span>品名</span>
                      <div className="relative">
                        <Input
                          value={arrivalForm.productName}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setArrivalForm((prev) => ({ ...prev, productName: nextValue }));
                            setProductNamePickerOpen(true);
                          }}
                          onFocus={() => setProductNamePickerOpen(true)}
                          onBlur={() => {
                            window.setTimeout(() => setProductNamePickerOpen(false), 120);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              setProductNamePickerOpen(false);
                            }
                          }}
                          className="h-14 rounded-2xl border-0 bg-slate-50 pr-12 text-base"
                          placeholder="輸入品名關鍵字搜尋（可選）"
                          autoComplete="off"
                        />
                        <Search className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
                        {productNamePickerOpen ? (
                          <div className="absolute z-30 mt-2 max-h-72 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                            {productNameOptionsQuery.isLoading ? (
                              <p className="px-3 py-4 text-sm text-slate-500">品名載入中…</p>
                            ) : filteredProductNameOptions.length > 0 ? (
                              <div className="space-y-1">
                                {filteredProductNameOptions.map((option) => {
                                  const isActive = option.label === arrivalForm.productName;
                                  return (
                                    <button
                                      key={option.id}
                                      type="button"
                                      className={`flex w-full items-center rounded-xl px-3 py-2 text-left text-sm transition ${isActive ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}
                                      onMouseDown={(event) => event.preventDefault()}
                                      onClick={() => {
                                        setArrivalForm((prev) => ({ ...prev, productName: option.label }));
                                        setProductNamePickerOpen(false);
                                      }}
                                    >
                                      {option.label}
                                    </button>
                                  );
                                })}
                              </div>
                            ) : arrivalForm.productName.trim() ? (
                              <p className="px-3 py-4 text-sm text-slate-500">找不到符合的品名，可直接保留目前輸入。</p>
                            ) : (
                              <p className="px-3 py-4 text-sm text-slate-500">請輸入關鍵字搜尋品名。</p>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] bg-[#eef2f7] p-4 text-sm text-slate-600">
                    <p>為了讓掃描槍操作更快，本區不再要求先填 PO、廠商、到貨時間與商品分類；只要任一識別碼命中已匯入的 A1 待處理商品，就會直接完成點到貨、同步回寫資料，並留在 A1 等待下一筆。</p>
                    <Button type="submit" className="rounded-2xl" disabled={receiveMutation.isPending || !canReceiveA1}>
                      {receiveMutation.isPending ? "比對中..." : "完成 A1 並準備下一筆"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        ) : null}

        <Card className="rounded-[28px] border-0 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-bold">掃碼／條碼輸入</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative max-w-xl space-y-3">
              <div className="relative">
                <Search className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
                <Input
                  ref={quickScanInputRef}
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  onKeyDown={handleStationScanInputKey}
                  placeholder={stationCode === "A2" ? "掃描商品批號 QR 後可直接按 Enter 完成 A2" : stationCode === "B" ? "輸入商品批號後可快速定位 B 站待測項目" : stationCode === "C" ? "輸入商品批號後可快速定位 C 站待檢項目" : "輸入產品代碼、批號、序號或 IMEI"}
                  className="h-12 rounded-2xl border-0 bg-slate-50 pl-11"
                />
              </div>
              {stationCode === "A2" ? (
                <p className="text-sm text-slate-500">A2 已改為掃碼快速完工模式。刷入商品批號 QR 後會立即完成 A2、推進到下一站，並在背景回寫安裝完成時間。</p>
              ) : null}
              {stationCode === "B" ? (
                <p className="text-sm text-slate-500">B 站可先用商品批號快速定位待測商品，再補充電池檢測與故障狀態；完成軟體測試後會立即推進下一站，並在背景回寫 B 站完成、電池檢測與故障摘要。</p>
              ) : null}
              {stationCode === "C" ? (
                <p className="text-sm text-slate-500">C 站會承接 B 站的電池檢測與故障狀態，完成品檢後立即推進下一站，並在背景回寫 C 站測試時間、螢幕狀態、機身狀態、鏡頭狀態與必要的上一站修正標記。</p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          {filteredTasks.map((task) => {
            const selections = getTaskSelections(task.taskId);
            const carryoverTask = task as typeof task & {
              inheritedBFaultLabels?: string[];
              inheritedBFaultSummary?: string | null;
            };
            const editableBFaultOptions = ((stationCode === "B" ? detailQuery.data?.faultOptions : detailQuery.data?.bFaultOptions) ?? []).filter((option) => option.active);
            const allBFaultOptions = (stationCode === "B" ? detailQuery.data?.faultOptions : detailQuery.data?.bFaultOptions) ?? [];
            const selectedBFaultIds = stationCode === "B" ? selections.faultOptionIds : selections.bFaultOptionIds;
            const selectedBFaultLabels = allBFaultOptions
              .filter((option) => selectedBFaultIds.includes(option.id))
              .map((option) => option.label);
            const fallbackBFaultLabels = stationCode === "C"
              ? normalizeTextList([
                  ...(carryoverTask.inheritedBFaultLabels ?? []),
                  ...(carryoverTask.inheritedBFaultSummary
                    ? carryoverTask.inheritedBFaultSummary.split(",")
                    : []),
                ])
              : [];
            const displayedBFaultLabels = selectedBFaultLabels.length > 0 ? selectedBFaultLabels : fallbackBFaultLabels;
            const batterySummary = summarizeTextResult([
              selections.batteryNote.trim(),
              ...selections.batteryIssueLabels,
            ]);
            const bFaultSummary = summarizeTextResult(displayedBFaultLabels);

            return (
              <Card key={task.taskId} className="rounded-[26px] border-0 bg-white shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between text-base font-bold text-slate-900">
                    <span>{task.productCode}</span>
                    <Badge variant="secondary" className={task.isOverdue ? "bg-[#f7e8ee] text-rose-700" : "bg-slate-100 text-slate-700"}>
                      {task.isOverdue ? "逾期" : task.taskStatus}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600 md:grid-cols-2">
                    <div><p className="text-xs text-slate-400">商品名稱</p><p className="mt-1 font-semibold text-slate-900">{task.productName ?? "-"}</p></div>
                    <div><p className="text-xs text-slate-400">品類</p><p className="mt-1 font-semibold text-slate-900">{task.categoryName ?? task.importedCategoryName ?? task.subtypeCode ?? "-"}</p></div>
                    <div><p className="text-xs text-slate-400">批號</p><p className="mt-1 font-semibold text-slate-900">{task.batchNo ?? "-"}</p></div>
                    <div><p className="text-xs text-slate-400">序號</p><p className="mt-1 font-semibold text-slate-900">{task.serialNumber ?? "-"}</p></div>
                    <div><p className="text-xs text-slate-400">IMEI</p><p className="mt-1 font-semibold text-slate-900">{task.imei ?? "-"}</p></div>
                    <div><p className="text-xs text-slate-400">目前站點</p><p className="mt-1 font-semibold text-slate-900">{task.currentStationCode}</p></div>
                  </div>

                  {stationCode === "B" || stationCode === "C" ? (
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
                      <div className="space-y-3 rounded-[24px] bg-[#eef2f7] p-4">
                        <div>
                          <p className="text-sm font-bold text-slate-900">{stationCode === "B" ? "B 站故障狀態" : "B 站故障狀態（C 站可修改）"}</p>
                          <p className="mt-1 text-xs leading-6 text-slate-500">{stationCode === "B" ? "完成軟體測試後會同步回寫 Google Sheet 的 L / M / N / O 欄。" : "這裡先帶入 B 站完成後的文字結果；如需調整，再按修改按鈕進入編輯，完成時可選擇是否一併回寫 Google Sheet M / N / Q 欄。"}</p>
                        </div>
                        {stationCode === "C" && !selections.isEditingBFaults ? (
                          <div className="space-y-3">
                            <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
                              {bFaultSummary}
                            </div>
                            <div className="flex justify-end">
                              <Button type="button" variant="outline" className="rounded-2xl" onClick={() => setBFaultEditing(task.taskId, true)}>
                                修改故障狀態
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div className="grid gap-3 md:grid-cols-2">
                              {editableBFaultOptions.map((option) => (
                                <label key={option.id} className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
                                  <Checkbox checked={(stationCode === "B" ? selections.faultOptionIds : selections.bFaultOptionIds).includes(option.id)} onCheckedChange={(checked) => toggleSelection(task.taskId, stationCode === "B" ? "faultOptionIds" : "bFaultOptionIds", option.id, Boolean(checked))} />
                                  <span>{option.label}</span>
                                </label>
                              ))}
                            </div>
                            {stationCode === "C" ? (
                              <div className="flex justify-end">
                                <Button type="button" variant="ghost" className="rounded-2xl" onClick={() => setBFaultEditing(task.taskId, false)}>
                                  取消修改
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                      <div className="space-y-3 rounded-[24px] bg-[#f8fbff] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-bold text-slate-900">電池檢測</p>
                            <p className="mt-1 text-xs leading-6 text-slate-500">{stationCode === "B" ? "可輸入健康度或數字符號，並勾選電池異常標記，完成後會同步寫入 Google Sheet M 欄。" : "這裡先帶入 B 站的電池檢測文字結果；如需調整，再按修改按鈕編輯，完成時可選擇是否回寫 Google Sheet M / Q 欄。"}</p>
                          </div>
                          <Button type="button" variant="outline" className="rounded-2xl" onClick={() => openBatteryEditor(task.taskId)}>
                            修改電池檢測
                          </Button>
                        </div>
                        <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
                          {batterySummary}
                        </div>
                        <Dialog open={batteryDialogTaskId === task.taskId} onOpenChange={(open) => setBatteryDialogTaskId(open ? task.taskId : null)}>
                          <DialogContent className="rounded-[28px] border-0 p-0 sm:max-w-xl">
                            <div className="space-y-6 p-6">
                              <DialogHeader>
                                <DialogTitle>電池檢測</DialogTitle>
                                <DialogDescription>{stationCode === "B" ? "可手動輸入數字或符號，並勾選電池狀態；未填寫時會在 Google Sheet M 欄回寫為「正常」。" : "此區會先帶入 B 站已記錄的電池檢測文字結果。若你有調整，完成 C 站時可選擇是否同步回 Google Sheet M 欄，並在 Q 欄標記為已修改上一關狀態。"}</DialogDescription>
                              </DialogHeader>
                              <label className="space-y-2 text-sm text-slate-600">
                                <span>檢測回覆</span>
                                <Input
                                  value={selections.batteryNote}
                                  onChange={(event) => updateBatteryNote(task.taskId, event.target.value)}
                                  className="h-12 rounded-2xl border-0 bg-slate-50"
                                  placeholder="例如：88、85%、待更換"
                                />
                              </label>
                              <div className="space-y-3">
                                <p className="text-sm font-medium text-slate-700">異常標記</p>
                                <div className="grid gap-3 sm:grid-cols-2">
                                  {B_BATTERY_ISSUE_OPTIONS.map((optionLabel) => (
                                    <label key={optionLabel} className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                                      <Checkbox
                                        checked={selections.batteryIssueLabels.includes(optionLabel)}
                                        onCheckedChange={(checked) => toggleBatteryIssueLabel(task.taskId, optionLabel, Boolean(checked))}
                                      />
                                      <span>{optionLabel}</span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                              <DialogFooter>
                                <Button type="button" variant="outline" className="rounded-2xl" onClick={() => setBatteryDialogTaskId(null)}>
                                  完成
                                </Button>
                              </DialogFooter>
                            </div>
                          </DialogContent>
                        </Dialog>
                      </div>
                    </div>
                  ) : null}

                  {stationCode === "C" ? (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="space-y-3 rounded-[24px] bg-[#eef2f7] p-4">
                        <div>
                          <p className="text-sm font-bold text-slate-900">C 站螢幕狀態</p>
                          <p className="mt-1 text-xs leading-6 text-slate-500">完成後會自動背景同步到 Google Sheet O 欄；若未勾選任何項目則回寫「正常」。</p>
                        </div>
                        <div className="grid gap-3">
                          {(detailQuery.data?.faultOptions ?? []).filter((option) => option.active).map((option) => (
                            <label key={option.id} className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
                              <Checkbox checked={selections.faultOptionIds.includes(option.id)} onCheckedChange={(checked) => toggleSelection(task.taskId, "faultOptionIds", option.id, Boolean(checked))} />
                              <span>{option.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-3 rounded-[24px] bg-[#f7e8ee] p-4">
                        <div>
                          <p className="text-sm font-bold text-slate-900">C 站機身外觀</p>
                          <p className="mt-1 text-xs leading-6 text-slate-500">完成後會自動背景同步到 Google Sheet S 欄；若未勾選任何項目則回寫「正常」。</p>
                        </div>
                        <div className="grid gap-3">
                          {(detailQuery.data?.appearanceOptions ?? []).filter((option) => option.active).map((option) => (
                            <label key={option.id} className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
                              <Checkbox checked={selections.appearanceOptionIds.includes(option.id)} onCheckedChange={(checked) => toggleSelection(task.taskId, "appearanceOptionIds", option.id, Boolean(checked))} />
                              <span>{option.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-3 rounded-[24px] bg-[#eef7f3] p-4">
                        <div>
                          <p className="text-sm font-bold text-slate-900">C 站鏡頭狀態</p>
                          <p className="mt-1 text-xs leading-6 text-slate-500">完成後會自動背景同步到 Google Sheet T 欄；若未勾選任何項目則回寫「正常」。</p>
                        </div>
                        <div className="grid gap-3">
                          {(detailQuery.data?.cameraOptions ?? []).filter((option) => option.active).map((option) => (
                            <label key={option.id} className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
                              <Checkbox checked={selections.cameraOptionIds.includes(option.id)} onCheckedChange={(checked) => toggleSelection(task.taskId, "cameraOptionIds", option.id, Boolean(checked))} />
                              <span>{option.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-3">
                    <Button
                      className="rounded-2xl"
                      disabled={completeMutation.isPending}
                      onClick={() => submitStationCompletion(task)}
                    >
                      {stationCode === "B" ? "完成軟體測試並推進下一站" : stationCode === "C" ? "完成 C 站品檢並推進下一站" : "完成並推進下一站"}
                    </Button>
                    <Button variant="outline" className="rounded-2xl" onClick={() => setLocation("/operations")}>
                      返回總覽
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {filteredTasks.length === 0 ? (
            <Card className="rounded-[26px] border-0 bg-white shadow-sm xl:col-span-2">
              <CardContent className="p-8 text-sm leading-7 text-slate-600">目前此站沒有符合條件的待處理商品。你可以返回站點總覽，查看其他站點的未完成數量並切換支援，或前往匯入作業建立新的到貨資料。</CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </DashboardLayout>
  );
}
