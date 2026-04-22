import DashboardLayout, { type DashboardNavItem } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Boxes, ClipboardCheck, FileUp, Gauge, PackagePlus, ShieldCheck, Upload } from "lucide-react";
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

type ImportDraftRow = {
  categoryId: string;
  batchNo: string;
  serialNumber: string;
  imei: string;
  productName: string;
};

type CategoryOption = {
  id: number;
  categoryName: string;
  subtypeCode: string;
};

const navItems: DashboardNavItem[] = [
  { label: "站點總覽", path: "/operations", icon: Boxes },
  { label: "匯入作業", path: "/import", icon: PackagePlus },
  { label: "D 站抽樣", path: "/sampling", icon: ClipboardCheck },
  { label: "工程師 KPI", path: "/kpi", icon: Gauge },
  { label: "管理後台", path: "/admin", icon: ShieldCheck },
];

const IMPORT_EXAMPLE_CSV_URL = "/manus-storage/import-products-example_8f82e9a9.csv";

const createEmptyRow = (): ImportDraftRow => ({
  categoryId: "",
  batchNo: "",
  serialNumber: "",
  imei: "",
  productName: "",
});

function findCategoryIdByLabel(rawValue: string, categoryOptions: CategoryOption[]) {
  const normalized = rawValue.trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  const matched = categoryOptions.find((option) => {
    const categoryName = option.categoryName.trim().toLowerCase();
    const subtypeCode = option.subtypeCode.trim().toLowerCase();
    const combined = `${categoryName}/${subtypeCode}`;
    return normalized === categoryName || normalized === subtypeCode || normalized === combined;
  });

  return matched ? String(matched.id) : "";
}

function parseCsvContent(input: string, categoryOptions: CategoryOption[]): ImportDraftRow[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const cells = line.split(/[\t,]/).map((cell) => cell.trim());
      const hasCategoryColumn = cells.length >= 5;
      const [first = "", second = "", third = "", fourth = "", fifth = ""] = cells;
      const row = hasCategoryColumn
        ? {
            categoryId: findCategoryIdByLabel(first, categoryOptions),
            batchNo: second,
            serialNumber: third,
            imei: fourth,
            productName: fifth,
          }
        : {
            categoryId: "",
            batchNo: first,
            serialNumber: second,
            imei: third,
            productName: fourth,
          };

      const headerSignature = [first, second, third, fourth, fifth].join(",").replace(/\s+/g, "").toLowerCase();
      const looksLikeHeader = index === 0 && (
        headerSignature === "商品分類,商品批號,商品序號,imei,品名"
        || headerSignature === "category,batchno,serialnumber,imei,productname"
        || headerSignature === "batchno,serialnumber,imei,productname,"
        || headerSignature === "商品批號,商品序號,imei,品名,"
      );

      return looksLikeHeader ? null : row;
    })
    .filter((row): row is ImportDraftRow => Boolean(row))
    .filter((row) => row.categoryId || row.batchNo || row.serialNumber || row.imei || row.productName);
}

export default function ImportPage() {
  const [, setLocation] = useLocation();
  const authQuery = trpc.auth.me.useQuery(undefined, { retry: false });
  const productNameOptionsQuery = trpc.station.productNameOptions.useQuery(undefined, { retry: false });
  const categoryOptionsQuery = trpc.station.productCategoryOptions.useQuery(undefined, { retry: false });
  const [poNumber, setPoNumber] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [arrivalAt, setArrivalAt] = useState("");
  const [rows, setRows] = useState<ImportDraftRow[]>([createEmptyRow(), createEmptyRow()]);
  const [selectedFileName, setSelectedFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const utils = trpc.useUtils();

  const importMutation = trpc.station.importBatch.useMutation({
    onSuccess: async (result) => {
      toast.success(`已匯入 ${result.importedCount} 筆商品資料`);
      setPoNumber("");
      setVendorName("");
      setArrivalAt("");
      setRows([createEmptyRow(), createEmptyRow()]);
      setSelectedFileName("");
      await productNameOptionsQuery.refetch();
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      await utils.station.list.invalidate();
      await utils.dashboard.home.invalidate();
      await utils.station.detail.invalidate({ stationCode: "A1" });
      setLocation("/station/A1");
    },
    onError: (error) => {
      toast.error(error.message || "匯入作業失敗");
    },
  });

  const preparedRows = useMemo(
    () =>
      rows
        .map((row) => ({
          categoryId: Number(row.categoryId),
          batchNo: row.batchNo.trim() || undefined,
          serialNumber: row.serialNumber.trim() || undefined,
          imei: row.imei.trim() || undefined,
          productName: row.productName.trim() || undefined,
        }))
        .filter((row) => row.categoryId > 0 && (row.batchNo || row.serialNumber || row.imei)),
    [rows],
  );

  const canImport = vendorName.trim() && preparedRows.length > 0;
  const isAdmin = ["admin", "manager", "supervisor"].includes(authQuery.data?.role ?? "user");

  const updateRow = (index: number, patch: Partial<ImportDraftRow>) => {
    setRows((prev) => prev.map((row, currentIndex) => (currentIndex === index ? { ...row, ...patch } : row)));
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setSelectedFileName(file.name);

    try {
      const content = await file.text();
      const parsedRows = parseCsvContent(content, categoryOptionsQuery.data ?? []);
      if (parsedRows.length === 0) {
        toast.error("檔案內容為空，或欄位格式不符合 商品分類、商品批號、商品序號、IMEI、品名");
        return;
      }

      setRows(parsedRows);
      toast.success(`已載入 ${parsedRows.length} 筆 CSV 資料`);
    } catch {
      toast.error("讀取檔案失敗，請重新上傳 CSV");
    }
  };

  return (
    <DashboardLayout title="匯入作業" navItems={navItems}>
      <div className="space-y-6">
        <Card className="rounded-[28px] border-0 bg-[#eef2f7] shadow-sm">
          <CardContent className="space-y-4 p-8">
            <Badge className="bg-white/80 text-slate-700">PO、到貨時間與 A1 補欄入口</Badge>
            <h1 className="text-3xl font-black tracking-tight text-slate-900">先上傳 CSV，再交由 A1 點到貨與各站點接續補齊資料</h1>
            <p className="max-w-3xl text-sm leading-7 text-slate-600">
              同一次匯入可共用 PO 單號、廠商與到貨時間。每列資料的商品分類必填，商品批號、商品序號、IMEI 只要任一有值即可；品名可先留空，後續在 A1 補齊後會回寫到採購單工作表。
            </p>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" className="rounded-2xl" onClick={() => setLocation("/operations")}>返回站點總覽</Button>
              <Button variant="outline" className="rounded-2xl" onClick={() => setLocation("/admin")}>前往管理後台</Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
          <Card className="rounded-[28px] border-0 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-bold">匯入主表</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <label className="space-y-2 text-sm text-slate-600">
                  <span>PO 單號（同批共用）</span>
                  <Input value={poNumber} onChange={(event) => setPoNumber(event.target.value)} className="rounded-2xl border-0 bg-slate-50" placeholder="例如 PO-20260421-01" />
                </label>
                <label className="space-y-2 text-sm text-slate-600">
                  <span>廠商（必填）</span>
                  <Input value={vendorName} onChange={(event) => setVendorName(event.target.value)} className="rounded-2xl border-0 bg-slate-50" placeholder="例如 綠途未來股份有限公司" />
                </label>
                <label className="space-y-2 text-sm text-slate-600">
                  <span>到貨時間（同批共用）</span>
                  <Input type="datetime-local" value={arrivalAt} onChange={(event) => setArrivalAt(event.target.value)} className="rounded-2xl border-0 bg-slate-50" />
                </label>
              </div>

              <div className="space-y-3">
                {rows.map((row, index) => (
                  <div key={`row-${index}`} className="grid gap-3 rounded-[24px] bg-slate-50 p-4 md:grid-cols-2 xl:grid-cols-5">
                    <select
                      value={row.categoryId}
                      onChange={(event) => updateRow(index, { categoryId: event.target.value })}
                      className="h-10 rounded-2xl border-0 bg-white px-3 text-slate-900 shadow-sm outline-none"
                    >
                      <option value="">請選擇商品分類</option>
                      {(categoryOptionsQuery.data ?? []).map((option) => (
                        <option key={option.id} value={option.id}>{option.categoryName} / {option.subtypeCode}</option>
                      ))}
                    </select>
                    <Input value={row.batchNo} onChange={(event) => updateRow(index, { batchNo: event.target.value })} className="rounded-2xl border-0 bg-white" placeholder="商品批號（可留空）" />
                    <Input value={row.serialNumber} onChange={(event) => updateRow(index, { serialNumber: event.target.value })} className="rounded-2xl border-0 bg-white" placeholder="商品序號（可留空）" />
                    <Input value={row.imei} onChange={(event) => updateRow(index, { imei: event.target.value })} className="rounded-2xl border-0 bg-white" placeholder="IMEI（可留空）" />
                    <select
                      value={row.productName}
                      onChange={(event) => updateRow(index, { productName: event.target.value })}
                      className="h-10 rounded-2xl border-0 bg-white px-3 text-slate-900 shadow-sm outline-none"
                    >
                      <option value="">品名可先留空</option>
                      {(productNameOptionsQuery.data ?? []).map((option) => (
                        <option key={option.id} value={option.label}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-3">
                <Button variant="outline" className="rounded-2xl" onClick={() => setRows((prev) => [...prev, createEmptyRow()])}>新增一列</Button>
                <Button
                  className="rounded-2xl"
                  disabled={importMutation.isPending || !canImport}
                  onClick={() =>
                    importMutation.mutate({
                      poNumber: poNumber.trim() || undefined,
                      vendorName: vendorName.trim(),
                      arrivalAt: arrivalAt || undefined,
                      rows: preparedRows,
                    })
                  }
                >
                  開始匯入 {preparedRows.length > 0 ? `(${preparedRows.length} 筆)` : ""}
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card className="rounded-[28px] border-0 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base font-bold text-slate-900"><Upload className="h-4 w-4 text-[#7ca3d9]" /> CSV 檔案上傳</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.tsv,text/csv,text/tab-separated-values"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <div className="rounded-[24px] bg-slate-50 p-5 text-sm leading-7 text-slate-600">
                  <p>建議欄位順序為：商品分類、商品批號、商品序號、IMEI、品名。</p>
                  <p>若檔案第一列為標題列，系統會自動略過 `商品分類,商品批號,商品序號,IMEI,品名` 或 `category,batchNo,serialNumber,imei,productName`。</p>
                  <p>若 CSV 沒帶商品分類，載入後可直接在主表逐列補選；廠商與到貨時間則由同批共用欄位統一帶入。</p>
                </div>
                <Button variant="outline" className="w-full rounded-2xl" onClick={openFilePicker}>
                  <FileUp className="mr-2 h-4 w-4" /> 選擇 CSV 檔案
                </Button>
                <a
                  href={IMPORT_EXAMPLE_CSV_URL}
                  download
                  className="inline-flex h-10 w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  下載範例 CSV
                </a>
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                  {selectedFileName ? `目前已載入：${selectedFileName}` : "尚未選擇檔案；也可先下載範例 CSV 再整理資料"}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[28px] border-0 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-bold">匯入說明</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm leading-7 text-slate-600">
                <p>每列商品一定要有廠商與商品分類，其中商品分類在主表逐列維護；商品批號、商品序號、IMEI 三者只要任一有值即可建立本地資料。</p>
                <p>到貨時間會以同批共用方式寫入本地資料庫，與系統匯入時間分開保存，方便之後每日補齊採購單資料。</p>
                <p>{isAdmin ? "你目前具備管理視角，可同時從管理後台維護品名與站點規則。" : "你目前使用一般作業視角，仍可執行必要匯入並前往 A1 補齊缺欄。"}</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
