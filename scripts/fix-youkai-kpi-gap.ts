import { sql } from "drizzle-orm";
import { backfillProductivityFromCompletedEvents, getDb, syncEngineerDailyProductivityRecord } from "../server/db.ts";

const userId = 750192;
const targetDate = "2026-05-13";
const missingBatches = [
  "00500025209",
  "00500025225",
  "00500025228",
  "00500025229",
  "00500025239",
  "00500025240",
  "00500025241",
  "00500025247",
  "00500025252",
  "00500025253",
  "00500025256",
  "00500025264",
  "00500025266",
  "00500025269",
  "00500025271",
] as const;

const db = await getDb();
if (!db) {
  throw new Error("Database is not available");
}

await db.execute(sql`
  DELETE psd
  FROM productivity_score_details psd
  JOIN (
    SELECT stationEventId, MIN(id) AS keepId
    FROM productivity_score_details
    WHERE userId = ${userId}
      AND businessDate = ${targetDate}
    GROUP BY stationEventId
    HAVING COUNT(*) > 1
  ) dedupe ON dedupe.stationEventId = psd.stationEventId
  WHERE psd.id <> dedupe.keepId
`);

await db.execute(sql`
  DELETE FROM engineer_daily_productivity
  WHERE userId = ${userId}
    AND businessDate = ${targetDate}
`);

await backfillProductivityFromCompletedEvents(db, { userId });
await syncEngineerDailyProductivityRecord(db, {
  userId,
  businessDateValue: new Date(`${targetDate}T00:00:00.000Z`),
});

const duplicateSummary = await db.execute(sql`
  SELECT COUNT(*) AS rowCount, COUNT(DISTINCT stationEventId) AS distinctEventCount
  FROM productivity_score_details
  WHERE userId = ${userId}
    AND businessDate = ${targetDate}
`);

const missingBatchSummary = await db.execute(sql.raw(`
  SELECT batchNo, sheetRowNumber, lastSheetSyncedAt
  FROM products
  WHERE batchNo IN (${missingBatches.map((value) => `'${value}'`).join(", ")})
  ORDER BY batchNo
`));

console.log(JSON.stringify({
  success: true,
  userId,
  targetDate,
  duplicateSummary,
  missingBatchSummary,
}));

process.exit(0);
