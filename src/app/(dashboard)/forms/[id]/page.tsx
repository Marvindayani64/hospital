import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasPermission } from "@/lib/rbac/guard";
import { guardHospitalPage } from "@/lib/rbac/page-guard";
import { AccessDenied } from "@/components/layout/AccessDenied";
import { ApiError } from "@/lib/api/errors";
import { getForm } from "@/services/form.service";
import { FormBuilder } from "@/app/(dashboard)/forms/[id]/FormBuilder";

export const metadata: Metadata = { title: "Form builder" };
export const dynamic = "force-dynamic";

/**
 * The builder lives at `/forms/[id]` rather than the spec's `/forms/builder`.
 *
 * A builder is always editing one specific form, so the id belongs in the path:
 * the page is linkable, refresh-safe and back-button-safe, none of which holds
 * for a single builder route carrying the id in a query string or in state.
 */
export default async function FormBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { allowed, user } = await guardHospitalPage("form.view");

  if (!allowed) {
    return <AccessDenied permission="form.view" what="forms" />;
  }

  const { id } = await params;

  let form;
  try {
    form = await getForm(id, user.hospitalId);
  } catch (error) {
    // Cross-tenant and missing ids are indistinguishable to the caller.
    if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <FormBuilder
      form={form}
      canUpdate={hasPermission(user, "form.update")}
      canSubmit={hasPermission(user, "form.submit")}
      canViewPatients={hasPermission(user, "patient.view")}
    />
  );
}
