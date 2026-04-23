import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

export { COOKIE_NAME, ONE_YEAR_MS };

export const getLoginUrl = (
  returnPath = `${window.location.pathname}${window.location.search}${window.location.hash}`
) => {
  const next = returnPath.startsWith("/") ? returnPath : "/";
  const url = new URL("/login", window.location.origin);
  url.searchParams.set("next", next);
  return url.toString();
};
