import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

type ProfileRow = {
  user_id: string;
};

type MembershipRow = {
  id: string;
  organization_id: string;
  role: string | null;
  created_at: string | null;
};

type OrganizationRow = {
  id: string;
  name: string | null;
};

type StoreRow = {
  id: string;
  organization_id: string;
  name: string | null;
  created_at: string | null;
};

function getServiceSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase service role não configurada.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function buildOrganizationName(email: string | null | undefined) {
  const normalized = String(email || "").trim().toLowerCase();
  const localPart = normalized.split("@")[0]?.trim();
  return localPart ? `Organização ${localPart}` : "Organização ZION";
}

export async function POST() {
  let stage = "boot";

  try {
    stage = "auth_client";
    const supabase = await createSupabaseServerClient();
    stage = "auth_user";
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Usuário não autenticado." },
        { status: 401 },
      );
    }

    stage = "service_client";
    const serviceSupabase = getServiceSupabaseClient();

    stage = "profile_select";
    const { data: profile } = await serviceSupabase
      .from("profiles")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle<ProfileRow>();

    if (!profile) {
      stage = "profile_insert";
      const { error: profileInsertError } = await serviceSupabase
        .from("profiles")
        .insert({
          user_id: user.id,
        });

      if (profileInsertError) {
        throw profileInsertError;
      }
    }

    stage = "membership_select";
    const { data: memberships, error: membershipError } = await serviceSupabase
      .from("memberships")
      .select("id, organization_id, role, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (membershipError) {
      throw membershipError;
    }

    const membershipRows = (memberships ?? []) as MembershipRow[];
    let organizationId: string | null = null;
    let selectedStores: StoreRow[] = [];

    if (membershipRows.length > 0) {
      stage = "membership_store_scan";
      const organizationIds = Array.from(
        new Set(
          membershipRows
            .map((membership) => membership.organization_id)
            .filter(Boolean),
        ),
      );

      if (organizationIds.length > 0) {
        const { data: scopedStores, error: scopedStoresError } = await serviceSupabase
          .from("stores")
          .select("id, organization_id, name, created_at")
          .in("organization_id", organizationIds)
          .order("created_at", { ascending: true });

        if (scopedStoresError) {
          throw scopedStoresError;
        }

        const storesByOrganization = new Map<string, StoreRow[]>();

        for (const store of (scopedStores ?? []) as StoreRow[]) {
          const bucket = storesByOrganization.get(store.organization_id) ?? [];
          bucket.push(store);
          storesByOrganization.set(store.organization_id, bucket);
        }

        const preferredMembership =
          membershipRows.find((membership) => {
            return (storesByOrganization.get(membership.organization_id)?.length ?? 0) > 0;
          }) ?? membershipRows[0];

        organizationId = preferredMembership?.organization_id ?? null;
        selectedStores = organizationId
          ? storesByOrganization.get(organizationId) ?? []
          : [];
      }
    }

    if (!organizationId) {
      stage = "organization_insert";
      const { data: organization, error: organizationInsertError } = await serviceSupabase
        .from("organizations")
        .insert({
          name: buildOrganizationName(user.email),
        })
        .select("id, name")
        .single<OrganizationRow>();

      if (organizationInsertError || !organization) {
        throw organizationInsertError || new Error("Falha ao criar organização.");
      }

      organizationId = organization.id;

      stage = "membership_insert";
      const { error: membershipInsertError } = await serviceSupabase
        .from("memberships")
        .insert({
          user_id: user.id,
          organization_id: organizationId,
          role: "owner",
        });

      if (membershipInsertError) {
        throw membershipInsertError;
      }
    }

    if (!organizationId) {
      throw new Error("Falha ao resolver organization_id do usuário.");
    }

    if (selectedStores.length === 0) {
      stage = "store_select";
      const { data: existingStores, error: storesError } = await serviceSupabase
        .from("stores")
        .select("id, organization_id, name, created_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true });

      if (storesError) {
        throw storesError;
      }

      selectedStores = (existingStores ?? []) as StoreRow[];
    }

    let storeId = selectedStores[0]?.id ?? null;

    if (!storeId) {
      stage = "store_insert";
      const { data: store, error: storeInsertError } = await serviceSupabase
        .from("stores")
        .insert({
          organization_id: organizationId,
          name: "Loja Matriz",
        })
        .select("id, organization_id, name, created_at")
        .single<StoreRow>();

      if (storeInsertError || !store) {
        throw storeInsertError || new Error("Falha ao criar loja padrão.");
      }

      storeId = store.id;
    }

    return NextResponse.json({
      ok: true,
      organizationId,
      storeId,
    });
  } catch (error: any) {
    console.error("[account/ensure-setup] error:", {
      stage,
      message: error?.message ?? null,
      code: error?.code ?? null,
      details: error?.details ?? null,
      hint: error?.hint ?? null,
      error,
    });

    return NextResponse.json(
      {
        error: "Falha ao preparar a conta para acesso ao painel.",
      },
      { status: 500 },
    );
  }
}
