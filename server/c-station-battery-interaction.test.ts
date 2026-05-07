import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("C 站承接 B 站電池文案", () => {
  it("StationPage 會使用新的蓄電異常選項文案", () => {
    const stationPageSource = readFileSync(new URL("../client/src/pages/StationPage.tsx", import.meta.url), "utf8");

    expect(stationPageSource).toContain("const B_BATTERY_ISSUE_OPTIONS = [\"電池膨脹\", \"副廠電池\", \"蓄電異常\"] as const;");
    expect(stationPageSource).toContain("修改電池檢測");
  });
});
