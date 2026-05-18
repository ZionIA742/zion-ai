import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";

type ZionAdminOverview = {
  admin: {
    role: string;
  };
  totals: {
    organizations: number | null;
    stores: number | null;
    leads: number | null;
    conversations: number | null;
    messages: number | null;
    appointments: number | null;
    assistantThreads: number | null;
    assistantMessages: number | null;
  };
  countErrors: Record<string, string | null>;
  stores: Array<{
    id: string;
    name: string;
    organizationId: string;
    organizationName: string;
    subscriptionStatus: string;
    createdAt: string | null;
  }>;
  future: {
    billing: string;
    paymentStatus: string;
    aiCost: string;
    tokens: string;
    workersHealth: string;
    integrationErrors: string;
  };
};

async function getSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set() {
          // Server Component: não altera cookies aqui.
        },
        remove() {
          // Server Component: não altera cookies aqui.
        },
      },
    }
  );
}

async function getZionAdminOverview(): Promise<{
  data: ZionAdminOverview | null;
  error: string | null;
}> {
  try {
    const headerStore = await headers();
    const cookieStore = await cookies();

    const host = headerStore.get("host");
    const protocol = headerStore.get("x-forwarded-proto") ?? "http";

    if (!host) {
      return {
        data: null,
        error: "Não foi possível identificar o endereço interno da aplicação.",
      };
    }

    const cookieHeader = cookieStore
      .getAll()
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");

    const response = await fetch(`${protocol}://${host}/api/zion-admin/overview`, {
      cache: "no-store",
      headers: {
        cookie: cookieHeader,
      },
    });

    const json = await response.json();

    if (!response.ok) {
      return {
        data: null,
        error: json?.error ?? "Falha ao carregar dados internos do ZION.",
      };
    }

    return {
      data: json as ZionAdminOverview,
      error: null,
    };
  } catch (error: any) {
    return {
      data: null,
      error: error?.message ?? "Erro inesperado ao buscar dados internos.",
    };
  }
}

function formatNumber(value: number | null | undefined) {
  if (typeof value !== "number") {
    return "Sem dados";
  }

  return new Intl.NumberFormat("pt-BR").format(value);
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Sem dados";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function MetricCard({
  title,
  value,
  description,
}: {
  title: string;
  value: string;
  description: string;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
      <div className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
        {title}
      </div>

      <div className="mt-4 text-3xl font-semibold">{value}</div>

      <p className="mt-2 text-sm leading-6 text-zinc-400">{description}</p>
    </div>
  );
}

export default async function ZionAdminDashboardPage() {
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/zion-admin/login");
  }

  const { data: admin, error: adminError } = await supabase
    .from("zion_internal_admins")
    .select("id, role, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (adminError || !admin) {
    redirect("/dashboard");
  }

  const overview = await getZionAdminOverview();
  const data = overview.data;

  const stores = data?.stores ?? [];
  const countErrors = data?.countErrors ?? {};
  const hasCountErrors = Object.values(countErrors).some(Boolean);

  return (
    <main className="min-h-screen overflow-x-hidden bg-zinc-950 px-6 py-8 text-zinc-50">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.28em] text-zinc-500">
              ZION Interno
            </div>

            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              Dashboard interno do ZION
            </h1>

            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
              Visão exclusiva para o dono e sócios acompanharem as lojas,
              operação, uso e saúde geral do sistema. Esta área não aparece para
              assinantes.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-zinc-300">
            Acesso:{" "}
            <span className="font-semibold text-zinc-50">{admin.role}</span>
          </div>
        </header>

        {overview.error && (
          <div className="rounded-3xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-100">
            {overview.error}
          </div>
        )}

        {hasCountErrors && (
          <div className="rounded-3xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-100">
            Alguns indicadores não puderam ser carregados. O dashboard mostrou
            somente os dados com origem confiável.
          </div>
        )}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Lojas"
            value={formatNumber(data?.totals.stores)}
            description="Total de lojas cadastradas no sistema."
          />

          <MetricCard
            title="Organizações"
            value={formatNumber(data?.totals.organizations)}
            description="Total de organizações/clientes registrados."
          />

          <MetricCard
            title="Conversas"
            value={formatNumber(data?.totals.conversations)}
            description="Conversas comerciais registradas no ZION."
          />

          <MetricCard
            title="Mensagens"
            value={formatNumber(data?.totals.messages)}
            description="Mensagens globais registradas nas conversas."
          />
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Leads"
            value={formatNumber(data?.totals.leads)}
            description="Leads cadastrados pelas lojas no sistema."
          />

          <MetricCard
            title="Compromissos"
            value={formatNumber(data?.totals.appointments)}
            description="Visitas, instalações, medições e outros agendamentos."
          />

          <MetricCard
            title="Threads da assistente"
            value={formatNumber(data?.totals.assistantThreads)}
            description="Conversas internas da IA assistente operacional."
          />

          <MetricCard
            title="Mensagens da assistente"
            value={formatNumber(data?.totals.assistantMessages)}
            description="Mensagens trocadas com a assistente operacional."
          />
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold">
                  Lojas clientes do ZION
                </h2>

                <p className="mt-1 text-sm leading-6 text-zinc-400">
                  Lista real carregada pela API interna protegida. Assinantes
                  comuns não têm acesso a estes dados.
                </p>
              </div>

              <span className="w-fit rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-400">
                {formatNumber(stores.length)} lojas listadas
              </span>
            </div>

            <div className="mt-6 overflow-hidden rounded-2xl border border-white/10">
              {stores.length === 0 ? (
                <div className="p-8 text-center text-sm text-zinc-500">
                  Sem lojas carregadas ainda.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="border-b border-white/10 bg-white/[0.03] text-xs uppercase tracking-[0.16em] text-zinc-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">Loja</th>
                        <th className="px-4 py-3 font-medium">Organização</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Criada em</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-white/10">
                      {stores.map((store) => (
                        <tr key={store.id} className="text-zinc-200">
                          <td className="px-4 py-4">
                            <div className="font-medium">{store.name}</div>
                            <div className="mt-1 max-w-[240px] truncate text-xs text-zinc-500">
                              {store.id}
                            </div>
                          </td>

                          <td className="px-4 py-4">
                            <div>{store.organizationName}</div>
                            <div className="mt-1 max-w-[240px] truncate text-xs text-zinc-500">
                              {store.organizationId}
                            </div>
                          </td>

                          <td className="px-4 py-4">
                            <span className="rounded-full border border-white/10 bg-zinc-950/40 px-3 py-1 text-xs text-zinc-300">
                              {store.subscriptionStatus || "Sem dados"}
                            </span>
                          </td>

                          <td className="px-4 py-4 text-zinc-400">
                            {formatDate(store.createdAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
            <h2 className="text-base font-semibold">Blocos futuros</h2>

            <p className="mt-1 text-sm leading-6 text-zinc-400">
              Estes blocos estão preparados, mas não inventam dados enquanto não
              houver base confiável.
            </p>

            <div className="mt-4 space-y-3 text-sm">
              <div className="rounded-2xl border border-white/10 bg-zinc-950/40 p-4">
                Billing e pagamentos:{" "}
                {data?.future.billing ?? "Ainda não implementado."}
              </div>

              <div className="rounded-2xl border border-white/10 bg-zinc-950/40 p-4">
                Status de pagamento:{" "}
                {data?.future.paymentStatus ?? "Ainda não implementado."}
              </div>

              <div className="rounded-2xl border border-white/10 bg-zinc-950/40 p-4">
                Custo de IA e tokens:{" "}
                {data?.future.aiCost ?? "Aguardando base confiável."}
              </div>

              <div className="rounded-2xl border border-white/10 bg-zinc-950/40 p-4">
                Saúde dos workers:{" "}
                {data?.future.workersHealth ?? "Aguardando métrica real."}
              </div>

              <div className="rounded-2xl border border-white/10 bg-zinc-950/40 p-4">
                Erros de integração:{" "}
                {data?.future.integrationErrors ?? "Aguardando base confiável."}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}