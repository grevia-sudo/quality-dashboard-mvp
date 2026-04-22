import { execFileSync } from "node:child_process";
import mysql from "mysql2/promise";
import {
  buildSheetRow,
  createInitialSheetValues,
  findMatchingRowNumber,
  mergeMissingCells,
  SHEET_NAME,
  SPREADSHEET_ID,
} from "./purchase-sheet-sync-helpers.mjs";

function runGwsJson(args) {
  const output = execFileSync("gws", [...args, "--format", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return output.trim() ? JSON.parse(output) : {};
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL 不存在，無法執行採購單同步");
  }

  const connection = await mysql.createConnection(process.env.DATABASE_URL);

  try {
    const [products] = await connection.query(
      `
        SELECT
          p.id,
          p.poNumber,
          p.vendorName,
          p.batchNo,
          p.serialNumber,
          p.imei,
          p.productName,
          p.sheetRowNumber,
          p.lastSheetSyncedAt,
          p.updatedAt,
          c.categoryName,
          c.subtypeCode
        FROM products p
        LEFT JOIN product_categories c ON c.id = p.categoryId
        WHERE p.archivedAt IS NULL
          AND p.vendorName IS NOT NULL
          AND p.categoryId IS NOT NULL
          AND (p.batchNo IS NOT NULL OR p.serialNumber IS NOT NULL OR p.imei IS NOT NULL)
          AND (
            p.lastSheetSyncedAt IS NULL
            OR p.updatedAt > p.lastSheetSyncedAt
            OR p.sheetRowNumber IS NULL
          )
        ORDER BY p.id ASC
      `,
    );

    const sheetResponse = runGwsJson([
      "sheets",
      "+read",
      "--spreadsheet",
      SPREADSHEET_ID,
      "--range",
      `${SHEET_NAME}!A:G`,
    ]);
    const normalizedValues = createInitialSheetValues(sheetResponse.values);

    let appendedCount = 0;
    let updatedCount = 0;

    for (const product of products) {
      const generatedRow = buildSheetRow(product);
      let rowNumber = product.sheetRowNumber ?? findMatchingRowNumber(normalizedValues, product);

      if (rowNumber) {
        const existingRow = normalizedValues[rowNumber - 1] ?? [];
        const mergedRow = mergeMissingCells(existingRow, generatedRow);

        runGwsJson([
          "sheets",
          "spreadsheets",
          "values",
          "update",
          "--params",
          JSON.stringify({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A${rowNumber}:G${rowNumber}`,
            valueInputOption: "USER_ENTERED",
          }),
          "--json",
          JSON.stringify({ values: [mergedRow] }),
        ]);

        normalizedValues[rowNumber - 1] = mergedRow;
        updatedCount += 1;
      } else {
        const appendedRowNumber = normalizedValues.length + 1;

        runGwsJson([
          "sheets",
          "+append",
          "--spreadsheet",
          SPREADSHEET_ID,
          "--json-values",
          JSON.stringify([generatedRow]),
        ]);

        normalizedValues.push(generatedRow);
        rowNumber = appendedRowNumber;
        appendedCount += 1;
      }

      await connection.execute(
        `UPDATE products SET sheetRowNumber = ?, lastSheetSyncedAt = CURRENT_TIMESTAMP WHERE id = ?`,
        [rowNumber, product.id],
      );
    }

    await connection.execute(
      `UPDATE sheet_sync_jobs SET syncJobStatus = 'success', finishedAt = CURRENT_TIMESTAMP WHERE syncJobStatus = 'queued' AND targetSheetName = ?`,
      [SHEET_NAME],
    );

    console.log(JSON.stringify({
      success: true,
      sheetName: SHEET_NAME,
      processedCount: products.length,
      appendedCount,
      updatedCount,
    }));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ success: false, message: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
