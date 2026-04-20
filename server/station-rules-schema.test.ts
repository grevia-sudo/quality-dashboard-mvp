import { describe, expect, it } from "vitest";
import { stationRules } from "../drizzle/schema";

describe("station_rules schema", () => {
  it("uses distinct column names for station routing fields", () => {
    expect(stationRules.stationCode.name).toBe("stationCode");
    expect(stationRules.nextStationCode.name).toBe("nextStationCode");
    expect(stationRules.allowReworkToCode.name).toBe("allowReworkToCode");
  });
});
