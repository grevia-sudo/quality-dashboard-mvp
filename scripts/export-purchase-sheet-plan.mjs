import fs from "node:fs";

async function main() {
  const [, , planPath, opsPath, syncPath] = process.argv;

  if (!planPath || !opsPath || !syncPath) {
    throw new Error("用法：node scripts/export-purchase-sheet-plan.mjs <plan-json> <ops-tsv> <sync-tsv>");
  }

  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  const opsLines = (plan.operations ?? []).map((operation) => {
    return [operation.type, operation.rowNumber, JSON.stringify(operation.values)].join("\t");
  });
  const syncLines = (plan.syncUpdates ?? []).map((item) => {
    return [item.productId, item.rowNumber].join("\t");
  });

  fs.writeFileSync(opsPath, `${opsLines.join("\n")}${opsLines.length ? "\n" : ""}`);
  fs.writeFileSync(syncPath, `${syncLines.join("\n")}${syncLines.length ? "\n" : ""}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
