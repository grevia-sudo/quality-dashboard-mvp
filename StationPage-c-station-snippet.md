# StationPage.tsx：C 站文字帶入改版重點程式碼

以下片段整理自 `client/src/pages/StationPage.tsx`，只保留本輪與 **C 站 B 站故障狀態 / 電池檢測文字帶入** 直接相關的 React 實作。

## 1. C 站承接資料初始化

```tsx
useEffect(() => {
  setSelectedOptions((prev) => {
    const tasks = detailQuery.data?.tasks ?? [];
    let changed = false;
    const next = { ...prev };

    for (const task of tasks) {
      if (next[task.taskId]) {
        continue;
      }

      const carryoverTask = task as typeof task & {
        inheritedBFaultOptionIds?: number[];
        inheritedBatteryNote?: string;
        inheritedBatteryIssueLabels?: BatteryIssueLabel[];
      };

      changed = true;
      next[task.taskId] = {
        faultOptionIds: [],
        appearanceOptionIds: [],
        bFaultOptionIds: carryoverTask.inheritedBFaultOptionIds ?? [],
        batteryNote: carryoverTask.inheritedBatteryNote ?? "",
        batteryIssueLabels: carryoverTask.inheritedBatteryIssueLabels ?? [],
        isEditingBFaults: false,
        hasOpenedBFaultEditor: false,
        hasOpenedBatteryEditor: false,
      };
    }

    return changed ? next : prev;
  });
}, [detailQuery.data?.tasks]);
```

## 2. C 站摘要資料來源修正

這段是本輪關鍵修正。B 站故障狀態摘要不再只看可編輯清單，而是先從所有可用選項比對；若仍取不到標籤，會 fallback 到 task 上承接進來的文字摘要。電池摘要則只使用初始化後的 `batteryNote` 與 `batteryIssueLabels`，避免重複拼接。

```tsx
const selections = getTaskSelections(task.taskId);
const carryoverTask = task as typeof task & {
  inheritedBFaultLabels?: string[];
  inheritedBFaultSummary?: string | null;
};
const editableBFaultOptions = ((stationCode === "B" ? detailQuery.data?.faultOptions : detailQuery.data?.bFaultOptions) ?? [])
  .filter((option) => option.active);
const allBFaultOptions = (stationCode === "B" ? detailQuery.data?.faultOptions : detailQuery.data?.bFaultOptions) ?? [];
const selectedBFaultIds = stationCode === "B" ? selections.faultOptionIds : selections.bFaultOptionIds;
const selectedBFaultLabels = allBFaultOptions
  .filter((option) => selectedBFaultIds.includes(option.id))
  .map((option) => option.label);
const fallbackBFaultLabels = stationCode === "C"
  ? normalizeTextList([
      ...(carryoverTask.inheritedBFaultLabels ?? []),
      ...(carryoverTask.inheritedBFaultSummary
        ? carryoverTask.inheritedBFaultSummary.split(",")
        : []),
    ])
  : [];
const displayedBFaultLabels = selectedBFaultLabels.length > 0 ? selectedBFaultLabels : fallbackBFaultLabels;
const batterySummary = summarizeTextResult([
  selections.batteryNote.trim(),
  ...selections.batteryIssueLabels,
]);
const bFaultSummary = summarizeTextResult(displayedBFaultLabels);
```

## 3. B 站故障狀態：預設文字模式，按下修改才進入編輯

```tsx
{stationCode === "C" && !selections.isEditingBFaults ? (
  <div className="space-y-3">
    <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
      {bFaultSummary}
    </div>
    <div className="flex justify-end">
      <Button
        type="button"
        variant="outline"
        className="rounded-2xl"
        onClick={() => setBFaultEditing(task.taskId, true)}
      >
        修改故障狀態
      </Button>
    </div>
  </div>
) : (
  <div className="space-y-3">
    <div className="grid gap-3 md:grid-cols-2">
      {editableBFaultOptions.map((option) => (
        <label key={option.id} className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
          <Checkbox
            checked={(stationCode === "B" ? selections.faultOptionIds : selections.bFaultOptionIds).includes(option.id)}
            onCheckedChange={(checked) => toggleSelection(
              task.taskId,
              stationCode === "B" ? "faultOptionIds" : "bFaultOptionIds",
              option.id,
              Boolean(checked),
            )}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
    {stationCode === "C" ? (
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          className="rounded-2xl"
          onClick={() => setBFaultEditing(task.taskId, false)}
        >
          取消修改
        </Button>
      </div>
    ) : null}
  </div>
)}
```

## 4. 電池檢測：預設先顯示摘要，再按修改開啟編輯

```tsx
<div className="flex items-start justify-between gap-3">
  <div>
    <p className="text-sm font-bold text-slate-900">電池檢測</p>
    <p className="mt-1 text-xs leading-6 text-slate-500">
      {stationCode === "B"
        ? "可輸入健康度或數字符號，並勾選電池異常標記，完成後會同步寫入 Google Sheet M 欄。"
        : "這裡先帶入 B 站的電池檢測文字結果；如需調整，再按修改按鈕編輯，完成時可選擇是否回寫 Google Sheet M / Q 欄。"}
    </p>
  </div>
  <Button
    type="button"
    variant="outline"
    className="rounded-2xl"
    onClick={() => openBatteryEditor(task.taskId)}
  >
    修改電池檢測
  </Button>
</div>
<div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
  {batterySummary}
</div>
<Dialog
  open={batteryDialogTaskId === task.taskId}
  onOpenChange={(open) => setBatteryDialogTaskId(open ? task.taskId : null)}
>
  <DialogContent className="rounded-[28px] border-0 p-0 sm:max-w-xl">
    <div className="space-y-6 p-6">
      <DialogHeader>
        <DialogTitle>電池檢測</DialogTitle>
        <DialogDescription>
          {stationCode === "B"
            ? "可手動輸入數字或符號，並勾選電池狀態；未填寫時會在 Google Sheet M 欄回寫為「正常」。"
            : "此區會先帶入 B 站已記錄的電池檢測文字結果。若你有調整，完成 C 站時可選擇是否同步回 Google Sheet M 欄，並在 Q 欄標記為已修改上一關狀態。"}
        </DialogDescription>
      </DialogHeader>

      <label className="space-y-2 text-sm text-slate-600">
        <span>檢測回覆</span>
        <Input
          value={selections.batteryNote}
          onChange={(event) => updateBatteryNote(task.taskId, event.target.value)}
          className="h-12 rounded-2xl border-0 bg-slate-50"
          placeholder="例如：88、85%、待更換"
        />
      </label>
    </div>
  </DialogContent>
</Dialog>
```

## 5. 本輪補上的最小驗證

本輪沒有跑全量測試，而是只補了與這次 UI 改動直接相關的兩個測試檔：

```bash
pnpm vitest run server/c-station-battery-interaction.test.ts server/c-station-text-mode.test.ts
```

其中 `server/c-station-battery-interaction.test.ts` 會實際渲染 `StationPage`，驗證：

1. 初始只看到電池摘要文字。
2. 初始看不到「檢測回覆」可編輯欄位。
3. 點擊「修改電池檢測」後，才會出現輸入欄位與既有值。
```
