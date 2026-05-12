import { describe, expect, it } from "vitest";
import { canViewAllKpiForRole, classifyZeroScoreKpiAccount, isLikelyTestKpiAccount } from "./db";

describe("KPI zero-score classification and visibility rules", () => {
  it("classifies zero-score test accounts by username or display name pattern", () => {
    expect(isLikelyTestKpiAccount({ username: "demo.engineer", name: "展示帳號" })).toBe(true);
    expect(isLikelyTestKpiAccount({ username: "worker01", name: "測試工程師" })).toBe(true);
    expect(isLikelyTestKpiAccount({ username: "normal.user", name: "正式人員" })).toBe(false);
    expect(classifyZeroScoreKpiAccount({ username: "demo.engineer", name: "展示帳號" }, 0)).toBe("測試帳號");
  });

  it("treats non-test zero-score accounts as 本月未作業 and clears category when score is positive", () => {
    expect(classifyZeroScoreKpiAccount({ username: "normal.user", name: "正式人員" }, 0)).toBe("本月未作業");
    expect(classifyZeroScoreKpiAccount({ username: "demo.engineer", name: "展示帳號" }, 1.25)).toBeNull();
  });

  it("allows only admin and manager to view all KPI rows", () => {
    expect(canViewAllKpiForRole("admin")).toBe(true);
    expect(canViewAllKpiForRole("manager")).toBe(true);
    expect(canViewAllKpiForRole("supervisor")).toBe(false);
    expect(canViewAllKpiForRole("engineer")).toBe(false);
  });
});
