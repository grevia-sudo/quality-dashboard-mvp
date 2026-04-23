import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const stationPageSource = fs.readFileSync(
  path.resolve(__dirname, "../client/src/pages/StationPage.tsx"),
  "utf8",
);

describe("C 站文字帶入與編輯模式", () => {
  it("預設以文字結果顯示 B 站故障狀態，並提供修改按鈕切換編輯模式", () => {
    expect(stationPageSource).toContain("這裡先帶入 B 站完成後的文字結果");
    expect(stationPageSource).toContain("修改故障狀態");
    expect(stationPageSource).toContain("isEditingBFaults");
    expect(stationPageSource).toContain("hasOpenedBFaultEditor");
    expect(stationPageSource).toContain("setBFaultEditing");
    expect(stationPageSource).toContain("const bFaultSummary = summarizeTextResult(displayedBFaultLabels)");
    expect(stationPageSource).toContain("const fallbackBFaultLabels = stationCode === \"C\"");
  });

  it("預設以文字結果顯示電池檢測，並保留修改入口且不拼接重複 fallback", () => {
    expect(stationPageSource).toContain("這裡先帶入 B 站的電池檢測文字結果");
    expect(stationPageSource).toContain("修改電池檢測");
    expect(stationPageSource).toContain("const batterySummary = summarizeTextResult([");
    expect(stationPageSource).toContain("selections.batteryNote.trim()");
    expect(stationPageSource).toContain("...selections.batteryIssueLabels");
    expect(stationPageSource).not.toContain("inheritedBatterySummary");
    expect(stationPageSource).toContain("hasOpenedBatteryEditor");
    expect(stationPageSource).toContain("openBatteryEditor");
    expect(stationPageSource).toContain("此區會先帶入 B 站已記錄的電池檢測文字結果");
  });
});
