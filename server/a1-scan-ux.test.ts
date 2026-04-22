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

  it("clears A1 scan fields before redirecting to A2 after success", () => {
    const successBlockStart = source.indexOf("const receiveMutation = trpc.station.receive.useMutation({");
    const successBlockEnd = source.indexOf("onError: (error) => {", successBlockStart);
    const successBlock = source.slice(successBlockStart, successBlockEnd);

    expect(successBlock).toContain('setArrivalForm({ batchNo: "", serialNumber: "", imei: "" });');
    expect(successBlock).toContain('setLocation(`/station/A2?from=A1&productCode=${encodeURIComponent(result.productCode ?? "")}`);');
    expect(successBlock.indexOf('setArrivalForm({ batchNo: "", serialNumber: "", imei: "" });')).toBeLessThan(
      successBlock.indexOf('setLocation(`/station/A2?from=A1&productCode=${encodeURIComponent(result.productCode ?? "")}`);'),
    );
  });

  it("re-focuses the batch input on A1 page load and after receive errors", () => {
    expect(source).toContain("const batchNoInputRef = useRef<HTMLInputElement | null>(null);");
    expect(source).toContain("batchNoInputRef.current?.focus();");
    expect(source).toContain("batchNoInputRef.current?.select();");
    expect(source).toContain("if (stationCode === \"A1\" && !detailQuery.isLoading) {");
    expect(source).toContain("focusBatchInput();");
    expect(source).toContain("onError: (error) => {");
  });
});
