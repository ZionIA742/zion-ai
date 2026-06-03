import { NextResponse } from "next/server";
import {
  buildStoreContractTemplateErrorResponse,
  reviewStoreContractTemplateRule,
} from "@/lib/server/store-contract-templates/template-management";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ ruleId: string }> }
) {
  try {
    const body = (await request.json().catch(() => null)) as
      | {
          storeId?: string | null;
          organizationId?: string | null;
          reviewStatus?: "approved" | "rejected" | "edited" | null;
          valueText?: string | null;
          label?: string | null;
        }
      | null;
    const { ruleId: rawRuleId } = await context.params;

    const result = await reviewStoreContractTemplateRule({
      ruleId: String(rawRuleId || "").trim(),
      storeId: String(body?.storeId || "").trim(),
      organizationId: String(body?.organizationId || "").trim() || null,
      reviewStatus: (String(body?.reviewStatus || "").trim() || "edited") as
        | "approved"
        | "rejected"
        | "edited",
      valueText: String(body?.valueText || "").trim() || null,
      label: String(body?.label || "").trim() || null,
    });

    return NextResponse.json(
      {
        ok: true,
        store: result.store,
        template: result.template,
        activeVersion: result.activeVersion,
        versions: result.versions,
        extractedRules: result.extractedRules,
        reviewedRule: result.reviewedRule,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    return buildStoreContractTemplateErrorResponse(error);
  }
}
