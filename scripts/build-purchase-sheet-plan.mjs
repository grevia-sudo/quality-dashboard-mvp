import fs from "node:fs";
import mysql from "mysql2/promise";
import {
  buildSheetRow,
  createInitialSheetValues,
  findMatchingRowNumber,
  mergeMissingCells,
  SHEET_NAME,
  SPREADSHEET_ID,
} from "./purchase-sheet-sync-helpers.mjs";

async function main() {
  const [, , sheetJsonPath, outputPath] = process.argv;

  if (!sheetJsonPath || !outputPath) {
    throw new Error("用法：node scripts/build-purchase-sheet-plan.mjs <sheet-json> <output-json>");
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL 不存在，無法建立採購單同步計畫");
  }

  const sheetResponse = JSON.parse(fs.readFileSync(sheetJsonPath, "utf8"));
  const normalizedValues = createInitialSheetValues(sheetResponse.values);
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
          p.importedCategoryName,
          p.sheetRowNumber,
          p.lastSheetSyncedAt,
          p.updatedAt,
          c.categoryName,
          a1.completedAt AS a1CompletedAt,
          a2.completedAt AS a2CompletedAt
        FROM products p
        LEFT JOIN product_categories c ON c.id = p.categoryId
        LEFT JOIN (
          SELECT \`productId\`, MAX(\`completedAt\`) AS \`completedAt\`
          FROM \`station_tasks\`
          WHERE \`stationCode\` = 'A1' AND \`stationTaskStatus\` = 'completed'
          GROUP BY \`productId\`
        ) a1 ON a1.productId = p.id
        LEFT JOIN (
          SELECT `productId`, MAX(`completedAt`) AS `completedAt`
          FROM `station_tasks`
          WHERE `stationCode` = 'A2' AND `stationTaskStatus` = 'completed'
          GROUP BY `productId`
        ) a2 ON a2.productId = p.id
        WHERE p.archivedAt IS NULL
          AND p.vendorName IS NOT NULL
          AND (p.importedCategoryName IS NOT NULL OR c.categoryName IS NOT NULL)
          AND (p.batchNo IS NOT NULL OR p.serialNumber IS NOT NULL OR p.imei IS NOT NULL)
          AND (
            p.lastSheetSyncedAt IS NULL
            OR p.updatedAt > p.lastSheetSyncedAt
            OR p.sheetRowNumber IS NULL
            OR (a1.completedAt IS NOT NULL AND (p.lastSheetSyncedAt IS NULL OR a1.completedAt > p.lastSheetSyncedAt))
            OR (a2.completedAt IS NOT NULL AND (p.lastSheetSyncedAt IS NULL OR a2.completedAt > p.lastSheetSyncedAt))
          )
        ORDER BY p.id ASC
      `,
    );

    let appendedCount = 0;
    let updatedCount = 0;
    const operations = [];
    const syncUpdates = [];

    for (const product of products) {
      const generatedRow = buildSheetRow(product);
      let rowNumber = product.sheetRowNumber ?? findMatchingRowNumber(normalizedValues, product);

      if (rowNumber) {
        const existingRow = normalizedValues[rowNumber - 1] ?? [];
        const mergedRow = mergeMissingCells(existingRow, generatedRow);
        normalizedValues[rowNumber - 1] = mergedRow;
        operations.push({ type: "update", rowNumber, values: [mergedRow] });
        updatedCount += 1;
      } else {
        rowNumber = normalizedValues.length + 1;
        normalizedValues.push(generatedRow);
        operations.push({ type: "append", rowNumber, values: [generatedRow] });
        appendedCount += 1;
      }

      syncUpdates.push({ productId: product.id, rowNumber });
    }

    fs.writeFileSync(
      outputPath,
      JSON.stringify(
        {
          success: true,
          spreadsheetId: SPREADSHEET_ID,
          sheetName: SHEET_NAME,
          processedCount: products.length,
          appendedCount,
          updatedCount,
          operations,
          syncUpdates,
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
