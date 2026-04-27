import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ensureMvpSeedData guard", () => {
  it("skips auto seeding outside test runs", () => {
    const source = readFileSync(new URL("./db.ts", import.meta.url), "utf8");

    expect(source).toContain('if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {');
    expect(source).toContain("return;");
  });
});
