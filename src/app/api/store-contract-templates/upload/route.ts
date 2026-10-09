import { NextResponse } from "next/server";
import {
  buildStoreContractTemplateErrorResponse,
  StoreContractTemplateAccessError,
  uploadStoreContractTemplateVersionForAuthorizedStoreScope,
} from "@/lib/server/store-contract-templates/template-management";
import {
  resolveStoreApiAccess,
  type StoreApiAccessDenied,
  type StoreApiAccessResult,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type StoreContractTemplateUploadPostDeps = {
  resolveAccess: (args: {
    requirement: "active_or_onboarding";
  }) => Promise<StoreApiAccessResult>;
  uploadTemplate: typeof uploadStoreContractTemplateVersionForAuthorizedStoreScope;
};

export function createStoreContractTemplateUploadPostHandler(
  deps: Partial<StoreContractTemplateUploadPostDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const uploadTemplate =
    deps.uploadTemplate ?? uploadStoreContractTemplateVersionForAuthorizedStoreScope;

  return async function POST(request: Request) {
    try {
      const access = await resolveAccess({
        requirement: "active_or_onboarding",
      });

      if (!access.ok) {
        return createStoreApiDeniedResponse(access as StoreApiAccessDenied);
      }

      const formData = await request.formData();
    const storeId = String(formData.get("storeId") || "").trim();
    const organizationId = String(formData.get("organizationId") || "").trim();
    const fileEntry = formData.get("file");

    if (!(fileEntry instanceof File)) {
      return NextResponse.json(
        {
          ok: false,
          error: "FILE_REQUIRED",
          message: "Selecione um arquivo valido do contrato base.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store",
          },
        }
      );
    }

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

      const result = await uploadTemplate(
        {
          organizationId: access.organizationId,
          storeId: access.storeId,
          sessionUserId: access.sessionUserId,
        },
        fileEntry,
      );

      return NextResponse.json(
        {
          ok: true,
          store: result.store,
          template: result.template,
          activeVersion: result.activeVersion,
          versions: result.versions,
          extractedRules: result.extractedRules,
          uploadedVersion: result.uploadedVersion,
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

export const POST = createStoreContractTemplateUploadPostHandler();
