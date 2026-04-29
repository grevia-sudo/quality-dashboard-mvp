import { afterEach, describe, expect, it, vi } from "vitest";
import { callSheetsApi } from "../scripts/sync-purchase-sheet.mjs";

describe("purchase sheet sync retry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retries on 429 and eventually succeeds", async () => {
    const responses = [
      {
        ok: false,
        status: 429,
        json: async () => ({ error: { code: 429, message: "rate limited" } }),
      },
      {
        ok: true,
        status: 200,
        json: async () => ({ updatedRange: "採購單!A2:AA2" }),
      },
    ];

    const fetchMock = vi.spyOn(globalThis, "fetch" as never).mockImplementation(async () => responses.shift() as Response);
    const setTimeoutMock = vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: (...args: unknown[]) => void) => {
      callback();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);

    const result = await callSheetsApi("token", "spreadsheets/example/values/A1", {
      method: "PUT",
      body: { values: [["test"]] },
    });

    expect(result).toEqual({ updatedRange: "採購單!A2:AA2" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(setTimeoutMock).toHaveBeenCalledTimes(1);
  });
});
