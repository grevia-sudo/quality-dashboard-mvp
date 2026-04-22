import { and, eq, inArray, isNull } from "drizzle-orm";
import { productArchives, products, stationTasks } from "../drizzle/schema";
import { getDb } from "../server/db";

const TARGET_PO_NUMBERS = [
  "PO-20260422-04",
  "PO-20260422-03",
  "PO-20260422-02",
  "PO-20260422-01",
  "PO-20260420-01",
  "PO-20260422-05",
  "PO-20260422-06",
  "PO-20260422-07",
];

async function main() {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  const targetProducts = await db
    .select()
    .from(products)
    .where(and(inArray(products.poNumber, TARGET_PO_NUMBERS), isNull(products.archivedAt)));

  if (targetProducts.length === 0) {
    console.log(JSON.stringify({ archivedCount: 0, poNumbers: TARGET_PO_NUMBERS }, null, 2));
    return;
  }

  const productIds = targetProducts.map((product) => product.id);
  const archiveMonth = new Date().toISOString().slice(0, 7);

  await db.insert(productArchives).values(
    targetProducts.map((product) => ({
      originalProductId: product.id,
      productSnapshot: product,
      archiveMonth,
    })),
  );

  await db
    .update(products)
    .set({
      archivedAt: new Date(),
      currentStatus: "archived",
      updatedAt: new Date(),
    })
    .where(inArray(products.id, productIds));

  await db
    .update(stationTasks)
    .set({ taskStatus: "archived" })
    .where(and(inArray(stationTasks.productId, productIds), eq(stationTasks.stationCode, "A1")));

  console.log(
    JSON.stringify(
      {
        archivedCount: targetProducts.length,
        poNumbers: Array.from(new Set(targetProducts.map((product) => product.poNumber).filter(Boolean))),
        productIds,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
