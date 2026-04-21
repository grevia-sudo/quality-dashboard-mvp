import DashboardLayout, { type DashboardNavItem } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { Boxes, ClipboardCheck, Gauge, PackagePlus, Search, ShieldCheck, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
  const utils = trpc.useUtils();
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
    onSuccess: async () => {
      toast.success("A1 到貨商品已建立");
      setArrivalForm({ batchNo: "", serialNumber: "", imei: "", productName: "" });
      await invalidateStationData();
    },
    onError: (error) => {
      toast.error(error.message || "A1 到貨建立失敗");
    },
  });

  useEffect(() => {
    if (!rawStationCode || rawStationCode !== stationCode) {
      setLocation(`/station/${stationCode}`);
    }
  }, [rawStationCode, setLocation, stationCode]);

  const filteredTasks = useMemo(() => {
    const tasks = detailQuery.data?.tasks ?? [];
    return tasks.filter((task) => {
      const text = `${task.productCode} ${task.productName ?? ""} ${task.batchNo ?? ""} ${task.serialNumber ?? ""} ${task.imei ?? ""}`.toLowerCase();
      return text.includes(keyword.toLowerCase());
    });
  }, [detailQuery.data?.tasks, keyword]);

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
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">支援站內搜尋與快速完工。A1 站可直接建立到貨商品；B、C 站則可套用可維護的故障與外觀功能表，讓現場紀錄更一致。</p>
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
          <Card className="rounded-[28px] border-0 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-bold">A1 點到貨新增</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <label className="space-y-2 text-sm text-slate-600">
                  <span>商品批號</span>
                  <Input value={arrivalForm.batchNo} onChange={(event) => setArrivalForm((prev) => ({ ...prev, batchNo: event.target.value }))} className="rounded-2xl border-0 bg-slate-50" placeholder="例如 BATCH-240421-01" />
                </label>
                <label className="space-y-2 text-sm text-slate-600">
                  <span>商品序號</span>
                  <Input value={arrivalForm.serialNumber} onChange={(event) => setArrivalForm((prev) => ({ ...prev, serialNumber: event.target.value }))} className="rounded-2xl border-0 bg-slate-50" placeholder="例如 SN-IP-1001" />
                </label>
                <label className="space-y-2 text-sm text-slate-600">
                  <span>IMEI（選填）</span>
                  <Input value={arrivalForm.imei} onChange={(event) => setArrivalForm((prev) => ({ ...prev, imei: event.target.value }))} className="rounded-2xl border-0 bg-slate-50" placeholder="若無可留空" />
                </label>
                <label className="space-y-2 text-sm text-slate-600">
                  <span>品名</span>
                  <Input value={arrivalForm.productName} onChange={(event) => setArrivalForm((prev) => ({ ...prev, productName: event.target.value }))} className="rounded-2xl border-0 bg-slate-50" placeholder="例如 iPhone 13" />
                </label>
              </div>
              <div className="flex flex-wrap justify-between gap-3 rounded-[24px] bg-slate-50 p-4 text-sm text-slate-600">
                <p>建立後會先寫入 DB，並建立 A1 待處理任務，再由背景程序非同步回寫 Google Sheet。</p>
                <Button
                  className="rounded-2xl"
                  disabled={receiveMutation.isPending || !arrivalForm.batchNo || !arrivalForm.serialNumber || !arrivalForm.productName}
                  onClick={() =>
                    receiveMutation.mutate({
                      batchNo: arrivalForm.batchNo.trim(),
                      serialNumber: arrivalForm.serialNumber.trim(),
                      imei: arrivalForm.imei.trim() || undefined,
                      productName: arrivalForm.productName.trim(),
                      categoryId: null,
                    })
                  }
                >
                  新增 A1 到貨商品
                </Button>
              </div>
            </CardContent>
          </Card>
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
                    <div><p className="text-xs text-slate-400">品類</p><p className="mt-1 font-semibold text-slate-900">{task.subtypeCode ?? task.categoryName ?? "-"}</p></div>
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
                        categoryId: null,
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
