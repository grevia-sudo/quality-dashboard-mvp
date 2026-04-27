import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout, { type DashboardNavItem } from "@/components/DashboardLayout";
import { shouldEnableManagementQuery, shouldRedirectFromManagementOps, MANAGEMENT_VIEWER_ROLES } from "@/lib/managementAccess";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { Boxes, ClipboardCheck, Gauge, PackagePlus, Search, ShieldCheck, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";

const navItems: DashboardNavItem[] = [
  { label: "站點總覽", path: "/operations", icon: Boxes },
  { label: "匯入作業", path: "/import", icon: PackagePlus, allowedRoles: [...MANAGEMENT_VIEWER_ROLES] },
  { label: "D 站全檢", path: "/sampling", icon: ClipboardCheck, allowedRoles: [...MANAGEMENT_VIEWER_ROLES] },
  { label: "工程師 KPI", path: "/kpi", icon: Gauge },
  { label: "管理後台", path: "/admin", icon: ShieldCheck, allowedRoles: ["admin"] },
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

type InspectionDraft = {
  batterySummary: string;
  bFaultSummary: string;
  cFaultSummary: string;
  cAppearanceSummary: string;
  cCameraSummary: string;
  isEditingPrevious: boolean;
  isEditingCurrent: boolean;
};

function normalizeResultText(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "正常";
}

function createInitialDraft(task: SamplingTask): InspectionDraft {
  return {
    batterySummary: normalizeResultText(task.inheritedBatterySummary),
    bFaultSummary: normalizeResultText(task.inheritedBFaultSummary),
    cFaultSummary: normalizeResultText(task.inheritedCFaultSummary),
    cAppearanceSummary: normalizeResultText(task.inheritedCAppearanceSummary),
    cCameraSummary: normalizeResultText(task.inheritedCCameraSummary),
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
  const categoryOptionsQuery = trpc.station.productCategoryOptions.useQuery(undefined, {
    retry: false,
    enabled: canAccessManagementOps && Boolean(categoryDialogTask),
  });
  const tasks = ((query.data?.tasks ?? []) as SamplingTask[]);
  const categoryOptions = categoryOptionsQuery.data ?? [];

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

  const getDraft = (task: SamplingTask) => drafts[task.taskId] ?? createInitialDraft(task);

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
    const initial = createInitialDraft(task);
    const currentDraft = getDraft(task);

    updateDraft(task, section === "previous"
      ? {
          batterySummary: initial.batterySummary,
          bFaultSummary: initial.bFaultSummary,
          isEditingPrevious: false,
          isEditingCurrent: currentDraft.isEditingCurrent,
        }
      : {
          cFaultSummary: initial.cFaultSummary,
          cAppearanceSummary: initial.cAppearanceSummary,
          cCameraSummary: initial.cCameraSummary,
          isEditingCurrent: false,
          isEditingPrevious: currentDraft.isEditingPrevious,
        });
  };

  const openCategoryEditor = (task: SamplingTask) => {
    setCategoryDialogTask(task);
    setCategoryDraftValue(task.categoryId ? String(task.categoryId) : "");
  };

  const submitInspection = (task: SamplingTask, passed: boolean) => {
    const draft = getDraft(task);
    const initial = createInitialDraft(task);
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
                  className="h-12 rounded-2xl border-0 bg-slate-50 pl-11"
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
                        <p className="mt-1 text-xs leading-6 text-slate-500">先帶入 B 站文字結果；如需修正，可展開編輯後直接覆寫。</p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-2xl"
                        onClick={() => updateDraft(task, { isEditingPrevious: !draft.isEditingPrevious })}
                      >
                        {draft.isEditingPrevious ? "收合修改" : "修改 B 站結果"}
                      </Button>
                    </div>
                    <div className="grid gap-4 rounded-2xl bg-white p-5 shadow-sm md:grid-cols-2">
                      <div className="space-y-2">
                        <p className="text-xs font-semibold tracking-wide text-slate-500">電池檢測</p>
                        {draft.isEditingPrevious ? (
                          <Textarea
                            value={draft.batterySummary}
                            onChange={(event) => updateDraft(task, { batterySummary: event.target.value })}
                            className="min-h-28 rounded-2xl border-0 bg-slate-50"
                            placeholder="例如：88%、待更換、正常"
                          />
                        ) : (
                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">{normalizeResultText(draft.batterySummary)}</div>
                        )}
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-semibold tracking-wide text-slate-500">故障狀態</p>
                        {draft.isEditingPrevious ? (
                          <Textarea
                            value={draft.bFaultSummary}
                            onChange={(event) => updateDraft(task, { bFaultSummary: event.target.value })}
                            className="min-h-28 rounded-2xl border-0 bg-slate-50"
                            placeholder="例如：無法充電、Face ID 異常、正常"
                          />
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
                        <p className="mt-1 text-xs leading-6 text-slate-500">先帶入 C 站文字結果；如需修正，可展開編輯後直接覆寫。</p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-2xl"
                        onClick={() => updateDraft(task, { isEditingCurrent: !draft.isEditingCurrent })}
                      >
                        {draft.isEditingCurrent ? "收合修改" : "修改 C 站結果"}
                      </Button>
                    </div>
                    <div className="grid gap-4 rounded-2xl bg-white p-5 shadow-sm md:grid-cols-2">
                      <div className="space-y-2">
                        <p className="text-xs font-semibold tracking-wide text-slate-500">螢幕狀態</p>
                        {draft.isEditingCurrent ? (
                          <Textarea
                            value={draft.cFaultSummary}
                            onChange={(event) => updateDraft(task, { cFaultSummary: event.target.value })}
                            className="min-h-28 rounded-2xl border-0 bg-slate-50"
                            placeholder="例如：破裂、亮點、正常"
                          />
                        ) : (
                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">{normalizeResultText(draft.cFaultSummary)}</div>
                        )}
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-semibold tracking-wide text-slate-500">機身狀態</p>
                        {draft.isEditingCurrent ? (
                          <Textarea
                            value={draft.cAppearanceSummary}
                            onChange={(event) => updateDraft(task, { cAppearanceSummary: event.target.value })}
                            className="min-h-28 rounded-2xl border-0 bg-slate-50"
                            placeholder="例如：刮傷、掉漆、正常"
                          />
                        ) : (
                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">{normalizeResultText(draft.cAppearanceSummary)}</div>
                        )}
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-semibold tracking-wide text-slate-500">鏡頭狀態</p>
                        {draft.isEditingCurrent ? (
                          <Textarea
                            value={draft.cCameraSummary}
                            onChange={(event) => updateDraft(task, { cCameraSummary: event.target.value })}
                            className="min-h-28 rounded-2xl border-0 bg-slate-50"
                            placeholder="例如：破裂、刮傷、正常"
                          />
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
                      className="min-h-28 rounded-2xl border-0 bg-white"
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
                  className="h-12 w-full rounded-2xl border-0 bg-slate-50 px-4 text-slate-900"
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
