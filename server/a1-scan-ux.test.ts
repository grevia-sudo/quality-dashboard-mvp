import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("A1/A2 掃碼 UX source coverage", () => {
  const source = readFileSync(
    resolve(process.cwd(), "client/src/pages/StationPage.tsx"),
    "utf8",
  );

  it("supports Enter 快速送出 on all A1 scan inputs", () => {
    expect(source).toContain("const handleA1ScanSubmitKey = (event: React.KeyboardEvent<HTMLInputElement>) => {");
    expect(source).toContain("if (event.key !== \"Enter\") {");
    expect(source).toContain("submitA1Receive();");
    expect(source.match(/onKeyDown=\{handleA1ScanSubmitKey\}/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("clears A1 scan fields, keeps the operator on A1, and refreshes in background after success", () => {
    const successBlockStart = source.indexOf("const receiveMutation = trpc.station.receive.useMutation({");
    const successBlockEnd = source.indexOf("onError: (error) => {", successBlockStart);
    const successBlock = source.slice(successBlockStart, successBlockEnd);

    expect(source).toContain("const refreshA1StationDataInBackground = () => {");
    expect(source).toContain("const removeCompletedTaskFromCache = (currentStationCode: StationCode, productId?: number | null) => {");
    expect(successBlock).toContain('removeCompletedTaskFromCache("A1", result.productId);');
    expect(successBlock).toContain("setProductNamePickerOpen(false);");
    expect(successBlock).toContain('setArrivalForm({ batchNo: "", serialNumber: "", imei: "", productName: "" });');
    expect(successBlock).toContain('focusBatchInput();');
    expect(successBlock).toContain("refreshA1StationDataInBackground();");
    expect(successBlock).not.toContain("await invalidateStationData();");
    expect(successBlock).not.toContain('setLocation(`/station/A2?from=A1&productCode=${encodeURIComponent(result.productCode ?? "")}`);');
  });

  it("uses a fuzzy-search product-name input instead of a native select", () => {
    expect(source).toContain("const [productNamePickerOpen, setProductNamePickerOpen] = useState(false);");
    expect(source).toContain("const filteredProductNameOptions = useMemo(() => {");
    expect(source).toContain('placeholder="輸入品名關鍵字搜尋（可選）"');
    expect(source).toContain("setProductNamePickerOpen(true);");
    expect(source).toContain('setArrivalForm((prev) => ({ ...prev, productName: nextValue }));');
    expect(source).toContain('setArrivalForm((prev) => ({ ...prev, productName: option.label }));');
    expect(source).toContain('productName: arrivalForm.productName.trim() || undefined,');
    expect(source).toContain("onMouseDown={(event) => event.preventDefault()}");
    expect(source).toContain("找不到符合的品名，可直接保留目前輸入。");
    expect(source).not.toContain("<select");
  });

  it("re-focuses the batch input on A1 page load and after receive errors", () => {
    expect(source).toContain("const batchNoInputRef = useRef<HTMLInputElement | null>(null);");
    expect(source).toContain("batchNoInputRef.current?.focus();");
    expect(source).toContain("batchNoInputRef.current?.select();");
    expect(source).toContain("if (stationCode === \"A1\" && !detailQuery.isLoading) {");
    expect(source).toContain("focusBatchInput();");
    expect(source).toContain("onError: (error) => {");
    expect(source).toContain("setProductNamePickerOpen(false);");
  });
  it("supports A2 QR scan submit, success tone, re-focus, and background refresh after success", () => {
    expect(source).toContain("const quickScanInputRef = useRef<HTMLInputElement | null>(null);");
    expect(source).toContain("const playA2SuccessTone = () => {");
    expect(source).toContain("const AudioContextConstructor = window.AudioContext")
;
    expect(source).toContain("const submitA2ScanComplete = () => {");
    expect(source).toContain("const handleStationScanInputKey = (event: React.KeyboardEvent<HTMLInputElement>) => {");
    expect(source).toContain("if (stationCode !== \"A2\" || event.key !== \"Enter\") {");
    expect(source).toContain("find((task) => (");
    expect(source).toContain("[task.batchNo, task.productCode, task.serialNumber, task.imei]");
    expect(source).toContain('toast.error("找不到符合的 A2 待處理商品");');
    expect(source).toContain('placeholder={stationCode === "A2" ? "掃描商品批號 QR 後可直接按 Enter 完成 A2" : stationCode === "B" ? "輸入商品批號後可快速定位 B 站待測項目" : stationCode === "C" ? "輸入商品批號後可快速定位 C 站待檢項目" : "輸入產品代碼、批號、序號或 IMEI"}');
    expect(source).toContain("A2 已改為掃碼快速完工模式");
    expect(source).toContain('removeCompletedTaskFromCache("A2", variables.productId);');
    expect(source).toContain('setKeyword("");');
    expect(source).toContain('playA2SuccessTone();');
    expect(source).toContain('focusQuickScanInput();');
    expect(source).toContain('refreshStationDataInBackground("A2", "B");');
    expect(source).not.toContain("await invalidateStationData();");
  });

  it("supports B station battery dialog, quick completion, and success refocus", () => {
    expect(source).toContain('stationCode === "B" ? "輸入商品批號後可快速定位 B 站待測項目"');
    expect(source).toContain('setBatteryDialogTaskId(task.taskId)');
    expect(source).toContain('電池檢測');
    expect(source).toContain('if (stationCode === "B") {');
    expect(source).toContain('batteryNote: selections.batteryNote,');
    expect(source).toContain('batteryIssueLabels: selections.batteryIssueLabels,');
    expect(source).toContain('[selections.batteryNote.trim(), ...selections.batteryIssueLabels].filter(Boolean).join(", ") || "正常"');
    expect(source).toContain('const submitStationCompletion = (task: (typeof filteredTasks)[number]) => {');
    expect(source).toContain('faultOptionIds: selections.faultOptionIds,');
    expect(source).toContain('removeCompletedTaskFromCache("B", variables.productId);');
    expect(source).toContain('refreshStationDataInBackground("B", "C");');
    expect(source).toContain('setBatteryDialogTaskId(null);');
    expect(source).toContain('focusQuickScanInput();');
  });
});
