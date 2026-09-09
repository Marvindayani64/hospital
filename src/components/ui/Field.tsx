"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/utils/cn";

const CONTROL_BASE =
  "w-full rounded-lg border bg-white px-3 text-sm text-ink-900 placeholder:text-ink-400 " +
  "transition-colors disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-500";

function controlClasses(hasError: boolean, extra?: string): string {
  return cn(
    CONTROL_BASE,
    hasError
      ? "border-red-400 focus:border-red-500"
      : "border-ink-200 hover:border-ink-300 focus:border-gold-500",
    extra,
  );
}

type FieldShellProps = {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
};

function FieldShell({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
}: FieldShellProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-sm font-medium text-ink-800"
      >
        {label}
        {required ? (
          <span className="ml-0.5 text-red-600" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        // role="alert" so the message is announced when validation fails.
        <p role="alert" className="text-xs font-medium text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-500">{hint}</p>
      ) : null}
    </div>
  );
}

export type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: ReactNode;
};

export function TextField({
  label,
  error,
  hint,
  className,
  id,
  required,
  ...rest
}: TextFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const describedBy = error || hint ? `${fieldId}-description` : undefined;

  return (
    <FieldShell
      label={label}
      htmlFor={fieldId}
      error={error}
      hint={hint}
      required={required}
    >
      <input
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        required={required}
        className={controlClasses(Boolean(error), cn("h-10", className))}
        {...rest}
      />
    </FieldShell>
  );
}

export type ComboFieldProps = {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  suggestions: readonly string[];
  error?: string;
  hint?: ReactNode;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
  maxLength?: number;
  /**
   * Fires when focus leaves the input, so a form can mark the field touched.
   * Choosing a suggestion does not blur the input — the list commits on
   * mousedown with the default prevented — so this signals a genuine exit.
   */
  onBlur?: () => void;
};

/**
 * A text input that offers suggestions in a dropdown anchored beneath it, while
 * still accepting anything typed.
 *
 * Built rather than using `<datalist>`: the native control's position, size and
 * styling are entirely browser-controlled, and Chromium renders it as a
 * full-height list detached from the field.
 *
 * Not a `<select>` either — departments and specialisations are tenant
 * configuration (Sections 17 and 39). A fixed list of options would quietly
 * turn them into a hard-coded set, which this system deliberately avoids. The
 * suggestions are a convenience; the value is free text.
 */
export function ComboField({
  label,
  value,
  onValueChange,
  suggestions,
  error,
  hint,
  placeholder,
  required,
  disabled,
  id,
  name,
  maxLength,
  onBlur,
}: ComboFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const listId = `${fieldId}-listbox`;

  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const query = value.trim().toLowerCase();
  const matches = suggestions
    .filter((option) => option.toLowerCase().includes(query))
    // An exact match means there is nothing left to suggest.
    .filter((option) => option.toLowerCase() !== query)
    .slice(0, 50);

  // Clicking anywhere else dismisses the list.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function choose(option: string) {
    onValueChange(option);
    setOpen(false);
    setHighlighted(-1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (matches.length === 0) return;
      event.preventDefault();
      setOpen(true);
      setHighlighted((current) => {
        const next = event.key === "ArrowDown" ? current + 1 : current - 1;
        if (next < 0) return matches.length - 1;
        if (next >= matches.length) return 0;
        return next;
      });
      return;
    }

    // Enter selects the highlighted option, but must not submit the form while
    // the list is open with a selection.
    if (event.key === "Enter" && open && highlighted >= 0) {
      const option = matches[highlighted];
      if (option) {
        event.preventDefault();
        choose(option);
      }
    }
  }

  return (
    <FieldShell
      label={label}
      htmlFor={fieldId}
      error={error}
      hint={hint}
      required={required}
    >
      <div ref={containerRef} className="relative">
        <input
          id={fieldId}
          name={name}
          type="text"
          role="combobox"
          aria-expanded={open && matches.length > 0}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          required={required}
          disabled={disabled}
          placeholder={placeholder}
          maxLength={maxLength}
          value={value}
          onChange={(event) => {
            onValueChange(event.target.value);
            setOpen(true);
            setHighlighted(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          className={controlClasses(Boolean(error), "h-10")}
        />

        {open && matches.length > 0 ? (
          <ul
            id={listId}
            role="listbox"
            aria-label={`${label} suggestions`}
            className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-lg border border-ink-200 bg-white py-1 shadow-lg"
          >
            {matches.map((option, index) => (
              <li key={option}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === highlighted}
                  // onMouseDown, not onClick: the input's blur would otherwise
                  // close the list before the click registered.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(option);
                  }}
                  onMouseEnter={() => setHighlighted(index)}
                  className={cn(
                    "block w-full px-3 py-1.5 text-left text-sm transition-colors",
                    index === highlighted
                      ? "bg-gold-50 text-gold-900"
                      : "text-ink-700 hover:bg-ink-50",
                  )}
                >
                  {option}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </FieldShell>
  );
}

export type PasswordFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> & {
  label: string;
  error?: string;
  hint?: ReactNode;
};

/**
 * A password input with the reveal toggle INSIDE the field.
 *
 * Replaces a separate "Show password" text link, which sat below the input and
 * competed with the submit button for attention. The eye is the conventional
 * placement, so it needs no label to be understood.
 *
 * Accessibility: it is a real `<button type="button">` (so it never submits the
 * form), carries `aria-pressed` for the on/off state, and an `aria-label` that
 * changes with it — the icon alone conveys nothing to a screen reader.
 */
export function PasswordField({
  label,
  error,
  hint,
  className,
  id,
  required,
  ...rest
}: PasswordFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const describedBy = error || hint ? `${fieldId}-description` : undefined;
  const [visible, setVisible] = useState(false);

  return (
    <FieldShell
      label={label}
      htmlFor={fieldId}
      error={error}
      hint={hint}
      required={required}
    >
      <div className="relative">
        <input
          id={fieldId}
          type={visible ? "text" : "password"}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          required={required}
          // Right padding keeps the typed value clear of the button.
          className={controlClasses(Boolean(error), cn("h-10 pr-10", className))}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          tabIndex={-1}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-ink-400 transition-colors hover:text-ink-700 focus-visible:text-ink-700"
        >
          {visible ? (
            // Eye with a slash — currently visible, click to hide.
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.4 5.2A9.5 9.5 0 0112 5c5 0 9 4.5 9 7a11 11 0 01-2.4 3.3M6.2 6.7A11.6 11.6 0 003 12c0 2.5 4 7 9 7 1.3 0 2.4-.3 3.5-.7"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.7" />
            </svg>
          )}
        </button>
      </div>
    </FieldShell>
  );
}

export type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  error?: string;
  hint?: ReactNode;
  options: Array<{ value: string; label: string }>;
};

export function SelectField({
  label,
  error,
  hint,
  options,
  className,
  id,
  required,
  ...rest
}: SelectFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <FieldShell
      label={label}
      htmlFor={fieldId}
      error={error}
      hint={hint}
      required={required}
    >
      <select
        id={fieldId}
        aria-invalid={error ? true : undefined}
        required={required}
        className={controlClasses(Boolean(error), cn("h-10", className))}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export type TextAreaFieldProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  error?: string;
  hint?: ReactNode;
};

export function TextAreaField({
  label,
  error,
  hint,
  className,
  id,
  required,
  ...rest
}: TextAreaFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <FieldShell
      label={label}
      htmlFor={fieldId}
      error={error}
      hint={hint}
      required={required}
    >
      <textarea
        id={fieldId}
        aria-invalid={error ? true : undefined}
        required={required}
        className={controlClasses(Boolean(error), cn("py-2", className))}
        {...rest}
      />
    </FieldShell>
  );
}
