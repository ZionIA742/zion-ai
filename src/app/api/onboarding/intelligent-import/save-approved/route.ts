import { NextResponse } from "next/server";
import {
  IntelligentImportSaveAccessError,
  saveApprovedIntelligentImportItems,
} from "@/lib/server/onboarding-intelligent-import-save";
import type { IntelligentImportSaveApprovedRequest } from "@/lib/onboarding-intelligent-import-save-contract";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SaveApprovedRouteDeps = {
  resolveAccess: (params: {
    requirement: "active_or_onboarding";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  saveApproved: typeof saveApprovedIntelligentImportItems;
};

export function createSaveApprovedIntelligentImportPostHandler(
  deps: Partial<SaveApprovedRouteDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const saveApproved = deps.saveApproved ?? saveApprovedIntelligentImportItems;

  return async function POST(request: Request) {
    const access = await resolveAccess({
      requirement: "active_or_onboarding",
    });

    if (!access.ok) {
      return createStoreApiDeniedResponse(access);
    }

    try {
      const body = (await request.json()) as Partial<IntelligentImportSaveApprovedRequest>;
      const payload: IntelligentImportSaveApprovedRequest = {
        context: body.context,
        importedFileIds: Array.isArray(body.importedFileIds) ? body.importedFileIds : [],
        items: Array.isArray(body.items) ? body.items : [],
        organizationId: access.organizationId,
        reviewAudit: body.reviewAudit,
        selectedMediaRefs: Array.isArray(body.selectedMediaRefs) ? body.selectedMediaRefs : [],
        storeId: access.storeId,
        validateOnly: Boolean(body.validateOnly),
      };

      const result = await saveApproved(payload, {
        organizationId: access.organizationId,
        storeId: access.storeId,
      });
      return NextResponse.json(result, {
        status: result.ok ? 200 : payload.validateOnly ? 200 : 409,
      });
    } catch (error) {
      if (error instanceof IntelligentImportSaveAccessError) {
        return NextResponse.json(
          {
            items: [],
            message: error.message,
            ok: false,
            summary: {
              blockedDuplicate: 0,
              invalid: 0,
              saved: 0,
              total: 0,
              valid: 0,
            },
            validateOnly: true,
          },
          { status: error.status },
        );
      }

      const message =
        error instanceof Error
          ? error.message
          : "Erro interno ao salvar itens aprovados da importacao inteligente.";

      return NextResponse.json(
        {
          items: [],
          message,
          ok: false,
          summary: {
            blockedDuplicate: 0,
            invalid: 0,
            saved: 0,
            total: 0,
            valid: 0,
          },
          validateOnly: true,
        },
        { status: 500 },
      );
    }
  };
}

export function createSaveApprovedIntelligentImportGetHandler(
  deps: Partial<Pick<SaveApprovedRouteDeps, "resolveAccess">> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;

  return async function GET() {
    const access = await resolveAccess({
      requirement: "active_or_onboarding",
    });

    if (!access.ok) {
      return createStoreApiDeniedResponse(access);
    }

    return NextResponse.json({
      ok: true,
      route: "onboarding/intelligent-import/save-approved",
      method: "POST",
      message: "Rota de salvamento server-side do Upload Inteligente publicada.",
    });
  };
}

export const POST = createSaveApprovedIntelligentImportPostHandler();
export const GET = createSaveApprovedIntelligentImportGetHandler();
