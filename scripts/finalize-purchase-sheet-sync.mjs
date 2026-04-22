import fs from "node:fs";
import mysql from "mysql2/promise";

async function main() {
  const [, , planPath, summaryPath] = process.argv;

  if (!planPath || !summaryPath) {
    throw new Error("用法：node scripts/finalize-purchase-sheet-sync.mjs <plan-json> <summary-json>");
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL 不存在，無法回寫同步狀態");
  }

  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  const connection = await mysql.createConnection(process.env.DATABASE_URL);

  try {
    for (const item of plan.syncUpdates ?? []) {
      await connection.query(
        "UPDATE products SET sheetRowNumber = ?, lastSheetSyncedAt = CURRENT_TIMESTAMP WHERE id = ?",
        [item.rowNumber, item.productId],
      );
    }

    fs.writeFileSync(
      summaryPath,
      JSON.stringify(
        {
          success: true,
          spreadsheetId: plan.spreadsheetId,
          sheetName: plan.sheetName,
          processedCount: plan.processedCount ?? 0,
          appendedCount: plan.appendedCount ?? 0,
          updatedCount: plan.updatedCount ?? 0,
          syncedCount: (plan.syncUpdates ?? []).length,
        },
        null,
        2,
      ),
    );
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ success: false, message: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
