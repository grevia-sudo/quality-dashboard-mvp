import { sql } from 'drizzle-orm';
import { backfillProductivityFromCompletedEvents, getDb } from '../server/db.ts';

function pickCount(rows) {
  const first = Array.isArray(rows) ? rows[0] : undefined;
  if (!first || typeof first !== 'object') {
    return null;
  }
  const value = first.missing_d_sampling_pass_events ?? Object.values(first)[0] ?? null;
  return value == null ? null : Number(value);
}

try {
  const db = await getDb();
  if (!db) {
    throw new Error('Database is not available');
  }

  const beforeRows = await db.execute(sql.raw(`
    SELECT COUNT(*) AS missing_d_sampling_pass_events
    FROM station_events se
    LEFT JOIN productivity_score_details psd ON psd.stationEventId = se.id
    WHERE se.stationEventType = 'sampling_pass'
      AND se.stationCode = 'D'
      AND se.countForProductivity = 1
      AND psd.id IS NULL
  `));

  await backfillProductivityFromCompletedEvents(db);

  const afterRows = await db.execute(sql.raw(`
    SELECT COUNT(*) AS missing_d_sampling_pass_events
    FROM station_events se
    LEFT JOIN productivity_score_details psd ON psd.stationEventId = se.id
    WHERE se.stationEventType = 'sampling_pass'
      AND se.stationCode = 'D'
      AND se.countForProductivity = 1
      AND psd.id IS NULL
  `));

  const summaryRows = await db.execute(sql.raw(`
    SELECT
      u.id AS userId,
      u.name,
      u.username,
      COUNT(psd.id) AS detailRows,
      ROUND(COALESCE(SUM(psd.earnedPoints), 0), 4) AS totalPoints
    FROM productivity_score_details psd
    JOIN users u ON u.id = psd.userId
    WHERE psd.stationCode = 'D'
      AND DATE_FORMAT(psd.businessDate, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')
    GROUP BY u.id, u.name, u.username
    ORDER BY detailRows DESC, u.id ASC
  `));

  console.log(JSON.stringify({
    beforeMissingCount: pickCount(beforeRows),
    afterMissingCount: pickCount(afterRows),
    dSummary: summaryRows,
  }, null, 2));

  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
}
