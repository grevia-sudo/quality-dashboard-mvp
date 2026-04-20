import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import DashboardLayout, { type DashboardNavItem } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { Boxes, ClipboardCheck, Gauge, ShieldCheck } from "lucide-react";

const navItems: DashboardNavItem[] = [
  { label: "站點總覽", path: "/operations", icon: Boxes },
  { label: "D 站抽樣", path: "/sampling", icon: ClipboardCheck },
  { label: "工程師 KPI", path: "/kpi", icon: Gauge },
  { label: "管理後台", path: "/admin", icon: ShieldCheck },
];

const stationOptions = ["A1", "A2", "B", "C", "D", "E", "STOCK"] as const;

type RuleDraft = {
  id: number;
  stationCode: string;
  routeKey: string;
  nextStationCode: string;
  allowReworkToCode: string;
  active: boolean;
  notes: string;
};

type TargetDraft = {
  id: number;
  stationCode: "A1" | "A2" | "B" | "C" | "D" | "E" | "STOCK";
  subtypeCode: string;
  dailyTargetQty: number;
  baseUnitPoints: string;
  active: boolean;
};

export default function AdminPage() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const query = trpc.admin.setup.useQuery(undefined, { retry: false });
  const [ruleDrafts, setRuleDrafts] = useState<RuleDraft[]>([]);
  const [targetDrafts, setTargetDrafts] = useState<TargetDraft[]>([]);

  useEffect(() => {
    if (!query.data) {
      return;
    }

    setRuleDrafts(
      (query.data.rules ?? []).map((rule) => ({
        id: rule.id,
        stationCode: rule.stationCode,
        routeKey: rule.routeKey,
        nextStationCode: rule.nextStationCode ?? "",
        allowReworkToCode: rule.allowReworkToCode ?? "",
        active: Boolean(rule.active),
        notes: rule.notes ?? "",
      })),
    );

    setTargetDrafts(
      (query.data.targets ?? []).map((target) => ({
        id: target.id,
        stationCode: target.stationCode,
        subtypeCode: target.subtypeCode,
        dailyTargetQty: Number(target.dailyTargetQty),
        baseUnitPoints: String(target.baseUnitPoints ?? "0"),
        active: Boolean(target.active),
      })),
    );
  }, [query.data]);

  const ruleMutation = trpc.admin.updateStationRule.useMutation({
    onSuccess: async () => {
      toast.success("站點規則已更新");
      await utils.admin.setup.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "站點規則更新失敗");
    },
  });

  const targetMutation = trpc.admin.updateProductivityTarget.useMutation({
    onSuccess: async () => {
      toast.success("標準產能已更新");
      await utils.admin.setup.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "標準產能更新失敗");
    },
  });

  const updateRuleDraft = (id: number, patch: Partial<RuleDraft>) => {
    setRuleDrafts((prev) => prev.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  };

  const updateTargetDraft = (id: number, patch: Partial<TargetDraft>) => {
    setTargetDrafts((prev) => prev.map((target) => (target.id === id ? { ...target, ...patch } : target)));
  };

  return (
    <DashboardLayout title="KPI 儀表板與管理後台" navItems={navItems}>
      <div className="space-y-6">
        <Card className="rounded-[28px] border-0 bg-[#eef2f7] shadow-sm">
          <CardContent className="space-y-4 p-8">
            <Badge className="bg-white/80 text-slate-700">管理者／主管入口</Badge>
            <h1 className="text-3xl font-black tracking-tight text-slate-900">依照 ERD 管理站點流程、產能設定與 KPI 規則</h1>
            <p className="max-w-3xl text-sm leading-7 text-slate-600">
              這一版把原本只有檢視的管理區改成可直接編輯。你可以在這裡修改各站點的下一站規則、返工站點，以及各站點 × 品類的標準產能，並從右下方快速切去站點總覽或個別作業頁檢查實際畫面。
            </p>
            <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
              <Button variant="outline" className="rounded-2xl" onClick={() => setLocation("/operations")}>站點總覽</Button>
              <Button variant="outline" className="rounded-2xl" onClick={() => setLocation("/station/A1")}>A1 點到貨</Button>
              <Button variant="outline" className="rounded-2xl" onClick={() => setLocation("/station/A2")}>A2 安裝</Button>
              <Button variant="outline" className="rounded-2xl" onClick={() => setLocation("/station/B")}>B 站軟測</Button>
              <Button variant="outline" className="rounded-2xl" onClick={() => setLocation("/station/C")}>C 站品檢</Button>
              <Button variant="outline" className="rounded-2xl" onClick={() => setLocation("/sampling")}>D 站抽樣</Button>
              <Button variant="outline" className="rounded-2xl" onClick={() => setLocation("/station/E")}>E 站抹除</Button>
              <Button variant="outline" className="rounded-2xl" onClick={() => setLocation("/station/STOCK")}>待入庫</Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="rounded-[26px] border-0 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-bold">Google Sheet 非同步回寫</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-600">
              <p>目標工作表：<span className="font-semibold text-slate-900">{query.data?.syncSummary?.targetSheetName ?? "手機檢測資料庫"}</span></p>
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
              <p>{query.data?.archiveSummary?.policy ?? "主表僅保留近期資料。"}</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="rules" className="space-y-4">
          <TabsList className="grid h-auto w-full grid-cols-2 rounded-2xl bg-white p-1 shadow-sm md:grid-cols-4">
            <TabsTrigger value="rules" className="rounded-2xl">站點規則</TabsTrigger>
            <TabsTrigger value="targets" className="rounded-2xl">標準產能</TabsTrigger>
            <TabsTrigger value="users" className="rounded-2xl">帳號管理</TabsTrigger>
            <TabsTrigger value="categories" className="rounded-2xl">品類設定</TabsTrigger>
          </TabsList>

          <TabsContent value="rules">
            <Card className="rounded-[28px] border-0 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-bold">站點規則設定</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {ruleDrafts.map((rule) => (
                  <div key={rule.id} className="space-y-4 rounded-[24px] bg-slate-50 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-lg font-bold text-slate-900">{rule.stationCode === "STOCK" ? "待入庫" : rule.stationCode}</p>
                        <p className="text-xs text-slate-500">routeKey：{rule.routeKey}</p>
                      </div>
                      <label className="flex items-center gap-2 text-sm text-slate-600">
                        <input type="checkbox" checked={rule.active} onChange={(event) => updateRuleDraft(rule.id, { active: event.target.checked })} />
                        啟用
                      </label>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                      <label className="space-y-2 text-sm text-slate-600">
                        <span>流程識別碼</span>
                        <Input value={rule.routeKey} onChange={(event) => updateRuleDraft(rule.id, { routeKey: event.target.value })} className="rounded-2xl border-0 bg-white" />
                      </label>
                      <label className="space-y-2 text-sm text-slate-600">
                        <span>下一站</span>
                        <select value={rule.nextStationCode} onChange={(event) => updateRuleDraft(rule.id, { nextStationCode: event.target.value })} className="h-10 rounded-2xl border-0 bg-white px-3 text-slate-900 shadow-sm outline-none">
                          <option value="">無</option>
                          {stationOptions.map((code) => (
                            <option key={code} value={code}>{code === "STOCK" ? "待入庫" : code}</option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-2 text-sm text-slate-600">
                        <span>返工回站</span>
                        <select value={rule.allowReworkToCode} onChange={(event) => updateRuleDraft(rule.id, { allowReworkToCode: event.target.value })} className="h-10 rounded-2xl border-0 bg-white px-3 text-slate-900 shadow-sm outline-none">
                          <option value="">無</option>
                          {stationOptions.map((code) => (
                            <option key={code} value={code}>{code === "STOCK" ? "待入庫" : code}</option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-2 text-sm text-slate-600 md:col-span-2 xl:col-span-1">
                        <span>規則備註</span>
                        <Input value={rule.notes} onChange={(event) => updateRuleDraft(rule.id, { notes: event.target.value })} className="rounded-2xl border-0 bg-white" />
                      </label>
                    </div>

                    <div className="flex justify-end">
                      <Button
                        className="rounded-2xl"
                        disabled={ruleMutation.isPending}
                        onClick={() =>
                          ruleMutation.mutate({
                            id: rule.id,
                            routeKey: rule.routeKey,
                            nextStationCode: rule.nextStationCode ? (rule.nextStationCode as typeof stationOptions[number]) : null,
                            allowReworkToCode: rule.allowReworkToCode ? (rule.allowReworkToCode as typeof stationOptions[number]) : null,
                            active: rule.active,
                            notes: rule.notes || null,
                          })
                        }
                      >
                        儲存站點規則
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="targets">
            <Card className="rounded-[28px] border-0 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-bold">標準產能設定</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {targetDrafts.map((target) => (
                  <div key={target.id} className="space-y-4 rounded-[24px] bg-slate-50 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-lg font-bold text-slate-900">{target.stationCode} × {target.subtypeCode}</p>
                        <p className="text-xs text-slate-500">依照 ERD 的 productivity_target_configs 管理 dailyTargetQty 與 baseUnitPoints</p>
                      </div>
                      <label className="flex items-center gap-2 text-sm text-slate-600">
                        <input type="checkbox" checked={target.active} onChange={(event) => updateTargetDraft(target.id, { active: event.target.checked })} />
                        啟用
                      </label>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      <label className="space-y-2 text-sm text-slate-600">
                        <span>站點代號</span>
                        <select value={target.stationCode} onChange={(event) => updateTargetDraft(target.id, { stationCode: event.target.value as TargetDraft["stationCode"] })} className="h-10 rounded-2xl border-0 bg-white px-3 text-slate-900 shadow-sm outline-none">
                          {stationOptions.map((code) => (
                            <option key={code} value={code}>{code === "STOCK" ? "待入庫" : code}</option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-2 text-sm text-slate-600">
                        <span>每日標準產能</span>
                        <Input type="number" min={1} value={target.dailyTargetQty} onChange={(event) => updateTargetDraft(target.id, { dailyTargetQty: Number(event.target.value) || 0 })} className="rounded-2xl border-0 bg-white" />
                      </label>
                      <label className="space-y-2 text-sm text-slate-600">
                        <span>單件點數</span>
                        <Input value={target.baseUnitPoints} onChange={(event) => updateTargetDraft(target.id, { baseUnitPoints: event.target.value })} className="rounded-2xl border-0 bg-white" />
                      </label>
                    </div>

                    <div className="flex justify-end">
                      <Button
                        className="rounded-2xl"
                        disabled={targetMutation.isPending || target.dailyTargetQty <= 0}
                        onClick={() =>
                          targetMutation.mutate({
                            id: target.id,
                            stationCode: target.stationCode,
                            dailyTargetQty: target.dailyTargetQty,
                            baseUnitPoints: target.baseUnitPoints,
                            active: target.active,
                          })
                        }
                      >
                        儲存標準產能
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="users">
            <Card className="rounded-[28px] border-0 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-bold">帳號管理</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(query.data?.users ?? []).map((user) => (
                  <div key={user.id} className="grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600 md:grid-cols-3">
                    <div><p className="text-xs text-slate-400">姓名</p><p className="mt-1 font-semibold text-slate-900">{user.name ?? "-"}</p></div>
                    <div><p className="text-xs text-slate-400">Email</p><p className="mt-1 font-semibold text-slate-900">{user.email ?? "-"}</p></div>
                    <div><p className="text-xs text-slate-400">角色</p><p className="mt-1 font-semibold text-slate-900">{user.role}</p></div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="categories">
            <Card className="rounded-[28px] border-0 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-bold">品類／子分類設定</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(query.data?.categories ?? []).map((category) => (
                  <div key={category.id} className="grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600 md:grid-cols-4">
                    <div><p className="text-xs text-slate-400">品類</p><p className="mt-1 font-semibold text-slate-900">{category.categoryName}</p></div>
                    <div><p className="text-xs text-slate-400">子分類</p><p className="mt-1 font-semibold text-slate-900">{category.subtypeCode}</p></div>
                    <div><p className="text-xs text-slate-400">品牌</p><p className="mt-1 font-semibold text-slate-900">{category.brandName ?? "-"}</p></div>
                    <div><p className="text-xs text-slate-400">狀態</p><p className="mt-1 font-semibold text-slate-900">{category.active ? "啟用" : "停用"}</p></div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
