import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_core/sdk", () => ({
  sdk: {
    createLocalPasswordUser: vi.fn(),
  },
}));

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { sdk } from "./_core/sdk";

function createAdminContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "local:admin",
      username: "Kiddliao",
      passwordHash: "hashed-value",
      email: null,
      name: "Kiddliao",
      loginMethod: "password",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      cookie: vi.fn(),
    } as TrpcContext["res"],
  };
}

describe("admin.createUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets admin create a local password user", async () => {
    const caller = appRouter.createCaller(createAdminContext());

    vi.mocked(sdk.createLocalPasswordUser).mockResolvedValue({
      id: 9,
      openId: "local:rita.lin",
      username: "rita.lin",
      passwordHash: "hashed-password",
      email: null,
      name: "林小美",
      loginMethod: "password",
      role: "manager",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: null,
    });

    const result = await caller.admin.createUser({
      username: "rita.lin",
      password: "abc12345",
      name: "林小美",
      role: "manager",
    });

    expect(sdk.createLocalPasswordUser).toHaveBeenCalledWith({
      username: "rita.lin",
      password: "abc12345",
      name: "林小美",
      role: "manager",
    });
    expect(result).toMatchObject({
      username: "rita.lin",
      role: "manager",
      loginMethod: "password",
    });
  });
});
