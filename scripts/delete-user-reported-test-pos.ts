import { deleteImportedPurchaseOrder } from "../server/db";
import { deletePurchaseOrderRowsFromGoogleSheet } from "../server/purchase-sheet-delete-sync";

const poNumbers = Array.from(new Set([
  "TEST-A1-IMEI-1778826816380",
  "PO-BACKUP-1778826816943",
  "PO-20260515-02",
  "PO-NO-IMPORT-1778826818660",
  "PO-BACKUP-DIFF-1778826821042",
  "PO-STOCK-BLOCK-1778826826056",
  "PO-20260515-03",
  "PO-BACKUP-EDGE-1778826827794",
  "PO-20260515-04",
  "PO-20260515-05",
  "PO-TRACE-1778826834298",
  "PO-20260515-06",
  "PO-20260515-07",
  "PO-20260515-08",
  "PO-20260515-09",
  "PO-20260515-10",
  "PO-KPI-GOOGLE-GUARD-1778826846072-google-guard",
  "TEST-A1-DUP-GUARD-1778826849221",
  "TEST-A1-NAME-1778826854207",
  "TEST-A1-SN-1778826856016",
  "TEST-A1-BATCH-1778826857819",
  "TEST-A1-GHOST-1778826859856",
  "PO-GOOGLE-BLANK-1778826861695",
  "PO-GOOGLE-BATCH-1778826866888",
  "PO-A1-RENAME-1778826869516",
  "PO-E-RESTORE-1778826873289",
  "PO-BATCH-GUARD-1778826897044",
  "PO-BATCH-BASE-NORMALIZED-1778826900251",
  "PO-BATCH-BASE-1778826903894",
  "PO-A1-NAME-1778826926539",
]));

async function main() {
  const results: Array<Record<string, unknown>> = [];

  for (const poNumber of poNumbers) {
    try {
      const deleted = await deleteImportedPurchaseOrder({
        poNumber,
        deletedByName: "Manus cleanup by user confirmation",
      });

      let googleFallback: Record<string, unknown> | null = null;
      if ((deleted.deletedProducts ?? 0) === 0) {
        const fallback = await deletePurchaseOrderRowsFromGoogleSheet({
          poNumber,
          products: [],
        });
        googleFallback = {
          success: fallback.success,
          skipped: fallback.skipped,
          reason: fallback.reason ?? null,
          deletedRowNumbers: fallback.deletedRowNumbers,
        };
      }

      results.push({
        poNumber,
        deletedProducts: deleted.deletedProducts,
        deletedTasks: deleted.deletedTasks,
        resultStatus: deleted.resultStatus ?? null,
        googleSheetSync: deleted.googleSheetSync ?? null,
        googleFallback,
      });
    } catch (error) {
      results.push({
        poNumber,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(JSON.stringify(results, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
