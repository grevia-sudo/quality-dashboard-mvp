import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_core/sdk", () => ({
  sdk: {
    authenticatePasswordUser: vi.fn(),
    createSessionToken: vi.fn(),
  },
}));

import { appRouter } from "./routers";
import { COOKIE_NAME, ONE_YEAR_MS } from "../shared/const";
import type { TrpcContext } from "./_core/context";
import { sdk } from "./_core/sdk";

type CookieCall = {
  name: string;
  value: string;
  options: Record<string, unknown>;
};

function createPublicContext(): { ctx: TrpcContext; cookies: CookieCall[] } {
  const cookies: CookieCall[] = [];

  const ctx: TrpcContext = {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      cookie: (name: string, value: string, options: Record<string, unknown>) => {
        cookies.push({ name, value, options });
      },
    } as TrpcContext["res"],
  };

  return { ctx, cookies };
}

describe("auth.login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("authenticates local credentials and sets session cookie", async () => {
    const { ctx, cookies } = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    vi.mocked(sdk.authenticatePasswordUser).mockResolvedValue({
      id: 7,
      openId: "local:Kiddliao",
      username: "Kiddliao",
      passwordHash: "hashed-value",
      email: null,
      name: "Kiddliao",
      loginMethod: "password",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    });
    vi.mocked(sdk.createSessionToken).mockResolvedValue("session-token");

    const result = await caller.auth.login({
      username: "Kiddliao",
      password: "Kidd1985",
    });

    expect(sdk.authenticatePasswordUser).toHaveBeenCalledWith("Kiddliao", "Kidd1985");
    expect(sdk.createSessionToken).toHaveBeenCalledWith("local:Kiddliao", {
      name: "Kiddliao",
      expiresInMs: ONE_YEAR_MS,
    });
    expect(result.success).toBe(true);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatchObject({
      name: COOKIE_NAME,
      value: "session-token",
      options: {
        maxAge: ONE_YEAR_MS,
        secure: true,
        sameSite: "none",
        httpOnly: true,
        path: "/",
      },
    });
  });
});
