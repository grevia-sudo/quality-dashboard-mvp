import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("demo seed guards", () => {
  it("skips auto seeding outside test runs", () => {
    const source = readFileSync(new URL("./db.ts", import.meta.url), "utf8");

    expect(source).toContain('export async function ensureMvpSeedData() {');
    expect(source).toContain('export async function seedKpiForDemo(userId: number) {');
    const guard = 'if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {';
    expect(source.match(new RegExp(guard.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
