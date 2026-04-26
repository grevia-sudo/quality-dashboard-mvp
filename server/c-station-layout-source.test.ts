import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const stationPageSource = readFileSync(new URL("../client/src/pages/StationPage.tsx", import.meta.url), "utf8");

describe("B/C station layout source coverage", () => {
  it("keeps B and C stations aligned with the same wide search-result layout", () => {
    expect(stationPageSource).toContain('if (stationCode === "B" || stationCode === "C") {');
    expect(stationPageSource).toContain('const showStationEmptyState = (stationCode !== "B" && stationCode !== "C") || hasKeyword;');
    expect(stationPageSource).toContain('stationCode === "B" || stationCode === "C" ? "w-full space-y-4" : "grid gap-4 xl:grid-cols-2"');
    expect(stationPageSource).toContain('stationCode === "B" || stationCode === "C" ? "w-full" : ""');
  });

  it("keeps the B and C pending tables below the search result area", () => {
    expect(stationPageSource).toContain('stationCode === "B" || stationCode === "C" ? (');
    expect(stationPageSource).toContain('B 站待處理商品改為表格明細檢視');
    expect(stationPageSource).toContain('C 站待處理商品也改為表格明細檢視');
    expect(stationPageSource).toContain('目前 {stationCode} 站沒有待處理商品。');
  });

  it("applies the latest flat compact option layout to the B station status areas", () => {
    expect(stationPageSource).toContain('className="space-y-4"');
    expect(stationPageSource).toContain('flex flex-wrap gap-3');
    expect(stationPageSource).toContain('min-h-[56px] min-w-[170px] items-center gap-3 rounded-[20px] bg-white px-5 py-3 text-sm font-medium text-slate-700 shadow-sm sm:min-w-[180px] xl:min-w-[185px]');
    expect(stationPageSource).toContain('B_BATTERY_ISSUE_OPTIONS.map((optionLabel) => (');
  });

  it("renders the C station screen, appearance, and camera sections with the same flat compact rows", () => {
    expect(stationPageSource).toContain('C 站螢幕狀態');
    expect(stationPageSource).toContain('C 站機身外觀');
    expect(stationPageSource).toContain('C 站鏡頭狀態');
    expect(stationPageSource).toContain('space-y-4');
    expect(stationPageSource).toContain('flex flex-wrap gap-3');
  });
});
