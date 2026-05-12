import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("KPI report visibility wiring", () => {
  const dbSource = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
  const routerSource = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
  const adminPageSource = readFileSync(new URL("../client/src/pages/AdminPage.tsx", import.meta.url), "utf8");
  const engineerPageSource = readFileSync(new URL("../client/src/pages/EngineerKpiPage.tsx", import.meta.url), "utf8");

  it("adds station breakdown and zero-score classification to KPI progress rows", () => {
    expect(dbSource).toContain("stationBreakdown");
    expect(dbSource).toContain("zeroScoreCategory");
    expect(dbSource).toContain("classifyZeroScoreKpiAccount");
    expect(dbSource).toContain("getVisibleKpiRowsForViewer");
  });

  it("exposes a viewer-aware kpiAudit route and passes viewer info into admin setup", () => {
    expect(routerSource).toContain("kpiAudit: protectedProcedure");
    expect(routerSource).toContain("getVisibleEngineerKpiProgress");
    expect(routerSource).toContain("return getAdminSetupData({");
    expect(routerSource).toContain("userId: ctx.user.id");
    expect(routerSource).toContain("role: ctx.user.role");
  });

  it("renders KPI report entry points and all-view scope messaging in admin and engineer pages", () => {
    expect(adminPageSource).toContain("KPI 複核報表");
    expect(adminPageSource).toContain("下載 CSV 報表");
    expect(adminPageSource).toContain("0分分類");
    expect(adminPageSource).toContain("站點別 KPI 明細");
    expect(engineerPageSource).toContain("全員 KPI 摘要");
    expect(engineerPageSource).toContain("前往 KPI 複核報表");
    expect(engineerPageSource).toContain("canViewAllKpi");
  });
});
