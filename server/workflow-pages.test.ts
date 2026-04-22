import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const stationPageSource = readFileSync(new URL("../client/src/pages/StationPage.tsx", import.meta.url), "utf8");
const importPageSource = readFileSync(new URL("../client/src/pages/ImportPage.tsx", import.meta.url), "utf8");
const adminPageSource = readFileSync(new URL("../client/src/pages/AdminPage.tsx", import.meta.url), "utf8");

describe("warehouse workflow pages", () => {
  it("exposes file upload import workflow and shared batch fields on the import page", () => {
    expect(importPageSource).toContain('title="匯入作業"');
    expect(importPageSource).toContain("trpc.station.importBatch.useMutation");
    expect(importPageSource).toContain("trpc.station.productNameOptions.useQuery");
    expect(importPageSource).toContain("trpc.station.productCategoryOptions.useQuery");
    expect(importPageSource).toContain("CSV 檔案上傳");
    expect(importPageSource).toContain("選擇 CSV 檔案");
    expect(importPageSource).toContain("廠商（必填）");
    expect(importPageSource).toContain("到貨時間（同批共用）");
    expect(importPageSource).toContain("請選擇商品分類");
    expect(importPageSource).toContain("handleFileUpload");
    expect(importPageSource).toContain("目前已載入");
  });

  it("provides A1 arrival fields, category dropdown, and vendor data on the station page", () => {
    expect(stationPageSource).toContain('stationCode === "A1"');
    expect(stationPageSource).toContain("A1 點到貨新增／補齊");
    expect(stationPageSource).toContain("廠商（必填）");
    expect(stationPageSource).toContain("到貨時間");
    expect(stationPageSource).toContain("商品批號");
    expect(stationPageSource).toContain("商品序號");
    expect(stationPageSource).toContain("IMEI");
    expect(stationPageSource).toContain("trpc.station.receive.useMutation");
    expect(stationPageSource).toContain("trpc.station.productNameOptions.useQuery");
    expect(stationPageSource).toContain("trpc.station.productCategoryOptions.useQuery");
    expect(stationPageSource).toContain("品名可先留空");
  });

  it("renders B and C option menu sections on the station page", () => {
    expect(stationPageSource).toContain("B 站故障狀態");
    expect(stationPageSource).toContain("C 站故障項目");
    expect(stationPageSource).toContain("C 站外觀項目");
    expect(stationPageSource).toContain("faultOptionIds");
    expect(stationPageSource).toContain("appearanceOptionIds");
  });

  it("includes product name and defect option maintenance sections in the admin page", () => {
    expect(adminPageSource).toContain("功能表設定");
    expect(adminPageSource).toContain("B 站軟測故障狀態");
    expect(adminPageSource).toContain("C 站品檢故障項目");
    expect(adminPageSource).toContain("C 站品檢外觀項目");
    expect(adminPageSource).toContain("品名管理");
    expect(adminPageSource).toContain("trpc.admin.createProductNameOption.useMutation");
    expect(adminPageSource).toContain("trpc.admin.deleteProductNameOption.useMutation");
  });
});
