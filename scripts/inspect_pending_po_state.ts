import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { products, stationTasks, productCategories } from "../drizzle/schema";
import { getDb } from "../server/db";

async function main() {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not available");
  }

  const summary = await db
    .select({
      poNumber: products.poNumber,
      categoryName: productCategories.categoryName,
      subtypeCode: productCategories.subtypeCode,
      total: sql<number>`count(*)`,
    })
    .from(stationTasks)
    .innerJoin(products, eq(stationTasks.productId, products.id))
    .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
    .where(
      and(
        eq(stationTasks.stationCode, "A1"),
        inArray(stationTasks.taskStatus, ["pending", "in_progress", "overdue", "returned"]),
        isNull(products.archivedAt),
      ),
    )
    .groupBy(products.poNumber, productCategories.categoryName, productCategories.subtypeCode)
    .orderBy(desc(sql<number>`max(${products.id})`));

  const poTotals = await db
    .select({
      poNumber: products.poNumber,
      total: sql<number>`count(*)`,
      latestId: sql<number>`max(${products.id})`,
    })
    .from(stationTasks)
    .innerJoin(products, eq(stationTasks.productId, products.id))
    .where(
      and(
        eq(stationTasks.stationCode, "A1"),
        inArray(stationTasks.taskStatus, ["pending", "in_progress", "overdue", "returned"]),
        isNull(products.archivedAt),
      ),
    )
    .groupBy(products.poNumber)
    .orderBy(desc(sql<number>`max(${products.id})`));

  const recentRows = await db
    .select({
      id: products.id,
      poNumber: products.poNumber,
      batchNo: products.batchNo,
      serialNumber: products.serialNumber,
      imei: products.imei,
      productName: products.productName,
      categoryName: productCategories.categoryName,
      subtypeCode: productCategories.subtypeCode,
      createdAt: products.createdAt,
    })
    .from(products)
    .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
    .where(and(eq(products.currentStationCode, "A1"), isNull(products.archivedAt)))
    .orderBy(desc(products.id))
    .limit(20);

  console.log(JSON.stringify({ summary, poTotals, recentRows }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
