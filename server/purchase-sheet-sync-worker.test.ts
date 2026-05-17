import { describe, expect, it } from "vitest";
import { assertCStageWritten, isBlankCell } from "../scripts/sync-purchase-sheet.mjs";
import { SHEET_INDEXES } from "../scripts/purchase-sheet-sync-helpers.mjs";

describe("purchase sheet sync worker guards", () => {
  it("treats null, undefined and blank strings as blank cells", () => {
    expect(isBlankCell(null)).toBe(true);
    expect(isBlankCell(undefined)).toBe(true);
    expect(isBlankCell("")).toBe(true);
    expect(isBlankCell("   ")).toBe(true);
    expect(isBlankCell("2026/05/15 10:30")).toBe(false);
  });

  it("throws when C is completed locally but the written row still has blank C completion", () => {
    const writtenRow = new Array(30).fill("");

    expect(() =>
      assertCStageWritten(
        {
          id: 101,
          batchNo: "00500025301",
          cCompletedAt: "2026-05-15T01:30:00.000Z",
        },
        writtenRow,
      ),
    ).toThrow(/Google 採購單 C 欄位未寫入/);
  });

  it("does not throw when the final written row contains C completion", () => {
    const writtenRow = new Array(30).fill("");
    writtenRow[SHEET_INDEXES.cCompletedAt] = "2026/05/15 09:30";

    expect(() =>
      assertCStageWritten(
        {
          id: 102,
          batchNo: "00500025299",
          cCompletedAt: "2026-05-15T01:30:00.000Z",
        },
        writtenRow,
      ),
    ).not.toThrow();
  });
});
