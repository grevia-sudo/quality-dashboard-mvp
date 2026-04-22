import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("A1 掃碼 UX source coverage", () => {
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
    expect(source).toContain("const removeCompletedA1TaskFromCache = (productId?: number | null) => {");
    expect(successBlock).toContain("removeCompletedA1TaskFromCache(result.productId);");
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
});
