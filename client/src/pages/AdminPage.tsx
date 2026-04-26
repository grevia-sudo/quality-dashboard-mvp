import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
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

const capacityStationOptions = ["A1", "A2", "B", "C", "D", "E"] as const;
type CapacityStationCode = (typeof capacityStationOptions)[number];

type TargetDraft = {
  localKey: string;
  id?: number;
  stationCode: CapacityStationCode;
  categoryId: number;
  categoryName: string;
  brandName: string;
  subtypeCode: string;
  dailyTargetQty: number;
  hourlyTargetQty: string;
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

type CategoryFlowDrafts = Record<number, Array<(typeof stationOptions)[number]>>;

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

function formatHourlyTargetQty(dailyTargetQty: number) {
  if (dailyTargetQty <= 0) {
    return "-";
  }

  return (dailyTargetQty / 8).toFixed(dailyTargetQty % 8 === 0 ? 0 : 1);
}

function formatBaseUnitPoints(dailyTargetQty: number) {
  if (dailyTargetQty <= 0) {
    return "-";
  }

  return (1 / dailyTargetQty).toFixed(6);
}

export default function AdminPage() {
  const { user, loading } = useAuth({ redirectOnUnauthenticated: true });
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const query = trpc.admin.setup.useQuery(undefined, { retry: false });
  const [ruleDrafts, setRuleDrafts] = useState<RuleDraft[]>([]);
  const [targetDrafts, setTargetDrafts] = useState<TargetDraft[]>([]);
  const [optionDrafts, setOptionDrafts] = useState<DefectOptionDraft[]>([]);
  const [categoryFlowDrafts, setCategoryFlowDrafts] = useState<CategoryFlowDrafts>({});
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

    const categories = query.data.categories ?? [];
    const targetMap = new Map<string, (typeof query.data.targets)[number]>();

    (query.data.targets ?? []).forEach((target) => {
      if (!target.categoryId || !capacityStationOptions.includes(target.stationCode as CapacityStationCode)) {
        return;
      }

      targetMap.set(`${target.stationCode}-${target.categoryId}`, target);
    });

    setTargetDrafts(
      capacityStationOptions.flatMap((stationCode) => categories.map((category) => {
        const existing = targetMap.get(`${stationCode}-${category.id}`);
        const dailyTargetQty = Number(existing?.dailyTargetQty ?? 0);
        const brandName = category.brandName ?? category.subtypeCode ?? "-";
        const subtypeCode = brandName === "-" ? category.categoryName : brandName;

        return {
          localKey: `${stationCode}-${category.id}`,
          id: existing?.id,
          stationCode,
          categoryId: category.id,
          categoryName: category.categoryName,
          brandName,
          subtypeCode,
          dailyTargetQty,
          hourlyTargetQty: formatHourlyTargetQty(dailyTargetQty),
          baseUnitPoints: formatBaseUnitPoints(dailyTargetQty),
          active: existing ? Boolean(existing.active) : dailyTargetQty > 0,
        } satisfies TargetDraft;
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

    const nextFlowDrafts = categories.reduce((accumulator, category) => {
      const flowCodes = (query.data.categoryFlows ?? [])
        .filter((item) => item.categoryId === category.id)
        .sort((left, right) => Number(left.stepOrder) - Number(right.stepOrder))
        .map((item) => item.stationCode as (typeof stationOptions)[number]);
      accumulator[category.id] = flowCodes.length > 0 ? flowCodes : [...stationOptions];
      return accumulator;
    }, {} as CategoryFlowDrafts);

    setCategoryFlowDrafts(nextFlowDrafts);
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
      toast.success("產能設定已更新");
      await utils.admin.setup.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "產能設定更新失敗");
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
      toast.success(`已刪除採購單 ${result.poNumber}，共清除 ${result.deletedProducts} 筆商品與 ${result.deletedTasks} 筆站點任務`);
      setDeletePoNumber("");
      await utils.admin.setup.invalidate();
      await utils.station.list.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "刪除採購單失敗");
    },
  });

  const replaceCategoryFlowMutation = trpc.admin.replaceCategoryStationFlow.useMutation({
    onSuccess: async () => {
      toast.success("品類流程已更新");
      await utils.admin.setup.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "品類流程更新失敗");
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

  const updateTargetDraft = (localKey: string, patch: Partial<TargetDraft>) => {
    setTargetDrafts((prev) => prev.map((target) => {
      if (target.localKey !== localKey) {
        return target;
      }

      const nextDraft = { ...target, ...patch };
      const normalizedDailyTargetQty = Math.max(0, Number(nextDraft.dailyTargetQty || 0));
      return {
        ...nextDraft,
        dailyTargetQty: normalizedDailyTargetQty,
        hourlyTargetQty: formatHourlyTargetQty(normalizedDailyTargetQty),
        baseUnitPoints: formatBaseUnitPoints(normalizedDailyTargetQty),
      };
    }));
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

  const toggleCategoryFlowStation = (categoryId: number, stationCode: (typeof stationOptions)[number]) => {
    if (stationCode === "A1" || stationCode === "STOCK") {
      return;
    }

    setCategoryFlowDrafts((prev) => {
      const current = prev[categoryId] ?? [...stationOptions];
      const exists = current.includes(stationCode);
      const next = exists
        ? current.filter((code) => code !== stationCode)
        : [...current, stationCode];

      return {
        ...prev,
        [categoryId]: stationOptions.filter((code) => code === "A1" || code === "STOCK" || next.includes(code)),
      };
    });
  };

  const kpiProgress = query.data?.kpiProgress ?? [];
  const stationLeadTimes = query.data?.stationLeadTimes ?? [];
  const categoryStockCycleTimes = query.data?.categoryStockCycleTimes ?? [];
  const topEngineer = kpiProgress[0];
  const slowestStation = [...stationLeadTimes].sort((left, right) => right.avgDaysFromImport - left.avgDaysFromImport)[0];
  const slowestCategoryToStock = categoryStockCycleTimes[0];

  if (loading) {
    return <DashboardLayout title="KPI 儀表板與管理後台" navItems={navItems}><div className="rounded-[28px] bg-white p-8 text-sm text-slate-500 shadow-sm">正在載入管理權限…</div></DashboardLayout>;
  }

  if (user?.role !== "admin") {
    return (
      <DashboardLayout title="KPI 儀表板與管理後台" navItems={navItems}>
        <Card className="rounded-[28px] border-0 bg-white shadow-sm">
          <CardContent className="space-y-3 p-8">
            <Badge className="bg-[#f7e8ee] text-rose-700">僅限管理者</Badge>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">管理後台僅限 admin 查看</h1>
            <p className="text-sm leading-7 text-slate-600">你目前沒有查看管理後台的權限。若需要調整站點規則、產能、品類流程或管理統計，請使用管理者帳號登入。</p>
            <div className="flex gap-3">
              <Button className="rounded-2xl" onClick={() => setLocation("/operations")}>返回站點總覽</Button>
              <Button variant="outline" className="rounded-2xl" onClick={() => setLocation("/kpi")}>查看工程師 KPI</Button>
            </div>
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="KPI 儀表板與管理後台" navItems={navItems}>
      <div className="space-y-6">
        <Card className="rounded-[28px] border-0 bg-[#eef2f7] shadow-sm">
          <CardContent className="space-y-4 p-8">
            <Badge className="bg-white/80 text-slate-700">管理者／主管入口</Badge>
            <h1 className="text-3xl font-black tracking-tight text-slate-900">依照 ERD 管理站點流程、匯入節奏與 B/C 功能表</h1>
            <p className="max-w-3xl text-sm leading-7 text-slate-600">
              這裡除了既有站點規則外，也可依 A1～E 各站點設定每個品類的每日產能，供後續換算每小時產能與工程師點數；同時保留匯入作業入口，以及 B 站軟測、C 站品檢所需的故障與外觀功能表維護。管理者可直接切換到對應站點檢查實際畫面是否與資料設定一致。
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

        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="rounded-[28px] border-0 bg-white shadow-sm xl:col-span-3">
            <CardHeader>
              <CardTitle className="text-base font-bold">全員 KPI 進度</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-[24px] bg-slate-50 p-4">
                  <p className="text-xs text-slate-400">本月已追蹤工程師</p>
                  <p className="mt-2 text-3xl font-black tracking-tight text-slate-900">{kpiProgress.length}</p>
                </div>
                <div className="rounded-[24px] bg-slate-50 p-4">
                  <p className="text-xs text-slate-400">本月最高平均達標率</p>
                  <p className="mt-2 text-3xl font-black tracking-tight text-slate-900">{topEngineer ? `${topEngineer.avgKpiAchievementRate.toFixed(1)}%` : "0.0%"}</p>
                  <p className="mt-1 text-sm text-slate-500">{topEngineer ? `${topEngineer.name}｜${topEngineer.monthTotalPoints.toFixed(3)} 點` : "尚無資料"}</p>
                </div>
                <div className="rounded-[24px] bg-slate-50 p-4">
                  <p className="text-xs text-slate-400">本月平均 KPI 分數</p>
                  <p className="mt-2 text-3xl font-black tracking-tight text-slate-900">{kpiProgress.length > 0 ? `${(kpiProgress.reduce((sum, item) => sum + item.finalKpiScore, 0) / kpiProgress.length).toFixed(1)}` : "0.0"}</p>
                  <p className="mt-1 text-sm text-slate-500">可用於比對目前整體工程師進度</p>
                </div>
              </div>
              <div className="overflow-x-auto rounded-[24px] bg-slate-50">
                <table className="min-w-full text-sm text-slate-700">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.16em] text-slate-500">
                      <th className="px-4 py-3">工程師</th>
                      <th className="px-4 py-3">角色</th>
                      <th className="px-4 py-3">今日點數</th>
                      <th className="px-4 py-3">本月總點數</th>
                      <th className="px-4 py-3">日均點數</th>
                      <th className="px-4 py-3">平均 KPI 達標率</th>
                      <th className="px-4 py-3">最新 KPI 分數</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kpiProgress.length > 0 ? kpiProgress.map((item) => (
                      <tr key={item.userId} className="border-b border-slate-200/80 last:border-b-0">
                        <td className="px-4 py-3 font-medium text-slate-900">{item.name}<div className="text-xs text-slate-400">{item.username}</div></td>
                        <td className="px-4 py-3">{item.role}</td>
                        <td className="px-4 py-3">{item.todayPoints.toFixed(3)}</td>
                        <td className="px-4 py-3">{item.monthTotalPoints.toFixed(3)}</td>
                        <td className="px-4 py-3">{item.monthAvgPoints.toFixed(3)}</td>
                        <td className="px-4 py-3">{item.avgKpiAchievementRate.toFixed(1)}%</td>
                        <td className="px-4 py-3">{item.finalKpiScore.toFixed(1)}</td>
                      </tr>
                    )) : <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">目前尚無工程師 KPI 資料</td></tr>}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[28px] border-0 bg-white shadow-sm xl:col-span-2">
            <CardHeader>
              <CardTitle className="text-base font-bold">匯入到各節點平均天數</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-[24px] bg-slate-50 p-4 text-sm text-slate-600">
                系統會以商品匯入時間對比各站任務建立／完成時間，讓管理者快速看出哪個節點目前最耗時。
              </div>
              <div className="overflow-x-auto rounded-[24px] bg-slate-50">
                <table className="min-w-full text-sm text-slate-700">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.16em] text-slate-500">
                      <th className="px-4 py-3">節點</th>
                      <th className="px-4 py-3">樣本數</th>
                      <th className="px-4 py-3">平均天數</th>
                      <th className="px-4 py-3">最短</th>
                      <th className="px-4 py-3">最長</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stationLeadTimes.map((item) => (
                      <tr key={item.stationCode} className="border-b border-slate-200/80 last:border-b-0">
                        <td className="px-4 py-3 font-medium text-slate-900">{item.label}</td>
                        <td className="px-4 py-3">{item.sampleCount}</td>
                        <td className="px-4 py-3">{item.avgDaysFromImport.toFixed(2)} 天</td>
                        <td className="px-4 py-3">{item.shortestDays.toFixed(2)} 天</td>
                        <td className="px-4 py-3">{item.longestDays.toFixed(2)} 天</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[28px] border-0 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-bold">待入庫週期摘要</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-slate-600">
              <div className="rounded-[24px] bg-slate-50 p-4">
                <p>最慢品類：<span className="font-semibold text-slate-900">{slowestCategoryToStock ? `${slowestCategoryToStock.categoryName} × ${slowestCategoryToStock.brandName}` : "尚無資料"}</span></p>
                <p className="mt-2">平均週期：<span className="font-semibold text-slate-900">{slowestCategoryToStock ? `${slowestCategoryToStock.avgDaysToStock.toFixed(2)} 天` : "0.00 天"}</span></p>
                <p className="mt-2">最慢站點：<span className="font-semibold text-slate-900">{slowestStation ? `${slowestStation.label}（${slowestStation.avgDaysFromImport.toFixed(2)} 天）` : "尚無資料"}</span></p>
              </div>
              <div className="space-y-3">
                {categoryStockCycleTimes.slice(0, 6).map((item) => (
                  <div key={`${item.categoryName}-${item.brandName}`} className="rounded-[24px] bg-slate-50 p-4">
                    <p className="font-semibold text-slate-900">{item.categoryName} × {item.brandName}</p>
                    <p className="mt-2">平均到待入庫：{item.avgDaysToStock.toFixed(2)} 天</p>
                    <p>最短／最長：{item.shortestDays.toFixed(2)} / {item.longestDays.toFixed(2)} 天</p>
                    <p>樣本數：{item.sampleCount}</p>
                  </div>
                ))}
                {categoryStockCycleTimes.length === 0 ? <div className="rounded-[24px] bg-slate-50 p-4 text-slate-500">目前尚無品類進入待入庫的週期資料</div> : null}
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="rules" className="space-y-4">
          <TabsList className="grid h-auto w-full grid-cols-2 rounded-2xl bg-white p-1 shadow-sm md:grid-cols-5">
            <TabsTrigger value="rules" className="rounded-2xl">站點規則</TabsTrigger>
            <TabsTrigger value="targets" className="rounded-2xl">產能設定</TabsTrigger>
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
                <CardTitle className="text-base font-bold">產能設定</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="rounded-[24px] bg-slate-50 p-4">
                  <p className="text-sm leading-7 text-slate-600">可依 A1、A2、B、C、D、E 各站點，為每個品類／品牌組合輸入每日產能。系統會同步換算每小時產能與單件點數，供後續工程師點數與 KPI 邏輯使用。</p>
                </div>
                {(query.data?.categories ?? []).length > 0 ? capacityStationOptions.map((stationCode) => {
                  const stationTargets = targetDrafts.filter((target) => target.stationCode === stationCode);

                  return (
                    <div key={stationCode} className="space-y-3 rounded-[24px] bg-slate-50 p-5">
                      <div>
                        <p className="text-lg font-bold text-slate-900">{stationCode} 站每日產能</p>
                        <p className="text-xs text-slate-500">例如可設定「A1 × 智慧手機 × Apple = 350」，系統會同步換算為每小時產能與點數。</p>
                      </div>
                      <div className="overflow-x-auto rounded-[24px] bg-white">
                        <table className="min-w-full text-sm text-slate-700">
                          <thead>
                            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.16em] text-slate-500">
                              <th className="px-4 py-3">商品類別</th>
                              <th className="px-4 py-3">品牌</th>
                              <th className="px-4 py-3">每日產能</th>
                              <th className="px-4 py-3">每小時產能</th>
                              <th className="px-4 py-3">單件點數</th>
                              <th className="px-4 py-3">啟用</th>
                              <th className="px-4 py-3 text-right">操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {stationTargets.map((target) => (
                              <tr key={target.localKey} className="border-b border-slate-200/80 last:border-b-0">
                                <td className="px-4 py-3 font-medium text-slate-900">{target.categoryName}</td>
                                <td className="px-4 py-3">{target.brandName}</td>
                                <td className="px-4 py-3">
                                  <Input
                                    type="number"
                                    min={0}
                                    value={target.dailyTargetQty}
                                    onChange={(event) => updateTargetDraft(target.localKey, { dailyTargetQty: Number(event.target.value || 0) })}
                                    className="h-10 min-w-[120px] rounded-2xl border-0 bg-slate-50"
                                  />
                                </td>
                                <td className="px-4 py-3">{target.hourlyTargetQty}</td>
                                <td className="px-4 py-3 font-mono text-xs">{target.baseUnitPoints}</td>
                                <td className="px-4 py-3">
                                  <label className="flex items-center gap-2 text-sm text-slate-600">
                                    <input type="checkbox" checked={target.active} onChange={(event) => updateTargetDraft(target.localKey, { active: event.target.checked })} />
                                    啟用
                                  </label>
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <Button
                                    className="rounded-2xl"
                                    disabled={targetMutation.isPending || target.dailyTargetQty < 1}
                                    onClick={() =>
                                      targetMutation.mutate({
                                        id: target.id,
                                        stationCode: target.stationCode,
                                        categoryId: target.categoryId,
                                        subtypeCode: target.subtypeCode,
                                        dailyTargetQty: Math.max(1, target.dailyTargetQty),
                                        active: target.active,
                                      })
                                    }
                                  >
                                    儲存產能
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                }) : <div className="rounded-[24px] bg-slate-50 p-4 text-sm text-slate-600">目前沒有任何品類設定；請先到「品類設定」新增商品類別與品牌組合，再回來輸入各站每日產能。</div>}
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
                    {(query.data?.categories ?? []).length > 0 ? (query.data?.categories ?? []).map((category) => {
                      const selectedStations = categoryFlowDrafts[category.id] ?? [...stationOptions];
                      return (
                        <div key={category.id} className="space-y-4 rounded-[24px] bg-slate-50 p-4">
                          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-center">
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
                          <div className="space-y-3 rounded-[20px] bg-white/70 p-4">
                            <div>
                              <p className="text-xs text-slate-400">此品類需要經過的節點</p>
                              <p className="mt-1 text-sm text-slate-600">固定從 A1 開始、以待入庫結束；中間節點可依品類勾選，例如智慧手錶可略過 A2、B。</p>
                            </div>
                            <div className="grid gap-3 md:grid-cols-4">
                              {stationOptions.map((stationCode) => {
                                const checked = selectedStations.includes(stationCode);
                                const locked = stationCode === "A1" || stationCode === "STOCK";
                                return (
                                  <label key={`${category.id}-${stationCode}`} className={`flex items-center gap-3 rounded-2xl border px-3 py-2 text-sm ${checked ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700"}`}>
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4"
                                      checked={checked}
                                      disabled={locked}
                                      onChange={() => toggleCategoryFlowStation(category.id, stationCode)}
                                    />
                                    <span>{stationCode === "STOCK" ? "待入庫" : stationCode}</span>
                                  </label>
                                );
                              })}
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <p className="text-xs text-slate-500">目前流程：{selectedStations.map((stationCode) => stationCode === "STOCK" ? "待入庫" : stationCode).join(" → ")}</p>
                              <Button
                                className="rounded-2xl"
                                disabled={replaceCategoryFlowMutation.isPending}
                                onClick={() => replaceCategoryFlowMutation.mutate({ categoryId: category.id, stationCodes: selectedStations })}
                              >
                                儲存流程設定
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    }) : <div className="rounded-[24px] bg-slate-50 p-4 text-sm text-slate-600">目前沒有任何品類設定；請先新增商品類別與品牌組合。</div>}
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
