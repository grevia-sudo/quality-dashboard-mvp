import { getDb, backfillProductivityFromCompletedEvents } from "../server/db.ts";

const db = await getDb();
if (!db) {
  throw new Error("Database is not available");
}

await backfillProductivityFromCompletedEvents(db, { userId: 750212 });
console.log(JSON.stringify({ success: true, userId: 750212 }));
