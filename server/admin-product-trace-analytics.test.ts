import { describe, expect, it } from "vitest";
import { analyzeProductTraceResults, formatDuration, toTimestamp, type ProductTraceRecord } from "../client/src/lib/adminProductTrace";

describe("admin product trace analytics", () => {
  it("formats timestamps and durations consistently", () => {
    expect(toTimestamp("2026-04-27T08:00:00.000Z")).toBe(new Date("2026-04-27T08:00:00.000Z").getTime());
    expect(toTimestamp(null)).toBeNull();
    expect(formatDuration(null)).toBe("-");
    expect(formatDuration(45 * 60_000)).toBe("45 分");
    expect(formatDuration(2 * 60 * 60_000 + 15 * 60_000)).toBe("2 小時 15 分");
    expect(formatDuration(27 * 60 * 60_000)).toBe("1 天 3 小時");
  });

  it("marks overdue and long-running stations as anomalies and summarizes station durations", () => {
    const baseNow = new Date("2026-04-27T12:00:00.000Z").getTime();
    const fixtures: ProductTraceRecord[] = [
      {
        id: 1,
        productName: "Trace Device",
        batchNo: "TRACE-BATCH-01",
        serialNumber: "TRACE-SN-01",
        poNumber: "PO-TRACE-01",
        currentStatus: "processing_c",
        currentStationCode: "C",
        timeline: [
          {
            id: 101,
            stationCode: "A1",
            taskStatus: "completed",
            createdAt: "2026-04-27T08:00:00.000Z",
            startedAt: "2026-04-27T08:00:00.000Z",
            completedAt: "2026-04-27T08:40:00.000Z",
            resultSummary: "到貨完成",
          },
          {
            id: 102,
            stationCode: "B",
            taskStatus: "completed",
            createdAt: "2026-04-25T00:00:00.000Z",
            startedAt: "2026-04-25T00:00:00.000Z",
            completedAt: "2026-04-26T08:30:00.000Z",
            resultSummary: "長工時完成",
          },
          {
            id: 103,
            stationCode: "C",
            taskStatus: "in_progress",
            createdAt: "2026-04-27T01:00:00.000Z",
            startedAt: "2026-04-27T01:30:00.000Z",
            dueDate: "2026-04-27T10:00:00.000Z",
            resultSummary: "待檢測",
          },
        ],
        events: [
          {
            id: 201,
            stationCode: "A1",
            eventType: "completed",
            createdAt: "2026-04-27T08:40:00.000Z",
            operatorName: "Tester",
            summary: "完成",
          },
        ],
      },
    ];

    const [result] = analyzeProductTraceResults(fixtures, baseNow);

    expect(result.stats.totalStations).toBe(3);
    expect(result.stats.completedStations).toBe(2);
    expect(result.stats.averageDurationLabel).toBe("14 小時 33 分");
    expect(result.stats.longestDurationLabel).toBe("1 天 8 小時");
    expect(result.stats.anomalyCount).toBe(2);
    expect(result.stats.overdueCount).toBe(1);
    expect(result.stats.anomalyStations).toEqual(["B", "C"]);

    expect(result.analyzedTimeline[0]?.durationLabel).toBe("40 分");
    expect(result.analyzedTimeline[0]?.isAnomaly).toBe(false);
    expect(result.analyzedTimeline[1]?.durationLabel).toBe("1 天 8 小時");
    expect(result.analyzedTimeline[1]?.isLongRunning).toBe(true);
    expect(result.analyzedTimeline[2]?.durationLabel).toBe("10 小時 30 分");
    expect(result.analyzedTimeline[2]?.isOverdue).toBe(true);
    expect(result.analyzedTimeline[2]?.isAnomaly).toBe(true);
  });

  it("returns stable empty or incomplete values without false anomalies", () => {
    const [result] = analyzeProductTraceResults([
      {
        id: 2,
        currentStatus: "pending_a1",
        currentStationCode: "A1",
        timeline: [
          {
            id: 301,
            stationCode: "A1",
            taskStatus: "pending",
            createdAt: null,
            startedAt: null,
            completedAt: null,
            dueDate: null,
            resultSummary: null,
          },
        ],
        events: [],
      },
    ], new Date("2026-04-27T09:00:00.000Z").getTime());

    expect(result.stats.averageDurationLabel).toBe("-");
    expect(result.stats.longestDurationLabel).toBe("-");
    expect(result.stats.anomalyCount).toBe(0);
    expect(result.analyzedTimeline[0]?.durationLabel).toBe("-");
    expect(result.analyzedTimeline[0]?.isAnomaly).toBe(false);
  });
});
