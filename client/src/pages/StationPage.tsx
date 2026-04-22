import DashboardLayout, { type DashboardNavItem } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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

type OptionSelections = {
  faultOptionIds: number[];
  appearanceOptionIds: number[];
};

const defaultSelections = (): OptionSelections => ({
  faultOptionIds: [],
  appearanceOptionIds: [],
});

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
  const batchNoInputRef = useRef<HTMLInputElement | null>(null);
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

  const invalidateStationData = async () => {
    await utils.station.detail.invalidate({ stationCode });
    await utils.station.list.invalidate();
    await utils.dashboard.home.invalidate();
  };

  const focusBatchInput = () => {
    window.requestAnimationFrame(() => {
      batchNoInputRef.current?.focus();
      batchNoInputRef.current?.select();
    });
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

  const completeMutation = trpc.station.complete.useMutation({
    onSuccess: async () => {
      toast.success("站點作業已完成");
      setSelectedOptions({});
      await invalidateStationData();
    },
    onError: (error) => {
      toast.error(error.message || "站點作業更新失敗");
    },
  });

  const receiveMutation = trpc.station.receive.useMutation({
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(result.message || "A1 點到貨處理失敗");
        return;
      }

      toast.success(`${result.productCode ?? "商品"} 已完成 A1 點到貨，請直接掃描下一筆`);
      setArrivalForm({ batchNo: "", serialNumber: "", imei: "", productName: "" });
      await invalidateStationData();
      await utils.station.detail.invalidate({ stationCode: "A2" });
      focusBatchInput();
    },
    onError: (error) => {
      toast.error(error.message || "A1 點到貨處理失敗");
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
  }, [detailQuery.isLoading, stationCode]);

  const filteredTasks = useMemo(() => {
    const tasks = detailQuery.data?.tasks ?? [];
    return tasks.filter((task) => {
      const text = `${task.productCode} ${task.productName ?? ""} ${task.batchNo ?? ""} ${task.serialNumber ?? ""} ${task.imei ?? ""}`.toLowerCase();
      return text.includes(keyword.toLowerCase());
    });
  }, [detailQuery.data?.tasks, keyword]);

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

  const toggleSelection = (taskId: number, key: keyof OptionSelections, optionId: number, checked: boolean) => {
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

  const getTaskSelections = (taskId: number) => selectedOptions[taskId] ?? defaultSelections();
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
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">支援站內搜尋與快速完工。A1 站可直接補齊已匯入商品的缺漏欄位，B、C 站則可套用可維護的故障與外觀功能表，讓現場紀錄更一致。</p>
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
                      <select
                        value={arrivalForm.productName}
                        onChange={(event) => setArrivalForm((prev) => ({ ...prev, productName: event.target.value }))}
                        className="h-14 w-full rounded-2xl border-0 bg-slate-50 px-4 text-base text-slate-900 outline-none ring-0"
                      >
                        <option value="">請選擇品名（可選）</option>
                        {(productNameOptionsQuery.data ?? []).map((option) => (
                          <option key={option.id} value={option.label}>
                            {option.label}
                          </option>
                        ))}
                      </select>
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
            <div className="relative max-w-xl">
              <Search className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
              <Input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="輸入產品代碼、批號、序號或 IMEI" className="h-12 rounded-2xl border-0 bg-slate-50 pl-11" />
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          {filteredTasks.map((task) => {
            const selections = getTaskSelections(task.taskId);

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

                  {stationCode === "B" && (detailQuery.data?.faultOptions?.length ?? 0) > 0 ? (
                    <div className="space-y-3 rounded-[24px] bg-[#eef2f7] p-4">
                      <p className="text-sm font-bold text-slate-900">B 站故障狀態</p>
                      <div className="grid gap-3 md:grid-cols-2">
                        {(detailQuery.data?.faultOptions ?? []).filter((option) => option.active).map((option) => (
                          <label key={option.id} className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
                            <Checkbox checked={selections.faultOptionIds.includes(option.id)} onCheckedChange={(checked) => toggleSelection(task.taskId, "faultOptionIds", option.id, Boolean(checked))} />
                            <span>{option.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {stationCode === "C" ? (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="space-y-3 rounded-[24px] bg-[#eef2f7] p-4">
                        <p className="text-sm font-bold text-slate-900">C 站故障項目</p>
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
                        <p className="text-sm font-bold text-slate-900">C 站外觀項目</p>
                        <div className="grid gap-3">
                          {(detailQuery.data?.appearanceOptions ?? []).filter((option) => option.active).map((option) => (
                            <label key={option.id} className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
                              <Checkbox checked={selections.appearanceOptionIds.includes(option.id)} onCheckedChange={(checked) => toggleSelection(task.taskId, "appearanceOptionIds", option.id, Boolean(checked))} />
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
                      onClick={() => completeMutation.mutate({
                        taskId: task.taskId,
                        stationCode,
                        productId: task.productId,
                        categoryId: undefined,
                        subtypeCode: task.subtypeCode ?? null,
                        summary: `${detailQuery.data?.label} 完成`,
                        faultOptionIds: selections.faultOptionIds,
                        appearanceOptionIds: selections.appearanceOptionIds,
                      })}
                    >
                      完成並推進下一站
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
