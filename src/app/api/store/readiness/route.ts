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
  resolveStoreReadiness,
  type StoreReadinessResult,
} from "@/lib/server/store-readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StoreReadinessRouteDeps = {
  resolveAccess: (params: {
    requirement: "active_or_onboarding";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  createPrivilegedClient: () => ReturnType<typeof createClient>;
  resolveReadiness: (args: {
    supabase: unknown;
    organizationId: string;
    storeId: string;
  }) => Promise<StoreReadinessResult>;
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

export function createStoreReadinessGetHandler(
  deps: Partial<StoreReadinessRouteDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const createClientWithPrivileges =
    deps.createPrivilegedClient ?? createPrivilegedClient;
  const resolveReadiness =
    deps.resolveReadiness ??
    ((args: {
      supabase: unknown;
      organizationId: string;
      storeId: string;
    }) =>
      resolveStoreReadiness({
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

      const readiness = await resolveReadiness({
        supabase: privilegedClient,
        organizationId: access.organizationId,
        storeId: access.storeId,
      });

      return buildJsonResponse({
        ok: true,
        organization_id: access.organizationId,
        store_id: access.storeId,
        capabilities: readiness.capabilities,
        capabilities_by_key: readiness.capabilitiesByKey,
      });
    } catch (error: unknown) {
      const value = error as {
        message?: string | null;
        code?: string | null;
        details?: string | null;
        hint?: string | null;
      } | null;

      console.error("[api/store/readiness] error:", {
        message: value?.message ?? null,
        code: value?.code ?? null,
        details: value?.details ?? null,
        hint: value?.hint ?? null,
      });

      return buildJsonResponse(
        {
          ok: false,
          error: "STORE_READINESS_RESOLUTION_FAILED",
          message: "Nao foi possivel carregar o readiness da loja.",
        },
        500,
      );
    }
  };
}

export const GET = createStoreReadinessGetHandler();
