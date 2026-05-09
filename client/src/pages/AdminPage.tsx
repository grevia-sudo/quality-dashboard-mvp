import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import DashboardLayout, { type DashboardNavItem } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { analyzeProductTraceResults } from "@/lib/adminProductTrace";
import { trpc } from "@/lib/trpc";
import { Boxes, ClipboardCheck, Database, Gauge, PackagePlus, Search, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";

const MANAGEMENT_VIEWER_ROLES = ["supervisor", "manager", "admin"];

type AdminSectionId = "rules" | "targets" | "menus" | "tools" | "inventory-history" | "support" | "users" | "categories";

const adminSections: Array<{ id: AdminSectionId; label: string; path: string; description: string }> = [
  { id: "rules", label: "站點規則", path: "/admin/rules", description: "設定各站流程、下一站與返工規則。" },
  { id: "targets", label: "產能設定", path: "/admin/targets", description: "維護各站點在不同品類與品牌下的每日產能。" },
  { id: "menus", label: "功能表設定", path: "/admin/menus", description: "管理 B、C 站使用的故障與外觀選項。" },
  { id: "tools", label: "資料工具", path: "/admin/tools", description: "集中處理備份還原、商品追蹤與資料同步工具。" },
  { id: "inventory-history", label: "庫存異動紀錄", path: "/admin/inventory-history", description: "查詢商品從匯入到待入庫與入庫的完整異動時間軸。" },
  { id: "support", label: "支援補償", path: "/admin/support", description: "登記跨站支援時數並檢視補償紀錄。" },
  { id: "users", label: "帳號管理", path: "/admin/users", description: "建立本地帳號並檢視現有登入資訊。" },
  { id: "categories", label: "品類設定", path: "/admin/categories", description: "維護品類流程與品名來源資料。" },
];

function resolveAdminSectionId(pathname: string): AdminSectionId {
  if (pathname === "/admin") {
    return "rules";
  }

  const matchedSection = adminSections.find((section) => section.path === pathname || pathname.startsWith(`${section.path}/`));
  return matchedSection?.id ?? "rules";
}

const navItems: DashboardNavItem[] = [
  { label: "站點總覽", path: "/operations", icon: Boxes },
  { label: "匯入作業", path: "/import", icon: PackagePlus, allowedRoles: MANAGEMENT_VIEWER_ROLES },
  { label: "D 站抽樣", path: "/sampling", icon: ClipboardCheck, allowedRoles: MANAGEMENT_VIEWER_ROLES },
  { label: "工程師 KPI", path: "/kpi", icon: Gauge },
  {
    label: "管理後台",
    path: "/admin",
    icon: ShieldCheck,
    allowedRoles: MANAGEMENT_VIEWER_ROLES,
    matchPaths: adminSections.map((section) => section.path),
    subItems: adminSections.map((section) => ({ label: section.label, path: section.path })),
  },
  { label: "待入庫待比對", path: "/admin/pending-stock-mismatches", icon: ShieldAlert, allowedRoles: MANAGEMENT_VIEWER_ROLES },
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
type CategoryFlowCopyTargets = Record<number, string>;

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

function formatDisplayPoints(value?: number | null) {
  return `${Number(value ?? 0).toFixed(1)} 點`;
}

function formatSupportHours(value?: number | null) {
  return `${Number(value ?? 0).toFixed(1)} 小時`;
}

export default function AdminPage() {
  const { user, loading } = useAuth({ redirectOnUnauthenticated: true });
  const [location, setLocation] = useLocation();
  const isAdminHome = location === "/admin";
  const activeAdminSection = resolveAdminSectionId(location);
  const activeAdminSectionMeta = adminSections.find((section) => section.id === activeAdminSection) ?? adminSections[0];
  const utils = trpc.useUtils();
  const [appliedKpiRange, setAppliedKpiRange] = useState<{ startDate?: string; endDate?: string }>({});
  const query = trpc.admin.setup.useQuery({
    startDate: appliedKpiRange.startDate || undefined,
    endDate: appliedKpiRange.endDate || undefined,
  }, { retry: false });
  const canViewAdminPage = Boolean(user?.role && MANAGEMENT_VIEWER_ROLES.includes(user.role));
  const isAdmin = user?.role === "admin";
  const [ruleDrafts, setRuleDrafts] = useState<RuleDraft[]>([]);
  const [targetDrafts, setTargetDrafts] = useState<TargetDraft[]>([]);
  const [optionDrafts, setOptionDrafts] = useState<DefectOptionDraft[]>([]);
  const [categoryFlowDrafts, setCategoryFlowDrafts] = useState<CategoryFlowDrafts>({});
  const [categoryFlowCopyTargets, setCategoryFlowCopyTargets] = useState<CategoryFlowCopyTargets>({});
  const [categoryFlowCategorySearch, setCategoryFlowCategorySearch] = useState("");
  const [categoryFlowBrandSearch, setCategoryFlowBrandSearch] = useState("");
  const [kpiFilterStartDate, setKpiFilterStartDate] = useState("");
  const [kpiFilterEndDate, setKpiFilterEndDate] = useState("");
  const lastLoadedKpiRangeRef = useRef<{ startDate: string; endDate: string } | null>(null);
  const [newProductName, setNewProductName] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newBrandName, setNewBrandName] = useState("");
  const [backupPoNumber, setBackupPoNumber] = useState("");
  const [backupLabel, setBackupLabel] = useState("");
  const [deletePoNumber, setDeletePoNumber] = useState("PO-20260422-21");
  const [productTraceKeyword, setProductTraceKeyword] = useState("");
  const [submittedProductTraceKeyword, setSubmittedProductTraceKeyword] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserRole, setNewUserRole] = useState<"user" | "admin" | "manager" | "engineer" | "supervisor">("user");
  const [supportCompBusinessDate, setSupportCompBusinessDate] = useState("");
  const [supportCompUserId, setSupportCompUserId] = useState("");
  const [supportCompTask, setSupportCompTask] = useState("");
  const [supportCompHours, setSupportCompHours] = useState("1");
  const [supportCompNotes, setSupportCompNotes] = useState("");
  const importBackupQuery = trpc.admin.importBackups.useQuery(undefined, { retry: false });
  const productTraceQuery = trpc.admin.productTrace.useQuery({
    keyword: submittedProductTraceKeyword,
  }, {
    enabled: submittedProductTraceKeyword.trim().length > 0,
    retry: false,
  });

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
    setCategoryFlowCopyTargets((prev) => {
      const nextEntries = categories.map((category) => [category.id, prev[category.id] ?? ""] as const);
      return Object.fromEntries(nextEntries) as CategoryFlowCopyTargets;
    });

    const nextRange = {
      startDate: query.data.kpiRange?.startDate ?? "",
      endDate: query.data.kpiRange?.endDate ?? "",
    };
    const lastLoadedRange = lastLoadedKpiRangeRef.current;
    const shouldSyncDraftRange = !lastLoadedRange
      || (kpiFilterStartDate === lastLoadedRange.startDate && kpiFilterEndDate === lastLoadedRange.endDate)
      || (!kpiFilterStartDate && !kpiFilterEndDate);

    if (shouldSyncDraftRange) {
      setKpiFilterStartDate(nextRange.startDate);
      setKpiFilterEndDate(nextRange.endDate);
    }

    lastLoadedKpiRangeRef.current = nextRange;
  }, [query.data, kpiFilterEndDate, kpiFilterStartDate]);

  const saveAllSettingsMutation = trpc.admin.saveAllSettings.useMutation({
    onSuccess: async () => {
      await utils.admin.setup.invalidate();
      await utils.station.productCategoryOptions.invalidate();
      toast.success("全部儲存成功，已更新站點規則、產能設定、功能表設定與品類流程");
    },
    onError: (error) => {
      toast.error(error.message || "全部儲存失敗");
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

  const syncProductNamesFromSheetMutation = trpc.admin.syncProductNameOptionsFromSheet.useMutation({
    onSuccess: async (result) => {
      toast.success(`已從 Google 試算表同步 ${result.insertedLabels} 筆品名`);
      await utils.admin.setup.invalidate();
      await utils.station.productNameOptions.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "品名同步失敗");
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

  const createImportBackupMutation = trpc.admin.createImportBackup.useMutation({
    onSuccess: async (result) => {
      toast.success(`已建立備份 ${result?.backupLabel ?? result?.poNumber ?? "匯入批次"}`);
      setBackupPoNumber("");
      setBackupLabel("");
      await importBackupQuery.refetch();
    },
    onError: (error) => {
      toast.error(error.message || "建立備份失敗");
    },
  });

  const restoreImportBackupMutation = trpc.admin.restoreImportBackup.useMutation({
    onSuccess: async (result) => {
      toast.success(`已從備份還原 ${result.poNumber}，共恢復 ${result.restoredCount} 筆商品`);
      await importBackupQuery.refetch();
      await utils.admin.setup.invalidate();
      await utils.station.list.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "還原備份失敗");
    },
  });

  const deletePoMutation = trpc.admin.deleteImportedPurchaseOrder.useMutation({
    onSuccess: async (result) => {
      const successMessage = `已刪除採購單 ${result.poNumber}，共清除 ${result.deletedProducts} 筆商品與 ${result.deletedTasks} 筆站點任務`;
      if (result.resultStatus === "partial_success") {
        toast.warning(`${successMessage}；${result.googleSheetSyncMessage}`);
      } else {
        toast.success(`${successMessage}；${result.googleSheetSyncMessage}`);
      }
      setDeletePoNumber("");
      await utils.admin.setup.invalidate();
      await utils.station.list.invalidate();
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

  const createSupportCompensationMutation = trpc.admin.createSupportCompensation.useMutation({
    onSuccess: async () => {
      toast.success("支援補償已登記");
      setSupportCompTask("");
      setSupportCompHours("1");
      setSupportCompNotes("");
      await utils.admin.setup.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "支援補償登記失敗");
    },
  });

  const deleteSupportCompensationMutation = trpc.admin.deleteSupportCompensation.useMutation({
    onSuccess: async () => {
      toast.success("支援補償已刪除");
      await utils.admin.setup.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "支援補償刪除失敗");
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

  const handleProductTraceSearch = () => {
    const nextKeyword = productTraceKeyword.trim();
    if (!nextKeyword) {
      toast.error("請先輸入商品批號或序號");
      return;
    }
    setSubmittedProductTraceKeyword(nextKeyword);
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

  const categories = query.data?.categories ?? [];
  const normalizedCategorySearch = categoryFlowCategorySearch.trim().toLowerCase();
  const normalizedBrandSearch = categoryFlowBrandSearch.trim().toLowerCase();
  const filteredFlowCategories = useMemo(
    () => categories.filter((category) => {
      const matchesCategory = !normalizedCategorySearch || category.categoryName.toLowerCase().includes(normalizedCategorySearch);
      const brandLabel = (category.brandName ?? category.subtypeCode ?? "").toLowerCase();
      const matchesBrand = !normalizedBrandSearch || brandLabel.includes(normalizedBrandSearch);
      return matchesCategory && matchesBrand;
    }),
    [categories, normalizedCategorySearch, normalizedBrandSearch],
  );
  const analyzedProductTraceResults = useMemo(
    () => analyzeProductTraceResults(productTraceQuery.data ?? []),
    [productTraceQuery.data],
  );
  const inventoryMovementResults = productTraceQuery.data ?? [];

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
  const supportCompensations = query.data?.supportCompensations ?? [];
  const stationLeadTimes = query.data?.stationLeadTimes ?? [];
  const categoryStockCycleTimes = query.data?.categoryStockCycleTimes ?? [];
  const configMutationPending = saveAllSettingsMutation.isPending;
  const supportAssignableUsers = (query.data?.users ?? []).filter((item) => item.role !== "admin");
  const topEngineer = kpiProgress[0];
  const kpiRangeLabel = query.data?.kpiRange
    ? `${query.data.kpiRange.startDate} ～ ${query.data.kpiRange.endDate}`
    : "本月";

  const handleApplyKpiFilter = () => {
    setAppliedKpiRange({
      startDate: kpiFilterStartDate || undefined,
      endDate: kpiFilterEndDate || undefined,
    });
  };

  const handleCreateSupportCompensation = () => {
    const normalizedTask = supportCompTask.trim();
    const selectedUserId = Number(supportCompUserId);
    const hours = Number(supportCompHours);

    if (!supportCompBusinessDate) {
      toast.error("請選擇支援日期");
      return;
    }
    if (!Number.isInteger(selectedUserId) || selectedUserId <= 0) {
      toast.error("請選擇工程師");
      return;
    }
    if (!normalizedTask) {
      toast.error("請輸入支援任務");
      return;
    }
    if (!Number.isFinite(hours) || hours <= 0) {
      toast.error("請輸入有效支援時數");
      return;
    }

    createSupportCompensationMutation.mutate({
      businessDate: supportCompBusinessDate,
      userId: selectedUserId,
      supportTask: normalizedTask,
      supportHours: hours,
      notes: supportCompNotes.trim() || undefined,
    });
  };

  const handleResetKpiFilter = () => {
    setKpiFilterStartDate("");
    setKpiFilterEndDate("");
    setAppliedKpiRange({});
  };

  const handleCopyCategoryFlow = (sourceCategoryId: number) => {
    const targetCategoryId = Number(categoryFlowCopyTargets[sourceCategoryId] || 0);
    if (!targetCategoryId) {
      toast.error("請先選擇要套用流程的目標品類");
      return;
    }

    if (targetCategoryId === sourceCategoryId) {
      toast.error("來源品類與目標品類不可相同");
      return;
    }

    const sourceCategory = categories.find((item) => item.id === sourceCategoryId);
    const targetCategory = categories.find((item) => item.id === targetCategoryId);
    const sourceFlow = categoryFlowDrafts[sourceCategoryId] ?? [...stationOptions];

    setCategoryFlowDrafts((prev) => ({
      ...prev,
      [targetCategoryId]: [...sourceFlow],
    }));
    setCategoryFlowCopyTargets((prev) => ({
      ...prev,
      [sourceCategoryId]: "",
    }));

    toast.success(`已將 ${sourceCategory?.categoryName ?? "來源品類"} × ${sourceCategory?.brandName ?? sourceCategory?.subtypeCode ?? "-"} 的流程複製到 ${targetCategory?.categoryName ?? "目標品類"} × ${targetCategory?.brandName ?? targetCategory?.subtypeCode ?? "-"}`);
  };

  const handleSaveAllSettings = () => {
    const invalidTargets = targetDrafts.filter((target) => (target.active || target.dailyTargetQty > 0 || target.id) && target.dailyTargetQty < 1);
    if (invalidTargets.length > 0) {
      toast.error("產能設定中有啟用或既有項目每日產能小於 1，請先修正後再全部儲存");
      return;
    }

    saveAllSettingsMutation.mutate({
      rules: ruleDrafts.map((rule) => ({
        id: rule.id,
        routeKey: rule.routeKey,
        nextStationCode: rule.nextStationCode ? (rule.nextStationCode as typeof stationOptions[number]) : null,
        allowReworkToCode: rule.allowReworkToCode ? (rule.allowReworkToCode as typeof stationOptions[number]) : null,
        active: rule.active,
        notes: rule.notes || null,
      })),
      targets: targetDrafts
        .filter((target) => target.dailyTargetQty > 0 || target.active || target.id)
        .map((target) => ({
          id: target.id,
          stationCode: target.stationCode,
          categoryId: target.categoryId,
          subtypeCode: target.subtypeCode,
          dailyTargetQty: Math.max(1, target.dailyTargetQty),
          active: target.active,
        })),
      defectOptions: optionDrafts
        .filter((option) => option.label.trim())
        .map((option) => ({
          id: option.id,
          stationCode: option.stationCode,
          optionType: option.optionType,
          label: option.label.trim(),
          active: option.active,
          sortOrder: option.sortOrder,
        })),
      categoryFlows: categories.map((category) => ({
        categoryId: category.id,
        stationCodes: categoryFlowDrafts[category.id] ?? [...stationOptions],
      })),
    });
  };
  const slowestStation = [...stationLeadTimes].sort((left, right) => right.avgDaysFromImport - left.avgDaysFromImport)[0];
  const slowestCategoryToStock = categoryStockCycleTimes[0];

  if (loading) {
    return <DashboardLayout title="KPI 儀表板與管理後台" navItems={navItems}><div className="rounded-[28px] bg-white p-8 text-sm text-slate-500 shadow-sm">正在載入管理權限…</div></DashboardLayout>;
  }

  if (user && !canViewAdminPage) {
    return (
      <DashboardLayout title="KPI 儀表板與管理後台" navItems={navItems}>
        <Card className="rounded-[28px] border-0 bg-white shadow-sm">
          <CardContent className="space-y-3 p-8">
            <Badge className="bg-[#f7e8ee] text-rose-700">僅限主管以上</Badge>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">管理後台需主管、經理或 admin 權限</h1>
            <p className="text-sm leading-7 text-slate-600">你目前沒有查看管理後台的權限。若需要調整站點規則、產能、品類流程或管理統計，請使用 supervisor、manager 或 admin 帳號登入。</p>
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
        {isAdminHome ? (
          <Card className="rounded-[28px] border-0 bg-[#eef2f7] shadow-sm">
            <CardContent className="space-y-6 p-8">
              {!isAdmin ? (
                <div className="rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-7 text-amber-900">
                  目前以 {user?.role ?? "viewer"} 身分查看管理後台。此頁面可供檢視站點規則、KPI 與設定資料；若需實際修改設定或執行管理操作，請改用 admin 帳號。
                </div>
              ) : null}
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
        ) : (
          <Card className="rounded-[28px] border-0 bg-white shadow-sm">
            <CardContent className="space-y-4 p-6 md:p-7">
              {!isAdmin ? (
                <div className="rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-7 text-amber-900">
                  目前以 {user?.role ?? "viewer"} 身分查看管理後台；若需實際修改設定或執行管理操作，請改用 admin 帳號。
                </div>
              ) : null}
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="space-y-2">
                  <Badge className="bg-slate-100 text-slate-700">管理後台子功能</Badge>
                  <div className="space-y-1">
                    <h1 className="text-2xl font-black tracking-tight text-slate-900">{activeAdminSectionMeta.label}</h1>
                    <p className="max-w-2xl text-sm leading-7 text-slate-600">{activeAdminSectionMeta.description}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button variant="outline" className="rounded-2xl" onClick={() => setLocation("/admin")}>返回管理首頁</Button>
                  <Button className="rounded-2xl" disabled={configMutationPending || query.isLoading} onClick={handleSaveAllSettings}>儲存全部設定</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {isAdminHome ? (
          <>
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
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                  <div>
                    <CardTitle className="text-base font-bold">全員 KPI 進度</CardTitle>
                    <p className="mt-2 text-sm text-slate-500">目前查看區間：{kpiRangeLabel}</p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-[180px_180px_auto_auto]">
                    <label className="space-y-2 text-sm text-slate-600">
                      <span>開始日期</span>
                      <Input type="date" value={kpiFilterStartDate} onChange={(event) => setKpiFilterStartDate(event.target.value)} className="editable-field rounded-2xl border-0 bg-slate-50" />
                    </label>
                    <label className="space-y-2 text-sm text-slate-600">
                      <span>結束日期</span>
                      <Input type="date" value={kpiFilterEndDate} onChange={(event) => setKpiFilterEndDate(event.target.value)} className="editable-field rounded-2xl border-0 bg-slate-50" />
                    </label>
                    <Button className="rounded-2xl self-end" disabled={query.isFetching} onClick={handleApplyKpiFilter}>套用 KPI 篩選</Button>
                    <Button variant="outline" className="rounded-2xl self-end" disabled={query.isFetching} onClick={handleResetKpiFilter}>重設為當月</Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">

              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-[24px] bg-slate-50 p-4">
                  <p className="text-xs text-slate-400">此區間已追蹤工程師</p>
                  <p className="mt-2 text-3xl font-black tracking-tight text-slate-900">{kpiProgress.length}</p>
                </div>
                <div className="rounded-[24px] bg-slate-50 p-4">
                  <p className="text-xs text-slate-400">此區間最高日均表現</p>
                  <p className="mt-2 text-3xl font-black tracking-tight text-slate-900">{topEngineer ? formatDisplayPoints(topEngineer.monthAvgDisplayPoints) : "0.0 點"}</p>
                  <p className="mt-1 text-sm text-slate-500">{topEngineer ? `${topEngineer.name}｜區間總表現 ${formatDisplayPoints(topEngineer.monthTotalDisplayPoints)}` : "尚無資料"}</p>
                </div>
                <div className="rounded-[24px] bg-slate-50 p-4">
                  <p className="text-xs text-slate-400">此區間平均 KPI 分數</p>
                  <p className="mt-2 text-3xl font-black tracking-tight text-slate-900">{kpiProgress.length > 0 ? `${(kpiProgress.reduce((sum, item) => sum + item.finalKpiScore, 0) / kpiProgress.length).toFixed(1)}` : "0.0"}</p>
                  <p className="mt-1 text-sm text-slate-500">前台已統一改為 100 點制顯示</p>
                </div>
              </div>
              <div className="overflow-x-auto rounded-[24px] bg-slate-50">
                <table className="min-w-full text-sm text-slate-700">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.16em] text-slate-500">
                      <th className="px-4 py-3">工程師</th>
                      <th className="px-4 py-3">角色</th>
                      <th className="px-4 py-3">今日表現</th>
                      <th className="px-4 py-3">區間總表現</th>
                      <th className="px-4 py-3">區間日均表現</th>
                      <th className="px-4 py-3">今日支援補償</th>
                      <th className="px-4 py-3">平均 KPI 達標率</th>
                      <th className="px-4 py-3">最新 KPI 分數</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kpiProgress.length > 0 ? kpiProgress.map((item) => (
                      <tr key={item.userId} className="border-b border-slate-200/80 last:border-b-0 align-top">
                        <td className="px-4 py-3 font-medium text-slate-900">{item.name}<div className="text-xs text-slate-400">{item.username}</div></td>
                        <td className="px-4 py-3">{item.role}</td>
                        <td className="px-4 py-3">{formatDisplayPoints(item.todayDisplayPoints)}</td>
                        <td className="px-4 py-3">{formatDisplayPoints(item.monthTotalDisplayPoints)}</td>
                        <td className="px-4 py-3">{formatDisplayPoints(item.monthAvgDisplayPoints)}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">{formatDisplayPoints(item.todaySupportDisplayPoints)}</div>
                          <div className="text-xs text-slate-400">{formatSupportHours(item.todaySupportHours)}</div>
                        </td>
                        <td className="px-4 py-3">{item.avgKpiAchievementRate.toFixed(1)}%</td>
                        <td className="px-4 py-3">{item.finalKpiScore.toFixed(1)}</td>
                      </tr>
                    )) : <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">目前尚無工程師 KPI 資料</td></tr>}
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
                系統會以商品匯入時間對比各站任務建立／完成時間，讓管理者快速看出哪個節點目前最耗時。這裡的樣本數是歷史進站／完工統計，並非目前站上待處理數量；若要看目前待入庫商品，請以待入庫站點頁清單為準。
              </div>
              <div className="overflow-x-auto rounded-[24px] bg-slate-50">
                <table className="min-w-full text-sm text-slate-700">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.16em] text-slate-500">
                      <th className="px-4 py-3">節點</th>
                      <th className="px-4 py-3">歷史樣本數</th>
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

        <Card className="rounded-[28px] border-0 bg-white shadow-sm">
          <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900">統一全部儲存</p>
              <p className="text-sm leading-7 text-slate-600">站點規則、產能設定、功能表設定與品類流程設定都會由同一個按鈕一次提交，不需要再分區逐一儲存。</p>
            </div>
            <Button className="rounded-2xl" disabled={configMutationPending || query.isLoading} onClick={handleSaveAllSettings}>
              儲存全部設定
            </Button>
          </CardContent>
        </Card>
          </>
        ) : null}

        {isAdminHome ? (
          <Card className="rounded-[28px] border-0 bg-white shadow-sm">
            <CardContent className="flex flex-col gap-3 p-6 md:flex-row md:items-start md:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900">目前功能：{activeAdminSectionMeta.label}</p>
                <p className="text-sm leading-7 text-slate-600">{activeAdminSectionMeta.description}</p>
              </div>
              <div className="rounded-[20px] bg-slate-50 px-4 py-3 text-sm text-slate-500">
                功能入口已移到左側管理後台子列表，請直接從側邊欄切換各功能。
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Tabs value={activeAdminSection} className="space-y-4">
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
                        <Input value={rule.routeKey} onChange={(event) => updateRuleDraft(rule.id, { routeKey: event.target.value })} className="editable-field rounded-2xl border-0 bg-white" />
                      </label>
                      <label className="space-y-2 text-sm text-slate-600">
                        <span>下一站</span>
                        <select value={rule.nextStationCode} onChange={(event) => updateRuleDraft(rule.id, { nextStationCode: event.target.value })} className="editable-select h-10 rounded-2xl border-0 bg-white px-3 text-slate-900 shadow-sm outline-none">
                          <option value="">無</option>
                          {stationOptions.map((code) => (
                            <option key={code} value={code}>{code === "STOCK" ? "待入庫" : code}</option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-2 text-sm text-slate-600">
                        <span>返工回站</span>
                        <select value={rule.allowReworkToCode} onChange={(event) => updateRuleDraft(rule.id, { allowReworkToCode: event.target.value })} className="editable-select h-10 rounded-2xl border-0 bg-white px-3 text-slate-900 shadow-sm outline-none">
                          <option value="">無</option>
                          {stationOptions.map((code) => (
                            <option key={code} value={code}>{code === "STOCK" ? "待入庫" : code}</option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-2 text-sm text-slate-600 md:col-span-2 xl:col-span-1">
                        <span>規則備註</span>
                        <Input value={rule.notes} onChange={(event) => updateRuleDraft(rule.id, { notes: event.target.value })} className="editable-field rounded-2xl border-0 bg-white" />
                      </label>
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
                  <p className="mt-2 text-xs text-slate-500">產能調整完成後，請使用上方統一按鈕一次儲存，避免各分頁分開送出造成設定不同步。</p>
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
                                    className="editable-field h-10 min-w-[120px] rounded-2xl border-0 bg-slate-50"
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
            <div className="space-y-4">
              <div className="rounded-[28px] bg-slate-50 px-5 py-4 text-sm leading-7 text-slate-600">
                功能表設定改成與 C 站作業相同的寬版編輯節奏。每個項目會以橫向列呈現，方便直接調整名稱、排序與啟用狀態，不需要在狹長卡片中反覆上下捲動。
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                {[
                  { key: "bFault", title: "B 站軟測故障狀態", stationCode: "B" as const, optionType: "fault" as const, tone: "bg-[#eef2f7]", placeholder: "例如 無法開機" },
                  { key: "cFault", title: "C 站螢幕狀態", stationCode: "C" as const, optionType: "fault" as const, tone: "bg-[#eef2f7]", placeholder: "例如 觸控異常" },
                  { key: "cAppearance", title: "C 站機身外觀", stationCode: "C" as const, optionType: "appearance" as const, tone: "bg-[#f7e8ee]", placeholder: "例如 邊框刮傷" },
                  { key: "cCamera", title: "C 站鏡頭狀態", stationCode: "C" as const, optionType: "camera" as const, tone: "bg-[#eef7f3]", placeholder: "例如 無法對焦" },
                ].map((section) => {
                  const sectionItems = groupedOptionDrafts[section.key as keyof typeof groupedOptionDrafts];

                  return (
                    <Card key={section.key} className="rounded-[28px] border-0 bg-white shadow-sm">
                      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-1">
                          <CardTitle className="text-base font-bold text-slate-900">{section.title}</CardTitle>
                          <p className="text-sm text-slate-500">目前共 {sectionItems.length} 個可編輯項目，使用寬版列編輯更容易快速調整。</p>
                        </div>
                        <Button variant="outline" className="rounded-2xl sm:self-start" onClick={() => appendOptionDraft(section.stationCode, section.optionType)}>
                          新增一個項目
                        </Button>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="hidden rounded-[24px] bg-slate-100 px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 xl:grid xl:grid-cols-[minmax(0,1.6fr)_140px_120px] xl:items-center xl:gap-3">
                          <span>項目名稱</span>
                          <span>排序</span>
                          <span>狀態</span>
                        </div>
                        {sectionItems.map((option) => (
                          <div key={option.localKey} className={`rounded-[24px] ${section.tone} p-4`}>
                            <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_140px_120px] xl:items-center">
                              <label className="space-y-2 text-sm text-slate-600 xl:space-y-1">
                                <span className="xl:text-xs xl:font-semibold xl:uppercase xl:tracking-[0.12em] xl:text-slate-500">項目名稱</span>
                                <Input value={option.label} onChange={(event) => updateOptionDraft(option.localKey, { label: event.target.value })} className="editable-field rounded-2xl border-0 bg-white" placeholder={section.placeholder} />
                              </label>
                              <label className="space-y-2 text-sm text-slate-600 xl:space-y-1">
                                <span className="xl:text-xs xl:font-semibold xl:uppercase xl:tracking-[0.12em] xl:text-slate-500">排序</span>
                                <Input type="number" value={option.sortOrder} onChange={(event) => updateOptionDraft(option.localKey, { sortOrder: Number(event.target.value || 0) })} className="editable-field rounded-2xl border-0 bg-white" />
                              </label>
                              <label className="flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm text-slate-600 xl:mt-6 xl:min-h-[44px]">
                                <input type="checkbox" checked={option.active} onChange={(event) => updateOptionDraft(option.localKey, { active: event.target.checked })} />
                                啟用
                              </label>
                            </div>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="support">
            <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
              <Card className="rounded-[28px] border-0 bg-white shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base font-bold">登記支援補償</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-[24px] bg-slate-50 p-4 text-sm leading-7 text-slate-600">
                    管理者可依支援任務、時數與備註登記補償。系統將自動依 100 點 ÷ 8 小時換算，前台顯示 12.5 點／小時，內部計算保留 0.125 點／小時。
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="space-y-2 text-sm text-slate-600">
                      <span>日期</span>
                      <Input type="date" value={supportCompBusinessDate} onChange={(event) => setSupportCompBusinessDate(event.target.value)} className="editable-field rounded-2xl border-0 bg-slate-50" />
                    </label>
                    <label className="space-y-2 text-sm text-slate-600">
                      <span>工程師</span>
                      <select value={supportCompUserId} onChange={(event) => setSupportCompUserId(event.target.value)} className="editable-select h-10 rounded-2xl border-0 bg-slate-50 px-3 text-slate-900 shadow-sm outline-none">
                        <option value="">請選擇工程師</option>
                        {supportAssignableUsers.map((item) => (
                          <option key={item.id} value={item.id}>{item.name ?? item.username ?? `User-${item.id}`}</option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-2 text-sm text-slate-600 md:col-span-2">
                      <span>支援任務</span>
                      <Input value={supportCompTask} onChange={(event) => setSupportCompTask(event.target.value)} placeholder="例如：D 站全檢支援、匯入資料整理" className="editable-field rounded-2xl border-0 bg-slate-50" />
                    </label>
                    <label className="space-y-2 text-sm text-slate-600">
                      <span>支援時數</span>
                      <Input type="number" min={0.5} step={0.5} value={supportCompHours} onChange={(event) => setSupportCompHours(event.target.value)} className="editable-field rounded-2xl border-0 bg-slate-50" />
                    </label>
                    <div className="rounded-[24px] bg-amber-50 p-4 text-sm text-amber-900">
                      <p className="font-semibold">即時換算</p>
                      <p className="mt-2">前台表現：{formatDisplayPoints(Number(supportCompHours || 0) * 12.5)}</p>
                      <p className="mt-1">內部點數：{(Number(supportCompHours || 0) * 0.125).toFixed(3)} 點</p>
                    </div>
                    <label className="space-y-2 text-sm text-slate-600 md:col-span-2">
                      <span>備註</span>
                      <Input value={supportCompNotes} onChange={(event) => setSupportCompNotes(event.target.value)} placeholder="例如：代班、跨站協助、臨時支援原因" className="editable-field rounded-2xl border-0 bg-slate-50" />
                    </label>
                  </div>
                  <Button className="rounded-2xl" disabled={createSupportCompensationMutation.isPending} onClick={handleCreateSupportCompensation}>
                    登記支援補償
                  </Button>
                </CardContent>
              </Card>

              <Card className="rounded-[28px] border-0 bg-white shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base font-bold">支援補償清單</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-[24px] bg-slate-50 p-4 text-sm text-slate-600">
                    目前顯示區間：{kpiRangeLabel}。若要查看其他日期，請先在上方 KPI 篩選調整日期區間。
                  </div>
                  <div className="overflow-x-auto rounded-[24px] bg-slate-50">
                    <table className="min-w-full text-sm text-slate-700">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-[0.16em] text-slate-500">
                          <th className="px-4 py-3">日期</th>
                          <th className="px-4 py-3">工程師</th>
                          <th className="px-4 py-3">支援任務</th>
                          <th className="px-4 py-3">時數</th>
                          <th className="px-4 py-3">前台表現</th>
                          <th className="px-4 py-3">備註</th>
                          <th className="px-4 py-3 text-right">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {supportCompensations.length > 0 ? supportCompensations.map((item) => (
                          <tr key={item.id} className="border-b border-slate-200/80 last:border-b-0 align-top">
                            <td className="px-4 py-3 font-medium text-slate-900">{new Date(item.businessDate).toISOString().slice(0, 10)}</td>
                            <td className="px-4 py-3">{item.engineerName ?? item.engineerUsername ?? `User-${item.userId}`}</td>
                            <td className="px-4 py-3">{item.supportTask}</td>
                            <td className="px-4 py-3">{formatSupportHours(Number(item.supportHours))}</td>
                            <td className="px-4 py-3">{formatDisplayPoints(Number(item.supportHours) * 12.5)}</td>
                            <td className="px-4 py-3 text-slate-600">{item.notes ?? "-"}</td>
                            <td className="px-4 py-3 text-right">
                              <Button
                                variant="outline"
                                className="rounded-2xl"
                                disabled={deleteSupportCompensationMutation.isPending}
                                onClick={() => deleteSupportCompensationMutation.mutate({ id: item.id })}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />刪除
                              </Button>
                            </td>
                          </tr>
                        )) : <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">目前尚無支援補償紀錄</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
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
                    <Input value={newUsername} onChange={(event) => setNewUsername(event.target.value)} className="editable-field rounded-2xl border-0 bg-slate-50" placeholder="例如 rita.lin" />
                  </label>
                  <label className="space-y-2 text-sm text-slate-600">
                    <span>密碼</span>
                    <Input type="password" value={newUserPassword} onChange={(event) => setNewUserPassword(event.target.value)} className="editable-field rounded-2xl border-0 bg-slate-50" placeholder="至少 6 碼" />
                  </label>
                  <label className="space-y-2 text-sm text-slate-600">
                    <span>名稱</span>
                    <Input value={newUserName} onChange={(event) => setNewUserName(event.target.value)} className="editable-field rounded-2xl border-0 bg-slate-50" placeholder="例如 林小美" />
                  </label>
                  <label className="space-y-2 text-sm text-slate-600">
                    <span>角色</span>
                    <select value={newUserRole} onChange={(event) => setNewUserRole(event.target.value as typeof newUserRole)} className="editable-select h-10 rounded-2xl border-0 bg-slate-50 px-3 text-slate-900 shadow-sm outline-none">
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

          <TabsContent value="tools">
            <div className="grid gap-4 xl:grid-cols-2">
              <Card className="rounded-[28px] border-0 bg-white shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base font-bold">匯入批次備份／還原</CardTitle>
                  <p className="text-sm leading-7 text-slate-500">先建立備份，再處理誤匯入、重傳或還原；備份卡會同步顯示樣本列、預覽筆數與目前 DB 差異，協助你判斷能否安全還原。</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                    <Input value={backupPoNumber} onChange={(event) => setBackupPoNumber(event.target.value)} className="editable-field rounded-2xl border-0 bg-slate-50" placeholder="輸入要備份的 PO 單號" />
                    <Input value={backupLabel} onChange={(event) => setBackupLabel(event.target.value)} className="editable-field rounded-2xl border-0 bg-slate-50" placeholder="備份標籤（選填）" />
                    <Button
                      className="rounded-2xl"
                      disabled={createImportBackupMutation.isPending || !backupPoNumber.trim()}
                      onClick={() => createImportBackupMutation.mutate({ poNumber: backupPoNumber.trim(), backupLabel: backupLabel.trim() || undefined })}
                    >
                      建立備份
                    </Button>
                  </div>
                  <div className="rounded-[24px] bg-amber-50 p-4 text-sm leading-7 text-amber-900">
                    <p className="font-semibold">刪除指定採購單的用途</p>
                    <p className="mt-2">這個操作是用來處理「匯入了錯誤 PO、重複匯入、或需要先清空同一張採購單後再重新上傳」的情境。它會直接刪除該 PO 目前仍在主資料表中的商品、站點任務與事件紀錄，不會自動保留現場內容，所以建議先建立備份，再執行刪除或重傳。</p>
                  </div>
                  <div className="flex flex-wrap gap-3 rounded-[24px] bg-slate-50 p-4">
                    <Input value={deletePoNumber} onChange={(event) => setDeletePoNumber(event.target.value)} className="editable-field max-w-sm rounded-2xl border-0 bg-white" placeholder="輸入要刪除的 PO 單號" />
                    <Button
                      variant="outline"
                      className="rounded-2xl"
                      disabled={deletePoMutation.isPending || !deletePoNumber.trim()}
                      onClick={() => deletePoMutation.mutate({ poNumber: deletePoNumber.trim() })}
                    >
                      刪除指定採購單
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {(importBackupQuery.data ?? []).length > 0 ? (importBackupQuery.data ?? []).map((backup) => (
                      <div key={backup.id} className="space-y-4 rounded-[24px] bg-slate-50 p-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <p className="font-semibold text-slate-900">{backup.backupLabel ?? backup.poNumber}</p>
                            <p className="mt-1 text-xs text-slate-500">PO：{backup.poNumber}・{backup.vendorName ?? "未指定廠商"}・預覽筆數 {backup.previewCount} 筆</p>
                            <p className="mt-1 text-xs text-slate-500">建立時間：{backup.createdAt ? new Date(backup.createdAt).toLocaleString("zh-TW", { hour12: false }) : "-"}・最近還原：{backup.restoredAt ? new Date(backup.restoredAt).toLocaleString("zh-TW", { hour12: false }) : "尚未還原"}</p>
                          </div>
                          <Button
                            variant="outline"
                            className="rounded-2xl"
                            disabled={restoreImportBackupMutation.isPending}
                            onClick={() => restoreImportBackupMutation.mutate({ backupId: backup.id })}
                          >
                            從此備份還原
                          </Button>
                        </div>
                        <div className="grid gap-3 md:grid-cols-4">
                          <div className="rounded-[18px] bg-white p-3 text-sm text-slate-600">
                            <p className="text-xs text-slate-400">目前 DB 現有筆數</p>
                            <p className="mt-2 text-xl font-black text-slate-900">{backup.diffSummary.currentLiveCount}</p>
                          </div>
                          <div className="rounded-[18px] bg-white p-3 text-sm text-slate-600">
                            <p className="text-xs text-slate-400">與備份相同</p>
                            <p className="mt-2 text-xl font-black text-slate-900">{backup.diffSummary.matchedCount}</p>
                          </div>
                          <div className="rounded-[18px] bg-white p-3 text-sm text-slate-600">
                            <p className="text-xs text-slate-400">目前 DB 缺少</p>
                            <p className="mt-2 text-xl font-black text-slate-900">{backup.diffSummary.missingFromCurrentCount}</p>
                          </div>
                          <div className="rounded-[18px] bg-white p-3 text-sm text-slate-600">
                            <p className="text-xs text-slate-400">已流轉商品</p>
                            <p className={`mt-2 text-xl font-black ${backup.diffSummary.progressedCount > 0 ? "text-rose-600" : "text-slate-900"}`}>{backup.diffSummary.progressedCount}</p>
                          </div>
                        </div>
                        <div className="rounded-[18px] bg-white p-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs text-slate-400">備份預覽樣本</p>
                            <Badge className="bg-slate-100 text-slate-700">額外未展開 {backup.previewOverflowCount} 筆</Badge>
                          </div>
                          <div className="mt-3 space-y-2">
                            {backup.previewRows.map((row, index) => (
                              <div key={`${backup.id}-preview-${index}`} className="rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                                <p className="font-medium text-slate-900">{row.productName ?? row.batchNo ?? row.serialNumber ?? `樣本 #${index + 1}`}</p>
                                <p className="mt-1 text-xs text-slate-500">批號：{row.batchNo ?? "-"}・序號：{row.serialNumber ?? "-"}・IMEI：{row.imei ?? "-"}</p>
                                <p className="mt-1 text-xs text-slate-500">品類：{row.categoryName} × {row.brandName}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )) : <div className="rounded-[20px] bg-slate-50 p-4 text-sm text-slate-500">目前尚未建立任何匯入備份。</div>}
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-[28px] border-0 bg-white shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base font-bold">商品批號／序號追蹤</CardTitle>
                  <p className="text-sm leading-7 text-slate-500">可直接查詢單筆商品在各站點的任務狀態、完成時間、事件紀錄，並顯示各站耗時與異常高亮，方便判斷卡關站點。</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-3">
                    <Input value={productTraceKeyword} onChange={(event) => setProductTraceKeyword(event.target.value)} className="editable-field rounded-2xl border-0 bg-slate-50" placeholder="輸入商品批號、商品序號或 IMEI" />
                    <Button className="rounded-2xl" disabled={productTraceQuery.isFetching} onClick={handleProductTraceSearch}>查詢商品</Button>
                  </div>
                  <div className="space-y-3">
                    {submittedProductTraceKeyword && !productTraceQuery.isFetching && analyzedProductTraceResults.length === 0 ? <div className="rounded-[20px] bg-slate-50 p-4 text-sm text-slate-500">查無符合「{submittedProductTraceKeyword}」的商品。</div> : null}
                    {analyzedProductTraceResults.map((product) => (
                      <div key={product.id} className="space-y-4 rounded-[20px] bg-slate-50 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-semibold text-slate-900">{product.productName ?? product.batchNo ?? product.serialNumber ?? `商品 #${product.id}`}</p>
                            <p className="mt-1 text-xs text-slate-500">PO：{product.poNumber ?? "-"}・批號：{product.batchNo ?? "-"}・序號：{product.serialNumber ?? "-"}・目前狀態：{product.currentStatus}</p>
                          </div>
                          <Badge className="bg-slate-100 text-slate-700">目前站點 {product.currentStationCode ?? "-"}</Badge>
                        </div>
                        <div className="grid gap-3 md:grid-cols-4">
                          <div className="rounded-[18px] bg-white p-3 text-sm text-slate-600">
                            <p className="text-xs text-slate-400">已完成站點</p>
                            <p className="mt-2 text-xl font-black text-slate-900">{product.stats.completedStations}/{product.stats.totalStations}</p>
                          </div>
                          <div className="rounded-[18px] bg-white p-3 text-sm text-slate-600">
                            <p className="text-xs text-slate-400">平均單站耗時</p>
                            <p className="mt-2 text-xl font-black text-slate-900">{product.stats.averageDurationLabel}</p>
                          </div>
                          <div className="rounded-[18px] bg-white p-3 text-sm text-slate-600">
                            <p className="text-xs text-slate-400">最久站點耗時</p>
                            <p className="mt-2 text-xl font-black text-slate-900">{product.stats.longestDurationLabel}</p>
                          </div>
                          <div className="rounded-[18px] bg-white p-3 text-sm text-slate-600">
                            <p className="text-xs text-slate-400">異常站點</p>
                            <p className={`mt-2 text-xl font-black ${product.stats.anomalyCount > 0 ? "text-rose-600" : "text-slate-900"}`}>{product.stats.anomalyCount}</p>
                            <p className="mt-1 text-xs text-slate-500">逾期 {product.stats.overdueCount} 站</p>
                          </div>
                        </div>
                        {product.stats.anomalyCount > 0 ? <div className="rounded-[18px] bg-rose-50 px-4 py-3 text-sm text-rose-700">異常高亮：{product.stats.anomalyStations.join("、")} 需要優先確認；已用紅色卡片標示長工時或逾期站點。</div> : null}
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="rounded-[18px] bg-white p-3">
                            <p className="text-xs text-slate-400">任務時間軸</p>
                            <div className="mt-3 space-y-2">
                              {product.analyzedTimeline.map((task) => (
                                <div key={task.id} className={`rounded-2xl px-3 py-2 text-sm ${task.isAnomaly ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200" : "bg-slate-50 text-slate-600"}`}>
                                  <div className="flex items-center justify-between gap-3">
                                    <p className={`font-medium ${task.isAnomaly ? "text-rose-700" : "text-slate-900"}`}>{task.stationCode}・{task.taskStatus}</p>
                                    <Badge className={task.isAnomaly ? "bg-rose-100 text-rose-700" : "bg-white text-slate-700"}>耗時 {task.durationLabel}</Badge>
                                  </div>
                                  <p className="mt-1 text-xs">完成：{task.completedAt ? new Date(task.completedAt).toLocaleString("zh-TW", { hour12: false }) : "尚未完成"}</p>
                                  <p className="mt-1 text-xs">摘要：{task.resultSummary ?? "-"}</p>
                                  {task.isOverdue ? <p className="mt-1 text-xs font-medium">此站已超過預定期限，請優先確認。</p> : null}
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="rounded-[18px] bg-white p-3">
                            <p className="text-xs text-slate-400">事件紀錄</p>
                            <div className="mt-3 space-y-2">
                              {product.events.map((event) => (
                                <div key={event.id} className="rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                                  <p className="font-medium text-slate-900">{event.stationCode}・{event.eventType}</p>
                                  <p className="mt-1 text-xs text-slate-500">時間：{event.createdAt ? new Date(event.createdAt).toLocaleString("zh-TW", { hour12: false }) : "-"}・執行人：{event.operatorName ?? "-"}</p>
                                  <p className="mt-1 text-xs text-slate-500">摘要：{event.summary ?? "-"}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="inventory-history">
            <Card className="rounded-[28px] border-0 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-bold">庫存異動紀錄</CardTitle>
                <p className="text-sm leading-7 text-slate-500">可依商品批號、序號或 IMEI 查詢該商品從匯入、進入待入庫，到完成入庫或自動移除待入庫的時間、說明與操作者。</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-3">
                  <Input value={productTraceKeyword} onChange={(event) => setProductTraceKeyword(event.target.value)} className="editable-field rounded-2xl border-0 bg-slate-50" placeholder="輸入商品批號、商品序號或 IMEI" />
                  <Button className="rounded-2xl" disabled={productTraceQuery.isFetching} onClick={handleProductTraceSearch}>查詢異動</Button>
                </div>
                <div className="space-y-3">
                  {submittedProductTraceKeyword && !productTraceQuery.isFetching && inventoryMovementResults.length === 0 ? <div className="rounded-[20px] bg-slate-50 p-4 text-sm text-slate-500">查無符合「{submittedProductTraceKeyword}」的庫存異動紀錄。</div> : null}
                  {inventoryMovementResults.map((product) => (
                    <div key={`inventory-history-${product.id}`} className="space-y-4 rounded-[20px] bg-slate-50 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-900">{product.productName ?? product.batchNo ?? product.serialNumber ?? `商品 #${product.id}`}</p>
                          <p className="mt-1 text-xs text-slate-500">PO：{product.poNumber ?? "-"}・批號：{product.batchNo ?? "-"}・序號：{product.serialNumber ?? "-"}・目前狀態：{product.currentStatus}</p>
                        </div>
                        <Badge className="bg-slate-100 text-slate-700">目前站點 {product.currentStationCode ?? "-"}</Badge>
                      </div>
                      <div className="grid gap-3 md:grid-cols-3">
                        <div className="rounded-[18px] bg-white p-3 text-sm text-slate-600">
                          <p className="text-xs text-slate-400">匯入時間</p>
                          <p className="mt-2 font-semibold text-slate-900">{product.inventoryMovement.importedAt ? new Date(product.inventoryMovement.importedAt).toLocaleString("zh-TW", { hour12: false }) : "-"}</p>
                          <p className="mt-1 text-xs text-slate-500">{product.inventoryMovement.importSummary}</p>
                        </div>
                        <div className="rounded-[18px] bg-white p-3 text-sm text-slate-600">
                          <p className="text-xs text-slate-400">待入庫時間</p>
                          <p className="mt-2 font-semibold text-slate-900">{product.inventoryMovement.pendingStockAt ? new Date(product.inventoryMovement.pendingStockAt).toLocaleString("zh-TW", { hour12: false }) : "尚未進入待入庫"}</p>
                          <p className="mt-1 text-xs text-slate-500">{product.inventoryMovement.pendingStockSummary}</p>
                        </div>
                        <div className="rounded-[18px] bg-white p-3 text-sm text-slate-600">
                          <p className="text-xs text-slate-400">入庫時間</p>
                          <p className="mt-2 font-semibold text-slate-900">{product.inventoryMovement.stockedAt ? new Date(product.inventoryMovement.stockedAt).toLocaleString("zh-TW", { hour12: false }) : "尚未完成入庫"}</p>
                            <p className="mt-1 text-xs text-slate-500">操作者：{product.inventoryMovement.stockedOperatorName ?? "系統或尚未完成"}</p>

                        </div>
                      </div>
                      <div className="rounded-[18px] bg-white p-3">
                        <p className="text-xs text-slate-400">庫存異動時間軸</p>
                        <div className="mt-3 space-y-2">
                          <div className="rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                            <p className="font-medium text-slate-900">匯入</p>
                            <p className="mt-1 text-xs text-slate-500">時間：{product.inventoryMovement.importedAt ? new Date(product.inventoryMovement.importedAt).toLocaleString("zh-TW", { hour12: false }) : "-"}・操作者：{product.inventoryMovement.importedOperatorName ?? "系統或未記錄"}</p>
                            <p className="mt-1 text-xs text-slate-500">說明：{product.inventoryMovement.importSummary}</p>
                          </div>
                          <div className="rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                            <p className="font-medium text-slate-900">待入庫</p>
                            <p className="mt-1 text-xs text-slate-500">時間：{product.inventoryMovement.pendingStockAt ? new Date(product.inventoryMovement.pendingStockAt).toLocaleString("zh-TW", { hour12: false }) : "-"}・操作者：{product.inventoryMovement.pendingStockOperatorName ?? "系統或未記錄"}</p>
                            <p className="mt-1 text-xs text-slate-500">說明：{product.inventoryMovement.pendingStockSummary}</p>
                          </div>
                          <div className="rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                            <p className="font-medium text-slate-900">入庫</p>
                            <p className="mt-1 text-xs text-slate-500">時間：{product.inventoryMovement.stockedAt ? new Date(product.inventoryMovement.stockedAt).toLocaleString("zh-TW", { hour12: false }) : "-"}・操作者：{product.inventoryMovement.stockedOperatorName ?? "系統或尚未完成"}</p>
                            <p className="mt-1 text-xs text-slate-500">說明：{product.inventoryMovement.stockedSummary}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
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
                    <Input value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} className="editable-field rounded-2xl border-0 bg-slate-50" placeholder="商品類別，例如 智慧手機" />
                    <Input value={newBrandName} onChange={(event) => setNewBrandName(event.target.value)} className="editable-field rounded-2xl border-0 bg-slate-50" placeholder="品牌，例如 Apple" />
                    <Button
                      className="rounded-2xl"
                      disabled={createCategoryMutation.isPending || !newCategoryName.trim() || !newBrandName.trim()}
                      onClick={() => createCategoryMutation.mutate({ categoryName: newCategoryName.trim(), brandName: newBrandName.trim() })}
                    >
                      新增品類
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="outline"
                      className="rounded-2xl border-red-200 text-red-600 hover:bg-red-50"
                      disabled={clearCategoriesMutation.isPending}
                      onClick={() => clearCategoriesMutation.mutate()}
                    >
                      清空所有品類設定
                    </Button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Input value={categoryFlowCategorySearch} onChange={(event) => setCategoryFlowCategorySearch(event.target.value)} className="editable-field rounded-2xl border-0 bg-slate-50" placeholder="搜尋商品類別，例如 智慧手機" />
                    <Input value={categoryFlowBrandSearch} onChange={(event) => setCategoryFlowBrandSearch(event.target.value)} className="editable-field rounded-2xl border-0 bg-slate-50" placeholder="搜尋品牌，例如 Apple" />
                  </div>
                  <div className="rounded-[24px] bg-slate-50 p-4">
                    <p className="text-sm font-semibold text-slate-900">快速複製現有品類流程</p>
                    <p className="mt-2 text-sm leading-7 text-slate-600">若新品類與既有品類流程接近，可先新增新品類，再使用下方每張卡片的「複製到目標品類」快速套用節點設定。</p>
                  </div>
                  <div className="rounded-[24px] bg-slate-50 p-4 text-sm text-slate-600">
                    你可以先用「商品類別」與「品牌」縮小範圍，再調整流程節點；所有修改會由上方的「儲存全部設定」一次提交。
                  </div>
                  <div className="space-y-3">
                    {categories.length > 0 ? filteredFlowCategories.map((category) => {
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
                          <div className="grid gap-3 md:grid-cols-[1fr_260px_auto] md:items-end">
                            <div className="rounded-[20px] bg-white/70 p-4 text-sm text-slate-600 md:col-span-1">
                              <p className="font-semibold text-slate-900">複製流程到目標品類</p>
                              <p className="mt-2 leading-7">可將目前這個品類的節點設定直接複製到另一個已建立的品類／品牌組合，再由上方「儲存全部設定」一次提交。</p>
                            </div>
                            <label className="space-y-2 text-sm text-slate-600">
                              <span>目標品類</span>
                              <select value={categoryFlowCopyTargets[category.id] ?? ""} onChange={(event) => setCategoryFlowCopyTargets((prev) => ({ ...prev, [category.id]: event.target.value }))} className="editable-select h-10 w-full rounded-2xl border-0 bg-white px-3 text-slate-900 shadow-sm outline-none">
                                <option value="">選擇要套用的品類／品牌</option>
                                {categories.filter((item) => item.id !== category.id).map((item) => (
                                  <option key={`copy-target-${category.id}-${item.id}`} value={String(item.id)}>{item.categoryName} × {item.brandName ?? item.subtypeCode ?? "-"}</option>
                                ))}
                              </select>
                            </label>
                            <Button variant="outline" className="rounded-2xl" onClick={() => handleCopyCategoryFlow(category.id)}>複製到目標品類</Button>
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
                              <Badge className="bg-slate-100 text-slate-700">納入全部儲存</Badge>
                            </div>
                          </div>
                        </div>
                      );
                    }) : <div className="rounded-[24px] bg-slate-50 p-4 text-sm text-slate-600">目前沒有任何品類設定；請先新增商品類別與品牌組合。</div>}
                    {categories.length > 0 && filteredFlowCategories.length === 0 ? <div className="rounded-[24px] bg-slate-50 p-4 text-sm text-slate-500">查無符合目前商品類別與品牌搜尋條件的品類設定。</div> : null}
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
                    <p className="mt-2 text-xs text-slate-500">也可直接從 Google 試算表「商品編碼列表」工作表的 H 欄重新同步，系統會以試算表資料全量覆蓋目前品名清單。</p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-2xl"
                      disabled={syncProductNamesFromSheetMutation.isPending}
                      onClick={() => syncProductNamesFromSheetMutation.mutate()}
                    >
                      {syncProductNamesFromSheetMutation.isPending ? "同步中…" : "從 Google 試算表同步 H 欄"}
                    </Button>
                  </div>
                  <div className="flex gap-3">
                    <Input value={newProductName} onChange={(event) => setNewProductName(event.target.value)} className="editable-field rounded-2xl border-0 bg-slate-50" placeholder="例如 iPhone 14 Pro" />
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
