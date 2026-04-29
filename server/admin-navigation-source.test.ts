import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("admin navigation source coverage", () => {
  const appSource = readFileSync(resolve(process.cwd(), "client/src/App.tsx"), "utf8");
  const adminPageSource = readFileSync(resolve(process.cwd(), "client/src/pages/AdminPage.tsx"), "utf8");
  const dashboardLayoutSource = readFileSync(resolve(process.cwd(), "client/src/components/DashboardLayout.tsx"), "utf8");

  it("adds admin section routes so each management function can be opened from the sidebar", () => {
    expect(appSource).toContain('<Route path="/admin/:section" component={AdminPage} />');
    expect(adminPageSource).toContain('const adminSections: Array<{ id: AdminSectionId; label: string; path: string; description: string }> = [');
    expect(adminPageSource).toContain('subItems: adminSections.map((section) => ({ label: section.label, path: section.path }))');
    expect(adminPageSource).toContain('const activeAdminSection = resolveAdminSectionId(location);');
    expect(adminPageSource).toContain('<Tabs value={activeAdminSection} className="space-y-4">');
  });

  it("renders sidebar sub navigation for nested admin functions", () => {
    expect(dashboardLayoutSource).toContain('SidebarMenuSub');
    expect(dashboardLayoutSource).toContain('item.subItems?.length && isActive');
    expect(dashboardLayoutSource).toContain('setLocation(subItem.path);');
  });
});
