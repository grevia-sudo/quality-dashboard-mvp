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
    expect(importPageSource).not.toContain("trpc.station.productCategoryOptions.useQuery");
    expect(importPageSource).toContain("CSV 檔案上傳");
    expect(importPageSource).toContain("選擇 CSV");
    expect(importPageSource).toContain("下載範例");
    expect(importPageSource).toContain("/manus-storage/import-products-example_756ddafb.csv");
    expect(importPageSource).toContain("廠商、商品分類、商品批號、商品序號、IMEI、品名");
    expect(importPageSource).toContain("系統會讀取檔案中的廠商與商品分類原文");
    expect(importPageSource).not.toContain("category,batchNo,serialNumber,imei,productName");
    expect(importPageSource).toContain("廠商（必填）");
    expect(importPageSource).toContain("到貨時間（同批共用）");
    expect(importPageSource).toContain("PO 單號（留空自動生成）");
    expect(importPageSource).toContain("const pendingA1Query = trpc.station.detail.useQuery(");
    expect(importPageSource).toContain('    { stationCode: "A1" },');
    expect(importPageSource).toContain("      retry: shouldRetryTransientQuery,");
    expect(importPageSource).toContain("已匯入未完成點貨的採購單");
    expect(importPageSource).toContain("採購單號");
    expect(importPageSource).toContain("商品類別");
    expect(importPageSource).toContain("總數量");
    expect(importPageSource).toContain("toggleSummaryRow");
    expect(importPageSource).toContain("ChevronDown");
    expect(importPageSource).toContain("ChevronRight");
    expect(importPageSource).toContain("目前沒有已匯入且尚未完成 A1 點貨的採購單");
    expect(importPageSource).toContain("請先填寫廠商名稱後再匯入");
    expect(importPageSource).toContain("目前沒有可匯入的資料");
    expect(importPageSource).toContain("尚未補齊必要欄位");
    expect(importPageSource).toContain("handleImport");
    expect(importPageSource).toContain("toast.error(importValidationMessage)");
    expect(importPageSource).toContain("toast.warning(`已載入");
    expect(importPageSource).toContain("商品分類（必填）");
    expect(importPageSource).not.toContain("請選擇品牌");
    expect(importPageSource).toContain("parseImportedCsvContent");
    expect(importPageSource).toContain("handleFileUpload");
    expect(importPageSource).toContain("目前已載入");
    expect(importPageSource).toContain("LARGE_IMPORT_PREVIEW_LIMIT");
    expect(importPageSource).toContain("showAllRows");
    expect(importPageSource).toContain("visibleRows");
    expect(importPageSource).toContain("import-product-name-options");
    expect(importPageSource).toContain("仍要顯示全部資料列");
    expect(importPageSource).toContain("為避免瀏覽器因大量欄位與品名選項同時渲染而無回應");
    expect(importPageSource.indexOf("CSV 檔案上傳")).toBeLessThan(importPageSource.indexOf("已載入資料預覽"));
  });

  it("provides A1 scan-to-complete fields and pending category summary on the station page", () => {
    expect(stationPageSource).toContain('stationCode === "A1"');
    expect(stationPageSource).toContain("目前待點貨商品分類與數量");
    expect(stationPageSource).toContain("待點貨總數");
    expect(stationPageSource).toContain("待點貨數量");
    expect(stationPageSource).toContain("pendingCategorySummary");
    expect(stationPageSource).toContain("A1 點到貨新增／補齊");
    expect(stationPageSource).not.toContain("廠商（必填）");
    expect(stationPageSource).toContain("商品批號");
    expect(stationPageSource).toContain("商品序號");
    expect(stationPageSource).toContain("IMEI");
    expect(stationPageSource).toContain("trpc.station.receive.useMutation");
    expect(stationPageSource).toContain("trpc.station.productNameOptions.useQuery");
    expect(stationPageSource).not.toContain("trpc.station.productCategoryOptions.useQuery");
    expect(stationPageSource).toContain("A1 改為掃碼補齊模式");
    expect(stationPageSource).toContain("輸入品名關鍵字搜尋（可選）");
    expect(stationPageSource).toContain("完成 A1 並準備下一筆");
    expect(stationPageSource).toContain("留在本頁");
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
