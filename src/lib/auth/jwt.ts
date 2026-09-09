import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { randomBytes, createHash } from "crypto";
import { getEnv } from "@/lib/env";

/**
 * Access tokens are signed JWTs (HS256). Refresh tokens are OPAQUE random
 * strings, not JWTs: an opaque token carries no claims to go stale, and
 * revoking one is a single indexed lookup against the RefreshToken collection.
 */

export type AccessTokenClaims = {
  userId: string;
  /** `null` for a platform Super Admin. */
  hospitalId: string | null;
  roleId: string | null;
  isSuperAdmin: boolean;
  tokenVersion: number;
  /** Mirrors Hospital.tokenVersion; always 0 for Super Admins. */
  hospitalTokenVersion: number;
  /**
   * Session id — the _id of the RefreshToken row this access token was minted
   * alongside.
   *
   * Without it, logout could not revoke the caller's refresh token: that
   * cookie is path-scoped to /api/auth/refresh, so the browser never sends it
   * to /api/auth/logout. Carrying the id in the access token lets logout
   * revoke exactly this device, while the cookie stays tightly scoped.
   */
  sid: string;
};

const encoder = new TextEncoder();

function accessSecret(): Uint8Array {
  return encoder.encode(getEnv().JWT_ACCESS_SECRET);
}

export function accessTokenTtlSeconds(): number {
  return getEnv().ACCESS_TOKEN_TTL;
}

export function refreshTokenTtlSeconds(): number {
  return getEnv().REFRESH_TOKEN_TTL;
}

// --------------------------------------------------------------------------
// Access token
// --------------------------------------------------------------------------

export async function signAccessToken(
  claims: AccessTokenClaims,
): Promise<string> {
  const env = getEnv();
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({
    userId: claims.userId,
    hospitalId: claims.hospitalId,
    roleId: claims.roleId,
    isSuperAdmin: claims.isSuperAdmin,
    tokenVersion: claims.tokenVersion,
    hospitalTokenVersion: claims.hospitalTokenVersion,
    sid: claims.sid,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.userId)
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + env.ACCESS_TOKEN_TTL)
    .sign(accessSecret());
}

/**
 * Verifies signature, issuer, audience and expiry, then shape-checks the
 * payload. Returns `null` on ANY failure — callers must treat null as 401 and
 * never fall back to trusting an unverified decode.
 */
export async function verifyAccessToken(
  token: string,
): Promise<AccessTokenClaims | null> {
  const env = getEnv();

  try {
    const { payload } = await jwtVerify(token, accessSecret(), {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      // Pin the algorithm: without this a token could be presented with a
      // different alg header and change how verification is performed.
      algorithms: ["HS256"],
    });

    return parseAccessClaims(payload);
  } catch {
    return null;
  }
}

function parseAccessClaims(payload: JWTPayload): AccessTokenClaims | null {
  const {
    userId,
    hospitalId,
    roleId,
    isSuperAdmin,
    tokenVersion,
    hospitalTokenVersion,
    sid,
  } = payload as Record<string, unknown>;

  if (typeof userId !== "string" || userId.length === 0) return null;
  if (typeof sid !== "string" || sid.length === 0) return null;
  if (typeof tokenVersion !== "number") return null;
  if (typeof hospitalTokenVersion !== "number") return null;
  if (typeof isSuperAdmin !== "boolean") return null;
  if (hospitalId !== null && typeof hospitalId !== "string") return null;
  if (roleId !== null && typeof roleId !== "string") return null;

  return {
    userId,
    hospitalId: hospitalId ?? null,
    roleId: roleId ?? null,
    isSuperAdmin,
    tokenVersion,
    hospitalTokenVersion,
    sid,
  };
}

// --------------------------------------------------------------------------
// Refresh token (opaque)
// --------------------------------------------------------------------------

/** 48 random bytes, base64url encoded. */
export function generateRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

/**
 * Refresh tokens are stored hashed. SHA-256 (not bcrypt) is correct here: the
 * token is already 384 bits of entropy, so it is not brute-forceable, and a
 * fast hash keeps the lookup a single indexed equality match.
 */
export function hashRefreshToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function refreshTokenExpiry(): Date {
  return new Date(Date.now() + refreshTokenTtlSeconds() * 1000);
}
