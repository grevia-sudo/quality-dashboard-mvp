import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import axios from "axios";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

function decodeStateValue(state: string): string | null {
  try {
    return Buffer.from(state, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function getPostLoginRedirectPath(state: string): string {
  const decoded = decodeStateValue(state);
  if (!decoded) return "/";

  try {
    const parsed = JSON.parse(decoded) as {
      returnPath?: unknown;
      redirectUri?: unknown;
      origin?: unknown;
    };

    if (typeof parsed.returnPath === "string" && parsed.returnPath.startsWith("/")) {
      return parsed.returnPath;
    }

    if (typeof parsed.redirectUri === "string" && parsed.redirectUri.length > 0) {
      const url = new URL(parsed.redirectUri);
      const path = `${url.pathname}${url.search}${url.hash}` || "/";
      return path === "/api/oauth/callback" ? "/" : path;
    }

    if (typeof parsed.origin === "string" && parsed.origin.length > 0) {
      return "/";
    }
  } catch {
    try {
      const url = new URL(decoded);
      const path = `${url.pathname}${url.search}${url.hash}` || "/";

      if (path === "/api/oauth/callback") {
        return "/";
      }

      return path;
    } catch {
      return decoded.startsWith("/") ? decoded : "/";
    }
  }

  return "/";
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      await db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.redirect(302, getPostLoginRedirectPath(state));
    } catch (error) {
      const decodedState = decodeStateValue(state);

      if (axios.isAxiosError(error)) {
        console.error("[OAuth] Callback failed", {
          message: error.message,
          status: error.response?.status ?? null,
          statusText: error.response?.statusText ?? null,
          data: error.response?.data ?? null,
          redirectUriFromState: decodedState,
          callbackHost: req.get("host") ?? null,
          callbackUrl: req.originalUrl,
        });
      } else {
        console.error("[OAuth] Callback failed", {
          error,
          redirectUriFromState: decodedState,
          callbackHost: req.get("host") ?? null,
          callbackUrl: req.originalUrl,
        });
      }

      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
