/**
 * Imported from lib/domain/enums.ts, NOT from the Mongoose model: this module
 * is used by client components (the form renderer evaluates the same
 * conditional-visibility rules in the browser), and importing the model would
 * pull Mongoose into the client bundle.
 */
import {
  CHOICE_TYPES,
  MULTI_VALUE_TYPES,
  type FieldType,
} from "@/lib/domain/enums";
import { isValidDateString } from "@/utils/time";

/**
 * Dynamic response validation.
 *
 * The shape of a valid submission is not known at compile time — it is defined
 * by whatever fields the hospital configured for this form version. This module
 * derives the rules from those field definitions at request time.
 *
 * Deliberately a PURE function over plain data: no database access, no request
 * context. That keeps it directly testable and means the same logic could drive
 * client-side hints without duplicating it.
 */

export type FieldOption = { label: string; value: string };

export type FieldValidationRules = {
  min?: number | null;
  max?: number | null;
  minLength?: number | null;
  maxLength?: number | null;
  pattern?: string | null;
};

export type ConditionalLogic = {
  fieldName: string;
  operator: "equals" | "not_equals" | "contains" | "is_empty" | "is_not_empty";
  value?: unknown;
};

export type FieldDefinition = {
  fieldName: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: FieldOption[];
  validation?: FieldValidationRules | null;
  conditionalLogic?: ConditionalLogic | null;
};

export type ValidationResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; errors: Record<string, string> };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Digits, spaces and the usual separators; length is checked separately. */
const PHONE_PATTERN = /^[+()\-.\s\d]{5,30}$/;

const MAX_TEXT_LENGTH = 5000;
const MAX_ARRAY_ITEMS = 100;

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Evaluates a field's display condition against the submitted answers.
 *
 * Returns true when the field should be shown. A field hidden by its condition
 * is not validated and not required — otherwise a required follow-up question
 * ("if yes, describe…") would block every submission that answered "no".
 */
export function isFieldVisible(
  field: FieldDefinition,
  answers: Record<string, unknown>,
): boolean {
  const condition = field.conditionalLogic;
  if (!condition) return true;

  const other = answers[condition.fieldName];

  switch (condition.operator) {
    case "is_empty":
      return isEmpty(other);
    case "is_not_empty":
      return !isEmpty(other);
    case "equals":
      return String(other ?? "") === String(condition.value ?? "");
    case "not_equals":
      return String(other ?? "") !== String(condition.value ?? "");
    case "contains":
      if (Array.isArray(other)) {
        return other.map(String).includes(String(condition.value ?? ""));
      }
      return String(other ?? "").includes(String(condition.value ?? ""));
    default:
      // Unknown operator: fail open rather than hiding the field silently.
      return true;
  }
}

/**
 * Compiles a stored pattern safely.
 *
 * Anchored so a partial match cannot pass, and rejected outright if it is not a
 * valid expression — a bad pattern stored years ago must not throw at
 * submission time.
 */
function compilePattern(pattern: string): RegExp | null {
  try {
    const anchored = pattern.startsWith("^") ? pattern : `^(?:${pattern})$`;
    return new RegExp(anchored);
  } catch {
    return null;
  }
}

function validateScalar(
  field: FieldDefinition,
  raw: unknown,
): { value: unknown } | { error: string } {
  const rules = field.validation ?? {};

  switch (field.type) {
    case "text":
    case "textarea":
    case "file":
    case "image": {
      if (typeof raw !== "string") return { error: "Must be text." };
      const value = raw.trim();
      if (value.length > MAX_TEXT_LENGTH) {
        return { error: `Must be at most ${MAX_TEXT_LENGTH} characters.` };
      }
      if (rules.minLength != null && value.length < rules.minLength) {
        return { error: `Must be at least ${rules.minLength} characters.` };
      }
      if (rules.maxLength != null && value.length > rules.maxLength) {
        return { error: `Must be at most ${rules.maxLength} characters.` };
      }
      if (rules.pattern) {
        const regex = compilePattern(rules.pattern);
        if (regex && !regex.test(value)) {
          return { error: "Does not match the expected format." };
        }
      }
      return { value };
    }

    case "number": {
      // Accept a numeric string, since HTML number inputs submit strings.
      const value = typeof raw === "string" ? Number(raw) : raw;
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return { error: "Must be a number." };
      }
      if (rules.min != null && value < rules.min) {
        return { error: `Must be at least ${rules.min}.` };
      }
      if (rules.max != null && value > rules.max) {
        return { error: `Must be at most ${rules.max}.` };
      }
      return { value };
    }

    case "email": {
      if (typeof raw !== "string") return { error: "Must be text." };
      const value = raw.trim().toLowerCase();
      if (!EMAIL_PATTERN.test(value)) {
        return { error: "Enter a valid email address." };
      }
      return { value };
    }

    case "phone": {
      if (typeof raw !== "string") return { error: "Must be text." };
      const value = raw.trim();
      if (!PHONE_PATTERN.test(value)) {
        return { error: "Enter a valid phone number." };
      }
      return { value };
    }

    case "date": {
      if (typeof raw !== "string") return { error: "Must be a date." };
      const value = raw.trim();
      if (!isValidDateString(value)) {
        return { error: "Enter a valid date in YYYY-MM-DD format." };
      }
      return { value };
    }

    case "boolean": {
      if (typeof raw === "boolean") return { value: raw };
      // Checkboxes and selects commonly submit these as strings.
      if (raw === "true") return { value: true };
      if (raw === "false") return { value: false };
      return { error: "Must be true or false." };
    }

    case "select":
    case "radio": {
      if (typeof raw !== "string") return { error: "Select an option." };
      const value = raw.trim();
      const allowed = (field.options ?? []).map((option) => option.value);
      if (!allowed.includes(value)) {
        return { error: "Select one of the available options." };
      }
      return { value };
    }

    default:
      return { error: "Unsupported field type." };
  }
}

function validateMultiValue(
  field: FieldDefinition,
  raw: unknown,
): { value: unknown } | { error: string } {
  if (!Array.isArray(raw)) return { error: "Select one or more options." };
  if (raw.length > MAX_ARRAY_ITEMS) {
    return { error: `Select at most ${MAX_ARRAY_ITEMS} options.` };
  }

  const allowed = new Set((field.options ?? []).map((option) => option.value));
  const values: string[] = [];

  for (const item of raw) {
    if (typeof item !== "string") {
      return { error: "Select one of the available options." };
    }
    const value = item.trim();
    if (!allowed.has(value)) {
      return { error: "Select one of the available options." };
    }
    // Silently de-duplicate rather than rejecting; the answer is unchanged.
    if (!values.includes(value)) values.push(value);
  }

  const rules = field.validation ?? {};
  if (rules.min != null && values.length < rules.min) {
    return { error: `Select at least ${rules.min}.` };
  }
  if (rules.max != null && values.length > rules.max) {
    return { error: `Select at most ${rules.max}.` };
  }

  return { value: values };
}

/**
 * Validates a submission against one form version's field definitions.
 *
 * Returns only the values for known, visible fields. Anything the client sent
 * that is not a field of this version is DROPPED rather than stored, so a
 * crafted payload cannot smuggle arbitrary data into the response document.
 */
export function validateResponse(
  fields: readonly FieldDefinition[],
  answers: Record<string, unknown>,
): ValidationResult {
  const errors: Record<string, string> = {};
  const clean: Record<string, unknown> = {};

  for (const field of fields) {
    // Conditions are evaluated against the RAW answers, so a field's visibility
    // does not depend on the order fields happen to be processed in.
    if (!isFieldVisible(field, answers)) continue;

    const raw = answers[field.fieldName];

    if (isEmpty(raw)) {
      if (field.required) {
        errors[field.fieldName] = `${field.label} is required.`;
      }
      // Absent optional answers are simply not stored.
      continue;
    }

    const result = MULTI_VALUE_TYPES.includes(field.type)
      ? validateMultiValue(field, raw)
      : validateScalar(field, raw);

    if ("error" in result) {
      errors[field.fieldName] = result.error;
    } else {
      clean[field.fieldName] = result.value;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return { ok: true, value: clean };
}

/** True when this field type draws its value from a fixed option list. */
export function isChoiceType(type: FieldType): boolean {
  return CHOICE_TYPES.includes(type);
}

/** True when this field type stores an array of values. */
export function isMultiValueType(type: FieldType): boolean {
  return MULTI_VALUE_TYPES.includes(type);
}
