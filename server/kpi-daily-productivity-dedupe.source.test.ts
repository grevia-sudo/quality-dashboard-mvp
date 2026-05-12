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
});
