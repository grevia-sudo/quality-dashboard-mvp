import DashboardLayout, { type DashboardNavItem } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Boxes, ChevronDown, ChevronRight, ClipboardCheck, FileUp, Gauge, PackagePlus, ShieldCheck, Upload } from "lucide-react";
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  buildPendingPoSummary,
  parseImportedCsvContent,
  resolveImportedVendorName,
  type ImportDraftRow,
} from "./import-page-utils";

const navItems: DashboardNavItem[] = [
  { label: "站點總覽", path: "/operations", icon: Boxes },
  { label: "匯入作業", path: "/import", icon: PackagePlus },
  { label: "D 站抽樣", path: "/sampling", icon: ClipboardCheck },
  { label: "工程師 KPI", path: "/kpi", icon: Gauge },
  { label: "管理後台", path: "/admin", icon: ShieldCheck },
];

const IMPORT_EXAMPLE_CSV_URL = "/manus-storage/import-products-example_756ddafb.csv";
const LARGE_IMPORT_PREVIEW_LIMIT = 30;

const createEmptyRow = (): ImportDraftRow => ({
  categoryName: "",
  batchNo: "",
  serialNumber: "",
  imei: "",
  productName: "",
});

function isRowImportable(row: ImportDraftRow) {
  return Boolean(row.categoryName.trim() && (row.batchNo.trim() || row.serialNumber.trim() || row.imei.trim()));
}

function hasAnyRowValue(row: ImportDraftRow) {
  return Boolean(row.categoryName.trim() || row.batchNo.trim() || row.serialNumber.trim() || row.imei.trim() || row.productName.trim());
}

export default function ImportPage() {
  const [, setLocation] = useLocation();
  const productNameOptionsQuery = trpc.station.productNameOptions.useQuery(undefined, { retry: false });
  const pendingA1Query = trpc.station.detail.useQuery({ stationCode: "A1" }, { retry: false });
  const [poNumber, setPoNumber] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [arrivalAt, setArrivalAt] = useState("");
  const [rows, setRows] = useState<ImportDraftRow[]>([]);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [expandedSummaryKeys, setExpandedSummaryKeys] = useState<Record<string, boolean>>({});
  const [showAllRows, setShowAllRows] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const utils = trpc.useUtils();

  const importMutation = trpc.station.importBatch.useMutation({
    onSuccess: async (result) => {
      toast.success(`已匯入 ${result.importedCount} 筆商品資料，採購單號 ${result.poNumber}`);
      setPoNumber("");
      setVendorName("");
      setArrivalAt("");
      setRows([]);
      setSelectedFileName("");
      setShowAllRows(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      await productNameOptionsQuery.refetch();
      await utils.station.list.invalidate();
      await utils.dashboard.home.invalidate();
      await utils.station.detail.invalidate({ stationCode: "A1" });
      await pendingA1Query.refetch();
      setLocation("/station/A1");
    },
    onError: (error) => {
      toast.error(error.message || "匯入作業失敗");
    },
  });

  const preparedRows = useMemo(
    () => rows
      .map((row) => ({
        categoryName: row.categoryName.trim(),
        batchNo: row.batchNo.trim() || undefined,
        serialNumber: row.serialNumber.trim() || undefined,
        imei: row.imei.trim() || undefined,
        productName: row.productName.trim() || undefined,
      }))
      .filter((row) => Boolean(row.categoryName && (row.batchNo || row.serialNumber || row.imei))),
    [rows],
  );

  const importValidationMessage = useMemo(() => {
    if (!vendorName.trim()) {
      return "請先填寫廠商名稱後再匯入";
    }

    const filledRows = rows.filter(hasAnyRowValue);
    if (filledRows.length === 0) {
      return "請先上傳至少一筆匯入資料";
    }

    if (preparedRows.length === 0) {
      return "目前沒有可匯入的資料，請確認每列都已填寫商品分類，且商品批號／商品序號／IMEI 至少填寫一項";
    }

    if (preparedRows.length < filledRows.length) {
      return `仍有 ${filledRows.length - preparedRows.length} 筆資料尚未補齊必要欄位，請先完成商品分類或識別欄位`;
    }

    return null;
  }, [preparedRows, rows, vendorName]);

  const pendingPoSummary = useMemo(() => buildPendingPoSummary(pendingA1Query.data?.tasks ?? []), [pendingA1Query.data?.tasks]);
  const visibleRows = useMemo(() => (showAllRows ? rows : rows.slice(0, LARGE_IMPORT_PREVIEW_LIMIT)), [rows, showAllRows]);
  const hiddenRowCount = Math.max(rows.length - visibleRows.length, 0);
  const canImport = !importValidationMessage;

  const updateRow = (index: number, patch: Partial<ImportDraftRow>) => {
    setRows((prev) => prev.map((row, currentIndex) => (currentIndex === index ? { ...row, ...patch } : row)));
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const toggleSummaryRow = (key: string) => {
    setExpandedSummaryKeys((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setSelectedFileName(file.name);

    try {
      const content = await file.text();
      const parsed = parseImportedCsvContent(content);
      setShowAllRows(false);
      if (parsed.rows.length === 0) {
        toast.error("檔案內容為空，或欄位格式不符合 廠商、商品分類、商品批號、商品序號、IMEI、品名");
        setRows([]);
        return;
      }

      setRows(parsed.rows);
      setVendorName((currentVendorName) => resolveImportedVendorName(currentVendorName, parsed));

      if (parsed.detectedVendorNames.length > 1) {
        toast.warning(`CSV 內偵測到 ${parsed.detectedVendorNames.length} 個不同廠商名稱，請確認這批資料是否應共用同一廠商後再匯入`);
      }

      const importableCount = parsed.rows.filter(isRowImportable).length;
      const skippedCount = parsed.rows.length - importableCount;
      if (skippedCount > 0) {
        toast.warning(`已載入 ${parsed.rows.length} 筆 CSV；其中 ${skippedCount} 筆尚未補齊商品分類或識別欄位，暫時不會送出`);
      } else {
        toast.success(parsed.sharedVendorName ? `已載入 ${parsed.rows.length} 筆 CSV 資料，並自動帶入廠商：${parsed.sharedVendorName}` : `已載入 ${parsed.rows.length} 筆 CSV 資料`);
      }
    } catch {
      setRows([]);
      toast.error("讀取檔案失敗，請重新上傳 CSV");
    }
  };

  const handleImport = () => {
    if (importValidationMessage) {
      toast.error(importValidationMessage);
      return;
    }

    importMutation.mutate({
      poNumber: poNumber.trim() || undefined,
      vendorName: vendorName.trim(),
      arrivalAt: arrivalAt || undefined,
      rows: preparedRows,
    });
  };

  return (
    <DashboardLayout title="匯入作業" navItems={navItems}>
      <div className="space-y-6">
        <Card className="rounded-[28px] border-0 bg-[#eef2f7] shadow-sm">
          <CardContent className="space-y-4 p-8">
            <Badge className="bg-white/80 text-slate-700">CSV 原始資料匯入</Badge>
            <h1 className="text-3xl font-black tracking-tight text-slate-900">上傳 CSV 後，直接把原始商品分類文字寫入系統</h1>
            <p className="max-w-3xl text-sm leading-7 text-slate-600">
              本頁僅保留 CSV 上傳與開始匯入的最小流程。匯入欄位為廠商、商品分類、商品批號、商品序號、IMEI、品名；其中廠商與商品分類必填，商品批號／商品序號／IMEI 至少需填一項，品名可留空。
            </p>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" className="rounded-2xl" onClick={() => setLocation("/operations")}>返回站點總覽</Button>
              <Button variant="outline" className="rounded-2xl" onClick={() => setLocation("/admin")}>前往管理後台</Button>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border-0 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-bold">
              <FileUp className="h-5 w-5 text-sky-600" />
              CSV 檔案上傳
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-[24px] border border-dashed border-sky-200 bg-sky-50/70 p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-slate-900">請先上傳 CSV 或 TSV 檔案</p>
                  <p className="text-sm leading-6 text-slate-600">系統會讀取檔案中的廠商與商品分類原文，不再依賴品牌或後台品類設定。</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button type="button" variant="outline" className="rounded-2xl" onClick={() => window.open(IMPORT_EXAMPLE_CSV_URL, "_blank")}>下載範例</Button>
                  <Button type="button" className="rounded-2xl" onClick={openFilePicker}>
                    <Upload className="mr-2 h-4 w-4" />
                    選擇 CSV
                  </Button>
                </div>
              </div>
              <input ref={fileInputRef} type="file" accept=".csv,text/csv,.tsv,text/tab-separated-values" className="hidden" onChange={handleFileUpload} />
              <p className="mt-3 text-sm text-slate-600">{selectedFileName ? `目前檔案：${selectedFileName}` : "尚未選擇檔案"}</p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <label className="space-y-2 text-sm text-slate-600">
                <span>PO 單號（留空自動生成）</span>
                <Input value={poNumber} onChange={(event) => setPoNumber(event.target.value)} className="rounded-2xl border-0 bg-slate-50" placeholder="留空時由系統自動產生，例如 PO-20260421-01" />
              </label>
              <label className="space-y-2 text-sm text-slate-600">
                <span>廠商（必填）</span>
                <Input value={vendorName} onChange={(event) => setVendorName(event.target.value)} className="rounded-2xl border-0 bg-slate-50" placeholder="例如 悠優" />
              </label>
              <label className="space-y-2 text-sm text-slate-600">
                <span>到貨時間（同批共用）</span>
                <Input type="datetime-local" value={arrivalAt} onChange={(event) => setArrivalAt(event.target.value)} className="rounded-2xl border-0 bg-slate-50" />
              </label>
            </div>

            {rows.length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">已載入資料預覽</h2>
                    <p className="text-sm text-slate-600">可直接檢查或微調商品分類、商品批號、商品序號、IMEI 與品名。</p>
                  </div>
                  <Badge className="w-fit bg-slate-900 text-white">共 {rows.length} 筆</Badge>
                </div>

                {visibleRows.map((row, index) => (
                  <div key={`row-${index}`} className="grid gap-3 rounded-[24px] bg-slate-50 p-4 md:grid-cols-2 xl:grid-cols-5">
                    <Input value={row.categoryName} onChange={(event) => updateRow(index, { categoryName: event.target.value })} className="rounded-2xl border-0 bg-white" placeholder="商品分類（必填）" />
                    <Input value={row.batchNo} onChange={(event) => updateRow(index, { batchNo: event.target.value })} className="rounded-2xl border-0 bg-white" placeholder="商品批號（可留空）" />
                    <Input value={row.serialNumber} onChange={(event) => updateRow(index, { serialNumber: event.target.value })} className="rounded-2xl border-0 bg-white" placeholder="商品序號（可留空）" />
                    <Input value={row.imei} onChange={(event) => updateRow(index, { imei: event.target.value })} className="rounded-2xl border-0 bg-white" placeholder="IMEI（可留空）" />
                    <Input value={row.productName} onChange={(event) => updateRow(index, { productName: event.target.value })} className="rounded-2xl border-0 bg-white" placeholder="品名可先留空" list="import-product-name-options" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm leading-6 text-slate-600">
                目前尚未載入任何 CSV 資料。請先上傳檔案，系統會依檔案內容建立可匯入列。
              </div>
            )}

            {rows.length > LARGE_IMPORT_PREVIEW_LIMIT ? (
              <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-900">
                目前已載入 {rows.length} 筆資料；為避免瀏覽器因大量欄位與品名選項同時渲染而無回應，頁面先顯示前 {visibleRows.length} 筆。
                {hiddenRowCount > 0 ? ` 尚有 ${hiddenRowCount} 筆仍會一併匯入。` : " 目前已展開全部資料列。"}
                <div className="mt-3 flex flex-wrap gap-2">
                  {hiddenRowCount > 0 ? (
                    <Button type="button" variant="outline" className="rounded-2xl" onClick={() => setShowAllRows(true)}>仍要顯示全部資料列</Button>
                  ) : null}
                  {showAllRows ? (
                    <Button type="button" variant="outline" className="rounded-2xl" onClick={() => setShowAllRows(false)}>改回只顯示前 {LARGE_IMPORT_PREVIEW_LIMIT} 筆</Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <Button className="rounded-2xl" disabled={importMutation.isPending || !canImport} onClick={handleImport}>
                開始匯入 {preparedRows.length > 0 ? `(${preparedRows.length} 筆)` : ""}
              </Button>
            </div>

            {importValidationMessage ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                {importValidationMessage}
              </div>
            ) : canImport ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">
                已可送出 {preparedRows.length} 筆資料；按下「開始匯入」後系統會建立或自動產生採購單號。
              </div>
            ) : null}

            <datalist id="import-product-name-options">
              {(productNameOptionsQuery.data ?? []).map((option) => (
                <option key={option.id} value={option.label} />
              ))}
            </datalist>
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border-0 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-bold">已匯入未完成點貨的採購單</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <p className="text-sm leading-6 text-slate-600">同一次匯入會共用同一張採購單號；點擊採購單列可展開查看尚未完成 A1 點貨的品項細項。</p>
              <Badge className="w-fit bg-slate-900 text-white">待點貨 {pendingPoSummary.reduce((total, item) => total + item.totalQuantity, 0)} 筆</Badge>
            </div>

            <div className="overflow-hidden rounded-[20px] border border-slate-200 bg-white">
              <div className="hidden grid-cols-[1.2fr_1fr_100px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold tracking-wide text-slate-500 md:grid">
                <div>採購單號</div>
                <div>商品類別</div>
                <div className="text-right">總數量</div>
              </div>

              {pendingPoSummary.length > 0 ? (
                <div className="divide-y divide-slate-100">
                  {pendingPoSummary.map((item) => {
                    const isExpanded = Boolean(expandedSummaryKeys[item.key]);
                    return (
                      <div key={item.key} className="bg-white">
                        <button
                          type="button"
                          className="grid w-full gap-3 px-4 py-4 text-left transition hover:bg-slate-50 md:grid-cols-[1.2fr_1fr_100px] md:items-center"
                          onClick={() => toggleSummaryRow(item.key)}
                        >
                          <div className="flex items-center gap-2 text-sm font-semibold text-[#2563eb]">
                            {isExpanded ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
                            <span>{item.poNumber}</span>
                          </div>
                          <div className="text-sm text-slate-700">{item.categoryLabel}</div>
                          <div className="text-sm font-bold text-slate-900 md:text-right">{item.totalQuantity}</div>
                        </button>

                        {isExpanded ? (
                          <div className="border-t border-slate-100 bg-slate-50 px-4 py-4">
                            <div className="grid gap-3 text-xs font-semibold tracking-wide text-slate-500 md:grid-cols-[1.2fr_1fr_1fr_1fr_1fr]">
                              <div>品項 / 品名</div>
                              <div>商品類別</div>
                              <div>商品批號</div>
                              <div>商品序號</div>
                              <div>IMEI</div>
                            </div>
                            <div className="mt-3 space-y-2">
                              {item.details.map((detail) => (
                                <div key={detail.productId} className="grid gap-3 rounded-2xl bg-white px-3 py-3 text-sm text-slate-700 shadow-sm md:grid-cols-[1.2fr_1fr_1fr_1fr_1fr]">
                                  <div>
                                    <p className="font-semibold text-slate-900">{detail.productName || detail.productCode}</p>
                                    <p className="mt-1 text-xs text-slate-500">產品代碼：{detail.productCode}</p>
                                  </div>
                                  <div>{detail.categoryName || "—"}</div>
                                  <div>{detail.batchNo || "—"}</div>
                                  <div>{detail.serialNumber || "—"}</div>
                                  <div>{detail.imei || "—"}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="px-4 py-8 text-sm text-slate-600">目前沒有已匯入且尚未完成 A1 點貨的採購單；完成匯入後，系統會在這裡依採購單號整理待處理資料。</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
