import DashboardLayout, { type DashboardNavItem } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Boxes, ClipboardCheck, Gauge, PackagePlus, ShieldCheck, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

type ImportDraftRow = {
  batchNo: string;
  serialNumber: string;
  imei: string;
  productName: string;
};

const navItems: DashboardNavItem[] = [
  { label: "站點總覽", path: "/operations", icon: Boxes },
  { label: "匯入作業", path: "/import", icon: PackagePlus },
  { label: "D 站抽樣", path: "/sampling", icon: ClipboardCheck },
  { label: "工程師 KPI", path: "/kpi", icon: Gauge },
  { label: "管理後台", path: "/admin", icon: ShieldCheck },
];

const createEmptyRow = (): ImportDraftRow => ({
  batchNo: "",
  serialNumber: "",
  imei: "",
  productName: "",
});

function parseBulkText(input: string): ImportDraftRow[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [batchNo = "", serialNumber = "", imei = "", productName = ""] = line
        .split(/[\t,]/)
        .map((cell) => cell.trim());

      return {
        batchNo,
        serialNumber,
        imei,
        productName,
      };
    })
    .filter((row) => row.batchNo || row.serialNumber || row.productName);
}

export default function ImportPage() {
  const [, setLocation] = useLocation();
  const authQuery = trpc.auth.me.useQuery(undefined, { retry: false });
  const [poNumber, setPoNumber] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [rows, setRows] = useState<ImportDraftRow[]>([createEmptyRow(), createEmptyRow()]);
  const utils = trpc.useUtils();

  const importMutation = trpc.station.importBatch.useMutation({
    onSuccess: async (result) => {
      toast.success(`已匯入 ${result.importedCount} 筆商品資料`);
      setRows([createEmptyRow(), createEmptyRow()]);
      setBulkText("");
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
    () => rows
      .map((row) => ({
        batchNo: row.batchNo.trim(),
        serialNumber: row.serialNumber.trim(),
        imei: row.imei.trim(),
        productName: row.productName.trim(),
      }))
      .filter((row) => row.batchNo && row.serialNumber && row.productName),
    [rows],
  );

  const canImport = preparedRows.length > 0;
  const isAdmin = ["admin", "manager", "supervisor"].includes(authQuery.data?.role ?? "user");

  const updateRow = (index: number, patch: Partial<ImportDraftRow>) => {
    setRows((prev) => prev.map((row, currentIndex) => (currentIndex === index ? { ...row, ...patch } : row)));
  };

  const appendParsedRows = () => {
    const parsedRows = parseBulkText(bulkText);
    if (parsedRows.length === 0) {
      toast.error("請先貼上至少一筆 CSV 或 TSV 資料");
      return;
    }

    setRows((prev) => [...prev, ...parsedRows]);
    setBulkText("");
    toast.success(`已追加 ${parsedRows.length} 筆匯入資料`);
  };

  return (
    <DashboardLayout title="匯入作業" navItems={navItems}>
      <div className="space-y-6">
        <Card className="rounded-[28px] border-0 bg-[#eef2f7] shadow-sm">
          <CardContent className="space-y-4 p-8">
            <Badge className="bg-white/80 text-slate-700">PO 與 A1 建檔入口</Badge>
            <h1 className="text-3xl font-black tracking-tight text-slate-900">先匯入資料，再交由 A1 點到貨與各站點接續處理</h1>
            <p className="max-w-3xl text-sm leading-7 text-slate-600">
              同一次匯入可共用一個 PO 單號。每列資料包含商品批號、序號、IMEI 與品名；匯入完成後，系統會先寫入 DB 並建立 A1 待處理任務，再由背景程序非同步回寫 Google Sheet。
            </p>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" className="rounded-2xl" onClick={() => setLocation("/operations")}>返回站點總覽</Button>
              <Button variant="outline" className="rounded-2xl" onClick={() => setLocation("/admin")}>前往管理後台</Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <Card className="rounded-[28px] border-0 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-bold">匯入主表</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="space-y-2 text-sm text-slate-600">
                <span>PO 單號（同批共用）</span>
                <Input value={poNumber} onChange={(event) => setPoNumber(event.target.value)} className="rounded-2xl border-0 bg-slate-50" placeholder="例如 PO-20260421-01" />
              </label>

              <div className="space-y-3">
                {rows.map((row, index) => (
                  <div key={`row-${index}`} className="grid gap-3 rounded-[24px] bg-slate-50 p-4 md:grid-cols-2 xl:grid-cols-4">
                    <Input value={row.batchNo} onChange={(event) => updateRow(index, { batchNo: event.target.value })} className="rounded-2xl border-0 bg-white" placeholder="商品批號" />
                    <Input value={row.serialNumber} onChange={(event) => updateRow(index, { serialNumber: event.target.value })} className="rounded-2xl border-0 bg-white" placeholder="商品序號" />
                    <Input value={row.imei} onChange={(event) => updateRow(index, { imei: event.target.value })} className="rounded-2xl border-0 bg-white" placeholder="IMEI（選填）" />
                    <Input value={row.productName} onChange={(event) => updateRow(index, { productName: event.target.value })} className="rounded-2xl border-0 bg-white" placeholder="品名" />
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
                      rows: preparedRows.map((row) => ({
                        batchNo: row.batchNo,
                        serialNumber: row.serialNumber,
                        imei: row.imei || undefined,
                        productName: row.productName,
                        categoryId: null,
                      })),
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
                <CardTitle className="flex items-center gap-2 text-base font-bold text-slate-900"><Upload className="h-4 w-4 text-[#7ca3d9]" /> CSV／TSV 貼上匯入</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <textarea
                  value={bulkText}
                  onChange={(event) => setBulkText(event.target.value)}
                  className="min-h-48 w-full rounded-[24px] border-0 bg-slate-50 p-4 text-sm text-slate-700 outline-none ring-0"
                  placeholder={"每行一筆，欄位順序：商品批號,商品序號,IMEI,品名\n支援逗號 CSV 或 Tab 分隔。"}
                />
                <Button variant="outline" className="w-full rounded-2xl" onClick={appendParsedRows}>追加到匯入主表</Button>
              </CardContent>
            </Card>

            <Card className="rounded-[28px] border-0 bg-white shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-bold">匯入說明</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm leading-7 text-slate-600">
                <p>商品批號建議維持唯一識別，序號則允許因二次回收而重複；IMEI 若無可先留空，後續可在 A1 頁面直接補錄。</p>
                <p>匯入後請前往 A1 點到貨頁確認資料是否齊全，再交由 A2、B、C、D、E 與待入庫流程往下處理。</p>
                <p>{isAdmin ? "你目前具備管理視角，可同時從管理後台維護功能表與站點規則。" : "你目前使用一般作業視角，仍可執行必要匯入並前往 A1 站處理到貨。"}</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
