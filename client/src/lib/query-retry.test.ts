import { describe, expect, it } from "vitest";
import { shouldRetryTransientQuery } from "./query-retry";

describe("shouldRetryTransientQuery", () => {
  it("retries transient HTML-instead-of-JSON parser errors once", () => {
    expect(shouldRetryTransientQuery(0, { message: 'Unexpected token \'<\', "<!doctype " is not valid JSON' })).toBe(true);
    expect(shouldRetryTransientQuery(1, { message: 'Unexpected token \'<\', "<!doctype " is not valid JSON' })).toBe(true);
    expect(shouldRetryTransientQuery(2, { message: 'Unexpected token \'<\', "<!doctype " is not valid JSON' })).toBe(false);
  });

  it("retries server-side 5xx errors", () => {
    expect(shouldRetryTransientQuery(0, { data: { httpStatus: 502 }, message: "Bad Gateway" })).toBe(true);
  });

  it("does not retry validation-style client errors", () => {
    expect(shouldRetryTransientQuery(0, { data: { httpStatus: 400 }, message: "Bad Request" })).toBe(false);
  });
});
