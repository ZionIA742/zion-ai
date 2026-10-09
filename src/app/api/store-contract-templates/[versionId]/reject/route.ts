import { NextResponse } from "next/server";
import {
  StoreContractTemplateAccessError,
  buildStoreContractTemplateErrorResponse,
  rejectStoreContractTemplateVersionForAuthorizedStoreScope,
} from "@/lib/server/store-contract-templates/template-management";
import {
  resolveStoreApiAccess,
  type StoreApiAccessDenied,
  type StoreApiAccessResult,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type StoreContractTemplateRejectPostDeps = {
  resolveAccess: (args: {
    requirement: "active_or_onboarding";
  }) => Promise<StoreApiAccessResult>;
  rejectTemplate: typeof rejectStoreContractTemplateVersionForAuthorizedStoreScope;
};

export function createStoreContractTemplateRejectPostHandler(
  deps: Partial<StoreContractTemplateRejectPostDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const rejectTemplate =
    deps.rejectTemplate ?? rejectStoreContractTemplateVersionForAuthorizedStoreScope;

  return async function POST(
    request: Request,
    context: { params: Promise<{ versionId: string }> },
  ) {
    try {
      const access = await resolveAccess({
        requirement: "active_or_onboarding",
      });

      if (!access.ok) {
        return createStoreApiDeniedResponse(access as StoreApiAccessDenied);
      }

      const body = (await request.json().catch(() => null)) as
        | {
            storeId?: string | null;
            organizationId?: string | null;
            rejectionReason?: string | null;
          }
        | null;
      const { versionId: rawVersionId } = await context.params;
      const versionId = String(rawVersionId || "").trim();
      const storeId = String(body?.storeId || "").trim();
      const organizationId = String(body?.organizationId || "").trim();
      const rejectionReason = String(body?.rejectionReason || "").trim() || null;

      if (!storeId) {
        throw new StoreContractTemplateAccessError(
          400,
          "INVALID_STORE_ID",
          "Store ID nao informado.",
        );
      }

      if (storeId !== access.storeId) {
        throw new StoreContractTemplateAccessError(
          403,
          "STORE_FORBIDDEN",
          "Loja nao encontrada ou fora do escopo do usuario.",
        );
      }

      if (organizationId && organizationId !== access.organizationId) {
        throw new StoreContractTemplateAccessError(
          403,
          "ORGANIZATION_STORE_MISMATCH",
          "A organizacao informada nao corresponde a loja selecionada.",
        );
      }

      const result = await rejectTemplate(
        {
          organizationId: access.organizationId,
          storeId: access.storeId,
          sessionUserId: access.sessionUserId,
        },
        versionId,
        rejectionReason,
      );

      return NextResponse.json(
        {
          ok: true,
          store: result.store,
          template: result.template,
          activeVersion: result.activeVersion,
          versions: result.versions,
          extractedRules: result.extractedRules,
          rejectedVersion: result.rejectedVersion,
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

export const POST = createStoreContractTemplateRejectPostHandler();
