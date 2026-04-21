import DashboardLayout, { type DashboardNavItem } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { Boxes, ClipboardCheck, Gauge, ShieldCheck, Search, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useRoute } from "wouter";

const navItems: DashboardNavItem[] = [
  { label: "站點總覽", path: "/operations", icon: Boxes },
  { label: "D 站抽樣", path: "/sampling", icon: ClipboardCheck },
  { label: "工程師 KPI", path: "/kpi", icon: Gauge },
  { label: "管理後台", path: "/admin", icon: ShieldCheck },
];

const stationCodes = ["A1", "A2", "B", "C", "E", "STOCK"] as const;
type StationCode = (typeof stationCodes)[number];

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
  const utils = trpc.useUtils();
  const detailQuery = trpc.station.detail.useQuery(
    { stationCode },
    {
      retry: false,
    },
  );
  const completeMutation = trpc.station.complete.useMutation({
    onSuccess: async () => {
      await utils.station.detail.invalidate({ stationCode });
      await utils.station.list.invalidate();
      await utils.dashboard.home.invalidate();
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
      const text = `${task.productCode} ${task.productName ?? ""} ${task.serialNumber ?? ""} ${task.imei ?? ""}`.toLowerCase();
      return text.includes(keyword.toLowerCase());
    });
  }, [detailQuery.data?.tasks, keyword]);

  if (detailQuery.isLoading) {
    return <div className="grid gap-4 p-6"><Skeleton className="h-28 rounded-3xl" /><Skeleton className="h-40 rounded-3xl" /></div>;
  }

  return (
    <DashboardLayout title={detailQuery.data?.label ?? "站點作業"} navItems={navItems}>
      <div className="space-y-6">
        <Card className="rounded-[28px] border-0 bg-[#eef2f7] shadow-sm">
          <CardContent className="flex flex-col gap-4 p-8 md:flex-row md:items-end md:justify-between">
            <div>
              <Badge className="bg-white/80 text-slate-700">掃碼與推進下一站</Badge>
              <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-900">{detailQuery.data?.label}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">支援掃碼或直接輸入商品代碼，完成後立即推進至下一站，同時保留返回站點總覽的快速入口。</p>
            </div>
            <Button variant="outline" className="rounded-2xl" onClick={() => setLocation("/operations")}>
              <Undo2 className="mr-2 h-4 w-4" /> 返回站點總覽
            </Button>
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border-0 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-bold">掃碼／條碼輸入</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative max-w-xl">
              <Search className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
              <Input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="輸入產品代碼、序號或 IMEI" className="h-12 rounded-2xl border-0 bg-slate-50 pl-11" />
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          {filteredTasks.map((task) => (
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
                  <div><p className="text-xs text-slate-400">品類</p><p className="mt-1 font-semibold text-slate-900">{task.subtypeCode ?? "-"}</p></div>
                  <div><p className="text-xs text-slate-400">序號</p><p className="mt-1 font-semibold text-slate-900">{task.serialNumber ?? "-"}</p></div>
                  <div><p className="text-xs text-slate-400">IMEI</p><p className="mt-1 font-semibold text-slate-900">{task.imei ?? "-"}</p></div>
                </div>
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
          ))}
          {filteredTasks.length === 0 ? (
            <Card className="rounded-[26px] border-0 bg-white shadow-sm xl:col-span-2">
              <CardContent className="p-8 text-sm leading-7 text-slate-600">目前此站沒有符合條件的待處理商品。你可以返回站點總覽，查看其他站點的未完成數量並切換支援。</CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </DashboardLayout>
  );
}
