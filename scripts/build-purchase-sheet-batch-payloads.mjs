import fs from "node:fs";

async function main() {
  const [, , planPath, appendPayloadPath, updatePayloadPath] = process.argv;

  if (!planPath || !appendPayloadPath || !updatePayloadPath) {
    throw new Error("用法：node scripts/build-purchase-sheet-batch-payloads.mjs <plan-json> <append-json> <update-json>");
  }

  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  const appendValues = [];
  const updateData = [];

  for (const operation of plan.operations ?? []) {
    if (operation.type === "append") {
      for (const row of operation.values ?? []) {
        appendValues.push(row);
      }
      continue;
    }

    updateData.push({
      range: `${plan.sheetName}!A${operation.rowNumber}:H${operation.rowNumber}`,
      values: operation.values ?? [],
    });
  }

  fs.writeFileSync(
    appendPayloadPath,
    JSON.stringify(
      {
        values: appendValues,
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(
    updatePayloadPath,
    JSON.stringify(
      {
        valueInputOption: "USER_ENTERED",
        data: updateData,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
