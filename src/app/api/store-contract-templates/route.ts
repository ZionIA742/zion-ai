import {
  buildStoreContractTemplateErrorResponse,
  StoreContractTemplateAccessError,
  listStoreContractTemplateForAuthorizedStoreScope,
} from "@/lib/server/store-contract-templates/template-management";
import {
  resolveStoreApiAccess,
  type StoreApiAccessDenied,
  type StoreApiAccessResult,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StoreContractTemplatesGetDeps = {
  resolveAccess: (args: {
    requirement: "active_or_onboarding";
  }) => Promise<StoreApiAccessResult>;
  listTemplate: typeof listStoreContractTemplateForAuthorizedStoreScope;
};

export function createStoreContractTemplatesGetHandler(
  deps: Partial<StoreContractTemplatesGetDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const listTemplate =
    deps.listTemplate ?? listStoreContractTemplateForAuthorizedStoreScope;

  return async function GET(request: Request) {
    try {
      const access = await resolveAccess({
        requirement: "active_or_onboarding",
      });

      if (!access.ok) {
        return createStoreApiDeniedResponse(access as StoreApiAccessDenied);
      }

      const url = new URL(request.url);
      const storeId = String(url.searchParams.get("storeId") || "").trim();
      const organizationId = String(url.searchParams.get("organizationId") || "").trim();

      if (!storeId) {
        throw new StoreContractTemplateAccessError(
          400,
          "INVALID_STORE_ID",
          "Store ID nao informado.",
        );
      }

      if (storeId !== access.storeId) {
        return Response.json(
          {
            ok: false,
            error: "STORE_FORBIDDEN",
            message: "Loja nao encontrada ou fora do escopo do usuario.",
          },
          { status: 403, headers: { "Cache-Control": "no-store" } },
        );
      }

      if (organizationId && organizationId !== access.organizationId) {
        return Response.json(
          {
            ok: false,
            error: "ORGANIZATION_STORE_MISMATCH",
            message: "A organizacao informada nao corresponde a loja selecionada.",
          },
          { status: 403, headers: { "Cache-Control": "no-store" } },
        );
      }

      const result = await listTemplate({
        organizationId: access.organizationId,
        storeId: access.storeId,
        sessionUserId: access.sessionUserId,
      });

      return Response.json(
        {
          ok: true,
          store: result.store,
          template: result.template,
          activeVersion: result.activeVersion,
          versions: result.versions,
          extractedRules: result.extractedRules,
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

export const GET = createStoreContractTemplatesGetHandler();
