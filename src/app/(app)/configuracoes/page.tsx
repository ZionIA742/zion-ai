"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useStoreContext } from "@/components/StoreProvider";
import { supabase } from "@/lib/supabaseBrowser";

type CountState = {
  pools: number;
  quimicos: number;
  acessorios: number;
  outros: number;
};

type CatalogItemRow = {
  id: string;
  metadata?: {
    categoria?: string | null;
  } | null;
};

type CatalogPhotoRow = {
  id: string;
  catalog_item_id: string;
  storage_path: string | null;
};

type OnboardingRow = {
  id?: string;
  store_id: string;
  organization_id: string;
  status: string;
  completed_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

type StatusTone = "green" | "amber" | "red" | "gray";

type SettingsTabId =
  | "visao-geral"
  | "estrategia"
  | "piscinas"
  | "produtos-acessorios"
  | "operacao"
  | "comercial-ia"
  | "responsavel-ativacao"
  | "descontos"
  | "canais-integracoes"
  | "identidade";

function normalizeCategory(value: string | null | undefined) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "quimicos") return "quimicos";
  if (normalized === "acessorios") return "acessorios";
  return "outros";
}

function chunkArray<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function statusToneClass(tone: StatusTone) {
  if (tone === "green") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (tone === "amber") return "border-amber-200 bg-amber-50 text-amber-900";
  if (tone === "red") return "border-red-200 bg-red-50 text-red-800";
  return "border-gray-200 bg-gray-50 text-gray-700";
}

function resolveOnboardingLabel(status: string | null | undefined) {
  const normalized = String(status || "not_started").trim().toLowerCase();
  if (normalized === "completed") return { label: "Concluído", tone: "green" as const };
  if (normalized === "in_progress") return { label: "Em andamento", tone: "amber" as const };
  return { label: "Não iniciado", tone: "red" as const };
}

function buildStoreName(activeStore: unknown) {
  const store = (activeStore || {}) as Record<string, unknown>;
  return (
    String(
      store.store_display_name ||
        store.display_name ||
        store.name ||
        store.store_name ||
        "Loja ativa"
    ).trim() || "Loja ativa"
  );
}

function SectionBlock({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 md:p-5">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          {description ? <p className="mt-1 text-sm text-gray-600">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function QuickCard({
  href,
  title,
  description,
  count,
}: {
  href: string;
  title: string;
  description: string;
  count?: number;
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl border border-gray-200 bg-white px-4 py-3 transition hover:border-black/20 hover:bg-gray-50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-gray-600">{description}</p>
        </div>
        {typeof count === "number" ? (
          <span className="inline-flex min-w-[2rem] shrink-0 justify-center rounded-full bg-gray-100 px-2 py-1 text-[11px] font-semibold text-gray-700">
            {count}
          </span>
        ) : null}
      </div>
      <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500 group-hover:text-gray-700">
        Abrir
      </div>
    </Link>
  );
}

function SecondaryLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
    >
      {children}
    </Link>
  );
}

function StatusCard({
  label,
  value,
  tone = "gray",
  hint,
}: {
  label: string;
  value: string;
  tone?: StatusTone;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
        {label}
      </div>
      <div className="mt-2">
        <span
          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusToneClass(
            tone
          )}`}
        >
          {value}
        </span>
      </div>
      {hint ? <div className="mt-2 text-xs leading-5 text-gray-600">{hint}</div> : null}
    </div>
  );
}

function SummaryList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <div className="text-sm text-gray-500">Nada relevante para mostrar ainda.</div>;
  }

  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div
          key={`${item}-${index}`}
          className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700"
        >
          {item}
        </div>
      ))}
    </div>
  );
}

function CompactMetric({
  label,
  value,
  tone = "gray",
}: {
  label: string;
  value: string;
  tone?: StatusTone;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
        {label}
      </div>
      <div className="mt-2">
        <span
          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusToneClass(
            tone
          )}`}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

function SettingsTabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-xl border px-3 py-2 text-left transition",
        active
          ? "border-black bg-black text-white"
          : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
      ].join(" ")}
    >
      <div className="text-sm font-semibold">{label}</div>
    </button>
  );
}

export default function ConfiguracoesPage() {
  const { organizationId, activeStoreId, activeStore } = useStoreContext();

  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);
  const [deletingCatalog, setDeletingCatalog] = useState(false);
  const [counts, setCounts] = useState<CountState>({
    pools: 0,
    quimicos: 0,
    acessorios: 0,
    outros: 0,
  });
  const [onboarding, setOnboarding] = useState<OnboardingRow | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTabId>("visao-geral");

  const hasValidStoreContext = Boolean(organizationId && activeStoreId);
  const storeName = useMemo(() => buildStoreName(activeStore), [activeStore]);

  const tabs = useMemo(
    () => [
      { id: "visao-geral" as const, label: "Visão Geral" },
      { id: "estrategia" as const, label: "Estratégia" },
      { id: "piscinas" as const, label: "Piscinas" },
      { id: "produtos-acessorios" as const, label: "Produtos/Acessórios" },
      { id: "operacao" as const, label: "Operação" },
      { id: "comercial-ia" as const, label: "Comercial e IA" },
      { id: "responsavel-ativacao" as const, label: "Responsável e ativação" },
      { id: "descontos" as const, label: "Descontos" },
      { id: "canais-integracoes" as const, label: "Canais e integrações" },
      { id: "identidade" as const, label: "Identidade da loja" },
    ],
    []
  );

  const fetchPageData = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setCounts({ pools: 0, quimicos: 0, acessorios: 0, outros: 0 });
      setOnboarding(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorText(null);

    try {
      const [poolsResult, catalogResult, onboardingResult] = await Promise.all([
        supabase
          .from("pools")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId),
        supabase
          .from("store_catalog_items")
          .select("id, metadata")
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId),
        supabase.rpc("onboarding_get_store_onboarding_scoped", {
          p_organization_id: organizationId,
          p_store_id: activeStoreId,
        }),
      ]);

      if (poolsResult.error) throw poolsResult.error;
      if (catalogResult.error) throw catalogResult.error;
      if (onboardingResult.error) throw onboardingResult.error;

      const nextCounts: CountState = {
        pools: poolsResult.count ?? 0,
        quimicos: 0,
        acessorios: 0,
        outros: 0,
      };

      for (const row of (catalogResult.data || []) as CatalogItemRow[]) {
        const category = normalizeCategory(row?.metadata?.categoria);
        nextCounts[category] += 1;
      }

      setCounts(nextCounts);
      setOnboarding((onboardingResult.data ?? null) as OnboardingRow | null);
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao carregar a visão geral das configurações.");
    } finally {
      setLoading(false);
    }
  }, [organizationId, activeStoreId]);

  useEffect(() => {
    void fetchPageData();
  }, [fetchPageData]);

  const totalCatalogo = useMemo(
    () => counts.quimicos + counts.acessorios + counts.outros,
    [counts]
  );

  const onboardingStatus = useMemo(
    () => resolveOnboardingLabel(onboarding?.status),
    [onboarding?.status]
  );

  const activationPendencies = useMemo(() => {
    const list: string[] = [];

    if (onboardingStatus.label !== "Concluído") {
      list.push("Finalizar o onboarding principal da loja.");
    }
    if (counts.pools === 0) {
      list.push("Cadastrar pelo menos uma piscina, se a loja trabalha com venda de piscinas.");
    }
    if (totalCatalogo === 0) {
      list.push("Cadastrar produtos, acessórios ou outros itens no catálogo.");
    }
    if (onboardingStatus.label === "Concluído" && totalCatalogo > 0) {
      list.push("Revisar regras comerciais e operacionais antes da ativação real.");
    }

    return list;
  }, [counts.pools, totalCatalogo, onboardingStatus.label]);

  const overviewSummary = useMemo(() => {
    return [
      `Loja ativa: ${storeName}.`,
      `Status da configuração: ${onboardingStatus.label.toLowerCase()}.`,
      `Piscinas cadastradas: ${counts.pools}.`,
      `Catálogo geral: ${totalCatalogo} itens (${counts.quimicos} químicos, ${counts.acessorios} acessórios e ${counts.outros} outros).`,
    ];
  }, [
    storeName,
    onboardingStatus.label,
    counts.pools,
    totalCatalogo,
    counts.quimicos,
    counts.acessorios,
    counts.outros,
  ]);

  const iaReadiness = useMemo(() => {
    if (onboardingStatus.label === "Concluído" && (counts.pools > 0 || totalCatalogo > 0)) {
      return {
        value: "Pronta para revisão final",
        tone: "green" as const,
        hint: "Base mínima já existe para validar a operação real da IA.",
      };
    }
    if (onboardingStatus.label === "Em andamento") {
      return {
        value: "Em preparação",
        tone: "amber" as const,
        hint: "Ainda faltam definições da loja para liberar a IA com segurança.",
      };
    }
    return {
      value: "Não pronta",
      tone: "red" as const,
      hint: "A loja ainda precisa concluir a estrutura mínima de configuração.",
    };
  }, [onboardingStatus.label, counts.pools, totalCatalogo]);

  const handleDeleteAllCatalog = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setErrorText("Nenhuma loja ativa foi encontrada para apagar o catálogo.");
      return;
    }

    if (deletingCatalog) return;

    if (totalCatalogo === 0) {
      setSuccessText("O catálogo geral já está vazio.");
      setErrorText(null);
      return;
    }

    const firstConfirm = window.confirm(
      "Tem certeza que deseja apagar TODO o catálogo geral desta loja? Isso vai remover químicos, acessórios e outros itens cadastrados."
    );
    if (!firstConfirm) return;

    const secondConfirm = window.confirm(
      "Confirma mais uma vez: apagar todo o catálogo geral agora? Essa ação não apaga as piscinas."
    );
    if (!secondConfirm) return;

    setDeletingCatalog(true);
    setErrorText(null);
    setSuccessText(null);

    try {
      const { data: catalogItems, error: catalogItemsError } = await supabase
        .from("store_catalog_items")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("store_id", activeStoreId);

      if (catalogItemsError) throw catalogItemsError;

      const catalogItemIds = ((catalogItems || []) as Array<{ id: string }>).map(
        (item) => item.id
      );

      if (catalogItemIds.length === 0) {
        setSuccessText("O catálogo geral já estava vazio.");
        await fetchPageData();
        return;
      }

      const photoRows: CatalogPhotoRow[] = [];
      const idChunks = chunkArray(catalogItemIds, 200);

      for (const ids of idChunks) {
        const { data: photoChunk, error: photosError } = await supabase
          .from("store_catalog_item_photos")
          .select("id, catalog_item_id, storage_path")
          .in("catalog_item_id", ids);

        if (photosError) throw photosError;
        photoRows.push(...((photoChunk || []) as CatalogPhotoRow[]));
      }

      const storagePaths = photoRows
        .map((row) => String(row.storage_path || "").trim())
        .filter(Boolean);

      const storagePathChunks = chunkArray(storagePaths, 100);
      for (const paths of storagePathChunks) {
        const { error: storageRemoveError } = await supabase.storage
          .from("store-catalog-photos")
          .remove(paths);

        if (storageRemoveError) throw storageRemoveError;
      }

      if (photoRows.length > 0) {
        const photoIdChunks = chunkArray(
          photoRows.map((row) => row.id),
          200
        );

        for (const ids of photoIdChunks) {
          const { error: deletePhotosError } = await supabase
            .from("store_catalog_item_photos")
            .delete()
            .in("id", ids);

          if (deletePhotosError) throw deletePhotosError;
        }
      }

      for (const ids of idChunks) {
        const { error: deleteItemsError } = await supabase
          .from("store_catalog_items")
          .delete()
          .in("id", ids);

        if (deleteItemsError) throw deleteItemsError;
      }

      setSuccessText("Todo o catálogo geral da loja foi apagado com sucesso.");
      await fetchPageData();
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao apagar todo o catálogo geral da loja.");
    } finally {
      setDeletingCatalog(false);
    }
  }, [organizationId, activeStoreId, deletingCatalog, totalCatalogo, fetchPageData]);

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h1 className="text-2xl font-black tracking-[-0.02em] text-black">Configurações</h1>
        <p className="text-sm text-gray-600">
          Centro de visão geral, revisão operacional e acesso rápido da loja.
        </p>
      </div>

      {!hasValidStoreContext ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Nenhuma loja ativa foi encontrada.
        </div>
      ) : null}

      {errorText ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorText}
        </div>
      ) : null}

      {successText ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {successText}
        </div>
      ) : null}

      <section className="rounded-2xl border border-gray-200 bg-white p-4 md:p-5">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-gray-900">Áreas da configuração</h2>
          <p className="mt-1 text-sm text-gray-600">
            Escolha uma aba para revisar a parte certa da loja sem sair desta tela.
          </p>
        </div>

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
          {tabs.map((tab) => (
            <SettingsTabButton
              key={tab.id}
              active={activeTab === tab.id}
              label={tab.label}
              onClick={() => setActiveTab(tab.id)}
            />
          ))}
        </div>
      </section>

      <SectionBlock
        title="Acessos rápidos"
        description="Tudo em um lugar, mantendo os atalhos principais da configuração da loja."
        actions={
          <>
            {loading ? <span className="text-xs text-gray-500">Carregando...</span> : null}
            <button
              type="button"
              onClick={() => void handleDeleteAllCatalog()}
              disabled={!hasValidStoreContext || deletingCatalog || totalCatalogo === 0}
              className="rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deletingCatalog ? "Apagando catálogo..." : "Apagar todo o catálogo"}
            </button>
          </>
        }
      >
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_290px]">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <QuickCard
              href="/configuracoes/piscinas"
              title="Piscinas"
              description=""
              count={counts.pools}
            />
            <QuickCard
              href="/configuracoes/catalogo/quimicos"
              title="Químicos"
              description=""
              count={counts.quimicos}
            />
            <QuickCard
              href="/configuracoes/catalogo/acessorios"
              title="Acessórios"
              description=""
              count={counts.acessorios}
            />
            <QuickCard
              href="/configuracoes/catalogo/outros"
              title="Outros"
              description=""
              count={counts.outros}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <CompactMetric
              label="Total do catálogo"
              value={String(totalCatalogo)}
              tone={totalCatalogo > 0 ? "green" : "gray"}
            />
            <CompactMetric
              label="Status da configuração"
              value={onboardingStatus.label}
              tone={onboardingStatus.tone}
            />
          </div>
        </div>
      </SectionBlock>

      {activeTab === "visao-geral" ? (
        <SectionBlock
          title="1. Visão Geral"
          description="Tela-resumo da loja com status, pendências e prontidão operacional."
          actions={<SecondaryLink href="/onboarding?step=5">Revisar ativação</SecondaryLink>}
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <StatusCard
              label="Configuração da loja"
              value={onboardingStatus.label}
              tone={onboardingStatus.tone}
              hint="Status geral do onboarding principal."
            />
            <StatusCard
              label="Canal comercial"
              value={onboardingStatus.label === "Concluído" ? "Revisar conexão" : "Pendente"}
              tone={onboardingStatus.label === "Concluído" ? "amber" : "red"}
              hint="Canal de atendimento da loja e comunicação comercial."
            />
            <StatusCard
              label="Canal da assistente"
              value={onboardingStatus.label === "Concluído" ? "Em definição" : "Pendente"}
              tone="amber"
              hint="Canal que o responsável vai usar para falar com a IA assistente."
            />
            <StatusCard
              label="Agenda"
              value={onboardingStatus.label !== "Não iniciado" ? "Revisar regras" : "Pendente"}
              tone={onboardingStatus.label !== "Não iniciado" ? "amber" : "red"}
              hint="Disponibilidade, limites e regras de compromisso."
            />
            <StatusCard
              label="Prontidão da IA"
              value={iaReadiness.value}
              tone={iaReadiness.tone}
              hint={iaReadiness.hint}
            />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
            <div>
              <div className="mb-2 text-sm font-semibold text-gray-900">Resumo curto da loja</div>
              <SummaryList items={overviewSummary} />
            </div>
            <div>
              <div className="mb-2 text-sm font-semibold text-gray-900">
                Pendências para ativação real
              </div>
              <SummaryList items={activationPendencies} />
            </div>
          </div>
        </SectionBlock>
      ) : null}

      {activeTab === "estrategia" ? (
        <SectionBlock
          title="2. Estratégia"
          description="Espelho estruturado do onboarding, sem substituir a configuração viva principal."
          actions={<SecondaryLink href="/onboarding?step=1">Revisar entrada da loja</SecondaryLink>}
        >
          <SummaryList
            items={[
              "Cidade e região de atendimento devem ser revistas aqui com base no onboarding.",
              "Serviços principais, foco comercial e marca principal precisam permanecer consistentes com a entrada da loja.",
              `Status atual dessa base: ${onboardingStatus.label.toLowerCase()}.`,
            ]}
          />
        </SectionBlock>
      ) : null}

      {activeTab === "piscinas" ? (
        <SectionBlock
          title="3. Piscinas"
          description="Tudo sobre a oferta de piscinas da loja."
          actions={<SecondaryLink href="/configuracoes/piscinas">Abrir piscinas</SecondaryLink>}
        >
          <SummaryList
            items={[
              `Modelos cadastrados agora: ${counts.pools}.`,
              "A página interna já deve continuar com edição, exclusão, fotos, preço base e ativo/inativo.",
              "A futura importação inteligente assistida de piscinas deve continuar entrando por esse fluxo.",
            ]}
          />
        </SectionBlock>
      ) : null}

      {activeTab === "produtos-acessorios" ? (
        <SectionBlock
          title="4. Produtos/Acessórios"
          description="No lugar do catálogo geral, com separação clara por categoria."
          actions={
            <div className="flex flex-wrap gap-2">
              <SecondaryLink href="/configuracoes/catalogo/quimicos">Químicos</SecondaryLink>
              <SecondaryLink href="/configuracoes/catalogo/acessorios">Acessórios</SecondaryLink>
              <SecondaryLink href="/configuracoes/catalogo/outros">Outros</SecondaryLink>
            </div>
          }
        >
          <SummaryList
            items={[
              `Químicos cadastrados: ${counts.quimicos}.`,
              `Acessórios cadastrados: ${counts.acessorios}.`,
              `Outros itens cadastrados: ${counts.outros}.`,
              "As páginas internas devem continuar responsáveis por preço, estoque, SKU, fotos, ativo/inativo, edição e exclusão.",
            ]}
          />
        </SectionBlock>
      ) : null}

      {activeTab === "operacao" ? (
        <SectionBlock
          title="5. Operação"
          description="Regras reais da operação da loja e da agenda operacional."
          actions={<SecondaryLink href="/onboarding?step=3">Revisar operação</SecondaryLink>}
        >
          <SummaryList
            items={[
              "Aqui devem ficar as regras de instalação, visita técnica, prazo médio e disponibilidade por dia.",
              "Também é a área certa para revisar regiões atendidas, limitações importantes e regras da agenda.",
              "Hoje a melhor fonte de revisão para isso continua sendo o onboarding estruturado.",
            ]}
          />
        </SectionBlock>
      ) : null}

      {activeTab === "comercial-ia" ? (
        <SectionBlock
          title="6. Comercial e IA"
          description="Regras comerciais vivas que a IA vendedora deve obedecer."
          actions={<SecondaryLink href="/onboarding?step=4">Revisar comercial e IA</SecondaryLink>}
        >
          <SummaryList
            items={[
              "Nome da IA no atendimento, forma de apresentação, tom, política de preço e regras de desconto devem ser revisados aqui.",
              "Também é a área certa para regras de promessa da IA, pós-venda e comportamento fora do horário.",
              "A base atual precisa continuar coerente com o onboarding e com os limites da operação da loja.",
            ]}
          />
        </SectionBlock>
      ) : null}

      {activeTab === "responsavel-ativacao" ? (
        <SectionBlock
          title="7. Responsável e ativação"
          description="Ponte entre IA e humano responsável."
          actions={<SecondaryLink href="/onboarding?step=5">Abrir ativação</SecondaryLink>}
        >
          <SummaryList
            items={[
              "Nome do responsável principal, WhatsApp, canal da assistente e checklist de ativação real devem aparecer aqui.",
              `Status atual da ativação: ${onboardingStatus.label.toLowerCase()}.`,
              "Essa área precisa servir como último ponto de conferência antes da loja entrar em operação real.",
            ]}
          />
        </SectionBlock>
      ) : null}

      {activeTab === "descontos" ? (
        <SectionBlock
          title="8. Descontos"
          description="Módulo próprio, sem brigar com Comercial e IA."
          actions={<SecondaryLink href="/onboarding?step=4">Revisar descontos</SecondaryLink>}
        >
          <SummaryList
            items={[
              "Regra geral de desconto, limite máximo, quando precisa aprovação humana e quem aprova devem ficar centralizados aqui.",
              "Se existir histórico de pedidos de desconto no futuro, essa também é a área certa para acompanhar.",
            ]}
          />
        </SectionBlock>
      ) : null}

      {activeTab === "canais-integracoes" ? (
        <SectionBlock
          title="9. Canais e integrações"
          description="WhatsApp comercial, canal do responsável e integrações externas."
          actions={<SecondaryLink href="/onboarding?step=5">Revisar canais</SecondaryLink>}
        >
          <SummaryList
            items={[
              "WhatsApp comercial da loja, canal do responsável, logo, site e dados para PDF, orçamento e contrato devem ficar organizados aqui.",
              "O ideal é essa área mostrar claramente o status das integrações e o que ainda depende de ativação real.",
            ]}
          />
        </SectionBlock>
      ) : null}

      {activeTab === "identidade" ? (
        <SectionBlock
          title="10. Identidade da loja"
          description="Nome, assinatura e dados institucionais usados pela IA e pelos documentos da loja."
          actions={<SecondaryLink href="/onboarding?step=1">Revisar identidade</SecondaryLink>}
        >
          <SummaryList
            items={[
              `Nome atual da loja: ${storeName}.`,
              "Essa área deve concentrar nome da loja, logo, nome que a IA usa, assinatura padrão e dados de orçamento/contrato.",
            ]}
          />
        </SectionBlock>
      ) : null}
    </div>
  );
}
