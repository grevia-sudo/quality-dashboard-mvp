import DashboardLayout, { type DashboardNavItem } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { Boxes, ClipboardCheck, Gauge, ShieldCheck } from "lucide-react";

const navItems: DashboardNavItem[] = [
  { label: "站點總覽", path: "/", icon: Boxes },
  { label: "D 站抽樣", path: "/sampling", icon: ClipboardCheck },
  { label: "工程師 KPI", path: "/kpi", icon: Gauge },
  { label: "管理後台", path: "/admin", icon: ShieldCheck },
];

export default function AdminPage() {
  const query = trpc.admin.setup.useQuery(undefined, { retry: false });

  return (
    <DashboardLayout title="KPI 儀表板與管理後台" navItems={navItems}>
      <div className="space-y-6">
        <Card className="rounded-[28px] border-0 bg-[#eef2f7] shadow-sm">
          <CardContent className="p-8">
            <Badge className="bg-white/80 text-slate-700">管理者／主管入口</Badge>
            <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-900">掌握產能、品質、時效與出勤公平性</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">這個 MVP 先提供帳號管理、站點規則、品類設定與標準產能設定檢視介面，後續可再延伸成可編輯設定與完整報表分析。</p>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="rounded-[26px] border-0 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-bold">Google Sheet 非同步回寫</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-600">
              <p>目標工作表：<span className="font-semibold text-slate-900">{query.data?.syncSummary?.targetSheetName ?? '手機檢測資料庫'}</span></p>
              <p>待回寫佇列：<span className="font-semibold text-slate-900">{query.data?.syncSummary?.queuedJobs ?? 0}</span></p>
              <p>主流程先寫入 DB，再由非同步程序回寫，不阻塞工程師作業。</p>
            </CardContent>
          </Card>
          <Card className="rounded-[26px] border-0 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-bold">六個月資料歸檔</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-600">
              <p>保留門檻：<span className="font-semibold text-slate-900">{query.data?.archiveSummary?.retentionMonths ?? 6} 個月</span></p>
              <p>待歸檔件數：<span className="font-semibold text-slate-900">{query.data?.archiveSummary?.candidateCount ?? 0}</span></p>
              <p>{query.data?.archiveSummary?.policy ?? '主表僅保留近期資料。'}</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="users" className="space-y-4">
          <TabsList className="grid h-auto w-full grid-cols-2 rounded-2xl bg-white p-1 shadow-sm md:grid-cols-4">
            <TabsTrigger value="users" className="rounded-2xl">帳號管理</TabsTrigger>
            <TabsTrigger value="rules" className="rounded-2xl">站點規則</TabsTrigger>
            <TabsTrigger value="categories" className="rounded-2xl">品類設定</TabsTrigger>
            <TabsTrigger value="targets" className="rounded-2xl">標準產能</TabsTrigger>
          </TabsList>

          {[
            { key: 'users', title: '帳號管理', rows: query.data?.users ?? [], fields: ['name', 'email', 'role'] },
            { key: 'rules', title: '站點規則設定', rows: query.data?.rules ?? [], fields: ['stationCode', 'nextStationCode', 'allowReworkToCode'] },
            { key: 'categories', title: '品類／子分類設定', rows: query.data?.categories ?? [], fields: ['categoryName', 'subtypeCode', 'brandName'] },
            { key: 'targets', title: '標準產能設定', rows: query.data?.targets ?? [], fields: ['stationCode', 'subtypeCode', 'dailyTargetQty', 'baseUnitPoints'] },
          ].map((section) => (
            <TabsContent key={section.key} value={section.key}>
              <Card className="rounded-[28px] border-0 bg-white shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base font-bold">{section.title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {section.rows.map((row: Record<string, unknown>, index: number) => (
                    <div key={index} className="grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600 md:grid-cols-4">
                      {section.fields.map((field) => (
                        <div key={field}>
                          <p className="text-xs text-slate-400">{field}</p>
                          <p className="mt-1 font-semibold text-slate-900">{String(row[field] ?? '-')}</p>
                        </div>
                      ))}
                    </div>
                  ))}
                  {section.rows.length === 0 ? <p className="text-sm text-slate-500">若目前帳號不是 admin，這裡會保留空白或顯示權限限制。</p> : null}
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
