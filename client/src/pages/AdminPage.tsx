import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import DashboardLayout, { type DashboardNavItem } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { Boxes, ClipboardCheck, Gauge, PackagePlus, ShieldCheck, Trash2 } from "lucide-react";

const navItems: DashboardNavItem[] = [
  { label: "站點總覽", path: "/operations", icon: Boxes },
  { label: "匯入作業", path: "/import", icon: PackagePlus },
  { label: "D 站抽樣", path: "/sampling", icon: ClipboardCheck },
  { label: "工程師 KPI", path: "/kpi", icon: Gauge },
  { label: "管理後台", path: "/admin", icon: ShieldCheck },
];

const stationOptions = ["A1", "A2", "B", "C", "D", "E", "STOCK"] as const;
type OptionStationCode = "B" | "C";
type OptionType = "fault" | "appearance" | "camera";

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

type DefectOptionDraft = {
  localKey: string;
  id?: number;
  stationCode: OptionStationCode;
  optionType: OptionType;
  label: string;
  active: boolean;
  sortOrder: number;
};

function createNewOptionDraft(stationCode: OptionStationCode, optionType: OptionType): DefectOptionDraft {
  return {
    localKey: `${stationCode}-${optionType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    stationCode,
    optionType,
    label: "",
    active: true,
    sortOrder: 0,
  };
}

export default function AdminPage() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const query = trpc.admin.setup.useQuery(undefined, { retry: false });
  const [ruleDrafts, setRuleDrafts] = useState<RuleDraft[]>([]);
  const [targetDrafts, setTargetDrafts] = useState<TargetDraft[]>([]);
  const [optionDrafts, setOptionDrafts] = useState<DefectOptionDraft[]>([]);
  const [newProductName, setNewProductName] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newBrandName, setNewBrandName] = useState("");
  const [deletePoNumber, setDeletePoNumber] = useState("PO-20260422-21");
  const [newUsername, setNewUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserRole, setNewUserRole] = useState<"user" | "admin" | "manager" | "engineer" | "supervisor">("user");

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

    setOptionDrafts(
      (query.data.defectOptions ?? []).map((option) => ({
        localKey: `existing-${option.id}`,
        id: option.id,
        stationCode: option.stationCode as OptionStationCode,
        optionType: option.optionType as OptionType,
        label: option.label,
        active: Boolean(option.active),
        sortOrder: Number(option.sortOrder ?? 0),
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

  const optionMutation = trpc.admin.upsertDefectOption.useMutation({
    onSuccess: async () => {
      toast.success("功能表項目已更新");
      await utils.admin.setup.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "功能表項目更新失敗");
    },
  });

  const createProductNameMutation = trpc.admin.createProductNameOption.useMutation({
    onSuccess: async () => {
      toast.success("品名已新增");
      setNewProductName("");
      await utils.admin.setup.invalidate();
      await utils.station.productNameOptions.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "品名新增失敗");
    },
  });

  const deleteProductNameMutation = trpc.admin.deleteProductNameOption.useMutation({
    onSuccess: async () => {
      toast.success("品名已刪除");
      await utils.admin.setup.invalidate();
      await utils.station.productNameOptions.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "品名刪除失敗");
    },
  });

  const createCategoryMutation = trpc.admin.createProductCategoryOption.useMutation({
    onSuccess: async () => {
      toast.success("品類已新增");
      setNewCategoryName("");
      setNewBrandName("");
      await utils.admin.setup.invalidate();
      await utils.station.productCategoryOptions.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "品類新增失敗");
    },
  });

  const deleteCategoryMutation = trpc.admin.deleteProductCategoryOption.useMutation({
    onSuccess: async () => {
      toast.success("品類已刪除");
      await utils.admin.setup.invalidate();
      await utils.station.productCategoryOptions.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "品類刪除失敗");
    },
  });

  const clearCategoriesMutation = trpc.admin.clearProductCategoryOptions.useMutation({
    onSuccess: async (result) => {
      toast.success(`已清空 ${result.clearedCount} 筆品類設定`);
      await utils.admin.setup.invalidate();
      await utils.station.productCategoryOptions.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "清空品類失敗");
    },
  });

  const deletePoMutation = trpc.admin.deleteImportedPurchaseOrder.useMutation({
    onSuccess: async (result) => {
      toast.success(`已刪除 ${result.poNumber}`);
      await utils.admin.setup.invalidate();
      await utils.station.detail.invalidate({ stationCode: "A1" });
      await utils.station.list.invalidate();
      await utils.dashboard.home.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "刪除採購單失敗");
    },
  });

  const createUserMutation = trpc.admin.createUser.useMutation({
    onSuccess: async () => {
      toast.success("新帳號已建立");
      setNewUsername("");
      setNewUserPassword("");
      setNewUserName("");
      setNewUserRole("user");
      await utils.admin.setup.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "新增帳號失敗");
    },
  });

  const updateRuleDraft = (id: number, patch: Partial<RuleDraft>) => {
    setRuleDrafts((prev) => prev.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  };

  const updateTargetDraft = (id: number, patch: Partial<TargetDraft>) => {
    setTargetDrafts((prev) => prev.map((target) => (target.id === id ? { ...target, ...patch } : target)));
  };

  const updateOptionDraft = (localKey: string, patch: Partial<DefectOptionDraft>) => {
    setOptionDrafts((prev) => prev.map((option) => (option.localKey === localKey ? { ...option, ...patch } : option)));
  };

  const appendOptionDraft = (stationCode: OptionStationCode, optionType: OptionType) => {
    setOptionDrafts((prev) => [...prev, createNewOptionDraft(stationCode, optionType)]);
  };

  const groupedOptionDrafts = useMemo(
    () => ({
      bFault: optionDrafts.filter((option) => option.stationCode === "B" && option.optionType === "fault"),
      cFault: optionDrafts.filter((option) => option.stationCode === "C" && option.optionType === "fault"),
      cAppearance: optionDrafts.filter((option) => option.stationCode === "C" && option.optionType === "appearance"),
      cCamera: optionDrafts.filter((option) => option.stationCode === "C" && option.optionType === "camera"),
    }),
    [optionDrafts],
  );

  return (
    <DashboardLayout title="KPI 儀表板與管理後台" navItems={navItems}>
      <div className="space-y-6">
        <Card className="rounded-[28px] border-0 bg-[#eef2f7] shadow-sm">
          <CardContent className="space-y-4 p-8">
            <Badge className="bg-white/80 text-slate-700">管理者／主管入口</Badge>
            <h1 className="text-3xl font-black tracking-tight text-slate-900">依照 ERD 管理站點流程、匯入節奏與 B/C 功能表</h1>
            <p className="max-w-3xl text-sm leading-7 text-slate-600">
              這裡除了既有站點規則與標準產能外，也補上匯入作業入口，以及 B 站軟測、C 站品檢所需的故障與外觀功能表維護。管理者可直接切換到對應站點檢查實際畫面是否與資料設定一致。
            </p>
            <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-9">
              <Button variant="outline" className="rounded-2xl" onClick={() => setLocation("/operations")}>站點總覽</Button>
              <Button variant="outline" className="rounded-2xl" onClick={() => setLocation("/import")}>匯入作業</Button>
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

        <div className="grid gap-4 md:grid-cols-3">
          <Card className="rounded-[26px] border-0 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-bold">Google Sheet 非同步回寫</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-600">
              <p>目標工作表：<span className="font-semibold text-slate-900">{query.data?.syncSummary?.targetSheetName ?? "手機檢測資料庫"}</span></p>
              <p>待回寫佇列：<span className="font-semibold text-slate-900">{query.data?.syncSummary?.queuedJobs ?? 0}</span></p>
              <p>主流程先寫入 DB，再由非同步程序回寫，不阻塞現場操作。</p>
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
          <Card className="rounded-[26px] border-0 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-bold">功能表與品名統計</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-600">
              <p>B 站故障選項：<span className="font-semibold text-slate-900">{groupedOptionDrafts.bFault.length}</span></p>
              <p>C 站螢幕狀態選項：<span className="font-semibold text-slate-900">{groupedOptionDrafts.cFault.length}</span></p>
              <p>C 站機身外觀選項：<span className="font-semibold text-slate-900">{groupedOptionDrafts.cAppearance.length}</span></p>
              <p>C 站鏡頭狀態選項：<span className="font-semibold text-slate-900">{groupedOptionDrafts.cCamera.length}</span></p>
              <p>可用品名數：<span className="font-semibold text-slate-900">{query.data?.productNameOptions?.length ?? 0}</span></p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="rules" className="space-y-4">
          <TabsList className="grid h-auto w-full grid-cols-2 rounded-2xl bg-white p-1 shadow-sm md:grid-cols-5">
            <TabsTrigger value="rules" className="rounded-2xl">站點規則</TabsTrigger>
            <TabsTrigger value="targets" className="rounded-2xl">標準產能</TabsTrigger>
            <TabsTrigger value="menus" className="rounded-2xl">功能表設定</TabsTrigger>
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
                        <p className="text-xs text-slate-500">依站點與子分類設定標準產能與單位點數</p>
                      </div>
                      <label className="flex items-center gap-2 text-sm text-slate-600">
                        <input type="checkbox" checked={target.active} onChange={(event) => updateTargetDraft(target.id, { active: event.target.checked })} />
                        啟用
                      </label>
                    </div>
                    <div className="grid gap-4 md:grid-cols-3">
                      <label className="space-y-2 text-sm text-slate-600">
                        <span>站點</span>
                        <select value={target.stationCode} onChange={(event) => updateTargetDraft(target.id, { stationCode: event.target.value as TargetDraft["stationCode"] })} className="h-10 rounded-2xl border-0 bg-white px-3 text-slate-900 shadow-sm outline-none">
                          {stationOptions.map((code) => (
                            <option key={code} value={code}>{code === "STOCK" ? "待入庫" : code}</option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-2 text-sm text-slate-600">
                        <span>每日目標件數</span>
                        <Input type="number" value={target.dailyTargetQty} onChange={(event) => updateTargetDraft(target.id, { dailyTargetQty: Number(event.target.value || 0) })} className="rounded-2xl border-0 bg-white" />
                      </label>
                      <label className="space-y-2 text-sm text-slate-600">
                        <span>單位點數</span>
                        <Input value={target.baseUnitPoints} onChange={(event) => updateTargetDraft(target.id, { baseUnitPoints: event.target.value })} className="rounded-2xl border-0 bg-white" />
                      </label>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        className="rounded-2xl"
                        disabled={targetMutation.isPending}
                        onClick={() =>
                          targetMutation.mutate({
                            id: target.id,
                            stationCode: target.stationCode,
                            dailyTargetQty: Math.max(1, target.dailyTargetQty),
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

          <TabsContent value="menus">
            <div className="grid gap-4 xl:grid-cols-3">
              {[
                { key: "bFault", title: "B 站軟測故障狀態", stationCode: "B" as const, optionType: "fault" as const, tone: "bg-[#eef2f7]" },
                { key: "cFault", title: "C 站螢幕狀態", stationCode: "C" as const, optionType: "fault" as const, tone: "bg-[#eef2f7]" },
                { key: "cAppearance", title: "C 站機身外觀", stationCode: "C" as const, optionType: "appearance" as const, tone: "bg-[#f7e8ee]" },
                { key: "cCamera", title: "C 站鏡頭狀態", stationCode: "C" as const, optionType: "camera" as const, tone: "bg-[#eef7f3]" },
              ].map((section) => {
                const sectionItems = groupedOptionDrafts[section.key as keyof typeof groupedOptionDrafts];

                return (
                  <Card key={section.key} className="rounded-[28px] border-0 bg-white shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-base font-bold text-slate-900">{section.title}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {sectionItems.map((option) => (
                        <div key={option.localKey} className={`space-y-3 rounded-[24px] ${section.tone} p-4`}>
                          <label className="space-y-2 text-sm text-slate-600">
                            <span>項目名稱</span>
                            <Input value={option.label} onChange={(event) => updateOptionDraft(option.localKey, { label: event.target.value })} className="rounded-2xl border-0 bg-white" placeholder="例如 觸控異常" />
                          </label>
                          <div className="grid gap-3 md:grid-cols-2">
                            <label className="space-y-2 text-sm text-slate-600">
                              <span>排序</span>
                              <Input type="number" value={option.sortOrder} onChange={(event) => updateOptionDraft(option.localKey, { sortOrder: Number(event.target.value || 0) })} className="rounded-2xl border-0 bg-white" />
                            </label>
                            <label className="flex items-center gap-2 self-end rounded-2xl bg-white px-4 py-3 text-sm text-slate-600">
                              <input type="checkbox" checked={option.active} onChange={(event) => updateOptionDraft(option.localKey, { active: event.target.checked })} />
                              啟用
                            </label>
                          </div>
                          <div className="flex justify-end">
                            <Button
                              className="rounded-2xl"
                              disabled={optionMutation.isPending || !option.label.trim()}
                              onClick={() =>
                                optionMutation.mutate({
                                  id: option.id,
                                  stationCode: option.stationCode,
                                  optionType: option.optionType,
                                  label: option.label.trim(),
                                  active: option.active,
                                  sortOrder: option.sortOrder,
                                })
                              }
                            >
                              儲存功能表項目
                            </Button>
                          </div>
                        </div>
                      ))}
                      <Button variant="outline" className="w-full rounded-2xl" onClick={() => appendOptionDraft(section.stationCode, section.optionType)}>
                        新增一個項目
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="users">
            <Card className="rounded-[28px] border-0 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-bold">帳號管理</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="rounded-[24px] bg-slate-50 p-4 text-sm leading-7 text-slate-600">
                  管理者可直接建立本地帳號密碼，供現場工程師、主管或管理者登入使用。
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_220px_auto] xl:items-end">
                  <label className="space-y-2 text-sm text-slate-600">
                    <span>帳號</span>
                    <Input value={newUsername} onChange={(event) => setNewUsername(event.target.value)} className="rounded-2xl border-0 bg-slate-50" placeholder="例如 rita.lin" />
                  </label>
                  <label className="space-y-2 text-sm text-slate-600">
                    <span>密碼</span>
                    <Input type="password" value={newUserPassword} onChange={(event) => setNewUserPassword(event.target.value)} className="rounded-2xl border-0 bg-slate-50" placeholder="至少 6 碼" />
                  </label>
                  <label className="space-y-2 text-sm text-slate-600">
                    <span>名稱</span>
                    <Input value={newUserName} onChange={(event) => setNewUserName(event.target.value)} className="rounded-2xl border-0 bg-slate-50" placeholder="例如 林小美" />
                  </label>
                  <label className="space-y-2 text-sm text-slate-600">
                    <span>角色</span>
                    <select value={newUserRole} onChange={(event) => setNewUserRole(event.target.value as typeof newUserRole)} className="h-10 rounded-2xl border-0 bg-slate-50 px-3 text-slate-900 shadow-sm outline-none">
                      <option value="user">user</option>
                      <option value="engineer">engineer</option>
                      <option value="supervisor">supervisor</option>
                      <option value="manager">manager</option>
                      <option value="admin">admin</option>
                    </select>
                  </label>
                  <Button
                    className="rounded-2xl"
                    disabled={createUserMutation.isPending || !newUsername.trim() || newUserPassword.length < 6}
                    onClick={() => createUserMutation.mutate({
                      username: newUsername.trim(),
                      password: newUserPassword,
                      name: newUserName.trim() || undefined,
                      role: newUserRole,
                    })}
                  >
                    新增帳號
                  </Button>
                </div>
                <div className="overflow-x-auto rounded-[24px] bg-slate-50">
                  <table className="min-w-full text-sm text-slate-700">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.16em] text-slate-500">
                        <th className="px-4 py-3">帳號</th>
                        <th className="px-4 py-3">名稱</th>
                        <th className="px-4 py-3">Email</th>
                        <th className="px-4 py-3">角色</th>
                        <th className="px-4 py-3">登入方式</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(query.data?.users ?? []).map((user) => (
                        <tr key={user.id} className="border-b border-slate-200/80 last:border-b-0">
                          <td className="px-4 py-3 font-medium text-slate-900">{user.username ?? "-"}</td>
                          <td className="px-4 py-3">{user.name ?? "-"}</td>
                          <td className="px-4 py-3">{user.email ?? "-"}</td>
                          <td className="px-4 py-3">{user.role}</td>
                          <td className="px-4 py-3">{user.loginMethod ?? "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="categories">
            <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <Card className="rounded-[28px] border-0 bg-white shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base font-bold">品類設定</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-[24px] bg-slate-50 p-4">
                    <p className="text-sm leading-7 text-slate-600">匯入作業改為分開選擇「商品類別」與「品牌」。這裡新增或刪除的組合，會同步提供給匯入作業頁與 A1 點到貨頁使用。</p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                    <Input value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} className="rounded-2xl border-0 bg-slate-50" placeholder="商品類別，例如 智慧手機" />
                    <Input value={newBrandName} onChange={(event) => setNewBrandName(event.target.value)} className="rounded-2xl border-0 bg-slate-50" placeholder="品牌，例如 Apple" />
                    <Button
                      className="rounded-2xl"
                      disabled={createCategoryMutation.isPending || !newCategoryName.trim() || !newBrandName.trim()}
                      onClick={() => createCategoryMutation.mutate({ categoryName: newCategoryName.trim(), brandName: newBrandName.trim() })}
                    >
                      新增品類
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Input value={deletePoNumber} onChange={(event) => setDeletePoNumber(event.target.value)} className="max-w-sm rounded-2xl border-0 bg-slate-50" placeholder="輸入要刪除的 PO 單號" />
                    <Button
                      variant="outline"
                      className="rounded-2xl"
                      disabled={deletePoMutation.isPending || !deletePoNumber.trim()}
                      onClick={() => deletePoMutation.mutate({ poNumber: deletePoNumber.trim() })}
                    >
                      刪除指定採購單
                    </Button>
                    <Button
                      variant="outline"
                      className="rounded-2xl border-red-200 text-red-600 hover:bg-red-50"
                      disabled={clearCategoriesMutation.isPending}
                      onClick={() => clearCategoriesMutation.mutate()}
                    >
                      清空所有品類設定
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {(query.data?.categories ?? []).length > 0 ? (query.data?.categories ?? []).map((category) => (
                      <div key={category.id} className="grid gap-3 rounded-[24px] bg-slate-50 p-4 md:grid-cols-[1fr_1fr_auto] md:items-center">
                        <div>
                          <p className="text-xs text-slate-400">商品類別</p>
                          <p className="mt-1 font-semibold text-slate-900">{category.categoryName}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-400">品牌</p>
                          <p className="mt-1 font-semibold text-slate-900">{category.brandName ?? category.subtypeCode ?? "-"}</p>
                        </div>
                        <Button
                          variant="outline"
                          className="rounded-2xl"
                          disabled={deleteCategoryMutation.isPending}
                          onClick={() => deleteCategoryMutation.mutate({ id: category.id })}
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> 刪除
                        </Button>
                      </div>
                    )) : <div className="rounded-[24px] bg-slate-50 p-4 text-sm text-slate-600">目前沒有任何品類設定；請先新增商品類別與品牌組合。</div>}
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-[28px] border-0 bg-white shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base font-bold">品名管理</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-[24px] bg-slate-50 p-4">
                    <p className="text-sm leading-7 text-slate-600">這裡新增或刪除的品名，會同步提供給匯入作業頁與 A1 點到貨頁的下拉式選單使用。</p>
                  </div>
                  <div className="flex gap-3">
                    <Input value={newProductName} onChange={(event) => setNewProductName(event.target.value)} className="rounded-2xl border-0 bg-slate-50" placeholder="例如 iPhone 14 Pro" />
                    <Button
                      className="rounded-2xl"
                      disabled={createProductNameMutation.isPending || !newProductName.trim()}
                      onClick={() => createProductNameMutation.mutate({ label: newProductName.trim() })}
                    >
                      新增品名
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {(query.data?.productNameOptions ?? []).map((option) => (
                      <div key={option.id} className="flex items-center justify-between gap-3 rounded-[24px] bg-slate-50 p-4">
                        <div>
                          <p className="font-semibold text-slate-900">{option.label}</p>
                          <p className="text-xs text-slate-500">排序 {option.sortOrder}</p>
                        </div>
                        <Button
                          variant="outline"
                          className="rounded-2xl"
                          disabled={deleteProductNameMutation.isPending}
                          onClick={() => deleteProductNameMutation.mutate({ id: option.id })}
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> 刪除
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
