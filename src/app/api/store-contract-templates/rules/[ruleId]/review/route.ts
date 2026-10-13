import { NextResponse } from "next/server";
import {
  buildStoreContractTemplateErrorResponse,
  reviewStoreContractTemplateRule,
} from "@/lib/server/store-contract-templates/template-management";

type StoreContractTemplateRuleReviewPatchDeps = {
  reviewRule: typeof reviewStoreContractTemplateRule;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function createStoreContractTemplateRuleReviewPatchHandler(
  deps: Partial<StoreContractTemplateRuleReviewPatchDeps> = {},
) {
  const reviewRule = deps.reviewRule ?? reviewStoreContractTemplateRule;

  return async function PATCH(
    request: Request,
    context: { params: Promise<{ ruleId: string }> },
  ) {
    try {
      const body = (await request.json().catch(() => null)) as
        | {
            storeId?: string | null;
            organizationId?: string | null;
            reviewStatus?: "approved" | "rejected" | "edited" | null;
            expectedRevision?: number | null;
            idempotencyKey?: string | null;
            valueText?: string | null;
            label?: string | null;
          }
        | null;
      const { ruleId: rawRuleId } = await context.params;

      const result = await reviewRule({
        ruleId: String(rawRuleId || "").trim(),
        storeId: String(body?.storeId || "").trim(),
        organizationId: String(body?.organizationId || "").trim() || null,
        reviewStatus: (String(body?.reviewStatus || "").trim() || "edited") as
          | "approved"
          | "rejected"
          | "edited",
        expectedRevision: body?.expectedRevision as number,
        idempotencyKey: String(body?.idempotencyKey || "").trim(),
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
          reviewEventId: result.reviewEventId,
          reviewReplayed: result.reviewReplayed,
        },
        {
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    } catch (error) {
      return buildStoreContractTemplateErrorResponse(error);
    }
  };
}

export const PATCH = createStoreContractTemplateRuleReviewPatchHandler();
