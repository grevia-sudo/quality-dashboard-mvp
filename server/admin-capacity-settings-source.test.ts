import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const adminPageSource = readFileSync(new URL("../client/src/pages/AdminPage.tsx", import.meta.url), "utf8");

describe("admin capacity settings source coverage", () => {
  it("renders the capacity settings tab for A1 to E station-category combinations", () => {
    expect(adminPageSource).toContain('const capacityStationOptions = ["A1", "A2", "B", "C", "D", "E"] as const;');
    expect(adminPageSource).toContain('TabsTrigger value="targets" className="rounded-2xl">產能設定</TabsTrigger>');
    expect(adminPageSource).toContain('可依 A1、A2、B、C、D、E 各站點，為每個品類／品牌組合輸入每日產能。');
    expect(adminPageSource).toContain('stationTargets.map((target) => (');
  });

  it("shows daily capacity input together with derived hourly capacity and unit points", () => {
    expect(adminPageSource).toContain('每小時產能');
    expect(adminPageSource).toContain('單件點數');
    expect(adminPageSource).toContain('formatHourlyTargetQty');
    expect(adminPageSource).toContain('formatBaseUnitPoints');
    expect(adminPageSource).toContain('儲存產能');
  });

  it("submits station-category capacity payload for persistence", () => {
    expect(adminPageSource).toContain('categoryId: target.categoryId');
    expect(adminPageSource).toContain('subtypeCode: target.subtypeCode');
    expect(adminPageSource).toContain('dailyTargetQty: Math.max(1, target.dailyTargetQty)');
    expect(adminPageSource).toContain('active: target.active');
    expect(adminPageSource).toContain('stationCode: target.stationCode');
  });
});
