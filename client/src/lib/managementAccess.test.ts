import { describe, expect, it } from "vitest";
import { canAccessManagementOps, canViewAllKpi, shouldEnableManagementQuery, shouldRedirectFromManagementOps } from "./managementAccess";

describe("managementAccess helpers", () => {
  it("lets admin and manager view all KPI, but keeps supervisor and engineer scoped to self", () => {
    expect(canViewAllKpi("admin")).toBe(true);
    expect(canViewAllKpi("manager")).toBe(true);
    expect(canViewAllKpi("supervisor")).toBe(false);
    expect(canViewAllKpi("engineer")).toBe(false);
    expect(canViewAllKpi("user")).toBe(false);
  });

  it("keeps management page access unchanged for supervisor, manager and admin", () => {
    expect(canAccessManagementOps("supervisor")).toBe(true);
    expect(canAccessManagementOps("manager")).toBe(true);
    expect(canAccessManagementOps("admin")).toBe(true);
    expect(canAccessManagementOps("engineer")).toBe(false);
  });

  it("drives management query and redirect flags consistently", () => {
    expect(shouldEnableManagementQuery({ loading: true, role: "admin" })).toBe(false);
    expect(shouldEnableManagementQuery({ loading: false, role: "manager" })).toBe(true);
    expect(shouldRedirectFromManagementOps({ loading: false, role: "engineer" })).toBe(true);
    expect(shouldRedirectFromManagementOps({ loading: false, role: "supervisor" })).toBe(false);
  });
});
