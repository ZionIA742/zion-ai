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

type AnswersMap = Record<string, unknown>;

type PoolFormState = {
  name: string;
  material: string;
  shape: string;
  width_m: string;
  length_m: string;
  depth_m: string;
  price: string;
  stock_quantity: string;
  description: string;
  is_active: boolean;
  track_stock: boolean;
};

type CatalogFormState = {
  category: "quimicos" | "acessorios" | "outros";
  name: string;
  sku: string;
  brand: string;
  price: string;
  stock_quantity: string;
  description: string;
  is_active: boolean;
  track_stock: boolean;
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

type Option = {
  value: string;
  label: string;
};

const STORE_SERVICE_OPTIONS: Option[] = [
  { value: "venda_piscinas", label: "Venda de piscinas" },
  { value: "instalacao_piscinas", label: "Instalação de piscinas" },
  { value: "venda_produtos_quimicos", label: "Venda de produtos químicos" },
  { value: "venda_acessorios", label: "Venda de acessórios" },
  { value: "visita_tecnica", label: "Visita técnica" },
  { value: "manutencao", label: "Limpeza / manutenção" },
];

const SERVICE_REGION_MODE_OPTIONS: Option[] = [
  { value: "somente_cidade_loja", label: "Somente a cidade da loja" },
  { value: "cidade_e_vizinhas", label: "Cidade da loja + cidades vizinhas" },
  { value: "grande_regiao", label: "Atende várias cidades da região" },
  { value: "todo_estado", label: "Todo o estado" },
  { value: "sob_consulta", label: "Fora da região, só sob consulta" },
];

const POOL_TYPE_OPTIONS: Option[] = [
  { value: "fibra", label: "Fibra" },
  { value: "vinil", label: "Vinil" },
  { value: "alvenaria", label: "Alvenaria" },
  { value: "pastilha", label: "Pastilha / revestida" },
  { value: "spa", label: "SPA / hidromassagem" },
  { value: "prainha", label: "Prainha / complemento" },
];

const DAYS_OF_WEEK_OPTIONS: Option[] = [
  { value: "segunda", label: "Segunda" },
  { value: "terça", label: "Terça" },
  { value: "quarta", label: "Quarta" },
  { value: "quinta", label: "Quinta" },
  { value: "sexta", label: "Sexta" },
  { value: "sábado", label: "Sábado" },
  { value: "domingo", label: "Domingo" },
];

const TECHNICAL_VISIT_RULE_OPTIONS: Option[] = [
  { value: "precisa_agendar", label: "Precisa agendar antes" },
  { value: "confirmar_endereco", label: "Precisa confirmar endereço antes" },
  { value: "analise_do_local", label: "Pode depender de avaliação do local" },
  { value: "pode_ter_taxa", label: "Pode ter taxa de deslocamento" },
  { value: "somente_regiao_atendida", label: "Só atende a região cadastrada" },
  { value: "horario_comercial", label: "Somente em horário comercial" },
];

const IMPORTANT_LIMITATION_OPTIONS: Option[] = [
  { value: "nao_atende_domingo", label: "Não atende domingo" },
  { value: "nao_atende_fora_regiao", label: "Não atende fora da região definida" },
  { value: "nao_faz_obra_entorno", label: "Não faz a obra estética completa do entorno" },
  { value: "nao_passa_preco_sem_contexto", label: "Não passa preço sem entender o caso" },
  { value: "depende_avaliacao_tecnica", label: "Alguns casos dependem de avaliação técnica" },
  { value: "prazos_podem_variar", label: "Prazos podem variar conforme o projeto" },
];

const PAYMENT_METHOD_MAIN_OPTIONS: Option[] = [
  { value: "pix", label: "Pix" },
  { value: "cartao_credito", label: "Cartão de crédito" },
  { value: "cartao_debito", label: "Cartão de débito" },
  { value: "boleto", label: "Boleto" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "transferencia", label: "Transferência" },
];

const PRICE_DIRECT_BEFORE_OPTIONS: Option[] = [
  { value: "so_apos_entender_objetivo", label: "Só depois de entender o que o cliente quer" },
  { value: "so_apos_identificar_interesse_real", label: "Só depois de perceber interesse real" },
  { value: "so_apos_entender_tipo", label: "Só depois de entender o tipo de piscina ou produto" },
  { value: "so_apos_entender_medidas", label: "Só depois de entender medidas ou porte do projeto" },
  { value: "so_apos_entender_instalacao", label: "Só depois de entender se precisa instalação" },
];

const HUMAN_HELP_DISCOUNT_OPTIONS: Option[] = [
  { value: "pediu_desconto_maior", label: "Pediu desconto maior que o permitido" },
  { value: "quer_condicao_especial", label: "Quer condição especial" },
  { value: "fechamento_imediato", label: "Cliente quer fechar agora" },
  { value: "cliente_importante", label: "Cliente com alto potencial de fechar" },
];

const HUMAN_HELP_CUSTOM_PROJECT_OPTIONS: Option[] = [
  { value: "projeto_fora_padrao", label: "Projeto fora do padrão" },
  { value: "terreno_dificil", label: "Local ou terreno com dificuldade" },
  { value: "duvida_tecnica_complexa", label: "Dúvida técnica complexa" },
  { value: "pedido_muito_personalizado", label: "Pedido muito personalizado" },
  { value: "obra_complementar", label: "Pedido com obra extra além da piscina" },
];

const HUMAN_HELP_PAYMENT_OPTIONS: Option[] = [
  { value: "parcelamento_diferente", label: "Parcelamento diferente do padrão" },
  { value: "financiamento_especifico", label: "Pedido de financiamento específico" },
  { value: "prazo_especial", label: "Prazo especial de pagamento" },
  { value: "comprovante_pagamento", label: "Validação manual de pagamento" },
];

const RESPONSIBLE_NOTIFICATION_CASE_OPTIONS: Option[] = [
  { value: "pedido_desconto", label: "Pedido de desconto" },
  { value: "cliente_quase_fechando", label: "Cliente com alta chance de fechar" },
  { value: "duvida_tecnica", label: "Dúvida técnica importante" },
  { value: "pedido_visita", label: "Pedido de visita técnica" },
  { value: "pedido_instalacao", label: "Pedido de instalação" },
  { value: "problema_pagamento", label: "Problema de pagamento" },
];

const ACTIVATION_STYLE_OPTIONS: Option[] = [
  { value: "ia_direta", label: "Mais direta" },
  { value: "ia_humanizada", label: "Mais humana" },
  { value: "priorizar_qualificacao", label: "Priorizar qualificação antes de preço" },
  { value: "priorizar_agendamento", label: "Priorizar visita ou agendamento" },
];

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

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}



function createEmptyPoolForm(): PoolFormState {
  return {
    name: "",
    material: "",
    shape: "",
    width_m: "",
    length_m: "",
    depth_m: "",
    price: "",
    stock_quantity: "",
    description: "",
    is_active: true,
    track_stock: true,
  };
}

function createEmptyCatalogForm(): CatalogFormState {
  return {
    category: "quimicos",
    name: "",
    sku: "",
    brand: "",
    price: "",
    stock_quantity: "",
    description: "",
    is_active: true,
    track_stock: true,
  };
}

function validateSelectedPhotos(files: File[]) {
  if (files.length > 10) {
    return "Cada item pode ter no máximo 10 fotos.";
  }

  const oversized = files.find((file) => file.size > 50 * 1024 * 1024);
  if (oversized) {
    return `A foto ${oversized.name} ultrapassa o limite de 50 MB.`;
  }

  return null;
}

function parseNumberInput(value: string) {
  const normalized = String(value || "").replace(",", ".").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseArrayAnswer(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function yesNoLabel(value: unknown) {
  const normalized = cleanText(value).toLowerCase();
  if (!normalized) return "Não definido";
  if (normalized === "sim") return "Sim";
  if (normalized === "não" || normalized === "nao") return "Não";
  return cleanText(value);
}

function optionLabel(value: string, options: Option[]) {
  return options.find((option) => option.value === value)?.label || value;
}

function joinSelectedLabels(values: string[], options: Option[], extra?: string) {
  const labels = values.map((value) => optionLabel(value, options)).filter(Boolean);
  const safeExtra = cleanText(extra);
  if (safeExtra) labels.push(safeExtra);
  return labels.join(", ");
}

function buildBulletRows(items: Array<{ label: string; value: string }>) {
  return items.filter((item) => cleanText(item.value)).map((item) => `${item.label}: ${item.value}`);
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
  count,
}: {
  href: string;
  title: string;
  count?: number;
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl border border-gray-200 bg-white px-3 py-2 transition hover:border-black/20 hover:bg-gray-50"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="min-w-0 text-sm font-semibold text-gray-900">{title}</h3>
        {typeof count === "number" ? (
          <span className="inline-flex min-w-[1.7rem] shrink-0 justify-center rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-700">
            {count}
          </span>
        ) : null}
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
        "min-w-fit whitespace-nowrap rounded-xl border px-3 py-2 text-left transition",
        active
          ? "border-black bg-black text-white"
          : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
      ].join(" ")}
    >
      <div className="text-[13px] font-semibold leading-tight">{label}</div>
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
  const [answers, setAnswers] = useState<AnswersMap>({});
  const [activeTab, setActiveTab] = useState<SettingsTabId>("visao-geral");
  const [isOverviewEditing, setIsOverviewEditing] = useState(false);
  const [isStrategyEditing, setIsStrategyEditing] = useState(false);
  const [overviewDraft, setOverviewDraft] = useState<Record<string, string>>({});
  const [strategyDraft, setStrategyDraft] = useState<Record<string, string>>({});
  const [poolForm, setPoolForm] = useState<PoolFormState>(createEmptyPoolForm());
  const [poolPhotos, setPoolPhotos] = useState<File[]>([]);
  const [savingPool, setSavingPool] = useState(false);
  const [catalogForm, setCatalogForm] = useState<CatalogFormState>(createEmptyCatalogForm());
  const [catalogPhotos, setCatalogPhotos] = useState<File[]>([]);
  const [savingCatalogItem, setSavingCatalogItem] = useState(false);

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
      setAnswers({});
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorText(null);

    try {
      const [poolsResult, catalogResult, onboardingResult, answersResult] = await Promise.all([
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
        supabase.rpc("onboarding_get_answers_scoped", {
          p_organization_id: organizationId,
          p_store_id: activeStoreId,
        }),
      ]);

      if (poolsResult.error) throw poolsResult.error;
      if (catalogResult.error) throw catalogResult.error;
      if (onboardingResult.error) throw onboardingResult.error;
      if (answersResult.error) throw answersResult.error;

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
      setAnswers((answersResult.data ?? {}) as AnswersMap);
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao carregar a visão geral das configurações.");
    } finally {
      setLoading(false);
    }
  }, [organizationId, activeStoreId]);

  useEffect(() => {
    void fetchPageData();
  }, [fetchPageData]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storageKey = `zion-config-active-tab:${activeStoreId || "sem-loja"}`;
    const savedTab = window.localStorage.getItem(storageKey);
    if (!savedTab) return;

    const isValidTab = tabs.some((tab) => tab.id === savedTab);
    if (isValidTab) {
      setActiveTab(savedTab as SettingsTabId);
    }
  }, [activeStoreId, tabs]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storageKey = `zion-config-active-tab:${activeStoreId || "sem-loja"}`;
    window.localStorage.setItem(storageKey, activeTab);
  }, [activeTab, activeStoreId]);

  useEffect(() => {
    setOverviewDraft({
      store_display_name: cleanText(answers.store_display_name) || storeName,
      responsible_name: cleanText(answers.responsible_name),
      responsible_whatsapp: cleanText(answers.responsible_whatsapp),
      commercial_whatsapp: cleanText(answers.commercial_whatsapp),
      installation_days_rule: cleanText(answers.installation_days_rule),
      technical_visit_days_rule: cleanText(answers.technical_visit_days_rule),
      final_activation_notes: cleanText(answers.final_activation_notes),
    });
  }, [answers, storeName]);

  useEffect(() => {
    setStrategyDraft({
      city: cleanText(answers.city),
      state: cleanText(answers.state),
      service_regions: cleanText(answers.service_regions),
      service_region_notes: cleanText(answers.service_region_notes),
      store_services_other: cleanText(answers.store_services_other),
      store_description: cleanText(answers.store_description),
      main_store_brand: cleanText(answers.main_store_brand),
      brands_worked: cleanText(answers.brands_worked),
    });
  }, [answers]);

  const totalCatalogo = useMemo(
    () => counts.quimicos + counts.acessorios + counts.outros,
    [counts]
  );

  const onboardingStatus = useMemo(
    () => resolveOnboardingLabel(onboarding?.status),
    [onboarding?.status]
  );

  const strategyItems = useMemo(() => {
    const city = cleanText(answers.city);
    const state = cleanText(answers.state);
    const serviceRegions = cleanText(answers.service_regions);
    const services = joinSelectedLabels(
      parseArrayAnswer(answers.store_services),
      STORE_SERVICE_OPTIONS,
      cleanText(answers.store_services_other)
    );
    const regionModes = joinSelectedLabels(
      parseArrayAnswer(answers.service_region_modes),
      SERVICE_REGION_MODE_OPTIONS,
      cleanText(answers.service_region_notes)
    );

    return buildBulletRows([
      { label: "Cidade/região de atendimento", value: [city, state].filter(Boolean).join(" / ") || serviceRegions },
      { label: "Serviços principais da loja", value: services },
      { label: "Tipo de loja / foco comercial", value: cleanText(answers.store_description) },
      { label: "Marca principal / franquia principal", value: cleanText(answers.main_store_brand) || cleanText(answers.brands_worked) },
      { label: "Perfil da operação", value: regionModes },
      { label: "Resumo levantado na entrada da loja", value: cleanText(answers.service_region_notes) || cleanText(answers.store_description) },
    ]);
  }, [answers]);

  const poolsItems = useMemo(() => {
    const poolTypes = joinSelectedLabels(
      parseArrayAnswer(answers.pool_types_selected),
      POOL_TYPE_OPTIONS,
      cleanText(answers.pool_types_other)
    );

    return buildBulletRows([
      { label: "Modelos cadastrados", value: String(counts.pools) },
      { label: "Tipos de piscina trabalhados", value: poolTypes || cleanText(answers.pool_types) },
      { label: "Material", value: poolTypes },
      { label: "Marca", value: cleanText(answers.main_store_brand) || cleanText(answers.brands_worked) },
      { label: "Fotos", value: counts.pools > 0 ? "Gerenciadas na aba interna de piscinas" : "Ainda sem piscinas cadastradas" },
      { label: "Preço base", value: counts.pools > 0 ? "Editável na aba de piscinas" : "" },
      { label: "Ativo/inativo", value: counts.pools > 0 ? "Controlado item por item na aba de piscinas" : "" },
      { label: "Edição e exclusão", value: "Disponíveis na página interna de piscinas" },
      { label: "Importação inteligente assistida", value: "Planejada para evolução do fluxo" },
    ]);
  }, [answers, counts.pools]);

  const catalogItems = useMemo(() => {
    return buildBulletRows([
      { label: "Produtos químicos", value: String(counts.quimicos) },
      { label: "Acessórios", value: String(counts.acessorios) },
      { label: "Outros itens", value: String(counts.outros) },
      { label: "Fotos", value: totalCatalogo > 0 ? "Gerenciadas por item nas páginas internas" : "" },
      { label: "Preço", value: totalCatalogo > 0 ? "Controlado por item" : "" },
      { label: "Estoque", value: totalCatalogo > 0 ? "Controlado por item" : "" },
      { label: "SKU", value: totalCatalogo > 0 ? "Controlado por item" : "" },
      { label: "Ativo/inativo", value: totalCatalogo > 0 ? "Controlado por item" : "" },
      { label: "Edição e exclusão", value: "Disponíveis nas páginas internas de catálogo" },
      { label: "Importação futura assistida", value: "Mantida como parte da evolução do catálogo" },
    ]);
  }, [counts.quimicos, counts.acessorios, counts.outros, totalCatalogo]);

  const operationItems = useMemo(() => {
    const installationDays = joinSelectedLabels(
      parseArrayAnswer(answers.installation_available_days),
      DAYS_OF_WEEK_OPTIONS
    );
    const visitDays = joinSelectedLabels(
      parseArrayAnswer(answers.technical_visit_available_days),
      DAYS_OF_WEEK_OPTIONS
    );
    const visitRules = joinSelectedLabels(
      parseArrayAnswer(answers.technical_visit_rules_selected),
      TECHNICAL_VISIT_RULE_OPTIONS,
      cleanText(answers.technical_visit_rules_other)
    );
    const limitations = joinSelectedLabels(
      parseArrayAnswer(answers.important_limitations_selected),
      IMPORTANT_LIMITATION_OPTIONS,
      cleanText(answers.important_limitations_other)
    );

    return buildBulletRows([
      { label: "Faz instalação", value: yesNoLabel(answers.offers_installation) },
      { label: "Faz visita técnica", value: yesNoLabel(answers.offers_technical_visit) },
      { label: "Cobra visita", value: cleanText(answers.technical_visit_rules_other) || "Ver regras da visita técnica" },
      { label: "Prazo médio", value: cleanText(answers.average_installation_time_days) },
      { label: "Dias/horários de instalação", value: installationDays || cleanText(answers.installation_days_rule) },
      { label: "Disponibilidade por dia para visita", value: visitDays || cleanText(answers.technical_visit_days_rule) },
      { label: "Regiões atendidas", value: cleanText(answers.service_regions) || cleanText(answers.service_region_notes) },
      { label: "Limitações importantes", value: limitations },
      { label: "Regras da agenda", value: visitRules },
      { label: "Mais de um compromisso por dia", value: cleanText(answers.installation_days_rule) || cleanText(answers.technical_visit_days_rule) },
      { label: "Mesmo horário", value: cleanText(answers.technical_visit_days_rule) },
      { label: "Quantidade máxima por faixa", value: cleanText(answers.average_human_response_time) },
    ]);
  }, [answers]);

  const commercialItems = useMemo(() => {
    const payments = joinSelectedLabels(
      parseArrayAnswer(answers.accepted_payment_methods),
      PAYMENT_METHOD_MAIN_OPTIONS
    );
    const priceBefore = joinSelectedLabels(
      parseArrayAnswer(answers.price_must_understand_before),
      PRICE_DIRECT_BEFORE_OPTIONS
    );
    const discountCases = joinSelectedLabels(
      parseArrayAnswer(answers.human_help_discount_cases_selected),
      HUMAN_HELP_DISCOUNT_OPTIONS,
      cleanText(answers.human_help_discount_cases_other)
    );
    const customProjectCases = joinSelectedLabels(
      parseArrayAnswer(answers.human_help_custom_project_cases_selected),
      HUMAN_HELP_CUSTOM_PROJECT_OPTIONS,
      cleanText(answers.human_help_custom_project_cases_other)
    );
    const paymentCases = joinSelectedLabels(
      parseArrayAnswer(answers.human_help_payment_cases_selected),
      HUMAN_HELP_PAYMENT_OPTIONS,
      cleanText(answers.human_help_payment_cases_other)
    );

    return buildBulletRows([
      { label: "Nome que a IA usa no atendimento", value: cleanText(answers.responsible_name) ? `Base atual da loja: ${cleanText(answers.responsible_name)}` : cleanText(answers.store_display_name) },
      { label: "Como a IA deve se apresentar", value: cleanText(answers.price_talk_mode) || "Revisar no onboarding comercial" },
      { label: "Tom da IA", value: joinSelectedLabels(parseArrayAnswer(answers.activation_preferences), ACTIVATION_STYLE_OPTIONS, cleanText(answers.activation_preferences_other)) },
      { label: "Fala como pessoa ou equipe", value: cleanText(answers.ai_should_notify_responsible) || "Revisar ativação" },
      { label: "Quando pode falar preço", value: yesNoLabel(answers.ai_can_send_price_directly) },
      { label: "Quando deve chamar humano", value: [discountCases, customProjectCases, paymentCases].filter(Boolean).join(" • ") },
      { label: "Política comercial geral", value: cleanText(answers.price_direct_rule) || cleanText(answers.price_direct_rule_other) },
      { label: "Formas de pagamento", value: payments },
      { label: "Regras gerais de negociação", value: cleanText(answers.price_direct_conditions) || cleanText(answers.price_needs_human_help) },
      { label: "Pode trabalhar com desconto", value: `${yesNoLabel(answers.can_offer_discount)}${cleanText(answers.max_discount_percent) ? ` • máx. ${cleanText(answers.max_discount_percent)}%` : ""}` },
      { label: "Limites de promessa da IA", value: cleanText(answers.final_activation_notes) || cleanText(answers.store_description) },
      { label: "Regras de pós-venda", value: cleanText(answers.sales_flow_final_steps) || cleanText(answers.sales_flow_notes) },
      { label: "Comportamento fora do horário", value: priceBefore },
    ]);
  }, [answers]);

  const activationItems = useMemo(() => {
    const notificationCases = joinSelectedLabels(
      parseArrayAnswer(answers.responsible_notification_cases),
      RESPONSIBLE_NOTIFICATION_CASE_OPTIONS,
      cleanText(answers.responsible_notification_cases_other)
    );
    const activationPrefs = joinSelectedLabels(
      parseArrayAnswer(answers.activation_preferences),
      ACTIVATION_STYLE_OPTIONS,
      cleanText(answers.activation_preferences_other)
    );

    return buildBulletRows([
      { label: "Responsável principal", value: cleanText(answers.responsible_name) },
      { label: "WhatsApp do responsável", value: cleanText(answers.responsible_whatsapp) },
      { label: "Responsável secundário", value: cleanText(answers.final_activation_notes) },
      { label: "Canal para falar com a IA assistente", value: activationPrefs },
      { label: "Web chat interno", value: "Previsto como canal do sistema" },
      { label: "WhatsApp do responsável", value: cleanText(answers.responsible_whatsapp) },
      { label: "Número/chip dedicado", value: cleanText(answers.commercial_whatsapp) },
      { label: "Futuro Telegram", value: "Previsto para expansão" },
      { label: "Dados mínimos para ativação", value: yesNoLabel(answers.confirm_information_is_correct) },
      { label: "Checklist de ativação real", value: notificationCases },
      { label: "Status da ativação da loja", value: resolveOnboardingLabel(onboarding?.status).label },
    ]);
  }, [answers, onboarding?.status]);

  const discountItems = useMemo(() => {
    return buildBulletRows([
      { label: "Regra geral de desconto", value: yesNoLabel(answers.can_offer_discount) },
      { label: "Limite máximo", value: cleanText(answers.max_discount_percent) ? `${cleanText(answers.max_discount_percent)}%` : "" },
      { label: "Quando precisa aprovação humana", value: joinSelectedLabels(parseArrayAnswer(answers.human_help_discount_cases_selected), HUMAN_HELP_DISCOUNT_OPTIONS, cleanText(answers.human_help_discount_cases_other)) },
      { label: "Quem aprova", value: cleanText(answers.responsible_name) || "Responsável principal" },
      { label: "Histórico de pedidos de desconto", value: "Ainda não exibido nesta tela" },
      { label: "Regras especiais por tipo de item", value: cleanText(answers.price_direct_rule_other) },
    ]);
  }, [answers]);

  const integrationItems = useMemo(() => {
    return buildBulletRows([
      { label: "WhatsApp comercial da loja", value: cleanText(answers.commercial_whatsapp) },
      { label: "Canal do responsável", value: cleanText(answers.responsible_whatsapp) },
      { label: "Integrações externas", value: cleanText(answers.activation_preferences_other) || "Ainda em definição" },
      { label: "Site da loja", value: cleanText(answers.store_description) },
      { label: "Logo da loja", value: "Ajustar quando houver upload/identidade visual" },
      { label: "Dados para PDF, orçamento e contrato", value: cleanText(answers.store_display_name) || storeName },
      { label: "Status das integrações", value: resolveOnboardingLabel(onboarding?.status).label },
    ]);
  }, [answers, storeName, onboarding?.status]);

  const identityItems = useMemo(() => {
    return buildBulletRows([
      { label: "Nome da loja", value: cleanText(answers.store_display_name) || storeName },
      { label: "Logo", value: "Ajustar quando houver logo cadastrada" },
      { label: "Cores", value: "Ainda não configuradas nesta tela" },
      { label: "Nome que a IA usa", value: cleanText(answers.store_display_name) || storeName },
      { label: "Assinatura padrão da IA", value: cleanText(answers.store_description) },
      { label: "Dados usados em orçamento e contrato", value: cleanText(answers.store_display_name) || storeName },
    ]);
  }, [answers, storeName]);

  const overviewSummary = useMemo(() => {
    const responsible = cleanText(answers.responsible_name);
    const responsibleWhatsapp = cleanText(answers.responsible_whatsapp);

    return [
      `Loja ativa: ${storeName}.`,
      `Status da configuração: ${onboardingStatus.label.toLowerCase()}.`,
      `Piscinas cadastradas: ${counts.pools}.`,
      `Catálogo geral: ${totalCatalogo} itens (${counts.quimicos} químicos, ${counts.acessorios} acessórios e ${counts.outros} outros).`,
      responsible ? `Responsável principal: ${responsible}${responsibleWhatsapp ? ` • ${responsibleWhatsapp}` : ""}.` : "",
    ].filter(Boolean);
  }, [
    storeName,
    onboardingStatus.label,
    counts.pools,
    totalCatalogo,
    counts.quimicos,
    counts.acessorios,
    counts.outros,
    answers,
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
    if (!cleanText(answers.responsible_name)) {
      list.push("Definir o responsável principal da loja.");
    }
    if (!cleanText(answers.responsible_whatsapp)) {
      list.push("Definir o WhatsApp do responsável.");
    }

    return list;
  }, [counts.pools, totalCatalogo, onboardingStatus.label, answers]);

  const shouldShowQuickAccess =
    activeTab === "visao-geral" ||
    activeTab === "piscinas" ||
    activeTab === "produtos-acessorios";

  const handleOverviewDraftChange = useCallback((key: string, value: string) => {
    setOverviewDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const handleOverviewEditCancel = useCallback(() => {
    setOverviewDraft({
      store_display_name: cleanText(answers.store_display_name) || storeName,
      responsible_name: cleanText(answers.responsible_name),
      responsible_whatsapp: cleanText(answers.responsible_whatsapp),
      commercial_whatsapp: cleanText(answers.commercial_whatsapp),
      installation_days_rule: cleanText(answers.installation_days_rule),
      technical_visit_days_rule: cleanText(answers.technical_visit_days_rule),
      final_activation_notes: cleanText(answers.final_activation_notes),
    });
    setIsOverviewEditing(false);
  }, [answers, storeName]);

  const handleOverviewEditSave = useCallback(() => {
    setAnswers((current) => ({
      ...current,
      store_display_name: overviewDraft.store_display_name,
      responsible_name: overviewDraft.responsible_name,
      responsible_whatsapp: overviewDraft.responsible_whatsapp,
      commercial_whatsapp: overviewDraft.commercial_whatsapp,
      installation_days_rule: overviewDraft.installation_days_rule,
      technical_visit_days_rule: overviewDraft.technical_visit_days_rule,
      final_activation_notes: overviewDraft.final_activation_notes,
    }));
    setSuccessText("Alterações da visão geral atualizadas nesta tela.");
    setErrorText(null);
    setIsOverviewEditing(false);
  }, [overviewDraft]);

  const handleStrategyDraftChange = useCallback((key: string, value: string) => {
    setStrategyDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const handleStrategyEditOpen = useCallback(() => {
    setStrategyDraft({
      city: cleanText(answers.city),
      state: cleanText(answers.state),
      service_regions: cleanText(answers.service_regions),
      service_region_notes: cleanText(answers.service_region_notes),
      store_services_other: cleanText(answers.store_services_other),
      store_description: cleanText(answers.store_description),
      main_store_brand: cleanText(answers.main_store_brand),
      brands_worked: cleanText(answers.brands_worked),
    });
    setIsStrategyEditing(true);
  }, [answers]);

  const handleStrategyEditCancel = useCallback(() => {
    setStrategyDraft({
      city: cleanText(answers.city),
      state: cleanText(answers.state),
      service_regions: cleanText(answers.service_regions),
      service_region_notes: cleanText(answers.service_region_notes),
      store_services_other: cleanText(answers.store_services_other),
      store_description: cleanText(answers.store_description),
      main_store_brand: cleanText(answers.main_store_brand),
      brands_worked: cleanText(answers.brands_worked),
    });
    setIsStrategyEditing(false);
  }, [answers]);

  const handleStrategyEditSave = useCallback(() => {
    setAnswers((current) => ({
      ...current,
      city: strategyDraft.city,
      state: strategyDraft.state,
      service_regions: strategyDraft.service_regions,
      service_region_notes: strategyDraft.service_region_notes,
      store_services_other: strategyDraft.store_services_other,
      store_description: strategyDraft.store_description,
      main_store_brand: strategyDraft.main_store_brand,
      brands_worked: strategyDraft.brands_worked,
    }));
    setSuccessText("Alterações da estratégia atualizadas nesta tela.");
    setErrorText(null);
    setIsStrategyEditing(false);
  }, [strategyDraft]);

  const handlePoolFormChange = useCallback(
    (key: keyof PoolFormState, value: string | boolean) => {
      setPoolForm((current) => ({
        ...current,
        [key]: value,
      } as PoolFormState));
    },
    []
  );

  const handlePoolPhotosChange = useCallback((fileList: FileList | null) => {
    const selectedFiles = Array.from(fileList || []);
    const validationError = validateSelectedPhotos(selectedFiles);

    if (validationError) {
      setErrorText(validationError);
      return;
    }

    setPoolPhotos(selectedFiles);
    setErrorText(null);
  }, []);

  const handleSaveManualPool = useCallback(async () => {
    const poolName = cleanText(poolForm.name);
    if (!poolName) {
      setErrorText("Preencha pelo menos o nome da piscina antes de salvar.");
      setSuccessText(null);
      return;
    }

    const poolPhotosError = validateSelectedPhotos(poolPhotos);
    if (poolPhotosError) {
      setErrorText(poolPhotosError);
      setSuccessText(null);
      return;
    }

    if (!organizationId || !activeStoreId) {
      setErrorText("Nenhuma loja ativa foi encontrada para salvar a piscina.");
      setSuccessText(null);
      return;
    }

    setSavingPool(true);
    setErrorText(null);
    setSuccessText(null);

    try {
      const insertPayload = {
        organization_id: organizationId,
        store_id: activeStoreId,
        name: poolName,
        description: cleanText(poolForm.description) || null,
        price: parseNumberInput(poolForm.price),
        stock_quantity: parseNumberInput(poolForm.stock_quantity),
        is_active: poolForm.is_active,
        track_stock: poolForm.track_stock,
        metadata: {
          material: cleanText(poolForm.material) || null,
          shape: cleanText(poolForm.shape) || null,
          width_m: parseNumberInput(poolForm.width_m),
          length_m: parseNumberInput(poolForm.length_m),
          depth_m: parseNumberInput(poolForm.depth_m),
          manual_created_in_configuracoes: true,
          pending_photo_upload_count: poolPhotos.length,
        },
      };

      const { error } = await supabase.from("pools").insert(insertPayload);
      if (error) throw error;

      setPoolForm(createEmptyPoolForm());
      setPoolPhotos([]);
      setCounts((current) => ({
        ...current,
        pools: current.pools + 1,
      }));
      setSuccessText(
        poolPhotos.length > 0
          ? "Piscina salva. As fotos ainda precisam ser conectadas ao fluxo final de upload sem quebrar o restante do sistema."
          : "Piscina salva com sucesso."
      );
      await fetchPageData();
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao salvar a piscina manualmente.");
    } finally {
      setSavingPool(false);
    }
  }, [organizationId, activeStoreId, poolForm, poolPhotos, fetchPageData]);

  const handleCatalogFormChange = useCallback(
    (key: keyof CatalogFormState, value: string | boolean) => {
      setCatalogForm((current) => ({
        ...current,
        [key]: value,
      } as CatalogFormState));
    },
    []
  );

  const handleCatalogPhotosChange = useCallback((fileList: FileList | null) => {
    const selectedFiles = Array.from(fileList || []);
    const validationError = validateSelectedPhotos(selectedFiles);

    if (validationError) {
      setErrorText(validationError);
      return;
    }

    setCatalogPhotos(selectedFiles);
    setErrorText(null);
  }, []);

  const handleSaveManualCatalogItem = useCallback(async () => {
    const itemName = cleanText(catalogForm.name);
    if (!itemName) {
      setErrorText("Preencha pelo menos o nome do item antes de salvar.");
      setSuccessText(null);
      return;
    }

    const catalogPhotosError = validateSelectedPhotos(catalogPhotos);
    if (catalogPhotosError) {
      setErrorText(catalogPhotosError);
      setSuccessText(null);
      return;
    }

    if (!organizationId || !activeStoreId) {
      setErrorText("Nenhuma loja ativa foi encontrada para salvar o item do catálogo.");
      setSuccessText(null);
      return;
    }

    setSavingCatalogItem(true);
    setErrorText(null);
    setSuccessText(null);

    try {
      const parsedPrice = parseNumberInput(catalogForm.price);
      const parsedStock = parseNumberInput(catalogForm.stock_quantity);
      const insertPayload = {
        organization_id: organizationId,
        store_id: activeStoreId,
        sku: cleanText(catalogForm.sku) || null,
        name: itemName,
        description: cleanText(catalogForm.description) || null,
        price_cents: parsedPrice === null ? null : Math.round(parsedPrice * 100),
        currency: "BRL",
        is_active: catalogForm.is_active,
        track_stock: catalogForm.track_stock,
        stock_quantity: parsedStock === null ? null : Math.round(parsedStock),
        metadata: {
          categoria: catalogForm.category,
          brand: cleanText(catalogForm.brand) || null,
          manual_created_in_configuracoes: true,
          pending_photo_upload_count: catalogPhotos.length,
        },
      };

      const { error } = await supabase.from("store_catalog_items").insert(insertPayload);
      if (error) throw error;

      setCatalogForm(createEmptyCatalogForm());
      setCatalogPhotos([]);
      setCounts((current) => ({
        ...current,
        [catalogForm.category]: current[catalogForm.category] + 1,
      }));
      setSuccessText(
        catalogPhotos.length > 0
          ? "Item salvo. As fotos ainda precisam ser conectadas ao fluxo final de upload sem quebrar o restante do sistema."
          : "Item salvo com sucesso."
      );
      await fetchPageData();
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao salvar o item manualmente.");
    } finally {
      setSavingCatalogItem(false);
    }
  }, [organizationId, activeStoreId, catalogForm, catalogPhotos, fetchPageData]);

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
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-black tracking-[-0.02em] text-black">Configurações</h1>
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

      <section className="rounded-2xl border border-gray-200 bg-white px-4 py-3">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-gray-900">Áreas da configuração</h2>
        </div>

        <div className="px-1 pb-1">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            {tabs.map((tab) => (
              <SettingsTabButton
                key={tab.id}
                active={activeTab === tab.id}
                label={tab.label}
                onClick={() => setActiveTab(tab.id)}
              />
            ))}
          </div>
        </div>
      </section>

      {shouldShowQuickAccess ? (
        <SectionBlock
          title="Acessos rápidos"
          actions={loading ? <span className="text-xs text-gray-500">Carregando...</span> : null}
        >
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            <QuickCard href="/configuracoes/piscinas" title="Piscinas" count={counts.pools} />
            <QuickCard href="/configuracoes/catalogo/quimicos" title="Químicos" count={counts.quimicos} />
            <QuickCard href="/configuracoes/catalogo/acessorios" title="Acessórios" count={counts.acessorios} />
            <QuickCard href="/configuracoes/catalogo/outros" title="Outros" count={counts.outros} />
          </div>
        </SectionBlock>
      ) : null}

      {activeTab === "visao-geral" ? (
        <SectionBlock title="Controle da configuração">
          <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_220px_220px]">
            <div className="flex items-start">
              <button
                type="button"
                onClick={() => void handleDeleteAllCatalog()}
                disabled={!hasValidStoreContext || deletingCatalog || totalCatalogo === 0}
                className="rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deletingCatalog ? "Apagando catálogo..." : "Apagar todo o catálogo"}
              </button>
            </div>

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
        </SectionBlock>
      ) : null}

      {activeTab === "visao-geral" ? (
        <SectionBlock
          title="1. Visão Geral"
          description="Tela-resumo da loja com status, pendências e prontidão operacional."
          actions={
            isOverviewEditing ? (
              <>
                <button
                  type="button"
                  onClick={handleOverviewEditSave}
                  className="rounded-xl border border-black bg-black px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90"
                >
                  Salvar
                </button>
                <button
                  type="button"
                  onClick={handleOverviewEditCancel}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
                >
                  Cancelar
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setIsOverviewEditing(true)}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
              >
                Editar
              </button>
            )
          }
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
              value={cleanText(answers.commercial_whatsapp) ? "Configurado" : "Pendente"}
              tone={cleanText(answers.commercial_whatsapp) ? "green" : "red"}
              hint={cleanText(answers.commercial_whatsapp) || "WhatsApp comercial ainda não definido"}
            />
            <StatusCard
              label="Canal da assistente"
              value={cleanText(answers.responsible_whatsapp) ? "Configurado" : "Pendente"}
              tone={cleanText(answers.responsible_whatsapp) ? "green" : "amber"}
              hint={cleanText(answers.responsible_whatsapp) || "Canal do responsável ainda não definido"}
            />
            <StatusCard
              label="Agenda"
              value={cleanText(answers.installation_days_rule) || cleanText(answers.technical_visit_days_rule) ? "Configurada" : "Pendente"}
              tone={cleanText(answers.installation_days_rule) || cleanText(answers.technical_visit_days_rule) ? "green" : "amber"}
              hint="Regras de disponibilidade e operação"
            />
            <StatusCard
              label="Prontidão da IA"
              value={iaReadiness.value}
              tone={iaReadiness.tone}
              hint={iaReadiness.hint}
            />
          </div>

          {isOverviewEditing ? (
            <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <div className="mb-3 text-sm font-semibold text-gray-900">Editar visão geral na mesma página</div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
                    Nome da loja
                  </span>
                  <input
                    value={overviewDraft.store_display_name ?? ""}
                    onChange={(event) => handleOverviewDraftChange("store_display_name", event.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
                    Responsável principal
                  </span>
                  <input
                    value={overviewDraft.responsible_name ?? ""}
                    onChange={(event) => handleOverviewDraftChange("responsible_name", event.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
                    WhatsApp do responsável
                  </span>
                  <input
                    value={overviewDraft.responsible_whatsapp ?? ""}
                    onChange={(event) => handleOverviewDraftChange("responsible_whatsapp", event.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
                    WhatsApp comercial
                  </span>
                  <input
                    value={overviewDraft.commercial_whatsapp ?? ""}
                    onChange={(event) => handleOverviewDraftChange("commercial_whatsapp", event.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
                    Regra principal da agenda
                  </span>
                  <input
                    value={overviewDraft.installation_days_rule ?? ""}
                    onChange={(event) => handleOverviewDraftChange("installation_days_rule", event.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
                    Regra de visita técnica
                  </span>
                  <input
                    value={overviewDraft.technical_visit_days_rule ?? ""}
                    onChange={(event) => handleOverviewDraftChange("technical_visit_days_rule", event.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  />
                </label>

                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
                    Observações da configuração
                  </span>
                  <textarea
                    value={overviewDraft.final_activation_notes ?? ""}
                    onChange={(event) => handleOverviewDraftChange("final_activation_notes", event.target.value)}
                    rows={4}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  />
                </label>
              </div>
            </div>
          ) : null}

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

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-2 text-sm font-semibold text-gray-900">Responsáveis e acesso</div>
              <SummaryList
                items={buildBulletRows([
                  { label: "Responsável principal", value: cleanText(answers.responsible_name) },
                  { label: "WhatsApp do responsável", value: cleanText(answers.responsible_whatsapp) },
                  { label: "Quem tem acesso ao sistema", value: cleanText(answers.responsible_name) || "Responsável principal da loja" },
                ])}
              />
            </div>
            <div>
              <div className="mb-2 text-sm font-semibold text-gray-900">Acesso rápido para outras abas</div>
              <SummaryList
                items={[
                  "Estratégia para revisar a base da loja.",
                  "Piscinas para revisar a oferta de piscinas.",
                  "Produtos/Acessórios para revisar catálogo, estoque e SKU.",
                  "Operação, Comercial e IA e Ativação para validar o comportamento real da loja.",
                ]}
              />
            </div>
          </div>
        </SectionBlock>
      ) : null}

      {activeTab === "estrategia" ? (
        <SectionBlock
          title="2. Estratégia"
          description="Base principal da loja para contexto comercial, regiões, serviços e posicionamento."
          actions={
            isStrategyEditing ? (
              <>
                <button
                  type="button"
                  onClick={handleStrategyEditSave}
                  className="rounded-xl border border-black bg-black px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90"
                >
                  Salvar
                </button>
                <button
                  type="button"
                  onClick={handleStrategyEditCancel}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
                >
                  Cancelar
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleStrategyEditOpen}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
              >
                Editar
              </button>
            )
          }
        >
          {isStrategyEditing ? (
            <div className="rounded-2xl border border-black/10 bg-gray-50 p-4">
              <div className="mb-1 text-sm font-semibold text-gray-900">Editar estratégia na mesma página</div>
              <div className="mb-3 text-xs text-gray-600">
                Aqui você pode completar ou adicionar informações que estejam faltando no onboarding.
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
                    Cidade
                  </span>
                  <input
                    value={strategyDraft.city ?? ""}
                    onChange={(event) => handleStrategyDraftChange("city", event.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
                    Estado
                  </span>
                  <input
                    value={strategyDraft.state ?? ""}
                    onChange={(event) => handleStrategyDraftChange("state", event.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  />
                </label>

                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
                    Região de atendimento
                  </span>
                  <input
                    value={strategyDraft.service_regions ?? ""}
                    onChange={(event) => handleStrategyDraftChange("service_regions", event.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  />
                </label>

                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
                    Serviços adicionais ou faltando
                  </span>
                  <input
                    value={strategyDraft.store_services_other ?? ""}
                    onChange={(event) => handleStrategyDraftChange("store_services_other", event.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                    placeholder="Ex.: reforma, assistência, automação..."
                  />
                </label>

                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
                    Descrição da loja
                  </span>
                  <textarea
                    value={strategyDraft.store_description ?? ""}
                    onChange={(event) => handleStrategyDraftChange("store_description", event.target.value)}
                    rows={3}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
                    Marca principal
                  </span>
                  <input
                    value={strategyDraft.main_store_brand ?? ""}
                    onChange={(event) => handleStrategyDraftChange("main_store_brand", event.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
                    Outras marcas
                  </span>
                  <input
                    value={strategyDraft.brands_worked ?? ""}
                    onChange={(event) => handleStrategyDraftChange("brands_worked", event.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  />
                </label>

                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
                    Observações de região e posicionamento
                  </span>
                  <textarea
                    value={strategyDraft.service_region_notes ?? ""}
                    onChange={(event) => handleStrategyDraftChange("service_region_notes", event.target.value)}
                    rows={3}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  />
                </label>
              </div>
            </div>
          ) : (
            <SummaryList items={strategyItems} />
          )}
        </SectionBlock>
      ) : null}

      {activeTab === "piscinas" ? (
        <div className="space-y-4">
          <SectionBlock
            title="Adicionar piscina manualmente"
            description="Cadastre uma piscina por aqui sem depender do onboarding. Você pode subir até 10 fotos por item, com no máximo 50 MB por foto."
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="space-y-1 md:col-span-2 xl:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Nome da piscina</span>
                <input
                  value={poolForm.name}
                  onChange={(event) => handlePoolFormChange("name", event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  placeholder="Ex.: Piscina Fibra Premium 7x3"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Material</span>
                <input
                  value={poolForm.material}
                  onChange={(event) => handlePoolFormChange("material", event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  placeholder="Fibra, vinil, alvenaria..."
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Formato</span>
                <input
                  value={poolForm.shape}
                  onChange={(event) => handlePoolFormChange("shape", event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  placeholder="Retangular, oval..."
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Largura (m)</span>
                <input
                  value={poolForm.width_m}
                  onChange={(event) => handlePoolFormChange("width_m", event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  placeholder="3.00"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Comprimento (m)</span>
                <input
                  value={poolForm.length_m}
                  onChange={(event) => handlePoolFormChange("length_m", event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  placeholder="7.00"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Profundidade (m)</span>
                <input
                  value={poolForm.depth_m}
                  onChange={(event) => handlePoolFormChange("depth_m", event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  placeholder="1.40"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Preço</span>
                <input
                  value={poolForm.price}
                  onChange={(event) => handlePoolFormChange("price", event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  placeholder="15990"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Estoque</span>
                <input
                  value={poolForm.stock_quantity}
                  onChange={(event) => handlePoolFormChange("stock_quantity", event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  placeholder="0"
                />
              </label>

              <label className="space-y-1 md:col-span-2 xl:col-span-4">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Descrição completa</span>
                <textarea
                  value={poolForm.description}
                  onChange={(event) => handlePoolFormChange("description", event.target.value)}
                  rows={4}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  placeholder="Descreva acabamento, diferenciais, instalação, cor, acessórios inclusos e qualquer detalhe importante."
                />
              </label>

              <label className="space-y-1 md:col-span-2 xl:col-span-4">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Fotos da piscina</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(event) => handlePoolPhotosChange(event.target.files)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 file:mr-3 file:rounded-lg file:border-0 file:bg-black file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
                />
                <div className="text-xs text-gray-500">Máximo de 10 fotos por piscina. Cada foto pode ter até 50 MB.</div>
                {poolPhotos.length > 0 ? (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                    {poolPhotos.length} foto(s) selecionada(s): {poolPhotos.map((file) => file.name).join(", ")}
                  </div>
                ) : null}
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={poolForm.is_active}
                  onChange={(event) => handlePoolFormChange("is_active", event.target.checked)}
                />
                Piscina em estado vendível / ativa
              </label>

              <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={poolForm.track_stock}
                  onChange={(event) => handlePoolFormChange("track_stock", event.target.checked)}
                />
                Controlar estoque desta piscina
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleSaveManualPool()}
                disabled={!hasValidStoreContext || savingPool}
                className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingPool ? "Salvando piscina..." : "Salvar piscina"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPoolForm(createEmptyPoolForm());
                  setPoolPhotos([]);
                }}
                disabled={savingPool}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Limpar formulário
              </button>
            </div>
          </SectionBlock>

          <SectionBlock
            title="3. Piscinas"
            description="Tudo sobre a oferta de piscinas da loja."
          >
            <SummaryList items={poolsItems} />
          </SectionBlock>
        </div>
      ) : null}

      {activeTab === "produtos-acessorios" ? (
        <div className="space-y-4">
          <SectionBlock
            title="Adicionar produto, acessório ou outro manualmente"
            description="Cadastre um item por aqui sem depender do onboarding. Você pode subir até 10 fotos por item, com no máximo 50 MB por foto."
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Categoria</span>
                <select
                  value={catalogForm.category}
                  onChange={(event) => handleCatalogFormChange("category", event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                >
                  <option value="quimicos">Químicos</option>
                  <option value="acessorios">Acessórios</option>
                  <option value="outros">Outros</option>
                </select>
              </label>

              <label className="space-y-1 md:col-span-2 xl:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Nome do item</span>
                <input
                  value={catalogForm.name}
                  onChange={(event) => handleCatalogFormChange("name", event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  placeholder="Ex.: Cloro granulado premium"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">SKU</span>
                <input
                  value={catalogForm.sku}
                  onChange={(event) => handleCatalogFormChange("sku", event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  placeholder="Opcional"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Marca</span>
                <input
                  value={catalogForm.brand}
                  onChange={(event) => handleCatalogFormChange("brand", event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  placeholder="Marca do item"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Preço</span>
                <input
                  value={catalogForm.price}
                  onChange={(event) => handleCatalogFormChange("price", event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  placeholder="59,90"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Estoque</span>
                <input
                  value={catalogForm.stock_quantity}
                  onChange={(event) => handleCatalogFormChange("stock_quantity", event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  placeholder="0"
                />
              </label>

              <label className="space-y-1 md:col-span-2 xl:col-span-4">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Descrição completa</span>
                <textarea
                  value={catalogForm.description}
                  onChange={(event) => handleCatalogFormChange("description", event.target.value)}
                  rows={4}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  placeholder="Descreva composição, litragem, aplicação, medidas, uso recomendado e detalhes importantes."
                />
              </label>

              <label className="space-y-1 md:col-span-2 xl:col-span-4">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Fotos do item</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(event) => handleCatalogPhotosChange(event.target.files)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 file:mr-3 file:rounded-lg file:border-0 file:bg-black file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
                />
                <div className="text-xs text-gray-500">Máximo de 10 fotos por item. Cada foto pode ter até 50 MB.</div>
                {catalogPhotos.length > 0 ? (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                    {catalogPhotos.length} foto(s) selecionada(s): {catalogPhotos.map((file) => file.name).join(", ")}
                  </div>
                ) : null}
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={catalogForm.is_active}
                  onChange={(event) => handleCatalogFormChange("is_active", event.target.checked)}
                />
                Item em estado vendível / ativo
              </label>

              <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={catalogForm.track_stock}
                  onChange={(event) => handleCatalogFormChange("track_stock", event.target.checked)}
                />
                Controlar estoque deste item
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleSaveManualCatalogItem()}
                disabled={!hasValidStoreContext || savingCatalogItem}
                className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingCatalogItem ? "Salvando item..." : "Salvar item"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCatalogForm(createEmptyCatalogForm());
                  setCatalogPhotos([]);
                }}
                disabled={savingCatalogItem}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Limpar formulário
              </button>
            </div>
          </SectionBlock>

          <SectionBlock
            title="4. Produtos/Acessórios"
            description="No lugar do catálogo geral, com separação clara por categoria."
          >
            <SummaryList items={catalogItems} />
          </SectionBlock>
        </div>
      ) : null}

      {activeTab === "operacao" ? (
        <SectionBlock
          title="5. Operação"
          description="Regras reais da operação da loja e da agenda operacional."
        >
          <SummaryList items={operationItems} />
        </SectionBlock>
      ) : null}

      {activeTab === "comercial-ia" ? (
        <SectionBlock
          title="6. Comercial e IA"
          description="Regras comerciais vivas que a IA vendedora deve obedecer."
        >
          <SummaryList items={commercialItems} />
        </SectionBlock>
      ) : null}

      {activeTab === "responsavel-ativacao" ? (
        <SectionBlock
          title="7. Responsável e ativação"
          description="Ponte entre IA e humano responsável."
        >
          <SummaryList items={activationItems} />
        </SectionBlock>
      ) : null}

      {activeTab === "descontos" ? (
        <SectionBlock
          title="8. Descontos"
          description="Módulo próprio, mas sem brigar com Comercial e IA."
        >
          <SummaryList items={discountItems} />
        </SectionBlock>
      ) : null}

      {activeTab === "canais-integracoes" ? (
        <SectionBlock
          title="9. Canais e integrações"
          description="WhatsApp comercial, canal do responsável e integrações externas."
        >
          <SummaryList items={integrationItems} />
        </SectionBlock>
      ) : null}

      {activeTab === "identidade" ? (
        <SectionBlock
          title="10. Identidade da loja"
          description="Nome, assinatura e dados institucionais usados pela IA e pelos documentos da loja."
        >
          <SummaryList items={identityItems} />
        </SectionBlock>
      ) : null}
    </div>
  );
}