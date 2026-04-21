import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");

describe("App routing order", () => {
  it("registers concrete dashboard routes before the root route", () => {
    const operationsIndex = appSource.indexOf('<Route path="/operations" component={OperationsPage} />');
    const importIndex = appSource.indexOf('<Route path="/import" component={ImportPage} />');
    const adminIndex = appSource.indexOf('<Route path="/admin" component={AdminPage} />');
    const rootIndex = appSource.indexOf('<Route path="/" component={Home} />');

    expect(operationsIndex).toBeGreaterThan(-1);
    expect(importIndex).toBeGreaterThan(-1);
    expect(adminIndex).toBeGreaterThan(-1);
    expect(rootIndex).toBeGreaterThan(-1);
    expect(operationsIndex).toBeLessThan(rootIndex);
    expect(importIndex).toBeLessThan(rootIndex);
    expect(adminIndex).toBeLessThan(rootIndex);
  });
});
