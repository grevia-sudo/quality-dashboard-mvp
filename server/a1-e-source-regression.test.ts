import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stationPageSource = readFileSync(new URL("../client/src/pages/StationPage.tsx", import.meta.url), "utf8");
const routerSource = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");
const dbSource = readFileSync(new URL("./db.ts", import.meta.url), "utf8");

describe("A1 / E station source regressions", () => {
  it("keeps the A1 rename search UI and E-to-D restore action wired on StationPage", () => {
    expect(stationPageSource).toContain("A1 依序號／品號修改品名");
    expect(stationPageSource).toContain("searchProductForRename.useQuery");
    expect(stationPageSource).toContain("updateProductNameMutation");
    expect(stationPageSource).toContain("restoreToDMutation");
    expect(stationPageSource).toContain("還原到 D 站");
  });

  it("keeps the backend validation and route wiring for required A1 fields and Google batch conflict warning", () => {
    expect(routerSource).toContain('message: "A1 必須填寫商品批號"');
    expect(routerSource).toContain('message: "A1 必須填寫商品序號"');
    expect(routerSource).toContain('message: "A1 必須填寫品名"');
    expect(routerSource).toContain("searchProductForRename");
    expect(routerSource).toContain("updateProductName");
    expect(routerSource).toContain("restoreToD");
    expect(dbSource).toContain("已存在於 Google 採購單第");
    expect(dbSource).toContain("E 站人工還原到 D 站");
  });
});
