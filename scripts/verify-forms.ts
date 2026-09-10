/* eslint-disable @typescript-eslint/no-explicit-any --
 * Black-box harness: it reads arbitrary JSON envelopes from the API rather than
 * importing the app's own types, so a regression in those types cannot silently
 * make the tests pass.
 */

/**
 * Phase 5 verification — dynamic form builder, responses and versioning.
 *
 * The central claim under test is Section 25: editing a form must never alter
 * responses already submitted against an earlier version.
 *
 * Usage:
 *   1. npm run dev
 *   2. npm run verify:forms
 */
export {};

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";

type Cookie = { value: string; path: string };

class Jar {
  private cookies = new Map<string, Cookie>();

  absorb(response: Response): void {
    for (const line of response.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = line.split("; ");
      const eq = pair!.indexOf("=");
      const name = pair!.slice(0, eq);
      const value = pair!.slice(eq + 1);
      const pathAttr = attrs.find((a) => a.toLowerCase().startsWith("path="));
      const maxAge = attrs.find((a) => a.toLowerCase().startsWith("max-age="));
      if (value === "" || maxAge?.endsWith("=0")) this.cookies.delete(name);
      else this.cookies.set(name, { value, path: pathAttr ? pathAttr.slice(5) : "/" });
    }
  }

  header(path: string): string {
    return [...this.cookies.entries()]
      .filter(([, c]) => path.startsWith(c.path))
      .map(([n, c]) => `${n}=${c.value}`)
      .join("; ");
  }

  get(name: string): string | undefined {
    return this.cookies.get(name)?.value;
  }
}

async function call(
  path: string,
  options: { method?: string; body?: unknown; jar?: Jar } = {},
) {
  const { method = "GET", body, jar } = options;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (jar) {
    const cookie = jar.header(path);
    if (cookie) headers.Cookie = cookie;
    const csrf = jar.get("csrf_token");
    if (csrf && method !== "GET") headers["x-csrf-token"] = csrf;
  }

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });

  if (jar) jar.absorb(response);

  let json: any = null;
  try {
    json = await response.json();
  } catch {
    /* HTML response */
  }

  return { status: response.status, json };
}

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

async function signIn(email: string, password: string): Promise<Jar> {
  const jar = new Jar();
  await call("/login", { jar });
  const result = await call("/api/auth/login", {
    method: "POST",
    body: { email, password },
    jar,
  });
  if (result.status !== 200) {
    throw new Error(`Login failed for ${email}: ${result.status}`);
  }
  return jar;
}

type Tenant = { jar: Jar; patientId: string };

async function buildTenant(
  superJar: Jar,
  label: string,
  stamp: number,
): Promise<Tenant> {
  const adminEmail = `admin.${label.toLowerCase()}.${stamp}@example.test`;

  const created = await call("/api/super-admin/hospitals", {
    method: "POST",
    body: {
      name: `${label} Forms Clinic ${stamp}`,
      type: "clinic",
      email: `contact.${label.toLowerCase()}.${stamp}@example.test`,
      phone: "+15550100",
      status: "active",
      adminName: `${label} Admin`,
      adminEmail,
    },
    jar: superJar,
  });

  if (created.status !== 201) {
    throw new Error(`Could not create ${label}: ${created.status}`);
  }

  const temp = created.json.data.temporaryPassword as string;
  const password = `Forms${label}!2024`;
  const jar = await signIn(adminEmail, temp);
  await call("/api/auth/change-password", {
    method: "POST",
    body: { currentPassword: temp, newPassword: password, confirmPassword: password },
    jar,
  });

  const patient = await call("/api/patients", {
    method: "POST",
    body: {
      firstName: label,
      lastName: "Patient",
      phone: "+919876500200",
      email: `${label.toLowerCase().replace(/[^a-z0-9]/g, "")}.patient@example.com`,
    },
    jar,
  });

  return { jar, patientId: patient.json.data.id as string };
}

async function main(): Promise<void> {
  const { config } = await import("dotenv");
  config({ path: ".env.local" });

  const stamp = Date.now();
  const superJar = await signIn(
    process.env.SUPER_ADMIN_EMAIL ?? "superadmin@platform.local",
    process.env.SUPER_ADMIN_PASSWORD ?? "ChangeMe!2024",
  );

  section("Setup");
  const alpha = await buildTenant(superJar, "Alpha", stamp);
  const beta = await buildTenant(superJar, "Beta", stamp);
  check("Two hospitals configured", Boolean(alpha.patientId && beta.patientId));

  // -------------------------------------------------------------------------
  section("Forms are tenant configuration (Section 22)");
  const noForms = await call("/api/forms", { jar: alpha.jar });
  check(
    "A new hospital starts with NO preset forms",
    noForms.json?.data?.total === 0,
    `got ${noForms.json?.data?.total}`,
  );

  const form = await call("/api/forms", {
    method: "POST",
    body: {
      name: `Hair Assessment ${stamp}`,
      description: "Initial trichology intake.",
      category: "assessment",
    },
    jar: alpha.jar,
  });
  check("Form created", form.status === 201, `got ${form.status}`);
  const formId = form.json.data.id as string;
  check("New form starts as a draft", form.json.data.status === "draft");
  check("New form starts at version 1", form.json.data.currentVersion === 1);

  // A completely different hospital builds a completely different form — same
  // code, no shared structure.
  const betaForm = await call("/api/forms", {
    method: "POST",
    body: { name: `Orthodontic Intake ${stamp}`, category: "intake" },
    jar: beta.jar,
  });
  check(
    "A second hospital defines its own unrelated form",
    betaForm.status === 201,
  );

  // -------------------------------------------------------------------------
  section("Field definitions");
  const emptyPublish = await call(`/api/forms/${formId}`, {
    method: "PATCH",
    body: { status: "published" },
    jar: alpha.jar,
  });
  check(
    "A form with no fields cannot be published",
    emptyPublish.status === 409,
    `got ${emptyPublish.status}`,
  );

  const v1Fields = [
    {
      label: "How long has this been a concern?",
      fieldName: "duration",
      type: "text",
      required: true,
      options: [],
      validation: { maxLength: 100 },
      placeholder: "e.g. 6 months",
      helpText: "",
      defaultValue: null,
      conditionalLogic: null,
    },
    {
      label: "Family history of hair loss?",
      fieldName: "family_history",
      type: "select",
      required: true,
      options: [
        { label: "Yes", value: "yes" },
        { label: "No", value: "no" },
        { label: "Unsure", value: "unsure" },
      ],
      validation: {},
      placeholder: "",
      helpText: "",
      defaultValue: null,
      conditionalLogic: null,
    },
    {
      label: "Which relatives?",
      fieldName: "relatives",
      type: "multi_select",
      required: true,
      options: [
        { label: "Mother", value: "mother" },
        { label: "Father", value: "father" },
        { label: "Sibling", value: "sibling" },
      ],
      validation: {},
      placeholder: "",
      helpText: "",
      defaultValue: null,
      // Only asked when the previous answer was "yes".
      conditionalLogic: { fieldName: "family_history", operator: "equals", value: "yes" },
    },
    {
      label: "Age at onset",
      fieldName: "onset_age",
      type: "number",
      required: false,
      options: [],
      validation: { min: 0, max: 120 },
      placeholder: "",
      helpText: "",
      defaultValue: null,
      conditionalLogic: null,
    },
  ];

  const savedV1 = await call(`/api/forms/${formId}/fields`, {
    method: "PUT",
    body: { fields: v1Fields },
    jar: alpha.jar,
  });
  check("Fields saved", savedV1.status === 200, `got ${savedV1.status} ${JSON.stringify(savedV1.json?.error ?? "")}`);
  check(
    "No new version created while the form has no responses",
    savedV1.json.data.newVersion === null &&
      savedV1.json.data.form.currentVersion === 1,
    `version ${savedV1.json?.data?.form?.currentVersion}`,
  );
  check("All four fields stored", savedV1.json.data.form.fields.length === 4);
  check(
    "Field order follows the submitted array",
    savedV1.json.data.form.fields.map((f: any) => f.fieldName).join(",") ===
      "duration,family_history,relatives,onset_age",
    savedV1.json.data.form.fields.map((f: any) => f.fieldName).join(","),
  );

  // Editing again while still unused must stay on version 1.
  const editedAgain = await call(`/api/forms/${formId}/fields`, {
    method: "PUT",
    body: { fields: v1Fields },
    jar: alpha.jar,
  });
  check(
    "Repeated edits before any response stay on version 1",
    editedAgain.json.data.form.currentVersion === 1,
    `version ${editedAgain.json?.data?.form?.currentVersion}`,
  );

  // -------------------------------------------------------------------------
  section("Field definition validation");
  const noOptions = await call(`/api/forms/${formId}/fields`, {
    method: "PUT",
    body: {
      fields: [
        {
          label: "Broken",
          fieldName: "broken",
          type: "select",
          required: false,
          options: [],
          validation: {},
          placeholder: "",
          helpText: "",
          defaultValue: null,
          conditionalLogic: null,
        },
      ],
    },
    jar: alpha.jar,
  });
  check(
    "A choice field with no options is rejected",
    noOptions.status === 422,
    `got ${noOptions.status}`,
  );

  const duplicateNames = await call(`/api/forms/${formId}/fields`, {
    method: "PUT",
    body: {
      fields: [v1Fields[0], { ...v1Fields[0]!, label: "Duplicate" }],
    },
    jar: alpha.jar,
  });
  check(
    "Duplicate field names are rejected",
    duplicateNames.status === 422,
    `got ${duplicateNames.status}`,
  );

  const danglingCondition = await call(`/api/forms/${formId}/fields`, {
    method: "PUT",
    body: {
      fields: [
        {
          ...v1Fields[0]!,
          conditionalLogic: {
            fieldName: "does_not_exist",
            operator: "equals",
            value: "x",
          },
        },
      ],
    },
    jar: alpha.jar,
  });
  check(
    "A condition referencing a missing field is rejected",
    danglingCondition.status === 422,
    `got ${danglingCondition.status}`,
  );

  const selfCondition = await call(`/api/forms/${formId}/fields`, {
    method: "PUT",
    body: {
      fields: [
        {
          ...v1Fields[0]!,
          conditionalLogic: {
            fieldName: v1Fields[0]!.fieldName,
            operator: "equals",
            value: "x",
          },
        },
      ],
    },
    jar: alpha.jar,
  });
  check(
    "A field depending on itself is rejected",
    selfCondition.status === 422,
    `got ${selfCondition.status}`,
  );

  const badFieldName = await call(`/api/forms/${formId}/fields`, {
    method: "PUT",
    body: {
      fields: [{ ...v1Fields[0]!, fieldName: "Has Spaces" }],
    },
    jar: alpha.jar,
  });
  check(
    "An invalid machine field name is rejected",
    badFieldName.status === 422,
    `got ${badFieldName.status}`,
  );

  // Restore the good definition after the rejection tests.
  await call(`/api/forms/${formId}/fields`, {
    method: "PUT",
    body: { fields: v1Fields },
    jar: alpha.jar,
  });

  // -------------------------------------------------------------------------
  section("Submission gating");
  const draftSubmit = await call(`/api/forms/${formId}/responses`, {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      responses: { duration: "6 months", family_history: "no" },
    },
    jar: alpha.jar,
  });
  check(
    "A draft form cannot receive responses",
    draftSubmit.status === 409,
    `got ${draftSubmit.status}`,
  );

  const published = await call(`/api/forms/${formId}`, {
    method: "PATCH",
    body: { status: "published" },
    jar: alpha.jar,
  });
  check("Form published", published.status === 200, `got ${published.status}`);

  // -------------------------------------------------------------------------
  section("Dynamic response validation (Section 24)");
  const missingRequired = await call(`/api/forms/${formId}/responses`, {
    method: "POST",
    body: { patientId: alpha.patientId, responses: { duration: "6 months" } },
    jar: alpha.jar,
  });
  check(
    "A missing required answer is rejected",
    missingRequired.status === 422,
    `got ${missingRequired.status}`,
  );
  check(
    "The error names the offending field",
    Boolean(missingRequired.json?.error?.details?.fields?.family_history),
    JSON.stringify(missingRequired.json?.error?.details),
  );

  const badOption = await call(`/api/forms/${formId}/responses`, {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      responses: { duration: "6 months", family_history: "maybe" },
    },
    jar: alpha.jar,
  });
  check(
    "A value outside the option list is rejected",
    badOption.status === 422,
    `got ${badOption.status}`,
  );

  const badNumber = await call(`/api/forms/${formId}/responses`, {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      responses: {
        duration: "6 months",
        family_history: "no",
        onset_age: 500,
      },
    },
    jar: alpha.jar,
  });
  check(
    "A number outside its configured range is rejected",
    badNumber.status === 422,
    `got ${badNumber.status}`,
  );

  const tooLong = await call(`/api/forms/${formId}/responses`, {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      responses: { duration: "x".repeat(200), family_history: "no" },
    },
    jar: alpha.jar,
  });
  check(
    "Text exceeding its maxLength is rejected",
    tooLong.status === 422,
    `got ${tooLong.status}`,
  );

  /**
   * The conditional field is required, but hidden when family_history is "no".
   * A hidden field must not block submission.
   */
  const hiddenNotRequired = await call(`/api/forms/${formId}/responses`, {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      responses: { duration: "6 months", family_history: "no" },
    },
    jar: alpha.jar,
  });
  check(
    "A required field hidden by its condition does not block submission",
    hiddenNotRequired.status === 201,
    `got ${hiddenNotRequired.status} ${JSON.stringify(hiddenNotRequired.json?.error?.details ?? "")}`,
  );
  const firstResponseId = hiddenNotRequired.json.data.id as string;
  check(
    "Response pinned to version 1",
    hiddenNotRequired.json.data.formVersion === 1,
    `v${hiddenNotRequired.json?.data?.formVersion}`,
  );

  // …but when the condition IS met, the field becomes required.
  const visibleRequired = await call(`/api/forms/${formId}/responses`, {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      responses: { duration: "1 year", family_history: "yes" },
    },
    jar: alpha.jar,
  });
  check(
    "The same field IS required once its condition is met",
    visibleRequired.status === 422,
    `got ${visibleRequired.status}`,
  );

  const withMulti = await call(`/api/forms/${formId}/responses`, {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      responses: {
        duration: "1 year",
        family_history: "yes",
        relatives: ["mother", "sibling"],
        onset_age: 32,
      },
    },
    jar: alpha.jar,
  });
  check(
    "A complete conditional submission is accepted",
    withMulti.status === 201,
    `got ${withMulti.status} ${JSON.stringify(withMulti.json?.error?.details ?? "")}`,
  );
  check(
    "Multi-select values stored as an array",
    Array.isArray(withMulti.json.data.responses.relatives) &&
      withMulti.json.data.responses.relatives.length === 2,
    JSON.stringify(withMulti.json?.data?.responses?.relatives),
  );

  const unknownKeys = await call(`/api/forms/${formId}/responses`, {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      responses: {
        duration: "2 years",
        family_history: "no",
        // Not a field of this form.
        smuggled_field: "should not be stored",
        __proto__: "nope",
      },
    },
    jar: alpha.jar,
  });
  check(
    "Undeclared keys are dropped rather than stored",
    unknownKeys.status === 201 &&
      !("smuggled_field" in unknownKeys.json.data.responses),
    JSON.stringify(unknownKeys.json?.data?.responses),
  );

  // -------------------------------------------------------------------------
  section("Versioning (Section 25) — THE core requirement");
  const beforeEdit = await call(`/api/form-responses/${firstResponseId}`, {
    jar: alpha.jar,
  });
  const originalAnswers = JSON.stringify(beforeEdit.json.data.responses);
  const originalLabel = beforeEdit.json.data.fields.find(
    (f: any) => f.fieldName === "duration",
  ).label;

  check(
    "Response reads back on version 1",
    beforeEdit.json.data.formVersion === 1,
  );
  check(
    "Response is not flagged historical while v1 is current",
    beforeEdit.json.data.isHistoricalVersion === false,
  );

  const formNow = await call(`/api/forms/${formId}`, { jar: alpha.jar });
  check(
    "Form warns that the next edit will fork a version",
    formNow.json.data.editWillCreateVersion === true,
  );

  // Now edit the published form: rename a field, drop one, add another.
  const v2Fields = [
    {
      ...v1Fields[0]!,
      label: "Duration of concern (updated wording)",
    },
    v1Fields[1]!,
    {
      label: "Previous treatments tried",
      fieldName: "previous_treatments",
      type: "textarea",
      required: false,
      options: [],
      validation: {},
      placeholder: "",
      helpText: "",
      defaultValue: null,
      conditionalLogic: null,
    },
  ];

  const savedV2 = await call(`/api/forms/${formId}/fields`, {
    method: "PUT",
    body: { fields: v2Fields },
    jar: alpha.jar,
  });
  check("Edit accepted", savedV2.status === 200, `got ${savedV2.status}`);
  check(
    "Editing a form WITH responses creates version 2",
    savedV2.json.data.newVersion === 2 &&
      savedV2.json.data.form.currentVersion === 2,
    `newVersion ${savedV2.json?.data?.newVersion}`,
  );

  // The heart of it: the old response must be completely untouched.
  const afterEdit = await call(`/api/form-responses/${firstResponseId}`, {
    jar: alpha.jar,
  });
  check(
    "The historical response is still on version 1",
    afterEdit.json.data.formVersion === 1,
    `v${afterEdit.json?.data?.formVersion}`,
  );
  check(
    "Its stored answers are byte-for-byte unchanged",
    JSON.stringify(afterEdit.json.data.responses) === originalAnswers,
    afterEdit.json?.data?.responses ? JSON.stringify(afterEdit.json.data.responses) : "",
  );
  check(
    "It still renders with the ORIGINAL field label, not the new one",
    afterEdit.json.data.fields.find((f: any) => f.fieldName === "duration")
      .label === originalLabel,
    afterEdit.json.data.fields.find((f: any) => f.fieldName === "duration")?.label,
  );
  check(
    "It still has version 1's four fields, not version 2's three",
    afterEdit.json.data.fields.length === 4,
    `${afterEdit.json?.data?.fields?.length} fields`,
  );
  check(
    "The removed field is still present in the historical definition",
    afterEdit.json.data.fields.some((f: any) => f.fieldName === "onset_age"),
  );
  check(
    "The newly added field is absent from the historical definition",
    !afterEdit.json.data.fields.some(
      (f: any) => f.fieldName === "previous_treatments",
    ),
  );
  check(
    "It is now flagged as a historical version",
    afterEdit.json.data.isHistoricalVersion === true &&
      afterEdit.json.data.currentVersion === 2,
  );

  // New submissions go against v2 and are validated by v2's rules.
  const v2Submit = await call(`/api/forms/${formId}/responses`, {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      responses: {
        duration: "3 months",
        family_history: "no",
        previous_treatments: "Topical minoxidil",
      },
    },
    jar: alpha.jar,
  });
  check(
    "New submissions are recorded against version 2",
    v2Submit.status === 201 && v2Submit.json.data.formVersion === 2,
    `v${v2Submit.json?.data?.formVersion}`,
  );
  check(
    "A field only in v2 is accepted",
    v2Submit.json.data.responses.previous_treatments === "Topical minoxidil",
  );

  const v2WithDroppedField = await call(`/api/forms/${formId}/responses`, {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      responses: {
        duration: "3 months",
        family_history: "no",
        // Removed in v2 — must be dropped, not stored.
        onset_age: 40,
      },
    },
    jar: alpha.jar,
  });
  check(
    "A field removed in v2 is no longer accepted into new responses",
    v2WithDroppedField.status === 201 &&
      !("onset_age" in v2WithDroppedField.json.data.responses),
    JSON.stringify(v2WithDroppedField.json?.data?.responses),
  );

  const listedVersions = await call(
    `/api/forms/${formId}/responses?pageSize=100`,
    { jar: alpha.jar },
  );
  const versions = new Set(
    (listedVersions.json.data.items as any[]).map((r) => r.formVersion),
  );
  check(
    "Responses from both versions coexist",
    versions.has(1) && versions.has(2),
    [...versions].join(","),
  );

  // -------------------------------------------------------------------------
  section("Cross-tenant isolation");
  const crossForm = await call(`/api/forms/${formId}`, { jar: beta.jar });
  check(
    "Hospital B cannot read a Hospital A form",
    crossForm.status === 404,
    `got ${crossForm.status}`,
  );

  const crossFields = await call(`/api/forms/${formId}/fields`, {
    method: "PUT",
    body: { fields: v1Fields },
    jar: beta.jar,
  });
  check(
    "Hospital B cannot edit a Hospital A form's fields",
    crossFields.status === 404,
    `got ${crossFields.status}`,
  );

  const crossResponses = await call(`/api/forms/${formId}/responses`, {
    jar: beta.jar,
  });
  check(
    "Hospital B cannot read a Hospital A form's responses",
    crossResponses.status === 404,
    `got ${crossResponses.status}`,
  );

  const crossResponseDetail = await call(
    `/api/form-responses/${firstResponseId}`,
    { jar: beta.jar },
  );
  check(
    "Hospital B cannot read an individual Hospital A response",
    crossResponseDetail.status === 404,
    `got ${crossResponseDetail.status}`,
  );

  const crossPatient = await call(`/api/forms/${formId}/responses`, {
    method: "POST",
    body: {
      // Hospital B's patient against Hospital A's form.
      patientId: beta.patientId,
      responses: { duration: "x", family_history: "no" },
    },
    jar: alpha.jar,
  });
  check(
    "A patient from another hospital cannot be attached to a response",
    crossPatient.status === 404,
    `got ${crossPatient.status}`,
  );

  const betaFormList = await call("/api/forms?pageSize=100", { jar: beta.jar });
  check(
    "Hospital B's form list excludes Hospital A's forms",
    !(betaFormList.json.data.items as any[]).some((f) => f.id === formId),
  );

  // -------------------------------------------------------------------------
  section("Referential guards");
  const deleteWithResponses = await call(`/api/forms/${formId}`, {
    method: "DELETE",
    jar: alpha.jar,
  });
  check(
    "A form with responses cannot be deleted",
    deleteWithResponses.status === 409,
    `got ${deleteWithResponses.status}`,
  );

  const archived = await call(`/api/forms/${formId}`, {
    method: "PATCH",
    body: { status: "archived" },
    jar: alpha.jar,
  });
  check("Form can be archived instead", archived.status === 200);

  const archivedSubmit = await call(`/api/forms/${formId}/responses`, {
    method: "POST",
    body: {
      patientId: alpha.patientId,
      responses: { duration: "x", family_history: "no" },
    },
    jar: alpha.jar,
  });
  check(
    "An archived form cannot receive responses",
    archivedSubmit.status === 409,
    `got ${archivedSubmit.status}`,
  );

  const archivedEdit = await call(`/api/forms/${formId}/fields`, {
    method: "PUT",
    body: { fields: v2Fields },
    jar: alpha.jar,
  });
  check(
    "An archived form cannot be edited",
    archivedEdit.status === 409,
    `got ${archivedEdit.status}`,
  );

  const historyStillReadable = await call(
    `/api/form-responses/${firstResponseId}`,
    { jar: alpha.jar },
  );
  check(
    "Archived forms keep their response history readable",
    historyStillReadable.status === 200 &&
      historyStillReadable.json.data.fields.length === 4,
    `got ${historyStillReadable.status}`,
  );

  const unusedForm = await call("/api/forms", {
    method: "POST",
    body: { name: `Unused Form ${stamp}` },
    jar: alpha.jar,
  });
  const deleteUnused = await call(`/api/forms/${unusedForm.json.data.id}`, {
    method: "DELETE",
    jar: alpha.jar,
  });
  check(
    "A form with no responses can be deleted",
    deleteUnused.status === 200,
    `got ${deleteUnused.status}`,
  );

  // -------------------------------------------------------------------------
  section("RBAC on forms");
  const roles = await call("/api/roles?pageSize=100", { jar: alpha.jar });
  const doctorRoleId = (roles.json.data.items as any[]).find(
    (r) => r.key === "doctor",
  ).id as string;
  const receptionistRoleId = (roles.json.data.items as any[]).find(
    (r) => r.key === "receptionist",
  ).id as string;

  async function staffSession(label: string, roleId: string): Promise<Jar> {
    const email = `${label}.${stamp}@forms.test`;
    const created = await call("/api/users", {
      method: "POST",
      body: { name: label, email, roleId },
      jar: alpha.jar,
    });
    const temp = created.json.data.temporaryPassword as string;
    const password = `Forms${label}!2024`;
    const jar = await signIn(email, temp);
    await call("/api/auth/change-password", {
      method: "POST",
      body: { currentPassword: temp, newPassword: password, confirmPassword: password },
      jar,
    });
    return jar;
  }

  const doctorJar = await staffSession("doctor", doctorRoleId);
  const receptionJar = await staffSession("reception", receptionistRoleId);

  // A live form for the RBAC checks, since the original is archived.
  const liveForm = await call("/api/forms", {
    method: "POST",
    body: { name: `Live Form ${stamp}` },
    jar: alpha.jar,
  });
  const liveFormId = liveForm.json.data.id as string;
  await call(`/api/forms/${liveFormId}/fields`, {
    method: "PUT",
    body: {
      fields: [
        {
          label: "Notes",
          fieldName: "notes",
          type: "text",
          required: false,
          options: [],
          validation: {},
          placeholder: "",
          helpText: "",
          defaultValue: null,
          conditionalLogic: null,
        },
      ],
    },
    jar: alpha.jar,
  });
  await call(`/api/forms/${liveFormId}`, {
    method: "PATCH",
    body: { status: "published" },
    jar: alpha.jar,
  });

  const doctorViews = await call("/api/forms", { jar: doctorJar });
  check(
    "Doctor CAN view forms",
    doctorViews.status === 200,
    `got ${doctorViews.status}`,
  );

  const doctorSubmits = await call(`/api/forms/${liveFormId}/responses`, {
    method: "POST",
    body: { patientId: alpha.patientId, responses: { notes: "Seen today" } },
    jar: doctorJar,
  });
  check(
    "Doctor CAN submit responses (has form.submit)",
    doctorSubmits.status === 201,
    `got ${doctorSubmits.status}`,
  );

  const doctorEdits = await call(`/api/forms/${liveFormId}/fields`, {
    method: "PUT",
    body: { fields: [] },
    jar: doctorJar,
  });
  check(
    "Doctor CANNOT redesign a form (lacks form.update)",
    doctorEdits.status === 403,
    `got ${doctorEdits.status}`,
  );

  const doctorCreates = await call("/api/forms", {
    method: "POST",
    body: { name: `Doctor Form ${stamp}` },
    jar: doctorJar,
  });
  check(
    "Doctor CANNOT create forms (lacks form.create)",
    doctorCreates.status === 403,
    `got ${doctorCreates.status}`,
  );

  const receptionSubmits = await call(`/api/forms/${liveFormId}/responses`, {
    method: "POST",
    body: { patientId: alpha.patientId, responses: { notes: "x" } },
    jar: receptionJar,
  });
  check(
    "Receptionist CANNOT submit forms (lacks form.submit)",
    receptionSubmits.status === 403,
    `got ${receptionSubmits.status}`,
  );

  const superAdminForms = await call("/api/forms", { jar: superJar });
  check(
    "Super Admin cannot read a hospital's forms (Section 3)",
    superAdminForms.status === 403,
    `got ${superAdminForms.status}`,
  );

  // -------------------------------------------------------------------------
  console.log(`\n${"=".repeat(52)}`);
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log("=".repeat(52));
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("Test run crashed:", error);
  process.exitCode = 1;
});
