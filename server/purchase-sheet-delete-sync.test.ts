import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:crypto", () => ({
  createSign: () => ({
    update: vi.fn(),
    end: vi.fn(),
    sign: vi.fn(() => "signed-test-token=="),
  }),
}));

import {
  buildStrikethroughRequests,
  markPurchaseOrderRowsDeletedInGoogleSheet,
  matchesDeletedProductRow,
  resolveDeletedPurchaseSheetRowNumbers,
} from "./purchase-sheet-delete-sync";

const originalGoogleCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const originalNodeEnv = process.env.NODE_ENV;
const originalVitestEnv = process.env.VITEST;

function createJsonResponse(payload: unknown, ok = true) {
  return {
    ok,
    json: async () => payload,
  } as Response;
}

describe("purchase sheet delete sync helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: "sheet-sync-test@example.com",
      private_key: "-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----\n",
      token_uri: "https://oauth2.googleapis.com/token",
    });
    process.env.NODE_ENV = "production";
    delete process.env.VITEST;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalGoogleCredentials === undefined) {
      delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    } else {
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON = originalGoogleCredentials;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalVitestEnv === undefined) {
      delete process.env.VITEST;
    } else {
      process.env.VITEST = originalVitestEnv;
    }
  });

  it("matches rows by po number and identity fields", () => {
    expect(matchesDeletedProductRow(["PO-1", "Vendor", "手機", "BATCH-1", "", ""], {
      poNumber: "PO-1",
      batchNo: "BATCH-1",
    })).toBe(true);

    expect(matchesDeletedProductRow(["PO-1", "Vendor", "手機", "", "SER-1", ""], {
      poNumber: "PO-1",
      serialNumber: "SER-1",
    })).toBe(true);

    expect(matchesDeletedProductRow(["PO-2", "Vendor", "手機", "BATCH-1", "", ""], {
      poNumber: "PO-1",
      batchNo: "BATCH-1",
    })).toBe(false);
  });

  it("resolves row numbers from stored row numbers, fallback identity matching, and the full po range", () => {
    const values = [
      ["採購單號", "廠商", "商品分類", "商品批號", "商品序號", "IMEI"],
      ["PO-1", "Vendor", "手機", "BATCH-1", "", ""],
      ["PO-1", "Vendor", "手機", "", "SER-2", ""],
      ["PO-1", "Vendor", "手機", "", "", "IMEI-3"],
      ["PO-1", "Vendor", "手機", "BATCH-4", "", ""],
      ["PO-2", "Vendor", "手機", "BATCH-X", "", ""],
    ];

    const rowNumbers = resolveDeletedPurchaseSheetRowNumbers(
      values,
      [
        { poNumber: "PO-1", sheetRowNumber: 2, batchNo: "BATCH-1" },
        { poNumber: "PO-1", serialNumber: "SER-2" },
        { poNumber: "PO-1", imei: "IMEI-3" },
        { poNumber: "PO-1", serialNumber: "SER-2" },
      ],
      "PO-1",
    );

    expect(rowNumbers).toEqual([2, 3, 4, 5]);
  });

  it("builds repeatCell requests that strike through the full purchase row", () => {
    expect(buildStrikethroughRequests([8, 11], 99)).toEqual([
      {
        repeatCell: {
          range: {
            sheetId: 99,
            startRowIndex: 7,
            endRowIndex: 8,
            startColumnIndex: 0,
            endColumnIndex: 30,
          },
          cell: {
            userEnteredFormat: {
              textFormat: {
                strikethrough: true,
              },
            },
          },
          fields: "userEnteredFormat.textFormat.strikethrough",
        },
      },
      {
        repeatCell: {
          range: {
            sheetId: 99,
            startRowIndex: 10,
            endRowIndex: 11,
            startColumnIndex: 0,
            endColumnIndex: 30,
          },
          cell: {
            userEnteredFormat: {
              textFormat: {
                strikethrough: true,
              },
            },
          },
          fields: "userEnteredFormat.textFormat.strikethrough",
        },
      },
    ]);
  });

  it("marks all rows of the purchase order with strikethrough when rows can be resolved", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(createJsonResponse({ access_token: "token-123" }));
    fetchMock.mockResolvedValueOnce(createJsonResponse({
      values: [
        ["採購單號", "廠商", "商品分類", "商品批號", "商品序號", "IMEI"],
        ["PO-1", "Vendor", "手機", "BATCH-1", "", ""],
        ["PO-1", "Vendor", "手機", "", "SER-2", ""],
        ["PO-1", "Vendor", "手機", "BATCH-OLD", "", ""],
      ],
    }));
    fetchMock.mockResolvedValueOnce(createJsonResponse({
      sheets: [{ properties: { title: "採購單", sheetId: 321 } }],
    }));
    fetchMock.mockResolvedValueOnce(createJsonResponse({ replies: [] }));

    const result = await markPurchaseOrderRowsDeletedInGoogleSheet({
      poNumber: "PO-1",
      products: [
        { poNumber: "PO-1", batchNo: "BATCH-1" },
        { poNumber: "PO-1", serialNumber: "SER-2" },
      ],
    });

    expect(result).toMatchObject({
      success: true,
      skipped: false,
      updatedRowNumbers: [2, 3, 4],
      reason: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain(":batchUpdate");
  });

  it("returns rows_not_found when the purchase order does not exist in Google Sheet", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(createJsonResponse({ access_token: "token-123" }));
    fetchMock.mockResolvedValueOnce(createJsonResponse({
      values: [
        ["採購單號", "廠商", "商品分類", "商品批號", "商品序號", "IMEI"],
        ["PO-2", "Vendor", "手機", "BATCH-9", "", ""],
      ],
    }));
    fetchMock.mockResolvedValueOnce(createJsonResponse({
      sheets: [{ properties: { title: "採購單", sheetId: 321 } }],
    }));

    const result = await markPurchaseOrderRowsDeletedInGoogleSheet({
      poNumber: "PO-1",
      products: [{ poNumber: "PO-1", serialNumber: "SER-NOT-FOUND" }],
    });

    expect(result).toMatchObject({
      success: true,
      skipped: true,
      updatedRowNumbers: [],
      reason: "rows_not_found",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws when Google batchUpdate fails", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(createJsonResponse({ access_token: "token-123" }));
    fetchMock.mockResolvedValueOnce(createJsonResponse({
      values: [
        ["採購單號", "廠商", "商品分類", "商品批號", "商品序號", "IMEI"],
        ["PO-1", "Vendor", "手機", "", "SER-2", ""],
      ],
    }));
    fetchMock.mockResolvedValueOnce(createJsonResponse({
      sheets: [{ properties: { title: "採購單", sheetId: 321 } }],
    }));
    fetchMock.mockResolvedValueOnce(createJsonResponse({ error: { message: "boom" } }, false));

    await expect(markPurchaseOrderRowsDeletedInGoogleSheet({
      poNumber: "PO-1",
      products: [{ poNumber: "PO-1", serialNumber: "SER-2" }],
    })).rejects.toThrow("Google Sheets API 失敗");
  });
});
