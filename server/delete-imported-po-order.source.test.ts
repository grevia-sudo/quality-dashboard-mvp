import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("deleteImportedPurchaseOrder source", () => {
  it("deletes dependent records before station tasks", () => {
    const source = readFileSync(path.resolve(__dirname, "../server/db.ts"), "utf8");
    const start = source.indexOf("export async function deleteImportedPurchaseOrder");
    const end = source.indexOf("export async function getPurchaseOrderTrace", start);
    const snippet = source.slice(start, end > start ? end : undefined);

    expect(snippet).toContain("db.delete(productivityScoreDetails)");
    expect(snippet).toContain("db.delete(samplingResults)");
    expect(snippet).toContain("db.delete(stationEvents)");
    expect(snippet).toContain("db.delete(stationTasks)");

    const productivityIndex = snippet.indexOf("db.delete(productivityScoreDetails)");
    const samplingIndex = snippet.indexOf("db.delete(samplingResults)");
    const eventIndex = snippet.indexOf("db.delete(stationEvents)");
    const taskIndex = snippet.indexOf("db.delete(stationTasks)");

    expect(productivityIndex).toBeGreaterThan(-1);
    expect(samplingIndex).toBeGreaterThan(productivityIndex);
    expect(eventIndex).toBeGreaterThan(samplingIndex);
    expect(taskIndex).toBeGreaterThan(eventIndex);
  });
});
