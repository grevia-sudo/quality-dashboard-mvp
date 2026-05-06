import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dbSource = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const samplingPageSource = readFileSync(new URL("../client/src/pages/SamplingPage.tsx", import.meta.url), "utf8");

describe("D station sampling source coverage", () => {
  it("loads B and C option lists for the D station review page", () => {
    expect(dbSource).toContain('stationCode === "C" || stationCode === "D" ? getDefectOptions("C", "appearance") : Promise.resolve([])');
    expect(dbSource).toContain('stationCode === "C" || stationCode === "D" ? getDefectOptions("C", "camera") : Promise.resolve([])');
    expect(dbSource).toContain('stationCode === "C" || stationCode === "D" ? getDefectOptions("B", "fault") : Promise.resolve([])');
  });

  it("prefers carried B summaries from the current D task metadata before falling back to historical B tasks", () => {
    expect(dbSource).toContain('const inheritedBatterySummary = typeof (taskMetadata.batterySummary ?? latestBMetadata.batterySummary) === "string"');
    expect(dbSource).toContain('const inheritedBFaultSummary = typeof (taskMetadata.faultSummary ?? latestBMetadata.faultSummary) === "string"');
    expect(dbSource).toContain('normalizeTextArray(taskMetadata.faultLabels ?? latestBMetadata.faultLabels)');
  });

  it("uses D-station checkbox editing for carried B and C results", () => {
    expect(samplingPageSource).toContain('const detailQuery = trpc.station.detail.useQuery({ stationCode: "D" }, {');
    expect(samplingPageSource).toContain('B_BATTERY_ISSUE_OPTIONS.map((optionLabel) => (');
    expect(samplingPageSource).toContain('bFaultOptions.map((option) => (');
    expect(samplingPageSource).toContain('appearanceOptions.map((option) => (');
    expect(samplingPageSource).toContain('cameraOptions.map((option) => (');
    expect(samplingPageSource).toContain('toggleBatteryIssueLabel(task, optionLabel, Boolean(checked))');
  });
});
