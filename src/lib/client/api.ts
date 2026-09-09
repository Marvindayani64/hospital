"use client";

import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/auth/cookie-names";
import type { ApiResult } from "@/types";

/**
 * Browser-side API client.
 *
 * Tokens are never touched here — they live in HTTP-only cookies the browser
 * attaches automatically. This module only has to do two things the cookies
 * cannot do for themselves: echo the CSRF nonce, and transparently retry once
 * after refreshing an expired access token.
 */

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields: Record<string, string>;

  constructor(
    code: string,
    status: number,
    message: string,
    fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

function readCsrfToken(): string {
  const match = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${CSRF_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(CSRF_COOKIE.length + 1)) : "";
}

function extractFields(details: unknown): Record<string, string> {
  if (
    typeof details === "object" &&
    details !== null &&
    "fields" in details &&
    typeof (details as { fields: unknown }).fields === "object"
  ) {
    return (details as { fields: Record<string, string> }).fields;
  }
  return {};
}

/**
 * Single-flight refresh: if several requests 401 at once, they all await one
 * refresh call rather than each firing their own and invalidating each other
 * through rotation.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "same-origin",
        headers: { [CSRF_HEADER]: readCsrfToken() },
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      // Cleared on the next tick so concurrent callers share this result.
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();

  return refreshInFlight;
}

export type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  /** Internal: prevents an infinite refresh loop. */
  _retried?: boolean;
};

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const method = options.method ?? "GET";

  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  // Safe methods do not require the double-submit token.
  if (method !== "GET") headers[CSRF_HEADER] = readCsrfToken();

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch {
    throw new ApiClientError(
      "NETWORK_ERROR",
      0,
      "Could not reach the server. Check your connection and try again.",
    );
  }

  let payload: ApiResult<T> | null = null;
  try {
    payload = (await response.json()) as ApiResult<T>;
  } catch {
    payload = null;
  }

  if (response.ok && payload?.success) return payload.data;

  const code = payload && !payload.success ? payload.error.code : "INTERNAL_ERROR";
  const message =
    payload && !payload.success
      ? payload.error.message
      : "Something went wrong. Please try again.";

  /**
   * A 401 usually just means the 15-minute access token expired. Refresh once
   * and replay the request; if that fails the session is genuinely over.
   */
  if (
    response.status === 401 &&
    !options._retried &&
    path !== "/api/auth/refresh" &&
    path !== "/api/auth/login"
  ) {
    const refreshed = await refreshTokens();
    if (refreshed) {
      return apiRequest<T>(path, { ...options, _retried: true });
    }
  }

  throw new ApiClientError(
    code,
    response.status,
    message,
    extractFields(payload && !payload.success ? payload.error.details : undefined),
  );
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) =>
    apiRequest<T>(path, { method: "GET", signal }),
  post: <T>(path: string, body?: unknown) =>
    apiRequest<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) =>
    apiRequest<T>(path, { method: "PATCH", body }),
  put: <T>(path: string, body?: unknown) =>
    apiRequest<T>(path, { method: "PUT", body }),
  del: <T>(path: string) => apiRequest<T>(path, { method: "DELETE" }),
};
