import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

type MembershipRow = {
  organization_id: string;
};

type StoreRow = {
  id: string;
  organization_id: string;
  name: string | null;
};

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

export async function POST(request: Request) {
  let stage = "boot";

  try {
    stage = "auth_client";
    const sessionSupabase = await createSupabaseServerClient();
    stage = "auth_user";
    const {
      data: { user },
      error: authError,
    } = await sessionSupabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { ok: false, error: "UNAUTHENTICATED", message: "Usuario nao autenticado." },
        { status: 401 }
      );
    }

    stage = "parse_body";
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const storeId = String(body?.storeId || "").trim();
    const name = String(body?.name || "").trim();

    if (!storeId) {
      return NextResponse.json(
        { ok: false, error: "INVALID_STORE_ID", message: "Store ID nao informado." },
        { status: 400 }
      );
    }

    if (!name) {
      return NextResponse.json(
        { ok: false, error: "INVALID_NAME", message: "Nome da loja nao pode ficar vazio." },
        { status: 400 }
      );
    }

    stage = "service_client";
    const serviceSupabase = getServiceSupabaseClient();

    stage = "membership_select";
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
          .map((membership) => membership.organization_id)
          .filter(Boolean)
      )
    );

    if (organizationIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "FORBIDDEN", message: "Usuario sem acesso a lojas." },
        { status: 403 }
      );
    }

    stage = "store_select";
    const { data: store, error: storeError } = await serviceSupabase
      .from("stores")
      .select("id, organization_id, name")
      .eq("id", storeId)
      .maybeSingle<StoreRow>();

    if (storeError) {
      throw storeError;
    }

    if (!store) {
      return NextResponse.json(
        { ok: false, error: "STORE_NOT_FOUND", message: "Loja nao encontrada." },
        { status: 404 }
      );
    }

    if (!organizationIds.includes(store.organization_id)) {
      return NextResponse.json(
        { ok: false, error: "FORBIDDEN", message: "Voce nao pode alterar esta loja." },
        { status: 403 }
      );
    }

    stage = "store_update";
    const { data: updatedStore, error: updateError } = await serviceSupabase
      .from("stores")
      .update({ name })
      .eq("id", store.id)
      .eq("organization_id", store.organization_id)
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
      stage,
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
      { status: 500 }
    );
  }
}
