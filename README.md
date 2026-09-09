# Multi-Tenant Hospital Management CRM

Multi-tenant SaaS for hospitals and clinics.

- **Phase 1** — authentication and multi-tenancy foundation: JWT auth with
  access + refresh tokens, Super Admin, hospital onboarding, forced first-login
  password change.
- **Phase 2** — tenant isolation helpers, RBAC role management, and hospital
  staff management.
- **Phase 3** — departments, treatments/services, and hospital-specific pricing.
- **Phase 4** — patients, doctors and appointments.
- **Phase 5** — dynamic form builder, responses and form versioning.
- **Phase 6** — visits and consultations.
- **Phase 7** — invoices, payments and billing.
- **Phase 8** — dashboard statistics, hospital settings, audit log and reports.

**All eight phases are complete.** Every test case in the spec's Section 51 is
covered by the verification suites below.

Stack: Next.js 15 (App Router) · TypeScript (strict) · MongoDB + Mongoose ·
Zod · jose (JWT) · bcryptjs · Tailwind CSS v4.

---

## Running it

### 1. Prerequisites

- Node.js 20+
- MongoDB running locally, or a MongoDB Atlas connection string

### 2. Install

```bash
npm install
```

### 3. Configure

```bash
cp .env.example .env.local
```

Generate two **different** secrets and paste them in:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

| Variable | Purpose | Default |
|---|---|---|
| `MONGODB_URI` | Connection string | — (required) |
| `JWT_ACCESS_SECRET` | Signs access tokens. Min 32 chars | — (required) |
| `JWT_REFRESH_SECRET` | Must differ from the access secret | — (required) |
| `ACCESS_TOKEN_TTL` | Access token lifetime, seconds | `900` (15 min) |
| `REFRESH_TOKEN_TTL` | Refresh token lifetime, seconds | `2592000` (30 days) |
| `JWT_ISSUER` / `JWT_AUDIENCE` | Verified on every token | `hospital-crm` / `hospital-crm-app` |
| `SUPER_ADMIN_EMAIL` | Seeded platform admin | — (seed only) |
| `SUPER_ADMIN_PASSWORD` | Must satisfy the password policy | — (seed only) |
| `SUPER_ADMIN_NAME` | Display name | `Platform Super Admin` |

The app refuses to start if a secret is missing, shorter than 32 characters, or
if both secrets are identical.

### 4. Seed the Super Admin

```bash
npm run seed
```

Idempotent — re-running reports the existing account and changes nothing.

### 5. Start

```bash
npm run dev
```

Sign in at <http://localhost:3000/login> with the seeded credentials.

### 6. Verify (optional)

With the dev server running, in a second terminal:

```bash
npm run verify:auth      # Phase 1 — 49 assertions
npm run verify:tenancy   # Phase 2 — 54 assertions
npm run verify:catalog   # Phase 3 — 44 assertions
npm run verify:clinical  # Phase 4 — 63 assertions
npm run verify:forms     # Phase 5 — 64 assertions
npm run verify:visits    # Phase 6 — 43 assertions
npm run verify:billing   # Phase 7 — 57 assertions
npm run verify:admin     # Phase 8 — 63 assertions
```

`verify:auth` covers CSRF, token revocation, refresh rotation, reuse detection,
tenant lockout and JWT tampering. `verify:tenancy` builds two hospitals and
proves neither can read or touch the other's data, plus RBAC enforcement and the
lockout guards. `verify:catalog` builds a USD hospital and a JPY hospital and
checks pricing precision, per-tenant catalogues and cross-tenant isolation.
`verify:clinical` fires concurrent registrations and concurrent bookings at the
server to prove the patient-number counter and the double-booking guard hold
under real contention. `verify:forms` submits a response, edits the form, and
then re-reads the response to prove it is byte-for-byte unchanged and still
renders with its original questions. `verify:visits` checks the clinical record
— including that a consultation cannot be reassigned to another patient, and
that specialty forms attach to exactly one visit. `verify:billing` submits an
invoice with spoofed prices and totals in the request body and asserts every one
of them was ignored in favour of the catalogue price. `verify:admin` confirms
that a receptionist's dashboard and reports omit revenue entirely — the figures
are never computed, not merely hidden — and that a tenant cannot suspend their
own hospital or switch its currency through the settings screen.

### Changing an index

```bash
npm run sync-indexes
```

Mongoose's `autoIndex` creates missing indexes but will **not** modify one that
already exists with different options — it leaves the stale definition in place.
`syncIndexes()` drops what is no longer declared and rebuilds. Run it after
editing any index definition.

---

## Authentication flow

```
POST /api/auth/login
  ↓ find candidate users by email (email is unique PER hospital)
  ↓ bcrypt compare picks the right account; a miss burns equal CPU
  ↓ reject unless user.status === "active"
  ↓ reject unless hospital.status === "active"
  ↓ create RefreshToken row  → its _id becomes the token's `sid`
  ↓ sign access JWT { userId, hospitalId, roleId, isSuperAdmin,
                      tokenVersion, hospitalTokenVersion, sid }
  ↓ Set-Cookie: access_token   HttpOnly, SameSite=Lax, Path=/
     Set-Cookie: refresh_token HttpOnly, SameSite=Lax, Path=/api/auth/refresh
  ↓ mustChangePassword ? /change-password : /dashboard
```

Every protected request then runs the Section 8a pipeline in `requireAuth()`:

```
verify signature + issuer + audience + expiry (HS256 pinned)
  ↓ load User from the database by the decoded userId
  ↓ 401 unless user.status === "active"
  ↓ 401 unless user.tokenVersion === token.tokenVersion
  ↓ 401 unless user.hospitalId === token.hospitalId
  ↓ 403 unless hospital.status === "active"
  ↓ 401 unless hospital.tokenVersion === token.hospitalTokenVersion
  ↓ 403 if mustChangePassword and the route is not whitelisted
  ↓ resolve permissions FRESH from the Role document
```

Nothing in the token is trusted for an authorisation decision. The token
carries identity; the database decides what that identity may currently do.

### Revocation

| Event | Effect | Takes effect |
|---|---|---|
| Password change | `user.tokenVersion += 1`, all refresh tokens revoked | Next request |
| Force logout | `user.tokenVersion += 1`, all refresh tokens revoked | Next request |
| Hospital suspend/deactivate/reactivate | `hospital.tokenVersion += 1` — **one write locks out every user of that tenant** | Next request |
| Logout | This device's refresh row revoked via the `sid` claim | Immediately for refresh; access token dies within ≤15 min |
| Refresh token replay | Whole session family revoked (theft signal) | Immediately |

Access tokens are not individually blacklisted — impractical for a stateless
JWT. The short TTL bounds the window, and the per-request `tokenVersion` check
closes it entirely.

---

## Multi-tenancy

- Every tenant-owned document carries `hospitalId`.
- `hospitalId` is only ever read from the database-backed auth context.
  `req.body.hospitalId` and `?hospitalId=` are never consulted. Request schemas
  do not even *accept* the field, so it cannot be injected.
- `requireHospitalUser()` returns a type whose `hospitalId` is a non-null
  string, so a tenant-scoped query cannot forget it and still typecheck.
- Role lookups are themselves scoped by `hospitalId`, so a token bearing
  another tenant's `roleId` resolves to nothing.
- A Super Admin has `hospitalId: null` and is granted **no** tenant
  permissions — platform administration stays separate from clinical data.

### The scoping helpers (`lib/tenant/scope.ts`)

Every later phase should build queries with these rather than hand-rolling
filters:

| Helper | Use |
|---|---|
| `tenantScoped(hospitalId, filter)` | Merges the tenant discriminator in **last**, so a caller-supplied filter cannot override it |
| `assertBelongsToTenant(Model, id, hospitalId)` | The Section 10 relationship check — loads a referenced document only if it belongs to this tenant, else 404 |
| `existsInTenant(Model, id, hospitalId)` | Cheap existence check |
| `regexSearch(term)` | Escaped, injection-safe, `trusted()`-marked search matcher |
| `paginationSkip` / `paginationMeta` | Consistent pagination |

Cross-tenant references return **404, not 403**, so probing cannot confirm that
another hospital's record id exists.

---

## API

| Method | Endpoint | Auth |
|---|---|---|
| `POST` | `/api/auth/login` | Public (rate limited: 8 / 5 min / IP) |
| `POST` | `/api/auth/refresh` | Refresh cookie (rate limited: 60 / 5 min) |
| `POST` | `/api/auth/logout` | Any session, incl. password-change pending |
| `GET` | `/api/auth/me` | Any session, incl. password-change pending |
| `POST` | `/api/auth/change-password` | Any session, incl. password-change pending |
| `GET` `POST` | `/api/super-admin/hospitals` | Super Admin |
| `GET` `PATCH` `PUT` | `/api/super-admin/hospitals/[id]` | Super Admin |
| `GET` | `/api/super-admin/stats` | Super Admin |
| `GET` | `/api/permissions` | Any hospital user |
| `GET` | `/api/roles` | `role.view` |
| `POST` | `/api/roles` | `role.create` |
| `GET` | `/api/roles/[id]` | `role.view` |
| `PATCH` | `/api/roles/[id]` | `role.update` |
| `DELETE` | `/api/roles/[id]` | `role.delete` |
| `GET` | `/api/users` | `user.view` |
| `POST` | `/api/users` | `user.create` |
| `GET` | `/api/users/[id]` | `user.view` |
| `PATCH` | `/api/users/[id]` | `user.update` |
| `PUT` | `/api/users/[id]` | `user.update` (status) |
| `DELETE` | `/api/users/[id]` | `user.delete` |
| `DELETE` | `/api/users/[id]/sessions` | `user.update` (force logout) |
| `GET` | `/api/departments` | `department.view` |
| `POST` | `/api/departments` | `department.create` |
| `GET` | `/api/departments/[id]` | `department.view` |
| `PATCH` | `/api/departments/[id]` | `department.update` |
| `DELETE` | `/api/departments/[id]` | `department.delete` |
| `GET` | `/api/treatments` | `treatment.view` |
| `POST` | `/api/treatments` | `treatment.create` |
| `GET` | `/api/treatments/[id]` | `treatment.view` |
| `PATCH` | `/api/treatments/[id]` | `treatment.update` |
| `DELETE` | `/api/treatments/[id]` | `treatment.delete` |
| `GET` `POST` | `/api/patients` | `patient.view` / `patient.create` |
| `GET` `PATCH` `DELETE` | `/api/patients/[id]` | `patient.view` / `.update` / `.delete` |
| `GET` `POST` | `/api/doctors` | `doctor.view` / `doctor.create` |
| `GET` `PATCH` `DELETE` | `/api/doctors/[id]` | `doctor.view` / `.update` / `.delete` |
| `GET` `POST` | `/api/appointments` | `appointment.view` / `.create` |
| `GET` `PATCH` | `/api/appointments/[id]` | `appointment.view` / `.update` |
| `PUT` | `/api/appointments/[id]` | `.update`, or `.cancel` when cancelling |
| `DELETE` | `/api/appointments/[id]` | `appointment.cancel` |
| `GET` `POST` | `/api/forms` | `form.view` / `form.create` |
| `GET` `PATCH` `DELETE` | `/api/forms/[id]` | `form.view` / `.update` / `.delete` |
| `GET` | `/api/forms/[id]/fields` | `form.view` |
| `PUT` | `/api/forms/[id]/fields` | `form.update` |
| `GET` | `/api/forms/[id]/responses` | `form.view` |
| `POST` | `/api/forms/[id]/responses` | `form.submit` |
| `GET` | `/api/form-responses/[id]` | `form.view` |
| `GET` `POST` | `/api/visits` | `visit.view` / `visit.create` |
| `GET` `PATCH` | `/api/visits/[id]` | `visit.view` / `visit.update` |
| `GET` | `/api/patients/[id]/attachable-responses` | `visit.create` |
| `GET` `POST` | `/api/invoices` | `invoice.view` / `invoice.create` |
| `GET` `PATCH` `DELETE` | `/api/invoices/[id]` | `invoice.view` / `.update` / `.delete` |
| `PUT` | `/api/invoices/[id]` | `invoice.update` (issue / cancel) |
| `GET` `POST` | `/api/payments` | `payment.view` / `payment.create` |
| `GET` | `/api/dashboard/stats` | Any hospital user (per-metric gating) |
| `GET` | `/api/reports/summary` | Any hospital user (per-section gating) |
| `GET` `PATCH` | `/api/hospital/settings` | `hospital.settings.view` / `.update` |
| `GET` | `/api/audit-logs` | `audit.view` |

`PATCH` edits profile fields; `PUT` changes status. They are separate verbs so a
status change can never bypass the `tokenVersion` bump and session revocation
that must accompany it.

Responses are uniform:

```jsonc
{ "success": true,  "data": { } }
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "…" } }
```

Codes: `VALIDATION_ERROR` `UNAUTHENTICATED` `FORBIDDEN` `NOT_FOUND` `CONFLICT`
`RATE_LIMITED` `CSRF_FAILED` `PASSWORD_CHANGE_REQUIRED` `HOSPITAL_INACTIVE`
`INTERNAL_ERROR`.

---

## Project structure

```
src/
  app/
    (auth)/login, (auth)/change-password     Public + password-change screens
    (dashboard)/dashboard                    Tenant workspace
    super-admin/                             Platform console
    api/                                     Route handlers (thin)
  components/ui, components/layout           Reusable UI + app shell
  lib/
    auth/    jwt.ts, session.ts, cookies.ts, password.ts, cookie-names.ts
    rbac/    permissions.ts, default-roles.ts, guard.ts, page-guard.ts
    tenant/  scope.ts                        Tenant scoping helpers
    forms/   validate.ts                     Dynamic response validation
    db/      connect.ts, transaction.ts
    security/ csrf.ts, rate-limit.ts
    api/     response.ts, errors.ts
    client/  api.ts                          Browser fetch wrapper
  models/    Hospital, User, Role, RefreshToken, AuditLog, Department,
             Treatment, Counter, Patient, Doctor, Appointment,
             Form, FormField, FormResponse, Visit, Invoice, Payment
  services/  auth, hospital, user, role, department, treatment,
             patient, doctor, appointment, counter, form,
             form-response, visit, billing, settings, report, audit
  schemas/   Zod validation
  utils/     money.ts, time.ts, slug.ts, request.ts, cn.ts
  middleware.ts                              Security headers + CSRF nonce
scripts/     seed.ts, sync-indexes.ts, verify-auth.ts, verify-tenancy.ts,
             verify-catalog.ts, verify-clinical.ts, verify-forms.ts,
             verify-visits.ts, verify-billing.ts, verify-admin.ts
```

Route handlers validate, authorise and delegate. Business logic lives in
`services/`.

---

## Security decisions

- **Cookies, never storage.** Both tokens are HTTP-only; the access token never
  appears in a JSON body. `localStorage` is not used at all.
- **CSRF is still required.** A cookie-borne JWT is auto-attached by the browser
  exactly like a session cookie. Defence is double-submit: a readable
  `csrf_token` nonce issued by the middleware, echoed in `x-csrf-token`, and
  compared with `timingSafeEqual`. Enforced on every non-GET route.
- **`SameSite=Lax`, not `Strict`.** Strict drops the cookie on ordinary
  top-level navigation into the app, stranding signed-in users on the login
  page. Lax still blocks the cross-site POST that CSRF needs, and the
  double-submit token is the primary control regardless.
- **Refresh tokens are opaque, not JWTs.** No claims to go stale, and revoking
  one is a single indexed lookup. Stored as SHA-256 (not bcrypt — the value is
  already 384 bits of entropy, so a slow hash would buy nothing and cost a lot).
- **Rotation with reuse detection.** Each refresh is single-use; replaying a
  rotated token revokes the entire family.
- **Algorithm pinning.** `algorithms: ["HS256"]` on verify, so a token cannot
  nominate how it is checked.
- **No user enumeration.** Unknown email, wrong password, and deactivated
  account all return the same generic 401, and a miss still runs a dummy bcrypt
  comparison so the timing matches.
- **Temporary passwords** are generated with a CSPRNG, stored only as a bcrypt
  hash (cost 12), shown once, and unretrievable thereafter.
- **Audit logs** redact any key resembling a credential or token as a backstop.
- **Security headers** (CSP, `X-Frame-Options: DENY`, `nosniff`,
  `Referrer-Policy`, `Permissions-Policy`) applied in middleware.
- **Injection.** Mongoose `sanitizeFilter` is enabled globally, so a request
  body smuggling `{"email": {"$ne": null}}` is matched literally instead of
  acting as an operator. Search input is additionally regex-escaped.

  ⚠️ **Gotcha for later phases:** `sanitizeFilter` neutralises operators *we*
  write too. Any deliberate operator in a query filter must be wrapped:

  ```ts
  expiresAt: mongoose.trusted({ $gt: new Date() })
  ```

  `regexSearch()` handles the common case. Forgetting raises a loud `CastError`
  rather than failing silently, and aggregation pipelines are unaffected.

### RBAC

- Permissions resolve from the **current** Role document on every request, so
  granting or revoking a permission takes effect on the member's very next
  request — no re-login, no `tokenVersion` bump needed.
- Endpoints are gated by individual permissions (`user.create`, `role.delete`)
  rather than a blanket "is admin" check, so a custom role granted a narrow
  slice of capability works exactly as configured.
- Server components use `guardHospitalPage()`, which renders an access-denied
  view instead of throwing — the API still returns a real 403 independently.

### Lockout guards

A hospital cannot be left unmanageable. The API refuses to:

- deactivate or delete your own account;
- deactivate, delete, or demote the tenant's **last active administrator**;
- delete a system (default) role;
- delete any role still assigned to members — they would fail authorisation on
  every request once their role vanished.

"Administrator" is determined by capability (holding `user.create` **and**
`role.create`), not by role name, so a renamed or custom admin role still counts.

The same shape of guard runs through the whole data model — nothing can be
deleted out from under something that references it:

| Cannot delete | While |
|---|---|
| A role | Members still hold it |
| A department | It has treatments, doctors, or appointments |
| A treatment | Appointments reference it |
| A doctor | They have appointment history |
| A patient | They have appointment history |
| A form | It has submitted responses (archive it instead) |
| An appointment | A visit was recorded for it (cancel it instead) |
| A doctor / patient / treatment | Visits reference them |
| A treatment | It appears on an invoice line |
| A patient | They have invoices |
| An invoice | It has been issued (cancel it instead) |

In every case deactivating is offered as the non-destructive alternative, which
keeps the record while removing it from new bookings.

### Money

Treatment prices are stored as **integer minor units** (`priceMinor`) of the
hospital's `currency`, never as floating-point major units.

This is not fussiness. Phase 7 computes invoice totals server-side by summing
line items, and binary floats do not sum cleanly: `10.10 + 20.20 + 0.30` gives
`30.599999999999998`, while `1010 + 2020 + 30` gives exactly `3060`. A test in
`verify:catalog` pins this behaviour.

- The API speaks **major units** (`price: 149.99`); conversion happens once in
  each direction inside the service layer.
- Precision is validated against the currency — `10.999` is rejected for USD,
  and `100.5` is rejected for JPY, which has no minor unit.
- `currency` lives on the **Hospital**, not on each treatment, so one tenant
  cannot end up with prices in mixed currencies. It is set at onboarding;
  Phase 8 exposes it in hospital settings.
- `getTreatmentPrice()` in `treatment.service.ts` is the authoritative lookup
  Phase 7 billing must use, satisfying Section 27's "never trust a price sent
  from the frontend".

### Appointments

**Time is stored as wall-clock, not as an instant.** `appointmentDate` is a
`YYYY-MM-DD` string and the times are minutes-from-midnight integers, both in
the hospital's local time. A clinic booking "09:00 Tuesday" means nine in the
morning *at that clinic*, and it must keep meaning that across a daylight-saving
change — which storing a UTC instant would break. It also makes overlap
detection exact integer arithmetic with no timezone maths in the booking path.

*Limitation:* comparing across hospitals in different timezones, and scheduling
reminders, will need a `timezone` field on Hospital. That lands with
notifications in Phase 8; nothing in Phase 4 requires it.

**Double-booking is prevented** by an indexed overlap query on
`(hospitalId, doctorId, appointmentDate)`. Intervals are half-open, so a
09:00–10:00 booking does not collide with 10:00–11:00, and cancelled/no-show
appointments release their slot for rebooking.

**Status is a state machine.** The transition table in `appointment.service.ts`
allows `scheduled → confirmed → checked_in → in_progress → completed`, with
cancellation available from any live state. `completed`, `cancelled` and
`no_show` are terminal — such an appointment can be neither re-statused nor
rescheduled.

**All four references are re-validated on every write.** Creating *and* editing
an appointment resolves the patient, doctor, department and treatment inside the
caller's tenant, so a booking cannot be walked across a tenant boundary one
field at a time. A treatment must also belong to the department it is booked
under.

### Patient numbers

`PAT-000001` is generated from a per-tenant atomic counter
(`findOneAndUpdate` + `$inc` + `upsert`), which is a single atomic document
update — no transaction, no lock, no retry loop.

This is the fix for the race the spec flags in Section 19: with `count() + 1`,
two receptionists registering simultaneously read the same count and produce the
same number. `verify:clinical` fires twelve concurrent registrations and asserts
every number is distinct.

Numbering is per tenant, so `PAT-000001` validly exists at every hospital on the
platform.

### Form versioning

The requirement (Section 25): editing a form must never alter responses already
submitted against it. The mechanism is **copy-on-write**.

`FormField` rows are keyed by `(formId, version)` — a `version` the spec's field
list omits, but without which editing a form would rewrite the very definitions
historical responses were answered against. `FormResponse` pins the
`formVersion` it was submitted on.

| Situation | What happens on save |
|---|---|
| Current version has **no** responses | Fields edited **in place** — authoring does not spawn a version per keystroke |
| Current version **has** responses | Fields written as **version N+1**; version N is left untouched forever |

Reading a response resolves its fields from *its own* version, so a v1 response
still displays v1's labels, options and ordering — including questions later
removed — after the form has moved to v3. Old versions are never mutated and
never deleted, which is also why a form with responses can be archived but not
deleted.

`draft` forms cannot receive responses (so a half-built form is never presented
to a patient) and `archived` ones cannot receive or be edited, while keeping
their history readable.

### Dynamic response validation

The shape of a valid submission is not known at compile time — it is whatever
the hospital configured. `lib/forms/validate.ts` derives the rules from the
field definitions at request time, as a **pure function** over plain data with
no database or request access.

- Each answer is checked against its field type, its `validation` rules, and its
  `options` for choice fields.
- **Conditional fields**: a required field hidden by its condition does not block
  submission — otherwise a required follow-up ("if yes, describe…") would make
  every "no" answer unsubmittable. Once the condition is met, it *is* required.
- **Undeclared keys are dropped, not stored.** Only fields defined on that
  version survive into the record, so a crafted payload cannot smuggle arbitrary
  data into a patient's file.

### Visits, and specialty extensibility

Section 26 asks for a clinical record that stays extensible across medical
specialties. The `Visit` model therefore contains **no specialty fields at all**
— a dental clinic's tooth chart and a hair clinic's density grading are captured
through each hospital's own forms and linked to the visit, so a new specialty is
configuration rather than a schema change.

The link lives as a nullable `visitId` on `FormResponse` rather than an array on
`Visit`. That direction makes it structurally impossible for one response to sit
on two clinical records; attaching, detaching and the "already attached
elsewhere" refusal all fall out of a single field.

Other decisions worth knowing:

- **`visitDate` is separate from `createdAt`.** A consultation is often written
  up hours or days later, and every clinical listing orders by when care was
  given, not when the note was typed.
- **A visit cannot be reassigned.** `patientId` and `appointmentId` are absent
  from the update schema: moving a clinical record to another patient is never a
  legitimate correction and would corrupt two histories at once.
- **There is no DELETE.** The permission catalogue has no `visit.delete`, and
  destroying a clinical record is not something this system offers.
- **One visit per appointment**, via a partial unique index — partial rather than
  sparse, because walk-ins store an explicit `null` that a sparse index would
  still index (the same trap as `Doctor.userId`).

*Limitation:* amendments are audit-logged by field name, but full clinical
amendment history — the before-and-after of every edit — is not retained. That
belongs with the audit work in Phase 8.

### Billing

**Prices are never taken from the browser** (Section 27). A catalogue line sends
only a `treatmentId` and a quantity — the request schema has no field for a
price, so a client-supplied amount cannot be honoured even by accident. The
server reads `priceMinor` from the Treatment document in the caller's own
tenant, then computes subtotal, discount, tax and total. `verify:billing` posts
`price`, `unitPrice`, `unitPriceMinor`, `lineTotalMinor`, `subtotalMinor` and
`totalMinor` in one request and asserts every one is ignored.

Ad-hoc lines *do* carry a price, because there is no catalogue entry to read one
from. They are a separate, explicitly-shaped input, gated on `invoice.create`
and audit-logged — the distinction keeps "a price arrived from a client" a
visible decision rather than an accident.

**Prices are snapshotted onto the invoice.** Re-pricing a treatment next month
must not rewrite invoices already raised — the same principle as form
versioning. A new invoice picks up the new price; existing ones do not move.

**Order of operations:** `tax = (subtotal − discount) × rate`. Tax applies to
the discounted amount, not the gross. A discount can reduce a bill to zero but
never below it.

**Payment status is derived, never stored.** `status` holds only the lifecycle
(`draft` / `issued` / `cancelled`); paid-ness comes from summing the payment
ledger on read. A stored "paid" flag that disagrees with the ledger is the worst
possible failure mode in billing, so the design makes it impossible.

| Guard | Behaviour |
|---|---|
| Draft invoice | No payments until issued |
| Issued invoice | Cannot be edited or deleted — cancel and re-raise |
| Invoice with payments | Cannot be re-totalled or cancelled |
| Payment amount | Cannot exceed the outstanding balance |
| Payments | Append-only — no update or delete path exists |

*Known limitation:* two simultaneous payments could each pass the overpayment
check before either is written, since there is no cross-document transaction
without a replica set. The balance is re-derived on every read, so an
overpayment would be visible rather than hidden — reconciling it is a finance
decision, not something to paper over.

### Dashboards, reports and settings

**Metrics are permission-gated at the source.** Each dashboard tile and report
section is computed *only* when the caller holds the permission for its
underlying data, and returns `null` otherwise. A receptionist's dashboard does
not contain a revenue figure that the UI happens to hide — the number is never
calculated. `verify:admin` asserts this for both the dashboard and reports.

**Tenant settings cannot reach platform controls.** `/api/hospital/settings`
takes no hospital id — the tenant comes from the authenticated context — and the
schema has no field for `status`, `currency` or `slug`. Status is the platform's
to set, and changing currency would silently reinterpret every stored price,
since amounts are held as minor units of it. The test posts all three and
confirms each is ignored.

**One permission was added to the spec's catalogue.** Section 50 requires audit
logs in Phase 8, but Section 11's permission list has no entry for reading them.
Rather than fold them into `hospital.settings.view`, this adds **`audit.view`**:
an audit trail records who did what and is more sensitive than a settings
screen. Granted to Hospital Admin only by default.

**Notification preferences are stored but nothing delivers on them.** Wiring
them up needs an email or SMS provider — the first external dependency this
project would take on — so the settings screen says so plainly rather than
implying messages are being sent.

### Configuration, not code

Nothing about any specialty appears in the codebase (Sections 17, 39). A new
hospital starts with **zero** departments and **zero** treatments, and its admin
defines whatever it actually offers. `verify:catalog` asserts this by running a
hair clinic and a dental clinic through identical code paths — different
departments, different services, different prices, different currencies.

Treatments also carry a free-form `metadata` map (validated as a flat map of
primitives), which is how a hair clinic records "sessions included" and a dental
clinic records something else entirely without either concept entering the
schema.

### Deviations from the spec, and why

1. **`sid` claim added to the access token.** The spec scopes the refresh cookie
   to `/api/auth/refresh`. That is good hygiene, but it means the browser never
   sends that cookie to `/api/auth/logout` — so logout could not identify which
   device to revoke. (This was caught by the test suite, not by inspection.)
   Binding each access token to its refresh row via `sid` keeps the tight cookie
   scoping *and* gives precise per-device logout.
2. **`bcryptjs` instead of native `bcrypt`.** No node-gyp toolchain required, so
   `npm install` works on Windows and in slim containers. Swapping in argon2
   means changing only `lib/auth/password.ts`.
3. **Permissions are a code catalogue, not a collection.** Roles store validated
   `resource.action` strings. Adding a permission needs no per-tenant data
   migration; roles stay tenant-owned and editable. One entry — `audit.view` —
   extends the spec's Section 11 list, because Phase 8 requires audit logs but
   no permission was specified for reading them.
4. **Email uniqueness is per tenant** — `{hospitalId, email}` compound unique
   index, as recommended in the spec's Section 16 note. The same person can be
   staff at two hospitals; Super Admins occupy the `hospitalId: null` namespace.
   Login resolves the account by password without asking which hospital.

---

## Known limitations

- **Rate limiting is in-process.** It protects a single instance. Behind
  multiple replicas or on serverless, move `lib/security/rate-limit.ts` to Redis
  — the call sites do not change.
- **Transactions need a replica set.** On a standalone `mongod`,
  `lib/db/transaction.ts` falls back to sequential writes with compensating
  rollback. That fallback is best-effort, not atomic: a process crash mid-way
  can still leave partial data. Use a replica set or Atlas in production.
- **`x-forwarded-for` is trusted** for rate-limit identity. Only meaningful
  behind a proxy that sets it authoritatively.
- **No password reset / email delivery.** Deliberate — the spec forbids a
  password retrieval mechanism. Onboarding email is a later phase.
- **CSP allows `'unsafe-inline'`** for scripts and styles, which Next.js
  currently requires for its bootstrap. Tightening this needs a nonce-based CSP.
- **No automated unit tests.** The `verify:*` scripts are integration harnesses
  against a live server, not unit suites. Unit coverage of the pure functions —
  `lib/forms/validate.ts`, `utils/money.ts`, the billing totals calculation —
  would be quick to add and is the obvious next testing step.
- **Super Admin cannot be created through the UI** — only via `npm run seed`.
  Intentional.
- **Concurrent payments can overshoot a balance.** Without a replica set there
  is no cross-document transaction, so two simultaneous payments could each pass
  the overpayment check. The balance is re-derived from the ledger on every
  read, so it surfaces rather than hides.
- **`file` / `image` form fields store a reference string, not an upload.**
  There is no file-storage backend in the project; wiring these to real uploads
  needs one.

---

## Test coverage

437 assertions across the eight suites, all passing.

| Spec case (Section 51) | Suite |
|---|---|
| 1. Hospital A cannot access Hospital B data | `verify:tenancy` (users & roles) |
| 2. Hospital A cannot access Hospital B treatments | `verify:catalog` |
| 3. Cross-tenant catalogue access rejected | `verify:catalog` |
| 4. Hospital A cannot access Hospital B users | `verify:tenancy` |
| 5 / 6. Member without permission cannot act | `verify:tenancy` |
| 7. Hospital Admin can create roles | `verify:tenancy` |
| 8. Hospital Admin can assign roles | `verify:tenancy` |
| 9. Temporary password forces change | `verify:auth` |
| 10. No dashboard access before change | `verify:auth` |
| 11. Super Admin can create hospital | `verify:auth` |
| 12. Creation makes the Hospital Admin | `verify:auth` |
| 13. Cross-tenant relationships rejected | `verify:tenancy` (role assignment) |
| 14. Frontend `hospitalId` cannot override auth | both |
| 16. `tokenVersion` bump kills tokens in one request | `verify:auth` |
| 17. Hospital suspend locks out all its users | `verify:auth` |
| 18. Expired access + valid refresh → rotation | `verify:auth` |
| 19. Revoked refresh → must log in again | `verify:auth` |
| 20. Tampered JWT rejected | `verify:auth` |
| 21. State-changing request without CSRF rejected | `verify:auth` |

| 15. Invoice price computed from the database | `verify:billing` |

**Every case in Section 51 is now covered.**

Case 13 is proven exhaustively: `verify:clinical` attempts a booking with a
foreign patient, a foreign doctor, a foreign department and a foreign treatment,
and each is rejected.

---

## What would come next

All eight specified phases are complete. If this were going further, in order of
value:

1. **Unit tests for the pure functions.** `lib/forms/validate.ts`,
   `utils/money.ts` and the billing totals calculation are all pure and would be
   quick to cover with Vitest. The `verify:*` scripts are integration harnesses
   against a live server — valuable, but slow and not a substitute.
2. **A replica set.** It unlocks real MongoDB transactions, which would close
   the compensating-rollback fallback in `lib/db/transaction.ts` and the
   concurrent-payment window in billing.
3. **Notification delivery.** The preferences exist and are stored; they need an
   email or SMS provider behind them.
4. **File storage.** The `file` and `image` form field types validate and store a
   reference string today; real uploads need a storage backend.
5. **Distributed rate limiting.** `lib/security/rate-limit.ts` is in-process, so
   it protects one instance. Moving it to Redis changes no call sites.
