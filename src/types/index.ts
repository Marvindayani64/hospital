import type { Permission } from "@/lib/rbac/permissions";

export type EntityStatus = "active" | "inactive";
export type HospitalStatus = "active" | "inactive" | "suspended";

export type HospitalType =
  | "general"
  | "multi_specialty"
  | "dental"
  | "skin"
  | "hair"
  | "cosmetic"
  | "eye"
  | "clinic"
  | "other";

export const HOSPITAL_TYPES: readonly HospitalType[] = [
  "general",
  "multi_specialty",
  "dental",
  "skin",
  "hair",
  "cosmetic",
  "eye",
  "clinic",
  "other",
] as const;

/**
 * The authenticated principal, assembled fresh from the database on every
 * request. Nothing here is trusted straight from the JWT payload.
 */
export type AuthContext = {
  userId: string;
  /** Identifies this device's session (the RefreshToken row) for targeted logout. */
  sessionId: string;
  /** `null` identifies a platform Super Admin. */
  hospitalId: string | null;
  roleId: string | null;
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
  name: string;
  email: string;
  /** Resolved from the current Role document, never from the token. */
  permissions: Permission[];
};

export type ApiSuccess<T> = { success: true; data: T };
export type ApiFailure = {
  success: false;
  error: { code: string; message: string; details?: unknown };
};
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export type Paginated<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};
