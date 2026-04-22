import { createSign } from "node:crypto";
import { describe, expect, it } from "vitest";

type ServiceAccountCredentials = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

function base64UrlEncode(value: string) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function createSignedJwt(credentials: ServiceAccountCredentials) {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  const payload = {
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
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

describe("Google service account secret", () => {
  it("can exchange the configured service account JSON for a Google access token", async () => {
    const rawCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

    expect(rawCredentials, "缺少 GOOGLE_SERVICE_ACCOUNT_JSON 環境變數").toBeTruthy();

    const credentials = JSON.parse(rawCredentials ?? "{}") as ServiceAccountCredentials;

    expect(credentials.client_email, "服務帳戶缺少 client_email").toBeTruthy();
    expect(credentials.private_key, "服務帳戶缺少 private_key").toContain("BEGIN PRIVATE KEY");

    const assertion = createSignedJwt(credentials);
    const tokenUri = credentials.token_uri ?? "https://oauth2.googleapis.com/token";

    const response = await fetch(tokenUri, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });

    const result = await response.json();

    expect(response.ok, JSON.stringify(result)).toBe(true);
    expect(result.access_token).toEqual(expect.any(String));
    expect(result.token_type).toBe("Bearer");
  }, 20000);
});
