import { getStationPageData } from "../server/db";

async function main() {
  const stockPage = await getStationPageData("STOCK");
  const rows = stockPage.tasks.slice(0, 20).map((row) => ({
    taskId: row.taskId,
    productId: row.productId,
    poNumber: row.poNumber,
    batchNo: row.batchNo,
    serialNumber: row.serialNumber,
    imei: row.imei,
    inheritedBatterySummary: row.inheritedBatterySummary ?? null,
    inheritedBFaultSummary: row.inheritedBFaultSummary ?? null,
    inheritedCFaultSummary: row.inheritedCFaultSummary ?? null,
    inheritedCAppearanceSummary: row.inheritedCAppearanceSummary ?? null,
    inheritedCCameraSummary: row.inheritedCCameraSummary ?? null,
    inheritedCInspectionSummary: row.inheritedCInspectionSummary ?? null,
  }));

  const emptySummaryRows = stockPage.tasks
    .filter((row) => !row.inheritedBFaultSummary || !row.inheritedCInspectionSummary)
    .slice(0, 20)
    .map((row) => ({
      taskId: row.taskId,
      productId: row.productId,
      poNumber: row.poNumber,
      batchNo: row.batchNo,
      serialNumber: row.serialNumber,
      inheritedBFaultSummary: row.inheritedBFaultSummary ?? null,
      inheritedCInspectionSummary: row.inheritedCInspectionSummary ?? null,
    }));

  console.log(JSON.stringify({
    total: stockPage.tasks.length,
    rows,
    emptySummaryRows,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
