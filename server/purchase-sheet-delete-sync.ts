import { createSign } from "node:crypto";

const PURCHASE_SHEET_SPREADSHEET_ID = "1lMd28O9G-14VQQd7-RRIF8Tr5RaOVa7fhI1fkLXAB0o";
const PURCHASE_SHEET_NAME = "採購單";
const PURCHASE_SHEET_COLUMN_COUNT = 27;

type DeletedPurchaseSheetProduct = {
  poNumber?: string | null;
  sheetRowNumber?: number | null;
  batchNo?: string | null;
  serialNumber?: string | null;
  imei?: string | null;
};

type SheetValuesResponse = {
  values?: string[][];
};

type GoogleSheetDescriptor = {
  properties?: {
    sheetId?: number;
    title?: string;
  };
};

type BatchUpdateRequest = {
  repeatCell: {
    range: {
      sheetId: number;
      startRowIndex: number;
      endRowIndex: number;
      startColumnIndex: number;
      endColumnIndex: number;
    };
    cell: {
      userEnteredFormat: {
        textFormat: {
          strikethrough: boolean;
        };
      };
    };
    fields: string;
  };
};

function normalizeSheetCell(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function base64UrlEncode(value: string) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function parseServiceAccountCredentials() {
  const rawCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!rawCredentials) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON 不存在，無法回寫採購單刪除狀態到 Google Sheet");
  }

  const credentials = JSON.parse(rawCredentials) as { client_email?: string; private_key?: string; token_uri?: string };
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON 缺少 client_email 或 private_key");
  }

  return credentials;
}

function createSignedJwt(credentials: { client_email: string; private_key: string; token_uri?: string }) {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT",
  };
  const payload = {
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: credentials.token_uri ?? "https://oauth2.googleapis.com/token",
    exp: nowInSeconds + 3600,
    iat: nowInSeconds,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  const signer = createSign("RSA-SHA256");
  signer.update(unsignedToken);
  signer.end();

  const signature = signer
    .sign(credentials.private_key, "base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${unsignedToken}.${signature}`;
}

async function getGoogleAccessToken() {
  const credentials = parseServiceAccountCredentials();
  const assertion = createSignedJwt({
    client_email: credentials.client_email!,
    private_key: credentials.private_key!,
    token_uri: credentials.token_uri,
  });

  const response = await fetch(credentials.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const result = await response.json() as { access_token?: string };
  if (!response.ok || !result.access_token) {
    throw new Error(`Google access token 取得失敗：${JSON.stringify(result)}`);
  }

  return result.access_token;
}

async function callSheetsApi<TResponse>(
  accessToken: string,
  path: string,
  { method = "GET", query = {}, body }: { method?: string; query?: Record<string, string | number | boolean | null | undefined>; body?: unknown } = {},
) {
  const url = new URL(`https://sheets.googleapis.com/v4/${path}`);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const result = await response.json() as TResponse & { error?: unknown };
  if (!response.ok) {
    throw new Error(`Google Sheets API 失敗：${JSON.stringify(result)}`);
  }

  return result;
}

async function getPurchaseSheetId(accessToken: string) {
  const response = await callSheetsApi<{ sheets?: GoogleSheetDescriptor[] }>(
    accessToken,
    `spreadsheets/${PURCHASE_SHEET_SPREADSHEET_ID}`,
    {
      query: {
        fields: "sheets.properties(sheetId,title)",
      },
    },
  );

  const matchedSheet = response.sheets?.find((sheet) => sheet.properties?.title === PURCHASE_SHEET_NAME);
  const sheetId = matchedSheet?.properties?.sheetId;
  if (typeof sheetId !== "number") {
    throw new Error(`找不到 Google Sheet 分頁：${PURCHASE_SHEET_NAME}`);
  }

  return sheetId;
}

async function getPurchaseSheetValues(accessToken: string) {
  const encodedRange = encodeURIComponent(`${PURCHASE_SHEET_NAME}!A:AA`);
  return callSheetsApi<SheetValuesResponse>(
    accessToken,
    `spreadsheets/${PURCHASE_SHEET_SPREADSHEET_ID}/values/${encodedRange}`,
  );
}

export function matchesDeletedProductRow(row: string[] | undefined, product: DeletedPurchaseSheetProduct) {
  const rowPoNumber = normalizeSheetCell(row?.[0]);
  const rowBatchNo = normalizeSheetCell(row?.[3]);
  const rowSerialNumber = normalizeSheetCell(row?.[4]);
  const rowImei = normalizeSheetCell(row?.[5]);
  const poNumber = normalizeSheetCell(product.poNumber);
  const batchNo = normalizeSheetCell(product.batchNo);
  const serialNumber = normalizeSheetCell(product.serialNumber);
  const imei = normalizeSheetCell(product.imei);

  if (poNumber && rowPoNumber && rowPoNumber !== poNumber) {
    return false;
  }
  if (imei && rowImei && rowImei === imei) {
    return true;
  }
  if (serialNumber && rowSerialNumber && rowSerialNumber === serialNumber) {
    return true;
  }
  if (batchNo && rowBatchNo && rowBatchNo === batchNo) {
    return true;
  }

  return false;
}

export function resolveDeletedPurchaseSheetRowNumbers(values: string[][], products: DeletedPurchaseSheetProduct[]) {
  const resolved = new Set<number>();

  products.forEach((product) => {
    if (product.sheetRowNumber && product.sheetRowNumber > 1) {
      resolved.add(product.sheetRowNumber);
      return;
    }

    for (let index = 1; index < values.length; index += 1) {
      if (matchesDeletedProductRow(values[index], product)) {
        resolved.add(index + 1);
        return;
      }
    }
  });

  return Array.from(resolved).sort((a, b) => a - b);
}

export function buildStrikethroughRequests(rowNumbers: number[], sheetId: number): BatchUpdateRequest[] {
  return rowNumbers.map((rowNumber) => ({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: rowNumber - 1,
        endRowIndex: rowNumber,
        startColumnIndex: 0,
        endColumnIndex: PURCHASE_SHEET_COLUMN_COUNT,
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
  }));
}

export async function markPurchaseOrderRowsDeletedInGoogleSheet(input: {
  poNumber: string;
  products: DeletedPurchaseSheetProduct[];
}) {
  if (input.products.length === 0) {
    return {
      success: true as const,
      skipped: true,
      updatedRowNumbers: [] as number[],
      reason: "no_products",
    };
  }

  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    return {
      success: true as const,
      skipped: true,
      updatedRowNumbers: input.products
        .map((product) => product.sheetRowNumber)
        .filter((rowNumber): rowNumber is number => typeof rowNumber === "number" && rowNumber > 1),
      reason: "test_environment",
    };
  }

  const accessToken = await getGoogleAccessToken();
  const [{ values = [] }, sheetId] = await Promise.all([
    getPurchaseSheetValues(accessToken),
    getPurchaseSheetId(accessToken),
  ]);

  const rowNumbers = resolveDeletedPurchaseSheetRowNumbers(values, input.products.map((product) => ({
    ...product,
    poNumber: product.poNumber ?? input.poNumber,
  })));

  if (rowNumbers.length === 0) {
    return {
      success: true as const,
      skipped: true,
      updatedRowNumbers: [] as number[],
      reason: "rows_not_found",
    };
  }

  await callSheetsApi(
    accessToken,
    `spreadsheets/${PURCHASE_SHEET_SPREADSHEET_ID}:batchUpdate`,
    {
      method: "POST",
      body: {
        requests: buildStrikethroughRequests(rowNumbers, sheetId),
      },
    },
  );

  return {
    success: true as const,
    skipped: false,
    updatedRowNumbers: rowNumbers,
    reason: null,
  };
}
