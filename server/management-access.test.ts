import { describe, expect, it } from "vitest";
import {
  MANAGEMENT_VIEWER_ROLES,
  canAccessManagementOps,
  shouldEnableManagementQuery,
  shouldRedirectFromManagementOps,
} from "../client/src/lib/managementAccess";

describe("management access helpers", () => {
  it("allows supervisor, manager, and admin roles", () => {
    expect(MANAGEMENT_VIEWER_ROLES).toEqual(["supervisor", "manager", "admin"]);
    expect(canAccessManagementOps("supervisor")).toBe(true);
    expect(canAccessManagementOps("manager")).toBe(true);
    expect(canAccessManagementOps("admin")).toBe(true);
  });

  it("rejects regular users and unauthenticated roles", () => {
    expect(canAccessManagementOps("user")).toBe(false);
    expect(canAccessManagementOps("engineer")).toBe(false);
    expect(canAccessManagementOps(undefined)).toBe(false);
    expect(canAccessManagementOps(null)).toBe(false);
  });

  it("enables management queries only when the page is ready and the role is allowed", () => {
    expect(shouldEnableManagementQuery({ loading: true, role: "manager" })).toBe(false);
    expect(shouldEnableManagementQuery({ loading: false, role: "user" })).toBe(false);
    expect(shouldEnableManagementQuery({ loading: false, role: "manager" })).toBe(true);
  });

  it("redirects authenticated but unauthorized users away from management pages", () => {
    expect(shouldRedirectFromManagementOps({ loading: true, role: "user" })).toBe(false);
    expect(shouldRedirectFromManagementOps({ loading: false, role: undefined })).toBe(false);
    expect(shouldRedirectFromManagementOps({ loading: false, role: "user" })).toBe(true);
    expect(shouldRedirectFromManagementOps({ loading: false, role: "admin" })).toBe(false);
  });
});
