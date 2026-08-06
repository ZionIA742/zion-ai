import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

type StoreRow = {
  id: string;
  organization_id: string;
  name: string | null;
};

type RequestBody = {
  name?: unknown;
};

type UpdateStoreNameRouteDeps = {
  resolveAccess: (params: {
    requirement: "active";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  createPrivilegedClient: () => ReturnType<typeof createClient>;
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

export function createUpdateStoreNamePostHandler(
  deps: Partial<UpdateStoreNameRouteDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const createClientWithPrivileges =
    deps.createPrivilegedClient ?? createPrivilegedClient;

  return async function POST(request: Request) {
    try {
      const access = await resolveAccess({
        requirement: "active",
      });

      if (!access.ok) {
        return createStoreApiDeniedResponse(access);
      }

      const body = (await request.json().catch(() => null)) as RequestBody | null;
      const name = String(body?.name || "").trim();

      if (!name) {
        return NextResponse.json(
          { ok: false, error: "INVALID_NAME", message: "Nome da loja nao pode ficar vazio." },
          { status: 400 },
        );
      }

      const privilegedClient = createClientWithPrivileges();

      const { data: updatedStore, error: updateError } = await privilegedClient
        .from("stores")
        .update({ name })
        .eq("id", access.storeId)
        .eq("organization_id", access.organizationId)
        .select("id, organization_id, name")
        .maybeSingle<StoreRow>();

      if (updateError) {
        throw updateError;
      }

      if (!updatedStore) {
        throw new Error("Falha ao atualizar o nome oficial da loja.");
      }

      return NextResponse.json({
        ok: true,
        storeId: updatedStore.id,
        organizationId: updatedStore.organization_id,
        name: updatedStore.name,
      });
    } catch (error: any) {
      console.error("[api/store/update-name] error:", {
        message: error?.message ?? null,
        code: error?.code ?? null,
        details: error?.details ?? null,
        hint: error?.hint ?? null,
      });

      return NextResponse.json(
        {
          ok: false,
          error: "UPDATE_STORE_NAME_FAILED",
          message: "Nao foi possivel atualizar o nome oficial da loja.",
        },
        { status: 500 },
      );
    }
  };
}

export const POST = createUpdateStoreNamePostHandler();
