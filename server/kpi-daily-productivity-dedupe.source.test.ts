import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("engineer daily productivity dedupe source", () => {
  it("keeps engineer_daily_productivity unique by user and business date in schema", () => {
    const schemaSource = readFileSync(path.resolve(__dirname, "../drizzle/schema.ts"), "utf8");
    expect(schemaSource).toContain('uniqueIndex("engineer_daily_productivity_user_date_unique_idx").on(table.userId, table.businessDate)');
  });

  it("keeps productivity_score_details unique by station event in schema", () => {
    const schemaSource = readFileSync(path.resolve(__dirname, "../drizzle/schema.ts"), "utf8");
    expect(schemaSource).toContain('uniqueIndex("productivity_score_details_station_event_unique_idx").on(table.stationEventId)');
  });

  it("cleans duplicate or stale daily productivity rows during sync and PO deletion", () => {
    const dbSource = readFileSync(path.resolve(__dirname, "../server/db.ts"), "utf8");
    expect(dbSource).toContain("const hasAnyRelevantActivity = dailyDetails.length > 0");
    expect(dbSource).toContain("await db.delete(engineerDailyProductivity).where(inArray(engineerDailyProductivity.id, existingRows.map((row) => row.id)));");
    expect(dbSource).toContain("if (existingRows.length > 1)");
    expect(dbSource).toContain("await syncEngineerDailyProductivityRecords(db, Array.from(affectedProductivityItems.values()));");
  });

  it("keeps Google-missing events out of KPI writes but allows later re-enable after Google sync", () => {
    const dbSource = readFileSync(path.resolve(__dirname, "../server/db.ts"), "utf8");
    expect(dbSource).toContain("const hasGoogleBaseline = Boolean(normalizedBatchKey && googleBatchKeys.has(normalizedBatchKey));");
    expect(dbSource).toContain("countForProductivity: false,");
    expect(dbSource).toContain("if (!event.countForProductivity) {");
    expect(dbSource).toContain("countForProductivity: true,");
  });

  it("builds today points from detail rows and uses direct display points without double-counting support", () => {
    const dbSource = readFileSync(path.resolve(__dirname, "../server/db.ts"), "utf8");
    expect(dbSource).toContain("const todayDetailPoints = detailRows");
    expect(dbSource).toContain("const todayRowTotalPoints = Number(rowsByDate.get(range.todayKey)?.totalPoints ?? 0);");
    expect(dbSource).toContain("Math.max(0, todayRowTotalPoints - todaySupport.supportPoints)");
    expect(dbSource).toContain("const supportPointsForDate = supportByUserDate.get(`${user.id}-${dateKey}`)?.supportPoints ?? 0;");
    expect(dbSource).toContain("const finalKpiScore = rawAchievementRate;");
  });
});
