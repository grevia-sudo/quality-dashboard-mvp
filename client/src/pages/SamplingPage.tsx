import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout, { type DashboardNavItem } from "@/components/DashboardLayout";
import { shouldEnableManagementQuery, shouldRedirectFromManagementOps, MANAGEMENT_VIEWER_ROLES } from "@/lib/managementAccess";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { Boxes, ClipboardCheck, Gauge, PackagePlus, Search, ShieldAlert, ShieldCheck, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";

const navItems: DashboardNavItem[] = [
  { label: "站點總覽", path: "/operations", icon: Boxes },
  { label: "匯入作業", path: "/import", icon: PackagePlus, allowedRoles: [...MANAGEMENT_VIEWER_ROLES] },
  { label: "D 站全檢", path: "/sampling", icon: ClipboardCheck, allowedRoles: [...MANAGEMENT_VIEWER_ROLES] },
  { label: "工程師 KPI", path: "/kpi", icon: Gauge },
  { label: "管理後台", path: "/admin", icon: ShieldCheck, allowedRoles: [...MANAGEMENT_VIEWER_ROLES] },
  { label: "待入庫待比對", path: "/admin/pending-stock-mismatches", icon: ShieldAlert, allowedRoles: [...MANAGEMENT_VIEWER_ROLES] },
];

type SamplingTask = {
  taskId: number;
  productId: number;
  productCode: string;
  productName?: string | null;
  categoryId?: number | null;
  categoryName?: string | null;
  brandName?: string | null;
  importedCategoryName?: string | null;
  importedBrandName?: string | null;
  subtypeCode?: string | null;
  batchNo?: string | null;
  serialNumber?: string | null;
  imei?: string | null;
  inheritedBatterySummary?: string | null;
  inheritedBFaultSummary?: string | null;
  inheritedCFaultSummary?: string | null;
  inheritedCAppearanceSummary?: string | null;
  inheritedCCameraSummary?: string | null;
  inheritedCInspectionSummary?: string | null;
};

const B_BATTERY_ISSUE_OPTIONS = ["電池膨脹", "副廠電池", "電池異常"] as const;

type BatteryIssueLabel = (typeof B_BATTERY_ISSUE_OPTIONS)[number];

type DefectOption = {
  id: number;
  label: string;
  active: boolean;
  optionType?: string | null;
};

type StationDetailData = {
  faultOptions?: DefectOption[];
  appearanceOptions?: DefectOption[];
  cameraOptions?: DefectOption[];
  bFaultOptions?: DefectOption[];
};

type InspectionDraft = {
  batterySummary: string;
  batteryNote: string;
  batteryIssueLabels: BatteryIssueLabel[];
  bFaultSummary: string;
  bFaultOptionIds: number[];
  cFaultSummary: string;
  cFaultOptionIds: number[];
  cAppearanceSummary: string;
  cAppearanceOptionIds: number[];
  cCameraSummary: string;
  cCameraOptionIds: number[];
  isEditingPrevious: boolean;
  isEditingCurrent: boolean;
};

const normalizeIdList = (values: number[]) => Array.from(new Set(values)).sort((left, right) => left - right);
const normalizeTextList = (values: string[]) => Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right, "zh-Hant"));
const summarizeTextResult = (values: string[]) => values.map((value) => value.trim()).filter(Boolean).join(", ") || "正常";

function normalizeResultText(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "正常";
}

function parseSummaryTokens(value?: string | null) {
  if (!value) {
    return [] as string[];
  }
  return normalizeTextList(value.split(/[，,]/).map((token) => token.trim()).filter((token) => token && token !== "正常"));
}

function isBatteryIssueLabel(value: string): value is BatteryIssueLabel {
  return B_BATTERY_ISSUE_OPTIONS.includes(value as BatteryIssueLabel);
}

function mapSummaryToOptionIds(summary: string | null | undefined, options: DefectOption[]) {
  const tokens = new Set(parseSummaryTokens(summary));
  return normalizeIdList(options.filter((option) => tokens.has(option.label)).map((option) => option.id));
}

function mapSummaryToBatteryInputs(summary: string | null | undefined) {
  const tokens = parseSummaryTokens(summary);
  const batteryIssueLabels = tokens.filter(isBatteryIssueLabel);
  const batteryNotes = tokens.filter((token) => !batteryIssueLabels.includes(token as BatteryIssueLabel));
  return {
    batteryNote: batteryNotes.join(", "),
    batteryIssueLabels,
  };
}

function createInitialDraft(task: SamplingTask, detailData?: StationDetailData): InspectionDraft {
  const batteryInputs = mapSummaryToBatteryInputs(task.inheritedBatterySummary);
  const bFaultOptions = (detailData?.bFaultOptions ?? []).filter((option) => option.active);
  const faultOptions = (detailData?.faultOptions ?? []).filter((option) => option.active);
  const appearanceOptions = (detailData?.appearanceOptions ?? []).filter((option) => option.active);
  const cameraOptions = (detailData?.cameraOptions ?? []).filter((option) => option.active);
  return {
    batterySummary: normalizeResultText(task.inheritedBatterySummary),
    batteryNote: batteryInputs.batteryNote,
    batteryIssueLabels: batteryInputs.batteryIssueLabels,
    bFaultSummary: normalizeResultText(task.inheritedBFaultSummary),
    bFaultOptionIds: mapSummaryToOptionIds(task.inheritedBFaultSummary, bFaultOptions),
    cFaultSummary: normalizeResultText(task.inheritedCFaultSummary),
    cFaultOptionIds: mapSummaryToOptionIds(task.inheritedCFaultSummary, faultOptions),
    cAppearanceSummary: normalizeResultText(task.inheritedCAppearanceSummary),
    cAppearanceOptionIds: mapSummaryToOptionIds(task.inheritedCAppearanceSummary, appearanceOptions),
    cCameraSummary: normalizeResultText(task.inheritedCCameraSummary),
    cCameraOptionIds: mapSummaryToOptionIds(task.inheritedCCameraSummary, cameraOptions),
    isEditingPrevious: false,
    isEditingCurrent: false,
  };
}

export default function SamplingPage() {
  const { user, loading } = useAuth({ redirectOnUnauthenticated: true });
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const canAccessManagementOps = shouldEnableManagementQuery({ loading, role: user?.role });
  const [searchTerm, setSearchTerm] = useState("");
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [drafts, setDrafts] = useState<Record<number, InspectionDraft>>({});
  const [categoryDialogTask, setCategoryDialogTask] = useState<SamplingTask | null>(null);
  const [categoryDraftValue, setCategoryDraftValue] = useState("");
  const query = trpc.sampling.queue.useQuery(undefined, {
    enabled: canAccessManagementOps,
  });
  const detailQuery = trpc.station.detail.useQuery({ stationCode: "D" }, {
    enabled: canAccessManagementOps,
    retry: false,
  });
  const categoryOptionsQuery = trpc.station.productCategoryOptions.useQuery(undefined, {
    retry: false,
    enabled: canAccessManagementOps && Boolean(categoryDialogTask),
  });
  const tasks = ((query.data?.tasks ?? []) as SamplingTask[]);
  const detailData = detailQuery.data as StationDetailData | undefined;
  const categoryOptions = categoryOptionsQuery.data ?? [];
  const bFaultOptions = (detailData?.bFaultOptions ?? []).filter((option) => option.active);
  const faultOptions = (detailData?.faultOptions ?? []).filter((option) => option.active);
  const appearanceOptions = (detailData?.appearanceOptions ?? []).filter((option) => option.active);
  const cameraOptions = (detailData?.cameraOptions ?? []).filter((option) => option.active);

  useEffect(() => {
    if (shouldRedirectFromManagementOps({ loading, role: user?.role })) {
      setLocation("/operations");
    }
  }, [canAccessManagementOps, loading, setLocation, user]);

  if (!loading && user && !canAccessManagementOps) {
    return null;
  }

  const assignCategoryMutation = trpc.station.assignCategory.useMutation({
    onSuccess: async () => {
      await utils.sampling.queue.invalidate();
      await utils.station.detail.invalidate({ stationCode: "D" });
      await utils.station.list.invalidate();
      await utils.dashboard.home.invalidate();
      setCategoryDialogTask(null);
      setCategoryDraftValue("");
    },
  });

  const mutation = trpc.sampling.submit.useMutation({
    onSuccess: async () => {
      await utils.sampling.queue.invalidate();
      await utils.station.list.invalidate();
      await utils.dashboard.home.invalidate();
    },
  });

  const filteredTasks = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    if (!keyword) {
      return tasks;
    }

    return tasks.filter((task) => {
      const haystacks = [task.batchNo, task.serialNumber, task.productCode]
        .map((value) => value?.toLowerCase() ?? "");
      return haystacks.some((value) => value.includes(keyword));
    });
  }, [searchTerm, tasks]);

  const getDraft = (task: SamplingTask) => drafts[task.taskId] ?? createInitialDraft(task, detailData);

  const updateDraft = (task: SamplingTask, patch: Partial<InspectionDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [task.taskId]: {
        ...getDraft(task),
        ...patch,
      },
    }));
  };

  const resetSection = (task: SamplingTask, section: "previous" | "current") => {
    const initial = createInitialDraft(task, detailData);
    const currentDraft = getDraft(task);

    updateDraft(task, section === "previous"
      ? {
          batterySummary: initial.batterySummary,
          batteryNote: initial.batteryNote,
          batteryIssueLabels: initial.batteryIssueLabels,
          bFaultSummary: initial.bFaultSummary,
          bFaultOptionIds: initial.bFaultOptionIds,
          isEditingPrevious: false,
          isEditingCurrent: currentDraft.isEditingCurrent,
        }
      : {
          cFaultSummary: initial.cFaultSummary,
          cFaultOptionIds: initial.cFaultOptionIds,
          cAppearanceSummary: initial.cAppearanceSummary,
          cAppearanceOptionIds: initial.cAppearanceOptionIds,
          cCameraSummary: initial.cCameraSummary,
          cCameraOptionIds: initial.cCameraOptionIds,
          isEditingCurrent: false,
          isEditingPrevious: currentDraft.isEditingPrevious,
        });
  };

  const openCategoryEditor = (task: SamplingTask) => {
    setCategoryDialogTask(task);
    setCategoryDraftValue(task.categoryId ? String(task.categoryId) : "");
  };

  const updateBatteryNote = (task: SamplingTask, value: string) => {
    const currentDraft = getDraft(task);
    updateDraft(task, {
      batteryNote: value,
      batterySummary: summarizeTextResult([value, ...currentDraft.batteryIssueLabels]),
    });
  };

  const toggleBatteryIssueLabel = (task: SamplingTask, optionLabel: BatteryIssueLabel, checked: boolean) => {
    const currentDraft = getDraft(task);
    const nextLabels = checked
      ? Array.from(new Set([...currentDraft.batteryIssueLabels, optionLabel]))
      : currentDraft.batteryIssueLabels.filter((item) => item !== optionLabel);
    updateDraft(task, {
      batteryIssueLabels: nextLabels,
      batterySummary: summarizeTextResult([currentDraft.batteryNote, ...nextLabels]),
    });
  };

  const toggleBFaultOption = (task: SamplingTask, optionId: number, checked: boolean) => {
    const currentDraft = getDraft(task);
    const nextIds = checked
      ? normalizeIdList([...currentDraft.bFaultOptionIds, optionId])
      : currentDraft.bFaultOptionIds.filter((value) => value !== optionId);
    updateDraft(task, {
      bFaultOptionIds: nextIds,
      bFaultSummary: summarizeTextResult(bFaultOptions.filter((option) => nextIds.includes(option.id)).map((option) => option.label)),
    });
  };

  const toggleCFaultOption = (task: SamplingTask, optionId: number, checked: boolean) => {
    const currentDraft = getDraft(task);
    const nextIds = checked
      ? normalizeIdList([...currentDraft.cFaultOptionIds, optionId])
      : currentDraft.cFaultOptionIds.filter((value) => value !== optionId);
    updateDraft(task, {
      cFaultOptionIds: nextIds,
      cFaultSummary: summarizeTextResult(faultOptions.filter((option) => nextIds.includes(option.id)).map((option) => option.label)),
    });
  };

  const toggleCAppearanceOption = (task: SamplingTask, optionId: number, checked: boolean) => {
    const currentDraft = getDraft(task);
    const nextIds = checked
      ? normalizeIdList([...currentDraft.cAppearanceOptionIds, optionId])
      : currentDraft.cAppearanceOptionIds.filter((value) => value !== optionId);
    updateDraft(task, {
      cAppearanceOptionIds: nextIds,
      cAppearanceSummary: summarizeTextResult(appearanceOptions.filter((option) => nextIds.includes(option.id)).map((option) => option.label)),
    });
  };

  const toggleCCameraOption = (task: SamplingTask, optionId: number, checked: boolean) => {
    const currentDraft = getDraft(task);
    const nextIds = checked
      ? normalizeIdList([...currentDraft.cCameraOptionIds, optionId])
      : currentDraft.cCameraOptionIds.filter((value) => value !== optionId);
    updateDraft(task, {
      cCameraOptionIds: nextIds,
      cCameraSummary: summarizeTextResult(cameraOptions.filter((option) => nextIds.includes(option.id)).map((option) => option.label)),
    });
  };

  const submitInspection = (task: SamplingTask, passed: boolean) => {
    const draft = getDraft(task);
    const initial = createInitialDraft(task, detailData);
    const applyInspectionChanges = (
      normalizeResultText(draft.batterySummary) !== initial.batterySummary
      || normalizeResultText(draft.bFaultSummary) !== initial.bFaultSummary
      || normalizeResultText(draft.cFaultSummary) !== initial.cFaultSummary
      || normalizeResultText(draft.cAppearanceSummary) !== initial.cAppearanceSummary
      || normalizeResultText(draft.cCameraSummary) !== initial.cCameraSummary
    );
    const normalizedReason = (reasons[task.taskId]?.trim() || "全檢不通過");

    mutation.mutate({
      taskId: task.taskId,
      productId: task.productId,
      passed,
      categoryId: task.categoryId ?? null,
      subtypeCode: task.subtypeCode ?? null,
      defectReason: passed ? undefined : normalizedReason,
      applyInspectionChanges,
      batterySummary: normalizeResultText(draft.batterySummary),
      bFaultSummary: normalizeResultText(draft.bFaultSummary),
      cFaultSummary: normalizeResultText(draft.cFaultSummary),
      cAppearanceSummary: normalizeResultText(draft.cAppearanceSummary),
      cCameraSummary: normalizeResultText(draft.cCameraSummary),
    });
  };

  return (
    <DashboardLayout title="D 站全檢" navItems={navItems}>
      <div className="space-y-6">
        <Card className="rounded-[28px] border-0 bg-[#eef2f7] shadow-sm">
          <CardContent className="flex flex-col gap-4 p-8 md:flex-row md:items-end md:justify-between">
            <div>
              <Badge className="bg-white/80 text-slate-700">全數檢查後，通過送往 E 站；不通過返工回 C 站</Badge>
              <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-900">D 站全檢與結果確認</h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">D 站改為全部檢查。此頁會先帶入 B 站與 C 站的文字結果，若需要調整，可直接在下方各區塊展開修改；確認後可送往 E 站，或填寫原因返工回 C 站。</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" className="rounded-2xl" onClick={() => setLocation("/import")}>
                <PackagePlus className="mr-2 h-4 w-4" /> 匯入作業
              </Button>
              <Button variant="outline" className="rounded-2xl" onClick={() => setLocation("/operations")}>
                <Undo2 className="mr-2 h-4 w-4" /> 返回站點總覽
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border-0 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-bold">搜尋商品批號或商品序號</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative max-w-xl space-y-3">
              <div className="relative">
                <Search className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
                <Input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="editable-field h-12 rounded-2xl border-0 bg-slate-50 pl-11"
                  placeholder="輸入商品批號、商品序號或產品編號"
                />
              </div>
              <p className="text-sm text-slate-500">D 站會先帶入 B／C 站結果供你複核。搜尋到指定條碼後，可直接在同一張結果卡完成全檢、必要修正與送站。</p>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {filteredTasks.map((task) => {
            const draft = getDraft(task);
            const cInspectionSummary = [
              normalizeResultText(draft.cFaultSummary),
              normalizeResultText(draft.cAppearanceSummary),
              normalizeResultText(draft.cCameraSummary),
            ].filter((value) => value !== "正常").join("，") || "正常";

            return (
              <Card key={task.taskId} className="rounded-[26px] border-0 bg-white shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between gap-3 text-base font-bold text-slate-900">
                    <span>{task.productCode}</span>
                    <Badge variant="secondary" className="bg-slate-100 text-slate-700">D 站全檢</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="space-y-4 rounded-2xl bg-slate-50 p-5 text-sm text-slate-600">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <div>
                        <p className="text-xs text-slate-400">商品名稱</p>
                        <p className="mt-1 font-semibold text-slate-900">{task.productName ?? "-"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">品類 / 品牌</p>
                        <p className="mt-1 font-semibold text-slate-900">{[task.categoryName ?? task.importedCategoryName ?? task.subtypeCode ?? "-", task.brandName ?? task.importedBrandName ?? ""].filter(Boolean).join(" × ")}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">目前站點</p>
                        <p className="mt-1 font-semibold text-slate-900">D</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">商品批號</p>
                        <p className="mt-1 font-semibold text-slate-900">{task.batchNo ?? "-"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">序號</p>
                        <p className="mt-1 font-semibold text-slate-900">{task.serialNumber ?? "-"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">IMEI</p>
                        <p className="mt-1 font-semibold text-slate-900">{task.imei ?? "-"}</p>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button type="button" variant="outline" className="rounded-2xl" onClick={() => openCategoryEditor(task)}>
                        編輯品類設定
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-4 rounded-[24px] bg-[#eef2f7] p-5">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <p className="text-sm font-bold text-slate-900">B 站檢查結果</p>
                        <p className="mt-1 text-xs leading-6 text-slate-500">先帶入 B 站的電池與功能結果；如需修正，可展開後以與原站點一致的點選方式調整。</p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-2xl"
                        disabled={detailQuery.isLoading}
                        onClick={() => updateDraft(task, { isEditingPrevious: !draft.isEditingPrevious })}
                      >
                        {detailQuery.isLoading ? "載入選項中..." : draft.isEditingPrevious ? "收合修改" : "修改 B 站結果"}
                      </Button>
                    </div>
                    <div className="grid gap-4 rounded-2xl bg-white p-5 shadow-sm md:grid-cols-2">
                      <div className="space-y-2">
                        <p className="text-xs font-semibold tracking-wide text-slate-500">電池檢測</p>
                        {draft.isEditingPrevious ? (
                          <div className="space-y-4 rounded-2xl bg-slate-50 p-4">
                            <label className="space-y-2 text-sm text-slate-600">
                              <span>檢測回覆</span>
                              <Input
                                value={draft.batteryNote}
                                onChange={(event) => updateBatteryNote(task, event.target.value)}
                                className="editable-field h-12 rounded-2xl border-0 bg-white shadow-sm"
                                placeholder="例如：88%、待更換"
                              />
                            </label>
                            <div className="space-y-3">
                              <p className="text-sm font-medium text-slate-700">異常標記</p>
                              <div className="flex flex-wrap gap-3">
                                {B_BATTERY_ISSUE_OPTIONS.map((optionLabel) => (
                                  <label key={optionLabel} className="flex min-h-[56px] min-w-[170px] items-center gap-3 rounded-[20px] bg-white px-5 py-3 text-sm font-medium text-slate-700 shadow-sm sm:min-w-[180px] xl:min-w-[185px]">
                                    <Checkbox
                                      checked={draft.batteryIssueLabels.includes(optionLabel)}
                                      onCheckedChange={(checked) => toggleBatteryIssueLabel(task, optionLabel, Boolean(checked))}
                                    />
                                    <span>{optionLabel}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                            <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">{normalizeResultText(draft.batterySummary)}</div>
                          </div>
                        ) : (
                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">{normalizeResultText(draft.batterySummary)}</div>
                        )}
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-semibold tracking-wide text-slate-500">功能故障</p>
                        {draft.isEditingPrevious ? (
                          <div className="space-y-4 rounded-2xl bg-slate-50 p-4">
                            <div className="space-y-3">
                              <p className="text-sm font-medium text-slate-700">故障選項</p>
                              {bFaultOptions.length > 0 ? (
                                <div className="flex flex-wrap gap-3">
                                  {bFaultOptions.map((option) => (
                                    <label key={option.id} className="flex min-h-[56px] min-w-[170px] items-center gap-3 rounded-[20px] bg-white px-5 py-3 text-sm font-medium text-slate-700 shadow-sm sm:min-w-[180px] xl:min-w-[185px]">
                                      <Checkbox
                                        checked={draft.bFaultOptionIds.includes(option.id)}
                                        onCheckedChange={(checked) => toggleBFaultOption(task, option.id, Boolean(checked))}
                                      />
                                      <span>{option.label}</span>
                                    </label>
                                  ))}
                                </div>
                              ) : (
                                <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-500">目前沒有可用的 B 站功能故障選項。</div>
                              )}
                            </div>
                            <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">{normalizeResultText(draft.bFaultSummary)}</div>
                          </div>
                        ) : (
                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">{normalizeResultText(draft.bFaultSummary)}</div>
                        )}
                      </div>
                    </div>
                    {draft.isEditingPrevious ? (
                      <div className="flex justify-end">
                        <Button type="button" variant="ghost" className="rounded-2xl" onClick={() => resetSection(task, "previous")}>取消 B 站修改</Button>
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-4 rounded-[24px] bg-[#f7eef3] p-5">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <p className="text-sm font-bold text-slate-900">C 站檢查結果</p>
                        <p className="mt-1 text-xs leading-6 text-slate-500">先帶入 C 站的螢幕、機身與鏡頭結果；如需修正，可展開後以 Checkbox 點選方式調整。</p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-2xl"
                        disabled={detailQuery.isLoading}
                        onClick={() => updateDraft(task, { isEditingCurrent: !draft.isEditingCurrent })}
                      >
                        {detailQuery.isLoading ? "載入選項中..." : draft.isEditingCurrent ? "收合修改" : "修改 C 站結果"}
                      </Button>
                    </div>
                    <div className="grid gap-4 rounded-2xl bg-white p-5 shadow-sm md:grid-cols-2">
                      <div className="space-y-2">
                        <p className="text-xs font-semibold tracking-wide text-slate-500">螢幕狀態</p>
                        {draft.isEditingCurrent ? (
                          <div className="space-y-4 rounded-2xl bg-slate-50 p-4">
                            {faultOptions.length > 0 ? (
                              <div className="flex flex-wrap gap-3">
                                {faultOptions.map((option) => (
                                  <label key={option.id} className="flex min-h-[56px] min-w-[170px] items-center gap-3 rounded-[20px] bg-white px-5 py-3 text-sm font-medium text-slate-700 shadow-sm sm:min-w-[180px] xl:min-w-[185px]">
                                    <Checkbox
                                      checked={draft.cFaultOptionIds.includes(option.id)}
                                      onCheckedChange={(checked) => toggleCFaultOption(task, option.id, Boolean(checked))}
                                    />
                                    <span>{option.label}</span>
                                  </label>
                                ))}
                              </div>
                            ) : (
                              <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-500">目前沒有可用的 C 站螢幕選項。</div>
                            )}
                            <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">{normalizeResultText(draft.cFaultSummary)}</div>
                          </div>
                        ) : (
                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">{normalizeResultText(draft.cFaultSummary)}</div>
                        )}
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-semibold tracking-wide text-slate-500">機身狀態</p>
                        {draft.isEditingCurrent ? (
                          <div className="space-y-4 rounded-2xl bg-slate-50 p-4">
                            {appearanceOptions.length > 0 ? (
                              <div className="flex flex-wrap gap-3">
                                {appearanceOptions.map((option) => (
                                  <label key={option.id} className="flex min-h-[56px] min-w-[170px] items-center gap-3 rounded-[20px] bg-white px-5 py-3 text-sm font-medium text-slate-700 shadow-sm sm:min-w-[180px] xl:min-w-[185px]">
                                    <Checkbox
                                      checked={draft.cAppearanceOptionIds.includes(option.id)}
                                      onCheckedChange={(checked) => toggleCAppearanceOption(task, option.id, Boolean(checked))}
                                    />
                                    <span>{option.label}</span>
                                  </label>
                                ))}
                              </div>
                            ) : (
                              <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-500">目前沒有可用的 C 站機身選項。</div>
                            )}
                            <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">{normalizeResultText(draft.cAppearanceSummary)}</div>
                          </div>
                        ) : (
                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">{normalizeResultText(draft.cAppearanceSummary)}</div>
                        )}
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-semibold tracking-wide text-slate-500">鏡頭狀態</p>
                        {draft.isEditingCurrent ? (
                          <div className="space-y-4 rounded-2xl bg-slate-50 p-4">
                            {cameraOptions.length > 0 ? (
                              <div className="flex flex-wrap gap-3">
                                {cameraOptions.map((option) => (
                                  <label key={option.id} className="flex min-h-[56px] min-w-[170px] items-center gap-3 rounded-[20px] bg-white px-5 py-3 text-sm font-medium text-slate-700 shadow-sm sm:min-w-[180px] xl:min-w-[185px]">
                                    <Checkbox
                                      checked={draft.cCameraOptionIds.includes(option.id)}
                                      onCheckedChange={(checked) => toggleCCameraOption(task, option.id, Boolean(checked))}
                                    />
                                    <span>{option.label}</span>
                                  </label>
                                ))}
                              </div>
                            ) : (
                              <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-500">目前沒有可用的 C 站鏡頭選項。</div>
                            )}
                            <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">{normalizeResultText(draft.cCameraSummary)}</div>
                          </div>
                        ) : (
                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">{normalizeResultText(draft.cCameraSummary)}</div>
                        )}
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-semibold tracking-wide text-slate-500">C 站整體摘要</p>
                        <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">{cInspectionSummary}</div>
                      </div>
                    </div>
                    {draft.isEditingCurrent ? (
                      <div className="flex justify-end">
                        <Button type="button" variant="ghost" className="rounded-2xl" onClick={() => resetSection(task, "current")}>取消 C 站修改</Button>
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-3 rounded-2xl bg-slate-50 p-5">
                    <div>
                      <p className="text-sm font-medium text-slate-700">全檢不通過時可填寫異常原因</p>
                      <p className="mt-1 text-xs leading-6 text-slate-500">若本次全檢結果與前站紀錄不一致，或需返工回 C 站，請補充原因方便後續追蹤。</p>
                    </div>
                    <Textarea
                      placeholder="例如：與前站結果不一致、外觀復判不通過"
                      value={reasons[task.taskId] ?? ""}
                      onChange={(event) => setReasons((prev) => ({ ...prev, [task.taskId]: event.target.value }))}
                      className="editable-textarea min-h-28 rounded-2xl border-0 bg-white"
                    />
                  </div>

                  <div className="flex flex-wrap justify-end gap-3">
                    <Button onClick={() => submitInspection(task, true)} disabled={mutation.isPending}>
                      全檢通過，送往 E 站
                    </Button>
                    <Button
                      variant="outline"
                      disabled={mutation.isPending}
                      onClick={() => submitInspection(task, false)}
                    >
                      全檢不通過，返工回 C 站
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {filteredTasks.length === 0 ? (
            <Card className="rounded-[26px] border-0 bg-white shadow-sm">
              <CardContent className="p-8 text-sm leading-7 text-slate-600">
                {tasks.length === 0
                  ? "目前沒有待 D 站全檢案件。你可以返回站點總覽，切換到其他站點支援作業。"
                  : "目前沒有符合搜尋條件的案件，請改用其他商品批號或商品序號再試一次。"}
              </CardContent>
            </Card>
          ) : null}
        </div>
        <Dialog open={Boolean(categoryDialogTask)} onOpenChange={(open) => {
          if (!open) {
            setCategoryDialogTask(null);
            setCategoryDraftValue("");
          }
        }}>
          <DialogContent className="rounded-[28px] border-0 p-0 sm:max-w-xl">
            <div className="space-y-6 p-6">
              <DialogHeader>
                <DialogTitle>編輯品類設定</DialogTitle>
                <DialogDescription>為 D 站商品手動指定管理後台既有的品類設定，更新後會供後續站點與產能邏輯沿用。</DialogDescription>
              </DialogHeader>
              <label className="space-y-2 text-sm text-slate-600">
                <span>選擇品類設定</span>
                <select
                  value={categoryDraftValue}
                  onChange={(event) => setCategoryDraftValue(event.target.value)}
                  className="editable-select h-12 w-full rounded-2xl border-0 bg-slate-50 px-4 text-slate-900"
                >
                  <option value="">清除指定，改回未分類</option>
                  {categoryOptions.map((category) => (
                    <option key={category.id} value={category.id}>
                      {[category.categoryName, category.brandName ?? category.subtypeCode ?? ""].filter(Boolean).join(" × ")}
                    </option>
                  ))}
                </select>
              </label>
              <DialogFooter>
                <Button type="button" variant="outline" className="rounded-2xl" onClick={() => {
                  setCategoryDialogTask(null);
                  setCategoryDraftValue("");
                }}>
                  取消
                </Button>
                <Button
                  type="button"
                  className="rounded-2xl"
                  disabled={!categoryDialogTask || assignCategoryMutation.isPending}
                  onClick={() => {
                    if (!categoryDialogTask) return;
                    assignCategoryMutation.mutate({
                      productId: categoryDialogTask.productId,
                      categoryId: categoryDraftValue ? Number(categoryDraftValue) : null,
                    });
                  }}
                >
                  {assignCategoryMutation.isPending ? "更新中..." : "儲存設定"}
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
