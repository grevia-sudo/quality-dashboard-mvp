import DashboardLayout, { type DashboardNavItem } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { Boxes, ClipboardCheck, Gauge, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";

const navItems: DashboardNavItem[] = [
  { label: "站點總覽", path: "/operations", icon: Boxes },
  { label: "D 站抽樣", path: "/sampling", icon: ClipboardCheck },
  { label: "工程師 KPI", path: "/kpi", icon: Gauge },
  { label: "管理後台", path: "/admin", icon: ShieldCheck },
];

export default function SamplingPage() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const query = trpc.sampling.queue.useQuery();
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const mutation = trpc.sampling.submit.useMutation({
    onSuccess: async () => {
      await utils.sampling.queue.invalidate();
      await utils.station.list.invalidate();
      await utils.dashboard.home.invalidate();
    },
  });

  return (
    <DashboardLayout title="D 站抽樣" navItems={navItems}>
      <div className="space-y-6">
        <Card className="rounded-[28px] border-0 bg-[#eef2f7] shadow-sm">
          <CardContent className="p-8">
            <Badge className="bg-white/80 text-slate-700">抽樣不通過返工回 C 站</Badge>
            <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-900">抽樣清單與結果判定</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">D 站僅負責抽樣結果判定。若抽樣不通過，系統會自動建立返工任務並把異常件送回 C 站重新檢測。</p>
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          {(query.data?.tasks ?? []).map((task) => (
            <Card key={task.taskId} className="rounded-[26px] border-0 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base font-bold">
                  <span>{task.productCode}</span>
                  <Badge variant="secondary">D 站抽樣</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-2xl bg-slate-50 p-4 text-sm leading-7 text-slate-600">
                  <p><span className="font-semibold text-slate-900">商品：</span>{task.productName ?? '-'}</p>
                  <p><span className="font-semibold text-slate-900">品類：</span>{task.subtypeCode ?? '-'}</p>
                  <p><span className="font-semibold text-slate-900">IMEI：</span>{task.imei ?? '-'}</p>
                </div>
                <Textarea
                  placeholder="抽樣不通過時可填寫異常原因"
                  value={reasons[task.taskId] ?? ''}
                  onChange={(event) => setReasons((prev) => ({ ...prev, [task.taskId]: event.target.value }))}
                  className="min-h-28 rounded-2xl border-0 bg-slate-50"
                />
                <div className="flex flex-wrap gap-3">
                  <Button onClick={() => mutation.mutate({ taskId: task.taskId, productId: task.productId, passed: true })}>抽樣通過，送往 E 站</Button>
                  <Button
                    variant="outline"
                    onClick={() => mutation.mutate({ taskId: task.taskId, productId: task.productId, passed: false, defectReason: reasons[task.taskId] || '抽樣不通過' })}
                  >
                    不通過，返工回 C 站
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {(query.data?.tasks?.length ?? 0) === 0 ? (
            <Card className="rounded-[26px] border-0 bg-white shadow-sm xl:col-span-2">
              <CardContent className="p-8 text-sm leading-7 text-slate-600">目前沒有待抽樣案件。你可以返回站點總覽，切換到其他站點支援作業。</CardContent>
            </Card>
          ) : null}
        </div>

        <Button variant="outline" className="rounded-2xl" onClick={() => setLocation('/operations')}>
          返回站點總覽
        </Button>
      </div>
    </DashboardLayout>
  );
}
