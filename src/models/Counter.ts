import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * Per-tenant atomic sequence generator.
 *
 * Fixes the race condition the spec flags in Section 19: deriving a patient
 * number from `count() + 1` lets two receptionists registering patients at the
 * same moment both read the same count and produce the same number — one
 * insert then fails on the unique index, or worse, both succeed if the index is
 * missing.
 *
 * `findOneAndUpdate` with `$inc` and `upsert` is a single atomic document
 * update in MongoDB, so every caller gets a distinct value with no transaction,
 * no retry loop and no lock.
 */
const CounterSchema = new Schema(
  {
    hospitalId: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
    },

    /** Sequence name within the tenant, e.g. "patient" or "invoice". */
    key: { type: String, required: true },

    seq: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

/**
 * Unique so the upsert can never create two counter documents for the same
 * sequence under concurrency.
 */
CounterSchema.index({ hospitalId: 1, key: 1 }, { unique: true });

export type CounterDoc = InferSchemaType<typeof CounterSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Counter: Model<CounterDoc> =
  (mongoose.models.Counter as Model<CounterDoc>) ??
  mongoose.model<CounterDoc>("Counter", CounterSchema);
