import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");

describe("App routing order", () => {
  it("registers /admin before the root route to prevent Home from matching first", () => {
    const adminIndex = appSource.indexOf('<Route path="/admin" component={AdminPage} />');
    const rootIndex = appSource.indexOf('<Route path="/" component={Home} />');

    expect(adminIndex).toBeGreaterThan(-1);
    expect(rootIndex).toBeGreaterThan(-1);
    expect(adminIndex).toBeLessThan(rootIndex);
  });
});
