import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
const adminPageSource = readFileSync(new URL("../client/src/pages/AdminPage.tsx", import.meta.url), "utf8");
const pendingPageSource = readFileSync(new URL("../client/src/pages/PendingStockMismatchPage.tsx", import.meta.url), "utf8");
const routerSource = readFileSync(new URL("../server/routers.ts", import.meta.url), "utf8");
const dbSource = readFileSync(new URL("../server/db.ts", import.meta.url), "utf8");

describe("pending stock mismatch management page source coverage", () => {
  it("registers the dedicated admin route before the generic /admin route", () => {
    const mismatchIndex = appSource.indexOf('<Route path="/admin/pending-stock-mismatches" component={PendingStockMismatchPage} />');
    const adminIndex = appSource.indexOf('<Route path="/admin" component={AdminPage} />');

    expect(mismatchIndex).toBeGreaterThan(-1);
    expect(adminIndex).toBeGreaterThan(-1);
    expect(mismatchIndex).toBeLessThan(adminIndex);
  });

  it("adds an admin navigation entry for the pending stock mismatch page", () => {
    expect(adminPageSource).toContain('{ label: "待入庫待比對", path: "/admin/pending-stock-mismatches", icon: ShieldAlert, allowedRoles: ["admin"] }');
  });

  it("renders the new page with the dedicated query and mismatch copy", () => {
    expect(pendingPageSource).toContain("trpc.admin.pendingStockMismatches.useQuery");
    expect(pendingPageSource).toContain("待入庫待比對商品清單");
    expect(pendingPageSource).toContain("缺少採購單號");
    expect(pendingPageSource).toContain("前往匯入作業");
    expect(pendingPageSource).toContain("目前沒有待入庫但尚未完成匯入比對的商品");
  });

  it("exposes the admin query end to end from router to db helper", () => {
    expect(routerSource).toContain("pendingStockMismatches: adminProcedure");
    expect(routerSource).toContain("return getPendingStockImportMismatchProducts();");
    expect(dbSource).toContain("export async function getPendingStockImportMismatchProducts()");
    expect(dbSource).toContain('eq(products.currentStationCode, "STOCK")');
    expect(dbSource).toContain('eq(products.currentStatus, "pending_stock")');
    expect(dbSource).toContain("尚未完成匯入比對");
  });
});
