import DashboardLayout, { type DashboardNavItem } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { Boxes, ClipboardCheck, Gauge, PackagePlus, ShieldAlert, ShieldCheck } from "lucide-react";

const MANAGEMENT_VIEWER_ROLES = ["supervisor", "manager", "admin"];

const navItems: DashboardNavItem[] = [
  { label: "站點總覽", path: "/operations", icon: Boxes },
  { label: "匯入作業", path: "/import", icon: PackagePlus, allowedRoles: MANAGEMENT_VIEWER_ROLES },
  { label: "D 站抽樣", path: "/sampling", icon: ClipboardCheck, allowedRoles: MANAGEMENT_VIEWER_ROLES },
  { label: "工程師 KPI", path: "/kpi", icon: Gauge },
  { label: "管理後台", path: "/admin", icon: ShieldCheck, allowedRoles: MANAGEMENT_VIEWER_ROLES },
  { label: "待入庫待比對", path: "/admin/pending-stock-mismatches", icon: ShieldAlert, allowedRoles: MANAGEMENT_VIEWER_ROLES },
];

function formatDisplayPoints(value?: number | null) {
  return `${Number(value ?? 0).toFixed(1)} 點`;
}

function formatPercent(value?: number | null) {
  return `${Number(value ?? 0).toFixed(1)}%`;
}

function formatHours(value?: number | null) {
  return `${Number(value ?? 0).toFixed(1)} 小時`;
}

export default function EngineerKpiPage() {
  const query = trpc.engineer.kpi.useQuery();
  const summary = query.data?.dailySummary;
  const monthly = query.data?.monthlySummary;
  const details = query.data?.details ?? [];
  const supportCompensations = summary?.supportCompensations ?? [];

  const overviewCards = [
    {
      label: "今日表現",
      value: formatDisplayPoints(summary?.displayPoints),
      hint: "前台改用 100 點制，1.0 內部點數 = 100 點。",
    },
    {
      label: "日均表現",
      value: formatDisplayPoints(monthly?.monthAvgDisplayPoints),
      hint: "以本月出勤日與支援補償合併計算。",
    },
    {
      label: "今日支援補償",
      value: `${formatDisplayPoints(summary?.supportDisplayPoints)} / ${formatHours(summary?.supportHours)}`,
      hint: "依 100 點 ÷ 8 小時換算。",
    },
    {
      label: "今日達標率",
      value: formatPercent(summary?.kpiAchievementRate),
      hint: `原始表現 ${formatPercent(summary?.rawAchievementRate)}，超標 ${formatPercent(summary?.overAchievementRate)}`,
    },
  ];

  return (
    <DashboardLayout title="工程師績效頁" navItems={navItems}>
      <div className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-4">
          {overviewCards.map((item) => (
            <Card key={item.label} className="rounded-[26px] border-0 bg-white shadow-sm">
              <CardContent className="p-6">
                <p className="text-sm text-slate-500">{item.label}</p>
                <p className="mt-3 text-3xl font-black tracking-tight text-slate-900">{item.value}</p>
                <p className="mt-3 text-xs leading-5 text-slate-500">{item.hint}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="rounded-[28px] border-0 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-bold">四大 KPI 維度摘要</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <p className="text-sm font-semibold text-slate-900">產能達成</p>
              <p className="mt-2 text-sm text-slate-600">
                今日表現 {formatDisplayPoints(summary?.displayPoints)}，其中支援補償 {formatDisplayPoints(summary?.supportDisplayPoints)}。
              </p>
              <Progress className="mt-4 h-2.5" value={Math.min(summary?.kpiAchievementRate ?? 0, 100)} />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">品質表現</p>
              <p className="mt-2 text-sm text-slate-600">
                抽檢不良率 {formatPercent((summary?.dimensions?.quality?.defectRate ?? 0) * 100)}，返工率 {formatPercent((summary?.dimensions?.quality?.reworkRate ?? 0) * 100)}。
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">時效表現</p>
              <p className="mt-2 text-sm text-slate-600">
                逾期處理 {summary?.dimensions?.timeliness?.overdueHandledCount ?? 0} 件，平均 {Number(summary?.dimensions?.timeliness?.avgProcessingHours ?? 0).toFixed(1)} 小時。
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">出勤公平性</p>
              <p className="mt-2 text-sm text-slate-600">
                月日均 {formatDisplayPoints(monthly?.monthAvgDisplayPoints)}，避免只看月總量造成誤差。
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[1.45fr_1fr]">
          <Card className="rounded-[28px] border-0 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-bold">今日工作明細</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {details.length === 0 && supportCompensations.length === 0 ? (
                <div className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">
                  今日尚無作業點數或支援補償紀錄。
                </div>
              ) : null}
              {details.map((detail, index) => (
                <div key={`${detail.stationCode}-${detail.subtypeCode}-${index}`} className="grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600 md:grid-cols-4">
                  <div><p className="text-xs text-slate-400">站點</p><p className="mt-1 font-semibold text-slate-900">{detail.stationCode}</p></div>
                  <div><p className="text-xs text-slate-400">品類</p><p className="mt-1 font-semibold text-slate-900">{detail.subtypeCode ?? "-"}</p></div>
                  <div><p className="text-xs text-slate-400">完成件數</p><p className="mt-1 font-semibold text-slate-900">{detail.completedQty}</p></div>
                  <div><p className="text-xs text-slate-400">換算表現</p><p className="mt-1 font-semibold text-slate-900">{formatDisplayPoints(Number(detail.earnedPoints) * 100)}</p></div>
                </div>
              ))}
              {supportCompensations.map((item, index) => (
                <div key={`support-${index}`} className="grid gap-3 rounded-2xl border border-amber-100 bg-amber-50/80 p-4 text-sm text-amber-900 md:grid-cols-4">
                  <div><p className="text-xs text-amber-700/80">類型</p><p className="mt-1 font-semibold">支援補償</p></div>
                  <div><p className="text-xs text-amber-700/80">支援任務</p><p className="mt-1 font-semibold">{item.supportTask}</p></div>
                  <div><p className="text-xs text-amber-700/80">支援時數</p><p className="mt-1 font-semibold">{formatHours(item.supportHours)}</p></div>
                  <div><p className="text-xs text-amber-700/80">換算表現</p><p className="mt-1 font-semibold">{formatDisplayPoints(item.supportDisplayPoints)}</p></div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="rounded-[28px] border-0 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-bold">本月累積統計</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 text-sm text-slate-600">
              <div>
                <p className="text-xs text-slate-400">出勤天數</p>
                <p className="mt-1 text-2xl font-black text-slate-900">{monthly?.attendanceDays ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">月總表現</p>
                <p className="mt-1 text-2xl font-black text-slate-900">{formatDisplayPoints(monthly?.monthTotalDisplayPoints)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">月日均表現</p>
                <p className="mt-1 text-2xl font-black text-slate-900">{formatDisplayPoints(monthly?.monthAvgDisplayPoints)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">月平均達成率</p>
                <p className="mt-1 text-2xl font-black text-slate-900">{formatPercent(monthly?.monthAvgRate)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">月支援補償</p>
                <p className="mt-1 text-lg font-bold text-slate-900">
                  {formatDisplayPoints(monthly?.monthSupportDisplayPoints)} / {formatHours(monthly?.monthSupportHours)}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
