import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout, { type DashboardNavItem } from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import {
  exportPendingStockMismatchRowsToCsv,
  filterPendingStockMismatchRows,
  getPendingStockMismatchVendorOptions,
  summarizePendingStockMismatchRows,
  type PendingStockMismatchMissingFieldFilter,
  type PendingStockMismatchRow,
} from "./pending-stock-mismatch-filter";
import { createUtf8CsvBlob } from "./station-stock-export";
import { Boxes, ClipboardCheck, Download, Gauge, PackagePlus, ShieldAlert, ShieldCheck } from "lucide-react";
import { useLocation } from "wouter";

const MANAGEMENT_VIEWER_ROLES = ["supervisor", "manager", "admin"];

const navItems: DashboardNavItem[] = [
  { label: "站點總覽", path: "/operations", icon: Boxes },
  { label: "匯入作業", path: "/import", icon: PackagePlus, allowedRoles: MANAGEMENT_VIEWER_ROLES },
  { label: "D 站抽樣", path: "/sampling", icon: ClipboardCheck, allowedRoles: MANAGEMENT_VIEWER_ROLES },
  { label: "工程師 KPI", path: "/kpi", icon: Gauge },
  { label: "管理後台", path: "/admin", icon: ShieldCheck, allowedRoles: ["admin"] },
  { label: "待入庫待比對", path: "/admin/pending-stock-mismatches", icon: ShieldAlert, allowedRoles: ["admin"] },
];

function formatDateTime(value?: string | Date | null) {
  if (!value) {
    return "-";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PendingStockMismatchPage() {
  const { user } = useAuth({ redirectOnUnauthenticated: true });
  const [, setLocation] = useLocation();
  const query = trpc.admin.pendingStockMismatches.useQuery(undefined, { retry: false });
  const [searchKeyword, setSearchKeyword] = useState("");
  const [missingFieldFilter, setMissingFieldFilter] = useState<PendingStockMismatchMissingFieldFilter>("all");
  const [vendorFilter, setVendorFilter] = useState("");
  const [arrivalDateStart, setArrivalDateStart] = useState("");
  const [arrivalDateEnd, setArrivalDateEnd] = useState("");

  useEffect(() => {
    if (user && user.role !== "admin") {
      setLocation("/operations");
    }
  }, [setLocation, user]);

  const rows = query.data ?? [];
  const vendorOptions = useMemo(() => getPendingStockMismatchVendorOptions(rows), [rows]);
  const filteredRows = useMemo(() => filterPendingStockMismatchRows(rows, {
    searchKeyword,
    missingFieldFilter,
    vendorFilter,
    arrivalDateStart,
    arrivalDateEnd,
  }), [arrivalDateEnd, arrivalDateStart, missingFieldFilter, rows, searchKeyword, vendorFilter]);

  const summary = useMemo(() => summarizePendingStockMismatchRows(filteredRows), [filteredRows]);
  const handleExportCsv = () => {
    const csvContent = exportPendingStockMismatchRowsToCsv(filteredRows);
    const blob = createUtf8CsvBlob(csvContent);
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
    link.href = url;
    link.download = `pending-stock-mismatches-${timestamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };
  const goToImportPage = (row?: PendingStockMismatchRow) => {
    const params = new URLSearchParams();
    if (row?.batchNo) {
      params.set("batchNo", row.batchNo);
    }
    if (row?.serialNumber) {
      params.set("serialNumber", row.serialNumber);
    }
    if (row?.imei) {
      params.set("imei", row.imei);
    }
    if (row?.vendorName) {
      params.set("vendorName", row.vendorName);
    }
    const queryString = params.toString();
    setLocation(queryString ? `/import?${queryString}` : "/import");
  };

  if (user && user.role !== "admin") {
    return null;
  }

  return (
    <DashboardLayout title="待入庫待比對查詢" navItems={navItems}>
      <div className="space-y-6">
        <section className="rounded-[28px] border border-slate-200/70 bg-white/92 p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <Badge variant="secondary" className="w-fit rounded-full bg-amber-100 px-3 py-1 text-amber-700">
                待入庫但未完成匯入比對
              </Badge>
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight text-slate-900">待入庫待比對商品清單</h1>
                <p className="max-w-3xl text-sm leading-7 text-slate-600">
                  這個頁面只列出目前已經流轉到待入庫站點，但仍缺少採購單號、商品分類或品牌資料的商品。
                  管理者可先用這份清單追查補匯入，再回到待入庫站點完成入庫。
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" className="rounded-2xl" onClick={() => query.refetch()} disabled={query.isFetching}>
                {query.isFetching ? "重新整理中" : "重新整理"}
              </Button>
              <Button variant="outline" className="rounded-2xl" onClick={handleExportCsv} disabled={filteredRows.length === 0}>
                <Download className="mr-2 h-4 w-4" />
                匯出 CSV
              </Button>
              <Button className="rounded-2xl" onClick={() => goToImportPage()}>
                前往匯入作業
              </Button>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          <Card className="rounded-[26px] border-slate-200/70 bg-white/90 shadow-[0_14px_34px_rgba(15,23,42,0.05)]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-500">待追查總數</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold text-slate-900">{summary.total}</p>
            </CardContent>
          </Card>
          <Card className="rounded-[26px] border-slate-200/70 bg-white/90 shadow-[0_14px_34px_rgba(15,23,42,0.05)]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-500">缺少採購單號</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold text-slate-900">{summary.missingPo}</p>
            </CardContent>
          </Card>
          <Card className="rounded-[26px] border-slate-200/70 bg-white/90 shadow-[0_14px_34px_rgba(15,23,42,0.05)]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-500">缺少商品分類</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold text-slate-900">{summary.missingCategory}</p>
            </CardContent>
          </Card>
          <Card className="rounded-[26px] border-slate-200/70 bg-white/90 shadow-[0_14px_34px_rgba(15,23,42,0.05)]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-500">缺少品牌</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold text-slate-900">{summary.missingBrand}</p>
            </CardContent>
          </Card>
        </section>

        <Card className="rounded-[28px] border-slate-200/70 bg-white/94 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
          <CardHeader className="space-y-2 pb-4">
            <CardTitle className="text-xl text-slate-900">詳細清單</CardTitle>
            <p className="text-sm leading-7 text-slate-600">
              若商品已在待入庫，但這裡仍出現，代表它尚未完成匯入比對，系統會在待入庫完成前阻止直接入庫。
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 rounded-[24px] border border-slate-200/80 bg-slate-50/80 p-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-2 xl:col-span-2">
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">查詢關鍵字</p>
                <Input
                  value={searchKeyword}
                  onChange={(event) => setSearchKeyword(event.target.value)}
                  placeholder="可搜尋產品編號、品名、批號、序號、IMEI、PO、廠商"
                  className="editable-field rounded-2xl border-0 bg-white"
                />
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">缺漏欄位</p>
                <select
                  value={missingFieldFilter}
                  onChange={(event) => setMissingFieldFilter(event.target.value as PendingStockMismatchMissingFieldFilter)}
                  className="editable-select h-10 rounded-2xl border-0 bg-white px-3 text-slate-900 shadow-sm outline-none"
                >
                  <option value="all">全部缺漏</option>
                  <option value="採購單號">缺採購單號</option>
                  <option value="商品分類">缺商品分類</option>
                  <option value="品牌">缺品牌</option>
                </select>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">廠商</p>
                <select
                  value={vendorFilter}
                  onChange={(event) => setVendorFilter(event.target.value)}
                  className="editable-select h-10 rounded-2xl border-0 bg-white px-3 text-slate-900 shadow-sm outline-none"
                >
                  <option value="">全部廠商</option>
                  {vendorOptions.map((vendorName) => (
                    <option key={vendorName} value={vendorName}>{vendorName}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">到貨日期起</p>
                <Input
                  type="date"
                  value={arrivalDateStart}
                  onChange={(event) => setArrivalDateStart(event.target.value)}
                  className="editable-field rounded-2xl border-0 bg-white"
                />
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">到貨日期迄</p>
                <Input
                  type="date"
                  value={arrivalDateEnd}
                  onChange={(event) => setArrivalDateEnd(event.target.value)}
                  className="editable-field rounded-2xl border-0 bg-white"
                />
              </div>
            </div>

            {query.error ? (
              <div className="rounded-[24px] border border-rose-200 bg-rose-50/80 px-6 py-5 text-sm leading-7 text-rose-700">
                清單讀取失敗：{query.error.message}
              </div>
            ) : null}

            {query.isLoading ? (
              <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/80 px-6 py-10 text-sm text-slate-500">
                正在載入未比對待入庫商品清單。
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-emerald-200 bg-emerald-50/70 px-6 py-10 text-sm leading-7 text-emerald-700">
                目前沒有待入庫但尚未完成匯入比對的商品，表示待入庫清單已經清乾淨。
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full table-fixed border-separate border-spacing-y-3 text-sm text-slate-700">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-[0.16em] text-slate-500">
                      <th className="px-4 py-2">商品</th>
                      <th className="px-4 py-2">識別資訊</th>
                      <th className="px-4 py-2">匯入比對缺漏</th>
                      <th className="px-4 py-2">已掛站點資訊</th>
                      <th className="px-4 py-2">最後更新</th>
                      <th className="px-4 py-2 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => (
                      <tr key={`${row.productId}-${row.stockTaskId ?? "no-task"}`} className="align-top">
                        <td className="rounded-l-[22px] bg-slate-50/80 px-4 py-4">
                          <div className="space-y-1">
                            <p className="font-semibold text-slate-900">{row.productName || "未填品名"}</p>
                            <p className="text-xs text-slate-500">產品編號：{row.productCode || "-"}</p>
                            <p className="text-xs text-slate-500">PO：{row.poNumber || "未補匯入"}</p>
                            <p className="text-xs text-slate-500">廠商：{row.vendorName || "-"}</p>
                          </div>
                        </td>
                        <td className="bg-slate-50/80 px-4 py-4">
                          <div className="space-y-1 text-xs leading-6 text-slate-600">
                            <p>批號：{row.batchNo || "-"}</p>
                            <p>序號：{row.serialNumber || "-"}</p>
                            <p>IMEI：{row.imei || "-"}</p>
                          </div>
                        </td>
                        <td className="bg-slate-50/80 px-4 py-4">
                          <div className="space-y-2">
                            <Badge variant="secondary" className="rounded-full bg-amber-100 text-amber-700">
                              {row.mismatchReason}
                            </Badge>
                            <div className="space-y-1 text-xs leading-6 text-slate-600">
                              <p>匯入分類：{row.importedCategoryName || "未補齊"}</p>
                              <p>匯入品牌：{row.importedBrandName || "未補齊"}</p>
                              <p>指定品類：{row.assignedCategoryName || "未指定"}</p>
                              <p>指定品牌：{row.assignedBrandName || "未指定"}</p>
                            </div>
                          </div>
                        </td>
                        <td className="bg-slate-50/80 px-4 py-4">
                          <div className="space-y-1 text-xs leading-6 text-slate-600">
                            <p>目前站點：{row.currentStationCode}</p>
                            <p>狀態：{row.currentStatus}</p>
                            <p>待入庫任務：{row.stockTaskStatus || "未建立"}</p>
                            <p>到貨時間：{formatDateTime(row.arrivalAt)}</p>
                          </div>
                        </td>
                        <td className="bg-slate-50/80 px-4 py-4 text-xs leading-6 text-slate-600">
                          <p>任務建立：{formatDateTime(row.stockTaskCreatedAt)}</p>
                          <p>最後更新：{formatDateTime(row.updatedAt)}</p>
                        </td>
                        <td className="rounded-r-[22px] bg-slate-50/80 px-4 py-4 text-right">
                          <Button type="button" variant="outline" className="rounded-2xl" onClick={() => goToImportPage(row)}>
                            前往補匯入
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
