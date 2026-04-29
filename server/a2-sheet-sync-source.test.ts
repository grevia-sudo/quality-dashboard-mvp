import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("A2 completion and purchase sheet sync source coverage", () => {
  const dbSource = readFileSync(resolve(process.cwd(), "server/db.ts"), "utf8");
  const syncScriptSource = readFileSync(resolve(process.cwd(), "scripts/sync-purchase-sheet.mjs"), "utf8");
  const syncHelperSource = readFileSync(resolve(process.cwd(), "scripts/purchase-sheet-sync-helpers.mjs"), "utf8");

  it("queues purchase sheet sync when A2 completes", () => {
    expect(dbSource).toContain('if (input.stationCode === "A2" || input.stationCode === "B" || input.stationCode === "C" || input.stationCode === "E") {');
    expect(dbSource).toContain('jobType: "purchase_sheet_sync"');
    expect(dbSource).toContain('targetSheetName: "採購單"');
    expect(dbSource).toContain('currentStationCode: nextStation');
    expect(dbSource).toContain('currentStatus: statusForStation(nextStation)');
  });

  it("includes A2/B/C sheet columns in row generation and stage-aware merge rules", () => {
    expect(syncHelperSource).toContain('"安裝軟體時間"');
    expect(syncHelperSource).toContain('formatSheetDateTime(product.a2CompletedAt)');
    expect(syncHelperSource).toContain('"軟體測試時間"');
    expect(syncHelperSource).toContain('"電池檢測"');
    expect(syncHelperSource).toContain('"B站故障狀態"');
    expect(syncHelperSource).toContain('"B站執行人"');
    expect(syncHelperSource).toContain('"測試時間"');
    expect(syncHelperSource).toContain('"是否修改B站的狀態回覆"');
    expect(syncHelperSource).toContain('"螢幕狀態"');
    expect(syncHelperSource).toContain('"機身狀態"');
    expect(syncHelperSource).toContain('"鏡頭狀態"');
    expect(syncHelperSource).toContain('export function getSheetRefreshIndexes(product)');
    expect(syncHelperSource).toContain('if (stageUpdated.a1) {');
    expect(syncHelperSource).toContain('if (stageUpdated.c) {');
    expect(syncScriptSource).toContain('mergeMissingCells(existingRow, generatedRow, product)');
  });

  it("tracks A2 and C completedAt as triggers for purchase sheet updates", () => {
    expect(syncScriptSource).toContain('a2.completedAt AS a2CompletedAt');
    expect(syncScriptSource).toContain('cTask.completedAt AS cCompletedAt');
    expect(syncScriptSource).toContain('cMeta.cCameraSummary');
    expect(syncScriptSource).toContain(") a2 ON a2.productId = p.id");
    expect(syncScriptSource).toContain(") cTask ON cTask.productId = p.id");
    expect(syncScriptSource).toContain('OR (a2.completedAt IS NOT NULL AND (p.lastSheetSyncedAt IS NULL OR a2.completedAt > p.lastSheetSyncedAt))');
    expect(syncScriptSource).toContain('OR (cTask.completedAt IS NOT NULL AND (p.lastSheetSyncedAt IS NULL OR cTask.completedAt > p.lastSheetSyncedAt))');
  });

  it("keeps an in-process purchase sheet sync path for deployed runtime", () => {
    expect(dbSource).toContain('async function runPurchaseSheetSyncInProcess()');
    expect(dbSource).toContain('await import("../scripts/sync-purchase-sheet.mjs")');
    expect(syncScriptSource).toContain('export async function runPurchaseSheetSync()');
  });

  it("retries queued job count queries when the database connection is reset", () => {
    expect(dbSource).toContain('const PURCHASE_SHEET_SYNC_DB_RETRYABLE_PATTERN = /ECONNRESET|PROTOCOL_CONNECTION_LOST|ETIMEDOUT|Connection lost|The server closed the connection/i;');
    expect(dbSource).toContain('async function countQueuedSheetSyncJobs(filters?: { jobType?: string; targetSheetName?: string }) {');
    expect(dbSource).toContain('console.warn(`[purchase-sheet-sync] queued job count query failed (attempt ${attempt}/3), retrying`, error);');
    expect(dbSource).toContain('return countQueuedSheetSyncJobs({\n    jobType: "purchase_sheet_sync",\n    targetSheetName: "採購單",\n  });');
  });

  it("paces write requests and uses longer backoff for Sheets 429 limits", () => {
    expect(syncScriptSource).toContain('const SHEETS_WRITE_THROTTLE_MS = 1_100;');
    expect(syncScriptSource).toContain('await throttleSheetsWrite(method);');
    expect(syncScriptSource).toContain('const retryDelayMs = response.status === 429 ? 10_000 * (attempt + 1) : 1_500 * (attempt + 1);');
  });

  it("triggers purchase sheet sync immediately after import queues the job", () => {
    expect(dbSource).toContain('await db.insert(sheetSyncJobs).values({\n    jobType: "purchase_sheet_sync",\n    targetSheetName: "採購單",\n    status: "queued",\n  });\n  triggerPurchaseSheetSyncInBackground();');
  });

  it("requeues purchase sheet sync when pending stock is auto-removed by external sheet matching", () => {
    expect(dbSource).toContain('summary: "外部進貨明細批號比對成功，自動移除待入庫"');
    expect(dbSource).toContain('matchedColumn: "F"');
    expect(dbSource).toContain('await db.insert(sheetSyncJobs).values({\n        jobType: "purchase_sheet_sync",\n        targetSheetName: "採購單",\n        status: "queued",\n      });\n\n      triggerPurchaseSheetSyncInBackground();');
  });
});

