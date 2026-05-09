import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const adminPageSource = readFileSync(new URL("../client/src/pages/AdminPage.tsx", import.meta.url), "utf8");

describe("admin capacity settings source coverage", () => {
  it("renders the capacity settings section for A1 to E station-category combinations", () => {
    expect(adminPageSource).toContain('const capacityStationOptions = ["A1", "A2", "B", "C", "D", "E"] as const;');
    expect(adminPageSource).toContain('{ id: "targets", label: "產能設定", path: "/admin/targets"');
    expect(adminPageSource).toContain('可依 A1、A2、B、C、D、E 各站點，為每個品類／品牌組合輸入每日產能。');
    expect(adminPageSource).toContain('stationTargets.map((target) => (');
  });

  it("shows daily capacity input together with derived hourly capacity and unit points", () => {
    expect(adminPageSource).toContain('每小時產能');
    expect(adminPageSource).toContain('單件點數（100點制）');
    expect(adminPageSource).toContain('前台 100 點制的單件點數');
    expect(adminPageSource).toContain('return `${(100 / dailyTargetQty).toFixed(3)} 點/件`;');
    expect(adminPageSource).toContain('formatHourlyTargetQty');
    expect(adminPageSource).toContain('formatBaseUnitPoints');
    expect(adminPageSource).toContain('儲存全部設定');
  });

  it("submits station-category capacity payload for persistence", () => {
    expect(adminPageSource).toContain('categoryId: target.categoryId');
    expect(adminPageSource).toContain('subtypeCode: target.subtypeCode');
    expect(adminPageSource).toContain('dailyTargetQty: Math.max(1, target.dailyTargetQty)');
    expect(adminPageSource).toContain('active: target.active');
    expect(adminPageSource).toContain('stationCode: target.stationCode');
  });
});
