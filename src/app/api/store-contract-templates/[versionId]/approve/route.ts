import { NextResponse } from "next/server";
import {
  StoreContractTemplateAccessError,
  buildStoreContractTemplateErrorResponse,
  approveStoreContractTemplateVersionForAuthorizedStoreScope,
} from "@/lib/server/store-contract-templates/template-management";
import {
  resolveStoreApiAccess,
  type StoreApiAccessDenied,
  type StoreApiAccessResult,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type StoreContractTemplateApprovePostDeps = {
  resolveAccess: (args: {
    requirement: "active_or_onboarding";
  }) => Promise<StoreApiAccessResult>;
  approveTemplate: typeof approveStoreContractTemplateVersionForAuthorizedStoreScope;
};

export function createStoreContractTemplateApprovePostHandler(
  deps: Partial<StoreContractTemplateApprovePostDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const approveTemplate =
    deps.approveTemplate ?? approveStoreContractTemplateVersionForAuthorizedStoreScope;

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
          }
        | null;
      const { versionId: rawVersionId } = await context.params;
      const versionId = String(rawVersionId || "").trim();
      const storeId = String(body?.storeId || "").trim();
      const organizationId = String(body?.organizationId || "").trim();

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

      const result = await approveTemplate(
        {
          organizationId: access.organizationId,
          storeId: access.storeId,
          sessionUserId: access.sessionUserId,
        },
        versionId,
      );

      return NextResponse.json(
        {
          ok: true,
          store: result.store,
          template: result.template,
          activeVersion: result.activeVersion,
          versions: result.versions,
          extractedRules: result.extractedRules,
          approvedVersion: result.approvedVersion,
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

export const POST = createStoreContractTemplateApprovePostHandler();
