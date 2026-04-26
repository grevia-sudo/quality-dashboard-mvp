import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout, { type DashboardNavItem } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { Activity, ArrowRight, Boxes, ClipboardCheck, Gauge, PackagePlus, PackageSearch, ShieldCheck, Sparkles } from "lucide-react";
import { useLocation } from "wouter";

const MANAGEMENT_VIEWER_ROLES = ["supervisor", "manager", "admin"];

const navItems: DashboardNavItem[] = [
  { label: "站點總覽", path: "/operations", icon: Boxes },
  { label: "匯入作業", path: "/import", icon: PackagePlus, allowedRoles: MANAGEMENT_VIEWER_ROLES },
  { label: "D 站抽樣", path: "/sampling", icon: ClipboardCheck, allowedRoles: MANAGEMENT_VIEWER_ROLES },
  { label: "工程師 KPI", path: "/kpi", icon: Gauge },
  { label: "管理後台", path: "/admin", icon: ShieldCheck, allowedRoles: ["admin"] },
];

export default function OperationsPage() {
  const { user } = useAuth({ redirectOnUnauthenticated: true });
  const [, setLocation] = useLocation();
  const dashboardQuery = trpc.dashboard.home.useQuery(undefined, {
    retry: false,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });
  const stations = dashboardQuery.data?.stations ?? [];
  const kpi = dashboardQuery.data?.kpi;
  const canAccessManagementOps = Boolean(user && MANAGEMENT_VIEWER_ROLES.includes(user.role));
  const visibleStations = stations.filter((station) => station.stationCode !== "D" || canAccessManagementOps);

  if (dashboardQuery.isLoading) {
    return (
      <div className="grid min-h-screen gap-6 bg-[#f5f7fa] p-6 md:grid-cols-3">
        <Skeleton className="h-32 rounded-3xl md:col-span-2" />
        <Skeleton className="h-32 rounded-3xl" />
        <Skeleton className="h-40 rounded-3xl" />
        <Skeleton className="h-40 rounded-3xl" />
        <Skeleton className="h-40 rounded-3xl" />
      </div>
    );
  }

  return (
    <DashboardLayout title="站點作業總覽" navItems={navItems}>
      <div className="space-y-6">
        <section className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <Card className="overflow-hidden rounded-[28px] border-0 bg-[#eef2f7] shadow-sm">
            <CardContent className="relative space-y-5 p-8">
              <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-[#d7e7ff] blur-2xl" />
              <div className="absolute bottom-0 right-10 h-24 w-24 rounded-full bg-[#f2dce5] blur-2xl" />
              <Badge className="bg-white/80 text-slate-700">站點作業入口</Badge>
              <h1 className="max-w-2xl text-3xl font-black tracking-tight text-slate-900 md:text-4xl">
                依未完成數量快速切換站點，也把匯入作業納入同一條現場節奏。
              </h1>
              <p className="max-w-2xl text-sm leading-7 text-slate-600 md:text-base">
                每張站點卡片即時顯示未完成數量、今日新增與逾期件數。工程師完成一段作業後可直接返回總覽切換站點；若有新到貨資料，也能先進入匯入作業建立 A1 待處理任務。
              </p>
              <div className="flex flex-wrap gap-3">
                {canAccessManagementOps ? (
                  <Button className="rounded-2xl" onClick={() => setLocation("/import")}>
                    <PackagePlus className="mr-2 h-4 w-4" /> 前往匯入作業
                  </Button>
                ) : null}
                {user?.role === "admin" ? (
                  <Button variant="outline" className="rounded-2xl" onClick={() => setLocation("/admin")}>
                    管理設定
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[28px] border-0 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base font-bold text-slate-900">
                <Sparkles className="h-4 w-4 text-[#7ca3d9]" /> 今日 KPI 摘要
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">當日總點數</p>
                <p className="mt-2 text-3xl font-black text-slate-900">{kpi?.dailySummary?.totalPoints?.toFixed?.(3) ?? "0.000"}</p>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between text-sm text-slate-600">
                  <span>KPI 達標率</span>
                  <span>{kpi?.dailySummary?.kpiAchievementRate?.toFixed?.(2) ?? "0.00"}%</span>
                </div>
                <Progress value={Math.min(kpi?.dailySummary?.kpiAchievementRate ?? 0, 100)} className="h-2.5 bg-slate-100" />
              </div>
              <Button className="w-full rounded-2xl" onClick={() => setLocation("/kpi")}>
                查看工程師績效頁
              </Button>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {visibleStations.map((station) => (
            <Card key={station.stationCode} className="rounded-[26px] border-0 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base font-bold text-slate-900">
                  <span>{station.label}</span>
                  <Badge variant="secondary" className="rounded-full bg-slate-100 text-slate-700">
                    {station.stationCode === "STOCK" ? "待入庫" : station.stationCode}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-2xl bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">未完成</p>
                    <p className="mt-2 text-2xl font-black text-slate-900">{station.pendingCount}</p>
                  </div>
                  <div className="rounded-2xl bg-[#e8f1ff] p-3">
                    <p className="text-xs text-slate-500">今日新增</p>
                    <p className="mt-2 text-2xl font-black text-slate-900">{station.todayNewCount}</p>
                  </div>
                  <div className="rounded-2xl bg-[#f7e8ee] p-3">
                    <p className="text-xs text-slate-500">逾期件數</p>
                    <p className="mt-2 text-2xl font-black text-slate-900">{station.overdueCount}</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="w-full justify-between rounded-2xl"
                  onClick={() => setLocation(station.stationCode === "D" ? "/sampling" : `/station/${station.stationCode}`)}
                >
                  進入站點作業
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <Card className="rounded-[26px] border-0 bg-white shadow-sm lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base font-bold"><Activity className="h-4 w-4 text-[#7ca3d9]" />ERD 對應的作業節奏</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              {[
                { title: "先匯入或到貨", text: "若是新批次商品，先從匯入作業或 A1 點到貨表單建立待處理資料。" },
                { title: "再看總覽", text: "回到總覽頁確認各站未完成數量與逾期件數，再決定優先支援哪一站。" },
                { title: "完成後切站", text: "站內完成後回到總覽頁，再切往下一站持續支援，不做永久站點綁定。" },
              ].map((item) => (
                <div key={item.title} className="rounded-2xl bg-slate-50 p-5">
                  <p className="text-sm font-bold text-slate-900">{item.title}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{item.text}</p>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="rounded-[26px] border-0 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base font-bold"><PackageSearch className="h-4 w-4 text-[#e197b3]" />月報公平性</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-7 text-slate-600">
              <p>月報使用日均點數，不直接比較總件數，避免出勤天數不同造成誤判。</p>
              <p>品質與時效會作為扣分或警示項，避免只看產能而忽略返工與逾期。</p>
              <p>Google Sheet 回寫採非同步佇列，現場操作不會被外部同步流程阻塞。</p>
            </CardContent>
          </Card>
        </section>
      </div>
    </DashboardLayout>
  );
}
