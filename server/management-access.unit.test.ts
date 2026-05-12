import { describe, expect, it } from "vitest";
import { canAccessManagementOps, canViewAllKpi, shouldEnableManagementQuery, shouldRedirectFromManagementOps } from "../client/src/lib/managementAccess";

describe("managementAccess KPI visibility rules", () => {
  it("allows only admin and manager to view all KPI", () => {
    expect(canViewAllKpi("admin")).toBe(true);
    expect(canViewAllKpi("manager")).toBe(true);
    expect(canViewAllKpi("supervisor")).toBe(false);
    expect(canViewAllKpi("engineer")).toBe(false);
  });

  it("keeps management access and redirect flags consistent", () => {
    expect(canAccessManagementOps("supervisor")).toBe(true);
    expect(canAccessManagementOps("manager")).toBe(true);
    expect(canAccessManagementOps("engineer")).toBe(false);
    expect(shouldEnableManagementQuery({ loading: false, role: "admin" })).toBe(true);
    expect(shouldRedirectFromManagementOps({ loading: false, role: "engineer" })).toBe(true);
    expect(shouldRedirectFromManagementOps({ loading: false, role: "supervisor" })).toBe(false);
  });
});
