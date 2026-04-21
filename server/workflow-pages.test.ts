import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const stationPageSource = readFileSync(new URL("../client/src/pages/StationPage.tsx", import.meta.url), "utf8");
const importPageSource = readFileSync(new URL("../client/src/pages/ImportPage.tsx", import.meta.url), "utf8");
const adminPageSource = readFileSync(new URL("../client/src/pages/AdminPage.tsx", import.meta.url), "utf8");

describe("warehouse workflow pages", () => {
  it("exposes import workflow entry and protected batch import mutation on the import page", () => {
    expect(importPageSource).toContain('title="匯入作業"');
    expect(importPageSource).toContain("trpc.station.importBatch.useMutation");
    expect(importPageSource).toContain("PO 單號（同批共用）");
    expect(importPageSource).toContain("CSV／TSV 貼上匯入");
  });

  it("provides A1 arrival fields and receive mutation on the station page", () => {
    expect(stationPageSource).toContain('stationCode === "A1"');
    expect(stationPageSource).toContain("A1 點到貨新增");
    expect(stationPageSource).toContain("商品批號");
    expect(stationPageSource).toContain("商品序號");
    expect(stationPageSource).toContain("IMEI（選填）");
    expect(stationPageSource).toContain("trpc.station.receive.useMutation");
  });

  it("renders B and C option menu sections on the station page", () => {
    expect(stationPageSource).toContain("B 站故障狀態");
    expect(stationPageSource).toContain("C 站故障項目");
    expect(stationPageSource).toContain("C 站外觀項目");
    expect(stationPageSource).toContain("faultOptionIds");
    expect(stationPageSource).toContain("appearanceOptionIds");
  });

  it("includes defect option maintenance section in the admin page", () => {
    expect(adminPageSource).toContain("功能表設定");
    expect(adminPageSource).toContain("B 站軟測故障狀態");
    expect(adminPageSource).toContain("C 站品檢故障項目");
    expect(adminPageSource).toContain("C 站品檢外觀項目");
    expect(adminPageSource).toContain("trpc.admin.upsertDefectOption.useMutation");
  });
});
