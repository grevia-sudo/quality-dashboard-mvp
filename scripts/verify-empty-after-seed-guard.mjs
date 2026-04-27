import { sql } from "drizzle-orm";
import { ensureMvpSeedData, getDb } from "../server/db.ts";
import { products, stationTasks, users } from "../drizzle/schema.ts";

const db = await getDb();

if (!db) {
  throw new Error("Database client unavailable");
}

const countRows = async () => {
  const [productRow] = await db.select({ count: sql`count(*)` }).from(products);
  const [taskRow] = await db.select({ count: sql`count(*)` }).from(stationTasks);
  const [userRow] = await db.select({ count: sql`count(*)` }).from(users);

  return {
    products: Number(productRow?.count ?? 0),
    stationTasks: Number(taskRow?.count ?? 0),
    users: Number(userRow?.count ?? 0),
  };
};

const before = await countRows();
await ensureMvpSeedData();
const after = await countRows();

console.log(JSON.stringify({
  nodeEnv: process.env.NODE_ENV ?? null,
  before,
  after,
}, null, 2));
