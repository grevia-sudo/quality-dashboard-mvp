type ErrorWithStatus = {
  data?: {
    httpStatus?: number;
  };
  message?: string;
};

const TRANSIENT_HTML_JSON_ERROR_FRAGMENT = "Unexpected token '<'";
const TRANSIENT_NETWORK_ERROR_FRAGMENTS = [
  "Failed to fetch",
  "fetch failed",
  "NetworkError",
  "Bad Gateway",
];

export function shouldRetryTransientQuery(failureCount: number, error: unknown) {
  if (failureCount >= 2) {
    return false;
  }

  const candidate = error as ErrorWithStatus | null | undefined;
  const httpStatus = candidate?.data?.httpStatus;
  if (typeof httpStatus === "number" && httpStatus >= 500) {
    return true;
  }

  const message = candidate?.message ?? "";
  if (message.includes(TRANSIENT_HTML_JSON_ERROR_FRAGMENT)) {
    return true;
  }

  return TRANSIENT_NETWORK_ERROR_FRAGMENTS.some((fragment) => message.includes(fragment));
}
