import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";
import {
  loadCanonicalActivePrimaryStoreResponsible,
  type LoadCanonicalStoreResponsibleResult,
} from "@/lib/server/store-responsibles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PrimaryResponsibleRouteDeps = {
  resolveAccess: (params: {
    requirement: "active_or_onboarding";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  createPrivilegedClient: () => ReturnType<typeof createClient>;
  loadResponsible: (args: {
    supabase: unknown;
    organizationId: string;
    storeId: string;
  }) => Promise<LoadCanonicalStoreResponsibleResult>;
};

function createPrivilegedClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase service role nao configurada.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function buildJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export function createStorePrimaryResponsibleGetHandler(
  deps: Partial<PrimaryResponsibleRouteDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const createClientWithPrivileges =
    deps.createPrivilegedClient ?? createPrivilegedClient;
  const loadResponsible =
    deps.loadResponsible ??
    ((args: { supabase: unknown; organizationId: string; storeId: string }) =>
      loadCanonicalActivePrimaryStoreResponsible({
        supabase: args.supabase as never,
        organizationId: args.organizationId,
        storeId: args.storeId,
      }));

  return async function GET(_request: Request) {
    try {
      const access = await resolveAccess({
        requirement: "active_or_onboarding",
      });

      if (!access.ok) {
        return createStoreApiDeniedResponse(access);
      }

      const privilegedClient = createClientWithPrivileges();
      const responsibleResult = await loadResponsible({
        supabase: privilegedClient,
        organizationId: access.organizationId,
        storeId: access.storeId,
      });

      if (
        !responsibleResult.ok &&
        responsibleResult.reason === "responsible_primary_not_configured"
      ) {
        return buildJsonResponse({
          ok: true,
          responsible: null,
        });
      }

      if (!responsibleResult.ok) {
        return buildJsonResponse(
          {
            ok: false,
            error: "STORE_PRIMARY_RESPONSIBLE_INVALID_STATE",
            message: "Responsavel principal canonico da loja esta inconsistente.",
          },
          500,
        );
      }

      return buildJsonResponse({
        ok: true,
        responsible: responsibleResult.responsible,
      });
    } catch (error: unknown) {
      const value = error as {
        message?: string | null;
        code?: string | null;
        details?: string | null;
        hint?: string | null;
      } | null;

      console.error("[api/store/primary-responsible] error:", {
        message: value?.message ?? null,
        code: value?.code ?? null,
        details: value?.details ?? null,
        hint: value?.hint ?? null,
      });

      return buildJsonResponse(
        {
          ok: false,
          error: "STORE_PRIMARY_RESPONSIBLE_LOAD_FAILED",
          message: "Nao foi possivel carregar o responsavel principal da loja.",
        },
        500,
      );
    }
  };
}

export const GET = createStorePrimaryResponsibleGetHandler();
