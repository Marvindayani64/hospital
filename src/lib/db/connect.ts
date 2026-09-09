import mongoose from "mongoose";
import { getEnv } from "@/lib/env";

/**
 * Next.js hot-reloads modules in development, which would otherwise open a new
 * MongoDB connection pool on every reload until the server runs out of sockets.
 * The connection promise is therefore cached on globalThis.
 */
type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

const globalForMongoose = globalThis as unknown as {
  __mongooseCache?: MongooseCache;
};

const cache: MongooseCache = globalForMongoose.__mongooseCache ?? {
  conn: null,
  promise: null,
};

globalForMongoose.__mongooseCache = cache;

export async function connectToDatabase(): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn;

  if (!cache.promise) {
    const { MONGODB_URI } = getEnv();

    // Fail fast instead of buffering queries forever when Mongo is unreachable.
    mongoose.set("bufferCommands", false);
    /**
     * Defence in depth against query-selector injection: any object value in a
     * query filter whose keys start with "$" is wrapped in an `$eq`, so a
     * request body smuggling `{ "email": { "$ne": null } }` matches literally
     * instead of acting as an operator.
     *
     * CONSEQUENCE: operators WE write must be marked with `mongoose.trusted()`,
     * otherwise they are neutralised too:
     *
     *   expiresAt: mongoose.trusted({ $gt: new Date() })
     *
     * `regexSearch()` in lib/tenant/scope.ts does this for the common case.
     * Forgetting raises a loud CastError rather than failing silently.
     * Aggregation pipelines are unaffected — this applies to query filters only.
     */
    mongoose.set("sanitizeFilter", true);

    cache.promise = mongoose
      .connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 10_000,
        maxPoolSize: 10,
      })
      .catch((error: unknown) => {
        // Clear the cached promise so the next request retries the connection
        // rather than re-awaiting a permanently rejected promise.
        cache.promise = null;
        throw error;
      });
  }

  cache.conn = await cache.promise;

  // Importing the models here guarantees every model is registered exactly once
  // before any query runs, regardless of which route handler connected first.
  await import("@/models");

  return cache.conn;
}
