import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { prepareResponsibleExternalNotification } from "@/lib/server/assistant/responsible-external-notifications";

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

type PrepareBody = {
  organizationId?: string;
  storeId?: string;
  notificationId?: string;
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

async function resolveAuthorizedStoreContext(body: PrepareBody) {
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

  const storeId = String(body.storeId || "").trim();
  const requestedOrganizationId = String(body.organizationId || "").trim();

  if (!storeId || !requestedOrganizationId) {
    return {
      ok: false as const,
      response: buildJsonResponse(
        {
          ok: false,
          error: "MISSING_FIELDS",
          message: "Envie organizationId e storeId.",
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

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as PrepareBody;
    const organizationId = String(body.organizationId || "").trim();
    const storeId = String(body.storeId || "").trim();
    const notificationId = String(body.notificationId || "").trim();

    if (!organizationId || !storeId || !notificationId) {
      return buildJsonResponse(
        {
          ok: false,
          updated: false,
          reason: "missing_required_fields",
        },
        400
      );
    }

    const auth = await resolveAuthorizedStoreContext(body);

    if (!auth.ok) {
      return auth.response;
    }

    const result = await prepareResponsibleExternalNotification({
      organizationId: auth.store.organization_id,
      storeId: auth.store.id,
      notificationId,
    });

    return buildJsonResponse(result, result.ok ? 200 : 409);
  } catch (error: any) {
    return buildJsonResponse(
      {
        ok: false,
        updated: false,
        reason: "RESPONSIBLE_EXTERNAL_NOTIFICATION_PREPARE_FAILED",
        message:
          error?.message || "Nao foi possivel preparar a notificacao externa do responsavel.",
      },
      500
    );
  }
}
