import type { ReactNode } from "react";
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
    storesActive?: number | null;
    storesTrial?: number | null;
    storesInactive?: number | null;
    leads: number | null;
    conversations: number | null;
    messages: number | null;
    appointments: number | null;
    assistantThreads: number | null;
    assistantMessages: number | null;
    aiRuns?: number | null;
    successfulAiRuns?: number | null;
    failedAiRuns?: number | null;
    totalTokensPrompt?: number | null;
    totalTokensCompletion?: number | null;
    totalTokens?: number | null;
    totalCostUsd?: number | string | null;
    pendingAiRuns?: number | null;
    aiRunQueueErrors?: number | null;
    pendingSalesActions?: number | null;
    salesActionErrors?: number | null;
    pendingWhatsappEvents?: number | null;
    whatsappErrors?: number | null;
    totalOperationalIssues?: number | null;
  };
  countErrors: Record<string, string | null>;
  stores: Array<{
    id: string;
    name: string;
    organizationId: string;
    organizationName: string;
    subscriptionStatus: string;
    createdAt: string | null;
    totalLeads?: number | null;
    totalMessages?: number | null;
    totalAppointments?: number | null;
    totalAssistantThreads?: number | null;
    totalAssistantMessages?: number | null;
    totalAiRuns?: number | null;
    successfulAiRuns?: number | null;
    failedAiRuns?: number | null;
    totalTokensPrompt?: number | null;
    totalTokensCompletion?: number | null;
    totalTokens?: number | null;
    totalCostUsd?: number | string | null;
    lastAiRunAt?: string | null;
    pendingAiRuns?: number | null;
    aiRunQueueErrors?: number | null;
    pendingSalesActions?: number | null;
    salesActionErrors?: number | null;
    pendingWhatsappEvents?: number | null;
    whatsappErrors?: number | null;
    totalOperationalIssues?: number | null;
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

function toNumber(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function formatNumber(value: number | string | null | undefined) {
  if (value == null) {
    return "Sem dados";
  }

  const numberValue = toNumber(value);

  return new Intl.NumberFormat("pt-BR").format(numberValue);
}

function formatCompactNumber(value: number | string | null | undefined) {
  if (value == null) {
    return "Sem dados";
  }

  return new Intl.NumberFormat("pt-BR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(toNumber(value));
}

function formatUsd(value: number | string | null | undefined) {
  const numberValue = toNumber(value);

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: numberValue > 0 && numberValue < 1 ? 6 : 2,
    maximumFractionDigits: numberValue > 0 && numberValue < 1 ? 6 : 2,
  }).format(numberValue);
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Sem atividade";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Sem atividade";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatPercent(numerator: number | string | null | undefined, denominator: number | string | null | undefined) {
  const total = toNumber(denominator);

  if (total <= 0) {
    return "0%";
  }

  return `${Math.round((toNumber(numerator) / total) * 100)}%`;
}

function getStatusLabel(status: string | null | undefined) {
  const normalized = String(status || "").trim().toLowerCase();

  if (normalized === "active") return "Ativa";
  if (normalized === "trial") return "Teste";
  if (normalized === "inactive") return "Inativa";
  if (normalized === "cancelled" || normalized === "canceled") return "Cancelada";
  if (!normalized) return "Sem dados";

  return status || "Sem dados";
}

function getIssuesText(args: {
  pendingAiRuns?: number | null;
  aiRunQueueErrors?: number | null;
  pendingSalesActions?: number | null;
  salesActionErrors?: number | null;
  pendingWhatsappEvents?: number | null;
  whatsappErrors?: number | null;
}) {
  const items: string[] = [];

  if (toNumber(args.pendingAiRuns) > 0) {
    items.push(`${formatNumber(args.pendingAiRuns)} IA pendente`);
  }

  if (toNumber(args.aiRunQueueErrors) > 0) {
    items.push(`${formatNumber(args.aiRunQueueErrors)} erro(s) na fila de IA`);
  }

  if (toNumber(args.pendingSalesActions) > 0) {
    items.push(`${formatNumber(args.pendingSalesActions)} ação comercial pendente`);
  }

  if (toNumber(args.salesActionErrors) > 0) {
    items.push(`${formatNumber(args.salesActionErrors)} erro(s) em ação comercial`);
  }

  if (toNumber(args.pendingWhatsappEvents) > 0) {
    items.push(`${formatNumber(args.pendingWhatsappEvents)} evento WhatsApp pendente`);
  }

  if (toNumber(args.whatsappErrors) > 0) {
    items.push(`${formatNumber(args.whatsappErrors)} erro(s) no WhatsApp`);
  }

  return items.length ? items.join(" · ") : "Nenhuma pendência crítica";
}

function Panel({
  title,
  eyebrow,
  description,
  children,
  right,
}: {
  title: string;
  eyebrow?: string;
  description?: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {eyebrow && (
            <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-500">
              {eyebrow}
            </div>
          )}

          <h2 className="text-base font-semibold text-zinc-50">{title}</h2>

          {description && (
            <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-400">
              {description}
            </p>
          )}
        </div>

        {right}
      </div>

      <div className="mt-5">{children}</div>
    </section>
  );
}

function MetricCard({
  title,
  value,
  description,
  detail,
}: {
  title: string;
  value: string;
  description: string;
  detail?: string;
}) {
  return (
    <div className="flex min-h-[150px] flex-col justify-between rounded-3xl border border-white/10 bg-white/[0.04] p-5">
      <div>
        <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-500">
          {title}
        </div>

        <div className="mt-4 text-3xl font-semibold tracking-tight text-zinc-50">
          {value}
        </div>

        <p className="mt-2 text-sm leading-6 text-zinc-400">{description}</p>
      </div>

      {detail && (
        <div className="mt-4 rounded-full border border-white/10 bg-zinc-950/40 px-3 py-1.5 text-xs text-zinc-400">
          {detail}
        </div>
      )}
    </div>
  );
}

function MiniMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-950/35 p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </div>

      <div className="mt-2 text-lg font-semibold text-zinc-50">{value}</div>

      {detail && (
        <div className="mt-1 text-xs leading-5 text-zinc-500">{detail}</div>
      )}
    </div>
  );
}

function StoreStatusPill({ status }: { status: string | null | undefined }) {
  const normalized = String(status || "").trim().toLowerCase();

  const className =
    normalized === "active"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
      : normalized === "trial"
        ? "border-sky-400/30 bg-sky-400/10 text-sky-100"
        : normalized === "inactive" || normalized === "cancelled" || normalized === "canceled"
          ? "border-red-400/30 bg-red-400/10 text-red-100"
          : "border-white/10 bg-zinc-950/40 text-zinc-300";

  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-medium ${className}`}>
      {getStatusLabel(status)}
    </span>
  );
}

function StoreCard({
  store,
}: {
  store: ZionAdminOverview["stores"][number];
}) {
  const totalAiRuns = toNumber(store.totalAiRuns);
  const successfulAiRuns = toNumber(store.successfulAiRuns);
  const failedAiRuns = toNumber(store.failedAiRuns);
  const totalIssues = toNumber(store.totalOperationalIssues);

  return (
    <article className="rounded-3xl border border-white/10 bg-zinc-950/35 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-zinc-50">{store.name}</h3>
            <StoreStatusPill status={store.subscriptionStatus} />
          </div>

          <div className="mt-1 text-sm text-zinc-400">{store.organizationName}</div>

          <div className="mt-2 max-w-full break-all text-xs leading-5 text-zinc-600">
            Loja: {store.id}
          </div>

          <div className="text-xs leading-5 text-zinc-600">
            Organização: {store.organizationId}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-300">
          Criada em{" "}
          <span className="font-semibold text-zinc-100">
            {formatDate(store.createdAt)}
          </span>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MiniMetric
          label="Uso da loja"
          value={`${formatNumber(store.totalLeads)} leads`}
          detail={`${formatNumber(store.totalMessages)} mensagens · ${formatNumber(store.totalAppointments)} compromissos`}
        />

        <MiniMetric
          label="IA"
          value={`${formatNumber(totalAiRuns)} execuções`}
          detail={`${formatPercent(successfulAiRuns, totalAiRuns)} sucesso · ${formatNumber(failedAiRuns)} erro(s)`}
        />

        <MiniMetric
          label="Custo"
          value={formatUsd(store.totalCostUsd)}
          detail="Custo real já registrado"
        />

        <MiniMetric
          label="Tokens"
          value={formatCompactNumber(store.totalTokens)}
          detail={`${formatNumber(store.totalTokensPrompt)} entrada · ${formatNumber(store.totalTokensCompletion)} saída`}
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr]">
        <div
          className={`rounded-2xl border p-4 ${
            totalIssues > 0
              ? "border-amber-400/25 bg-amber-400/10"
              : "border-white/10 bg-white/[0.025]"
          }`}
        >
          <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            Pendências e erros
          </div>

          <div className="mt-2 text-sm font-medium text-zinc-100">
            {formatNumber(totalIssues)} ocorrência(s)
          </div>

          <p className="mt-1 text-xs leading-5 text-zinc-400">
            {getIssuesText({
              pendingAiRuns: store.pendingAiRuns,
              aiRunQueueErrors: store.aiRunQueueErrors,
              pendingSalesActions: store.pendingSalesActions,
              salesActionErrors: store.salesActionErrors,
              pendingWhatsappEvents: store.pendingWhatsappEvents,
              whatsappErrors: store.whatsappErrors,
            })}
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
          <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            Última execução da IA
          </div>

          <div className="mt-2 text-sm font-medium text-zinc-100">
            {formatDateTime(store.lastAiRunAt)}
          </div>

          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Threads da assistente: {formatNumber(store.totalAssistantThreads)} ·
            mensagens da assistente: {formatNumber(store.totalAssistantMessages)}
          </p>
        </div>
      </div>
    </article>
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

  const totals = data?.totals;
  const pendingTotal =
    toNumber(totals?.pendingAiRuns) +
    toNumber(totals?.pendingSalesActions) +
    toNumber(totals?.pendingWhatsappEvents);
  const errorsTotal =
    toNumber(totals?.aiRunQueueErrors) +
    toNumber(totals?.salesActionErrors) +
    toNumber(totals?.whatsappErrors);

  return (
    <main className="min-h-screen overflow-x-hidden bg-zinc-950 px-4 py-6 text-zinc-50 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-[0.28em] text-zinc-500">
              ZION Interno
            </div>

            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              Dashboard interno do ZION
            </h1>

            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
              Visão exclusiva para o dono e sócios acompanharem lojas, uso da IA,
              custo, pendências e saúde geral do sistema. Esta área não aparece
              para assinantes.
            </p>
          </div>

          <div className="w-fit rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-zinc-300">
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
            value={formatNumber(totals?.stores)}
            description="Total de lojas cadastradas no sistema."
            detail={`${formatNumber(totals?.storesActive)} ativa(s) · ${formatNumber(totals?.storesTrial)} em teste · ${formatNumber(totals?.storesInactive)} inativa(s)`}
          />

          <MetricCard
            title="IA trabalhando"
            value={formatNumber(totals?.aiRuns)}
            description="Execuções reais da IA registradas no sistema."
            detail={`${formatPercent(totals?.successfulAiRuns, totals?.aiRuns)} sucesso · ${formatNumber(totals?.failedAiRuns)} erro(s)`}
          />

          <MetricCard
            title="Custo da IA"
            value={formatUsd(totals?.totalCostUsd)}
            description="Custo real em dólar registrado nas execuções monitoradas."
            detail={data?.future.aiCost ?? "Custo real já registrado para novas execuções."}
          />

          <MetricCard
            title="Tokens usados"
            value={formatCompactNumber(totals?.totalTokens)}
            description="Soma de tokens de entrada e saída já registrados."
            detail={`${formatNumber(totals?.totalTokensPrompt)} entrada · ${formatNumber(totals?.totalTokensCompletion)} saída`}
          />
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Pendências"
            value={formatNumber(totals?.totalOperationalIssues)}
            description="Pendências e erros operacionais monitorados nas filas."
            detail={`${formatNumber(errorsTotal)} erro(s) · ${formatNumber(pendingTotal)} pendente(s)`}
          />

          <MetricCard
            title="Conversas"
            value={formatNumber(totals?.conversations)}
            description="Conversas comerciais registradas no ZION."
          />

          <MetricCard
            title="Mensagens"
            value={formatNumber(totals?.messages)}
            description="Mensagens globais registradas nas conversas."
          />

          <MetricCard
            title="Leads"
            value={formatNumber(totals?.leads)}
            description="Leads cadastrados pelas lojas no sistema."
          />
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Organizações"
            value={formatNumber(totals?.organizations)}
            description="Total de organizações/clientes registrados."
          />

          <MetricCard
            title="Compromissos"
            value={formatNumber(totals?.appointments)}
            description="Visitas, instalações, medições e outros agendamentos."
          />

          <MetricCard
            title="Threads da assistente"
            value={formatNumber(totals?.assistantThreads)}
            description="Conversas internas da IA assistente operacional."
          />

          <MetricCard
            title="Mensagens da assistente"
            value={formatNumber(totals?.assistantMessages)}
            description="Mensagens trocadas com a assistente operacional."
          />
        </section>

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Panel
            title="Lojas clientes do ZION"
            description="Lista real carregada pela API interna protegida, com uso da IA, custo, tokens e pendências por loja."
            right={
              <span className="w-fit rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-400">
                {formatNumber(stores.length)} lojas listadas
              </span>
            }
          >
            {stores.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-zinc-500">
                Sem lojas carregadas ainda.
              </div>
            ) : (
              <div className="space-y-4">
                {stores.map((store) => (
                  <StoreCard key={store.id} store={store} />
                ))}
              </div>
            )}
          </Panel>

          <aside className="space-y-4">
            <Panel
              title="Saúde operacional"
              description="Visão rápida das filas e integrações monitoradas agora."
            >
              <div className="space-y-3">
                <MiniMetric
                  label="Fila de IA pendente"
                  value={formatNumber(totals?.pendingAiRuns)}
                  detail={`${formatNumber(totals?.aiRunQueueErrors)} erro(s) na fila de IA`}
                />

                <MiniMetric
                  label="Ações comerciais"
                  value={formatNumber(totals?.pendingSalesActions)}
                  detail={`${formatNumber(totals?.salesActionErrors)} erro(s) em ações comerciais`}
                />

                <MiniMetric
                  label="WhatsApp"
                  value={formatNumber(totals?.pendingWhatsappEvents)}
                  detail={`${formatNumber(totals?.whatsappErrors)} erro(s) no webhook/entrada`}
                />
              </div>
            </Panel>

            <Panel
              title="Blocos futuros"
              description="Preparados sem inventar dados."
            >
              <div className="space-y-3 text-sm">
                <div className="rounded-2xl border border-white/10 bg-zinc-950/40 p-4">
                  <span className="font-semibold text-zinc-100">
                    Billing e pagamentos:
                  </span>{" "}
                  <span className="text-zinc-400">
                    {data?.future.billing ?? "Ainda não implementado."}
                  </span>
                </div>

                <div className="rounded-2xl border border-white/10 bg-zinc-950/40 p-4">
                  <span className="font-semibold text-zinc-100">
                    Status de pagamento:
                  </span>{" "}
                  <span className="text-zinc-400">
                    {data?.future.paymentStatus ?? "Ainda não implementado."}
                  </span>
                </div>

                <div className="rounded-2xl border border-white/10 bg-zinc-950/40 p-4">
                  <span className="font-semibold text-zinc-100">
                    Saúde dos workers:
                  </span>{" "}
                  <span className="text-zinc-400">
                    {data?.future.workersHealth ?? "Aguardando métrica real."}
                  </span>
                </div>

                <div className="rounded-2xl border border-white/10 bg-zinc-950/40 p-4">
                  <span className="font-semibold text-zinc-100">
                    Erros de integração:
                  </span>{" "}
                  <span className="text-zinc-400">
                    {data?.future.integrationErrors ?? "Aguardando base confiável."}
                  </span>
                </div>
              </div>
            </Panel>
          </aside>
        </div>
      </div>
    </main>
  );
}
