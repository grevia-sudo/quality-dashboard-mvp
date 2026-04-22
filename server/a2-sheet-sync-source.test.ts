import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("A2 completion and purchase sheet sync source coverage", () => {
  const dbSource = readFileSync(resolve(process.cwd(), "server/db.ts"), "utf8");
  const syncScriptSource = readFileSync(resolve(process.cwd(), "scripts/sync-purchase-sheet.mjs"), "utf8");
  const syncHelperSource = readFileSync(resolve(process.cwd(), "scripts/purchase-sheet-sync-helpers.mjs"), "utf8");

  it("queues purchase sheet sync when A2 completes", () => {
    expect(dbSource).toContain('if (input.stationCode === "A2") {');
    expect(dbSource).toContain('jobType: "purchase_sheet_sync"');
    expect(dbSource).toContain('targetSheetName: "採購單"');
    expect(dbSource).toContain('currentStationCode: nextStation');
    expect(dbSource).toContain('currentStatus: statusForStation(nextStation)');
  });

  it("includes A2 completed time in purchase sheet row generation and merge rules", () => {
    expect(syncHelperSource).toContain('"安裝完成時間"');
    expect(syncHelperSource).toContain('formatSheetDateTime(product.a2CompletedAt)');
    expect(syncHelperSource).toContain('if (index === 7 || index === 8) {');
  });

  it("tracks A2 completedAt as a trigger for purchase sheet updates", () => {
    expect(syncScriptSource).toContain('a2.completedAt AS a2CompletedAt');
    expect(syncScriptSource).toContain("WHERE \\`stationCode\\` = 'A2' AND \\`stationTaskStatus\\` = 'completed'");
    expect(syncScriptSource).toContain('OR (a2.completedAt IS NOT NULL AND (p.lastSheetSyncedAt IS NULL OR a2.completedAt > p.lastSheetSyncedAt))');
  });
});
