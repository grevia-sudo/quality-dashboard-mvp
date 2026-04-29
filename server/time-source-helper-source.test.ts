import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const dbSource = fs.readFileSync(path.resolve(__dirname, "db.ts"), "utf8");

describe("shared operation time source coverage", () => {
  it("defines a shared helper for businessDate and completedAt generation", () => {
    expect(dbSource).toContain("function getOperationTimeContext(now = new Date()) {");
    expect(dbSource).toContain("businessDateValue: new Date(`${businessDate}T00:00:00`)");
    expect(dbSource).toContain("function todayDateString() {");
    expect(dbSource).toContain("return getOperationTimeContext().businessDate;");
  });

  it("uses the shared helper in A1 receive, station completion, and D sampling flows", () => {
    expect(dbSource).toContain("const { businessDateValue, now: completedAt } = getOperationTimeContext();");
    expect(dbSource).toContain("const pendingTaskId = matchedProduct.pendingTaskId ?? (await ensurePendingA1Task(");
    expect(dbSource).toContain("const { businessDateValue, now: completedAt } = getOperationTimeContext();\n  const currentStationOptionIds = Array.from(new Set([");
    expect(dbSource).toContain("const { businessDateValue, now: completedAt } = getOperationTimeContext();\n  const normalizedBatterySummary = normalizeOptionalText(input.batterySummary) ?? \"正常\"");
  });

  it("uses the shared helper in import and KPI aggregation paths that still need businessDateValue", () => {
    expect(dbSource).toContain("const { businessDate, businessDateValue } = getOperationTimeContext();\n  const importSeed = Date.now();");
    expect(dbSource).toContain("const { businessDate, businessDateValue } = getOperationTimeContext();\n  const monthPrefix = businessDate.slice(0, 7);");
  });
});
