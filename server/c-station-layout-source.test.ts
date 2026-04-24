import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const stationPageSource = readFileSync(new URL("../client/src/pages/StationPage.tsx", import.meta.url), "utf8");

describe("C station layout source coverage", () => {
  it("keeps C station aligned with B station's wide search-result layout", () => {
    expect(stationPageSource).toContain('if (stationCode === "B" || stationCode === "C") {');
    expect(stationPageSource).toContain('const showStationEmptyState = (stationCode !== "B" && stationCode !== "C") || hasKeyword;');
    expect(stationPageSource).toContain('stationCode === "B" || stationCode === "C" ? "w-full space-y-4" : "grid gap-4 xl:grid-cols-2"');
    expect(stationPageSource).toContain('stationCode === "B" || stationCode === "C" ? "w-full" : ""');
  });

  it("renders the C station pending table below the search result area", () => {
    expect(stationPageSource).toContain('stationCode === "B" || stationCode === "C" ? (');
    expect(stationPageSource).toContain('C 站待處理商品也改為表格明細檢視');
    expect(stationPageSource).toContain('目前 {stationCode} 站沒有待處理商品。');
  });
});
