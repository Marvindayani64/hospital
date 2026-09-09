import { z } from "zod";

/**
 * Server-side environment contract. Parsed lazily (not at module load) so that
 * importing this file from a client-adjacent module never throws, and so build
 * steps that do not touch the database do not require secrets to be present.
 */
const envSchema = z.object({
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),

  JWT_ACCESS_SECRET: z
    .string()
    .min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),

  ACCESS_TOKEN_TTL: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL: z.coerce.number().int().positive().default(2_592_000),

  JWT_ISSUER: z.string().min(1).default("hospital-crm"),
  JWT_AUDIENCE: z.string().min(1).default("hospital-crm-app"),

  /**
   * Blanket API rate limiting. Defaults are generous enough for ordinary
   * interactive use and tight enough to stop a scraper or a runaway client;
   * tune them per deployment rather than editing the code.
   *
   * Disabling is an explicit "false", not merely any value — a typo should
   * fail loudly rather than silently turning the control off.
   */
  RATE_LIMIT_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),

  /** Window shared by all three tiers, in seconds. */
  RATE_LIMIT_WINDOW: z.coerce.number().int().positive().default(60),
  /** Authenticated GET/HEAD requests, per user, per window. */
  RATE_LIMIT_READ: z.coerce.number().int().positive().default(300),
  /** Authenticated state-changing requests, per user, per window. */
  RATE_LIMIT_WRITE: z.coerce.number().int().positive().default(120),
  /** Requests with no valid session, per client IP, per window. */
  RATE_LIMIT_UNAUTH: z.coerce.number().int().positive().default(120),

  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid server environment configuration:\n${details}\n\n` +
        `Copy .env.example to .env.local and fill in the values.`,
    );
  }

  if (parsed.data.JWT_ACCESS_SECRET === parsed.data.JWT_REFRESH_SECRET) {
    throw new Error(
      "JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values. " +
        "Sharing one secret would let a refresh token be replayed as an access token.",
    );
  }

  cached = parsed.data;
  return cached;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}
