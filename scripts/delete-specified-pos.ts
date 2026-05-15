import { deleteImportedPurchaseOrder } from "../server/db";
import { deletePurchaseOrderRowsFromGoogleSheet } from "../server/purchase-sheet-delete-sync";

const poNumbers = Array.from(new Set([
  "TEST-A1-IMEI-1778749381829",
  "PO-KPI-WRITE-1778749381827",
  "PO-20260514-04",
  "PO-STOCK-BLOCK-1778749390586",
  "PO-KPI-FALLBACK-1778749392323-fallback",
  "PO-BACKUP-EDGE-1778749392638",
  "PO-20260514-05",
  "PO-20260514-07",
  "PO-20260514-12",
  "TEST-A1-DUP-GUARD-1778749412041",
  "TEST-A1-NAME-1778749416728",
  "TEST-A1-SN-1778749418491",
  "PO-KPI-MISSING-GOOGLE-1778749418051-missing-google",
  "PO-KPI-D-SAMPLING-PASS-1778750585732-d-sampling-pass",
  "PO-KPI-MISSING-GOOGLE-1778750592526-missing-google",
  "PO-KPI-IDEMPOTENT-1778750598137-idempotent",
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
