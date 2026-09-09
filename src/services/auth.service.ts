import type { ClientSession } from "mongoose";
import { connectToDatabase } from "@/lib/db/connect";
import { Hospital, RefreshToken, User, type UserDoc } from "@/models";
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
} from "@/lib/auth/jwt";
import {
  fakePasswordCheck,
  hashPassword,
  verifyPassword,
} from "@/lib/auth/password";
import { ApiError } from "@/lib/api/errors";

/**
 * All token issuance, rotation and revocation lives here so the route handlers
 * stay thin and there is exactly one place that decides what goes into a token.
 */

export type IssuedTokens = { accessToken: string; refreshToken: string };

type TokenSubject = Pick<
  UserDoc,
  "_id" | "hospitalId" | "roleId" | "isSuperAdmin" | "tokenVersion"
>;

export type SessionContext = {
  deviceInfo: string;
  ipAddress: string;
};

/**
 * Signs an access token and persists a fresh refresh token row.
 *
 * `hospitalTokenVersion` is read from the Hospital document at issue time, so a
 * later bump there invalidates this token on its next use.
 */
export async function issueTokens(
  user: TokenSubject,
  context: SessionContext,
  session?: ClientSession | null,
): Promise<IssuedTokens> {
  const hospitalId = user.hospitalId ? String(user.hospitalId) : null;

  let hospitalTokenVersion = 0;
  if (hospitalId) {
    const hospital = await Hospital.findById(hospitalId)
      .select("tokenVersion status")
      .lean();

    if (!hospital) {
      throw ApiError.unauthenticated();
    }
    if (hospital.status !== "active") {
      throw ApiError.hospitalInactive(hospital.status);
    }
    hospitalTokenVersion = hospital.tokenVersion;
  }

  const rawRefreshToken = generateRefreshToken();

  const refreshDoc = {
    userId: user._id,
    hospitalId: user.hospitalId ?? null,
    tokenHash: hashRefreshToken(rawRefreshToken),
    deviceInfo: context.deviceInfo,
    ipAddress: context.ipAddress,
    issuedAt: new Date(),
    expiresAt: refreshTokenExpiry(),
    revokedAt: null,
  };

  /**
   * The refresh row is written FIRST so its _id can be embedded in the access
   * token as `sid`. That binding is what lets logout revoke this exact device
   * without needing the path-scoped refresh cookie.
   */
  const [stored] = await RefreshToken.create(
    [refreshDoc],
    session ? { session } : {},
  );

  if (!stored) throw ApiError.internal("Could not start a session.");

  const accessToken = await signAccessToken({
    userId: String(user._id),
    hospitalId,
    roleId: user.roleId ? String(user.roleId) : null,
    isSuperAdmin: Boolean(user.isSuperAdmin),
    tokenVersion: user.tokenVersion,
    hospitalTokenVersion,
    sid: String(stored._id),
  });

  return { accessToken, refreshToken: rawRefreshToken };
}

// --------------------------------------------------------------------------
// Login
// --------------------------------------------------------------------------

export type AuthenticatedUser = {
  user: UserDoc;
  tokens: IssuedTokens;
};

/**
 * Verifies credentials and issues a token pair.
 *
 * Every failure mode returns the same generic error so the endpoint does not
 * disclose whether an email is registered, whether the account is deactivated,
 * or which hospital it belongs to (Section 7).
 */
export async function authenticate(
  email: string,
  password: string,
  context: SessionContext,
): Promise<AuthenticatedUser> {
  await connectToDatabase();

  const genericFailure = ApiError.unauthenticated(
    "Incorrect email or password.",
  );

  /**
   * Email is unique per tenant, so one address can legitimately exist at
   * several hospitals. Candidates are gathered and the password decides which
   * account is meant — the user never has to name their hospital to log in.
   */
  const candidates = await User.find({ email })
    .select(
      "+passwordHash hospitalId name email roleId isSuperAdmin status mustChangePassword tokenVersion",
    )
    .limit(10);

  if (candidates.length === 0) {
    // Equalise timing against the case where a user does exist.
    await fakePasswordCheck();
    throw genericFailure;
  }

  let matched: UserDoc | null = null;
  for (const candidate of candidates) {
    if (await verifyPassword(password, candidate.passwordHash)) {
      matched = candidate;
      break;
    }
  }

  if (!matched) throw genericFailure;
  if (matched.status !== "active") throw genericFailure;

  // Hospital status is checked inside issueTokens, which throws a specific
  // HOSPITAL_INACTIVE error — that one IS worth disclosing, since the
  // credentials were already proven correct and the user needs to know why.
  const tokens = await issueTokens(matched, context);

  await User.updateOne(
    { _id: matched._id },
    { $set: { lastLoginAt: new Date() } },
  );

  return { user: matched, tokens };
}

// --------------------------------------------------------------------------
// Refresh with rotation
// --------------------------------------------------------------------------

export type RefreshResult = { tokens: IssuedTokens; userId: string };

/**
 * Validates a refresh token, rotates it, and issues a new access token.
 *
 * Rotation means a refresh token is single-use. If an already-rotated token is
 * presented again, that is a strong signal it was stolen and replayed, so the
 * entire family is revoked and the user is forced to log in again.
 */
export async function refreshSession(
  rawRefreshToken: string,
  context: SessionContext,
): Promise<RefreshResult> {
  await connectToDatabase();

  const invalid = ApiError.unauthenticated("Session expired. Please log in again.");

  const tokenHash = hashRefreshToken(rawRefreshToken);
  const stored = await RefreshToken.findOne({ tokenHash });

  if (!stored) throw invalid;

  if (stored.revokedAt !== null) {
    // Reuse detection: revoke every live session for this user.
    await revokeAllUserTokens(String(stored.userId));
    throw invalid;
  }

  if (stored.expiresAt.getTime() <= Date.now()) throw invalid;

  const user = await User.findById(stored.userId).select(
    "hospitalId roleId isSuperAdmin status tokenVersion",
  );

  if (!user || user.status !== "active") {
    await revokeAllUserTokens(String(stored.userId));
    throw invalid;
  }

  const tokens = await issueTokens(user, context);

  // Mark the old row revoked and point it at its successor, so a later replay
  // of the old value is detectable.
  await RefreshToken.updateOne(
    { _id: stored._id },
    {
      $set: {
        revokedAt: new Date(),
        replacedBy: hashRefreshToken(tokens.refreshToken),
      },
    },
  );

  return { tokens, userId: String(user._id) };
}

// --------------------------------------------------------------------------
// Revocation
// --------------------------------------------------------------------------

/** Revokes a specific device's session, identified by the `sid` access-token claim. */
export async function revokeSession(
  sessionId: string,
  userId: string,
): Promise<void> {
  await connectToDatabase();
  await RefreshToken.updateOne(
    // Scoped by userId as well, so one user's token can never revoke another's.
    { _id: sessionId, userId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

/** Revokes a session given the raw refresh token value. */
export async function revokeRefreshToken(rawRefreshToken: string): Promise<void> {
  await connectToDatabase();
  await RefreshToken.updateOne(
    { tokenHash: hashRefreshToken(rawRefreshToken), revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

/** "Log out everywhere" — revokes every refresh token the user holds. */
export async function revokeAllUserTokens(userId: string): Promise<void> {
  await connectToDatabase();
  await RefreshToken.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

/**
 * Forces a user off every device immediately: the tokenVersion bump kills
 * outstanding access tokens on their next request, and revoking the refresh
 * tokens stops new ones being minted.
 */
export async function forceLogout(userId: string): Promise<void> {
  await connectToDatabase();
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
  await revokeAllUserTokens(userId);
}

// --------------------------------------------------------------------------
// Password change (Sections 6, 7, 31)
// --------------------------------------------------------------------------

export type ChangePasswordResult = { tokens: IssuedTokens };

/**
 * Verifies the current password, stores the new hash, and rotates the user
 * completely onto new credentials:
 *
 *   - `tokenVersion` is incremented, which invalidates every access token
 *     issued before the change — including the temp-password-era token the
 *     caller is holding right now, and any token on another device.
 *   - every existing refresh token is revoked.
 *   - a fresh pair is issued for THIS device, so the user stays logged in here
 *     and is signed out everywhere else.
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  context: SessionContext,
): Promise<ChangePasswordResult> {
  await connectToDatabase();

  const user = await User.findById(userId).select(
    "+passwordHash hospitalId roleId isSuperAdmin status tokenVersion",
  );

  if (!user || user.status !== "active") throw ApiError.unauthenticated();

  const currentMatches = await verifyPassword(currentPassword, user.passwordHash);
  if (!currentMatches) {
    throw ApiError.validation("Your current password is incorrect.", {
      fields: { currentPassword: "Your current password is incorrect." },
    });
  }

  // Guards the case where the Zod check passed because the client sent a
  // different "current" value than the one actually stored.
  const reusesOldPassword = await verifyPassword(newPassword, user.passwordHash);
  if (reusesOldPassword) {
    throw ApiError.validation("Choose a password you have not used before.", {
      fields: {
        newPassword: "New password must be different from your current password.",
      },
    });
  }

  user.passwordHash = await hashPassword(newPassword);
  user.mustChangePassword = false;
  user.passwordChangedAt = new Date();
  user.tokenVersion += 1;
  await user.save();

  await revokeAllUserTokens(String(user._id));

  const tokens = await issueTokens(user, context);

  return { tokens };
}
