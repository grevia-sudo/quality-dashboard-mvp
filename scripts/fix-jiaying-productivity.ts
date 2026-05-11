import { sql } from "drizzle-orm";
import { backfillProductivityFromCompletedEvents, getDb, syncEngineerDailyProductivityRecord } from "../server/db.ts";

const userId = 750212;
const targetDates = ["2026-05-07", "2026-05-08"] as const;

const db = await getDb();
if (!db) {
  throw new Error("Database is not available");
}

const targetDateSql = sql.raw(targetDates.map((value) => `'${value}'`).join(", "));

await db.execute(sql`
  DELETE psd
  FROM productivity_score_details psd
  JOIN (
    SELECT stationEventId, MIN(id) AS keepId
    FROM productivity_score_details
    WHERE userId = ${userId}
      AND businessDate IN (${targetDateSql})
    GROUP BY stationEventId
    HAVING COUNT(*) > 1
  ) dedupe ON dedupe.stationEventId = psd.stationEventId
  WHERE psd.id <> dedupe.keepId
`);

await backfillProductivityFromCompletedEvents(db, { userId });

for (const value of targetDates) {
  await db.execute(sql`
    DELETE FROM engineer_daily_productivity
    WHERE userId = ${userId}
      AND businessDate = ${value}
  `);
  await syncEngineerDailyProductivityRecord(db, {
    userId,
    businessDateValue: new Date(`${value}T00:00:00.000Z`),
  });
}

console.log(JSON.stringify({ success: true, userId, targetDates }));
process.exit(0);
