import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("engineer daily productivity dedupe source", () => {
  it("keeps engineer_daily_productivity unique by user and business date in schema", () => {
    const schemaSource = readFileSync(path.resolve(__dirname, "../drizzle/schema.ts"), "utf8");
    expect(schemaSource).toContain('uniqueIndex("engineer_daily_productivity_user_date_unique_idx").on(table.userId, table.businessDate)');
  });

  it("cleans duplicate or stale daily productivity rows during sync and PO deletion", () => {
    const dbSource = readFileSync(path.resolve(__dirname, "../server/db.ts"), "utf8");
    expect(dbSource).toContain("const hasAnyRelevantActivity = dailyDetails.length > 0");
    expect(dbSource).toContain("await db.delete(engineerDailyProductivity).where(inArray(engineerDailyProductivity.id, existingRows.map((row) => row.id)));");
    expect(dbSource).toContain("if (existingRows.length > 1)");
    expect(dbSource).toContain("await syncEngineerDailyProductivityRecords(db, Array.from(affectedProductivityItems.values()));");
  });

  it("disables KPI counting when Google purchase sheet does not contain the normalized batch key", () => {
    const dbSource = readFileSync(path.resolve(__dirname, "../server/db.ts"), "utf8");
    expect(dbSource).toContain("const googleBatchKeys = await readPurchaseSheetBatchKeySet();");
    expect(dbSource).toContain("if (!normalizedBatchKey || !googleBatchKeys.has(normalizedBatchKey)) {");
    expect(dbSource).toContain("countForProductivity: false,");
    expect(dbSource).toContain("const hasGoogleBaseline = Boolean(normalizedBatchKey && googleBatchKeys.has(normalizedBatchKey));");
  });

  it("builds today points from detail rows and picks the latest effective daily score", () => {
    const dbSource = readFileSync(path.resolve(__dirname, "../server/db.ts"), "utf8");
    expect(dbSource).toContain("const todayDetailPoints = detailRows");
    expect(dbSource).toContain("const latestEffectiveDailyRow = [...rows]");
    expect(dbSource).toContain(".find((row) => Boolean(row.attendanceFlag) || Number(row.totalPoints ?? 0) > 0 || Number(row.finalKpiScore ?? 0) > 0)");
  });
});
