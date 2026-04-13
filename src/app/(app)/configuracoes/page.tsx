"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type StoreImportFileRow = {
  id: string;
  organization_id: string;
  store_id: string;
  source: string | null;
  original_file_name: string | null;
  mime_type: string | null;
  extension: string | null;
  size_bytes: number | null;
  storage_bucket: string | null;
  storage_path: string | null;
  import_summary?: Record<string, unknown> | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
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
  brand: string;
  material: string;
  shape: string;
  color: string;
  finish: string;
  width_m: string;
  length_m: string;
  depth_m: string;
  price: string;
  stock_quantity: string;
  description: string;
  included_items: string;
  installation_notes: string;
  is_active: boolean;
  track_stock: boolean;
};

type CatalogFormState = {
  category: "quimicos" | "acessorios" | "outros";
  name: string;
  sku: string;
  brand: string;
  line: string;
  unit_label: string;
  size_details: string;
  width_cm: string;
  height_cm: string;
  length_cm: string;
  weight_kg: string;
  price: string;
  stock_quantity: string;
  description: string;
  application: string;
  technical_notes: string;
  is_active: boolean;
  track_stock: boolean;
};

type OperationDraftState = {
  operating_days: string;
  operating_hours: string;
  installation_days_rule: string;
  technical_visit_days_rule: string;
  serves_saturday: string;
  serves_sunday: string;
  serves_holiday: string;
  offers_installation: string;
  average_installation_time_days: string;
  installation_process_summary: string;
  offers_technical_visit: string;
  technical_visit_rules_summary: string;
  service_regions: string;
  important_limitations: string;
  agenda_capacity_rule: string;
  operational_ai_summary: string;
};


type CommercialDraftState = {
  ai_display_name: string;
  ai_presentation_mode: string;
  ai_tone_summary: string;
  ai_speaks_as: string;
  can_send_price_directly: string;
  price_before_summary: string;
  price_policy_summary: string;
  human_help_summary: string;
  payment_methods_summary: string;
  discount_policy_summary: string;
  negotiation_rules_summary: string;
  promise_limits_summary: string;
  post_sale_summary: string;
  after_hours_summary: string;
  commercial_ai_summary: string;
};


type DiscountDraftState = {
  can_offer_discount: string;
  max_discount_percent: string;
  human_help_discount_summary: string;
  discount_approver: string;
  special_discount_rules: string;
  discount_explanation: string;
};


type ChannelDraftState = {
  commercial_channel_name: string;
  commercial_whatsapp: string;
  commercial_channel_active: string;
  commercial_receives_real_clients: string;
  commercial_is_official_sales_channel: string;
  commercial_channel_type: string;
  commercial_entry_priority: string;
  commercial_human_handoff_enabled: string;
  commercial_channel_notes: string;
  responsible_channel_name: string;
  responsible_whatsapp: string;
  responsible_channel_active: string;
  responsible_channel_type: string;
  responsible_is_primary_alert_channel: string;
  responsible_is_human_command_channel: string;
  responsible_receives_ai_alerts: string;
  responsible_receives_reports: string;
  responsible_receives_urgencies: string;
  responsible_receives_visit_alerts: string;
  responsible_receives_payment_alerts: string;
  responsible_channel_notes: string;
  internal_chat_enabled: string;
  internal_chat_for_assistant: string;
  internal_chat_separate_from_inbox: string;
  internal_chat_visible_to_team: string;
  internal_chat_accepts_manual_commands: string;
  internal_chat_priority: string;
  internal_chat_notes: string;
  channels_are_separate: string;
  dedicated_number: string;
  telegram_future_status: string;
  extra_channel_notes: string;
  integration_provider_name: string;
  integration_connection_mode: string;
  integration_test_status: string;
  webhook_inbound_status: string;
  external_send_status: string;
  integration_has_inbound_webhook: string;
  integration_has_status_webhook: string;
  integration_has_outbound_delivery: string;
  whatsapp_integration_status: string;
  integrations_status: string;
  integrations_notes: string;
  customer_messages_route: string;
  assistant_alerts_route: string;
  urgency_route: string;
  reports_route: string;
  channel_fallback_rule: string;
  channels_system_summary: string;
};


type PersistedConfiguracoesState = {
  activeTab: SettingsTabId;
  scrollY: number;
  isOverviewEditing: boolean;
  isStrategyEditing: boolean;
  isOperationEditing: boolean;
  isCommercialEditing: boolean;
  isDiscountEditing: boolean;
  isChannelsEditing: boolean;
  showChannelsAdvanced: boolean;
  isActivationEditing: boolean;
  overviewDraft: Record<string, string>;
  strategyDraft: Record<string, string>;
  operationDraft: OperationDraftState;
  commercialDraft: CommercialDraftState;
  discountDraft: DiscountDraftState;
  channelDraft: ChannelDraftState;
  primaryResponsibleDraft: ResponsiblePersonDraft;
  additionalResponsiblesDraft: ResponsiblePersonDraft[];
  activationConfirmInformationDraft: boolean;
  activationNotificationCasesDraft: string;
  activationPreferencesDraft: string;
  poolForm: PoolFormState;
  catalogForm: CatalogFormState;
};

type ResponsiblePersonDraft = {
  id: string;
  name: string;
  whatsapp: string;
  role: string;
  receives_ai_alerts: boolean;
  can_approve_discount: boolean;
  can_approve_exceptions: boolean;
  can_assume_human: boolean;
  notes: string;
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

const ACTIVATION_GUARDRAIL_OPTIONS: Option[] = [
  { value: "nao_prometer_fora_escopo", label: "Nunca prometer fora do escopo" },
  { value: "encaminhar_humano_casos_criticos", label: "Chamar humano em casos críticos" },
];

const PAYMENT_METHOD_CONDITION_OPTIONS: Option[] = [
  { value: "parcelado", label: "Parcelado" },
  { value: "a_vista", label: "À vista" },
  { value: "sinal_mais_parcelas", label: "Sinal + parcelas" },
  { value: "sob_analise", label: "Sob análise" },
];

const PRICE_TALK_MODE_OPTIONS: Option[] = [
  { value: "quando_cliente_perguntar", label: "Quando o cliente perguntar" },
  { value: "so_quando_fizer_sentido", label: "Só quando fizer sentido" },
  { value: "com_contexto_antes", label: "Primeiro com contexto, depois preço" },
];

const SALES_FLOW_FINAL_OPTIONS: Option[] = [
  { value: "agendamento_da_instalacao", label: "Agendamento da instalação" },
  { value: "instalacao", label: "Instalação" },
  { value: "entrega_final", label: "Entrega final" },
  { value: "pos_venda", label: "Pós-venda" },
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

function summarizeMetricText(value: unknown, maxLength = 72) {
  const normalized = cleanText(value).replace(/\s+/g, " ");
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}


function formatFileSize(sizeBytes: number | null | undefined) {
  if (!sizeBytes || sizeBytes <= 0) return "Tamanho não definido";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  if (sizeBytes < 1024 * 1024 * 1024) return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatImportDate(value: string | null | undefined) {
  if (!value) return "Data não definida";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Data não definida";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(parsed);
}

function getImportSummaryText(summary: Record<string, unknown> | null | undefined) {
  if (!summary || typeof summary !== "object") return "Resumo não disponível";
  const totalFiles = Number(summary.totalFiles ?? 0);
  const normalizedItems = Number(summary.normalizedItems ?? 0);
  const extractedImages = Number(summary.extractedImages ?? 0);
  const parts: string[] = [];
  if (totalFiles > 0) parts.push(`${totalFiles} arquivo(s)`);
  if (normalizedItems > 0) parts.push(`${normalizedItems} item(ns)`);
  if (extractedImages > 0) parts.push(`${extractedImages} imagem(ns)`);
  return parts.length > 0 ? parts.join(" • ") : "Resumo não disponível";
}

function persistToLocalStorageSafe(key: string, value: string) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    console.error("[ConfiguracoesPage] localStorage setItem error:", error);
  }
}

function readFromLocalStorageSafe(key: string) {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    console.error("[ConfiguracoesPage] localStorage getItem error:", error);
    return null;
  }
}

function removeFromLocalStorageSafe(key: string) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    console.error("[ConfiguracoesPage] localStorage removeItem error:", error);
  }
}



function createEmptyPoolForm(): PoolFormState {
  return {
    name: "",
    brand: "",
    material: "",
    shape: "",
    color: "",
    finish: "",
    width_m: "",
    length_m: "",
    depth_m: "",
    price: "",
    stock_quantity: "",
    description: "",
    included_items: "",
    installation_notes: "",
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
    line: "",
    unit_label: "",
    size_details: "",
    width_cm: "",
    height_cm: "",
    length_cm: "",
    weight_kg: "",
    price: "",
    stock_quantity: "",
    description: "",
    application: "",
    technical_notes: "",
    is_active: true,
    track_stock: true,
  };
}


function createEmptyResponsibleDraft(isPrimary = false): ResponsiblePersonDraft {
  return {
    id: Math.random().toString(36).slice(2, 10),
    name: "",
    whatsapp: "",
    role: isPrimary ? "Responsável principal" : "",
    receives_ai_alerts: true,
    can_approve_discount: isPrimary,
    can_approve_exceptions: isPrimary,
    can_assume_human: isPrimary,
    notes: "",
  };
}

function parseResponsiblePeopleFromAnswers(answers: AnswersMap): ResponsiblePersonDraft[] {
  const raw = (answers as Record<string, unknown>).additional_responsibles;
  let parsed: unknown[] = [];
  if (Array.isArray(raw)) {
    parsed = raw;
  } else if (typeof raw === "string" && raw.trim()) {
    try {
      const json = JSON.parse(raw);
      if (Array.isArray(json)) parsed = json;
    } catch {}
  }

  return parsed
    .map((item, index) => {
      const row = (item || {}) as Record<string, unknown>;
      const name = cleanText(row.name);
      const whatsapp = cleanText(row.whatsapp);
      if (!name && !whatsapp) return null;
      return {
        id: cleanText(row.id) || `resp-${index + 1}`,
        name,
        whatsapp,
        role: cleanText(row.role),
        receives_ai_alerts: Boolean(row.receives_ai_alerts),
        can_approve_discount: Boolean(row.can_approve_discount),
        can_approve_exceptions: Boolean(row.can_approve_exceptions),
        can_assume_human: Boolean(row.can_assume_human),
        notes: cleanText(row.notes),
      } satisfies ResponsiblePersonDraft;
    })
    .filter(Boolean) as ResponsiblePersonDraft[];
}

function serializeResponsiblePeople(items: ResponsiblePersonDraft[]) {
  return JSON.stringify(
    items.map((item) => ({
      id: item.id,
      name: cleanText(item.name),
      whatsapp: cleanText(item.whatsapp),
      role: cleanText(item.role),
      receives_ai_alerts: item.receives_ai_alerts,
      can_approve_discount: item.can_approve_discount,
      can_approve_exceptions: item.can_approve_exceptions,
      can_assume_human: item.can_assume_human,
      notes: cleanText(item.notes),
    }))
  );
}

function includesDay(values: string[], day: string) {
  return values.map((value) => normalizeLoose(value)).includes(normalizeLoose(day));
}

function normalizeLoose(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

function deriveWeekendAvailabilityLabel(answers: AnswersMap, day: "sábado" | "domingo") {
  const explicit = cleanText((answers as Record<string, unknown>)[day === "sábado" ? "serves_saturday" : "serves_sunday"]);
  if (explicit) return yesNoLabel(explicit);

  const installationDays = parseArrayAnswer(answers.installation_available_days);
  const visitDays = parseArrayAnswer(answers.technical_visit_available_days);
  const hasSchedules = installationDays.length > 0 || visitDays.length > 0;
  const isSelected = includesDay(installationDays, day) || includesDay(visitDays, day);

  if (isSelected) return "Sim";
  if (hasSchedules) return "Não";
  return "Não definido";
}

function deriveHolidayAvailabilityLabel(answers: AnswersMap) {
  const explicit = cleanText(answers.attends_holidays ?? answers.serves_holiday);
  if (explicit) return yesNoLabel(explicit);

  const notes = [
    cleanText(answers.installation_days_rule),
    cleanText(answers.technical_visit_days_rule),
    cleanText(answers.technical_visit_rules_other),
    cleanText(answers.important_limitations_other),
  ]
    .join(" ")
    .toLowerCase();

  if (notes.includes("não atende feriado") || notes.includes("nao atende feriado")) return "Não";
  if (notes.includes("atende feriado")) return "Sim";
  return "Não definido";
}

function createOperationDraftFromAnswers(answers: AnswersMap): OperationDraftState {
  return {
    operating_days: cleanText(answers.operating_days),
    operating_hours: cleanText(answers.operating_hours),
    installation_days_rule: cleanText(answers.installation_days_rule),
    technical_visit_days_rule: cleanText(answers.technical_visit_days_rule),
    serves_saturday: deriveWeekendAvailabilityLabel(answers, "sábado"),
    serves_sunday: deriveWeekendAvailabilityLabel(answers, "domingo"),
    serves_holiday: deriveHolidayAvailabilityLabel(answers),
    offers_installation: yesNoLabel(answers.offers_installation),
    average_installation_time_days: cleanText(answers.average_installation_time_days),
    installation_process_summary: joinSelectedLabels(
      parseArrayAnswer(answers.installation_process_steps),
      [
        { value: "aprovacao_do_orcamento", label: "Aprovação do orçamento" },
        { value: "pagamento_sinal", label: "Pagamento / sinal" },
        { value: "confirmacao_do_pagamento", label: "Confirmação do pagamento" },
        { value: "agendamento_da_instalacao", label: "Agendamento da instalação" },
        { value: "instalacao", label: "Instalação" },
        { value: "entrega_final", label: "Entrega final" },
        { value: "pos_venda", label: "Pós-venda" },
      ],
      cleanText(answers.installation_process_other)
    ),
    offers_technical_visit: yesNoLabel(answers.offers_technical_visit),
    technical_visit_rules_summary: joinSelectedLabels(
      parseArrayAnswer(answers.technical_visit_rules_selected),
      TECHNICAL_VISIT_RULE_OPTIONS,
      cleanText(answers.technical_visit_rules_other)
    ),
    service_regions: cleanText(answers.service_regions) || cleanText(answers.service_region_notes),
    important_limitations: joinSelectedLabels(
      parseArrayAnswer(answers.important_limitations_selected),
      IMPORTANT_LIMITATION_OPTIONS,
      cleanText(answers.important_limitations_other)
    ),
    agenda_capacity_rule: cleanText(answers.agenda_capacity_rule) || cleanText(answers.average_human_response_time),
    operational_ai_summary: cleanText(answers.operational_ai_summary),
  };
}


function createCommercialDraftFromAnswers(answers: AnswersMap): CommercialDraftState {
  const paymentMain = joinSelectedLabels(
    parseArrayAnswer(answers.accepted_payment_methods),
    PAYMENT_METHOD_MAIN_OPTIONS
  );
  const paymentConditions = joinSelectedLabels(
    parseArrayAnswer(answers.accepted_payment_methods),
    PAYMENT_METHOD_CONDITION_OPTIONS
  );
  const priceBefore = joinSelectedLabels(
    parseArrayAnswer(answers.price_must_understand_before),
    PRICE_DIRECT_BEFORE_OPTIONS,
    cleanText(answers.price_direct_rule_other)
  );
  const humanHelp = [
    joinSelectedLabels(
      parseArrayAnswer(answers.human_help_discount_cases_selected),
      HUMAN_HELP_DISCOUNT_OPTIONS,
      cleanText(answers.human_help_discount_cases_other)
    ),
    joinSelectedLabels(
      parseArrayAnswer(answers.human_help_custom_project_cases_selected),
      HUMAN_HELP_CUSTOM_PROJECT_OPTIONS,
      cleanText(answers.human_help_custom_project_cases_other)
    ),
    joinSelectedLabels(
      parseArrayAnswer(answers.human_help_payment_cases_selected),
      HUMAN_HELP_PAYMENT_OPTIONS,
      cleanText(answers.human_help_payment_cases_other)
    ),
  ].filter(Boolean).join(" • ");

  const tone = joinSelectedLabels(
    parseArrayAnswer(answers.activation_preferences),
    [...ACTIVATION_STYLE_OPTIONS, ...ACTIVATION_GUARDRAIL_OPTIONS],
    cleanText(answers.activation_preferences_other)
  );

  return {
    ai_display_name: cleanText(answers.store_display_name) || cleanText(answers.responsible_name),
    ai_presentation_mode:
      PRICE_TALK_MODE_OPTIONS.find((option) => option.value === cleanText(answers.price_talk_mode))?.label ||
      cleanText(answers.price_talk_mode) ||
      "Quando o cliente perguntar",
    ai_tone_summary: tone || "Ainda não definido",
    ai_speaks_as: cleanText(answers.ai_identity_mode) || "Equipe da loja",
    can_send_price_directly: yesNoLabel(answers.ai_can_send_price_directly),
    price_before_summary: priceBefore || cleanText(answers.price_direct_rule_other) || cleanText(answers.price_direct_rule) || "Ainda não definido",
    price_policy_summary: cleanText(answers.price_direct_rule) || cleanText(answers.price_direct_rule_other),
    human_help_summary: humanHelp || "Ainda não definido",
    payment_methods_summary: [paymentMain, paymentConditions].filter(Boolean).join(" • "),
    discount_policy_summary: `${yesNoLabel(answers.can_offer_discount)}${cleanText(answers.max_discount_percent) ? ` • máximo de ${cleanText(answers.max_discount_percent)}%` : ""}`,
    negotiation_rules_summary:
      joinSelectedLabels(parseArrayAnswer(answers.price_must_understand_before), PRICE_DIRECT_BEFORE_OPTIONS) ||
      cleanText(answers.price_direct_rule),
    promise_limits_summary: cleanText(answers.final_activation_notes) || cleanText(answers.store_description),
    post_sale_summary:
      joinSelectedLabels(parseArrayAnswer(answers.sales_flow_final_steps), SALES_FLOW_FINAL_OPTIONS, cleanText(answers.sales_flow_notes)) ||
      cleanText(answers.sales_flow_notes),
    after_hours_summary: cleanText(answers.after_hours_behavior) || "Fora do horário, a IA deve acolher, qualificar e alinhar próximo passo sem prometer execução imediata.",
    commercial_ai_summary: cleanText(answers.commercial_ai_summary) || cleanText(answers.price_direct_rule),
  };
}


function createDiscountDraftFromAnswers(answers: AnswersMap): DiscountDraftState {
  return {
    can_offer_discount: yesNoLabel(answers.can_offer_discount),
    max_discount_percent: cleanText(answers.max_discount_percent),
    human_help_discount_summary: joinSelectedLabels(
      parseArrayAnswer(answers.human_help_discount_cases_selected),
      HUMAN_HELP_DISCOUNT_OPTIONS,
      cleanText(answers.human_help_discount_cases_other)
    ),
    discount_approver: cleanText(answers.discount_approver_name) || cleanText(answers.responsible_name) || "Responsável principal",
    special_discount_rules: cleanText(answers.discount_special_rules) || cleanText(answers.price_direct_rule_other),
    discount_explanation:
      cleanText(answers.discount_explanation) ||
      "A IA só deve trabalhar com desconto dentro do limite permitido pela loja. Quando o pedido sair da regra, ela deve acionar aprovação humana antes de confirmar qualquer condição especial.",
  };
}


function createChannelDraftFromAnswers(answers: AnswersMap): ChannelDraftState {
  const commercialWhatsapp = cleanText(answers.commercial_whatsapp);
  const responsibleWhatsapp = cleanText(answers.responsible_whatsapp);
  const responsibleName = cleanText(answers.responsible_name);

  return {
    commercial_channel_name: cleanText(answers.commercial_channel_name) || "Canal comercial principal",
    commercial_whatsapp: commercialWhatsapp,
    commercial_channel_active: cleanText(answers.commercial_channel_active) || (commercialWhatsapp ? "Sim" : "Não definido"),
    commercial_receives_real_clients: cleanText(answers.commercial_receives_real_clients) || (commercialWhatsapp ? "Sim" : "Não definido"),

    commercial_is_official_sales_channel: cleanText(answers.commercial_is_official_sales_channel) || (commercialWhatsapp ? "Sim" : "Não definido"),
    commercial_channel_type: cleanText(answers.commercial_channel_type) || "WhatsApp comercial da loja",
    commercial_entry_priority: cleanText(answers.commercial_entry_priority) || "Canal principal de entrada de clientes",
    commercial_human_handoff_enabled: cleanText(answers.commercial_human_handoff_enabled) || "Sim",
    commercial_channel_notes: cleanText(answers.commercial_channel_notes),

    responsible_channel_name: cleanText(answers.responsible_channel_name) || (responsibleName ? `Canal de ${responsibleName}` : "Canal do responsável"),
    responsible_whatsapp: responsibleWhatsapp,

    responsible_channel_active: cleanText(answers.responsible_channel_active) || (responsibleWhatsapp ? "Sim" : "Não definido"),
    responsible_channel_type: cleanText(answers.responsible_channel_type) || "WhatsApp do responsável",
    responsible_is_primary_alert_channel: cleanText(answers.responsible_is_primary_alert_channel) || "Sim",
    responsible_is_human_command_channel: cleanText(answers.responsible_is_human_command_channel) || "Sim",
    responsible_receives_ai_alerts: cleanText(answers.responsible_receives_ai_alerts) || "Sim",
    responsible_receives_reports: cleanText(answers.responsible_receives_reports) || "Sim",
    responsible_receives_urgencies: cleanText(answers.responsible_receives_urgencies) || "Sim",
    responsible_receives_visit_alerts: cleanText(answers.responsible_receives_visit_alerts) || "Sim",
    responsible_receives_payment_alerts: cleanText(answers.responsible_receives_payment_alerts) || "Sim",
    responsible_channel_notes: cleanText(answers.responsible_channel_notes),

    internal_chat_enabled: cleanText(answers.internal_chat_enabled) || "Sim",

    internal_chat_for_assistant: cleanText(answers.internal_chat_for_assistant) || "Sim",
    internal_chat_separate_from_inbox: cleanText(answers.internal_chat_separate_from_inbox) || "Sim",
    internal_chat_visible_to_team: cleanText(answers.internal_chat_visible_to_team) || "Sim",
    internal_chat_accepts_manual_commands: cleanText(answers.internal_chat_accepts_manual_commands) || "Sim",
    internal_chat_priority: cleanText(answers.internal_chat_priority) || "Canal secundário de apoio",
    internal_chat_notes: cleanText(answers.internal_chat_notes) || "Canal interno do painel para o responsável falar com a IA assistente sem misturar com clientes.",

    channels_are_separate: cleanText(answers.channels_are_separate) || "Sim",
    dedicated_number: cleanText(answers.dedicated_number) || commercialWhatsapp,
    telegram_future_status: cleanText(answers.telegram_future_status) || "Previsto para expansão futura",

    extra_channel_notes: cleanText(answers.extra_channel_notes),

    integration_provider_name: cleanText(answers.integration_provider_name) || "Ainda não definido",
    integration_connection_mode: cleanText(answers.integration_connection_mode) || "API / webhook",
    integration_test_status: cleanText(answers.integration_test_status) || "Ainda não testado nesta tela",
    webhook_inbound_status: cleanText(answers.webhook_inbound_status) || "Previsto no projeto",
    external_send_status: cleanText(answers.external_send_status) || "Previsto no projeto",
    integration_has_inbound_webhook: cleanText(answers.integration_has_inbound_webhook) || "Não definido",
    integration_has_status_webhook: cleanText(answers.integration_has_status_webhook) || "Não definido",
    integration_has_outbound_delivery: cleanText(answers.integration_has_outbound_delivery) || "Não definido",
    whatsapp_integration_status: cleanText(answers.whatsapp_integration_status) || (commercialWhatsapp ? "Base configurada" : "Pendente"),
    integrations_status: cleanText(answers.integrations_status) || resolveOnboardingLabel(cleanText(answers.integration_status_override) || cleanText(answers.onboarding_status_override)).label,
    integrations_notes: cleanText(answers.integrations_notes) || "As integrações devem respeitar a separação entre canal comercial da IA vendedora e canal do responsável para a IA assistente.",

    customer_messages_route: cleanText(answers.customer_messages_route) || "Mensagens de clientes entram pelo canal comercial da loja e seguem para a IA vendedora.",
    assistant_alerts_route: cleanText(answers.assistant_alerts_route) || "Avisos da assistente vão para o canal do responsável e também podem aparecer no chat interno.",
    urgency_route: cleanText(answers.urgency_route) || "Urgências e casos críticos devem priorizar o responsável principal.",
    reports_route: cleanText(answers.reports_route) || "Relatórios operacionais devem ir para o canal do responsável e ficar disponíveis no painel.",
    channel_fallback_rule: cleanText(answers.channel_fallback_rule) || "Se um canal externo falhar, o sistema deve manter fallback pelo painel/chat interno até o humano visualizar.",
    channels_system_summary: cleanText(answers.channels_system_summary) || "O canal comercial atende clientes. O canal do responsável recebe contexto, alertas e urgências. O chat interno serve como apoio operacional separado da Inbox.",
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

function formatFixedDecimalInput(value: string, decimalPlaces = 2) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";

  const safeDecimalPlaces = Math.max(0, decimalPlaces);
  if (safeDecimalPlaces === 0) {
    return digits.replace(/^0+(?=\d)/, "") || "0";
  }

  const paddedDigits = digits.padStart(safeDecimalPlaces + 1, "0");
  const integerPartRaw = paddedDigits.slice(0, -safeDecimalPlaces);
  const decimalPart = paddedDigits.slice(-safeDecimalPlaces);
  const integerPart = integerPartRaw.replace(/^0+(?=\d)/, "") || "0";

  return `${integerPart}.${decimalPart}`;
}

function formatManualPoolFieldValue(
  key: keyof PoolFormState,
  value: string | boolean
): string | boolean {
  if (typeof value !== "string") return value;

  if (["width_m", "length_m", "depth_m", "price"].includes(key)) {
    return formatFixedDecimalInput(value, 2);
  }

  return value;
}

function formatManualCatalogFieldValue(
  key: keyof CatalogFormState,
  value: string | boolean
): string | boolean {
  if (typeof value !== "string") return value;

  if (["width_cm", "height_cm", "length_cm", "weight_kg", "price"].includes(key)) {
    return formatFixedDecimalInput(value, 2);
  }

  return value;
}

function buildPoolManualDescription(form: PoolFormState) {
  const baseDescription = cleanText(form.description);
  const detailLines = buildBulletRows([
    { label: "Marca", value: cleanText(form.brand) },
    { label: "Material", value: cleanText(form.material) },
    { label: "Formato", value: cleanText(form.shape) },
    { label: "Cor", value: cleanText(form.color) },
    { label: "Acabamento / linha", value: cleanText(form.finish) },
    { label: "Largura (m)", value: cleanText(form.width_m) },
    { label: "Comprimento (m)", value: cleanText(form.length_m) },
    { label: "Profundidade (m)", value: cleanText(form.depth_m) },
    { label: "Itens inclusos", value: cleanText(form.included_items) },
    { label: "Observações de instalação", value: cleanText(form.installation_notes) },
  ]);

  if (!baseDescription && detailLines.length === 0) return "";
  if (!baseDescription) return detailLines.join("\n");
  if (detailLines.length === 0) return baseDescription;

  return `${baseDescription}\n\n${detailLines.join("\n")}`;
}

function parseArrayAnswer(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith('{') && trimmed.endsWith('}')) ) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((item) => String(item).trim()).filter(Boolean);
        }
      } catch {}
    }
    return trimmed
      .split(",")
      .map((item) => item.replace(/^[\[\]"]+|[\[\]"]+$/g, "").trim())
      .filter(Boolean);
  }
  return [];
}

function yesNoLabel(value: unknown) {
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  const normalized = cleanText(value).toLowerCase();
  if (!normalized) return "Não definido";
  if (["sim", "true", "1"].includes(normalized)) return "Sim";
  if (["não", "nao", "false", "0"].includes(normalized)) return "Não";
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
          className={`inline-flex max-w-full break-words whitespace-normal rounded-full border px-2.5 py-1 text-left text-xs font-semibold leading-5 ${statusToneClass(
            tone
          )}`}
        >
          {value}
        </span>
      </div>
      {hint ? (
        <div className="mt-2 max-h-[4.5rem] overflow-hidden text-xs leading-5 text-gray-600">{hint}</div>
      ) : null}
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
          className="min-w-0 overflow-hidden break-words whitespace-pre-wrap rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm leading-6 text-gray-700"
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
        "min-w-0 w-full rounded-xl border px-3 py-2 text-left transition",
        active
          ? "border-black bg-black text-white"
          : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
      ].join(" ")}
    >
      <div className="break-words text-[13px] font-semibold leading-tight">{label}</div>
    </button>
  );
}

function ChoiceButtonGroup({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const active = normalizeLoose(value) === normalizeLoose(option.value);
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={[
              "rounded-xl border px-3 py-2 text-sm font-semibold transition",
              active
                ? "border-black bg-black text-white"
                : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
            ].join(" ")}
          >
            {option.label}
          </button>
        );
      })}
    </div>
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
  const [isOperationEditing, setIsOperationEditing] = useState(false);
  const [overviewDraft, setOverviewDraft] = useState<Record<string, string>>({});
  const [strategyDraft, setStrategyDraft] = useState<Record<string, string>>({});
  const [operationDraft, setOperationDraft] = useState<OperationDraftState>(createOperationDraftFromAnswers({}));
  const [isCommercialEditing, setIsCommercialEditing] = useState(false);
  const [commercialDraft, setCommercialDraft] = useState<CommercialDraftState>(createCommercialDraftFromAnswers({}));
  const [isDiscountEditing, setIsDiscountEditing] = useState(false);
  const [discountDraft, setDiscountDraft] = useState<DiscountDraftState>(createDiscountDraftFromAnswers({}));
  const [isChannelsEditing, setIsChannelsEditing] = useState(false);
  const [showChannelsAdvanced, setShowChannelsAdvanced] = useState(false);
  const [channelDraft, setChannelDraft] = useState<ChannelDraftState>(createChannelDraftFromAnswers({}));
  const [isActivationEditing, setIsActivationEditing] = useState(false);
  const [primaryResponsibleDraft, setPrimaryResponsibleDraft] = useState<ResponsiblePersonDraft>(createEmptyResponsibleDraft(true));
  const [additionalResponsiblesDraft, setAdditionalResponsiblesDraft] = useState<ResponsiblePersonDraft[]>([]);
  const [activationConfirmInformationDraft, setActivationConfirmInformationDraft] = useState(false);
  const [activationNotificationCasesDraft, setActivationNotificationCasesDraft] = useState("");
  const [activationPreferencesDraft, setActivationPreferencesDraft] = useState("");
  const [poolForm, setPoolForm] = useState<PoolFormState>(createEmptyPoolForm());
  const [poolPhotos, setPoolPhotos] = useState<File[]>([]);
  const [savingPool, setSavingPool] = useState(false);
  const [catalogForm, setCatalogForm] = useState<CatalogFormState>(createEmptyCatalogForm());
  const [catalogPhotos, setCatalogPhotos] = useState<File[]>([]);
  const [savingCatalogItem, setSavingCatalogItem] = useState(false);
  const [poolImportFiles, setPoolImportFiles] = useState<StoreImportFileRow[]>([]);
  const [catalogImportFiles, setCatalogImportFiles] = useState<StoreImportFileRow[]>([]);
  const [downloadingImportFileId, setDownloadingImportFileId] = useState<string | null>(null);

  const hasValidStoreContext = Boolean(organizationId && activeStoreId);
  const storeName = useMemo(() => buildStoreName(activeStore), [activeStore]);
  const configDraftStorageKey = useMemo(() => {
    if (!organizationId || !activeStoreId) return null;
    return `zion_configuracoes_draft:${organizationId}:${activeStoreId}`;
  }, [organizationId, activeStoreId]);
  const hasRestoredLocalDraftRef = useRef(false);
  const hasInitializedLocalDraftRef = useRef(false);

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
      setPoolImportFiles([]);
      setCatalogImportFiles([]);
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

      const { data: importDestinationsData, error: importDestinationsError } = await supabase
        .from("store_import_file_items")
        .select("import_file_id, destination_type")
        .eq("organization_id", organizationId)
        .eq("store_id", activeStoreId)
        .in("destination_type", ["pool", "catalog_item"]);

      if (importDestinationsError) throw importDestinationsError;

      const poolImportIds = new Set<string>();
      const catalogImportIds = new Set<string>();

      for (const row of ((importDestinationsData || []) as Array<{ import_file_id: string; destination_type: string }>)) {
        const importFileId = String(row.import_file_id || "").trim();
        const destinationType = String(row.destination_type || "").trim();
        if (!importFileId) continue;
        if (destinationType === "pool") poolImportIds.add(importFileId);
        if (destinationType === "catalog_item") catalogImportIds.add(importFileId);
      }

      const allImportIds = Array.from(new Set([...poolImportIds, ...catalogImportIds]));
      let importFilesMap = new Map<string, StoreImportFileRow>();

      if (allImportIds.length > 0) {
        const { data: importFilesData, error: importFilesError } = await supabase
          .from("store_import_files")
          .select(
            "id, organization_id, store_id, source, original_file_name, mime_type, extension, size_bytes, storage_bucket, storage_path, import_summary, status, created_at, updated_at"
          )
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId)
          .in("id", allImportIds)
          .order("created_at", { ascending: false });

        if (importFilesError) throw importFilesError;

        importFilesMap = new Map(
          ((importFilesData || []) as StoreImportFileRow[]).map((item) => [item.id, item])
        );
      }

      const nextPoolImportFiles = Array.from(poolImportIds)
        .map((id) => importFilesMap.get(id))
        .filter(Boolean) as StoreImportFileRow[];
      const nextCatalogImportFiles = Array.from(catalogImportIds)
        .map((id) => importFilesMap.get(id))
        .filter(Boolean) as StoreImportFileRow[];

      nextPoolImportFiles.sort((a, b) => {
        const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bTime - aTime;
      });

      nextCatalogImportFiles.sort((a, b) => {
        const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bTime - aTime;
      });

      setCounts(nextCounts);
      setOnboarding((onboardingResult.data ?? null) as OnboardingRow | null);
      setAnswers((answersResult.data ?? {}) as AnswersMap);
      setPoolImportFiles(nextPoolImportFiles);
      setCatalogImportFiles(nextCatalogImportFiles);
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao carregar a visão geral das configurações.");
    } finally {
      setLoading(false);
    }
  }, [organizationId, activeStoreId]);


  const upsertConfigAnswers = useCallback(
    async (entries: Record<string, unknown>, successMessage: string) => {
      if (!organizationId || !activeStoreId) {
        setErrorText("Nenhuma loja ativa foi encontrada para salvar essas alterações.");
        setSuccessText(null);
        return false;
      }

      try {
        for (const [questionKey, rawValue] of Object.entries(entries)) {
          const answerValue =
            typeof rawValue === "string" ? rawValue.trim() : rawValue ?? null;

          const { error } = await supabase.rpc("onboarding_upsert_answer_scoped", {
            p_organization_id: organizationId,
            p_store_id: activeStoreId,
            p_question_key: questionKey,
            p_answer: answerValue,
          });

          if (error) throw error;
        }

        const currentStatus = cleanText(onboarding?.status).toLowerCase();
        const nextStatus = currentStatus === "completed" ? "completed" : "in_progress";

        const { error: onboardingError } = await supabase.rpc(
          "onboarding_upsert_store_onboarding_scoped",
          {
            p_organization_id: organizationId,
            p_store_id: activeStoreId,
            p_status: nextStatus,
          }
        );

        if (onboardingError) throw onboardingError;

        setAnswers((current) => ({
          ...current,
          ...entries,
        }));
        setSuccessText(successMessage);
        setErrorText(null);
        await fetchPageData();
        return true;
      } catch (error: any) {
        setErrorText(error?.message ?? "Erro ao salvar alterações da configuração.");
        setSuccessText(null);
        return false;
      }
    },
    [organizationId, activeStoreId, onboarding?.status, fetchPageData]
  );

  useEffect(() => {
    void fetchPageData();
  }, [fetchPageData]);

  useEffect(() => {
    if (!configDraftStorageKey || typeof window === "undefined") return;
    if (hasRestoredLocalDraftRef.current) return;
    if (loading) return;

    const raw = readFromLocalStorageSafe(configDraftStorageKey);
    hasRestoredLocalDraftRef.current = true;

    if (!raw) {
      hasInitializedLocalDraftRef.current = true;
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<PersistedConfiguracoesState>;

      if (parsed.activeTab) setActiveTab(parsed.activeTab);
      if (typeof parsed.isOverviewEditing === "boolean") setIsOverviewEditing(parsed.isOverviewEditing);
      if (typeof parsed.isStrategyEditing === "boolean") setIsStrategyEditing(parsed.isStrategyEditing);
      if (typeof parsed.isOperationEditing === "boolean") setIsOperationEditing(parsed.isOperationEditing);
      if (typeof parsed.isCommercialEditing === "boolean") setIsCommercialEditing(parsed.isCommercialEditing);
      if (typeof parsed.isDiscountEditing === "boolean") setIsDiscountEditing(parsed.isDiscountEditing);
      if (typeof parsed.isChannelsEditing === "boolean") setIsChannelsEditing(parsed.isChannelsEditing);
      if (typeof parsed.showChannelsAdvanced === "boolean") setShowChannelsAdvanced(parsed.showChannelsAdvanced);
      if (typeof parsed.isActivationEditing === "boolean") setIsActivationEditing(parsed.isActivationEditing);
      if (parsed.overviewDraft) setOverviewDraft(parsed.overviewDraft);
      if (parsed.strategyDraft) setStrategyDraft(parsed.strategyDraft);
      if (parsed.operationDraft) setOperationDraft(parsed.operationDraft);
      if (parsed.commercialDraft) setCommercialDraft(parsed.commercialDraft);
      if (parsed.discountDraft) setDiscountDraft(parsed.discountDraft);
      if (parsed.channelDraft) setChannelDraft(parsed.channelDraft);
      if (parsed.primaryResponsibleDraft) setPrimaryResponsibleDraft(parsed.primaryResponsibleDraft);
      if (Array.isArray(parsed.additionalResponsiblesDraft)) setAdditionalResponsiblesDraft(parsed.additionalResponsiblesDraft);
      if (typeof parsed.activationConfirmInformationDraft === "boolean") {
        setActivationConfirmInformationDraft(parsed.activationConfirmInformationDraft);
      }
      if (typeof parsed.activationNotificationCasesDraft === "string") {
        setActivationNotificationCasesDraft(parsed.activationNotificationCasesDraft);
      }
      if (typeof parsed.activationPreferencesDraft === "string") {
        setActivationPreferencesDraft(parsed.activationPreferencesDraft);
      }
      if (parsed.poolForm) setPoolForm(parsed.poolForm);
      if (parsed.catalogForm) setCatalogForm(parsed.catalogForm);

      if (typeof parsed.scrollY === "number" && Number.isFinite(parsed.scrollY) && parsed.scrollY >= 0) {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            window.scrollTo({ top: parsed.scrollY, behavior: "auto" });
          });
        });
      }
    } catch (error) {
      console.error("[ConfiguracoesPage] restore draft error:", error);
      removeFromLocalStorageSafe(configDraftStorageKey);
    } finally {
      hasInitializedLocalDraftRef.current = true;
    }
  }, [configDraftStorageKey, loading]);

  const persistConfiguracoesDraft = useCallback(() => {
    if (!configDraftStorageKey || typeof window === "undefined") return;
    if (!hasInitializedLocalDraftRef.current) return;

    const payload: PersistedConfiguracoesState = {
      activeTab,
      scrollY: window.scrollY,
      isOverviewEditing,
      isStrategyEditing,
      isOperationEditing,
      isCommercialEditing,
      isDiscountEditing,
      isChannelsEditing,
      showChannelsAdvanced,
      isActivationEditing,
      overviewDraft,
      strategyDraft,
      operationDraft,
      commercialDraft,
      discountDraft,
      channelDraft,
      primaryResponsibleDraft,
      additionalResponsiblesDraft,
      activationConfirmInformationDraft,
      activationNotificationCasesDraft,
      activationPreferencesDraft,
      poolForm,
      catalogForm,
    };

    persistToLocalStorageSafe(configDraftStorageKey, JSON.stringify(payload));
  }, [
    configDraftStorageKey,
    activeTab,
    isOverviewEditing,
    isStrategyEditing,
    isOperationEditing,
    isCommercialEditing,
    isDiscountEditing,
    isChannelsEditing,
    showChannelsAdvanced,
    isActivationEditing,
    overviewDraft,
    strategyDraft,
    operationDraft,
    commercialDraft,
    discountDraft,
    channelDraft,
    primaryResponsibleDraft,
    additionalResponsiblesDraft,
    activationConfirmInformationDraft,
    activationNotificationCasesDraft,
    activationPreferencesDraft,
    poolForm,
    catalogForm,
  ]);

  useEffect(() => {
    if (!configDraftStorageKey || typeof window === "undefined") return;
    if (!hasInitializedLocalDraftRef.current) return;
    persistConfiguracoesDraft();
  }, [configDraftStorageKey, persistConfiguracoesDraft]);

  useEffect(() => {
    if (!configDraftStorageKey || typeof window === "undefined") return;

    const persistNow = () => persistConfiguracoesDraft();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        persistNow();
      }
    };

    window.addEventListener("pagehide", persistNow);
    window.addEventListener("beforeunload", persistNow);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      persistNow();
      window.removeEventListener("pagehide", persistNow);
      window.removeEventListener("beforeunload", persistNow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [configDraftStorageKey, persistConfiguracoesDraft]);

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
      service_region_modes_text: joinSelectedLabels(
        parseArrayAnswer(answers.service_region_modes),
        SERVICE_REGION_MODE_OPTIONS
      ),
      store_services_text: joinSelectedLabels(
        parseArrayAnswer(answers.store_services),
        STORE_SERVICE_OPTIONS
      ),
      store_services_other: cleanText(answers.store_services_other),
      strategy_service_exclusions: cleanText(answers.strategy_service_exclusions),
      store_description: cleanText(answers.store_description),
      strategy_primary_focus: cleanText(answers.strategy_primary_focus),
      strategy_sell_more: cleanText(answers.strategy_sell_more),
      strategy_common_customer: cleanText(answers.strategy_common_customer),
      strategy_ideal_customer: cleanText(answers.strategy_ideal_customer),
      strategy_ticket_range: cleanText(answers.strategy_ticket_range),
      strategy_positioning: cleanText(answers.strategy_positioning),
      main_store_brand: cleanText(answers.main_store_brand),
      brands_worked: cleanText(answers.brands_worked),
      strategy_priority_brands: cleanText(answers.strategy_priority_brands),
      strategy_non_worked_brands: cleanText(answers.strategy_non_worked_brands),
      strategy_top_lines: cleanText(answers.strategy_top_lines),
      strategy_top_products: cleanText(answers.strategy_top_products),
      strategy_differentials: cleanText(answers.strategy_differentials),
      strategy_promise_limits: cleanText(answers.strategy_promise_limits),
      strategy_requires_visit: cleanText(answers.strategy_requires_visit),
      strategy_requires_human: cleanText(answers.strategy_requires_human),
      strategy_exception_cases: cleanText(answers.strategy_exception_cases),
      strategy_ai_store_summary: cleanText(answers.strategy_ai_store_summary),
      strategy_ai_presentation: cleanText(answers.strategy_ai_presentation),
      strategy_ai_priorities: cleanText(answers.strategy_ai_priorities),
      strategy_ai_never_forget: cleanText(answers.strategy_ai_never_forget),
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

  const strategyBaseItems = useMemo(() => {
    const city = cleanText(answers.city);
    const state = cleanText(answers.state);
    const serviceRegions = cleanText(answers.service_regions);
    const regionModes = joinSelectedLabels(
      parseArrayAnswer(answers.service_region_modes),
      SERVICE_REGION_MODE_OPTIONS
    );

    return buildBulletRows([
      { label: "Cidade base", value: city },
      { label: "Estado", value: state },
      { label: "Região principal de atendimento", value: serviceRegions },
      { label: "Até onde atende", value: regionModes },
      { label: "Observações sobre cobertura", value: cleanText(answers.service_region_notes) },
    ]);
  }, [answers]);

  const strategyServicesItems = useMemo(() => {
    const services = joinSelectedLabels(
      parseArrayAnswer(answers.store_services),
      STORE_SERVICE_OPTIONS,
      cleanText(answers.store_services_other)
    );

    return buildBulletRows([
      { label: "Serviços principais", value: services },
      { label: "Serviços extras", value: cleanText(answers.store_services_other) },
      { label: "Serviços que a loja não faz", value: cleanText(answers.strategy_service_exclusions) },
    ]);
  }, [answers]);

  const strategyCommercialFocusItems = useMemo(() => {
    return buildBulletRows([
      { label: "Tipo de loja / foco comercial", value: cleanText(answers.store_description) },
      { label: "Principal foco da loja", value: cleanText(answers.strategy_primary_focus) },
      { label: "O que quer vender mais", value: cleanText(answers.strategy_sell_more) },
      { label: "Tipo de cliente mais comum", value: cleanText(answers.strategy_common_customer) },
      { label: "Tipo de cliente ideal", value: cleanText(answers.strategy_ideal_customer) },
      { label: "Faixa de ticket mais comum", value: cleanText(answers.strategy_ticket_range) },
      { label: "Posicionamento da loja", value: cleanText(answers.strategy_positioning) },
    ]);
  }, [answers]);

  const strategyBrandsItems = useMemo(() => {
    return buildBulletRows([
      { label: "Marca principal", value: cleanText(answers.main_store_brand) },
      { label: "Outras marcas trabalhadas", value: cleanText(answers.brands_worked) },
      { label: "Marcas prioritárias", value: cleanText(answers.strategy_priority_brands) },
      { label: "Marcas que não trabalha", value: cleanText(answers.strategy_non_worked_brands) },
      { label: "Linhas principais", value: cleanText(answers.strategy_top_lines) },
      { label: "Produtos com maior giro", value: cleanText(answers.strategy_top_products) },
    ]);
  }, [answers]);

  const strategyDifferentialsItems = useMemo(() => {
    return buildBulletRows([
      { label: "Diferenciais da loja", value: cleanText(answers.strategy_differentials) },
      { label: "O que não pode prometer", value: cleanText(answers.strategy_promise_limits) },
      { label: "O que depende de visita", value: cleanText(answers.strategy_requires_visit) },
      { label: "O que depende de humano", value: cleanText(answers.strategy_requires_human) },
      { label: "Casos de exceção", value: cleanText(answers.strategy_exception_cases) },
    ]);
  }, [answers]);

  const strategyAiSummaryItems = useMemo(() => {
    return buildBulletRows([
      { label: "Como a IA deve entender a loja", value: cleanText(answers.strategy_ai_store_summary) },
      { label: "Como deve apresentar a loja", value: cleanText(answers.strategy_ai_presentation) },
      { label: "O que a IA deve priorizar", value: cleanText(answers.strategy_ai_priorities) },
      { label: "O que nunca deve esquecer", value: cleanText(answers.strategy_ai_never_forget) },
    ]);
  }, [answers]);

  const poolTypesLabel = useMemo(() => {
    return joinSelectedLabels(
      parseArrayAnswer(answers.pool_types_selected),
      POOL_TYPE_OPTIONS,
      cleanText(answers.pool_types_other)
    );
  }, [answers]);

  const poolsOverviewMetrics = useMemo(() => {
    const stockRule = counts.pools > 0 ? "Controle por piscina" : "A definir";
    return [
      {
        label: "Piscinas cadastradas",
        value: String(counts.pools),
        tone: counts.pools > 0 ? ("green" as const) : ("gray" as const),
        hint: counts.pools > 0 ? "Já existe base manual/importada" : "Nenhuma piscina cadastrada ainda",
      },
      {
        label: "Fotos por piscina",
        value: "Até 10",
        tone: "gray" as const,
        hint: "Máximo de 50 MB por foto",
      },
      {
        label: "Status de venda",
        value: counts.pools > 0 ? "Controlado por item" : "Aguardando cadastro",
        tone: counts.pools > 0 ? ("green" as const) : ("amber" as const),
        hint: "Ativa/inativa e vendível por piscina",
      },
      {
        label: "Estoque",
        value: stockRule,
        tone: counts.pools > 0 ? ("green" as const) : ("gray" as const),
        hint: "Quantidade disponível por item",
      },
    ];
  }, [counts.pools]);

  const poolsOperationalItems = useMemo(() => {
    return buildBulletRows([
      { label: "Tipos de piscina trabalhados", value: poolTypesLabel || cleanText(answers.pool_types) },
      { label: "Marca principal para piscinas", value: cleanText(answers.main_store_brand) || cleanText(answers.brands_worked) },
      { label: "Cadastro manual", value: "Pode cadastrar piscina completa com medidas, estoque, preço, fotos, itens inclusos e observações" },
      { label: "Fotos", value: counts.pools > 0 ? "Gerenciadas por piscina, com até 10 imagens" : "Quando cadastrar, poderá subir até 10 imagens por piscina" },
      { label: "Preço e estoque", value: "Preenchidos diretamente na própria aba de Configurações" },
      { label: "Campos esperados", value: "Nome, marca, material, formato, cor, acabamento, medidas, descrição, itens inclusos e observações de instalação" },
      { label: "Edição e exclusão", value: "Devem continuar disponíveis nas páginas internas de piscinas" },
      { label: "Importação inteligente", value: "Continua existindo sem depender deste cadastro manual" },
    ]);
  }, [answers, counts.pools, poolTypesLabel]);

  const catalogOverviewMetrics = useMemo(() => {
    return [
      {
        label: "Total do catálogo",
        value: String(totalCatalogo),
        tone: totalCatalogo > 0 ? ("green" as const) : ("gray" as const),
        hint: `${counts.quimicos} químicos • ${counts.acessorios} acessórios • ${counts.outros} outros`,
      },
      {
        label: "Fotos por item",
        value: "Até 10",
        tone: "gray" as const,
        hint: "Máximo de 50 MB por foto",
      },
      {
        label: "Controle de estoque",
        value: totalCatalogo > 0 ? "Por item" : "A definir",
        tone: totalCatalogo > 0 ? ("green" as const) : ("gray" as const),
        hint: "Ativo/inativo, estoque e SKU por cadastro",
      },
      {
        label: "Cadastro manual",
        value: "Disponível",
        tone: "green" as const,
        hint: "Químicos, acessórios e outros na mesma aba",
      },
    ];
  }, [counts.quimicos, counts.acessorios, counts.outros, totalCatalogo]);

  const catalogOperationalItems = useMemo(() => {
    return buildBulletRows([
      { label: "Produtos químicos", value: String(counts.quimicos) },
      { label: "Acessórios", value: String(counts.acessorios) },
      { label: "Outros itens", value: String(counts.outros) },
      { label: "Cadastro manual", value: "Pode cadastrar item com categoria, SKU, marca, linha, medidas, peso, aplicação, descrição e fotos" },
      { label: "Campos principais", value: "Nome, categoria, SKU, marca, linha, unidade, tamanho, medidas, peso, preço, estoque, aplicação e observações técnicas" },
      { label: "Fotos", value: totalCatalogo > 0 ? "Gerenciadas por item, com até 10 imagens" : "Quando cadastrar, poderá subir até 10 imagens por item" },
      { label: "Preço e estoque", value: "Controlados item por item dentro da própria aba de Configurações" },
      { label: "Edição e exclusão", value: "Devem continuar disponíveis nas páginas internas de catálogo" },
      { label: "Importação inteligente", value: "Continua existindo sem depender deste cadastro manual" },
    ]);
  }, [counts.quimicos, counts.acessorios, counts.outros, totalCatalogo]);

  const installationDaysSelected = useMemo(
    () => parseArrayAnswer(answers.installation_available_days),
    [answers.installation_available_days]
  );

  const technicalVisitDaysSelected = useMemo(
    () => parseArrayAnswer(answers.technical_visit_available_days),
    [answers.technical_visit_available_days]
  );

  const installationDaysLabel = useMemo(
    () => joinSelectedLabels(installationDaysSelected, DAYS_OF_WEEK_OPTIONS),
    [installationDaysSelected]
  );

  const technicalVisitDaysLabel = useMemo(
    () => joinSelectedLabels(technicalVisitDaysSelected, DAYS_OF_WEEK_OPTIONS),
    [technicalVisitDaysSelected]
  );

  const technicalVisitRulesLabel = useMemo(
    () => joinSelectedLabels(
      parseArrayAnswer(answers.technical_visit_rules_selected),
      TECHNICAL_VISIT_RULE_OPTIONS,
      cleanText(answers.technical_visit_rules_other)
    ),
    [answers]
  );

  const importantLimitationsLabel = useMemo(
    () => joinSelectedLabels(
      parseArrayAnswer(answers.important_limitations_selected),
      IMPORTANT_LIMITATION_OPTIONS,
      cleanText(answers.important_limitations_other)
    ),
    [answers]
  );

  const servesSaturdayLabel = useMemo(() => deriveWeekendAvailabilityLabel(answers, "sábado"), [answers]);
  const servesSundayLabel = useMemo(() => deriveWeekendAvailabilityLabel(answers, "domingo"), [answers]);
  const servesHolidayLabel = useMemo(() => deriveHolidayAvailabilityLabel(answers), [answers]);

  const operationReadinessMetrics = useMemo(() => {
    const hasOperationalSchedule = installationDaysSelected.length > 0 || technicalVisitDaysSelected.length > 0;
    const hasInstallation = yesNoLabel(answers.offers_installation) === "Sim";
    const hasVisit = yesNoLabel(answers.offers_technical_visit) === "Sim";
    const serviceRegions = cleanText(answers.service_regions) || cleanText(answers.service_region_notes);
    const compactOperationalHint = summarizeMetricText(
      installationDaysLabel || technicalVisitDaysLabel || "Defina os dias reais de operação",
      70
    );
    const compactVisitHint = summarizeMetricText(
      technicalVisitRulesLabel || technicalVisitDaysLabel || "Defina regras e disponibilidade de visita",
      70
    );
    const compactCoverageHint = summarizeMetricText(
      serviceRegions || "Defina regiões e política de deslocamento",
      70
    );

    return [
      {
        label: "Atendimento operacional",
        value: hasOperationalSchedule ? "Configurado" : "Pendente",
        tone: hasOperationalSchedule ? ("green" as const) : ("amber" as const),
        hint: compactOperationalHint,
      },
      {
        label: "Instalação",
        value: hasInstallation ? "Ativa" : "Não configurada",
        tone: hasInstallation ? ("green" as const) : ("gray" as const),
        hint: cleanText(answers.average_installation_time_days)
          ? `Prazo médio: ${cleanText(answers.average_installation_time_days)} dia(s)`
          : "Defina prazo e etapas da instalação",
      },
      {
        label: "Visita técnica",
        value: hasVisit ? "Ativa" : "Não configurada",
        tone: hasVisit ? ("green" as const) : ("gray" as const),
        hint: compactVisitHint,
      },
      {
        label: "Cobertura",
        value: serviceRegions ? "Definida" : "Pendente",
        tone: serviceRegions ? ("green" as const) : ("amber" as const),
        hint: compactCoverageHint,
      },
    ];
  }, [answers, installationDaysSelected.length, technicalVisitDaysSelected.length, installationDaysLabel, technicalVisitDaysLabel, technicalVisitRulesLabel]);

  const operationSections = useMemo(() => {
    return [
      {
        title: "Disponibilidade operacional",
        items: buildBulletRows([
          { label: "Dias de instalação", value: installationDaysLabel },
          { label: "Regra complementar da instalação", value: cleanText(answers.installation_days_rule) },
          { label: "Dias de visita técnica", value: technicalVisitDaysLabel },
          { label: "Regra complementar da visita técnica", value: cleanText(answers.technical_visit_days_rule) },
          { label: "Atende sábado", value: servesSaturdayLabel },
          { label: "Atende domingo", value: servesSundayLabel },
          { label: "Atende feriado", value: servesHolidayLabel },
        ]),
      },
      {
        title: "Visita técnica",
        items: buildBulletRows([
          { label: "Faz visita técnica", value: yesNoLabel(answers.offers_technical_visit) },
          { label: "Regras da visita", value: technicalVisitRulesLabel },
        ]),
      },
      {
        title: "Instalação",
        items: buildBulletRows([
          { label: "Faz instalação", value: yesNoLabel(answers.offers_installation) },
          { label: "Prazo médio", value: cleanText(answers.average_installation_time_days) ? `${cleanText(answers.average_installation_time_days)} dia(s)` : "Não definido" },
          { label: "Etapas principais da instalação", value: joinSelectedLabels(parseArrayAnswer(answers.installation_process_steps), [
            { value: "aprovacao_do_orcamento", label: "Aprovação do orçamento" },
            { value: "pagamento_sinal", label: "Pagamento / sinal" },
            { value: "confirmacao_do_pagamento", label: "Confirmação do pagamento" },
            { value: "agendamento_da_instalacao", label: "Agendamento da instalação" },
            { value: "instalacao", label: "Instalação" },
            { value: "entrega_final", label: "Entrega final" },
            { value: "pos_venda", label: "Pós-venda" },
          ], cleanText(answers.installation_process_other)) },
        ]),
      },
      {
        title: "Cobertura e deslocamento",
        items: buildBulletRows([
          { label: "Regiões atendidas", value: cleanText(answers.service_regions) || cleanText(answers.service_region_notes) },
          { label: "Cobertura principal", value: joinSelectedLabels(parseArrayAnswer(answers.service_region_modes), SERVICE_REGION_MODE_OPTIONS) },
        ]),
      },
      {
        title: "Limites operacionais",
        items: buildBulletRows([
          { label: "Limitações importantes", value: importantLimitationsLabel },
        ]),
      },
      {
        title: "Capacidade da agenda",
        items: buildBulletRows([
          { label: "Regra de capacidade", value: cleanText(answers.average_human_response_time) || cleanText(answers.agenda_capacity_rule) },
        ]),
      },
      {
        title: "Resumo operacional para a IA",
        items: buildBulletRows([
          { label: "Resumo", value: cleanText(answers.operational_ai_summary) || "Ainda não definido" },
        ]),
      },
    ];
  }, [answers, installationDaysLabel, technicalVisitDaysLabel, technicalVisitRulesLabel, importantLimitationsLabel, servesSaturdayLabel, servesSundayLabel, servesHolidayLabel]);

  const commercialIdentityItems = useMemo(() => {
    return buildBulletRows([
      { label: "Nome da IA no atendimento", value: cleanText(answers.store_display_name) || cleanText(answers.responsible_name) || "Não definido" },
      { label: "Como a IA se apresenta", value: PRICE_TALK_MODE_OPTIONS.find((option) => option.value === cleanText(answers.price_talk_mode))?.label || cleanText(answers.price_talk_mode) || "Quando o cliente perguntar" },
      { label: "Tom comercial da IA", value: joinSelectedLabels(parseArrayAnswer(answers.activation_preferences), [...ACTIVATION_STYLE_OPTIONS, ...ACTIVATION_GUARDRAIL_OPTIONS], cleanText(answers.activation_preferences_other)) || "Ainda não definido" },
      { label: "Fala como", value: cleanText(answers.ai_identity_mode) || "Equipe da loja" },
    ]);
  }, [answers]);

  const commercialPriceItems = useMemo(() => {
    return buildBulletRows([
      { label: "Pode falar preço", value: yesNoLabel(answers.ai_can_send_price_directly) },
      { label: "O que precisa entender antes", value: joinSelectedLabels(parseArrayAnswer(answers.price_must_understand_before), PRICE_DIRECT_BEFORE_OPTIONS, cleanText(answers.price_direct_rule_other)) || cleanText(answers.price_must_understand_before_summary) },
      { label: "Regra principal de preço", value: cleanText(answers.price_direct_rule) || cleanText(answers.price_direct_rule_other) },
      { label: "Modo de fala sobre preço", value: PRICE_TALK_MODE_OPTIONS.find((option) => option.value === cleanText(answers.price_talk_mode))?.label || cleanText(answers.price_talk_mode) },
    ]);
  }, [answers]);

  const commercialHumanHelpItems = useMemo(() => {
    return buildBulletRows([
      { label: "Casos de desconto", value: joinSelectedLabels(parseArrayAnswer(answers.human_help_discount_cases_selected), HUMAN_HELP_DISCOUNT_OPTIONS, cleanText(answers.human_help_discount_cases_other)) },
      { label: "Projetos fora do padrão", value: joinSelectedLabels(parseArrayAnswer(answers.human_help_custom_project_cases_selected), HUMAN_HELP_CUSTOM_PROJECT_OPTIONS, cleanText(answers.human_help_custom_project_cases_other)) },
      { label: "Pagamentos e validações", value: joinSelectedLabels(parseArrayAnswer(answers.human_help_payment_cases_selected), HUMAN_HELP_PAYMENT_OPTIONS, cleanText(answers.human_help_payment_cases_other)) },
    ]);
  }, [answers]);

  const commercialPaymentItems = useMemo(() => {
    const payments = joinSelectedLabels(parseArrayAnswer(answers.accepted_payment_methods), PAYMENT_METHOD_MAIN_OPTIONS);
    const paymentConditions = joinSelectedLabels(parseArrayAnswer(answers.accepted_payment_methods), PAYMENT_METHOD_CONDITION_OPTIONS);
    return buildBulletRows([
      { label: "Formas de pagamento", value: [payments, paymentConditions].filter(Boolean).join(" • ") || cleanText(answers.accepted_payment_methods_summary) },
      { label: "Pode trabalhar com desconto", value: `${yesNoLabel(answers.can_offer_discount)}${cleanText(answers.max_discount_percent) ? ` • máximo de ${cleanText(answers.max_discount_percent)}%` : ""}` },
      { label: "Ticket médio da loja", value: cleanText(answers.average_ticket) ? `R$ ${cleanText(answers.average_ticket)}` : "Não definido" },
    ]);
  }, [answers]);

  const commercialNegotiationItems = useMemo(() => {
    return buildBulletRows([
      { label: "Regras gerais de negociação", value: joinSelectedLabels(parseArrayAnswer(answers.price_must_understand_before), PRICE_DIRECT_BEFORE_OPTIONS) || cleanText(answers.negotiation_rules_summary) || cleanText(answers.price_direct_rule) },
      { label: "Limites de promessa da IA", value: cleanText(answers.final_activation_notes) || cleanText(answers.store_description) },
      { label: "Pós-venda", value: joinSelectedLabels(parseArrayAnswer(answers.sales_flow_final_steps), SALES_FLOW_FINAL_OPTIONS, cleanText(answers.sales_flow_notes)) || cleanText(answers.sales_flow_notes) },
      { label: "Comportamento fora do horário", value: cleanText(answers.after_hours_behavior) || "Acolher, qualificar e alinhar próximo passo sem prometer execução imediata." },
      { label: "Resumo comercial para a IA", value: cleanText(answers.commercial_ai_summary) || cleanText(answers.price_direct_rule) || "Ainda não definido" },
    ]);
  }, [answers]);

  const commercialOverviewMetrics = useMemo(() => {
    const canTalkPrice = yesNoLabel(answers.ai_can_send_price_directly);
    const canDiscount = yesNoLabel(answers.can_offer_discount);
    const rawTone =
      joinSelectedLabels(
        parseArrayAnswer(answers.activation_preferences),
        ACTIVATION_STYLE_OPTIONS,
        cleanText(answers.activation_preferences_other)
      ) || "A definir";
    const humanCasesSummary = [
      joinSelectedLabels(
        parseArrayAnswer(answers.human_help_discount_cases_selected),
        HUMAN_HELP_DISCOUNT_OPTIONS,
        cleanText(answers.human_help_discount_cases_other)
      ),
      joinSelectedLabels(
        parseArrayAnswer(answers.human_help_custom_project_cases_selected),
        HUMAN_HELP_CUSTOM_PROJECT_OPTIONS,
        cleanText(answers.human_help_custom_project_cases_other)
      ),
      joinSelectedLabels(
        parseArrayAnswer(answers.human_help_payment_cases_selected),
        HUMAN_HELP_PAYMENT_OPTIONS,
        cleanText(answers.human_help_payment_cases_other)
      ),
      cleanText(answers.human_help_general_summary),
    ]
      .filter(Boolean)
      .join(" • ");

    return [
      {
        label: "Preço direto",
        value: canTalkPrice,
        tone: canTalkPrice === "Sim" ? ("green" as const) : canTalkPrice === "Não" ? ("amber" as const) : ("gray" as const),
        hint: "Define se a IA pode falar preço sem chamar humano",
      },
      {
        label: "Desconto",
        value: canDiscount,
        tone: canDiscount === "Sim" ? ("green" as const) : canDiscount === "Não" ? ("amber" as const) : ("gray" as const),
        hint: cleanText(answers.max_discount_percent) ? `Máximo atual de ${cleanText(answers.max_discount_percent)}%` : "Sem teto informado",
      },
      {
        label: "Tom da IA",
        value: rawTone === "A definir" ? rawTone : summarizeMetricText(rawTone, 26),
        tone: rawTone === "A definir" ? ("gray" as const) : ("green" as const),
        hint: rawTone === "A definir" ? "Personalidade comercial viva da IA" : summarizeMetricText(rawTone, 72),
      },
      {
        label: "Casos que chamam humano",
        value: humanCasesSummary ? "Configurado" : "A definir",
        tone: humanCasesSummary ? ("green" as const) : ("amber" as const),
        hint: humanCasesSummary ? summarizeMetricText(humanCasesSummary, 72) : "Desconto, projeto especial, pagamento e exceções",
      },
    ];
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
      { label: "Observações do responsável", value: cleanText(answers.responsible_notes) },
      { label: "A IA avisa o responsável", value: yesNoLabel(answers.ai_should_notify_responsible) },
      { label: "Canal para falar com a IA assistente", value: activationPrefs },
      { label: "Web chat interno", value: "Previsto como canal do sistema" },
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
      { label: "Limite máximo", value: cleanText(answers.max_discount_percent) ? `${cleanText(answers.max_discount_percent)}%` : "Não definido" },
      { label: "Quando precisa aprovação humana", value: joinSelectedLabels(parseArrayAnswer(answers.human_help_discount_cases_selected), HUMAN_HELP_DISCOUNT_OPTIONS, cleanText(answers.human_help_discount_cases_other)) },
      { label: "Quem aprova", value: cleanText(answers.discount_approver_name) || cleanText(answers.responsible_name) || "Responsável principal" },
      { label: "Regras especiais", value: cleanText(answers.discount_special_rules) || cleanText(answers.price_direct_rule_other) },
      { label: "Como funciona", value: cleanText(answers.discount_explanation) || "A IA pode trabalhar com desconto apenas dentro da regra definida pela loja. Quando o pedido sai do limite ou exige condição especial, ela deve chamar aprovação humana antes de confirmar qualquer valor." },
    ]);
  }, [answers]);

  const channelsOverviewMetrics = useMemo(() => {
    const commercialWhatsapp = cleanText(answers.commercial_whatsapp);
    const responsibleWhatsapp = cleanText(answers.responsible_whatsapp);
    const internalChatEnabled = cleanText(answers.internal_chat_enabled) || "Sim";
    const integrationStatus = cleanText(answers.integrations_status) || resolveOnboardingLabel(onboarding?.status).label;

    return [
      {
        label: "Canal comercial",
        value: commercialWhatsapp ? "Configurado" : "Pendente",
        tone: commercialWhatsapp ? ("green" as const) : ("amber" as const),
        hint: commercialWhatsapp || "Defina o canal principal usado pela IA vendedora",
      },
      {
        label: "Canal do responsável",
        value: responsibleWhatsapp ? "Configurado" : "Pendente",
        tone: responsibleWhatsapp ? ("green" as const) : ("amber" as const),
        hint: responsibleWhatsapp || "Defina o canal usado pela assistente operacional",
      },
      {
        label: "Chat interno",
        value: yesNoLabel(internalChatEnabled),
        tone: yesNoLabel(internalChatEnabled) === "Sim" ? ("green" as const) : ("gray" as const),
        hint: "Canal interno separado da Inbox para a IA assistente",
      },
      {
        label: "Integrações externas",
        value: integrationStatus || "Pendente",
        tone: integrationStatus === "Concluído" ? ("green" as const) : ("amber" as const),
        hint: cleanText(answers.integrations_notes) || "Webhook, WhatsApp e envios externos do projeto",
      },
    ];
  }, [answers, onboarding?.status]);


  const channelEssentialPendencies = useMemo(() => {
    const pendencies: string[] = [];

    if (!cleanText(channelDraft.commercial_whatsapp)) {
      pendencies.push("Definir o WhatsApp comercial real usado pela IA vendedora.");
    }
    if (!cleanText(channelDraft.responsible_whatsapp)) {
      pendencies.push("Definir o WhatsApp do responsável que recebe alertas, urgências e relatórios.");
    }
    if (!cleanText(channelDraft.integration_provider_name) || normalizeLoose(channelDraft.integration_provider_name).includes("ainda nao definido")) {
      pendencies.push("Definir qual é o provedor principal da integração de WhatsApp.");
    }
    if (!cleanText(channelDraft.integration_connection_mode)) {
      pendencies.push("Definir como a integração se conecta ao sistema.");
    }
    if (!cleanText(channelDraft.customer_messages_route)) {
      pendencies.push("Explicar para onde vão as mensagens dos clientes.");
    }
    if (!cleanText(channelDraft.assistant_alerts_route)) {
      pendencies.push("Explicar para onde vão os avisos da assistente operacional.");
    }

    return pendencies;
  }, [channelDraft]);

  const channelRecommendedPendencies = useMemo(() => {
    const pendencies: string[] = [];

    if (!cleanText(channelDraft.integration_test_status) || normalizeLoose(channelDraft.integration_test_status).includes("nao testado")) {
      pendencies.push("Registrar o status real do teste da integração.");
    }
    if (!cleanText(channelDraft.webhook_inbound_status) || normalizeLoose(channelDraft.webhook_inbound_status).includes("previsto no projeto")) {
      pendencies.push("Descrever a situação real do webhook de entrada.");
    }
    if (!cleanText(channelDraft.external_send_status) || normalizeLoose(channelDraft.external_send_status).includes("previsto no projeto")) {
      pendencies.push("Descrever a situação real do envio externo.");
    }
    if (!cleanText(channelDraft.channel_fallback_rule)) {
      pendencies.push("Definir a regra de fallback entre canal externo e painel interno.");
    }
    if (!cleanText(channelDraft.dedicated_number)) {
      pendencies.push("Definir se existe número ou chip dedicado.");
    }
    if (!cleanText(channelDraft.telegram_future_status)) {
      pendencies.push("Definir o status do canal futuro do Telegram.");
    }

    return pendencies;
  }, [channelDraft]);

  const channelGuidedStatusMetrics = useMemo(() => {
    const essentialDone = channelEssentialPendencies.length === 0;
    const recommendedDone = channelRecommendedPendencies.length === 0;
    const providerDefined =
      cleanText(channelDraft.integration_provider_name) &&
      !normalizeLoose(channelDraft.integration_provider_name).includes("ainda nao definido");
    const routingDefined = cleanText(channelDraft.customer_messages_route) && cleanText(channelDraft.assistant_alerts_route);

    return [
      {
        label: "Essencial",
        value: essentialDone ? "Completo" : "Pendente",
        tone: essentialDone ? ("green" as const) : ("amber" as const),
        hint: essentialDone ? "Os campos mínimos dos canais já foram definidos." : `${channelEssentialPendencies.length} pendência(s) crítica(s) para ativação.`,
      },
      {
        label: "Recomendado",
        value: recommendedDone ? "Completo" : "Faltando revisar",
        tone: recommendedDone ? ("green" as const) : ("gray" as const),
        hint: recommendedDone ? "Os ajustes finos dos canais já foram revisados." : `${channelRecommendedPendencies.length} pendência(s) recomendada(s).`,
      },
      {
        label: "Provedor",
        value: providerDefined ? "Definido" : "Pendente",
        tone: providerDefined ? ("green" as const) : ("amber" as const),
        hint: cleanText(channelDraft.integration_provider_name) || "Defina qual integração principal a loja usa.",
      },
      {
        label: "Roteamento",
        value: routingDefined ? "Definido" : "Pendente",
        tone: routingDefined ? ("green" as const) : ("amber" as const),
        hint: routingDefined ? "Rotas principais de cliente e assistente já descritas." : "Explique para onde vão clientes, avisos, urgências e relatórios.",
      },
    ];
  }, [channelDraft, channelEssentialPendencies, channelRecommendedPendencies]);

  const channelCommercialItems = useMemo(() => {
    return buildBulletRows([
      { label: "Nome do canal comercial", value: cleanText(answers.commercial_channel_name) || "Canal comercial principal" },
      { label: "WhatsApp comercial", value: cleanText(answers.commercial_whatsapp) },
      { label: "Canal ativo", value: yesNoLabel(answers.commercial_channel_active) || (cleanText(answers.commercial_whatsapp) ? "Sim" : "Não definido") },
      { label: "Recebe clientes reais", value: yesNoLabel(answers.commercial_receives_real_clients) || (cleanText(answers.commercial_whatsapp) ? "Sim" : "Não definido") },
      { label: "É o canal oficial da IA vendedora", value: yesNoLabel(answers.commercial_is_official_sales_channel) || (cleanText(answers.commercial_whatsapp) ? "Sim" : "Não definido") },
      { label: "Tipo de canal", value: cleanText(answers.commercial_channel_type) || "WhatsApp comercial da loja" },
      { label: "Prioridade de entrada", value: cleanText(answers.commercial_entry_priority) || "Canal principal de entrada de clientes" },
      { label: "Permite transbordo para humano", value: yesNoLabel(answers.commercial_human_handoff_enabled) || "Sim" },
      { label: "Observações", value: cleanText(answers.commercial_channel_notes) },
    ]);
  }, [answers]);

  const channelResponsibleItems = useMemo(() => {
    return buildBulletRows([
      { label: "Nome do canal do responsável", value: cleanText(answers.responsible_channel_name) || (cleanText(answers.responsible_name) ? `Canal de ${cleanText(answers.responsible_name)}` : "Canal do responsável") },
      { label: "WhatsApp do responsável", value: cleanText(answers.responsible_whatsapp) },
      { label: "Canal ativo", value: yesNoLabel(answers.responsible_channel_active) || (cleanText(answers.responsible_whatsapp) ? "Sim" : "Não definido") },
      { label: "Tipo de canal", value: cleanText(answers.responsible_channel_type) || "WhatsApp do responsável" },
      { label: "É o canal principal de alertas", value: yesNoLabel(answers.responsible_is_primary_alert_channel) || "Sim" },
      { label: "É o canal para comandos humanos", value: yesNoLabel(answers.responsible_is_human_command_channel) || "Sim" },
      { label: "Recebe alertas da IA", value: yesNoLabel(answers.responsible_receives_ai_alerts) || "Sim" },
      { label: "Recebe relatórios", value: yesNoLabel(answers.responsible_receives_reports) || "Sim" },
      { label: "Recebe urgências", value: yesNoLabel(answers.responsible_receives_urgencies) || "Sim" },
      { label: "Recebe avisos de visita", value: yesNoLabel(answers.responsible_receives_visit_alerts) || "Sim" },
      { label: "Recebe avisos de pagamento", value: yesNoLabel(answers.responsible_receives_payment_alerts) || "Sim" },
      { label: "Observações", value: cleanText(answers.responsible_channel_notes) },
    ]);
  }, [answers]);

  const channelInternalChatItems = useMemo(() => {
    return buildBulletRows([
      { label: "Chat interno ativado", value: yesNoLabel(answers.internal_chat_enabled || "Sim") },
      { label: "Pode ser usado pela IA assistente", value: yesNoLabel(answers.internal_chat_for_assistant || "Sim") },
      { label: "Fica separado da Inbox", value: yesNoLabel(answers.internal_chat_separate_from_inbox || "Sim") },
      { label: "Visível para a equipe", value: yesNoLabel(answers.internal_chat_visible_to_team || "Sim") },
      { label: "Aceita comandos manuais", value: yesNoLabel(answers.internal_chat_accepts_manual_commands || "Sim") },
      { label: "Prioridade do chat interno", value: cleanText(answers.internal_chat_priority) || "Canal secundário de apoio" },
      { label: "Observações", value: cleanText(answers.internal_chat_notes) || "Canal interno do painel para o responsável falar com a IA assistente sem misturar com clientes." },
    ]);
  }, [answers]);

  const channelOtherAndIntegrationItems = useMemo(() => {
    return buildBulletRows([
      { label: "Canal comercial e responsável são separados", value: yesNoLabel(answers.channels_are_separate || "Sim") },
      { label: "Número/chip dedicado", value: cleanText(answers.dedicated_number) || cleanText(answers.commercial_whatsapp) },
      { label: "Telegram futuro", value: cleanText(answers.telegram_future_status) || "Previsto para expansão futura" },
      { label: "Provedor / integração principal", value: cleanText(answers.integration_provider_name) || "Ainda não definido" },
      { label: "Modo de conexão", value: cleanText(answers.integration_connection_mode) || "API / webhook" },
      { label: "Webhook de entrada", value: cleanText(answers.webhook_inbound_status) || "Previsto no projeto" },
      { label: "Envio externo", value: cleanText(answers.external_send_status) || "Previsto no projeto" },
      { label: "Webhook de entrada realmente disponível", value: yesNoLabel(answers.integration_has_inbound_webhook) || "Não definido" },
      { label: "Webhook de status / entrega", value: yesNoLabel(answers.integration_has_status_webhook) || "Não definido" },
      { label: "Disparo externo funcionando", value: yesNoLabel(answers.integration_has_outbound_delivery) || "Não definido" },
      { label: "Integração de WhatsApp", value: cleanText(answers.whatsapp_integration_status) || (cleanText(answers.commercial_whatsapp) ? "Base configurada" : "Pendente") },
      { label: "Status do teste de integração", value: cleanText(answers.integration_test_status) || "Ainda não testado nesta tela" },
      { label: "Status geral das integrações", value: cleanText(answers.integrations_status) || resolveOnboardingLabel(onboarding?.status).label },
      { label: "Observações técnicas", value: cleanText(answers.integrations_notes) || "As integrações devem respeitar a separação entre canal comercial da IA vendedora e canal do responsável para a IA assistente." },
      { label: "Notas extras", value: cleanText(answers.extra_channel_notes) },
    ]);
  }, [answers, onboarding?.status]);

  const channelRoutingItems = useMemo(() => {
    return buildBulletRows([
      { label: "Mensagens de clientes", value: cleanText(answers.customer_messages_route) || "Mensagens de clientes entram pelo canal comercial da loja e seguem para a IA vendedora." },
      { label: "Avisos da assistente", value: cleanText(answers.assistant_alerts_route) || "Avisos da assistente vão para o canal do responsável e também podem aparecer no chat interno." },
      { label: "Urgências", value: cleanText(answers.urgency_route) || "Urgências e casos críticos devem priorizar o responsável principal." },
      { label: "Relatórios", value: cleanText(answers.reports_route) || "Relatórios operacionais devem ir para o canal do responsável e ficar disponíveis no painel." },
      { label: "Fallback entre canais", value: cleanText(answers.channel_fallback_rule) || "Se um canal externo falhar, o sistema deve manter fallback pelo painel/chat interno até o humano visualizar." },
      { label: "Resumo dos canais do sistema", value: cleanText(answers.channels_system_summary) || "O canal comercial atende clientes. O canal do responsável recebe contexto, alertas e urgências. O chat interno serve como apoio operacional separado da Inbox." },
    ]);
  }, [answers]);

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

  const handleOverviewEditSave = useCallback(async () => {
    const saved = await upsertConfigAnswers(
      {
        store_display_name: overviewDraft.store_display_name,
        responsible_name: overviewDraft.responsible_name,
        responsible_whatsapp: overviewDraft.responsible_whatsapp,
        commercial_whatsapp: overviewDraft.commercial_whatsapp,
        installation_days_rule: overviewDraft.installation_days_rule,
        technical_visit_days_rule: overviewDraft.technical_visit_days_rule,
        final_activation_notes: overviewDraft.final_activation_notes,
      },
      "Alterações da visão geral salvas com sucesso."
    );

    if (!saved) return;

    setIsOverviewEditing(false);
  }, [overviewDraft, upsertConfigAnswers]);

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
      service_region_modes_text: joinSelectedLabels(
        parseArrayAnswer(answers.service_region_modes),
        SERVICE_REGION_MODE_OPTIONS
      ),
      store_services_text: joinSelectedLabels(
        parseArrayAnswer(answers.store_services),
        STORE_SERVICE_OPTIONS
      ),
      store_services_other: cleanText(answers.store_services_other),
      strategy_service_exclusions: cleanText(answers.strategy_service_exclusions),
      store_description: cleanText(answers.store_description),
      strategy_primary_focus: cleanText(answers.strategy_primary_focus),
      strategy_sell_more: cleanText(answers.strategy_sell_more),
      strategy_common_customer: cleanText(answers.strategy_common_customer),
      strategy_ideal_customer: cleanText(answers.strategy_ideal_customer),
      strategy_ticket_range: cleanText(answers.strategy_ticket_range),
      strategy_positioning: cleanText(answers.strategy_positioning),
      main_store_brand: cleanText(answers.main_store_brand),
      brands_worked: cleanText(answers.brands_worked),
      strategy_priority_brands: cleanText(answers.strategy_priority_brands),
      strategy_non_worked_brands: cleanText(answers.strategy_non_worked_brands),
      strategy_top_lines: cleanText(answers.strategy_top_lines),
      strategy_top_products: cleanText(answers.strategy_top_products),
      strategy_differentials: cleanText(answers.strategy_differentials),
      strategy_promise_limits: cleanText(answers.strategy_promise_limits),
      strategy_requires_visit: cleanText(answers.strategy_requires_visit),
      strategy_requires_human: cleanText(answers.strategy_requires_human),
      strategy_exception_cases: cleanText(answers.strategy_exception_cases),
      strategy_ai_store_summary: cleanText(answers.strategy_ai_store_summary),
      strategy_ai_presentation: cleanText(answers.strategy_ai_presentation),
      strategy_ai_priorities: cleanText(answers.strategy_ai_priorities),
      strategy_ai_never_forget: cleanText(answers.strategy_ai_never_forget),
    });
    setIsStrategyEditing(true);
  }, [answers]);

  const handleStrategyEditCancel = useCallback(() => {
    setStrategyDraft({
      city: cleanText(answers.city),
      state: cleanText(answers.state),
      service_regions: cleanText(answers.service_regions),
      service_region_notes: cleanText(answers.service_region_notes),
      service_region_modes_text: joinSelectedLabels(
        parseArrayAnswer(answers.service_region_modes),
        SERVICE_REGION_MODE_OPTIONS
      ),
      store_services_text: joinSelectedLabels(
        parseArrayAnswer(answers.store_services),
        STORE_SERVICE_OPTIONS
      ),
      store_services_other: cleanText(answers.store_services_other),
      strategy_service_exclusions: cleanText(answers.strategy_service_exclusions),
      store_description: cleanText(answers.store_description),
      strategy_primary_focus: cleanText(answers.strategy_primary_focus),
      strategy_sell_more: cleanText(answers.strategy_sell_more),
      strategy_common_customer: cleanText(answers.strategy_common_customer),
      strategy_ideal_customer: cleanText(answers.strategy_ideal_customer),
      strategy_ticket_range: cleanText(answers.strategy_ticket_range),
      strategy_positioning: cleanText(answers.strategy_positioning),
      main_store_brand: cleanText(answers.main_store_brand),
      brands_worked: cleanText(answers.brands_worked),
      strategy_priority_brands: cleanText(answers.strategy_priority_brands),
      strategy_non_worked_brands: cleanText(answers.strategy_non_worked_brands),
      strategy_top_lines: cleanText(answers.strategy_top_lines),
      strategy_top_products: cleanText(answers.strategy_top_products),
      strategy_differentials: cleanText(answers.strategy_differentials),
      strategy_promise_limits: cleanText(answers.strategy_promise_limits),
      strategy_requires_visit: cleanText(answers.strategy_requires_visit),
      strategy_requires_human: cleanText(answers.strategy_requires_human),
      strategy_exception_cases: cleanText(answers.strategy_exception_cases),
      strategy_ai_store_summary: cleanText(answers.strategy_ai_store_summary),
      strategy_ai_presentation: cleanText(answers.strategy_ai_presentation),
      strategy_ai_priorities: cleanText(answers.strategy_ai_priorities),
      strategy_ai_never_forget: cleanText(answers.strategy_ai_never_forget),
    });
    setIsStrategyEditing(false);
  }, [answers]);

  const handleStrategyEditSave = useCallback(async () => {
    const saved = await upsertConfigAnswers(
      {
        city: strategyDraft.city,
        state: strategyDraft.state,
        service_regions: strategyDraft.service_regions,
        service_region_notes: strategyDraft.service_region_notes,
        store_services_other: strategyDraft.store_services_other,
        store_description: strategyDraft.store_description,
        main_store_brand: strategyDraft.main_store_brand,
        brands_worked: strategyDraft.brands_worked,
        strategy_service_exclusions: strategyDraft.strategy_service_exclusions,
        strategy_primary_focus: strategyDraft.strategy_primary_focus,
        strategy_sell_more: strategyDraft.strategy_sell_more,
        strategy_common_customer: strategyDraft.strategy_common_customer,
        strategy_ideal_customer: strategyDraft.strategy_ideal_customer,
        strategy_ticket_range: strategyDraft.strategy_ticket_range,
        strategy_positioning: strategyDraft.strategy_positioning,
        strategy_priority_brands: strategyDraft.strategy_priority_brands,
        strategy_non_worked_brands: strategyDraft.strategy_non_worked_brands,
        strategy_top_lines: strategyDraft.strategy_top_lines,
        strategy_top_products: strategyDraft.strategy_top_products,
        strategy_differentials: strategyDraft.strategy_differentials,
        strategy_promise_limits: strategyDraft.strategy_promise_limits,
        strategy_requires_visit: strategyDraft.strategy_requires_visit,
        strategy_requires_human: strategyDraft.strategy_requires_human,
        strategy_exception_cases: strategyDraft.strategy_exception_cases,
        strategy_ai_store_summary: strategyDraft.strategy_ai_store_summary,
        strategy_ai_presentation: strategyDraft.strategy_ai_presentation,
        strategy_ai_priorities: strategyDraft.strategy_ai_priorities,
        strategy_ai_never_forget: strategyDraft.strategy_ai_never_forget,
      },
      "Alterações da estratégia salvas com sucesso."
    );

    if (!saved) return;

    setIsStrategyEditing(false);
  }, [strategyDraft, upsertConfigAnswers]);


  useEffect(() => {
    setOperationDraft(createOperationDraftFromAnswers(answers));
  }, [answers]);

  const handleOperationDraftChange = useCallback((key: keyof OperationDraftState, value: string) => {
    setOperationDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const handleOperationEditCancel = useCallback(() => {
    setOperationDraft(createOperationDraftFromAnswers(answers));
    setIsOperationEditing(false);
  }, [answers]);

  const handleOperationEditSave = useCallback(async () => {
    const saved = await upsertConfigAnswers(
      {
        operating_days: operationDraft.operating_days,
        operating_hours: operationDraft.operating_hours,
        installation_days_rule: operationDraft.installation_days_rule,
        technical_visit_days_rule: operationDraft.technical_visit_days_rule,
        serves_saturday: operationDraft.serves_saturday,
        serves_sunday: operationDraft.serves_sunday,
        attends_holidays: operationDraft.serves_holiday,
        serves_holiday: operationDraft.serves_holiday,
        offers_installation: operationDraft.offers_installation,
        average_installation_time_days: operationDraft.average_installation_time_days,
        installation_process_other: operationDraft.installation_process_summary,
        offers_technical_visit: operationDraft.offers_technical_visit,
        technical_visit_rules_other: operationDraft.technical_visit_rules_summary,
        service_regions: operationDraft.service_regions,
        important_limitations_other: operationDraft.important_limitations,
        agenda_capacity_rule: operationDraft.agenda_capacity_rule,
        operational_ai_summary: operationDraft.operational_ai_summary,
      },
      "Alterações da operação salvas com sucesso."
    );

    if (!saved) return;

    setIsOperationEditing(false);
  }, [operationDraft, upsertConfigAnswers]);


  useEffect(() => {
    setCommercialDraft(createCommercialDraftFromAnswers(answers));
  }, [answers]);

  useEffect(() => {
    setPrimaryResponsibleDraft({
      id: "principal",
      name: cleanText(answers.responsible_name),
      whatsapp: cleanText(answers.responsible_whatsapp),
      role: cleanText(answers.responsible_role) || "Responsável principal",
      receives_ai_alerts: yesNoLabel(answers.ai_should_notify_responsible) !== "Não",
      can_approve_discount: true,
      can_approve_exceptions: true,
      can_assume_human: true,
      notes: cleanText(answers.responsible_notes),
    });
    setAdditionalResponsiblesDraft(parseResponsiblePeopleFromAnswers(answers));
    setActivationConfirmInformationDraft(Boolean(answers.confirm_information_is_correct));
    setActivationNotificationCasesDraft(
      joinSelectedLabels(
        parseArrayAnswer(answers.responsible_notification_cases),
        RESPONSIBLE_NOTIFICATION_CASE_OPTIONS,
        cleanText(answers.responsible_notification_cases_other)
      )
    );
    setActivationPreferencesDraft(
      joinSelectedLabels(
        parseArrayAnswer(answers.activation_preferences),
        [...ACTIVATION_STYLE_OPTIONS, ...ACTIVATION_GUARDRAIL_OPTIONS],
        cleanText(answers.activation_preferences_other)
      )
    );
  }, [answers]);

  const handleCommercialDraftChange = useCallback((key: keyof CommercialDraftState, value: string) => {
    setCommercialDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const handleCommercialEditCancel = useCallback(() => {
    setCommercialDraft(createCommercialDraftFromAnswers(answers));
    setIsCommercialEditing(false);
  }, [answers]);

  const handleCommercialEditSave = useCallback(async () => {
    const saved = await upsertConfigAnswers(
      {
        store_display_name: commercialDraft.ai_display_name,
        price_talk_mode: commercialDraft.ai_presentation_mode,
        activation_preferences_other: commercialDraft.ai_tone_summary,
        ai_identity_mode: commercialDraft.ai_speaks_as,
        ai_can_send_price_directly: commercialDraft.can_send_price_directly,
        price_direct_rule_other: commercialDraft.price_before_summary,
        price_direct_rule: commercialDraft.price_policy_summary,
        human_help_general_summary: commercialDraft.human_help_summary,
        accepted_payment_methods_summary: commercialDraft.payment_methods_summary,
        discount_policy_summary: commercialDraft.discount_policy_summary,
        negotiation_rules_summary: commercialDraft.negotiation_rules_summary,
        final_activation_notes: commercialDraft.promise_limits_summary,
        sales_flow_notes: commercialDraft.post_sale_summary,
        after_hours_behavior: commercialDraft.after_hours_summary,
        commercial_ai_summary: commercialDraft.commercial_ai_summary,
      },
      "Alterações de Comercial e IA salvas com sucesso."
    );

    if (!saved) return;

    setIsCommercialEditing(false);
  }, [commercialDraft, upsertConfigAnswers]);



  useEffect(() => {
    setDiscountDraft(createDiscountDraftFromAnswers(answers));
  }, [answers]);

  const handleDiscountDraftChange = useCallback((key: keyof DiscountDraftState, value: string) => {
    setDiscountDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const handleDiscountEditCancel = useCallback(() => {
    setDiscountDraft(createDiscountDraftFromAnswers(answers));
    setIsDiscountEditing(false);
  }, [answers]);

  const handleDiscountEditSave = useCallback(async () => {
    const saved = await upsertConfigAnswers(
      {
        can_offer_discount: discountDraft.can_offer_discount,
        max_discount_percent: discountDraft.max_discount_percent,
        human_help_discount_cases_other: discountDraft.human_help_discount_summary,
        discount_approver_name: discountDraft.discount_approver,
        discount_special_rules: discountDraft.special_discount_rules,
        discount_explanation: discountDraft.discount_explanation,
      },
      "Alterações de descontos salvas com sucesso."
    );

    if (!saved) return;

    setIsDiscountEditing(false);
  }, [discountDraft, upsertConfigAnswers]);

  useEffect(() => {
    setChannelDraft(createChannelDraftFromAnswers(answers));
  }, [answers]);

  const handleChannelDraftChange = useCallback((key: keyof ChannelDraftState, value: string) => {
    setChannelDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const handleChannelsEditCancel = useCallback(() => {
    setChannelDraft(createChannelDraftFromAnswers(answers));
    setShowChannelsAdvanced(false);
    setIsChannelsEditing(false);
  }, [answers]);

  const handleChannelsEditSave = useCallback(async () => {
    const saved = await upsertConfigAnswers(
      {
        commercial_channel_name: channelDraft.commercial_channel_name,
        commercial_whatsapp: channelDraft.commercial_whatsapp,
        commercial_channel_active: channelDraft.commercial_channel_active,
        commercial_receives_real_clients: channelDraft.commercial_receives_real_clients,
        commercial_is_official_sales_channel: channelDraft.commercial_is_official_sales_channel,
        commercial_channel_type: channelDraft.commercial_channel_type,
        commercial_entry_priority: channelDraft.commercial_entry_priority,
        commercial_human_handoff_enabled: channelDraft.commercial_human_handoff_enabled,
        commercial_channel_notes: channelDraft.commercial_channel_notes,
        responsible_channel_name: channelDraft.responsible_channel_name,
        responsible_whatsapp: channelDraft.responsible_whatsapp,
        responsible_channel_active: channelDraft.responsible_channel_active,
        responsible_channel_type: channelDraft.responsible_channel_type,
        responsible_is_primary_alert_channel: channelDraft.responsible_is_primary_alert_channel,
        responsible_is_human_command_channel: channelDraft.responsible_is_human_command_channel,
        responsible_receives_ai_alerts: channelDraft.responsible_receives_ai_alerts,
        responsible_receives_reports: channelDraft.responsible_receives_reports,
        responsible_receives_urgencies: channelDraft.responsible_receives_urgencies,
        responsible_receives_visit_alerts: channelDraft.responsible_receives_visit_alerts,
        responsible_receives_payment_alerts: channelDraft.responsible_receives_payment_alerts,
        responsible_channel_notes: channelDraft.responsible_channel_notes,
        internal_chat_enabled: channelDraft.internal_chat_enabled,
        internal_chat_for_assistant: channelDraft.internal_chat_for_assistant,
        internal_chat_separate_from_inbox: channelDraft.internal_chat_separate_from_inbox,
        internal_chat_visible_to_team: channelDraft.internal_chat_visible_to_team,
        internal_chat_accepts_manual_commands: channelDraft.internal_chat_accepts_manual_commands,
        internal_chat_priority: channelDraft.internal_chat_priority,
        internal_chat_notes: channelDraft.internal_chat_notes,
        channels_are_separate: channelDraft.channels_are_separate,
        dedicated_number: channelDraft.dedicated_number,
        telegram_future_status: channelDraft.telegram_future_status,
        extra_channel_notes: channelDraft.extra_channel_notes,
        integration_provider_name: channelDraft.integration_provider_name,
        integration_connection_mode: channelDraft.integration_connection_mode,
        integration_test_status: channelDraft.integration_test_status,
        webhook_inbound_status: channelDraft.webhook_inbound_status,
        external_send_status: channelDraft.external_send_status,
        integration_has_inbound_webhook: channelDraft.integration_has_inbound_webhook,
        integration_has_status_webhook: channelDraft.integration_has_status_webhook,
        integration_has_outbound_delivery: channelDraft.integration_has_outbound_delivery,
        whatsapp_integration_status: channelDraft.whatsapp_integration_status,
        integrations_status: channelDraft.integrations_status,
        integrations_notes: channelDraft.integrations_notes,
        customer_messages_route: channelDraft.customer_messages_route,
        assistant_alerts_route: channelDraft.assistant_alerts_route,
        urgency_route: channelDraft.urgency_route,
        reports_route: channelDraft.reports_route,
        channel_fallback_rule: channelDraft.channel_fallback_rule,
        channels_system_summary: channelDraft.channels_system_summary,
      },
      "Alterações de canais e integrações salvas com sucesso."
    );

    if (!saved) return;

    setShowChannelsAdvanced(false);
    setIsChannelsEditing(false);
  }, [channelDraft, upsertConfigAnswers]);

  const handlePrimaryResponsibleChange = useCallback(
    (key: keyof ResponsiblePersonDraft, value: string | boolean) => {
      setPrimaryResponsibleDraft((current) => ({
        ...current,
        [key]: value,
      }));
    },
    []
  );

  const handleAdditionalResponsibleChange = useCallback(
    (id: string, key: keyof ResponsiblePersonDraft, value: string | boolean) => {
      setAdditionalResponsiblesDraft((current) =>
        current.map((item) => (item.id === id ? { ...item, [key]: value } : item))
      );
    },
    []
  );

  const handleAddResponsible = useCallback(() => {
    setAdditionalResponsiblesDraft((current) => [...current, createEmptyResponsibleDraft(false)]);
    setIsActivationEditing(true);
  }, []);

  const handleRemoveResponsible = useCallback((id: string) => {
    setAdditionalResponsiblesDraft((current) => current.filter((item) => item.id !== id));
  }, []);

  const handleActivationEditCancel = useCallback(() => {
    setPrimaryResponsibleDraft({
      id: "principal",
      name: cleanText(answers.responsible_name),
      whatsapp: cleanText(answers.responsible_whatsapp),
      role: cleanText(answers.responsible_role) || "Responsável principal",
      receives_ai_alerts: yesNoLabel(answers.ai_should_notify_responsible) !== "Não",
      can_approve_discount: true,
      can_approve_exceptions: true,
      can_assume_human: true,
      notes: cleanText(answers.responsible_notes),
    });
    setAdditionalResponsiblesDraft(parseResponsiblePeopleFromAnswers(answers));
    setActivationConfirmInformationDraft(Boolean(answers.confirm_information_is_correct));
    setActivationNotificationCasesDraft(
      joinSelectedLabels(
        parseArrayAnswer(answers.responsible_notification_cases),
        RESPONSIBLE_NOTIFICATION_CASE_OPTIONS,
        cleanText(answers.responsible_notification_cases_other)
      )
    );
    setActivationPreferencesDraft(
      joinSelectedLabels(
        parseArrayAnswer(answers.activation_preferences),
        [...ACTIVATION_STYLE_OPTIONS, ...ACTIVATION_GUARDRAIL_OPTIONS],
        cleanText(answers.activation_preferences_other)
      )
    );
    setIsActivationEditing(false);
  }, [answers]);

  const handleActivationEditSave = useCallback(async () => {
    const cleanAdditional = additionalResponsiblesDraft.filter(
      (item) => cleanText(item.name) || cleanText(item.whatsapp)
    );

    const saved = await upsertConfigAnswers(
      {
        responsible_name: cleanText(primaryResponsibleDraft.name),
        responsible_whatsapp: cleanText(primaryResponsibleDraft.whatsapp),
        responsible_role: cleanText(primaryResponsibleDraft.role),
        responsible_notes: cleanText(primaryResponsibleDraft.notes),
        ai_should_notify_responsible: primaryResponsibleDraft.receives_ai_alerts,
        confirm_information_is_correct: activationConfirmInformationDraft,
        responsible_notification_cases_other: cleanText(activationNotificationCasesDraft),
        activation_preferences_other: cleanText(activationPreferencesDraft),
        final_activation_notes: cleanText(activationPreferencesDraft),
        additional_responsibles: serializeResponsiblePeople(cleanAdditional),
      },
      "Alterações de responsável e ativação salvas com sucesso."
    );

    if (!saved) return;

    setIsActivationEditing(false);
  }, [
    primaryResponsibleDraft,
    additionalResponsiblesDraft,
    activationConfirmInformationDraft,
    activationNotificationCasesDraft,
    activationPreferencesDraft,
    upsertConfigAnswers,
  ]);

  const handlePoolFormChange = useCallback(
    (key: keyof PoolFormState, value: string | boolean) => {
      setPoolForm((current) => ({
        ...current,
        [key]: formatManualPoolFieldValue(key, value),
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
    const material = cleanText(poolForm.material);
    const shape = cleanText(poolForm.shape);
    const widthM = parseNumberInput(poolForm.width_m);
    const lengthM = parseNumberInput(poolForm.length_m);
    const depthM = parseNumberInput(poolForm.depth_m);
    const price = parseNumberInput(poolForm.price);
    const parsedStock = parseNumberInput(poolForm.stock_quantity);

    if (!poolName) {
      setErrorText("Preencha pelo menos o nome da piscina antes de salvar.");
      setSuccessText(null);
      return;
    }

    if (widthM === null || lengthM === null || depthM === null) {
      setErrorText("Preencha largura, comprimento e profundidade da piscina antes de salvar.");
      setSuccessText(null);
      return;
    }

    if (!shape) {
      setErrorText("Preencha o formato da piscina antes de salvar.");
      setSuccessText(null);
      return;
    }

    if (!material) {
      setErrorText("Preencha o material da piscina antes de salvar.");
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

    let createdPoolId = "";
    const uploadedStoragePaths: string[] = [];

    try {
      const composedPoolDescription = buildPoolManualDescription(poolForm);
      const maxCapacityL = Math.max(1, Math.round(widthM * lengthM * depthM * 1000));

      const insertPayload = {
        organization_id: organizationId,
        store_id: activeStoreId,
        name: poolName,
        width_m: widthM,
        length_m: lengthM,
        depth_m: depthM,
        shape,
        material,
        max_capacity_l: maxCapacityL,
        price,
        description: composedPoolDescription || null,
        stock_quantity: parsedStock === null ? null : Math.round(parsedStock),
        is_active: poolForm.is_active,
        track_stock: poolForm.track_stock,
      };

      const { data: createdPool, error: insertError } = await supabase
        .from("pools")
        .insert(insertPayload)
        .select("id")
        .single();

      if (insertError) throw insertError;

      createdPoolId = String(createdPool?.id || "").trim();
      if (!createdPoolId) {
        throw new Error("Não foi possível obter o ID da piscina criada.");
      }

      if (poolPhotos.length > 0) {
        const photoRows: Array<{
          pool_id: string;
          organization_id: string;
          store_id: string;
          storage_path: string;
          file_name: string;
          file_size_bytes: number;
          sort_order: number;
        }> = [];

        for (const [index, file] of poolPhotos.entries()) {
          const safeFileName = `${Date.now()}-${index}-${file.name.replace(/\s+/g, "-")}`;
          const storagePath = `${organizationId}/${activeStoreId}/${createdPoolId}/${safeFileName}`;

          const { error: uploadError } = await supabase.storage
            .from("pool-photos")
            .upload(storagePath, file, {
              cacheControl: "3600",
              upsert: false,
            });

          if (uploadError) throw uploadError;

          uploadedStoragePaths.push(storagePath);
          photoRows.push({
            pool_id: createdPoolId,
            organization_id: organizationId,
            store_id: activeStoreId,
            storage_path: storagePath,
            file_name: file.name,
            file_size_bytes: file.size,
            sort_order: index,
          });
        }

        const { error: poolPhotosInsertError } = await supabase
          .from("pool_photos")
          .insert(photoRows);

        if (poolPhotosInsertError) throw poolPhotosInsertError;
      }

      setPoolForm(createEmptyPoolForm());
      setPoolPhotos([]);
      setCounts((current) => ({
        ...current,
        pools: current.pools + 1,
      }));
      setSuccessText(
        poolPhotos.length > 0
          ? "Piscina e fotos salvas com sucesso."
          : "Piscina salva com sucesso."
      );
      await fetchPageData();
    } catch (error: any) {
      if (uploadedStoragePaths.length > 0) {
        await supabase.storage.from("pool-photos").remove(uploadedStoragePaths);
      }

      if (createdPoolId) {
        await supabase.from("pool_photos").delete().eq("pool_id", createdPoolId);
        await supabase.from("pools").delete().eq("id", createdPoolId);
      }

      setErrorText(error?.message ?? "Erro ao salvar a piscina manualmente.");
      setSuccessText(null);
    } finally {
      setSavingPool(false);
    }
  }, [organizationId, activeStoreId, poolForm, poolPhotos, fetchPageData]);

  const handleCatalogFormChange = useCallback(
    (key: keyof CatalogFormState, value: string | boolean) => {
      setCatalogForm((current) => ({
        ...current,
        [key]: formatManualCatalogFieldValue(key, value),
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

    let createdCatalogItemId = "";
    const uploadedStoragePaths: string[] = [];

    try {
      const parsedPrice = parseNumberInput(catalogForm.price);
      const parsedStock = parseNumberInput(catalogForm.stock_quantity);
      const metadataPayload = {
        categoria: catalogForm.category,
        brand: cleanText(catalogForm.brand) || null,
        line: cleanText(catalogForm.line) || null,
        unit_label: cleanText(catalogForm.unit_label) || null,
        size_details: cleanText(catalogForm.size_details) || null,
        width_cm: parseNumberInput(catalogForm.width_cm),
        height_cm: parseNumberInput(catalogForm.height_cm),
        length_cm: parseNumberInput(catalogForm.length_cm),
        weight_kg: parseNumberInput(catalogForm.weight_kg),
        application: cleanText(catalogForm.application) || null,
        technical_notes: cleanText(catalogForm.technical_notes) || null,
        manual_created_in_configuracoes: true,
        pending_photo_upload_count: 0,
      };

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
        metadata: metadataPayload,
      };

      const { data: createdItem, error: insertError } = await supabase
        .from("store_catalog_items")
        .insert(insertPayload)
        .select("id")
        .single();

      if (insertError) throw insertError;

      createdCatalogItemId = String(createdItem?.id || "").trim();
      if (!createdCatalogItemId) {
        throw new Error("Não foi possível obter o ID do item criado.");
      }

      if (catalogPhotos.length > 0) {
        const photoRows: Array<{
          catalog_item_id: string;
          storage_path: string;
          file_name: string;
          file_size_bytes: number;
          sort_order: number;
        }> = [];

        for (const [index, file] of catalogPhotos.entries()) {
          const extension = file.name.split(".").pop() || "jpg";
          const safeFileName = `${Date.now()}-${index}-${crypto.randomUUID()}.${extension}`;
          const storagePath = `${organizationId}/${activeStoreId}/${createdCatalogItemId}/${safeFileName}`;

          const { error: uploadError } = await supabase.storage
            .from("store-catalog-photos")
            .upload(storagePath, file, {
              cacheControl: "3600",
              upsert: false,
            });

          if (uploadError) throw uploadError;

          uploadedStoragePaths.push(storagePath);
          photoRows.push({
            catalog_item_id: createdCatalogItemId,
            storage_path: storagePath,
            file_name: file.name,
            file_size_bytes: file.size,
            sort_order: index,
          });
        }

        const { error: insertPhotosError } = await supabase
          .from("store_catalog_item_photos")
          .insert(photoRows);

        if (insertPhotosError) throw insertPhotosError;
      }

      setCatalogForm(createEmptyCatalogForm());
      setCatalogPhotos([]);
      setCounts((current) => ({
        ...current,
        [catalogForm.category]: current[catalogForm.category] + 1,
      }));
      setSuccessText(
        catalogPhotos.length > 0
          ? "Item e fotos salvos com sucesso."
          : "Item salvo com sucesso."
      );
      await fetchPageData();
    } catch (error: any) {
      if (uploadedStoragePaths.length > 0) {
        await supabase.storage.from("store-catalog-photos").remove(uploadedStoragePaths);
      }

      if (createdCatalogItemId) {
        await supabase
          .from("store_catalog_item_photos")
          .delete()
          .eq("catalog_item_id", createdCatalogItemId);
        await supabase
          .from("store_catalog_items")
          .delete()
          .eq("id", createdCatalogItemId)
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId);
      }

      setErrorText(error?.message ?? "Erro ao salvar o item manualmente.");
      setSuccessText(null);
    } finally {
      setSavingCatalogItem(false);
    }
  }, [organizationId, activeStoreId, catalogForm, catalogPhotos, fetchPageData]);

  const handleDownloadImportFile = useCallback(
    async (file: StoreImportFileRow) => {
      const bucket = cleanText(file.storage_bucket);
      const path = cleanText(file.storage_path);

      if (!bucket || !path) {
        setErrorText("Este arquivo bruto não possui bucket ou caminho válido para download.");
        setSuccessText(null);
        return;
      }

      setDownloadingImportFileId(file.id);
      setErrorText(null);

      try {
        const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
        if (error) throw error;
        if (!data?.signedUrl) throw new Error("Não foi possível gerar o link temporário deste arquivo.");
        window.open(data.signedUrl, "_blank", "noopener,noreferrer");
      } catch (error: any) {
        setErrorText(error?.message ?? "Erro ao gerar o download do arquivo bruto.");
        setSuccessText(null);
      } finally {
        setDownloadingImportFileId(null);
      }
    },
    []
  );

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
    <div className="space-y-4 overflow-x-hidden">
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
            <div className="space-y-4 overflow-x-hidden">
              <div className="rounded-2xl border border-black/10 bg-gray-50 p-4">
                <div className="mb-1 text-sm font-semibold text-gray-900">Editar estratégia na mesma página</div>
                <div className="mb-3 text-xs text-gray-600">
                  Aqui você pode completar ou adicionar informações que estejam faltando no onboarding.
                </div>

                <div className="space-y-4 overflow-x-hidden">
                  <div className="rounded-2xl border border-gray-200 bg-white p-4">
                    <div className="mb-3 text-sm font-semibold text-gray-900">1. Base de atuação da loja</div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Cidade principal</span>
                        <input
                          value={strategyDraft.city ?? ""}
                          onChange={(event) => handleStrategyDraftChange("city", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Estado</span>
                        <input
                          value={strategyDraft.state ?? ""}
                          onChange={(event) => handleStrategyDraftChange("state", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1 md:col-span-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Região principal de atendimento</span>
                        <input
                          value={strategyDraft.service_regions ?? ""}
                          onChange={(event) => handleStrategyDraftChange("service_regions", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1 md:col-span-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Até onde atende</span>
                        <input
                          value={strategyDraft.service_region_modes_text ?? ""}
                          onChange={(event) => handleStrategyDraftChange("service_region_modes_text", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: cidade + cidades vizinhas, todo o estado, sob consulta..."
                        />
                      </label>

                      <label className="space-y-1 md:col-span-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Observações sobre cobertura</span>
                        <textarea
                          value={strategyDraft.service_region_notes ?? ""}
                          onChange={(event) => handleStrategyDraftChange("service_region_notes", event.target.value)}
                          rows={3}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-gray-200 bg-white p-4">
                    <div className="mb-3 text-sm font-semibold text-gray-900">2. Serviços que a loja oferece</div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="space-y-1 md:col-span-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Serviços principais</span>
                        <input
                          value={strategyDraft.store_services_text ?? ""}
                          onChange={(event) => handleStrategyDraftChange("store_services_text", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: venda de piscinas, instalação, visita técnica..."
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Outros serviços</span>
                        <input
                          value={strategyDraft.store_services_other ?? ""}
                          onChange={(event) => handleStrategyDraftChange("store_services_other", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Serviços que não faz</span>
                        <input
                          value={strategyDraft.strategy_service_exclusions ?? ""}
                          onChange={(event) => handleStrategyDraftChange("strategy_service_exclusions", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: não faz obra do entorno, não faz manutenção..."
                        />
                      </label>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-gray-200 bg-white p-4">
                    <div className="mb-3 text-sm font-semibold text-gray-900">3. Foco comercial da loja</div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="space-y-1 md:col-span-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Tipo de loja / foco comercial</span>
                        <textarea
                          value={strategyDraft.store_description ?? ""}
                          onChange={(event) => handleStrategyDraftChange("store_description", event.target.value)}
                          rows={3}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Principal foco da loja</span>
                        <input
                          value={strategyDraft.strategy_primary_focus ?? ""}
                          onChange={(event) => handleStrategyDraftChange("strategy_primary_focus", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">O que quer vender mais</span>
                        <input
                          value={strategyDraft.strategy_sell_more ?? ""}
                          onChange={(event) => handleStrategyDraftChange("strategy_sell_more", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Tipo de cliente mais comum</span>
                        <input
                          value={strategyDraft.strategy_common_customer ?? ""}
                          onChange={(event) => handleStrategyDraftChange("strategy_common_customer", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Tipo de cliente ideal</span>
                        <input
                          value={strategyDraft.strategy_ideal_customer ?? ""}
                          onChange={(event) => handleStrategyDraftChange("strategy_ideal_customer", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Faixa de ticket mais comum</span>
                        <input
                          value={strategyDraft.strategy_ticket_range ?? ""}
                          onChange={(event) => handleStrategyDraftChange("strategy_ticket_range", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Posicionamento comercial</span>
                        <input
                          value={strategyDraft.strategy_positioning ?? ""}
                          onChange={(event) => handleStrategyDraftChange("strategy_positioning", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: consultiva, premium, técnica, popular..."
                        />
                      </label>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-gray-200 bg-white p-4">
                    <div className="mb-3 text-sm font-semibold text-gray-900">4. Marcas, linhas e produtos trabalhados</div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Marca principal</span>
                        <input
                          value={strategyDraft.main_store_brand ?? ""}
                          onChange={(event) => handleStrategyDraftChange("main_store_brand", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Outras marcas</span>
                        <input
                          value={strategyDraft.brands_worked ?? ""}
                          onChange={(event) => handleStrategyDraftChange("brands_worked", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Marcas que prefere priorizar</span>
                        <input
                          value={strategyDraft.strategy_priority_brands ?? ""}
                          onChange={(event) => handleStrategyDraftChange("strategy_priority_brands", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Marcas ou linhas que não trabalha</span>
                        <input
                          value={strategyDraft.strategy_non_worked_brands ?? ""}
                          onChange={(event) => handleStrategyDraftChange("strategy_non_worked_brands", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Linhas principais vendidas</span>
                        <input
                          value={strategyDraft.strategy_top_lines ?? ""}
                          onChange={(event) => handleStrategyDraftChange("strategy_top_lines", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Produtos com maior giro</span>
                        <input
                          value={strategyDraft.strategy_top_products ?? ""}
                          onChange={(event) => handleStrategyDraftChange("strategy_top_products", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-gray-200 bg-white p-4">
                    <div className="mb-3 text-sm font-semibold text-gray-900">5. Diferenciais, limites e restrições</div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="space-y-1 md:col-span-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Diferenciais da loja</span>
                        <textarea
                          value={strategyDraft.strategy_differentials ?? ""}
                          onChange={(event) => handleStrategyDraftChange("strategy_differentials", event.target.value)}
                          rows={3}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: frete grátis, envio no mesmo dia, instalação própria..."
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">O que a loja não promete</span>
                        <textarea
                          value={strategyDraft.strategy_promise_limits ?? ""}
                          onChange={(event) => handleStrategyDraftChange("strategy_promise_limits", event.target.value)}
                          rows={3}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">O que depende de visita</span>
                        <textarea
                          value={strategyDraft.strategy_requires_visit ?? ""}
                          onChange={(event) => handleStrategyDraftChange("strategy_requires_visit", event.target.value)}
                          rows={3}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">O que depende de humano</span>
                        <textarea
                          value={strategyDraft.strategy_requires_human ?? ""}
                          onChange={(event) => handleStrategyDraftChange("strategy_requires_human", event.target.value)}
                          rows={3}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Casos de exceção importantes</span>
                        <textarea
                          value={strategyDraft.strategy_exception_cases ?? ""}
                          onChange={(event) => handleStrategyDraftChange("strategy_exception_cases", event.target.value)}
                          rows={3}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-gray-200 bg-white p-4">
                    <div className="mb-3 text-sm font-semibold text-gray-900">6. Resumo estratégico para a IA</div>
                    <div className="grid gap-3">
                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Como a IA deve entender a loja</span>
                        <textarea
                          value={strategyDraft.strategy_ai_store_summary ?? ""}
                          onChange={(event) => handleStrategyDraftChange("strategy_ai_store_summary", event.target.value)}
                          rows={3}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Como a IA deve apresentar a loja</span>
                        <textarea
                          value={strategyDraft.strategy_ai_presentation ?? ""}
                          onChange={(event) => handleStrategyDraftChange("strategy_ai_presentation", event.target.value)}
                          rows={3}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">O que a IA deve priorizar</span>
                        <textarea
                          value={strategyDraft.strategy_ai_priorities ?? ""}
                          onChange={(event) => handleStrategyDraftChange("strategy_ai_priorities", event.target.value)}
                          rows={3}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">O que a IA nunca deve esquecer</span>
                        <textarea
                          value={strategyDraft.strategy_ai_never_forget ?? ""}
                          onChange={(event) => handleStrategyDraftChange("strategy_ai_never_forget", event.target.value)}
                          rows={3}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4 overflow-x-hidden">
              <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <div className="mb-2 text-sm font-semibold text-gray-900">1. Base de atuação da loja</div>
                  <SummaryList items={strategyBaseItems} />
                </div>

                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <div className="mb-2 text-sm font-semibold text-gray-900">2. Serviços que a loja oferece</div>
                  <SummaryList items={strategyServicesItems} />
                </div>

                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <div className="mb-2 text-sm font-semibold text-gray-900">3. Foco comercial da loja</div>
                  <SummaryList items={strategyCommercialFocusItems} />
                </div>

                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <div className="mb-2 text-sm font-semibold text-gray-900">4. Marcas, linhas e produtos trabalhados</div>
                  <SummaryList items={strategyBrandsItems} />
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <div className="mb-2 text-sm font-semibold text-gray-900">5. Diferenciais, limites e restrições</div>
                  <SummaryList items={strategyDifferentialsItems} />
                </div>

                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <div className="mb-2 text-sm font-semibold text-gray-900">6. Resumo estratégico para a IA</div>
                  <SummaryList items={strategyAiSummaryItems} />
                </div>
              </div>
            </div>
          )}
        </SectionBlock>
      ) : null}

      {activeTab === "piscinas" ? (
        <div className="space-y-4 overflow-x-hidden">
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
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Marca</span>
                <input
                  value={poolForm.brand}
                  onChange={(event) => handlePoolFormChange("brand", event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  placeholder="Ex.: iGUi"
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
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Cor</span>
                <input
                  value={poolForm.color}
                  onChange={(event) => handlePoolFormChange("color", event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  placeholder="Azul, branca, areia..."
                />
              </label>

              <label className="space-y-1 md:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Acabamento / linha</span>
                <input
                  value={poolForm.finish}
                  onChange={(event) => handlePoolFormChange("finish", event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  placeholder="Premium, borda molhada, com hidro..."
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
                  placeholder="15990.00"
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

              <label className="space-y-1 md:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Itens inclusos</span>
                <textarea
                  value={poolForm.included_items}
                  onChange={(event) => handlePoolFormChange("included_items", event.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  placeholder="Ex.: dispositivo, casa de máquinas, hidro, iluminação..."
                />
              </label>

              <label className="space-y-1 md:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Observações de instalação</span>
                <textarea
                  value={poolForm.installation_notes}
                  onChange={(event) => handlePoolFormChange("installation_notes", event.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  placeholder="Ex.: precisa de visita técnica, prazo médio, condições do terreno..."
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
            description="Visão mais forte da oferta de piscinas da loja, sem depender só de texto corrido."
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {poolsOverviewMetrics.map((item) => (
                <StatusCard
                  key={item.label}
                  label={item.label}
                  value={item.value}
                  tone={item.tone}
                  hint={item.hint}
                />
              ))}
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <div>
                <div className="mb-2 text-sm font-semibold text-gray-900">Base comercial de piscinas</div>
                <SummaryList items={poolsOperationalItems} />
              </div>
              <div>
                <div className="mb-2 text-sm font-semibold text-gray-900">Contagem rápida</div>
                <SummaryList
                  items={[
                    `Piscinas cadastradas: ${counts.pools}.`,
                    `Tipos-base configurados: ${poolTypesLabel || "Ainda não definidos"}.`,
                    `Marca principal ligada à operação: ${cleanText(answers.main_store_brand) || cleanText(answers.brands_worked) || "Ainda não definida"}.`,
                    "Cadastro manual e importação inteligente podem coexistir sem conflito.",
                  ]}
                />
              </div>
            </div>
          </SectionBlock>

          <SectionBlock
            title="Arquivos brutos importados"
            description="Esses são os arquivos originais usados no upload inteligente que geraram piscinas no sistema. Este bloco deve ficar sempre no final da aba."
          >
            {poolImportFiles.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-4 text-sm text-gray-600">
                Nenhum arquivo bruto importado foi encontrado para piscinas ainda.
              </div>
            ) : (
              <div className="space-y-3">
                {poolImportFiles.map((file) => (
                  <div
                    key={file.id}
                    className="rounded-2xl border border-gray-200 bg-gray-50 p-4"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="break-words text-sm font-semibold text-gray-900">
                          {cleanText(file.original_file_name) || "Arquivo sem nome"}
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                          Importado em {formatImportDate(file.created_at)}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleDownloadImportFile(file)}
                        disabled={downloadingImportFileId === file.id}
                        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {downloadingImportFileId === file.id ? "Gerando link..." : "Baixar arquivo bruto"}
                      </button>
                    </div>

                    <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                        Tipo: {cleanText(file.extension)?.toUpperCase() || cleanText(file.mime_type) || "Não definido"}
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                        Tamanho: {formatFileSize(file.size_bytes)}
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                        Status: {cleanText(file.status) || "Não definido"}
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                        Resumo: {getImportSummaryText(file.import_summary || null)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionBlock>
        </div>
      ) : null}

      {activeTab === "produtos-acessorios" ? (
        <div className="space-y-4 overflow-x-hidden">
          <SectionBlock
            title="Adicionar item manualmente"
            description="Cadastre produtos químicos, acessórios e outros itens do catálogo por aqui. Você pode subir até 10 fotos por item, com no máximo 50 MB por foto."
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
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Linha / modelo</span>
                <input
                  value={catalogForm.line}
                  onChange={(event) => handleCatalogFormChange("line", event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  placeholder="Ex.: Premium, Manutenção..."
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Unidade</span>
                <input
                  value={catalogForm.unit_label}
                  onChange={(event) => handleCatalogFormChange("unit_label", event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  placeholder="Un, kg, L, kit..."
                />
              </label>

              <label className="space-y-1 md:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Tamanho / variação</span>
                <input
                  value={catalogForm.size_details}
                  onChange={(event) => handleCatalogFormChange("size_details", event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  placeholder="Ex.: 10kg, 1L, 1,5 polegada..."
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Largura (cm)</span>
                <input
                  value={catalogForm.width_cm}
                  onChange={(event) => handleCatalogFormChange("width_cm", event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  placeholder="Opcional"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Altura (cm)</span>
                <input
                  value={catalogForm.height_cm}
                  onChange={(event) => handleCatalogFormChange("height_cm", event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  placeholder="Opcional"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Comprimento (cm)</span>
                <input
                  value={catalogForm.length_cm}
                  onChange={(event) => handleCatalogFormChange("length_cm", event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  placeholder="Opcional"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Peso (kg)</span>
                <input
                  value={catalogForm.weight_kg}
                  onChange={(event) => handleCatalogFormChange("weight_kg", event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  placeholder="Opcional"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Preço</span>
                <input
                  value={catalogForm.price}
                  onChange={(event) => handleCatalogFormChange("price", event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  placeholder="59.90"
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

              <label className="space-y-1 md:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Aplicação / uso recomendado</span>
                <textarea
                  value={catalogForm.application}
                  onChange={(event) => handleCatalogFormChange("application", event.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  placeholder="Ex.: tratamento semanal, aspiração, conexão hidráulica..."
                />
              </label>

              <label className="space-y-1 md:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Observações técnicas</span>
                <textarea
                  value={catalogForm.technical_notes}
                  onChange={(event) => handleCatalogFormChange("technical_notes", event.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  placeholder="Ex.: compatibilidade, concentração, conexão, restrições..."
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
            description="Visão mais forte do catálogo, com cadastro manual completo e leitura rápida da base já cadastrada."
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {catalogOverviewMetrics.map((item) => (
                <StatusCard
                  key={item.label}
                  label={item.label}
                  value={item.value}
                  tone={item.tone}
                  hint={item.hint}
                />
              ))}
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <div>
                <div className="mb-2 text-sm font-semibold text-gray-900">Base operacional do catálogo</div>
                <SummaryList items={catalogOperationalItems} />
              </div>
              <div>
                <div className="mb-2 text-sm font-semibold text-gray-900">Contagem rápida</div>
                <SummaryList
                  items={[
                    `Produtos químicos cadastrados: ${counts.quimicos}.`,
                    `Acessórios cadastrados: ${counts.acessorios}.`,
                    `Outros itens cadastrados: ${counts.outros}.`,
                    "Cadastro manual e importação inteligente podem coexistir sem conflito.",
                  ]}
                />
              </div>
            </div>
          </SectionBlock>

          <SectionBlock
            title="Arquivos brutos importados"
            description="Esses são os arquivos originais usados no upload inteligente que geraram produtos, químicos, acessórios ou outros itens no sistema. Este bloco deve ficar sempre no final da aba."
          >
            {catalogImportFiles.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-4 text-sm text-gray-600">
                Nenhum arquivo bruto importado foi encontrado para produtos e acessórios ainda.
              </div>
            ) : (
              <div className="space-y-3">
                {catalogImportFiles.map((file) => (
                  <div
                    key={file.id}
                    className="rounded-2xl border border-gray-200 bg-gray-50 p-4"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="break-words text-sm font-semibold text-gray-900">
                          {cleanText(file.original_file_name) || "Arquivo sem nome"}
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                          Importado em {formatImportDate(file.created_at)}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleDownloadImportFile(file)}
                        disabled={downloadingImportFileId === file.id}
                        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {downloadingImportFileId === file.id ? "Gerando link..." : "Baixar arquivo bruto"}
                      </button>
                    </div>

                    <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                        Tipo: {cleanText(file.extension)?.toUpperCase() || cleanText(file.mime_type) || "Não definido"}
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                        Tamanho: {formatFileSize(file.size_bytes)}
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                        Status: {cleanText(file.status) || "Não definido"}
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                        Resumo: {getImportSummaryText(file.import_summary || null)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionBlock>
        </div>
      ) : null}

      {activeTab === "operacao" ? (
        <SectionBlock
          title="5. Operação"
          description="Regras reais da operação da loja, capacidade da agenda e limites que a IA deve respeitar."
          actions={
            isOperationEditing ? (
              <>
                <button
                  type="button"
                  onClick={handleOperationEditSave}
                  className="rounded-xl border border-black bg-black px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90"
                >
                  Salvar
                </button>
                <button
                  type="button"
                  onClick={handleOperationEditCancel}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
                >
                  Cancelar
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setIsOperationEditing(true)}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
              >
                Editar
              </button>
            )
          }
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {operationReadinessMetrics.map((item) => (
              <StatusCard
                key={item.label}
                label={item.label}
                value={item.value}
                tone={item.tone}
                hint={item.hint}
              />
            ))}
          </div>

          {isOperationEditing ? (
            <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <div className="mb-3 text-sm font-semibold text-gray-900">Editar operação na mesma página</div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Regra complementar da instalação</span>
                  <input value={operationDraft.installation_days_rule} onChange={(e)=>handleOperationDraftChange("installation_days_rule", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Regra complementar da visita técnica</span>
                  <input value={operationDraft.technical_visit_days_rule} onChange={(e)=>handleOperationDraftChange("technical_visit_days_rule", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Atende sábado</span>
                  <select value={operationDraft.serves_saturday} onChange={(e)=>handleOperationDraftChange("serves_saturday", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"><option>Não definido</option><option>Sim</option><option>Não</option></select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Atende domingo</span>
                  <select value={operationDraft.serves_sunday} onChange={(e)=>handleOperationDraftChange("serves_sunday", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"><option>Não definido</option><option>Sim</option><option>Não</option></select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Atende feriado</span>
                  <select value={operationDraft.serves_holiday} onChange={(e)=>handleOperationDraftChange("serves_holiday", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"><option>Não definido</option><option>Sim</option><option>Não</option></select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Faz instalação</span>
                  <select value={operationDraft.offers_installation} onChange={(e)=>handleOperationDraftChange("offers_installation", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"><option>Não definido</option><option>Sim</option><option>Não</option></select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Prazo médio de instalação</span>
                  <input value={operationDraft.average_installation_time_days} onChange={(e)=>handleOperationDraftChange("average_installation_time_days", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Etapas principais da instalação</span>
                  <textarea value={operationDraft.installation_process_summary} onChange={(e)=>handleOperationDraftChange("installation_process_summary", e.target.value)} rows={3} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Faz visita técnica</span>
                  <select value={operationDraft.offers_technical_visit} onChange={(e)=>handleOperationDraftChange("offers_technical_visit", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"><option>Não definido</option><option>Sim</option><option>Não</option></select>
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Regras da visita técnica</span>
                  <textarea value={operationDraft.technical_visit_rules_summary} onChange={(e)=>handleOperationDraftChange("technical_visit_rules_summary", e.target.value)} rows={3} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Regiões atendidas</span>
                  <input value={operationDraft.service_regions} onChange={(e)=>handleOperationDraftChange("service_regions", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Limitações importantes</span>
                  <textarea value={operationDraft.important_limitations} onChange={(e)=>handleOperationDraftChange("important_limitations", e.target.value)} rows={3} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Regra de capacidade da agenda</span>
                  <input value={operationDraft.agenda_capacity_rule} onChange={(e)=>handleOperationDraftChange("agenda_capacity_rule", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Resumo operacional para a IA</span>
                  <textarea value={operationDraft.operational_ai_summary} onChange={(e)=>handleOperationDraftChange("operational_ai_summary", e.target.value)} rows={3} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                </label>
              </div>
            </div>
          ) : null}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {operationSections.map((section) => (
              <div key={section.title}>
                <div className="mb-2 text-sm font-semibold text-gray-900">{section.title}</div>
                <SummaryList items={section.items} />
              </div>
            ))}
          </div>
        </SectionBlock>
      ) : null}

      {activeTab === "comercial-ia" ? (
        <SectionBlock
          title="6. Comercial e IA"
          description="Fonte viva das regras comerciais da IA, sem texto cru, sem códigos internos aparentes e sem rolagem lateral."
          actions={
            isCommercialEditing ? (
              <>
                <button
                  type="button"
                  onClick={handleCommercialEditSave}
                  className="rounded-xl border border-black bg-black px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90"
                >
                  Salvar
                </button>
                <button
                  type="button"
                  onClick={handleCommercialEditCancel}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
                >
                  Cancelar
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setIsCommercialEditing(true)}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
              >
                Editar
              </button>
            )
          }
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {commercialOverviewMetrics.map((item) => (
              <StatusCard
                key={item.label}
                label={item.label}
                value={item.value}
                tone={item.tone}
                hint={item.hint}
              />
            ))}
          </div>

          {isCommercialEditing ? (
            <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <div className="mb-3 text-sm font-semibold text-gray-900">Editar Comercial e IA na mesma página</div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Nome da IA no atendimento</span>
                  <input value={commercialDraft.ai_display_name} onChange={(e)=>handleCommercialDraftChange("ai_display_name", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Como a IA se apresenta</span>
                  <input value={commercialDraft.ai_presentation_mode} onChange={(e)=>handleCommercialDraftChange("ai_presentation_mode", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Tom comercial da IA</span>
                  <textarea value={commercialDraft.ai_tone_summary} onChange={(e)=>handleCommercialDraftChange("ai_tone_summary", e.target.value)} rows={2} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Fala como</span>
                  <input value={commercialDraft.ai_speaks_as} onChange={(e)=>handleCommercialDraftChange("ai_speaks_as", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Pode falar preço</span>
                  <select value={commercialDraft.can_send_price_directly} onChange={(e)=>handleCommercialDraftChange("can_send_price_directly", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"><option>Não definido</option><option>Sim</option><option>Não</option></select>
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">O que precisa entender antes de falar preço</span>
                  <textarea value={commercialDraft.price_before_summary} onChange={(e)=>handleCommercialDraftChange("price_before_summary", e.target.value)} rows={2} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Regra principal de preço</span>
                  <textarea value={commercialDraft.price_policy_summary} onChange={(e)=>handleCommercialDraftChange("price_policy_summary", e.target.value)} rows={3} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quando deve chamar humano</span>
                  <textarea value={commercialDraft.human_help_summary} onChange={(e)=>handleCommercialDraftChange("human_help_summary", e.target.value)} rows={3} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Formas de pagamento</span>
                  <textarea value={commercialDraft.payment_methods_summary} onChange={(e)=>handleCommercialDraftChange("payment_methods_summary", e.target.value)} rows={2} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Política de desconto</span>
                  <input value={commercialDraft.discount_policy_summary} onChange={(e)=>handleCommercialDraftChange("discount_policy_summary", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Regras de negociação</span>
                  <textarea value={commercialDraft.negotiation_rules_summary} onChange={(e)=>handleCommercialDraftChange("negotiation_rules_summary", e.target.value)} rows={3} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Limites de promessa da IA</span>
                  <textarea value={commercialDraft.promise_limits_summary} onChange={(e)=>handleCommercialDraftChange("promise_limits_summary", e.target.value)} rows={3} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Pós-venda</span>
                  <textarea value={commercialDraft.post_sale_summary} onChange={(e)=>handleCommercialDraftChange("post_sale_summary", e.target.value)} rows={2} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Comportamento fora do horário</span>
                  <textarea value={commercialDraft.after_hours_summary} onChange={(e)=>handleCommercialDraftChange("after_hours_summary", e.target.value)} rows={2} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Resumo comercial para a IA</span>
                  <textarea value={commercialDraft.commercial_ai_summary} onChange={(e)=>handleCommercialDraftChange("commercial_ai_summary", e.target.value)} rows={3} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                </label>
              </div>
            </div>
          ) : null}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-2 text-sm font-semibold text-gray-900">Identidade comercial da IA</div>
              <SummaryList items={commercialIdentityItems} />
            </div>
            <div>
              <div className="mb-2 text-sm font-semibold text-gray-900">Regra de preço</div>
              <SummaryList items={commercialPriceItems} />
            </div>
            <div>
              <div className="mb-2 text-sm font-semibold text-gray-900">Quando chamar humano</div>
              <SummaryList items={commercialHumanHelpItems} />
            </div>
            <div>
              <div className="mb-2 text-sm font-semibold text-gray-900">Pagamento e desconto</div>
              <SummaryList items={commercialPaymentItems} />
            </div>
            <div className="lg:col-span-2">
              <div className="mb-2 text-sm font-semibold text-gray-900">Regras de negociação, promessas e pós-venda</div>
              <SummaryList items={commercialNegotiationItems} />
            </div>
          </div>
        </SectionBlock>
      ) : null}

      {activeTab === "responsavel-ativacao" ? (
        <SectionBlock
          title="7. Responsável e ativação"
          description="Gerencie o responsável principal, cadastre outros responsáveis da loja e revise a base mínima de ativação."
          actions={
            isActivationEditing ? (
              <>
                <button
                  type="button"
                  onClick={handleActivationEditSave}
                  className="rounded-xl border border-black bg-black px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90"
                >
                  Salvar
                </button>
                <button
                  type="button"
                  onClick={handleActivationEditCancel}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
                >
                  Cancelar
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setIsActivationEditing(true)}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={handleAddResponsible}
                  className="rounded-xl border border-black bg-black px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90"
                >
                  Adicionar responsável
                </button>
              </>
            )
          }
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatusCard
              label="Responsável principal"
              value={cleanText(primaryResponsibleDraft.name) || "Não cadastrado"}
              tone={cleanText(primaryResponsibleDraft.name) ? "green" : "amber"}
              hint={cleanText(primaryResponsibleDraft.whatsapp) || "Cadastre o contato principal da loja"}
            />
            <StatusCard
              label="Outros responsáveis"
              value={String(additionalResponsiblesDraft.filter((item) => cleanText(item.name) || cleanText(item.whatsapp)).length)}
              tone={additionalResponsiblesDraft.length > 0 ? "green" : "gray"}
              hint="Contatos extras para aviso, operação e exceções"
            />
            <StatusCard
              label="Recebe alertas da IA"
              value={yesNoLabel(answers.ai_should_notify_responsible)}
              tone={yesNoLabel(answers.ai_should_notify_responsible) === "Sim" ? "green" : "amber"}
              hint="Lead quente, visita, instalação, pagamento e urgências"
            />
            <StatusCard
              label="Status da ativação"
              value={resolveOnboardingLabel(onboarding?.status).label}
              tone={resolveOnboardingLabel(onboarding?.status).tone}
              hint="Base mínima da loja para ativação operacional"
            />
          </div>

          {isActivationEditing ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <div className="mb-3 text-sm font-semibold text-gray-900">Responsável principal</div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Nome</span>
                    <input
                      value={primaryResponsibleDraft.name}
                      onChange={(e) => handlePrimaryResponsibleChange("name", e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">WhatsApp</span>
                    <input
                      value={primaryResponsibleDraft.whatsapp}
                      onChange={(e) => handlePrimaryResponsibleChange("whatsapp", e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Cargo / função</span>
                    <input
                      value={primaryResponsibleDraft.role}
                      onChange={(e) => handlePrimaryResponsibleChange("role", e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                    />
                  </label>
                  <label className="space-y-1 md:col-span-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Observações</span>
                    <textarea
                      value={primaryResponsibleDraft.notes}
                      onChange={(e) => handlePrimaryResponsibleChange("notes", e.target.value)}
                      rows={3}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                    />
                  </label>
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={primaryResponsibleDraft.receives_ai_alerts}
                      onChange={(e) => handlePrimaryResponsibleChange("receives_ai_alerts", e.target.checked)}
                    />
                    Recebe alertas da IA
                  </label>
                  <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={primaryResponsibleDraft.can_approve_discount}
                      onChange={(e) => handlePrimaryResponsibleChange("can_approve_discount", e.target.checked)}
                    />
                    Pode aprovar desconto
                  </label>
                  <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={primaryResponsibleDraft.can_approve_exceptions}
                      onChange={(e) => handlePrimaryResponsibleChange("can_approve_exceptions", e.target.checked)}
                    />
                    Pode aprovar exceções
                  </label>
                  <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={primaryResponsibleDraft.can_assume_human}
                      onChange={(e) => handlePrimaryResponsibleChange("can_assume_human", e.target.checked)}
                    />
                    Pode assumir conversa humana
                  </label>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <div className="mb-3 text-sm font-semibold text-gray-900">Ativação da IA e avisos</div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A IA deve avisar o responsável?</span>
                    <select
                      value={primaryResponsibleDraft.receives_ai_alerts ? "Sim" : "Não"}
                      onChange={(e) => handlePrimaryResponsibleChange("receives_ai_alerts", e.target.value === "Sim")}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                    >
                      <option>Sim</option>
                      <option>Não</option>
                    </select>
                  </label>

                  <label className="space-y-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Dados mínimos estão corretos?</span>
                    <select
                      value={activationConfirmInformationDraft ? "Sim" : "Não"}
                      onChange={(e) => setActivationConfirmInformationDraft(e.target.value === "Sim")}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                    >
                      <option>Sim</option>
                      <option>Não</option>
                    </select>
                  </label>

                  <label className="space-y-1 md:col-span-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Em quais casos a IA deve avisar</span>
                    <textarea
                      value={activationNotificationCasesDraft}
                      onChange={(e) => setActivationNotificationCasesDraft(e.target.value)}
                      rows={3}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                      placeholder="Ex.: pedido de desconto, cliente quase fechando, dúvida técnica, visita, instalação, pagamento..."
                    />
                  </label>

                  <label className="space-y-1 md:col-span-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Orientações finais para ativação da IA</span>
                    <textarea
                      value={activationPreferencesDraft}
                      onChange={(e) => setActivationPreferencesDraft(e.target.value)}
                      rows={4}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                      placeholder="Ex.: mais humanizada, priorizar qualificação antes de preço, nunca prometer fora do escopo, chamar humano em casos críticos..."
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-gray-900">Outros responsáveis</div>
                  <button
                    type="button"
                    onClick={handleAddResponsible}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
                  >
                    Adicionar responsável
                  </button>
                </div>

                {additionalResponsiblesDraft.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-4 text-sm text-gray-600">
                    Nenhum outro responsável cadastrado ainda. Você pode adicionar manualmente por aqui.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {additionalResponsiblesDraft.map((person, index) => (
                      <div key={person.id} className="rounded-2xl border border-gray-200 bg-white p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-gray-900">
                            Responsável extra {index + 1}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveResponsible(person.id)}
                            className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100"
                          >
                            Remover
                          </button>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="space-y-1">
                            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Nome</span>
                            <input
                              value={person.name}
                              onChange={(e) => handleAdditionalResponsibleChange(person.id, "name", e.target.value)}
                              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">WhatsApp</span>
                            <input
                              value={person.whatsapp}
                              onChange={(e) => handleAdditionalResponsibleChange(person.id, "whatsapp", e.target.value)}
                              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Cargo / função</span>
                            <input
                              value={person.role}
                              onChange={(e) => handleAdditionalResponsibleChange(person.id, "role", e.target.value)}
                              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                            />
                          </label>
                          <label className="space-y-1 md:col-span-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Observações</span>
                            <textarea
                              value={person.notes}
                              onChange={(e) => handleAdditionalResponsibleChange(person.id, "notes", e.target.value)}
                              rows={2}
                              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                            />
                          </label>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-3">
                          <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                            <input
                              type="checkbox"
                              checked={person.receives_ai_alerts}
                              onChange={(e) => handleAdditionalResponsibleChange(person.id, "receives_ai_alerts", e.target.checked)}
                            />
                            Recebe alertas da IA
                          </label>
                          <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                            <input
                              type="checkbox"
                              checked={person.can_approve_discount}
                              onChange={(e) => handleAdditionalResponsibleChange(person.id, "can_approve_discount", e.target.checked)}
                            />
                            Pode aprovar desconto
                          </label>
                          <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                            <input
                              type="checkbox"
                              checked={person.can_approve_exceptions}
                              onChange={(e) => handleAdditionalResponsibleChange(person.id, "can_approve_exceptions", e.target.checked)}
                            />
                            Pode aprovar exceções
                          </label>
                          <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                            <input
                              type="checkbox"
                              checked={person.can_assume_human}
                              onChange={(e) => handleAdditionalResponsibleChange(person.id, "can_assume_human", e.target.checked)}
                            />
                            Pode assumir conversa humana
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <div className="mb-2 text-sm font-semibold text-gray-900">Responsável principal</div>
                  <SummaryList
                    items={buildBulletRows([
                      { label: "Nome", value: cleanText(primaryResponsibleDraft.name) || "Não cadastrado" },
                      { label: "WhatsApp", value: cleanText(primaryResponsibleDraft.whatsapp) || "Não cadastrado" },
                      { label: "Cargo / função", value: cleanText(primaryResponsibleDraft.role) || "Não definido" },
                      { label: "Recebe alertas da IA", value: primaryResponsibleDraft.receives_ai_alerts ? "Sim" : "Não" },
                      { label: "Pode aprovar desconto", value: primaryResponsibleDraft.can_approve_discount ? "Sim" : "Não" },
                      { label: "Pode aprovar exceções", value: primaryResponsibleDraft.can_approve_exceptions ? "Sim" : "Não" },
                      { label: "Pode assumir conversa humana", value: primaryResponsibleDraft.can_assume_human ? "Sim" : "Não" },
                      { label: "Observações", value: cleanText(primaryResponsibleDraft.notes) },
                    ])}
                  />
                </div>

                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <div className="mb-2 text-sm font-semibold text-gray-900">Status de ativação</div>
                  <SummaryList
                    items={buildBulletRows([
                      { label: "A IA avisa o responsável", value: yesNoLabel(answers.ai_should_notify_responsible) },
                      { label: "Dados mínimos para ativação", value: yesNoLabel(answers.confirm_information_is_correct) },
                      { label: "Checklist de ativação real", value: joinSelectedLabels(parseArrayAnswer(answers.responsible_notification_cases), RESPONSIBLE_NOTIFICATION_CASE_OPTIONS, cleanText(answers.responsible_notification_cases_other)) || cleanText(answers.responsible_notification_cases_other) },
                      { label: "Orientações finais da IA", value: joinSelectedLabels(parseArrayAnswer(answers.activation_preferences), [...ACTIVATION_STYLE_OPTIONS, ...ACTIVATION_GUARDRAIL_OPTIONS], cleanText(answers.activation_preferences_other)) || cleanText(answers.final_activation_notes) },
                      { label: "Status da ativação da loja", value: resolveOnboardingLabel(onboarding?.status).label },
                    ])}
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <div className="mb-2 text-sm font-semibold text-gray-900">Outros responsáveis</div>
                {additionalResponsiblesDraft.filter((item) => cleanText(item.name) || cleanText(item.whatsapp)).length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-4 text-sm text-gray-600">
                    Nenhum outro responsável cadastrado ainda. Use o botão "Adicionar responsável" para cadastrar manualmente.
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {additionalResponsiblesDraft
                      .filter((item) => cleanText(item.name) || cleanText(item.whatsapp))
                      .map((person) => (
                        <div key={person.id} className="rounded-2xl border border-gray-200 bg-white p-4">
                          <div className="mb-2 text-sm font-semibold text-gray-900">{cleanText(person.name) || "Responsável extra"}</div>
                          <SummaryList
                            items={buildBulletRows([
                              { label: "WhatsApp", value: cleanText(person.whatsapp) },
                              { label: "Cargo / função", value: cleanText(person.role) },
                              { label: "Recebe alertas da IA", value: person.receives_ai_alerts ? "Sim" : "Não" },
                              { label: "Pode aprovar desconto", value: person.can_approve_discount ? "Sim" : "Não" },
                              { label: "Pode aprovar exceções", value: person.can_approve_exceptions ? "Sim" : "Não" },
                              { label: "Pode assumir conversa humana", value: person.can_assume_human ? "Sim" : "Não" },
                              { label: "Observações", value: cleanText(person.notes) },
                            ])}
                          />
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </SectionBlock>
      ) : null}

      {activeTab === "descontos" ? (
        <SectionBlock
          title="8. Descontos"
          description="Defina se a IA pode conceder desconto, qual o limite máximo e quando a aprovação humana é obrigatória."
          actions={
            isDiscountEditing ? (
              <>
                <button
                  type="button"
                  onClick={handleDiscountEditSave}
                  className="rounded-xl border border-black bg-black px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90"
                >
                  Salvar
                </button>
                <button
                  type="button"
                  onClick={handleDiscountEditCancel}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
                >
                  Cancelar
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setIsDiscountEditing(true)}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
              >
                Editar
              </button>
            )
          }
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatusCard
              label="Desconto liberado"
              value={yesNoLabel(answers.can_offer_discount)}
              tone={yesNoLabel(answers.can_offer_discount) === "Sim" ? "green" : yesNoLabel(answers.can_offer_discount) === "Não" ? "amber" : "gray"}
              hint="Define se a IA pode negociar desconto sem chamar humano em todos os casos."
            />
            <StatusCard
              label="Limite máximo"
              value={cleanText(answers.max_discount_percent) ? `${cleanText(answers.max_discount_percent)}%` : "Não definido"}
              tone={cleanText(answers.max_discount_percent) ? "green" : "gray"}
              hint="Teto máximo permitido para a IA trabalhar sem sair da regra."
            />
            <StatusCard
              label="Aprovação humana"
              value={cleanText(answers.discount_approver_name) || cleanText(answers.responsible_name) || "Responsável principal"}
              tone="gray"
              hint="Quem precisa entrar quando o pedido sai da regra."
            />
            <StatusCard
              label="Fluxo de segurança"
              value={joinSelectedLabels(parseArrayAnswer(answers.human_help_discount_cases_selected), HUMAN_HELP_DISCOUNT_OPTIONS) || cleanText(answers.human_help_discount_cases_other) ? "Definido" : "Pendente"}
              tone={joinSelectedLabels(parseArrayAnswer(answers.human_help_discount_cases_selected), HUMAN_HELP_DISCOUNT_OPTIONS) || cleanText(answers.human_help_discount_cases_other) ? "green" : "amber"}
              hint="Casos em que a IA não deve aprovar sozinha."
            />
          </div>

          {isDiscountEditing ? (
            <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <div className="mb-3 text-sm font-semibold text-gray-900">Editar descontos na mesma página</div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A IA pode trabalhar com desconto?</span>
                  <select
                    value={discountDraft.can_offer_discount}
                    onChange={(e) => handleDiscountDraftChange("can_offer_discount", e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  >
                    <option>Não definido</option>
                    <option>Sim</option>
                    <option>Não</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Limite máximo de desconto</span>
                  <input
                    value={discountDraft.max_discount_percent}
                    onChange={(e) => handleDiscountDraftChange("max_discount_percent", e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                    placeholder="Ex.: 10 ou 15"
                  />
                </label>

                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quando precisa aprovação humana</span>
                  <textarea
                    value={discountDraft.human_help_discount_summary}
                    onChange={(e) => handleDiscountDraftChange("human_help_discount_summary", e.target.value)}
                    rows={3}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                    placeholder="Ex.: pedido de desconto maior que o permitido, condição especial, cliente muito quente..."
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Quem aprova desconto</span>
                  <input
                    value={discountDraft.discount_approver}
                    onChange={(e) => handleDiscountDraftChange("discount_approver", e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                    placeholder="Nome do responsável"
                  />
                </label>

                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Regras especiais</span>
                  <textarea
                    value={discountDraft.special_discount_rules}
                    onChange={(e) => handleDiscountDraftChange("special_discount_rules", e.target.value)}
                    rows={3}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                    placeholder="Ex.: em piscina completa pode negociar dentro da faixa, químico tem margem menor..."
                  />
                </label>

                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Como essa parte funciona</span>
                  <textarea
                    value={discountDraft.discount_explanation}
                    onChange={(e) => handleDiscountDraftChange("discount_explanation", e.target.value)}
                    rows={4}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                    placeholder="Explique a lógica que a IA deve seguir para trabalhar com desconto."
                  />
                </label>
              </div>
            </div>
          ) : null}

          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.1fr]">
            <div>
              <div className="mb-2 text-sm font-semibold text-gray-900">Regras atuais de desconto</div>
              <SummaryList items={discountItems} />
            </div>
            <div>
              <div className="mb-2 text-sm font-semibold text-gray-900">Como essa parte funciona</div>
              <SummaryList
                items={[
                  "A IA só deve oferecer desconto quando a loja permitir isso nesta aba.",
                  "O limite máximo define até onde a IA pode ir sem sair da regra.",
                  "Quando o pedido ultrapassa o limite ou exige condição especial, a IA deve chamar aprovação humana antes de confirmar qualquer valor.",
                  "Essa aba serve para proteger margem, padronizar negociação e evitar promessa comercial errada.",
                ]}
              />
            </div>
          </div>
        </SectionBlock>
      ) : null}

      
      {activeTab === "canais-integracoes" ? (
        <SectionBlock
          title="9. Canais e integrações"
          description="Deixe esta parte rápida de preencher: primeiro só o essencial, depois os detalhes avançados."
          actions={
            isChannelsEditing ? (
              <>
                <button
                  type="button"
                  onClick={handleChannelsEditSave}
                  className="rounded-xl border border-black bg-black px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90"
                >
                  Salvar
                </button>
                <button
                  type="button"
                  onClick={handleChannelsEditCancel}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
                >
                  Cancelar
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setIsChannelsEditing(true)}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
              >
                Editar
              </button>
            )
          }
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {channelGuidedStatusMetrics.map((item) => (
              <StatusCard
                key={item.label}
                label={item.label}
                value={item.value}
                tone={item.tone}
                hint={item.hint}
              />
            ))}
          </div>


          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <div className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="mb-2 text-sm font-semibold text-gray-900">Como preencher rápido</div>
              <SummaryList
                items={[
                  "Primeiro defina o WhatsApp comercial e o WhatsApp do responsável.",
                  "Depois marque se cada canal está ativo e se recebe o tipo certo de mensagem.",
                  "Por último descreva em uma frase para onde vão clientes, avisos, urgências e relatórios.",
                ]}
              />
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="mb-2 text-sm font-semibold text-gray-900">O que é obrigatório para ativar bem</div>
              <SummaryList
                items={[
                  "Um canal real para clientes.",
                  "Um canal real para o responsável.",
                  "Uma integração principal definida.",
                  "Uma regra simples de roteamento para cliente e assistente.",
                ]}
              />
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="mb-2 text-sm font-semibold text-gray-900">O que pode ficar para depois</div>
              <SummaryList
                items={[
                  "Webhook de status e detalhes técnicos finos.",
                  "Fallback detalhado entre canais.",
                  "Notas extras, Telegram futuro e observações avançadas.",
                ]}
              />
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="mb-2 text-sm font-semibold text-amber-900">Pendências essenciais</div>
              <SummaryList
                items={
                  channelEssentialPendencies.length > 0
                    ? channelEssentialPendencies
                    : ["Nada essencial pendente nesta aba."]
                }
              />
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <div className="mb-2 text-sm font-semibold text-gray-900">Pendências recomendadas</div>
              <SummaryList
                items={
                  channelRecommendedPendencies.length > 0
                    ? channelRecommendedPendencies
                    : ["Nada recomendado pendente nesta aba."]
                }
              />
            </div>
          </div>

          {isChannelsEditing ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <div className="mb-1 text-sm font-semibold text-gray-900">Preenchimento rápido</div>
                <div className="mb-4 text-xs text-gray-600">
                  Primeiro preencha só o que é mais importante. Os detalhes mais técnicos ficam escondidos em opções avançadas.
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="rounded-2xl border border-gray-200 bg-white p-4">
                    <div className="mb-3 text-sm font-semibold text-gray-900">1. Canal dos clientes</div>
                    <div className="grid gap-3">
                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Qual é o WhatsApp que fala com clientes?</span>
                        <input
                          value={channelDraft.commercial_whatsapp}
                          onChange={(e) => handleChannelDraftChange("commercial_whatsapp", e.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: (11) 99999-9999"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Nome desse canal</span>
                        <input
                          value={channelDraft.commercial_channel_name}
                          onChange={(e) => handleChannelDraftChange("commercial_channel_name", e.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: WhatsApp comercial principal"
                        />
                      </label>

                      <div className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Esse canal já está ativo?</span>
                        <ChoiceButtonGroup
                          value={channelDraft.commercial_channel_active}
                          onChange={(value) => handleChannelDraftChange("commercial_channel_active", value)}
                          options={[
                            { value: "Sim", label: "Sim" },
                            { value: "Não", label: "Não" },
                            { value: "Não definido", label: "Ainda não" },
                          ]}
                        />
                      </div>

                      <div className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">A IA usa esse canal como oficial de vendas?</span>
                        <ChoiceButtonGroup
                          value={channelDraft.commercial_is_official_sales_channel}
                          onChange={(value) => handleChannelDraftChange("commercial_is_official_sales_channel", value)}
                          options={[
                            { value: "Sim", label: "Sim" },
                            { value: "Não", label: "Não" },
                          ]}
                        />
                      </div>

                      <div className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Se precisar, pode passar para humano?</span>
                        <ChoiceButtonGroup
                          value={channelDraft.commercial_human_handoff_enabled}
                          onChange={(value) => handleChannelDraftChange("commercial_human_handoff_enabled", value)}
                          options={[
                            { value: "Sim", label: "Sim" },
                            { value: "Não", label: "Não" },
                          ]}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-gray-200 bg-white p-4">
                    <div className="mb-3 text-sm font-semibold text-gray-900">2. Canal do responsável</div>
                    <div className="grid gap-3">
                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Qual é o WhatsApp do responsável?</span>
                        <input
                          value={channelDraft.responsible_whatsapp}
                          onChange={(e) => handleChannelDraftChange("responsible_whatsapp", e.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: (11) 98888-8888"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Nome desse canal</span>
                        <input
                          value={channelDraft.responsible_channel_name}
                          onChange={(e) => handleChannelDraftChange("responsible_channel_name", e.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: WhatsApp do responsável"
                        />
                      </label>

                      <div className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Esse canal recebe alertas da IA?</span>
                        <ChoiceButtonGroup
                          value={channelDraft.responsible_receives_ai_alerts}
                          onChange={(value) => handleChannelDraftChange("responsible_receives_ai_alerts", value)}
                          options={[
                            { value: "Sim", label: "Sim" },
                            { value: "Não", label: "Não" },
                          ]}
                        />
                      </div>

                      <div className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Esse canal recebe urgências?</span>
                        <ChoiceButtonGroup
                          value={channelDraft.responsible_receives_urgencies}
                          onChange={(value) => handleChannelDraftChange("responsible_receives_urgencies", value)}
                          options={[
                            { value: "Sim", label: "Sim" },
                            { value: "Não", label: "Não" },
                          ]}
                        />
                      </div>

                      <div className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Esse canal recebe relatórios?</span>
                        <ChoiceButtonGroup
                          value={channelDraft.responsible_receives_reports}
                          onChange={(value) => handleChannelDraftChange("responsible_receives_reports", value)}
                          options={[
                            { value: "Sim", label: "Sim" },
                            { value: "Não", label: "Não" },
                          ]}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-gray-200 bg-white p-4">
                    <div className="mb-3 text-sm font-semibold text-gray-900">3. Chat interno do sistema</div>
                    <div className="grid gap-3">
                      <div className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Vai usar chat interno?</span>
                        <ChoiceButtonGroup
                          value={channelDraft.internal_chat_enabled}
                          onChange={(value) => handleChannelDraftChange("internal_chat_enabled", value)}
                          options={[
                            { value: "Sim", label: "Sim" },
                            { value: "Não", label: "Não" },
                          ]}
                        />
                      </div>

                      <div className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Ele fica separado da Inbox?</span>
                        <ChoiceButtonGroup
                          value={channelDraft.internal_chat_separate_from_inbox}
                          onChange={(value) => handleChannelDraftChange("internal_chat_separate_from_inbox", value)}
                          options={[
                            { value: "Sim", label: "Sim" },
                            { value: "Não", label: "Não" },
                          ]}
                        />
                      </div>

                      <div className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Esse chat aceita comandos manuais?</span>
                        <ChoiceButtonGroup
                          value={channelDraft.internal_chat_accepts_manual_commands}
                          onChange={(value) => handleChannelDraftChange("internal_chat_accepts_manual_commands", value)}
                          options={[
                            { value: "Sim", label: "Sim" },
                            { value: "Não", label: "Não" },
                          ]}
                        />
                      </div>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Prioridade do chat interno</span>
                        <input
                          value={channelDraft.internal_chat_priority}
                          onChange={(e) => handleChannelDraftChange("internal_chat_priority", e.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: apoio secundário, principal para alertas..."
                        />
                      </label>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-gray-200 bg-white p-4">
                    <div className="mb-3 text-sm font-semibold text-gray-900">4. Integração externa</div>
                    <div className="grid gap-3">
                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Qual integração vocês usam?</span>
                        <input
                          value={channelDraft.integration_provider_name}
                          onChange={(e) => handleChannelDraftChange("integration_provider_name", e.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: WhatsApp Cloud API, Evolution, Z-API..."
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Como ela se conecta?</span>
                        <input
                          value={channelDraft.integration_connection_mode}
                          onChange={(e) => handleChannelDraftChange("integration_connection_mode", e.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: API, webhook, painel externo..."
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Status do teste</span>
                        <input
                          value={channelDraft.integration_test_status}
                          onChange={(e) => handleChannelDraftChange("integration_test_status", e.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: funcionando, parcial, pendente..."
                        />
                      </label>

                      <div className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Entrada de mensagens funciona?</span>
                        <ChoiceButtonGroup
                          value={channelDraft.integration_has_inbound_webhook}
                          onChange={(value) => handleChannelDraftChange("integration_has_inbound_webhook", value)}
                          options={[
                            { value: "Sim", label: "Sim" },
                            { value: "Não", label: "Não" },
                            { value: "Não definido", label: "Não sei" },
                          ]}
                        />
                      </div>

                      <div className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Envio de mensagens funciona?</span>
                        <ChoiceButtonGroup
                          value={channelDraft.integration_has_outbound_delivery}
                          onChange={(value) => handleChannelDraftChange("integration_has_outbound_delivery", value)}
                          options={[
                            { value: "Sim", label: "Sim" },
                            { value: "Não", label: "Não" },
                            { value: "Não definido", label: "Não sei" },
                          ]}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-gray-200 bg-white p-4 xl:col-span-2">
                    <div className="mb-3 text-sm font-semibold text-gray-900">5. Roteamento rápido</div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="space-y-1 md:col-span-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Para onde vão as mensagens dos clientes?</span>
                        <textarea
                          value={channelDraft.customer_messages_route}
                          onChange={(e) => handleChannelDraftChange("customer_messages_route", e.target.value)}
                          rows={2}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: entram no WhatsApp comercial e seguem para a IA vendedora."
                        />
                      </label>

                      <label className="space-y-1 md:col-span-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Para onde vão os avisos da assistente?</span>
                        <textarea
                          value={channelDraft.assistant_alerts_route}
                          onChange={(e) => handleChannelDraftChange("assistant_alerts_route", e.target.value)}
                          rows={2}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: vão para o WhatsApp do responsável e também ficam no painel."
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Para onde vão as urgências?</span>
                        <textarea
                          value={channelDraft.urgency_route}
                          onChange={(e) => handleChannelDraftChange("urgency_route", e.target.value)}
                          rows={2}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: direto para o responsável principal."
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Para onde vão os relatórios?</span>
                        <textarea
                          value={channelDraft.reports_route}
                          onChange={(e) => handleChannelDraftChange("reports_route", e.target.value)}
                          rows={2}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: WhatsApp do responsável e painel."
                        />
                      </label>
                    </div>
                  </div>
                </div>
              </div>


              <div className="rounded-2xl border border-gray-200 bg-white p-4">
                <div className="mb-3 text-sm font-semibold text-gray-900">Prévia da configuração em linguagem simples</div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Resumo do canal comercial</div>
                    <SummaryList
                      items={[
                        `Canal comercial: ${channelDraft.commercial_channel_name || "Não definido"}`,
                        `WhatsApp comercial: ${channelDraft.commercial_whatsapp || "Não definido"}`,
                        `Canal ativo: ${channelDraft.commercial_channel_active || "Não definido"}`,
                        `Canal oficial da IA: ${channelDraft.commercial_is_official_sales_channel || "Não definido"}`,
                      ]}
                    />
                  </div>
                  <div>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Resumo do canal do responsável</div>
                    <SummaryList
                      items={[
                        `Canal do responsável: ${channelDraft.responsible_channel_name || "Não definido"}`,
                        `WhatsApp do responsável: ${channelDraft.responsible_whatsapp || "Não definido"}`,
                        `Recebe alertas: ${channelDraft.responsible_receives_ai_alerts || "Não definido"}`,
                        `Recebe urgências: ${channelDraft.responsible_receives_urgencies || "Não definido"}`,
                      ]}
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">Opções avançadas</div>
                    <div className="text-xs text-gray-600">
                      Abra só se quiser detalhar webhook, fallback, observações e configurações mais técnicas.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowChannelsAdvanced((current) => !current)}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
                  >
                    {showChannelsAdvanced ? "Ocultar opções avançadas" : "Mostrar opções avançadas"}
                  </button>
                </div>

                {showChannelsAdvanced ? (
                  <div className="mt-4 grid gap-4 xl:grid-cols-2">
                    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                      <div className="mb-3 text-sm font-semibold text-gray-900">Canal comercial — detalhes</div>
                      <div className="grid gap-3">
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Recebe clientes reais</span>
                          <ChoiceButtonGroup
                            value={channelDraft.commercial_receives_real_clients}
                            onChange={(value) => handleChannelDraftChange("commercial_receives_real_clients", value)}
                            options={[
                              { value: "Sim", label: "Sim" },
                              { value: "Não", label: "Não" },
                              { value: "Não definido", label: "Não definido" },
                            ]}
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Tipo de canal</span>
                          <input value={channelDraft.commercial_channel_type} onChange={(e)=>handleChannelDraftChange("commercial_channel_type", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Prioridade de entrada</span>
                          <input value={channelDraft.commercial_entry_priority} onChange={(e)=>handleChannelDraftChange("commercial_entry_priority", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Observações</span>
                          <textarea value={channelDraft.commercial_channel_notes} onChange={(e)=>handleChannelDraftChange("commercial_channel_notes", e.target.value)} rows={2} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                        </label>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                      <div className="mb-3 text-sm font-semibold text-gray-900">Canal do responsável — detalhes</div>
                      <div className="grid gap-3">
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Canal ativo</span>
                          <ChoiceButtonGroup
                            value={channelDraft.responsible_channel_active}
                            onChange={(value) => handleChannelDraftChange("responsible_channel_active", value)}
                            options={[
                              { value: "Sim", label: "Sim" },
                              { value: "Não", label: "Não" },
                              { value: "Não definido", label: "Não definido" },
                            ]}
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Tipo de canal</span>
                          <input value={channelDraft.responsible_channel_type} onChange={(e)=>handleChannelDraftChange("responsible_channel_type", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">É o canal principal de alertas</span>
                          <ChoiceButtonGroup
                            value={channelDraft.responsible_is_primary_alert_channel}
                            onChange={(value) => handleChannelDraftChange("responsible_is_primary_alert_channel", value)}
                            options={[
                              { value: "Sim", label: "Sim" },
                              { value: "Não", label: "Não" },
                            ]}
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">É o canal para comandos humanos</span>
                          <ChoiceButtonGroup
                            value={channelDraft.responsible_is_human_command_channel}
                            onChange={(value) => handleChannelDraftChange("responsible_is_human_command_channel", value)}
                            options={[
                              { value: "Sim", label: "Sim" },
                              { value: "Não", label: "Não" },
                            ]}
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Recebe avisos de visita</span>
                          <ChoiceButtonGroup
                            value={channelDraft.responsible_receives_visit_alerts}
                            onChange={(value) => handleChannelDraftChange("responsible_receives_visit_alerts", value)}
                            options={[
                              { value: "Sim", label: "Sim" },
                              { value: "Não", label: "Não" },
                            ]}
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Recebe avisos de pagamento</span>
                          <ChoiceButtonGroup
                            value={channelDraft.responsible_receives_payment_alerts}
                            onChange={(value) => handleChannelDraftChange("responsible_receives_payment_alerts", value)}
                            options={[
                              { value: "Sim", label: "Sim" },
                              { value: "Não", label: "Não" },
                            ]}
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Observações</span>
                          <textarea value={channelDraft.responsible_channel_notes} onChange={(e)=>handleChannelDraftChange("responsible_channel_notes", e.target.value)} rows={2} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                        </label>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                      <div className="mb-3 text-sm font-semibold text-gray-900">Chat interno e canais extras</div>
                      <div className="grid gap-3">
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Pode ser usado pela IA assistente</span>
                          <ChoiceButtonGroup
                            value={channelDraft.internal_chat_for_assistant}
                            onChange={(value) => handleChannelDraftChange("internal_chat_for_assistant", value)}
                            options={[
                              { value: "Sim", label: "Sim" },
                              { value: "Não", label: "Não" },
                            ]}
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Visível para a equipe</span>
                          <ChoiceButtonGroup
                            value={channelDraft.internal_chat_visible_to_team}
                            onChange={(value) => handleChannelDraftChange("internal_chat_visible_to_team", value)}
                            options={[
                              { value: "Sim", label: "Sim" },
                              { value: "Não", label: "Não" },
                            ]}
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Canal comercial e responsável são separados</span>
                          <ChoiceButtonGroup
                            value={channelDraft.channels_are_separate}
                            onChange={(value) => handleChannelDraftChange("channels_are_separate", value)}
                            options={[
                              { value: "Sim", label: "Sim" },
                              { value: "Não", label: "Não" },
                              { value: "Não definido", label: "Não definido" },
                            ]}
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Número / chip dedicado</span>
                          <input value={channelDraft.dedicated_number} onChange={(e)=>handleChannelDraftChange("dedicated_number", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Telegram futuro</span>
                          <input value={channelDraft.telegram_future_status} onChange={(e)=>handleChannelDraftChange("telegram_future_status", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Observações do chat interno</span>
                          <textarea value={channelDraft.internal_chat_notes} onChange={(e)=>handleChannelDraftChange("internal_chat_notes", e.target.value)} rows={2} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Notas extras</span>
                          <textarea value={channelDraft.extra_channel_notes} onChange={(e)=>handleChannelDraftChange("extra_channel_notes", e.target.value)} rows={2} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                        </label>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                      <div className="mb-3 text-sm font-semibold text-gray-900">Integrações e roteamento — detalhes</div>
                      <div className="grid gap-3">
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Webhook de entrada</span>
                          <input value={channelDraft.webhook_inbound_status} onChange={(e)=>handleChannelDraftChange("webhook_inbound_status", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Envio externo</span>
                          <input value={channelDraft.external_send_status} onChange={(e)=>handleChannelDraftChange("external_send_status", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Integração de WhatsApp</span>
                          <input value={channelDraft.whatsapp_integration_status} onChange={(e)=>handleChannelDraftChange("whatsapp_integration_status", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Webhook de status / entrega</span>
                          <ChoiceButtonGroup
                            value={channelDraft.integration_has_status_webhook}
                            onChange={(value) => handleChannelDraftChange("integration_has_status_webhook", value)}
                            options={[
                              { value: "Sim", label: "Sim" },
                              { value: "Não", label: "Não" },
                              { value: "Não definido", label: "Não definido" },
                            ]}
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Status geral das integrações</span>
                          <input value={channelDraft.integrations_status} onChange={(e)=>handleChannelDraftChange("integrations_status", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Observações técnicas</span>
                          <textarea value={channelDraft.integrations_notes} onChange={(e)=>handleChannelDraftChange("integrations_notes", e.target.value)} rows={2} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Fallback entre canais</span>
                          <textarea value={channelDraft.channel_fallback_rule} onChange={(e)=>handleChannelDraftChange("channel_fallback_rule", e.target.value)} rows={2} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Resumo dos canais do sistema</span>
                          <textarea value={channelDraft.channels_system_summary} onChange={(e)=>handleChannelDraftChange("channels_system_summary", e.target.value)} rows={3} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                        </label>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-2 text-sm font-semibold text-gray-900">Canal comercial da loja</div>
              <SummaryList items={channelCommercialItems} />
            </div>
            <div>
              <div className="mb-2 text-sm font-semibold text-gray-900">Canal do responsável</div>
              <SummaryList items={channelResponsibleItems} />
            </div>
            <div>
              <div className="mb-2 text-sm font-semibold text-gray-900">Chat interno e outros canais</div>
              <SummaryList items={channelInternalChatItems} />
            </div>
            <div>
              <div className="mb-2 text-sm font-semibold text-gray-900">Integrações externas</div>
              <SummaryList items={channelOtherAndIntegrationItems} />
            </div>
            <div className="lg:col-span-2">
              <div className="mb-2 text-sm font-semibold text-gray-900">Regras de roteamento</div>
              <SummaryList items={channelRoutingItems} />
            </div>
          </div>
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