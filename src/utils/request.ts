import type { NextRequest } from "next/server";
import { clientIp } from "@/lib/security/rate-limit";

export type RequestMeta = { ipAddress: string; userAgent: string };

/** Context attached to audit log entries. */
export function requestMeta(req: NextRequest): RequestMeta {
  return {
    ipAddress: clientIp(req),
    userAgent: (req.headers.get("user-agent") ?? "").slice(0, 300),
  };
}

/** Short human-readable device label for the "active sessions" list. */
export function deviceLabel(req: NextRequest): string {
  const ua = req.headers.get("user-agent") ?? "";
  if (!ua) return "Unknown device";

  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : /Firefox\//.test(ua) ? "Firefox"
    : "Browser";

  const os =
    /Windows/.test(ua) ? "Windows"
    : /Android/.test(ua) ? "Android"
    : /iPhone|iPad/.test(ua) ? "iOS"
    : /Mac OS X/.test(ua) ? "macOS"
    : /Linux/.test(ua) ? "Linux"
    : "Unknown OS";

  return `${browser} on ${os}`;
}
