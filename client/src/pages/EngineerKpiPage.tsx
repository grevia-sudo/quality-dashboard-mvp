import DashboardLayout, { type DashboardNavItem } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { Boxes, ClipboardCheck, Gauge, ShieldCheck } from "lucide-react";

const navItems: DashboardNavItem[] = [
  { label: "站點總覽", path: "/", icon: Boxes },
  { label: "D 站抽樣", path: "/sampling", icon: ClipboardCheck },
  { label: "工程師 KPI", path: "/kpi", icon: Gauge },
  { label: "管理後台", path: "/admin", icon: ShieldCheck },
];

export default function EngineerKpiPage() {
  const query = trpc.engineer.kpi.useQuery();
  const summary = query.data?.dailySummary;
  const monthly = query.data?.monthlySummary;
  const details = query.data?.details ?? [];

  return (
    <DashboardLayout title="工程師績效頁" navItems={navItems}>
      <div className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-4">
          {[
            { label: '當日總點數', value: summary?.totalPoints?.toFixed?.(3) ?? '0.000' },
            { label: '原始達成率', value: `${summary?.rawAchievementRate?.toFixed?.(2) ?? '0.00'}%` },
            { label: 'KPI 達標率', value: `${summary?.kpiAchievementRate?.toFixed?.(2) ?? '0.00'}%` },
            { label: '超標率', value: `${summary?.overAchievementRate?.toFixed?.(2) ?? '0.00'}%` },
          ].map((item) => (
            <Card key={item.label} className="rounded-[26px] border-0 bg-white shadow-sm">
              <CardContent className="p-6">
                <p className="text-sm text-slate-500">{item.label}</p>
                <p className="mt-3 text-3xl font-black tracking-tight text-slate-900">{item.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="rounded-[28px] border-0 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-bold">四大 KPI 維度摘要</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            <div><p className="text-sm font-semibold text-slate-900">產能達成</p><p className="mt-2 text-sm text-slate-600">以點數制換算工作量。</p><Progress className="mt-4 h-2.5" value={Math.min(summary?.kpiAchievementRate ?? 0, 100)} /></div>
            <div><p className="text-sm font-semibold text-slate-900">品質表現</p><p className="mt-2 text-sm text-slate-600">抽檢不良率與返工率列入扣分。</p></div>
            <div><p className="text-sm font-semibold text-slate-900">時效表現</p><p className="mt-2 text-sm text-slate-600">觀察逾期件數與平均處理時數。</p></div>
            <div><p className="text-sm font-semibold text-slate-900">出勤公平性</p><p className="mt-2 text-sm text-slate-600">月報以日均點數取代總件數比較。</p></div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Card className="rounded-[28px] border-0 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-bold">每日點數明細</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {details.map((detail, index) => (
                <div key={`${detail.stationCode}-${detail.subtypeCode}-${index}`} className="grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600 md:grid-cols-4">
                  <div><p className="text-xs text-slate-400">站點</p><p className="mt-1 font-semibold text-slate-900">{detail.stationCode}</p></div>
                  <div><p className="text-xs text-slate-400">品類</p><p className="mt-1 font-semibold text-slate-900">{detail.subtypeCode ?? '-'}</p></div>
                  <div><p className="text-xs text-slate-400">完成件數</p><p className="mt-1 font-semibold text-slate-900">{detail.completedQty}</p></div>
                  <div><p className="text-xs text-slate-400">換算點數</p><p className="mt-1 font-semibold text-slate-900">{Number(detail.earnedPoints).toFixed(6)}</p></div>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="rounded-[28px] border-0 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-bold">月累積統計</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 text-sm text-slate-600">
              <div><p className="text-xs text-slate-400">出勤天數</p><p className="mt-1 text-2xl font-black text-slate-900">{monthly?.attendanceDays ?? 0}</p></div>
              <div><p className="text-xs text-slate-400">月總點數</p><p className="mt-1 text-2xl font-black text-slate-900">{monthly?.monthTotalPoints?.toFixed?.(3) ?? '0.000'}</p></div>
              <div><p className="text-xs text-slate-400">月日均點數</p><p className="mt-1 text-2xl font-black text-slate-900">{monthly?.monthAvgPoints?.toFixed?.(3) ?? '0.000'}</p></div>
              <div><p className="text-xs text-slate-400">月平均達成率</p><p className="mt-1 text-2xl font-black text-slate-900">{monthly?.monthAvgRate?.toFixed?.(2) ?? '0.00'}%</p></div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
