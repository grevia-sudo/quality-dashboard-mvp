import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dbSource = fs.readFileSync(
  path.resolve(__dirname, "./db.ts"),
  "utf8",
);

describe("C 站承接 B 站故障點 fallback 邏輯", () => {
  it("在 C 站 task metadata 的 bFault 陣列為空且尚未套用修改時，會回退沿用 B 站已完成故障點", () => {
    expect(dbSource).toContain("const taskBFaultOptionIds = normalizeNumberArray(taskMetadata.bFaultOptionIds);");
    expect(dbSource).toContain("const taskBFaultLabels = normalizeTextArray(taskMetadata.bFaultLabels);");
    expect(dbSource).toContain("const shouldFallbackToLatestBFaults = taskMetadata.applyBChanges !== true");
    expect(dbSource).toContain("? normalizeNumberArray(latestBMetadata.faultOptionIds)");
    expect(dbSource).toContain("? normalizeTextArray(latestBMetadata.faultLabels)");
  });
});
