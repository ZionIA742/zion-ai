import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { listResponsibleExternalNotifications } from "@/lib/server/assistant/responsible-external-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MembershipRow = {
  organization_id: string;
};

type StoreRow = {
  id: string;
  organization_id: string;
  name: string | null;
};

function buildJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function getServiceSupabaseClient() {
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

async function resolveAuthorizedStoreContext(searchParams: URLSearchParams) {
  const sessionSupabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await sessionSupabase.auth.getUser();

  if (authError || !user) {
    return {
      ok: false as const,
      response: buildJsonResponse(
        {
          ok: false,
          error: "UNAUTHENTICATED",
          message: "Usuario nao autenticado.",
        },
        401
      ),
    };
  }

  const storeId = String(searchParams.get("storeId") || "").trim();
  const requestedOrganizationId = String(searchParams.get("organizationId") || "").trim();

  if (!storeId) {
    return {
      ok: false as const,
      response: buildJsonResponse(
        {
          ok: false,
          error: "INVALID_STORE_ID",
          message: "Store ID nao informado.",
        },
        400
      ),
    };
  }

  if (!requestedOrganizationId) {
    return {
      ok: false as const,
      response: buildJsonResponse(
        {
          ok: false,
          error: "INVALID_ORGANIZATION_ID",
          message: "organizationId nao informado.",
        },
        400
      ),
    };
  }

  const serviceSupabase = getServiceSupabaseClient();
  const { data: memberships, error: membershipError } = await serviceSupabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user.id);

  if (membershipError) {
    throw membershipError;
  }

  const organizationIds = Array.from(
    new Set(
      ((memberships ?? []) as MembershipRow[])
        .map((membership) => String(membership.organization_id || "").trim())
        .filter(Boolean)
    )
  );

  if (organizationIds.length === 0) {
    return {
      ok: false as const,
      response: buildJsonResponse(
        {
          ok: false,
          error: "FORBIDDEN",
          message: "Usuario sem acesso a lojas.",
        },
        403
      ),
    };
  }

  const { data: store, error: storeError } = await serviceSupabase
    .from("stores")
    .select("id, organization_id, name")
    .eq("id", storeId)
    .maybeSingle<StoreRow>();

  if (storeError) {
    throw storeError;
  }

  if (!store) {
    return {
      ok: false as const,
      response: buildJsonResponse(
        {
          ok: false,
          error: "STORE_NOT_FOUND",
          message: "Loja nao encontrada.",
        },
        404
      ),
    };
  }

  if (!organizationIds.includes(store.organization_id)) {
    return {
      ok: false as const,
      response: buildJsonResponse(
        {
          ok: false,
          error: "FORBIDDEN",
          message: "Voce nao pode acessar esta loja.",
        },
        403
      ),
    };
  }

  if (requestedOrganizationId !== store.organization_id) {
    return {
      ok: false as const,
      response: buildJsonResponse(
        {
          ok: false,
          error: "ORGANIZATION_STORE_MISMATCH",
          message: "organizationId nao corresponde a loja informada.",
        },
        400
      ),
    };
  }

  return {
    ok: true as const,
    store,
  };
}

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const auth = await resolveAuthorizedStoreContext(searchParams);

    if (!auth.ok) {
      return auth.response;
    }

    const organizationId = auth.store.organization_id;
    const storeId = auth.store.id;
    const status = String(searchParams.get("status") || "").trim();
    const limit = Math.min(Math.max(Number(searchParams.get("limit") || 20), 1), 100);

    const result = await listResponsibleExternalNotifications({
      organizationId,
      storeId,
      status,
      limit,
    });

    return buildJsonResponse(result);
  } catch (error: any) {
    return buildJsonResponse(
      {
        ok: false,
        error: "LOAD_RESPONSIBLE_EXTERNAL_NOTIFICATIONS_FAILED",
        message: error?.message || "Nao foi possivel carregar a fila externa do responsavel.",
      },
      500
    );
  }
}
