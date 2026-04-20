import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { Boxes, Gauge, ShieldCheck } from "lucide-react";
import { useEffect } from "react";
import { useLocation } from "wouter";

export default function Home() {
  const { isAuthenticated, loading } = useAuth();
  const [, setLocation] = useLocation();
  const dashboardQuery = trpc.dashboard.home.useQuery(undefined, {
    enabled: isAuthenticated && !loading,
    retry: false,
  });
  const roleLanding = dashboardQuery.data?.roleLanding;

  useEffect(() => {
    if (!isAuthenticated || loading) {
      return;
    }

    if (roleLanding === "dashboard") {
      setLocation("/admin");
      return;
    }

    if (roleLanding === "operations") {
      setLocation("/operations");
    }
  }, [isAuthenticated, loading, roleLanding, setLocation]);

  if (loading || dashboardQuery.isLoading) {
    return (
      <div className="grid min-h-screen gap-4 bg-[#f5f7fa] p-6 md:grid-cols-3">
        <Skeleton className="h-40 rounded-[28px] md:col-span-2" />
        <Skeleton className="h-40 rounded-[28px]" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f7fa] p-6">
      <Card className="w-full max-w-3xl rounded-[32px] border-0 bg-white shadow-sm">
        <CardContent className="grid gap-6 p-8 md:grid-cols-[1.3fr_1fr] md:p-10">
          <div>
            <p className="text-sm font-semibold tracking-[0.2em] text-slate-500">回收品檢系統</p>
            <h1 className="mt-4 text-4xl font-black tracking-tight text-slate-900">正在為你準備對應的工作入口</h1>
            <p className="mt-4 text-sm leading-7 text-slate-600">
              系統會依角色自動導向工程師的站點作業總覽，或管理者的 KPI 與設定後台。如果你想手動檢查頁面，也可以直接使用下方入口。
            </p>
          </div>

          <div className="space-y-3">
            <Button className="w-full justify-start rounded-2xl" onClick={() => setLocation("/operations")}>
              <Boxes className="mr-2 h-4 w-4" /> 前往站點作業總覽
            </Button>
            <Button variant="outline" className="w-full justify-start rounded-2xl" onClick={() => setLocation("/kpi")}>
              <Gauge className="mr-2 h-4 w-4" /> 前往工程師 KPI
            </Button>
            <Button variant="outline" className="w-full justify-start rounded-2xl" onClick={() => setLocation("/admin")}>
              <ShieldCheck className="mr-2 h-4 w-4" /> 前往管理後台
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
