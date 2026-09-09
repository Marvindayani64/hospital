import mongoose, { type ClientSession } from "mongoose";
import { connectToDatabase } from "@/lib/db/connect";

/**
 * MongoDB transactions require a replica set or a sharded cluster. A plain
 * standalone `mongod` — very common in local development — rejects them.
 *
 * `runAtomically` therefore attempts a real transaction first and, only when
 * the server reports that transactions are unsupported, falls back to running
 * the same work without a session and invoking the caller's `compensate`
 * callback if anything throws.
 *
 * The fallback is best-effort, not atomic: a crash between two writes can still
 * leave partial data. Run against a replica set in production.
 */

let transactionsSupported: boolean | null = null;

const UNSUPPORTED_MARKERS = [
  "Transaction numbers are only allowed on a replica set member or mongos",
  "Transactions are not supported",
  "does not support transactions",
  "Unrecognized field 'startTransaction'",
];

function isUnsupportedTransactionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  // 20 = IllegalOperation, which standalone mongod returns for startTransaction.
  if (code === 20 || code === 263) return true;
  return UNSUPPORTED_MARKERS.some((marker) => error.message.includes(marker));
}

export type AtomicOptions = {
  /**
   * Cleanup invoked ONLY on the non-transactional fallback path, after `work`
   * has thrown. It receives whatever partial state the work callback recorded.
   */
  compensate?: (error: unknown) => Promise<void>;
};

export async function runAtomically<T>(
  work: (session: ClientSession | null) => Promise<T>,
  options: AtomicOptions = {},
): Promise<T> {
  await connectToDatabase();

  if (transactionsSupported !== false) {
    const session = await mongoose.startSession();
    try {
      let result: T;
      await session.withTransaction(async () => {
        result = await work(session);
      });
      transactionsSupported = true;
      // `withTransaction` resolves only after the body ran successfully, so
      // `result` is always assigned here.
      return result!;
    } catch (error) {
      if (isUnsupportedTransactionError(error)) {
        transactionsSupported = false;
        // Fall through to the non-transactional path below.
      } else {
        throw error;
      }
    } finally {
      await session.endSession();
    }
  }

  try {
    return await work(null);
  } catch (error) {
    if (options.compensate) {
      try {
        await options.compensate(error);
      } catch {
        // Never let cleanup failure mask the original error.
      }
    }
    throw error;
  }
}

/** Exposed for diagnostics / health checks. `null` means "not yet probed". */
export function transactionSupportStatus(): boolean | null {
  return transactionsSupported;
}
