export const MANAGEMENT_VIEWER_ROLES = ["supervisor", "manager", "admin"] as const;

export function canAccessManagementOps(role?: string | null) {
  return Boolean(role && MANAGEMENT_VIEWER_ROLES.includes(role as (typeof MANAGEMENT_VIEWER_ROLES)[number]));
}

export function shouldEnableManagementQuery(input: { loading: boolean; role?: string | null }) {
  return !input.loading && canAccessManagementOps(input.role);
}

export function shouldRedirectFromManagementOps(input: { loading: boolean; role?: string | null }) {
  return !input.loading && Boolean(input.role) && !canAccessManagementOps(input.role);
}
