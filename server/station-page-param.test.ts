import { describe, expect, it } from "vitest";
import { normalizeStationCodeParam } from "../client/src/pages/StationPage";

describe("normalizeStationCodeParam", () => {
  it("accepts valid station codes", () => {
    expect(normalizeStationCodeParam("A1")).toBe("A1");
    expect(normalizeStationCodeParam("stock")).toBe("STOCK");
  });

  it("normalizes malformed values and rejects unknown ones", () => {
    expect(normalizeStationCodeParam(":stationCode")).toBeNull();
    expect(normalizeStationCodeParam(":a2")).toBe("A2");
    expect(normalizeStationCodeParam("unknown")).toBeNull();
    expect(normalizeStationCodeParam(undefined)).toBeNull();
  });
});
