import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

type StoreRow = {
  id: string;
  organization_id: string;
  name: string | null;
  created_at: string | null;
};

type OrganizationRow = {
  id: string;
  name: string | null;
  created_at: string | null;
  subscription_status: string | null;
};

async function getAuthenticatedUser() {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set() {
          // Route Handler: não alteramos cookies aqui.
        },
        remove() {
          // Route Handler: não alteramos cookies aqui.
        },
      },
    }
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return user;
}

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

async function getExactCount(
  supabase: ReturnType<typeof getServiceSupabaseClient>,
  table: string
) {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true });

  if (error) {
    return {
      count: null,
      error: error.message,
    };
  }

  return {
    count: count ?? 0,
    error: null,
  };
}

export async function GET() {
  try {
    const user = await getAuthenticatedUser();

    if (!user) {
      return NextResponse.json(
        {
          error: "Não autenticado.",
        },
        { status: 401 }
      );
    }

    const serviceSupabase = getServiceSupabaseClient();

    const { data: admin, error: adminError } = await serviceSupabase
      .from("zion_internal_admins")
      .select("id, role, is_active")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (adminError || !admin) {
      return NextResponse.json(
        {
          error: "Acesso interno não autorizado.",
        },
        { status: 403 }
      );
    }

    const [
      organizationsCount,
      storesCount,
      leadsCount,
      conversationsCount,
      messagesCount,
      appointmentsCount,
      assistantThreadsCount,
      assistantMessagesCount,
    ] = await Promise.all([
      getExactCount(serviceSupabase, "organizations"),
      getExactCount(serviceSupabase, "stores"),
      getExactCount(serviceSupabase, "leads"),
      getExactCount(serviceSupabase, "conversations"),
      getExactCount(serviceSupabase, "messages"),
      getExactCount(serviceSupabase, "store_appointments"),
      getExactCount(serviceSupabase, "store_assistant_threads"),
      getExactCount(serviceSupabase, "store_assistant_messages"),
    ]);

    const { data: organizations, error: organizationsError } =
      await serviceSupabase
        .from("organizations")
        .select("id, name, created_at, subscription_status")
        .order("created_at", { ascending: false })
        .limit(50);

    const { data: stores, error: storesError } = await serviceSupabase
      .from("stores")
      .select("id, organization_id, name, created_at")
      .order("created_at", { ascending: false })
      .limit(100);

    if (organizationsError || storesError) {
      return NextResponse.json(
        {
          error: "Falha ao carregar dados internos do ZION.",
          details: {
            organizations: organizationsError?.message ?? null,
            stores: storesError?.message ?? null,
          },
        },
        { status: 500 }
      );
    }

    const organizationMap = new Map<string, OrganizationRow>();

    for (const organization of (organizations ?? []) as OrganizationRow[]) {
      organizationMap.set(organization.id, organization);
    }

    const storesList = ((stores ?? []) as StoreRow[]).map((store) => {
      const organization = organizationMap.get(store.organization_id);

      return {
        id: store.id,
        name: store.name ?? "Loja sem nome",
        organizationId: store.organization_id,
        organizationName: organization?.name ?? "Organização não encontrada",
        subscriptionStatus: organization?.subscription_status ?? "Sem dados",
        createdAt: store.created_at,
      };
    });

    return NextResponse.json({
      admin: {
        role: admin.role,
      },
      totals: {
        organizations: organizationsCount.count,
        stores: storesCount.count,
        leads: leadsCount.count,
        conversations: conversationsCount.count,
        messages: messagesCount.count,
        appointments: appointmentsCount.count,
        assistantThreads: assistantThreadsCount.count,
        assistantMessages: assistantMessagesCount.count,
      },
      countErrors: {
        organizations: organizationsCount.error,
        stores: storesCount.error,
        leads: leadsCount.error,
        conversations: conversationsCount.error,
        messages: messagesCount.error,
        appointments: appointmentsCount.error,
        assistantThreads: assistantThreadsCount.error,
        assistantMessages: assistantMessagesCount.error,
      },
      stores: storesList,
      future: {
        billing: "Ainda não implementado.",
        paymentStatus: "Ainda não implementado.",
        aiCost: "Aguardando base confiável.",
        tokens: "Aguardando base confiável.",
        workersHealth: "Aguardando métrica real.",
        integrationErrors: "Aguardando base confiável.",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: "Erro inesperado ao carregar dashboard interno.",
        details: error?.message ?? "Erro desconhecido.",
      },
      { status: 500 }
    );
  }
}