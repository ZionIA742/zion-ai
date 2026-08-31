"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import IntelligentCatalogImportPanel from "@/components/catalog/IntelligentCatalogImportPanel";
import { useStoreContext } from "@/components/StoreProvider";
import { supabase } from "@/lib/supabaseBrowser";
import {
  createStorePaymentPresentationFromSources,
  createStorePaymentSettingsInputFromSources,
  deriveStorePaymentSettingsSummary,
  formatStorePaymentCurrencyInput,
  formatStorePaymentInstallmentsInput,
  formatStorePaymentPercentInput,
  getStorePaymentLegacyConditionTagLabel,
  normalizeStorePaymentSettingsInput,
  type StorePaymentLegacyConditionTag,
  type StorePaymentSettingsRow,
} from "@/lib/store-payment-settings";
import {
  createStoreDiscountPresentationFromSources,
  createStoreDiscountSettingsInputFromSources,
  formatStoreDiscountMoneyInput,
  formatStoreDiscountPercentInput,
  normalizeStoreDiscountSettingsInput,
  type StoreDiscountSettingsRow,
  type StoreHighValueDiscountSettingsRow,
} from "@/lib/store-discount-settings";
import {
  createStoreChannelSettingsInputFromSources,
  normalizeStoreChannelSettingsInput,
  type StoreChannelSettingsRow,
} from "@/lib/store-channel-settings";
import {
  createStoreStrategySettingsInputFromSources,
  deriveStoreStrategyAiStoreSummary,
  normalizeStoreStrategySettingsInput,
  type StoreStrategySettingsInput,
  type StoreStrategySettingsRow,
} from "@/lib/store-strategy-settings";

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

type PoolPhotoRow = {
  id: string;
  pool_id: string;
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

type StoreBrandingSettingsRow = {
  id: string;
  organization_id: string;
  store_id: string;
  logo_storage_bucket: string | null;
  logo_storage_path: string | null;
  logo_original_filename: string | null;
  logo_mime_type: string | null;
  logo_size_bytes: number | null;
  logo_uploaded_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type StoreBrandingApiResponse = {
  ok: boolean;
  branding?: StoreBrandingSettingsRow | null;
  signedUrl?: string | null;
  warning?: string | null;
  error?: string;
  message?: string;
};

type StoreWhatsappStatusApiResponse = {
  ok: boolean;
  connected?: boolean;
  provider?: string | null;
  status?: string | null;
  isActive?: boolean;
  displayPhoneNumber?: string | null;
  phoneNumberId?: string | null;
  whatsappBusinessAccountId?: string | null;
  lastInboundAt?: string | null;
  lastOutboundAt?: string | null;
  pendingInboxCount?: number;
  pendingOutboundCount?: number;
  lastSafeError?: string | null;
  recentDeliveryStatus?: {
    sentCount?: number;
    deliveredCount?: number;
    readCount?: number;
  } | null;
  automaticWorker?: {
    routeReady?: boolean;
    scheduledAutomatically?: boolean;
    reason?: string | null;
  } | null;
  error?: string;
  message?: string;
};

type StoreContractTemplateRow = {
  id: string;
  organization_id: string;
  store_id: string;
  status: string | null;
  active_version_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type StoreContractTemplateVersionRow = {
  id: string;
  template_id: string;
  organization_id: string;
  store_id: string;
  version_number: number | null;
  status: string | null;
  store_file_id: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  original_filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  raw_extracted_text: string | null;
  analysis_summary: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  rejection_reason: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
};

type StoreContractTemplateExtractedRuleRow = {
  id: string;
  template_version_id: string;
  organization_id: string;
  store_id: string;
  rule_key: string;
  rule_group: string;
  label: string;
  value_text: string | null;
  value_json: Record<string, unknown> | null;
  source_excerpt: string | null;
  confidence: number | null;
  review_status: string | null;
  sort_order: number | null;
  created_at: string | null;
  updated_at: string | null;
};

type StoreContractTemplateApiResponse = {
  ok: boolean;
  template?: StoreContractTemplateRow | null;
  activeVersion?: StoreContractTemplateVersionRow | null;
  versions?: StoreContractTemplateVersionRow[];
  extractedRules?: StoreContractTemplateExtractedRuleRow[];
  error?: string;
  message?: string;
};

type ContractRuleReviewStatus = "pending" | "approved" | "rejected" | "edited";


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
  application: string;
  technical_notes: string;
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

type ManualPriceStatus = "valid" | "missing";
type ManualStockStatus = "available" | "zero" | "unknown" | "not_tracked";

function resolveManualPriceStatus(value: number | null): ManualPriceStatus {
  return value == null ? "missing" : "valid";
}

function resolveManualPriceStatusFromCents(value: number | null): ManualPriceStatus {
  return value == null ? "missing" : "valid";
}

function resolveManualStockState(args: {
  rawQuantity: string;
  trackStock: boolean;
}): {
  stockQuantity: number | null;
  stockStatus: ManualStockStatus;
} {
  if (!args.trackStock) {
    return {
      stockQuantity: null,
      stockStatus: "not_tracked" as const,
    };
  }

  const trimmedQuantity = args.rawQuantity.trim();
  if (!trimmedQuantity) {
    return {
      stockQuantity: null,
      stockStatus: "unknown" as const,
    };
  }

  const parsedQuantity = Number(trimmedQuantity.replace(",", "."));
  const normalizedQuantity = Number.isFinite(parsedQuantity) ? Math.max(0, Math.round(parsedQuantity)) : null;
  if (normalizedQuantity == null) {
    return {
      stockQuantity: null,
      stockStatus: "unknown" as const,
    };
  }

  return {
    stockQuantity: normalizedQuantity,
    stockStatus: normalizedQuantity > 0 ? ("available" as const) : ("zero" as const),
  };
}

type OperationDraftState = {
  operating_days: string;
  operating_hours: string;
  installation_days_rule: string;
  technical_visit_days_rule: string;
  serves_saturday: string;
  serves_sunday: string;
  serves_holiday: string;
  allow_multiple_appointments_per_day: string;
  allow_same_time_appointments: string;
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

type ScheduleSettingsRow = {
  id?: string;
  organization_id: string;
  store_id: string;
  allow_multiple_appointments_per_day: boolean;
  allow_same_time_appointments: boolean;
  same_time_capacity: number;
  attends_holidays: boolean;
  operating_days: unknown;
  operating_hours: unknown;
  installation_days: unknown;
  after_hours_behavior: string | null;
  notes: string | null;
  created_at?: string | null;
  updated_at?: string | null;
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
  accepted_payment_methods: string[];
  legacy_payment_condition_tags: string[];
  pix_key_type: string;
  pix_key: string;
  pix_holder_name: string;
  down_payment_mode: string;
  down_payment_value_type: string;
  down_payment_percent: string;
  down_payment_amount: string;
  installments_enabled: string;
  max_installments: string;
  installment_interest_policy: string;
  payment_notes: string;
  discount_policy_summary: string;
  negotiation_rules_summary: string;
  promise_limits_summary: string;
  post_sale_summary: string;
  after_hours_summary: string;
  commercial_ai_summary: string;
};


type DiscountDraftState = {
  default_discount_percent: string;
  max_discount_percent: string;
  allow_ask_above_max_discount: boolean;
  discount_autonomy_mode: string;
  high_value_enabled: boolean;
  high_value_threshold_amount: string;
  high_value_discount_percent: string;
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
  strategyDraft: StoreStrategySettingsInput;
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
  | "catalogo"
  | "piscinas"
  | "produtos-acessorios"
  | "operacao"
  | "comercial-ia"
  | "responsavel-ativacao"
  | "descontos"
  | "canais-integracoes"
  | "contratos"
  | "identidade";

function normalizeSettingsTabId(tab: SettingsTabId | null | undefined): SettingsTabId {
  if (tab === "piscinas" || tab === "produtos-acessorios") {
    return "catalogo";
  }
  return tab ?? "visao-geral";
}

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
  { value: "financiamento", label: "Financiamento" },
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

const LEGACY_PAYMENT_CONDITION_OPTIONS: Option[] = [
  { value: "parcelado", label: "Parcelado" },
  { value: "a_vista", label: "À vista" },
  { value: "sinal_mais_parcelas", label: "Sinal + parcelas" },
  { value: "sob_analise", label: "Sob análise" },
];

const PIX_KEY_TYPE_OPTIONS: Option[] = [
  { value: "cpf", label: "CPF" },
  { value: "cnpj", label: "CNPJ" },
  { value: "email", label: "E-mail" },
  { value: "phone", label: "Telefone" },
  { value: "random", label: "Chave aleatoria" },
];

const DOWN_PAYMENT_MODE_OPTIONS: Option[] = [
  { value: "none", label: "Nao usa entrada" },
  { value: "optional", label: "Entrada opcional" },
  { value: "required", label: "Entrada obrigatoria" },
];

const DOWN_PAYMENT_VALUE_TYPE_OPTIONS: Option[] = [
  { value: "percent", label: "Percentual" },
  { value: "fixed", label: "Valor fixo" },
  { value: "case_by_case", label: "Caso a caso" },
];

const INSTALLMENT_INTEREST_POLICY_OPTIONS: Option[] = [
  { value: "interest_free", label: "Sem juros" },
  { value: "with_interest", label: "Com juros" },
  { value: "case_by_case", label: "Juros caso a caso" },
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

function buildImportFileKey(file: StoreImportFileRow, index: number) {
  const key = [
    file.id,
    file.storage_path,
    file.original_file_name,
    file.created_at,
    file.updated_at,
    file.size_bytes,
    index,
  ]
    .filter((value) => value !== null && value !== undefined && String(value).trim().length > 0)
    .join("-");

  return key || `catalog-imported-file-${index}`;
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

function resolveStoreWhatsappVisualStatus(status: StoreWhatsappStatusApiResponse | null) {
  const normalizedStatus = cleanText(status?.status).toLowerCase();

  if (status?.connected && status?.isActive && normalizedStatus === "active") {
    return { label: "Conectado", tone: "green" as const };
  }

  if (!status?.connected || normalizedStatus === "error" || normalizedStatus === "failed") {
    return { label: "Erro", tone: "red" as const };
  }

  return { label: "Desconectado", tone: "gray" as const };
}

function resolveHumanReadableWhatsappSafeError(value: string | null | undefined) {
  const normalized = cleanText(value);
  if (!normalized) return "";
  if (normalized === "status_message_not_found_by_external_message_id") {
    return "O detalhamento do ultimo status ainda nao ficou disponivel na integracao.";
  }
  if (/^[a-z0-9_]+$/.test(normalized)) {
    return "";
  }
  return normalized;
}

function resolveResponsibleChannelLabel(value: string | null | undefined) {
  const responsibleName = cleanText(value);
  return responsibleName ? `Canal de ${responsibleName}` : "Canal do responsavel";
}

function resolveContractVersionStatus(status: string | null | undefined) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "draft") return { label: "Sem envio", tone: "gray" as const };
  if (normalized === "uploaded") return { label: "Enviado", tone: "gray" as const };
  if (normalized === "analyzing") return { label: "Analisando", tone: "amber" as const };
  if (normalized === "analyzed") return { label: "Analisado", tone: "gray" as const };
  if (normalized === "awaiting_review") {
    return { label: "Aguardando revisao", tone: "amber" as const };
  }
  if (normalized === "approved") return { label: "Aprovado", tone: "green" as const };
  if (normalized === "active") return { label: "Ativo", tone: "green" as const };
  if (normalized === "rejected") return { label: "Rejeitado", tone: "red" as const };
  if (normalized === "archived") return { label: "Arquivado", tone: "gray" as const };
  if (normalized === "failed") return { label: "Falhou", tone: "red" as const };
  return { label: "Nao definido", tone: "gray" as const };
}

function maskSensitiveContractPreview(value: string | null | undefined) {
  const normalized = String(value || "");
  if (!normalized.trim()) return "";

  return normalized
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "***.***.***-**")
    .replace(/\b\d{11}\b/g, "***********")
    .replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, "**.***.***/****-**")
    .replace(/\b(?:RG|Rg|rg)\s*[:\-]?\s*\d[\d.\-]*\b/g, "RG oculto")
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[email oculto]")
    .replace(/\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9?\d{4})-?\d{4}\b/g, "[telefone oculto]")
    .replace(/\b\d{2}\/\d{2}\/\d{4}\b/g, "[data oculta]")
    .replace(/\b(?:RUA|AVENIDA|AV\.|ALAMEDA|TRAVESSA|ESTRADA)\b[\s\S]{0,80}?\d{1,5}/gi, "[endereco oculto]");
}

function summarizeContractUiText(value: string | null | undefined, maxLength = 180) {
  const masked = maskSensitiveContractPreview(value);
  const normalized = cleanText(masked);
  if (!normalized) return "Nenhum resumo disponivel.";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trim()}...`;
}

function resolveContractRuleStatus(status: string | null | undefined) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "approved") {
    return { label: "Aprovada", tone: "green" as const };
  }
  if (normalized === "rejected") {
    return { label: "Ignorada", tone: "red" as const };
  }
  if (normalized === "edited") {
    return { label: "Ajustada", tone: "amber" as const };
  }
  return { label: "Aguardando revisao", tone: "amber" as const };
}

function resolveContractRuleGroupLabel(group: string | null | undefined) {
  const normalized = String(group || "").trim().toLowerCase();
  if (normalized === "partes") return "Partes";
  if (normalized === "objeto") return "Objeto";
  if (normalized === "pagamento") return "Pagamento";
  if (normalized === "instalacao") return "Entrega e instalacao";
  if (normalized === "obrigacoes_cliente") return "Obrigacoes do cliente";
  if (normalized === "obrigacoes_loja") return "Obrigacoes da loja";
  if (normalized === "garantia") return "Garantia";
  if (normalized === "rescisao") return "Rescisao";
  if (normalized === "foro") return "Foro";
  if (normalized === "imagem") return "Uso de imagem";
  return "Regra";
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
    application: "",
    technical_notes: "",
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

function createOperationDraftFromAnswers(
  answers: AnswersMap,
  scheduleSettings?: ScheduleSettingsRow | null
): OperationDraftState {
  const operatingDaysFromSettings = Array.isArray(scheduleSettings?.operating_days)
    ? (scheduleSettings?.operating_days as unknown[]).map((item) => cleanText(item)).filter(Boolean).join(", ")
    : cleanText(answers.operating_days);

  const operatingHoursFromSettings =
    scheduleSettings?.operating_hours && typeof scheduleSettings.operating_hours === "object"
      ? JSON.stringify(scheduleSettings.operating_hours)
      : cleanText(answers.operating_hours);

  return {
    operating_days: operatingDaysFromSettings,
    operating_hours: operatingHoursFromSettings,
    installation_days_rule: cleanText(answers.installation_days_rule),
    technical_visit_days_rule: cleanText(answers.technical_visit_days_rule),
    serves_saturday: deriveWeekendAvailabilityLabel(answers, "sábado"),
    serves_sunday: deriveWeekendAvailabilityLabel(answers, "domingo"),
    serves_holiday:
      scheduleSettings && typeof scheduleSettings.attends_holidays === "boolean"
        ? yesNoLabel(scheduleSettings.attends_holidays)
        : deriveHolidayAvailabilityLabel(answers),
    allow_multiple_appointments_per_day:
      scheduleSettings && typeof scheduleSettings.allow_multiple_appointments_per_day === "boolean"
        ? yesNoLabel(scheduleSettings.allow_multiple_appointments_per_day)
        : "Sim",
    allow_same_time_appointments:
      scheduleSettings && typeof scheduleSettings.allow_same_time_appointments === "boolean"
        ? yesNoLabel(scheduleSettings.allow_same_time_appointments)
        : "Não",
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
    agenda_capacity_rule:
      scheduleSettings && Number.isFinite(Number(scheduleSettings.same_time_capacity))
        ? String(scheduleSettings.same_time_capacity)
        : cleanText(answers.agenda_capacity_rule) || cleanText(answers.average_human_response_time) || "1",
    operational_ai_summary: cleanText(answers.operational_ai_summary),
  };
}


function createCommercialDraftFromAnswers(answers: AnswersMap): any {
  const paymentMain = joinSelectedLabels(
    parseArrayAnswer(answers.accepted_payment_methods),
    PAYMENT_METHOD_MAIN_OPTIONS
  );
  const paymentConditions = joinSelectedLabels(
    parseArrayAnswer(answers.accepted_payment_methods),
    LEGACY_PAYMENT_CONDITION_OPTIONS
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


function createCommercialDraftFromAnswersWithPaymentSettings(
  answers: AnswersMap,
  paymentSettings?: StorePaymentSettingsRow | null,
  discountSettings?: StoreDiscountSettingsRow | null,
  highValueDiscountSettings?: StoreHighValueDiscountSettingsRow | null,
): CommercialDraftState {
  const baseDraft = createCommercialDraftFromAnswers(answers);
  const paymentPresentation = createStorePaymentPresentationFromSources({
    answers,
    settings: paymentSettings ?? null,
  });
  const discountPresentation = createStoreDiscountPresentationFromSources({
    answers,
    settings: discountSettings ?? null,
    highValueSettings: highValueDiscountSettings ?? null,
  });
  const paymentSettingsInput = createStorePaymentSettingsInputFromSources({
    answers,
    settings: paymentSettings ?? null,
  });

  return {
    ...baseDraft,
    payment_methods_summary: paymentPresentation.paymentSummary,
    accepted_payment_methods: paymentSettingsInput.acceptedPaymentMethods,
    legacy_payment_condition_tags: paymentPresentation.legacyPaymentConditionTags,
    pix_key_type: paymentSettingsInput.pixKeyType,
    pix_key: paymentSettingsInput.pixKey,
    pix_holder_name: paymentSettingsInput.pixHolderName,
    down_payment_mode: paymentSettingsInput.downPaymentMode,
    down_payment_value_type: paymentSettingsInput.downPaymentValueType,
    down_payment_percent: paymentSettingsInput.downPaymentPercent,
    down_payment_amount: paymentSettingsInput.downPaymentAmount,
    installments_enabled: paymentSettingsInput.installmentsEnabled,
    max_installments: paymentSettingsInput.maxInstallments,
    installment_interest_policy: paymentSettingsInput.installmentInterestPolicy,
    payment_notes: paymentSettingsInput.paymentNotes,
    discount_policy_summary:
      discountPresentation.policySummary || baseDraft.discount_policy_summary,
  };
}

function createDiscountDraftFromAnswers(
  answers: AnswersMap,
  discountSettings?: StoreDiscountSettingsRow | null,
  highValueDiscountSettings?: StoreHighValueDiscountSettingsRow | null,
): DiscountDraftState {
  const discountInput = createStoreDiscountSettingsInputFromSources({
    answers,
    settings: discountSettings ?? null,
    highValueSettings: highValueDiscountSettings ?? null,
  });
  const legacyDiscountExplanation =
    "A IA só deve trabalhar com desconto dentro do limite permitido pela loja. Quando o pedido sair da regra, ela deve acionar aprovação humana antes de confirmar qualquer condição especial.";
  const currentDiscountExplanation = cleanText(answers.discount_explanation);
  const safeDiscountExplanation =
    !currentDiscountExplanation ||
    currentDiscountExplanation === legacyDiscountExplanation
      ? "A política de desconto define os limites comerciais da loja. Quem pode conceder desconto dentro desses limites depende do modo de autonomia configurado. Quando a política ou o modo exigir, a IA deve obter aprovação humana antes de confirmar a concessão."
      : currentDiscountExplanation;

  return {
    default_discount_percent: discountInput.defaultDiscountPercent,
    max_discount_percent: discountInput.maxDiscountPercent,
    allow_ask_above_max_discount: discountInput.allowAskAboveMaxDiscount,
    discount_autonomy_mode: discountInput.discountAutonomyMode,
    high_value_enabled: discountInput.highValueEnabled,
    high_value_threshold_amount: discountInput.highValueThresholdAmount,
    high_value_discount_percent: discountInput.highValueDiscountPercent,
    human_help_discount_summary:
  joinSelectedLabels(
    parseArrayAnswer(answers.human_help_discount_cases_selected),
    HUMAN_HELP_DISCOUNT_OPTIONS,
    "",
  ) ||
  cleanText(answers.human_help_discount_cases) ||
  cleanText(answers.human_help_discount_cases_other),
    discount_approver: cleanText(answers.discount_approver_name) || cleanText(answers.responsible_name) || "Responsável principal",
    special_discount_rules: cleanText(answers.discount_special_rules) || cleanText(answers.price_direct_rule_other),
    discount_explanation: safeDiscountExplanation,
  };
}


function createChannelDraftFromSources(
  answers: AnswersMap,
  channelSettings?: StoreChannelSettingsRow | null,
): ChannelDraftState {
  const channelSettingsInput = createStoreChannelSettingsInputFromSources({
    answers,
    settings: channelSettings ?? null,
  });
  const commercialWhatsapp = cleanText(answers.commercial_whatsapp);
  const responsibleWhatsapp = cleanText(answers.responsible_whatsapp);
  const responsibleName = cleanText(answers.responsible_name);

  const draft: ChannelDraftState = {
    commercial_channel_name: channelSettingsInput.commercialChannelName,
    commercial_whatsapp: commercialWhatsapp,
    commercial_channel_active: cleanText(answers.commercial_channel_active) || (commercialWhatsapp ? "Sim" : "Não definido"),
    commercial_receives_real_clients: cleanText(answers.commercial_receives_real_clients) || (commercialWhatsapp ? "Sim" : "Não definido"),

    commercial_is_official_sales_channel: cleanText(answers.commercial_is_official_sales_channel) || (commercialWhatsapp ? "Sim" : "Não definido"),
    commercial_channel_type: cleanText(answers.commercial_channel_type) || "WhatsApp comercial da loja",
    commercial_entry_priority: cleanText(answers.commercial_entry_priority) || "Canal principal de entrada de clientes",
    commercial_human_handoff_enabled: cleanText(answers.commercial_human_handoff_enabled) || "Sim",
    commercial_channel_notes: cleanText(answers.commercial_channel_notes),

    responsible_channel_name: resolveResponsibleChannelLabel(responsibleName),
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

  draft.commercial_receives_real_clients =
    channelSettingsInput.commercialReceivesRealClients;
  draft.commercial_is_official_sales_channel =
    channelSettingsInput.commercialIsOfficialSalesChannel;
  draft.commercial_channel_type = channelSettingsInput.commercialChannelType;
  draft.commercial_entry_priority =
    channelSettingsInput.commercialEntryPriority;
  draft.commercial_human_handoff_enabled =
    channelSettingsInput.commercialHumanHandoffEnabled;
  draft.commercial_channel_notes = channelSettingsInput.commercialChannelNotes;
  draft.integration_provider_name =
    channelSettingsInput.integrationProviderName;
  draft.integration_connection_mode =
    channelSettingsInput.integrationConnectionMode;
  draft.integrations_notes = channelSettingsInput.integrationsNotes;

  return draft;
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

function normalizeManualDuplicateText(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("pt-BR");
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
  return value;
}

function formatManualCatalogFieldValue(
  key: keyof CatalogFormState,
  value: string | boolean
): string | boolean {
  if (typeof value !== "string") return value;
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
    { label: "Aplicação / uso recomendado", value: cleanText(form.application) },
    { label: "Observações técnicas", value: cleanText(form.technical_notes) },
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

function parseYesNoToBoolean(value: unknown, fallback: boolean) {
  const normalized = cleanText(value).toLowerCase();
  if (["sim", "true", "1"].includes(normalized)) return true;
  if (["não", "nao", "false", "0"].includes(normalized)) return false;
  return fallback;
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
  const { organizationId, activeStoreId, activeStore, refreshStores } = useStoreContext();

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
  const [scheduleSettings, setScheduleSettings] = useState<ScheduleSettingsRow | null>(null);
  const [strategySettings, setStrategySettings] = useState<StoreStrategySettingsRow | null>(null);
  const [channelSettings, setChannelSettings] = useState<StoreChannelSettingsRow | null>(null);
  const [paymentSettings, setPaymentSettings] = useState<StorePaymentSettingsRow | null>(null);
  const [discountSettings, setDiscountSettings] = useState<StoreDiscountSettingsRow | null>(null);
  const [highValueDiscountSettings, setHighValueDiscountSettings] =
    useState<StoreHighValueDiscountSettingsRow | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTabId>("visao-geral");
  const [isOverviewEditing, setIsOverviewEditing] = useState(false);
  const [isStrategyEditing, setIsStrategyEditing] = useState(false);
  const [isOperationEditing, setIsOperationEditing] = useState(false);
  const [overviewDraft, setOverviewDraft] = useState<Record<string, string>>({});
  const [strategyDraft, setStrategyDraft] = useState<StoreStrategySettingsInput>(
    createStoreStrategySettingsInputFromSources({}),
  );
  const [operationDraft, setOperationDraft] = useState<OperationDraftState>(createOperationDraftFromAnswers({}, null));
  const [isCommercialEditing, setIsCommercialEditing] = useState(false);
  const [commercialDraft, setCommercialDraft] = useState<CommercialDraftState>(
    createCommercialDraftFromAnswersWithPaymentSettings({}),
  );
  const [isDiscountEditing, setIsDiscountEditing] = useState(false);
  const [discountDraft, setDiscountDraft] = useState<DiscountDraftState>(
    createDiscountDraftFromAnswers({}, null, null),
  );
  const [isChannelsEditing, setIsChannelsEditing] = useState(false);
  const [showChannelsAdvanced, setShowChannelsAdvanced] = useState(false);
  const [channelDraft, setChannelDraft] = useState<ChannelDraftState>(
    createChannelDraftFromSources({}, null),
  );
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
  const [deletingImportFileId, setDeletingImportFileId] = useState<string | null>(null);
  const [rawImportFilesModalTab, setRawImportFilesModalTab] = useState<"pools" | "catalog" | null>(null);
  const [isManualCatalogItemModalOpen, setIsManualCatalogItemModalOpen] = useState(false);
  const [manualCatalogItemCategory, setManualCatalogItemCategory] = useState<
    "piscina" | "quimicos" | "acessorios" | "outros"
  >("piscina");
  const [manualCatalogItemModalError, setManualCatalogItemModalError] = useState<string | null>(null);
  const [manualCatalogItemModalSuccess, setManualCatalogItemModalSuccess] = useState<string | null>(null);
  const [storeBranding, setStoreBranding] = useState<StoreBrandingSettingsRow | null>(null);
  const [storeLogoPreviewUrl, setStoreLogoPreviewUrl] = useState<string | null>(null);
  const [storeWhatsappStatus, setStoreWhatsappStatus] = useState<StoreWhatsappStatusApiResponse | null>(null);
  const [storeWhatsappStatusLoading, setStoreWhatsappStatusLoading] = useState(false);
  const [storeWhatsappStatusErrorText, setStoreWhatsappStatusErrorText] = useState<string | null>(null);
  const [selectedStoreLogoFile, setSelectedStoreLogoFile] = useState<File | null>(null);
  const [savingStoreLogo, setSavingStoreLogo] = useState(false);
  const [removingStoreLogo, setRemovingStoreLogo] = useState(false);
  const [storeContractTemplate, setStoreContractTemplate] = useState<StoreContractTemplateRow | null>(null);
  const [storeContractActiveVersion, setStoreContractActiveVersion] = useState<StoreContractTemplateVersionRow | null>(null);
  const [storeContractVersions, setStoreContractVersions] = useState<StoreContractTemplateVersionRow[]>([]);
  const [storeContractExtractedRules, setStoreContractExtractedRules] = useState<
    StoreContractTemplateExtractedRuleRow[]
  >([]);
  const [contractsLoading, setContractsLoading] = useState(false);
  const [selectedContractBaseFile, setSelectedContractBaseFile] = useState<File | null>(null);
  const [uploadingContractBase, setUploadingContractBase] = useState(false);
  const [contractActionVersionId, setContractActionVersionId] = useState<string | null>(null);
  const [contractActionType, setContractActionType] = useState<
    "analyze" | "approve" | "reject" | "extract-rules" | null
  >(null);
  const [contractRejectReasonDrafts, setContractRejectReasonDrafts] = useState<Record<string, string>>({});
  const [contractsErrorText, setContractsErrorText] = useState<string | null>(null);
  const [contractsSuccessText, setContractsSuccessText] = useState<string | null>(null);
  const [contractRuleActionRuleId, setContractRuleActionRuleId] = useState<string | null>(null);
  const [contractRuleActionType, setContractRuleActionType] = useState<
    "approve" | "reject" | "save-edit" | null
  >(null);
  const [contractRuleEditDrafts, setContractRuleEditDrafts] = useState<Record<string, string>>({});
  const [contractRuleEditingIds, setContractRuleEditingIds] = useState<Record<string, boolean>>({});
  const [contractContentModal, setContractContentModal] = useState<
    | {
        type: "text" | "rules";
        versionId: string;
      }
    | null
  >(null);

  const hasValidStoreContext = Boolean(organizationId && activeStoreId);
  const storeName = useMemo(() => buildStoreName(activeStore), [activeStore]);
  const storeLogoInputRef = useRef<HTMLInputElement | null>(null);
  const contractBaseInputRef = useRef<HTMLInputElement | null>(null);
  const configDraftStorageKey = useMemo(() => {
    if (!organizationId || !activeStoreId) return null;
    return `zion_configuracoes_draft:${organizationId}:${activeStoreId}`;
  }, [organizationId, activeStoreId]);
  const intelligentImportStorageKey = useMemo(() => {
    if (!organizationId || !activeStoreId) return null;
    return `zion_configuracoes_intelligent_import:${organizationId}:${activeStoreId}`;
  }, [organizationId, activeStoreId]);
  const hasRestoredLocalDraftRef = useRef(false);
  const hasInitializedLocalDraftRef = useRef(false);

  const tabs = useMemo(
    () => [
      { id: "visao-geral" as const, label: "Visão Geral" },
      { id: "estrategia" as const, label: "Estratégia" },
      { id: "catalogo" as const, label: "Catálogo" },
      { id: "operacao" as const, label: "Operação" },
      { id: "comercial-ia" as const, label: "Comercial e IA" },
      { id: "responsavel-ativacao" as const, label: "Responsável e ativação" },
      { id: "descontos" as const, label: "Descontos" },
      { id: "canais-integracoes" as const, label: "Canais e integrações" },
      { id: "contratos" as const, label: "Contratos" },
      { id: "identidade" as const, label: "Identidade da loja" },
    ],
    []
  );

  async function fetchStoreBrandingFromApi(storeIdOverride?: string | null) {
    const resolvedStoreId = cleanText(storeIdOverride) || cleanText(activeStoreId);

    if (!resolvedStoreId) {
      setStoreBranding(null);
      setStoreLogoPreviewUrl(null);
      return;
    }

    const response = await fetch(
      `/api/store-branding/logo?storeId=${encodeURIComponent(resolvedStoreId)}`,
      {
        method: "GET",
        cache: "no-store",
      }
    );
    const result = (await response.json()) as StoreBrandingApiResponse;

    if (!response.ok || !result?.ok) {
      throw new Error(result?.message || "Nao foi possivel carregar a logo da loja.");
    }

    setStoreBranding((result.branding ?? null) as StoreBrandingSettingsRow | null);
    setStoreLogoPreviewUrl(result.signedUrl || null);
  }

  async function fetchStoreWhatsappStatusFromApi(storeIdOverride?: string | null) {
    const resolvedStoreId = cleanText(storeIdOverride) || cleanText(activeStoreId);

    if (!resolvedStoreId) {
      setStoreWhatsappStatus(null);
      setStoreWhatsappStatusErrorText(null);
      setStoreWhatsappStatusLoading(false);
      return;
    }

    setStoreWhatsappStatusLoading(true);

    try {
      const response = await fetch(
        `/api/store/whatsapp/status?storeId=${encodeURIComponent(resolvedStoreId)}`,
        {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        }
      );
      const result = (await response.json().catch(() => null)) as StoreWhatsappStatusApiResponse | null;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.message || "Nao foi possivel carregar o status do WhatsApp da loja.");
      }

      setStoreWhatsappStatus(result);
      setStoreWhatsappStatusErrorText(null);
    } catch (error: any) {
      setStoreWhatsappStatus(null);
      setStoreWhatsappStatusErrorText(
        error?.message || "Nao foi possivel carregar o status do WhatsApp da loja."
      );
    } finally {
      setStoreWhatsappStatusLoading(false);
    }
  }

  const applyStoreContractTemplateResponse = useCallback(
    (result: StoreContractTemplateApiResponse | null | undefined) => {
      setStoreContractTemplate((result?.template ?? null) as StoreContractTemplateRow | null);
      setStoreContractActiveVersion(
        (result?.activeVersion ?? null) as StoreContractTemplateVersionRow | null
      );
      setStoreContractVersions(
        Array.isArray(result?.versions)
          ? (result?.versions as StoreContractTemplateVersionRow[])
          : []
      );
      setStoreContractExtractedRules(
        Array.isArray(result?.extractedRules)
          ? (result?.extractedRules as StoreContractTemplateExtractedRuleRow[])
          : []
      );
      setContractRuleEditDrafts((current) => {
        const nextDrafts = { ...current };
        for (const rule of Array.isArray(result?.extractedRules)
          ? (result?.extractedRules as StoreContractTemplateExtractedRuleRow[])
          : []) {
          nextDrafts[rule.id] = cleanText(rule.value_text) || "";
        }
        return nextDrafts;
      });
    },
    []
  );

  const fetchStoreContractTemplates = useCallback(async () => {
    if (!activeStoreId) {
      setStoreContractTemplate(null);
      setStoreContractActiveVersion(null);
      setStoreContractVersions([]);
      setStoreContractExtractedRules([]);
      setSelectedContractBaseFile(null);
      setContractRejectReasonDrafts({});
      setContractRuleEditDrafts({});
      setContractRuleEditingIds({});
      setContractsLoading(false);
      return;
    }

    setContractsLoading(true);

    try {
      const response = await fetch(
        `/api/store-contract-templates?storeId=${encodeURIComponent(activeStoreId)}`,
        {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        }
      );

      const result = (await response.json().catch(() => null)) as StoreContractTemplateApiResponse | null;

      if (!response.ok || !result?.ok) {
        throw new Error(
          result?.message || "Nao foi possivel carregar os contratos base da loja."
        );
      }

      applyStoreContractTemplateResponse(result);
      setContractsErrorText(null);
    } catch (error: any) {
      setContractsErrorText(
        error?.message || "Erro ao carregar os contratos base da loja."
      );
    } finally {
      setContractsLoading(false);
    }
  }, [activeStoreId, applyStoreContractTemplateResponse]);

  async function handleUploadContractBase() {
    if (!activeStoreId) {
      setContractsErrorText("Nenhuma loja ativa foi encontrada para enviar o contrato base.");
      setContractsSuccessText(null);
      return;
    }

    if (!selectedContractBaseFile) {
      setContractsErrorText("Selecione um arquivo PDF, DOC ou DOCX para continuar.");
      setContractsSuccessText(null);
      return;
    }

    setUploadingContractBase(true);
    setContractsErrorText(null);
    setContractsSuccessText(null);

    try {
      const formData = new FormData();
      formData.set("storeId", activeStoreId);
      formData.set("file", selectedContractBaseFile);

      const response = await fetch("/api/store-contract-templates/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      const result = (await response.json().catch(() => null)) as StoreContractTemplateApiResponse | null;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.message || "Nao foi possivel enviar o contrato base.");
      }

      applyStoreContractTemplateResponse(result);
      setContractsSuccessText("Contrato base enviado com sucesso.");
      setSelectedContractBaseFile(null);
    } catch (error: any) {
      setContractsErrorText(error?.message || "Erro ao enviar o contrato base.");
    } finally {
      setUploadingContractBase(false);
    }
  }

  async function handleApproveContractVersion(versionId: string) {
    if (!activeStoreId) {
      setContractsErrorText("Nenhuma loja ativa foi encontrada para aprovar essa versao.");
      setContractsSuccessText(null);
      return;
    }

    setContractActionVersionId(versionId);
    setContractActionType("approve");
    setContractsErrorText(null);
    setContractsSuccessText(null);

    try {
      const response = await fetch(`/api/store-contract-templates/${versionId}/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          storeId: activeStoreId,
        }),
      });

      const result = (await response.json().catch(() => null)) as StoreContractTemplateApiResponse | null;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.message || "Nao foi possivel aprovar essa versao.");
      }

      applyStoreContractTemplateResponse(result);
      setContractsSuccessText("Contrato base aprovado com sucesso.");
    } catch (error: any) {
      setContractsErrorText(error?.message || "Erro ao aprovar essa versao.");
    } finally {
      setContractActionVersionId(null);
      setContractActionType(null);
    }
  }

  async function handleRejectContractVersion(versionId: string) {
    if (!activeStoreId) {
      setContractsErrorText("Nenhuma loja ativa foi encontrada para rejeitar essa versao.");
      setContractsSuccessText(null);
      return;
    }

    setContractActionVersionId(versionId);
    setContractActionType("reject");
    setContractsErrorText(null);
    setContractsSuccessText(null);

    try {
      const rejectionReason = cleanText(contractRejectReasonDrafts[versionId]);
      const response = await fetch(`/api/store-contract-templates/${versionId}/reject`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          storeId: activeStoreId,
          rejectionReason: rejectionReason || undefined,
        }),
      });

      const result = (await response.json().catch(() => null)) as StoreContractTemplateApiResponse | null;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.message || "Nao foi possivel rejeitar essa versao.");
      }

      applyStoreContractTemplateResponse(result);
      setContractsSuccessText("Versao rejeitada com sucesso.");
      setContractRejectReasonDrafts((current) => ({
        ...current,
        [versionId]: "",
      }));
    } catch (error: any) {
      setContractsErrorText(error?.message || "Erro ao rejeitar essa versao.");
    } finally {
      setContractActionVersionId(null);
      setContractActionType(null);
    }
  }

  async function handleAnalyzeContractVersion(versionId: string) {
    if (!activeStoreId) {
      setContractsErrorText("Nenhuma loja ativa foi encontrada para analisar essa versao.");
      setContractsSuccessText(null);
      return;
    }

    setContractActionVersionId(versionId);
    setContractActionType("analyze");
    setContractsErrorText(null);
    setContractsSuccessText(null);

    try {
      const response = await fetch(`/api/store-contract-templates/${versionId}/analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          storeId: activeStoreId,
        }),
      });

      const result = (await response.json().catch(() => null)) as StoreContractTemplateApiResponse | null;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.message || "Nao foi possivel ler esse arquivo.");
      }

      applyStoreContractTemplateResponse(result);
      setContractsSuccessText("Contrato analisado com sucesso.");
    } catch (error: any) {
      setContractsErrorText(error?.message || "Nao foi possivel ler esse arquivo.");
    } finally {
      setContractActionVersionId(null);
      setContractActionType(null);
    }
  }

  async function handleExtractContractRules(versionId: string) {
    if (!activeStoreId) {
      setContractsErrorText("Nenhuma loja ativa foi encontrada para buscar regras.");
      setContractsSuccessText(null);
      return;
    }

    setContractActionVersionId(versionId);
    setContractActionType("extract-rules");
    setContractsErrorText(null);
    setContractsSuccessText(null);

    try {
      const response = await fetch(
        `/api/store-contract-templates/${versionId}/extract-rules`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            storeId: activeStoreId,
          }),
        }
      );

      const result = (await response.json().catch(() => null)) as StoreContractTemplateApiResponse | null;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.message || "Nao foi possivel encontrar regras nesse contrato.");
      }

      applyStoreContractTemplateResponse(result);
      setContractsSuccessText("Regras encontradas com sucesso.");
    } catch (error: any) {
      setContractsErrorText(
        error?.message || "Nao foi possivel encontrar regras nesse contrato."
      );
    } finally {
      setContractActionVersionId(null);
      setContractActionType(null);
    }
  }

  async function handleReviewContractRule(args: {
    ruleId: string;
    reviewStatus: "approved" | "rejected" | "edited";
  }) {
    if (!activeStoreId) {
      setContractsErrorText("Nenhuma loja ativa foi encontrada para revisar essa regra.");
      setContractsSuccessText(null);
      return;
    }

    setContractRuleActionRuleId(args.ruleId);
    setContractRuleActionType(
      args.reviewStatus === "approved"
        ? "approve"
        : args.reviewStatus === "rejected"
          ? "reject"
          : "save-edit"
    );
    setContractsErrorText(null);
    setContractsSuccessText(null);

    try {
      const response = await fetch(
        `/api/store-contract-templates/rules/${args.ruleId}/review`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            storeId: activeStoreId,
            reviewStatus: args.reviewStatus,
            valueText: contractRuleEditDrafts[args.ruleId] || undefined,
          }),
        }
      );

      const result = (await response.json().catch(() => null)) as StoreContractTemplateApiResponse | null;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.message || "Nao foi possivel revisar essa regra.");
      }

      applyStoreContractTemplateResponse(result);
      if (args.reviewStatus === "edited") {
        setContractRuleEditingIds((current) => ({
          ...current,
          [args.ruleId]: false,
        }));
      }
      setContractsSuccessText("Regra atualizada com sucesso.");
    } catch (error: any) {
      setContractsErrorText(error?.message || "Nao foi possivel revisar essa regra.");
    } finally {
      setContractRuleActionRuleId(null);
      setContractRuleActionType(null);
    }
  }

  const fetchPageData = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setCounts({ pools: 0, quimicos: 0, acessorios: 0, outros: 0 });
      setOnboarding(null);
      setAnswers({});
      setScheduleSettings(null);
      setStrategySettings(null);
      setChannelSettings(null);
      setStoreBranding(null);
      setStoreLogoPreviewUrl(null);
      setStoreWhatsappStatus(null);
      setStoreWhatsappStatusErrorText(null);
      setStoreWhatsappStatusLoading(false);
      setSelectedStoreLogoFile(null);
      setPoolImportFiles([]);
      setCatalogImportFiles([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorText(null);

    try {
      const [
        poolsResult,
        catalogResult,
        onboardingResult,
        answersResult,
        scheduleSettingsResult,
        strategySettingsResult,
        channelSettingsResult,
        paymentSettingsResult,
        discountSettingsResult,
        highValueDiscountSettingsResult,
      ] = await Promise.all([
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
        supabase
          .from("store_schedule_settings")
          .select("id, organization_id, store_id, allow_multiple_appointments_per_day, allow_same_time_appointments, same_time_capacity, attends_holidays, operating_days, operating_hours, installation_days, after_hours_behavior, notes, created_at, updated_at")
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId)
          .maybeSingle(),
        supabase
          .from("store_strategy_settings")
          .select(
            "organization_id, store_id, city, state, service_regions, service_region_modes, service_region_primary_mode, service_region_outside_consultation, service_region_notes, store_services, store_services_other, store_description, main_store_brand, brands_worked, strategy_service_exclusions, strategy_primary_focus, strategy_sell_more, strategy_common_customer, strategy_ideal_customer, strategy_ticket_range, strategy_positioning, strategy_priority_brands, strategy_non_worked_brands, strategy_top_lines, strategy_top_products, strategy_differentials, strategy_promise_limits, strategy_ai_presentation, strategy_ai_priorities, strategy_ai_never_forget, created_at, updated_at",
          )
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId)
          .maybeSingle(),
        supabase
          .from("store_channel_settings")
          .select(
            "organization_id, store_id, commercial_channel_name, commercial_receives_real_clients, commercial_is_official_sales_channel, commercial_channel_type, commercial_entry_priority, commercial_human_handoff_enabled, commercial_channel_notes, integration_provider_name, integration_connection_mode, integrations_notes, created_at, updated_at",
          )
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId)
          .maybeSingle(),
        supabase
          .from("store_payment_settings")
          .select(
            "organization_id, store_id, accepted_payment_methods, pix_key_type, pix_key, pix_holder_name, down_payment_mode, down_payment_value_type, down_payment_percent, down_payment_amount_cents, installments_enabled, max_installments, installment_interest_policy, payment_notes, created_at, updated_at",
          )
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId)
          .maybeSingle(),
        supabase
          .from("store_discount_settings")
          .select(
            "organization_id, store_id, default_discount_percent, max_discount_percent, allow_ask_above_max_discount, discount_autonomy_mode, created_at, updated_at",
          )
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId)
          .maybeSingle(),
        supabase
          .from("store_high_value_discount_settings")
          .select(
            "organization_id, store_id, enabled, threshold_amount_cents, discount_percent, created_at, updated_at",
          )
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId)
          .maybeSingle(),
      ]);

      if (poolsResult.error) throw poolsResult.error;
      if (catalogResult.error) throw catalogResult.error;
      if (onboardingResult.error) throw onboardingResult.error;
      if (answersResult.error) throw answersResult.error;
      if (scheduleSettingsResult.error) throw scheduleSettingsResult.error;
      if (strategySettingsResult.error) throw strategySettingsResult.error;
      if (channelSettingsResult.error) throw channelSettingsResult.error;
      if (paymentSettingsResult.error) throw paymentSettingsResult.error;
      if (discountSettingsResult.error) throw discountSettingsResult.error;
      if (highValueDiscountSettingsResult.error) throw highValueDiscountSettingsResult.error;

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

      const nextAnswers = (answersResult.data ?? {}) as AnswersMap;
      const nextStrategySettings =
        (strategySettingsResult.data ?? null) as StoreStrategySettingsRow | null;
      const nextStrategyInput = createStoreStrategySettingsInputFromSources({
        answers: nextAnswers,
        settings: nextStrategySettings,
      });

      setCounts(nextCounts);
      setOnboarding((onboardingResult.data ?? null) as OnboardingRow | null);
      setAnswers({
        ...nextAnswers,
        city: nextStrategyInput.city,
        state: nextStrategyInput.state,
        service_regions: nextStrategyInput.serviceRegions,
        service_region_modes: nextStrategyInput.serviceRegionModes,
        service_region_primary_mode: nextStrategyInput.serviceRegionPrimaryMode,
        service_region_outside_consultation:
          nextStrategyInput.serviceRegionOutsideConsultation,
        service_region_notes: nextStrategyInput.serviceRegionNotes,
        store_services: nextStrategyInput.storeServices,
        store_services_other: nextStrategyInput.storeServicesOther,
        store_description: nextStrategyInput.storeDescription,
        main_store_brand: nextStrategyInput.mainStoreBrand,
        brands_worked: nextStrategyInput.brandsWorked,
        strategy_service_exclusions: nextStrategyInput.strategyServiceExclusions,
        strategy_primary_focus: nextStrategyInput.strategyPrimaryFocus,
        strategy_sell_more: nextStrategyInput.strategySellMore,
        strategy_common_customer: nextStrategyInput.strategyCommonCustomer,
        strategy_ideal_customer: nextStrategyInput.strategyIdealCustomer,
        strategy_ticket_range: nextStrategyInput.strategyTicketRange,
        strategy_positioning: nextStrategyInput.strategyPositioning,
        strategy_priority_brands: nextStrategyInput.strategyPriorityBrands,
        strategy_non_worked_brands: nextStrategyInput.strategyNonWorkedBrands,
        strategy_top_lines: nextStrategyInput.strategyTopLines,
        strategy_top_products: nextStrategyInput.strategyTopProducts,
        strategy_differentials: nextStrategyInput.strategyDifferentials,
        strategy_promise_limits: nextStrategyInput.strategyPromiseLimits,
        strategy_ai_presentation: nextStrategyInput.strategyAiPresentation,
        strategy_ai_priorities: nextStrategyInput.strategyAiPriorities,
        strategy_ai_never_forget: nextStrategyInput.strategyAiNeverForget,
        strategy_ai_store_summary:
          deriveStoreStrategyAiStoreSummary(nextStrategyInput),
      });
      setScheduleSettings((scheduleSettingsResult.data ?? null) as ScheduleSettingsRow | null);
      setStrategySettings(nextStrategySettings);
      setChannelSettings((channelSettingsResult.data ?? null) as StoreChannelSettingsRow | null);
      setPaymentSettings((paymentSettingsResult.data ?? null) as StorePaymentSettingsRow | null);
      setDiscountSettings((discountSettingsResult.data ?? null) as StoreDiscountSettingsRow | null);
      setHighValueDiscountSettings(
        (highValueDiscountSettingsResult.data ?? null) as StoreHighValueDiscountSettingsRow | null,
      );
      setPoolImportFiles(nextPoolImportFiles);
      setCatalogImportFiles(nextCatalogImportFiles);
      await fetchStoreBrandingFromApi(activeStoreId);
      await fetchStoreWhatsappStatusFromApi(activeStoreId);
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
        const nextStoreName =
          typeof entries.store_display_name === "string"
            ? entries.store_display_name.trim()
            : "";
        const hasPrimaryResponsibleData =
          Object.prototype.hasOwnProperty.call(entries, "responsible_name") ||
          Object.prototype.hasOwnProperty.call(entries, "responsible_whatsapp");

        if (hasPrimaryResponsibleData) {
          const responsibleName =
            typeof entries.responsible_name === "string"
              ? entries.responsible_name.trim()
              : "";
          const responsibleWhatsapp =
            typeof entries.responsible_whatsapp === "string"
              ? entries.responsible_whatsapp.trim()
              : "";

          if (!responsibleName || !responsibleWhatsapp) {
            throw new Error(
              "Nome e WhatsApp do responsavel principal sao obrigatorios para sincronizar a configuracao."
            );
          }

          const { error: responsibleSyncError } = await supabase.rpc(
            "upsert_store_primary_responsible_with_legacy_mirror_scoped",
            {
              p_organization_id: organizationId,
              p_store_id: activeStoreId,
              p_name: responsibleName,
              p_whatsapp_number: responsibleWhatsapp,
            }
          );

          if (responsibleSyncError) throw responsibleSyncError;
        }

        const legacyEntries = Object.fromEntries(
          Object.entries(entries).filter(
            ([questionKey]) =>
              questionKey !== "responsible_name" &&
              questionKey !== "responsible_whatsapp"
          )
        );

        for (const [questionKey, rawValue] of Object.entries(legacyEntries)) {
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

        if (nextStoreName) {
          const response = await fetch("/api/store/update-name", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              storeId: activeStoreId,
              name: nextStoreName,
            }),
          });

          const result = (await response.json().catch(() => null)) as
            | { ok?: boolean; message?: string; error?: string }
            | null;

          if (!response.ok || !result?.ok) {
            throw new Error(
              result?.message || "Nao foi possivel atualizar o nome oficial da loja."
            );
          }

          await refreshStores();
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
    void fetchStoreContractTemplates();
  }, [fetchStoreContractTemplates]);

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

      if (parsed.activeTab) setActiveTab(normalizeSettingsTabId(parsed.activeTab));
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
    setSelectedStoreLogoFile(null);
  }, [organizationId, activeStoreId]);

  useEffect(() => {
    setSelectedContractBaseFile(null);
    setContractActionType(null);
    setContractRuleActionRuleId(null);
    setContractRuleActionType(null);
    setContractRuleEditDrafts({});
    setContractRuleEditingIds({});
    setContractContentModal(null);
    setContractRejectReasonDrafts({});
    setContractsErrorText(null);
    setContractsSuccessText(null);
  }, [organizationId, activeStoreId]);

  useEffect(() => {
    if (selectedStoreLogoFile) {
      const objectUrl = URL.createObjectURL(selectedStoreLogoFile);
      setStoreLogoPreviewUrl(objectUrl);

      return () => {
        URL.revokeObjectURL(objectUrl);
      };
    }
  }, [selectedStoreLogoFile]);

  const totalCatalogo = useMemo(
    () => counts.pools + counts.quimicos + counts.acessorios + counts.outros,
    [counts]
  );

  const onboardingStatus = useMemo(
    () => resolveOnboardingLabel(onboarding?.status),
    [onboarding?.status]
  );

  const strategySettingsInput = useMemo(
    () =>
      createStoreStrategySettingsInputFromSources({
        answers,
        settings: strategySettings,
      }),
    [answers, strategySettings],
  );

  const derivedStrategyAiStoreSummary = useMemo(
    () => deriveStoreStrategyAiStoreSummary(strategySettingsInput),
    [strategySettingsInput],
  );

  useEffect(() => {
    setStrategyDraft(strategySettingsInput);
  }, [strategySettingsInput]);

  const strategyBaseItems = useMemo(() => {
    const city = cleanText(strategySettingsInput.city);
    const state = cleanText(strategySettingsInput.state);
    const serviceRegions = cleanText(strategySettingsInput.serviceRegions);
    const regionModes = joinSelectedLabels(
      strategySettingsInput.serviceRegionModes,
      SERVICE_REGION_MODE_OPTIONS
    );

    return buildBulletRows([
      { label: "Cidade base", value: city },
      { label: "Estado", value: state },
      { label: "Região principal de atendimento", value: serviceRegions },
      { label: "Até onde atende", value: regionModes },
      { label: "Observações sobre cobertura", value: cleanText(strategySettingsInput.serviceRegionNotes) },
    ]);
  }, [strategySettingsInput]);

  const strategyServicesItems = useMemo(() => {
    const services = joinSelectedLabels(
      strategySettingsInput.storeServices,
      STORE_SERVICE_OPTIONS,
      cleanText(strategySettingsInput.storeServicesOther)
    );

    return buildBulletRows([
      { label: "Serviços principais", value: services },
      { label: "Serviços extras", value: cleanText(strategySettingsInput.storeServicesOther) },
      { label: "Serviços que a loja não faz", value: cleanText(strategySettingsInput.strategyServiceExclusions) },
    ]);
  }, [strategySettingsInput]);

  const strategyCommercialFocusItems = useMemo(() => {
    return buildBulletRows([
      { label: "Tipo de loja / foco comercial", value: cleanText(strategySettingsInput.storeDescription) },
      { label: "Principal foco da loja", value: cleanText(strategySettingsInput.strategyPrimaryFocus) },
      { label: "O que quer vender mais", value: cleanText(strategySettingsInput.strategySellMore) },
      { label: "Tipo de cliente mais comum", value: cleanText(strategySettingsInput.strategyCommonCustomer) },
      { label: "Tipo de cliente ideal", value: cleanText(strategySettingsInput.strategyIdealCustomer) },
      { label: "Faixa de ticket mais comum", value: cleanText(strategySettingsInput.strategyTicketRange) },
      { label: "Posicionamento da loja", value: cleanText(strategySettingsInput.strategyPositioning) },
    ]);
  }, [strategySettingsInput]);

  const strategyBrandsItems = useMemo(() => {
    return buildBulletRows([
      { label: "Marca principal", value: cleanText(strategySettingsInput.mainStoreBrand) },
      { label: "Outras marcas trabalhadas", value: cleanText(strategySettingsInput.brandsWorked) },
      { label: "Marcas prioritárias", value: cleanText(strategySettingsInput.strategyPriorityBrands) },
      { label: "Marcas que não trabalha", value: cleanText(strategySettingsInput.strategyNonWorkedBrands) },
      { label: "Linhas principais", value: cleanText(strategySettingsInput.strategyTopLines) },
      { label: "Produtos com maior giro", value: cleanText(strategySettingsInput.strategyTopProducts) },
    ]);
  }, [strategySettingsInput]);

  const strategyDifferentialsItems = useMemo(() => {
    return buildBulletRows([
      { label: "Diferenciais da loja", value: cleanText(strategySettingsInput.strategyDifferentials) },
      { label: "O que não pode prometer", value: cleanText(strategySettingsInput.strategyPromiseLimits) },
      { label: "O que depende de visita", value: cleanText(answers.strategy_requires_visit) },
      { label: "O que depende de humano", value: cleanText(answers.strategy_requires_human) },
      { label: "Casos de exceção", value: cleanText(answers.strategy_exception_cases) },
    ]);
  }, [answers, strategySettingsInput]);

  const strategyAiSummaryItems = useMemo(() => {
    return buildBulletRows([
      { label: "Como a IA deve entender a loja", value: cleanText(derivedStrategyAiStoreSummary) },
      { label: "Como deve apresentar a loja", value: cleanText(strategySettingsInput.strategyAiPresentation) },
      { label: "O que a IA deve priorizar", value: cleanText(strategySettingsInput.strategyAiPriorities) },
      { label: "O que nunca deve esquecer", value: cleanText(strategySettingsInput.strategyAiNeverForget) },
    ]);
  }, [derivedStrategyAiStoreSummary, strategySettingsInput]);

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
    const sameTimeAllowed = yesNoLabel(scheduleSettings?.allow_same_time_appointments);
    const sameTimeCapacity = scheduleSettings?.same_time_capacity ? String(scheduleSettings.same_time_capacity) : "1";

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
        label: "Agenda no mesmo horário",
        value: sameTimeAllowed === "Sim" ? `Permitido • cap. ${sameTimeCapacity}` : "Bloqueado",
        tone: sameTimeAllowed === "Sim" ? ("green" as const) : ("amber" as const),
        hint: sameTimeAllowed === "Sim" ? "A agenda permite múltiplos compromissos no mesmo horário." : compactCoverageHint,
      },
    ];
  }, [answers, installationDaysSelected.length, technicalVisitDaysSelected.length, installationDaysLabel, technicalVisitDaysLabel, technicalVisitRulesLabel, scheduleSettings]);

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
          { label: "Atende feriado", value: scheduleSettings ? yesNoLabel(scheduleSettings.attends_holidays) : servesHolidayLabel },
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
          { label: "Pode ter vários compromissos no dia", value: scheduleSettings ? yesNoLabel(scheduleSettings.allow_multiple_appointments_per_day) : "Sim" },
          { label: "Pode ter compromissos no mesmo horário", value: scheduleSettings ? yesNoLabel(scheduleSettings.allow_same_time_appointments) : "Não" },
          { label: "Capacidade máxima no mesmo horário", value: scheduleSettings?.same_time_capacity ? String(scheduleSettings.same_time_capacity) : cleanText(answers.average_human_response_time) || cleanText(answers.agenda_capacity_rule) || "1" },
        ]),
      },
      {
        title: "Resumo operacional para a IA",
        items: buildBulletRows([
          { label: "Resumo", value: cleanText(answers.operational_ai_summary) || "Ainda não definido" },
        ]),
      },
    ];
  }, [answers, installationDaysLabel, technicalVisitDaysLabel, technicalVisitRulesLabel, importantLimitationsLabel, servesSaturdayLabel, servesSundayLabel, servesHolidayLabel, scheduleSettings]);

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

  const discountPresentation = useMemo(() => {
    return createStoreDiscountPresentationFromSources({
      answers,
      settings: discountSettings,
      highValueSettings: highValueDiscountSettings,
    });
  }, [answers, discountSettings, highValueDiscountSettings]);

  const channelSettingsInput = useMemo(() => {
    return createStoreChannelSettingsInputFromSources({
      answers,
      settings: channelSettings,
    });
  }, [answers, channelSettings]);

  const storeWhatsappVisualStatus = useMemo(
    () => resolveStoreWhatsappVisualStatus(storeWhatsappStatus),
    [storeWhatsappStatus]
  );
  const connectedCommercialWhatsapp = cleanText(
    storeWhatsappStatus?.displayPhoneNumber,
  );
  const primaryResponsibleName =
    cleanText(primaryResponsibleDraft.name) || cleanText(answers.responsible_name);
  const primaryResponsibleWhatsapp =
    cleanText(primaryResponsibleDraft.whatsapp) || cleanText(answers.responsible_whatsapp);
  const primaryResponsibleChannelLabel =
    resolveResponsibleChannelLabel(primaryResponsibleName);
  const storeWhatsappSafeErrorText = resolveHumanReadableWhatsappSafeError(
    storeWhatsappStatus?.lastSafeError,
  );

  const commercialPaymentItems = useMemo(() => {
    const paymentPresentation = createStorePaymentPresentationFromSources({
      answers,
      settings: paymentSettings,
    });
    return buildBulletRows([
      {
        label: "Formas de pagamento",
        value: paymentPresentation.paymentSummary || "Nao definido",
      },
      {
        label: "Dados antigos para revisar",
        value: paymentPresentation.legacyConditionSummary || "Nenhum",
      },
      {
        label: "Politica global de desconto",
        value: discountPresentation.policySummary || "Nao definido",
      },
      { label: "Ticket médio da loja", value: cleanText(answers.average_ticket) ? `R$ ${cleanText(answers.average_ticket)}` : "Não definido" },
    ]);
  }, [answers, discountPresentation, paymentSettings]);

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
    const canDiscount = discountPresentation.canOfferDiscount ? "Sim" : "Nao";
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
        tone: discountPresentation.maxDiscountPercent != null ? ("green" as const) : ("gray" as const),
        hint:
          discountPresentation.policySummary ||
          "Primeiro degrau, teto normal, autonomia e alto valor",
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
  }, [answers, discountPresentation]);

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
      {
        label: "Primeiro degrau normal",
        value:
          discountPresentation.defaultDiscountPercent == null
            ? "Não definido"
            : `${discountPresentation.defaultDiscountPercent}%`,
      },
      {
        label: "Teto normal",
        value:
          discountPresentation.maxDiscountPercent == null
            ? "Não definido"
            : `${discountPresentation.maxDiscountPercent}%`,
      },
      {
        label: "Pode consultar acima do teto",
        value: discountPresentation.allowAskAboveMaxDiscount ? "Sim" : "Não",
      },
      {
        label: "Modo de autonomia",
        value: discountPresentation.autonomyMode || "approval_required",
      },
      {
        label: "Política de alto valor",
        value: discountPresentation.highValueEnabled
          ? `Ativa${discountPresentation.highValueDiscountPercent == null ? "" : ` • ${discountPresentation.highValueDiscountPercent}%`}`
          : "Desativada",
      },
      {
  label: "Quando precisa aprovação humana",
  value:
    joinSelectedLabels(
      parseArrayAnswer(answers.human_help_discount_cases_selected),
      HUMAN_HELP_DISCOUNT_OPTIONS,
      "",
    ) ||
    cleanText(answers.human_help_discount_cases) ||
    cleanText(answers.human_help_discount_cases_other),
},
      { label: "Quem aprova", value: cleanText(answers.discount_approver_name) || cleanText(answers.responsible_name) || "Responsável principal" },
      { label: "Regras especiais", value: cleanText(answers.discount_special_rules) || cleanText(answers.price_direct_rule_other) },
      { label: "Como funciona", value: cleanText(answers.discount_explanation) || "A IA pode trabalhar com desconto apenas dentro da regra definida pela loja. Quando o pedido sai do limite ou exige condição especial, ela deve chamar aprovação humana antes de confirmar qualquer valor." },
    ]);
  }, [answers, discountPresentation]);

  const channelsOverviewMetrics = useMemo(() => {
    const integrationStatus =
      cleanText(storeWhatsappVisualStatus.label) ||
      resolveOnboardingLabel(onboarding?.status).label;
    const canonicalSettingsReady =
      cleanText(channelSettingsInput.commercialChannelName) &&
      cleanText(channelSettingsInput.integrationProviderName) &&
      cleanText(channelSettingsInput.integrationConnectionMode);

    return [
      {
        label: "Canal comercial",
        value: connectedCommercialWhatsapp ? "Conectado" : "Pendente",
        tone: connectedCommercialWhatsapp ? ("green" as const) : ("amber" as const),
        hint:
          connectedCommercialWhatsapp ||
          "O WhatsApp comercial oficial e derivado do status vivo da integracao.",
      },
      {
        label: "Canal do responsável",
        value: primaryResponsibleWhatsapp ? "Configurado" : "Pendente",
        tone: primaryResponsibleWhatsapp ? ("green" as const) : ("amber" as const),
        hint:
          primaryResponsibleWhatsapp ||
          "Defina o responsavel principal na configuracao canonica de responsaveis.",
      },
      {
        label: "Configuração canônica",
        value: canonicalSettingsReady ? "Definida" : "Pendente",
        tone: canonicalSettingsReady ? ("green" as const) : ("amber" as const),
        hint: canonicalSettingsReady
          ? "Os campos canônicos principais desta família já foram definidos."
          : "Revise nome comercial, provedor principal e modo de conexão.",
      },
      {
        label: "Integrações externas",
        value: integrationStatus || "Pendente",
        tone: integrationStatus === "Concluído" ? ("green" as const) : ("amber" as const),
        hint:
          channelSettingsInput.integrationsNotes ||
          "A configuracao humana define provedor, modo de conexao e notas permanentes.",
      },
    ];
  }, [
    channelSettingsInput.commercialChannelName,
    channelSettingsInput.integrationConnectionMode,
    channelSettingsInput.integrationProviderName,
    channelSettingsInput.integrationsNotes,
    connectedCommercialWhatsapp,
    onboarding?.status,
    primaryResponsibleWhatsapp,
    storeWhatsappVisualStatus.label,
  ]);


  const channelEssentialPendencies = useMemo(() => {
    const pendencies: string[] = [];

    if (!connectedCommercialWhatsapp) {
      pendencies.push("Conectar o WhatsApp oficial da loja para habilitar o canal comercial real.");
    }
    if (!primaryResponsibleWhatsapp) {
      pendencies.push("Definir o WhatsApp do responsavel principal na configuracao canonica de responsaveis.");
    }
    if (!cleanText(channelSettingsInput.integrationProviderName) || normalizeLoose(channelSettingsInput.integrationProviderName).includes("ainda nao definido")) {
      pendencies.push("Definir qual é o provedor principal da integração de WhatsApp.");
    }
    if (!cleanText(channelSettingsInput.integrationConnectionMode)) {
      pendencies.push("Definir como a integração se conecta ao sistema.");
    }

    return pendencies;
  }, [
    channelSettingsInput.integrationConnectionMode,
    channelSettingsInput.integrationProviderName,
    connectedCommercialWhatsapp,
    primaryResponsibleWhatsapp,
  ]);

  const channelRecommendedPendencies = useMemo(() => {
    const pendencies: string[] = [];

    if (!cleanText(channelDraft.commercial_channel_notes)) {
      pendencies.push("Registrar observacoes permanentes do canal comercial.");
    }
    if (!cleanText(channelDraft.integrations_notes)) {
      pendencies.push("Registrar observacoes permanentes sobre a integracao principal.");
    }

    return pendencies;
  }, [channelDraft.commercial_channel_notes, channelDraft.integrations_notes]);

  const channelGuidedStatusMetrics = useMemo(() => {
    const essentialDone = channelEssentialPendencies.length === 0;
    const recommendedDone = channelRecommendedPendencies.length === 0;
    const providerDefined =
      cleanText(channelDraft.integration_provider_name) &&
      !normalizeLoose(channelDraft.integration_provider_name).includes("ainda nao definido");
    const authorityDefined = connectedCommercialWhatsapp && primaryResponsibleWhatsapp;

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
        label: "Autoridades derivadas",
        value: authorityDefined ? "Disponíveis" : "Pendentes",
        tone: authorityDefined ? ("green" as const) : ("amber" as const),
        hint: authorityDefined ? "WhatsApp comercial e responsável principal já estão disponíveis por fonte viva/canônica." : "Conecte o WhatsApp oficial e defina o responsável principal na frente apropriada.",
      },
    ];
  }, [
    channelDraft.integration_provider_name,
    channelEssentialPendencies,
    channelRecommendedPendencies,
    connectedCommercialWhatsapp,
    primaryResponsibleWhatsapp,
  ]);

  const channelCommercialItems = useMemo(() => {
    return buildBulletRows([
      { label: "Nome do canal comercial", value: channelSettingsInput.commercialChannelName },
      { label: "WhatsApp oficial conectado", value: connectedCommercialWhatsapp || "Nao informado" },
      { label: "Status real do WhatsApp", value: storeWhatsappVisualStatus.label },
      { label: "Recebe clientes reais", value: channelSettingsInput.commercialReceivesRealClients },
      { label: "É o canal oficial da IA vendedora", value: channelSettingsInput.commercialIsOfficialSalesChannel },
      { label: "Tipo de canal", value: channelSettingsInput.commercialChannelType },
      { label: "Prioridade de entrada", value: channelSettingsInput.commercialEntryPriority },
      { label: "Permite transbordo para humano", value: channelSettingsInput.commercialHumanHandoffEnabled },
      { label: "Observações", value: channelSettingsInput.commercialChannelNotes },
    ]);
  }, [channelSettingsInput, connectedCommercialWhatsapp, storeWhatsappVisualStatus.label]);

  const channelResponsibleItems = useMemo(() => {
    return buildBulletRows([
      { label: "Canal derivado do responsável principal", value: primaryResponsibleChannelLabel },
      { label: "WhatsApp do responsável", value: primaryResponsibleWhatsapp || "Nao definido" },
      { label: "Canal ativo", value: primaryResponsibleWhatsapp ? "Sim" : "Nao definido" },
      { label: "Origem", value: "Configuracao canonica de responsaveis" },
      { label: "Observações", value: "Os comportamentos operacionais do responsável pertencem ao Bloco 5 e não são editados nesta família." },
    ]);
  }, [primaryResponsibleChannelLabel, primaryResponsibleWhatsapp]);

  const channelOtherAndIntegrationItems = useMemo(() => {
    return buildBulletRows([
      { label: "Provedor / integração principal", value: channelSettingsInput.integrationProviderName },
      { label: "Modo de conexão", value: channelSettingsInput.integrationConnectionMode },
      { label: "Status real da integração oficial", value: storeWhatsappVisualStatus.label },
      { label: "Observações permanentes da integração", value: channelSettingsInput.integrationsNotes },
    ]);
  }, [channelSettingsInput, storeWhatsappVisualStatus.label]);

  const hasStoredLogo = Boolean(
    cleanText(storeBranding?.logo_storage_bucket) && cleanText(storeBranding?.logo_storage_path)
  );
  const displayedLogoFileName =
    cleanText(selectedStoreLogoFile?.name) ||
    cleanText(storeBranding?.logo_original_filename) ||
    "Nenhum arquivo";
  const displayedLogoSize = selectedStoreLogoFile?.size ?? storeBranding?.logo_size_bytes ?? null;

  const identityItems = useMemo(() => {
    return buildBulletRows([
      { label: "Nome da loja", value: cleanText(answers.store_display_name) || storeName },
      {
        label: "Logo",
        value: hasStoredLogo ? "Logo cadastrada para os PDFs da loja" : "Nenhuma logo enviada ainda",
      },
      { label: "Cores", value: "Ainda não configuradas nesta tela" },
      { label: "Nome que a IA usa", value: cleanText(answers.store_display_name) || storeName },
      { label: "Assinatura padrão da IA", value: cleanText(answers.store_description) },
      { label: "Dados usados em orçamento e contrato", value: cleanText(answers.store_display_name) || storeName },
    ]);
  }, [answers, storeName, hasStoredLogo]);

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
    activeTab === "catalogo";

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

  const handleStrategyDraftChange = useCallback(<K extends keyof StoreStrategySettingsInput>(
    key: K,
    value: StoreStrategySettingsInput[K]
  ) => {
    setStrategyDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const handleStrategyMultiValueToggle = useCallback(
    (key: "serviceRegionModes" | "storeServices", value: string) => {
      setStrategyDraft((current) => ({
        ...current,
        [key]: current[key].includes(value)
          ? current[key].filter((item) => item !== value)
          : [...current[key], value],
      }));
    },
    [],
  );

  const handleStrategyEditOpen = useCallback(() => {
    setStrategyDraft(strategySettingsInput);
    setIsStrategyEditing(true);
  }, [strategySettingsInput]);

  const handleStrategyEditCancel = useCallback(() => {
    setStrategyDraft(strategySettingsInput);
    setIsStrategyEditing(false);
  }, [strategySettingsInput]);

  const handleStrategyEditSave = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setErrorText("Nenhuma loja ativa foi encontrada para salvar a estrategia.");
      setSuccessText(null);
      return;
    }

    const normalizedStrategySettings = normalizeStoreStrategySettingsInput(strategyDraft);

    try {
      const { data: savedStrategySettings, error: strategySaveError } =
        await supabase.rpc(
          "upsert_store_strategy_settings_with_legacy_mirror_scoped",
          {
            p_organization_id: organizationId,
            p_store_id: activeStoreId,
            p_city: normalizedStrategySettings.value.city,
            p_state: normalizedStrategySettings.value.state,
            p_service_regions: normalizedStrategySettings.value.serviceRegions,
            p_service_region_modes: normalizedStrategySettings.value.serviceRegionModes,
            p_service_region_primary_mode:
              normalizedStrategySettings.value.serviceRegionPrimaryMode,
            p_service_region_outside_consultation:
              normalizedStrategySettings.value.serviceRegionOutsideConsultation,
            p_service_region_notes: normalizedStrategySettings.value.serviceRegionNotes,
            p_store_services: normalizedStrategySettings.value.storeServices,
            p_store_services_other: normalizedStrategySettings.value.storeServicesOther,
            p_store_description: normalizedStrategySettings.value.storeDescription,
            p_main_store_brand: normalizedStrategySettings.value.mainStoreBrand,
            p_brands_worked: normalizedStrategySettings.value.brandsWorked,
            p_strategy_service_exclusions:
              normalizedStrategySettings.value.strategyServiceExclusions,
            p_strategy_primary_focus:
              normalizedStrategySettings.value.strategyPrimaryFocus,
            p_strategy_sell_more: normalizedStrategySettings.value.strategySellMore,
            p_strategy_common_customer:
              normalizedStrategySettings.value.strategyCommonCustomer,
            p_strategy_ideal_customer:
              normalizedStrategySettings.value.strategyIdealCustomer,
            p_strategy_ticket_range:
              normalizedStrategySettings.value.strategyTicketRange,
            p_strategy_positioning:
              normalizedStrategySettings.value.strategyPositioning,
            p_strategy_priority_brands:
              normalizedStrategySettings.value.strategyPriorityBrands,
            p_strategy_non_worked_brands:
              normalizedStrategySettings.value.strategyNonWorkedBrands,
            p_strategy_top_lines: normalizedStrategySettings.value.strategyTopLines,
            p_strategy_top_products:
              normalizedStrategySettings.value.strategyTopProducts,
            p_strategy_differentials:
              normalizedStrategySettings.value.strategyDifferentials,
            p_strategy_promise_limits:
              normalizedStrategySettings.value.strategyPromiseLimits,
            p_strategy_ai_presentation:
              normalizedStrategySettings.value.strategyAiPresentation,
            p_strategy_ai_priorities:
              normalizedStrategySettings.value.strategyAiPriorities,
            p_strategy_ai_never_forget:
              normalizedStrategySettings.value.strategyAiNeverForget,
          },
        );

      if (strategySaveError) throw strategySaveError;

      setStrategySettings(
        (savedStrategySettings ?? null) as StoreStrategySettingsRow | null,
      );
      setErrorText(null);
      setSuccessText("Alteracoes da estrategia salvas com sucesso.");
      setIsStrategyEditing(false);
      await fetchPageData();
    } catch (error: any) {
      setErrorText(error?.message ?? "Nao foi possivel salvar as alteracoes da estrategia.");
      setSuccessText(null);
    }
  }, [activeStoreId, fetchPageData, organizationId, strategyDraft]);


  useEffect(() => {
    setOperationDraft(createOperationDraftFromAnswers(answers, scheduleSettings));
  }, [answers, scheduleSettings]);

  const handleOperationDraftChange = useCallback((key: keyof OperationDraftState, value: string) => {
    setOperationDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const handleOperationEditCancel = useCallback(() => {
    setOperationDraft(createOperationDraftFromAnswers(answers, scheduleSettings));
    setIsOperationEditing(false);
  }, [answers, scheduleSettings]);

  const handleOperationEditSave = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setErrorText("Nenhuma loja ativa foi encontrada para salvar a operação.");
      setSuccessText(null);
      return;
    }

    try {
      const { data: savedScheduleSettings, error: scheduleSettingsError } = await supabase.rpc(
        "upsert_store_schedule_settings",
        {
          p_organization_id: organizationId,
          p_store_id: activeStoreId,
          p_allow_multiple_appointments_per_day: parseYesNoToBoolean(
            operationDraft.allow_multiple_appointments_per_day,
            true
          ),
          p_allow_same_time_appointments: parseYesNoToBoolean(
            operationDraft.allow_same_time_appointments,
            false
          ),
          p_same_time_capacity: Math.max(1, Number.parseInt(cleanText(operationDraft.agenda_capacity_rule) || "1", 10) || 1),
          p_attends_holidays: parseYesNoToBoolean(operationDraft.serves_holiday, false),
          p_operating_days:
            scheduleSettings?.operating_days && Array.isArray(scheduleSettings.operating_days)
              ? scheduleSettings.operating_days
              : [],
          p_operating_hours:
            scheduleSettings?.operating_hours && typeof scheduleSettings.operating_hours === "object"
              ? scheduleSettings.operating_hours
              : {},
          p_installation_days:
            scheduleSettings?.installation_days && Array.isArray(scheduleSettings.installation_days)
              ? scheduleSettings.installation_days
              : [],
          p_after_hours_behavior: cleanText(answers.after_hours_behavior) || null,
          p_notes: "Fonte viva da agenda atualizada pela aba Operação.",
        }
      );

      if (scheduleSettingsError) throw scheduleSettingsError;

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

      setScheduleSettings((savedScheduleSettings ?? null) as ScheduleSettingsRow | null);
      setIsOperationEditing(false);
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao salvar alterações da operação.");
      setSuccessText(null);
    }
  }, [
    organizationId,
    activeStoreId,
    operationDraft,
    scheduleSettings,
    answers.after_hours_behavior,
    upsertConfigAnswers,
  ]);


  useEffect(() => {
    setCommercialDraft(
      createCommercialDraftFromAnswersWithPaymentSettings(
        answers,
        paymentSettings,
        discountSettings,
        highValueDiscountSettings,
      ),
    );
  }, [answers, discountSettings, highValueDiscountSettings, paymentSettings]);

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

  const handleCommercialPaymentMethodToggle = useCallback((value: string) => {
    setCommercialDraft((current) => {
      const selectedValues = current.accepted_payment_methods.includes(value)
        ? current.accepted_payment_methods.filter((item) => item !== value)
        : [...current.accepted_payment_methods, value];

      return {
        ...current,
        accepted_payment_methods: selectedValues,
      };
    });
  }, []);

  const handleCommercialEditCancel = useCallback(() => {
    setCommercialDraft(
      createCommercialDraftFromAnswersWithPaymentSettings(
        answers,
        paymentSettings,
        discountSettings,
        highValueDiscountSettings,
      ),
    );
    setIsCommercialEditing(false);
  }, [answers, discountSettings, highValueDiscountSettings, paymentSettings]);

  const handleCommercialEditSave = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setErrorText("Nenhuma loja ativa foi encontrada para salvar essas alteraÃ§Ãµes.");
      setSuccessText(null);
      return;
    }

    const normalizedPaymentSettings = normalizeStorePaymentSettingsInput({
      acceptedPaymentMethods: commercialDraft.accepted_payment_methods,
      pixKeyType: commercialDraft.pix_key_type,
      pixKey: commercialDraft.pix_key,
      pixHolderName: commercialDraft.pix_holder_name,
      downPaymentMode: commercialDraft.down_payment_mode,
      downPaymentValueType: commercialDraft.down_payment_value_type,
      downPaymentPercent: commercialDraft.down_payment_percent,
      downPaymentAmount: commercialDraft.down_payment_amount,
      installmentsEnabled: commercialDraft.installments_enabled,
      maxInstallments: commercialDraft.max_installments,
      installmentInterestPolicy: commercialDraft.installment_interest_policy,
      paymentNotes: commercialDraft.payment_notes,
    });

    if (!normalizedPaymentSettings.ok) {
      setErrorText(normalizedPaymentSettings.error);
      setSuccessText(null);
      return;
    }

    const derivedPaymentSummary = deriveStorePaymentSettingsSummary(
      normalizedPaymentSettings.value,
    );

    const { data: savedPaymentSettings, error: paymentSettingsError } =
      await supabase.rpc("upsert_store_payment_settings_with_legacy_mirror_scoped", {
        p_organization_id: organizationId,
        p_store_id: activeStoreId,
        p_accepted_payment_methods:
          normalizedPaymentSettings.value.acceptedPaymentMethods,
        p_pix_key_type: normalizedPaymentSettings.value.pixKeyType,
        p_pix_key: normalizedPaymentSettings.value.pixKey,
        p_pix_holder_name: normalizedPaymentSettings.value.pixHolderName,
        p_down_payment_mode: normalizedPaymentSettings.value.downPaymentMode,
        p_down_payment_value_type:
          normalizedPaymentSettings.value.downPaymentValueType,
        p_down_payment_percent:
          normalizedPaymentSettings.value.downPaymentPercent,
        p_down_payment_amount_cents:
          normalizedPaymentSettings.value.downPaymentAmountCents,
        p_installments_enabled:
          normalizedPaymentSettings.value.installmentsEnabled,
        p_max_installments: normalizedPaymentSettings.value.maxInstallments,
        p_installment_interest_policy:
          normalizedPaymentSettings.value.installmentInterestPolicy,
        p_payment_notes: normalizedPaymentSettings.value.paymentNotes,
      });

    if (paymentSettingsError) {
      setErrorText("Falha ao sincronizar as configuracoes canonicas de pagamento.");
      setSuccessText(null);
      return;
    }

    setPaymentSettings((savedPaymentSettings ?? null) as StorePaymentSettingsRow | null);

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
        accepted_payment_methods_summary: derivedPaymentSummary,

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
  }, [activeStoreId, commercialDraft, organizationId, upsertConfigAnswers]);



  useEffect(() => {
    setDiscountDraft(
      createDiscountDraftFromAnswers(
        answers,
        discountSettings,
        highValueDiscountSettings,
      ),
    );
  }, [answers, discountSettings, highValueDiscountSettings]);

  const handleDiscountDraftChange = useCallback((
    key: keyof DiscountDraftState,
    value: string | boolean,
  ) => {
    setDiscountDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const handleDiscountEditCancel = useCallback(() => {
    setDiscountDraft(
      createDiscountDraftFromAnswers(
        answers,
        discountSettings,
        highValueDiscountSettings,
      ),
    );
    setIsDiscountEditing(false);
  }, [answers, discountSettings, highValueDiscountSettings]);

  const handleDiscountEditSave = useCallback(async () => {
    if (!organizationId || !activeStoreId) return;

    const normalizedDiscountSettings = normalizeStoreDiscountSettingsInput({
      defaultDiscountPercent: discountDraft.default_discount_percent,
      maxDiscountPercent: discountDraft.max_discount_percent,
      allowAskAboveMaxDiscount: discountDraft.allow_ask_above_max_discount,
      discountAutonomyMode: discountDraft.discount_autonomy_mode,
      highValueEnabled: discountDraft.high_value_enabled,
      highValueThresholdAmount: discountDraft.high_value_threshold_amount,
      highValueDiscountPercent: discountDraft.high_value_discount_percent,
    });

    if (!normalizedDiscountSettings.ok) {
      setErrorText(normalizedDiscountSettings.error);
      setSuccessText(null);
      return;
    }

    const { data: savedDiscountSettings, error: discountSettingsError } =
      await supabase.rpc("upsert_store_discount_settings_with_legacy_mirror_scoped", {
        p_organization_id: organizationId,
        p_store_id: activeStoreId,
        p_default_discount_percent:
          normalizedDiscountSettings.value.defaultDiscountPercent,
        p_max_discount_percent: normalizedDiscountSettings.value.maxDiscountPercent,
        p_allow_ask_above_max_discount:
          normalizedDiscountSettings.value.allowAskAboveMaxDiscount,
        p_discount_autonomy_mode:
          normalizedDiscountSettings.value.discountAutonomyMode,
      });

    if (discountSettingsError) {
      setErrorText("Falha ao sincronizar as configuracoes canonicas de desconto.");
      setSuccessText(null);
      return;
    }

    const { data: savedHighValueDiscountSettings, error: highValueDiscountSettingsError } =
      await supabase.rpc("upsert_store_high_value_discount_settings_scoped", {
        p_organization_id: organizationId,
        p_store_id: activeStoreId,
        p_enabled: normalizedDiscountSettings.value.highValueEnabled,
        p_threshold_amount_cents:
          normalizedDiscountSettings.value.highValueThresholdAmountCents,
        p_discount_percent:
          normalizedDiscountSettings.value.highValueDiscountPercent,
      });

    if (highValueDiscountSettingsError) {
      setErrorText("Falha ao sincronizar a politica canonica de alto valor.");
      setSuccessText(null);
      return;
    }

    setDiscountSettings(
      (savedDiscountSettings ?? null) as StoreDiscountSettingsRow | null,
    );
    setHighValueDiscountSettings(
      (savedHighValueDiscountSettings ?? null) as StoreHighValueDiscountSettingsRow | null,
    );

    const saved = await upsertConfigAnswers(
      {
        human_help_discount_cases: discountDraft.human_help_discount_summary,
        discount_approver_name: discountDraft.discount_approver,
        discount_special_rules: discountDraft.special_discount_rules,
        discount_explanation: discountDraft.discount_explanation,
      },
      "Alterações de descontos salvas com sucesso."
    );

    if (!saved) return;

    setIsDiscountEditing(false);
  }, [activeStoreId, discountDraft, organizationId, upsertConfigAnswers]);

  useEffect(() => {
    setChannelDraft(createChannelDraftFromSources(answers, channelSettings));
  }, [answers, channelSettings]);

  const handleChannelDraftChange = useCallback((key: keyof ChannelDraftState, value: string) => {
    setChannelDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const handleChannelsEditCancel = useCallback(() => {
    setChannelDraft(createChannelDraftFromSources(answers, channelSettings));
    setShowChannelsAdvanced(false);
    setIsChannelsEditing(false);
  }, [answers, channelSettings]);

  const handleChannelsEditSave = useCallback(async () => {
    const normalizedChannelSettings = normalizeStoreChannelSettingsInput({
      commercialChannelName: channelDraft.commercial_channel_name,
      commercialReceivesRealClients:
        channelDraft.commercial_receives_real_clients,
      commercialIsOfficialSalesChannel:
        channelDraft.commercial_is_official_sales_channel,
      commercialChannelType: channelDraft.commercial_channel_type,
      commercialEntryPriority: channelDraft.commercial_entry_priority,
      commercialHumanHandoffEnabled:
        channelDraft.commercial_human_handoff_enabled,
      commercialChannelNotes: channelDraft.commercial_channel_notes,
      integrationProviderName: channelDraft.integration_provider_name,
      integrationConnectionMode: channelDraft.integration_connection_mode,
      integrationsNotes: channelDraft.integrations_notes,
    });

    if (!normalizedChannelSettings.ok) {
      setErrorText(normalizedChannelSettings.error);
      setSuccessText(null);
      return;
    }

    if (!organizationId || !activeStoreId) {
      setErrorText("Nenhuma loja ativa foi encontrada para salvar essas alteraÃ§Ãµes.");
      setSuccessText(null);
      return;
    }

    const { data: savedChannelSettings, error: channelSettingsError } =
      await supabase.rpc(
        "upsert_store_channel_settings_with_legacy_mirror_scoped",
        {
          p_organization_id: organizationId,
          p_store_id: activeStoreId,
          p_commercial_channel_name:
            normalizedChannelSettings.value.commercialChannelName,
          p_commercial_receives_real_clients:
            normalizedChannelSettings.value.commercialReceivesRealClients,
          p_commercial_is_official_sales_channel:
            normalizedChannelSettings.value
              .commercialIsOfficialSalesChannel,
          p_commercial_channel_type:
            normalizedChannelSettings.value.commercialChannelType,
          p_commercial_entry_priority:
            normalizedChannelSettings.value.commercialEntryPriority,
          p_commercial_human_handoff_enabled:
            normalizedChannelSettings.value.commercialHumanHandoffEnabled,
          p_commercial_channel_notes:
            normalizedChannelSettings.value.commercialChannelNotes,
          p_integration_provider_name:
            normalizedChannelSettings.value.integrationProviderName,
          p_integration_connection_mode:
            normalizedChannelSettings.value.integrationConnectionMode,
          p_integrations_notes:
            normalizedChannelSettings.value.integrationsNotes,
        }
      );

    if (channelSettingsError) {
      setErrorText(
        channelSettingsError.message ||
          "Erro ao salvar a configuraÃ§Ã£o canÃ´nica de canais."
      );
      setSuccessText(null);
      return;
    }

    setChannelSettings(
      (savedChannelSettings ?? null) as StoreChannelSettingsRow | null
    );
    setErrorText(null);
    setSuccessText("Alterações de canais e integrações salvas com sucesso.");

    setShowChannelsAdvanced(false);
    setIsChannelsEditing(false);
  }, [activeStoreId, channelDraft, organizationId]);

  const storeWhatsappStatusMetrics = useMemo(
    () => [
      {
        label: "Status",
        value: storeWhatsappVisualStatus.label,
        tone: storeWhatsappVisualStatus.tone,
        hint:
          cleanText(storeWhatsappStatus?.status) ||
          (storeWhatsappStatus?.connected ? "Integracao operacional ativa." : "Integracao ainda nao conectada."),
      },
      {
        label: "Numero conectado",
        value: connectedCommercialWhatsapp || "Nao informado",
        tone: connectedCommercialWhatsapp ? "green" as const : "gray" as const,
        hint:
          cleanText(storeWhatsappStatus?.phoneNumberId)
            ? `Phone Number ID: ${cleanText(storeWhatsappStatus?.phoneNumberId)}`
            : "O numero tecnico ainda nao foi vinculado nesta loja.",
      },
      {
        label: "Ultima mensagem recebida",
        value: formatImportDate(storeWhatsappStatus?.lastInboundAt),
        tone: cleanText(storeWhatsappStatus?.lastInboundAt) ? "green" as const : "gray" as const,
        hint: "Ultimo evento recebido pela inbox do WhatsApp.",
      },
      {
        label: "Ultima mensagem enviada",
        value: formatImportDate(storeWhatsappStatus?.lastOutboundAt),
        tone: cleanText(storeWhatsappStatus?.lastOutboundAt) ? "green" as const : "gray" as const,
        hint: "Ultimo envio externo registrado para a loja.",
      },
      {
        label: "Pendencias de entrada",
        value: String(storeWhatsappStatus?.pendingInboxCount ?? 0),
        tone:
          Number(storeWhatsappStatus?.pendingInboxCount ?? 0) > 0 ? "amber" as const : "green" as const,
        hint: "Eventos recebidos e ainda nao processados.",
      },
      {
        label: "Pendencias de envio",
        value: String(storeWhatsappStatus?.pendingOutboundCount ?? 0),
        tone:
          Number(storeWhatsappStatus?.pendingOutboundCount ?? 0) > 0 ? "amber" as const : "green" as const,
        hint: "Mensagens prontas para sair no canal real.",
      },
    ],
    [connectedCommercialWhatsapp, storeWhatsappStatus, storeWhatsappVisualStatus]
  );

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
      const stockState = resolveManualStockState({
        rawQuantity: poolForm.stock_quantity,
        trackStock: poolForm.track_stock,
      });

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
        price_status: resolveManualPriceStatus(price),
        description: composedPoolDescription || null,
        stock_quantity: stockState.stockQuantity,
        stock_status: stockState.stockStatus,
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
      const stockState = resolveManualStockState({
        rawQuantity: catalogForm.stock_quantity,
        trackStock: catalogForm.track_stock,
      });
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
        price_status: resolveManualPriceStatusFromCents(
          parsedPrice === null ? null : Math.round(parsedPrice * 100)
        ),
        currency: "BRL",
        is_active: catalogForm.is_active,
        track_stock: catalogForm.track_stock,
        stock_quantity: stockState.stockQuantity,
        stock_status: stockState.stockStatus,
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

  const handleDeleteImportFile = useCallback(
    async (file: StoreImportFileRow) => {
      if (!organizationId || !activeStoreId) {
        setErrorText("Nenhuma loja ativa foi encontrada para excluir o arquivo bruto.");
        setSuccessText(null);
        return;
      }

      if (deletingImportFileId) return;

      const fileName = cleanText(file.original_file_name) || "arquivo bruto";
      const confirmed = window.confirm(
        `Excluir o arquivo bruto "${fileName}"?\n\nIsso remove apenas o arquivo original importado e o vínculo dele com a importação. Nenhum item do catálogo será excluído.`
      );

      if (!confirmed) return;

      const bucket = cleanText(file.storage_bucket);
      const path = cleanText(file.storage_path);

      setDeletingImportFileId(file.id);
      setErrorText(null);
      setSuccessText(null);

      try {
        const { error: deleteLinksError } = await supabase
          .from("store_import_file_items")
          .delete()
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId)
          .eq("import_file_id", file.id);

        if (deleteLinksError) throw deleteLinksError;

        const { error: deleteFileRowError } = await supabase
          .from("store_import_files")
          .delete()
          .eq("id", file.id)
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId);

        if (deleteFileRowError) throw deleteFileRowError;

        if (bucket && path) {
          const { error: storageError } = await supabase.storage.from(bucket).remove([path]);
          if (storageError) throw storageError;
        }

        setPoolImportFiles((prev) => prev.filter((item) => item.id !== file.id));
        setCatalogImportFiles((prev) => prev.filter((item) => item.id !== file.id));
        setSuccessText("Arquivo bruto excluído com sucesso. Os itens do catálogo foram preservados.");
        await fetchPageData();
      } catch (error: any) {
        setErrorText(error?.message ?? "Erro ao excluir o arquivo bruto.");
        setSuccessText(null);
      } finally {
        setDeletingImportFileId(null);
      }
    },
    [organizationId, activeStoreId, deletingImportFileId, fetchPageData]
  );

  const handleStoreLogoFileChange = useCallback((files: FileList | null) => {
    const file = files?.[0] ?? null;

    if (!file) {
      return;
    }

    const allowedMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
    if (!allowedMimeTypes.has(file.type)) {
      setSelectedStoreLogoFile(null);
      setErrorText("Envie uma imagem PNG, JPEG ou WebP para a logo da loja.");
      setSuccessText(null);
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setSelectedStoreLogoFile(null);
      setErrorText("A logo deve ter no maximo 2 MB.");
      setSuccessText(null);
      return;
    }

    setSelectedStoreLogoFile(file);
    setErrorText(null);
    setSuccessText(null);
  }, []);

  const handleSaveStoreLogo = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setErrorText("Nenhuma loja ativa foi encontrada para enviar a logo.");
      setSuccessText(null);
      return;
    }

    if (!selectedStoreLogoFile) {
      setErrorText("Selecione uma imagem antes de enviar a logo.");
      setSuccessText(null);
      return;
    }

    if (savingStoreLogo) {
      return;
    }

    setSavingStoreLogo(true);
    setErrorText(null);
    setSuccessText(null);

    try {
      const formData = new FormData();
      formData.set("storeId", activeStoreId);
      formData.set("file", selectedStoreLogoFile);

      const response = await fetch("/api/store-branding/logo", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as StoreBrandingApiResponse;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.message || "Nao foi possivel salvar a logo.");
      }

      setStoreBranding((result.branding ?? null) as StoreBrandingSettingsRow | null);
      setStoreLogoPreviewUrl(result.signedUrl || null);
      setSelectedStoreLogoFile(null);
      setSuccessText(result.warning ? `Logo salva com sucesso. ${result.warning}` : "Logo salva com sucesso.");
    } catch (error: any) {
      setErrorText(error?.message ?? "Nao foi possivel salvar a logo.");
      setSuccessText(null);
    } finally {
      setSavingStoreLogo(false);
    }
  }, [
    organizationId,
    activeStoreId,
    selectedStoreLogoFile,
    savingStoreLogo,
  ]);

  const handleRemoveStoreLogo = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setErrorText("Nenhuma loja ativa foi encontrada para remover a logo.");
      setSuccessText(null);
      return;
    }

    if (removingStoreLogo) {
      return;
    }

    if (!storeBranding?.id && !cleanText(storeBranding?.logo_storage_path)) {
      setSuccessText("Nenhuma logo enviada ainda.");
      setErrorText(null);
      return;
    }

    const confirmed = window.confirm("Remover a logo atual da loja?");
    if (!confirmed) return;

    setRemovingStoreLogo(true);
    setErrorText(null);
    setSuccessText(null);

    try {
      const response = await fetch("/api/store-branding/logo", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          storeId: activeStoreId,
        }),
      });
      const result = (await response.json()) as StoreBrandingApiResponse;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.message || "Nao foi possivel remover a logo.");
      }

      setStoreBranding((result.branding ?? null) as StoreBrandingSettingsRow | null);
      setStoreLogoPreviewUrl(result.signedUrl || null);
      setSelectedStoreLogoFile(null);
      setSuccessText(result.warning ? `Logo removida. ${result.warning}` : "Logo removida.");
    } catch (error: any) {
      setErrorText(error?.message ?? "Nao foi possivel remover a logo.");
      setSuccessText(null);
    } finally {
      setRemovingStoreLogo(false);
    }
  }, [
    organizationId,
    activeStoreId,
    removingStoreLogo,
    storeBranding?.id,
    storeBranding?.logo_storage_path,
  ]);

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
  void handleDeleteAllCatalog;

  const handleDeleteAllStoreCatalog = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setErrorText("Nao foi possivel identificar a organizacao e a loja ativa com seguranca.");
      setSuccessText(null);
      return;
    }

    if (deletingCatalog) return;

    if (totalCatalogo === 0) {
      setSuccessText("O catalogo da loja ja esta vazio.");
      setErrorText(null);
      return;
    }

    const firstConfirm = window.confirm(
      "Tem certeza que deseja apagar TODO o catalogo desta loja? Isso vai remover piscinas, quimicos, acessorios e outros itens cadastrados."
    );
    if (!firstConfirm) return;

    const secondConfirm = window.confirm(
      "Confirma mais uma vez: apagar todo o catalogo agora? Essa acao remove definitivamente piscinas e itens gerais da loja atual."
    );
    if (!secondConfirm) return;

    setDeletingCatalog(true);
    setErrorText(null);
    setSuccessText(null);

    try {
      const { data: poolsData, error: poolsError } = await supabase
        .from("pools")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("store_id", activeStoreId);

      if (poolsError) throw poolsError;

      const poolIds = ((poolsData || []) as Array<{ id: string }>).map((pool) => pool.id);
      const poolPhotoRows: PoolPhotoRow[] = [];

      for (const ids of chunkArray(poolIds, 200)) {
        if (ids.length === 0) continue;

        const { data: photoChunk, error: poolPhotosError } = await supabase
          .from("pool_photos")
          .select("id, pool_id, storage_path")
          .in("pool_id", ids);

        if (poolPhotosError) throw poolPhotosError;
        poolPhotoRows.push(...((photoChunk || []) as PoolPhotoRow[]));
      }

      const poolStoragePaths = poolPhotoRows
        .map((row) => String(row.storage_path || "").trim())
        .filter(Boolean);

      for (const paths of chunkArray(poolStoragePaths, 100)) {
        if (paths.length === 0) continue;

        const { error: storageRemoveError } = await supabase.storage
          .from("pool-photos")
          .remove(paths);

        if (storageRemoveError) throw storageRemoveError;
      }

      for (const ids of chunkArray(poolPhotoRows.map((row) => row.id), 200)) {
        if (ids.length === 0) continue;

        const { error: deletePoolPhotosError } = await supabase
          .from("pool_photos")
          .delete()
          .in("id", ids);

        if (deletePoolPhotosError) throw deletePoolPhotosError;
      }

      for (const ids of chunkArray(poolIds, 200)) {
        if (ids.length === 0) continue;

        const { error: deletePoolsError } = await supabase
          .from("pools")
          .delete()
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId)
          .in("id", ids);

        if (deletePoolsError) throw deletePoolsError;
      }

      const { data: catalogItems, error: catalogItemsError } = await supabase
        .from("store_catalog_items")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("store_id", activeStoreId);

      if (catalogItemsError) throw catalogItemsError;

      const catalogItemIds = ((catalogItems || []) as Array<{ id: string }>).map(
        (item) => item.id
      );

      const photoRows: CatalogPhotoRow[] = [];
      for (const ids of chunkArray(catalogItemIds, 200)) {
        if (ids.length === 0) continue;

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

      for (const paths of chunkArray(storagePaths, 100)) {
        if (paths.length === 0) continue;

        const { error: storageRemoveError } = await supabase.storage
          .from("store-catalog-photos")
          .remove(paths);

        if (storageRemoveError) throw storageRemoveError;
      }

      for (const ids of chunkArray(photoRows.map((row) => row.id), 200)) {
        if (ids.length === 0) continue;

        const { error: deletePhotosError } = await supabase
          .from("store_catalog_item_photos")
          .delete()
          .in("id", ids);

        if (deletePhotosError) throw deletePhotosError;
      }

      for (const ids of chunkArray(catalogItemIds, 200)) {
        if (ids.length === 0) continue;

        const { error: deleteItemsError } = await supabase
          .from("store_catalog_items")
          .delete()
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId)
          .in("id", ids);

        if (deleteItemsError) throw deleteItemsError;
      }

      setSuccessText("Todo o catalogo da loja foi apagado com sucesso, incluindo piscinas e itens gerais.");
      await fetchPageData();
    } catch (error: any) {
      setErrorText(error?.message ?? "Erro ao apagar todo o catalogo da loja.");
      setSuccessText(null);
    } finally {
      setDeletingCatalog(false);
    }
  }, [organizationId, activeStoreId, deletingCatalog, totalCatalogo, fetchPageData]);

  const rawImportFilesModalFiles = rawImportFilesModalTab === "pools" ? poolImportFiles : catalogImportFiles;
  const rawImportFilesModalTitle =
    rawImportFilesModalTab === "pools"
      ? "Arquivos brutos de piscinas"
      : "Arquivos brutos de produtos e acessórios";
  const rawImportFilesModalEmptyText =
    rawImportFilesModalTab === "pools"
      ? "Nenhum arquivo bruto importado foi encontrado para piscinas ainda."
      : "Nenhum arquivo bruto importado foi encontrado para produtos e acessórios ainda.";
  const catalogImportedFiles = useMemo(() => {
    return [...poolImportFiles, ...catalogImportFiles].sort((left, right) => {
      const leftTime = left.created_at ? new Date(left.created_at).getTime() : 0;
      const rightTime = right.created_at ? new Date(right.created_at).getTime() : 0;
      return rightTime - leftTime;
    });
  }, [poolImportFiles, catalogImportFiles]);
  const resetManualCatalogItemModalForm = useCallback(() => {
    setPoolForm(createEmptyPoolForm());
    setPoolPhotos([]);
    setCatalogForm(createEmptyCatalogForm());
    setCatalogPhotos([]);
    setManualCatalogItemModalError(null);
    setManualCatalogItemModalSuccess(null);
  }, []);
  const closeManualCatalogItemModal = useCallback(() => {
    resetManualCatalogItemModalForm();
    setManualCatalogItemCategory("piscina");
    setIsManualCatalogItemModalOpen(false);
  }, [resetManualCatalogItemModalForm]);
  const handleManualCatalogItemCategoryChange = useCallback(
    (value: "piscina" | "quimicos" | "acessorios" | "outros") => {
      setManualCatalogItemCategory(value);
      setManualCatalogItemModalError(null);
      setManualCatalogItemModalSuccess(null);

      if (value !== "piscina") {
        setCatalogForm((current) => ({
          ...current,
          category: value,
        }));
      }
    },
    []
  );
  const handleManualCatalogPoolPhotosChange = useCallback((fileList: FileList | null) => {
    const selectedFiles = Array.from(fileList || []);
    const validationError = validateSelectedPhotos(selectedFiles);
    if (validationError) {
      setManualCatalogItemModalError(validationError);
      setManualCatalogItemModalSuccess(null);
      return;
    }

    setPoolPhotos(selectedFiles);
    setManualCatalogItemModalError(null);
    setManualCatalogItemModalSuccess(null);
  }, []);
  const handleManualCatalogGeneralPhotosChange = useCallback((fileList: FileList | null) => {
    const selectedFiles = Array.from(fileList || []);
    const validationError = validateSelectedPhotos(selectedFiles);
    if (validationError) {
      setManualCatalogItemModalError(validationError);
      setManualCatalogItemModalSuccess(null);
      return;
    }

    setCatalogPhotos(selectedFiles);
    setManualCatalogItemModalError(null);
    setManualCatalogItemModalSuccess(null);
  }, []);
  const handleManualCatalogItemVisualSave = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setManualCatalogItemModalError("Nenhuma loja ativa foi encontrada para salvar este item.");
      setManualCatalogItemModalSuccess(null);
      return;
    }

    const parseIntegerField = (value: string) => {
      const normalized = cleanText(value).replace(/\s+/g, "");
      if (!normalized) return null;
      if (!/^-?\d+$/.test(normalized)) return Number.NaN;
      return Number(normalized);
    };

    if (manualCatalogItemCategory === "piscina") {
      const poolName = cleanText(poolForm.name);
      const widthInput = cleanText(poolForm.width_m);
      const lengthInput = cleanText(poolForm.length_m);
      const depthInput = cleanText(poolForm.depth_m);
      const priceInput = cleanText(poolForm.price);
      const widthM = parseNumberInput(poolForm.width_m);
      const lengthM = parseNumberInput(poolForm.length_m);
      const depthM = parseNumberInput(poolForm.depth_m);
      const price = parseNumberInput(poolForm.price);
      const stockValue = parseIntegerField(poolForm.stock_quantity);
      const poolPhotosError = validateSelectedPhotos(poolPhotos);

      if (!poolName) {
        setManualCatalogItemModalError("Preencha o nome da piscina para continuar.");
        setManualCatalogItemModalSuccess(null);
        return;
      }

      if (widthM === null || lengthM === null || depthM === null) {
        setManualCatalogItemModalError(
          "Preencha largura, comprimento e profundidade da piscina antes de salvar."
        );
        setManualCatalogItemModalSuccess(null);
        return;
      }

      if (widthInput && widthM === null) {
        setManualCatalogItemModalError("Preencha uma largura válida em metros.");
        setManualCatalogItemModalSuccess(null);
        return;
      }

      if (lengthInput && lengthM === null) {
        setManualCatalogItemModalError("Preencha um comprimento válido em metros.");
        setManualCatalogItemModalSuccess(null);
        return;
      }

      if (depthInput && depthM === null) {
        setManualCatalogItemModalError("Preencha uma profundidade válida em metros.");
        setManualCatalogItemModalSuccess(null);
        return;
      }

      if (priceInput && price === null) {
        setManualCatalogItemModalError("Preencha um preço numérico válido.");
        setManualCatalogItemModalSuccess(null);
        return;
      }

      if (Number.isNaN(stockValue)) {
        setManualCatalogItemModalError("Preencha um estoque inteiro válido.");
        setManualCatalogItemModalSuccess(null);
        return;
      }

      if (poolPhotosError) {
        setManualCatalogItemModalError(poolPhotosError);
        setManualCatalogItemModalSuccess(null);
        return;
      }

      setSavingPool(true);
      setManualCatalogItemModalError(null);
      setManualCatalogItemModalSuccess(null);

      try {
        const { data: existingPool, error: existingPoolError } = await supabase
          .from("pools")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId)
          .eq("name", poolName)
          .limit(1)
          .maybeSingle();

        if (existingPoolError) throw existingPoolError;

        if (existingPool?.id) {
          setManualCatalogItemModalError("Já existe uma piscina com esse nome nesta loja.");
          setManualCatalogItemModalSuccess(null);
          return;
        }

        const composedPoolDescription = buildPoolManualDescription(poolForm);
        const maxCapacityL =
          widthM !== null && lengthM !== null && depthM !== null
            ? Math.max(1, Math.round(widthM * lengthM * depthM * 1000))
            : null;
        const stockState = resolveManualStockState({
          rawQuantity: poolForm.stock_quantity,
          trackStock: poolForm.track_stock,
        });

        const { data: createdPool, error: insertError } = await supabase
          .from("pools")
          .insert({
            organization_id: organizationId,
            store_id: activeStoreId,
            name: poolName,
            width_m: widthM,
            length_m: lengthM,
            depth_m: depthM,
            shape: cleanText(poolForm.shape) || null,
            material: cleanText(poolForm.material) || null,
            max_capacity_l: maxCapacityL,
            weight_kg: null,
            price,
            price_status: resolveManualPriceStatus(price),
            description: composedPoolDescription || null,
            stock_quantity: stockState.stockQuantity,
            stock_status: stockState.stockStatus,
            is_active: poolForm.is_active,
            track_stock: poolForm.track_stock,
          })
          .select("id")
          .single();

        if (insertError) throw insertError;

        const createdPoolId = cleanText(createdPool?.id);
        if (!createdPoolId) {
          throw new Error("Não foi possível obter o ID da piscina criada.");
        }

        let photoUploadFailed = false;

        for (const [index, file] of poolPhotos.entries()) {
          const safeFileName = `${Date.now()}-${index}-${file.name.replace(/\s+/g, "-")}`;
          const storagePath = `${organizationId}/${activeStoreId}/${createdPoolId}/${safeFileName}`;

          try {
            const { error: uploadError } = await supabase.storage
              .from("pool-photos")
              .upload(storagePath, file, {
                cacheControl: "3600",
                upsert: false,
              });

            if (uploadError) throw uploadError;

            const { error: metadataError } = await supabase.from("pool_photos").insert({
              pool_id: createdPoolId,
              organization_id: organizationId,
              store_id: activeStoreId,
              storage_path: storagePath,
              file_name: file.name,
              file_size_bytes: file.size,
              sort_order: index,
            });

            if (metadataError) {
              await supabase.storage.from("pool-photos").remove([storagePath]);
              throw metadataError;
            }
          } catch {
            photoUploadFailed = true;
          }
        }

        setPoolForm(createEmptyPoolForm());
        setPoolPhotos([]);
        setManualCatalogItemModalError(null);
        setManualCatalogItemModalSuccess(
          photoUploadFailed
            ? "Piscina salva, mas uma ou mais fotos não foram enviadas."
            : "Piscina salva com sucesso."
        );
        await fetchPageData();
        return;
      } catch (error: any) {
        setManualCatalogItemModalError(error?.message ?? "Erro ao salvar a piscina manualmente.");
        setManualCatalogItemModalSuccess(null);
        return;
      } finally {
        setSavingPool(false);
      }
    }

    const itemName = cleanText(catalogForm.name);
    const priceInput = cleanText(catalogForm.price);
    const price = parseNumberInput(catalogForm.price);
    const stockValue = parseIntegerField(catalogForm.stock_quantity);
    const widthInput = cleanText(catalogForm.width_cm);
    const heightInput = cleanText(catalogForm.height_cm);
    const lengthInput = cleanText(catalogForm.length_cm);
    const weightInput = cleanText(catalogForm.weight_kg);
    const widthCm = parseNumberInput(catalogForm.width_cm);
    const heightCm = parseNumberInput(catalogForm.height_cm);
    const lengthCm = parseNumberInput(catalogForm.length_cm);
    const weightKg = parseNumberInput(catalogForm.weight_kg);
    const catalogPhotosError = validateSelectedPhotos(catalogPhotos);
    const sku = cleanText(catalogForm.sku) || null;

    if (!itemName) {
      setManualCatalogItemModalError("Preencha o nome do item para continuar.");
      setManualCatalogItemModalSuccess(null);
      return;
    }

    if (priceInput && price === null) {
      setManualCatalogItemModalError("Preencha um preço numérico válido.");
      setManualCatalogItemModalSuccess(null);
      return;
    }

    if (Number.isNaN(stockValue)) {
      setManualCatalogItemModalError("Preencha um estoque inteiro válido.");
      setManualCatalogItemModalSuccess(null);
      return;
    }

    if (widthInput && widthCm === null) {
      setManualCatalogItemModalError("Preencha uma largura válida em centímetros.");
      setManualCatalogItemModalSuccess(null);
      return;
    }

    if (heightInput && heightCm === null) {
      setManualCatalogItemModalError("Preencha uma altura válida em centímetros.");
      setManualCatalogItemModalSuccess(null);
      return;
    }

    if (lengthInput && lengthCm === null) {
      setManualCatalogItemModalError("Preencha um comprimento válido em centímetros.");
      setManualCatalogItemModalSuccess(null);
      return;
    }

    if (weightInput && weightKg === null) {
      setManualCatalogItemModalError("Preencha um peso válido em quilos.");
      setManualCatalogItemModalSuccess(null);
      return;
    }

    if (catalogPhotosError) {
      setManualCatalogItemModalError(catalogPhotosError);
      setManualCatalogItemModalSuccess(null);
      return;
    }

    setSavingCatalogItem(true);
    setManualCatalogItemModalError(null);
    setManualCatalogItemModalSuccess(null);

    try {
      const { data: existingItems, error: existingItemsError } = await supabase
        .from("store_catalog_items")
        .select("id, name, sku, metadata")
        .eq("organization_id", organizationId)
        .eq("store_id", activeStoreId);

      if (existingItemsError) throw existingItemsError;

      const normalizedItemName = normalizeManualDuplicateText(itemName);
      const normalizedSku = normalizeManualDuplicateText(sku);
      const existingItemsList = (existingItems || []) as Array<{
        id: string;
        name: string | null;
        sku: string | null;
        metadata?: Record<string, unknown> | null;
      }>;

      const hasDuplicateName = existingItemsList.some(
        (existingItem) => normalizeManualDuplicateText(existingItem.name) === normalizedItemName
      );

      if (hasDuplicateName) {
        setManualCatalogItemModalError("Já existe um item com esse nome nesta loja.");
        setManualCatalogItemModalSuccess(null);
        return;
      }

      if (normalizedSku) {
        const hasDuplicateSku = existingItemsList.some(
          (existingItem) => normalizeManualDuplicateText(existingItem.sku) === normalizedSku
        );

        if (hasDuplicateSku) {
          setManualCatalogItemModalError("Já existe um item com esse SKU nesta loja.");
          setManualCatalogItemModalSuccess(null);
          return;
        }
      }

      const stockState = resolveManualStockState({
        rawQuantity: catalogForm.stock_quantity,
        trackStock: catalogForm.track_stock,
      });
      const metadataPayload = {
        categoria: manualCatalogItemCategory,
        brand: cleanText(catalogForm.brand) || null,
        line: cleanText(catalogForm.line) || null,
        unit_label: cleanText(catalogForm.unit_label) || null,
        size_details: cleanText(catalogForm.size_details) || null,
        width_cm: widthCm,
        height_cm: heightCm,
        length_cm: lengthCm,
        weight_kg: weightKg,
        application: cleanText(catalogForm.application) || null,
        technical_notes: cleanText(catalogForm.technical_notes) || null,
        manual_created_in_configuracoes: true,
        pending_photo_upload_count: 0,
      };

      const { data: createdItem, error: insertError } = await supabase
        .from("store_catalog_items")
        .insert({
          organization_id: organizationId,
          store_id: activeStoreId,
          sku,
          name: itemName,
          description: cleanText(catalogForm.description) || null,
          price_cents: price === null ? null : Math.round(price * 100),
          price_status: resolveManualPriceStatusFromCents(
            price === null ? null : Math.round(price * 100)
          ),
          currency: "BRL",
          is_active: catalogForm.is_active,
          track_stock: catalogForm.track_stock,
          stock_quantity: stockState.stockQuantity,
          stock_status: stockState.stockStatus,
          metadata: metadataPayload,
        })
        .select("id")
        .single();

      if (insertError) throw insertError;

      const createdCatalogItemId = cleanText(createdItem?.id);
      if (!createdCatalogItemId) {
        throw new Error("Não foi possível obter o ID do item criado.");
      }

      let photoUploadFailed = false;

      for (const [index, file] of catalogPhotos.entries()) {
        const extension = file.name.split(".").pop() || "jpg";
        const safeFileName = `${Date.now()}-${index}-${crypto.randomUUID()}.${extension}`;
        const storagePath = `${organizationId}/${activeStoreId}/${createdCatalogItemId}/${safeFileName}`;

        try {
          const { error: uploadError } = await supabase.storage
            .from("store-catalog-photos")
            .upload(storagePath, file, {
              cacheControl: "3600",
              upsert: false,
            });

          if (uploadError) throw uploadError;

          const { error: metadataError } = await supabase
            .from("store_catalog_item_photos")
            .insert({
              catalog_item_id: createdCatalogItemId,
              storage_path: storagePath,
              file_name: file.name,
              file_size_bytes: file.size,
              sort_order: index,
            });

          if (metadataError) {
            await supabase.storage.from("store-catalog-photos").remove([storagePath]);
            throw metadataError;
          }
        } catch {
          photoUploadFailed = true;
        }
      }

      setCatalogForm({
        ...createEmptyCatalogForm(),
        category: manualCatalogItemCategory,
      });
      setCatalogPhotos([]);
      setManualCatalogItemModalError(null);
      setManualCatalogItemModalSuccess(
        photoUploadFailed
          ? "Item salvo, mas uma ou mais fotos não foram enviadas."
          : "Item salvo com sucesso."
      );
      await fetchPageData();
    } catch (error: any) {
      setManualCatalogItemModalError(error?.message ?? "Erro ao salvar o item manualmente.");
      setManualCatalogItemModalSuccess(null);
    } finally {
      setSavingCatalogItem(false);
    }
  }, [
    activeStoreId,
    catalogForm,
    catalogPhotos,
    fetchPageData,
    manualCatalogItemCategory,
    organizationId,
    poolForm,
    poolPhotos,
  ]);

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

      {activeTab === "catalogo" ? (
        <div className="space-y-4 overflow-x-hidden">
          <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
            <button
              type="button"
              onClick={() => {
                setManualCatalogItemModalError(null);
                setManualCatalogItemModalSuccess(null);
                setIsManualCatalogItemModalOpen(true);
              }}
              className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Adicionar item manualmente
            </button>
          </div>

          <SectionBlock
            title="Upload inteligente"
            description="Envie arquivos para importar catálogo, piscinas e materiais da loja usando o fluxo já existente."
          >
            <IntelligentCatalogImportPanel
              organizationId={organizationId}
              storeId={activeStoreId}
              storageKey={intelligentImportStorageKey}
              source="configuracoes_intelligent_import"
              disabled={!hasValidStoreContext}
              supabaseClient={supabase}
              onError={(message) => {
                setErrorText(message);
                if (message) setSuccessText(null);
              }}
              onSuccess={(message) => {
                setSuccessText(message);
                if (message) setErrorText(null);
              }}
              onSaved={async () => {
                await fetchPageData();
              }}
            />
          </SectionBlock>

          <SectionBlock
            title="Arquivos importados"
            description="Veja os arquivos enviados para importação do catálogo e remova arquivos individuais quando necessário."
          >
            <details className="group rounded-2xl border border-gray-200 bg-gray-50">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Arquivos importados</div>
                  <div className="mt-1 text-xs text-gray-600">
                    {catalogImportedFiles.length > 0
                      ? `${catalogImportedFiles.length} arquivo(s) disponível(is) para consulta`
                      : "Nenhum arquivo importado disponível no momento"}
                  </div>
                </div>
                <span className="text-xs font-semibold text-gray-500 transition group-open:rotate-180">▼</span>
              </summary>

              <div className="border-t border-gray-200 px-4 py-4">
                {catalogImportedFiles.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-4 text-sm text-gray-600">
                    Nenhum arquivo importado foi encontrado para esta loja ainda.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {catalogImportedFiles.map((file, index) => (
                      <div
                        key={buildImportFileKey(file, index)}
                        className="rounded-2xl border border-gray-200 bg-white p-3"
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div className="min-w-0">
                            <div className="break-words text-sm font-semibold text-gray-900">
                              {cleanText(file.original_file_name) || "Arquivo sem nome"}
                            </div>
                            <div className="mt-1 text-xs text-gray-500">
                              Importado em {formatImportDate(file.created_at)}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-gray-600">
                              <span className="rounded-full bg-gray-50 px-2 py-1 ring-1 ring-gray-200">
                                Tipo: {cleanText(file.extension)?.toUpperCase() || cleanText(file.mime_type) || "Não definido"}
                              </span>
                              <span className="rounded-full bg-gray-50 px-2 py-1 ring-1 ring-gray-200">
                                Tamanho: {formatFileSize(file.size_bytes)}
                              </span>
                              <span className="rounded-full bg-gray-50 px-2 py-1 ring-1 ring-gray-200">
                                Status: {cleanText(file.status) || "Não definido"}
                              </span>
                              <span className="rounded-full bg-gray-50 px-2 py-1 ring-1 ring-gray-200">
                                {getImportSummaryText(file.import_summary || null)}
                              </span>
                            </div>
                          </div>

                          <div className="flex shrink-0 flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void handleDownloadImportFile(file)}
                              disabled={
                                downloadingImportFileId === file.id ||
                                deletingImportFileId === file.id
                              }
                              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-800 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {downloadingImportFileId === file.id ? "Gerando..." : "Baixar"}
                            </button>

                            <button
                              type="button"
                              onClick={() => void handleDeleteImportFile(file)}
                              disabled={deletingImportFileId === file.id}
                              className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {deletingImportFileId === file.id ? "Excluindo..." : "Excluir"}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </details>
          </SectionBlock>
        </div>
      ) : null}

      {activeTab === "visao-geral" ? (
        <SectionBlock title="Controle da configuração">
          <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_220px_220px]">
            <div className="flex items-start">
              <button
                type="button"
                onClick={() => void handleDeleteAllStoreCatalog()}
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
                          value={strategyDraft.serviceRegions}
                          onChange={(event) => handleStrategyDraftChange("serviceRegions", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Cobertura principal</span>
                        <select
                          value={strategyDraft.serviceRegionPrimaryMode}
                          onChange={(event) =>
                            handleStrategyDraftChange("serviceRegionPrimaryMode", event.target.value)
                          }
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        >
                          <option value="">Selecione</option>
                          {SERVICE_REGION_MODE_OPTIONS.filter((option) => option.value !== "sob_consulta").map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Fora da rota</span>
                        <button
                          type="button"
                          onClick={() =>
                            handleStrategyDraftChange(
                              "serviceRegionOutsideConsultation",
                              !strategyDraft.serviceRegionOutsideConsultation
                            )
                          }
                          className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-sm transition ${
                            strategyDraft.serviceRegionOutsideConsultation
                              ? "border-black bg-black text-white"
                              : "border-gray-200 bg-white text-gray-800 hover:bg-gray-50"
                          }`}
                        >
                          <span>Atende fora da rota somente sob consulta</span>
                          <span>{strategyDraft.serviceRegionOutsideConsultation ? "Sim" : "Nao"}</span>
                        </button>
                      </label>

                      <div className="space-y-2 md:col-span-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Modos adicionais de cobertura</span>
                        <div className="flex flex-wrap gap-2">
                          {SERVICE_REGION_MODE_OPTIONS.filter((option) => option.value !== "sob_consulta").map((option) => {
                            const isSelected =
                              strategyDraft.serviceRegionModes.includes(option.value) ||
                              strategyDraft.serviceRegionPrimaryMode === option.value;
                            return (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => handleStrategyMultiValueToggle("serviceRegionModes", option.value)}
                                className={`rounded-full border px-3 py-1 text-sm transition ${
                                  isSelected
                                    ? "border-black bg-black text-white"
                                    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                                }`}
                              >
                                {option.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <label className="space-y-1 md:col-span-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Observações sobre cobertura</span>
                        <textarea
                          value={strategyDraft.serviceRegionNotes}
                          onChange={(event) => handleStrategyDraftChange("serviceRegionNotes", event.target.value)}
                          rows={3}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-gray-200 bg-white p-4">
                    <div className="mb-3 text-sm font-semibold text-gray-900">2. Serviços que a loja oferece</div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2 md:col-span-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Serviços principais</span>
                        <div className="flex flex-wrap gap-2">
                          {STORE_SERVICE_OPTIONS.map((option) => {
                            const isSelected = strategyDraft.storeServices.includes(option.value);
                            return (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => handleStrategyMultiValueToggle("storeServices", option.value)}
                                className={`rounded-full border px-3 py-1 text-sm transition ${
                                  isSelected
                                    ? "border-black bg-black text-white"
                                    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                                }`}
                              >
                                {option.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Outros serviços</span>
                        <input
                          value={strategyDraft.storeServicesOther}
                          onChange={(event) => handleStrategyDraftChange("storeServicesOther", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Serviços que não faz</span>
                        <input
                          value={strategyDraft.strategyServiceExclusions}
                          onChange={(event) => handleStrategyDraftChange("strategyServiceExclusions", event.target.value)}
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
                          value={strategyDraft.storeDescription}
                          onChange={(event) => handleStrategyDraftChange("storeDescription", event.target.value)}
                          rows={3}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Principal foco da loja</span>
                        <input
                          value={strategyDraft.strategyPrimaryFocus}
                          onChange={(event) => handleStrategyDraftChange("strategyPrimaryFocus", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">O que quer vender mais</span>
                        <input
                          value={strategyDraft.strategySellMore}
                          onChange={(event) => handleStrategyDraftChange("strategySellMore", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Tipo de cliente mais comum</span>
                        <input
                          value={strategyDraft.strategyCommonCustomer}
                          onChange={(event) => handleStrategyDraftChange("strategyCommonCustomer", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Tipo de cliente ideal</span>
                        <input
                          value={strategyDraft.strategyIdealCustomer}
                          onChange={(event) => handleStrategyDraftChange("strategyIdealCustomer", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Faixa de ticket mais comum</span>
                        <input
                          value={strategyDraft.strategyTicketRange}
                          onChange={(event) => handleStrategyDraftChange("strategyTicketRange", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Posicionamento comercial</span>
                        <input
                          value={strategyDraft.strategyPositioning}
                          onChange={(event) => handleStrategyDraftChange("strategyPositioning", event.target.value)}
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
                          value={strategyDraft.mainStoreBrand}
                          onChange={(event) => handleStrategyDraftChange("mainStoreBrand", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Outras marcas</span>
                        <input
                          value={strategyDraft.brandsWorked}
                          onChange={(event) => handleStrategyDraftChange("brandsWorked", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Marcas que prefere priorizar</span>
                        <input
                          value={strategyDraft.strategyPriorityBrands}
                          onChange={(event) => handleStrategyDraftChange("strategyPriorityBrands", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Marcas ou linhas que não trabalha</span>
                        <input
                          value={strategyDraft.strategyNonWorkedBrands}
                          onChange={(event) => handleStrategyDraftChange("strategyNonWorkedBrands", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Linhas principais vendidas</span>
                        <input
                          value={strategyDraft.strategyTopLines}
                          onChange={(event) => handleStrategyDraftChange("strategyTopLines", event.target.value)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Produtos com maior giro</span>
                        <input
                          value={strategyDraft.strategyTopProducts}
                          onChange={(event) => handleStrategyDraftChange("strategyTopProducts", event.target.value)}
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
                          value={strategyDraft.strategyDifferentials}
                          onChange={(event) => handleStrategyDraftChange("strategyDifferentials", event.target.value)}
                          rows={3}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: frete grátis, envio no mesmo dia, instalação própria..."
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">O que a loja não promete</span>
                        <textarea
                          value={strategyDraft.strategyPromiseLimits}
                          onChange={(event) => handleStrategyDraftChange("strategyPromiseLimits", event.target.value)}
                          rows={3}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-3 md:col-span-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
                          Campos legacy fora da autoridade canonica
                        </div>
                        <div className="mt-2 grid gap-2 text-sm text-gray-700 md:grid-cols-3">
                          <div>Visita: {cleanText(answers.strategy_requires_visit) || "Nao informado"}</div>
                          <div>Humano: {cleanText(answers.strategy_requires_human) || "Nao informado"}</div>
                          <div>Excecoes: {cleanText(answers.strategy_exception_cases) || "Nao informado"}</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-gray-200 bg-white p-4">
                    <div className="mb-3 text-sm font-semibold text-gray-900">6. Resumo estratégico para a IA</div>
                    <div className="grid gap-3">
                      <div className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Como a IA deve entender a loja</span>
                        <textarea
                          value={derivedStrategyAiStoreSummary}
                          readOnly
                          rows={3}
                          className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 outline-none"
                        />
                        <div className="text-xs text-gray-500">
                          Este resumo e derivado da configuracao canonica e nao vira autoridade manual.
                        </div>
                      </div>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Como a IA deve apresentar a loja</span>
                        <textarea
                          value={strategyDraft.strategyAiPresentation}
                          onChange={(event) => handleStrategyDraftChange("strategyAiPresentation", event.target.value)}
                          rows={3}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">O que a IA deve priorizar</span>
                        <textarea
                          value={strategyDraft.strategyAiPriorities}
                          onChange={(event) => handleStrategyDraftChange("strategyAiPriorities", event.target.value)}
                          rows={3}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">O que a IA nunca deve esquecer</span>
                        <textarea
                          value={strategyDraft.strategyAiNeverForget}
                          onChange={(event) => handleStrategyDraftChange("strategyAiNeverForget", event.target.value)}
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

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setRawImportFilesModalTab("pools")}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm transition hover:bg-gray-50"
            >
              Ver arquivos brutos importados ({poolImportFiles.length})
            </button>
          </div>
        </div>
      ) : null}

      {activeTab === "produtos-acessorios" ? (
        <div className="space-y-4 overflow-x-hidden">
          <SectionBlock
            title="Catálogo Inteligente"
            description="Envie fotos, PDF, Word, Excel ou PowerPoint para o ZION tentar identificar piscinas, produtos, acessórios e outros itens. Você poderá revisar a leitura antes de salvar no catálogo."
          >
            <IntelligentCatalogImportPanel
              organizationId={organizationId}
              storeId={activeStoreId}
              storageKey={intelligentImportStorageKey}
              source="configuracoes_intelligent_import"
              disabled={!hasValidStoreContext}
              supabaseClient={supabase}
              onError={(message) => {
                setErrorText(message);
                if (message) setSuccessText(null);
              }}
              onSuccess={(message) => {
                setSuccessText(message);
                if (message) setErrorText(null);
              }}
              onSaved={async () => {
                await fetchPageData();
              }}
            />
          </SectionBlock>

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

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setRawImportFilesModalTab("catalog")}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm transition hover:bg-gray-50"
            >
              Ver arquivos brutos importados ({catalogImportFiles.length})
            </button>
          </div>
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
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Vários compromissos no mesmo dia</span>
                  <select value={operationDraft.allow_multiple_appointments_per_day} onChange={(e)=>handleOperationDraftChange("allow_multiple_appointments_per_day", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"><option>Sim</option><option>Não</option></select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Compromissos no mesmo horário</span>
                  <select value={operationDraft.allow_same_time_appointments} onChange={(e)=>handleOperationDraftChange("allow_same_time_appointments", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"><option>Não</option><option>Sim</option></select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Capacidade no mesmo horário</span>
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
                <div className="space-y-3 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Formas de pagamento canonicas</span>
                  <div className="grid gap-2 md:grid-cols-3">
                    {PAYMENT_METHOD_MAIN_OPTIONS.map((option) => {
                      const selected = commercialDraft.accepted_payment_methods.includes(option.value);
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => handleCommercialPaymentMethodToggle(option.value)}
                          className={selected ? "rounded-xl border border-black bg-black px-3 py-2 text-sm font-medium text-white" : "rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700"}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="grid gap-2 md:grid-cols-3">
                    {commercialDraft.legacy_payment_condition_tags.length > 0 ? (
                      <div className="md:col-span-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                        Dados antigos para revisar: {commercialDraft.legacy_payment_condition_tags
                          .map((value) => getStorePaymentLegacyConditionTagLabel(value as StorePaymentLegacyConditionTag))
                          .join(", ")}
                      </div>
                    ) : null}
                  </div>
                </div>
                {commercialDraft.accepted_payment_methods.includes("pix") ? (
                  <>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Tipo da chave Pix</span>
                      <select value={commercialDraft.pix_key_type} onChange={(e)=>handleCommercialDraftChange("pix_key_type", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black">
                        <option value="">Nao definido</option>
                        {PIX_KEY_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Chave Pix</span>
                      <input value={commercialDraft.pix_key} onChange={(e)=>handleCommercialDraftChange("pix_key", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                    </label>
                    <label className="space-y-1 md:col-span-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Titular da chave Pix</span>
                      <input value={commercialDraft.pix_holder_name} onChange={(e)=>handleCommercialDraftChange("pix_holder_name", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                    </label>
                  </>
                ) : null}
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Regra de entrada</span>
                  <select value={commercialDraft.down_payment_mode} onChange={(e)=>handleCommercialDraftChange("down_payment_mode", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black">
                    {DOWN_PAYMENT_MODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                {commercialDraft.down_payment_mode !== "none" ? (
                  <label className="space-y-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Tipo do valor da entrada</span>
                    <select value={commercialDraft.down_payment_value_type} onChange={(e)=>handleCommercialDraftChange("down_payment_value_type", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black">
                      <option value="">Nao definido</option>
                      {DOWN_PAYMENT_VALUE_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {commercialDraft.down_payment_mode !== "none" && commercialDraft.down_payment_value_type === "percent" ? (
                  <label className="space-y-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Percentual da entrada</span>
                    <input value={commercialDraft.down_payment_percent} onChange={(e)=>handleCommercialDraftChange("down_payment_percent", formatStorePaymentPercentInput(e.target.value))} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                  </label>
                ) : null}
                {commercialDraft.down_payment_mode !== "none" && commercialDraft.down_payment_value_type === "fixed" ? (
                  <label className="space-y-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Valor fixo da entrada</span>
                    <input value={commercialDraft.down_payment_amount} onChange={(e)=>handleCommercialDraftChange("down_payment_amount", formatStorePaymentCurrencyInput(e.target.value))} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                  </label>
                ) : null}
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Trabalha com parcelamento</span>
                  <select value={commercialDraft.installments_enabled} onChange={(e)=>handleCommercialDraftChange("installments_enabled", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"><option value="nao">Nao</option><option value="sim">Sim</option></select>
                </label>
                {commercialDraft.installments_enabled === "sim" ? (
                  <>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Maximo de parcelas</span>
                      <input value={commercialDraft.max_installments} onChange={(e)=>handleCommercialDraftChange("max_installments", formatStorePaymentInstallmentsInput(e.target.value))} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Politica de juros</span>
                      <select value={commercialDraft.installment_interest_policy} onChange={(e)=>handleCommercialDraftChange("installment_interest_policy", e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black">
                        <option value="">Nao definido</option>
                        {INSTALLMENT_INTEREST_POLICY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : null}
                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Observacao complementar de pagamento</span>
                  <textarea value={commercialDraft.payment_notes} onChange={(e)=>handleCommercialDraftChange("payment_notes", e.target.value)} rows={2} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Resumo derivado de pagamento</span>
                  <textarea value={commercialDraft.payment_methods_summary} readOnly rows={2} className="w-full rounded-xl border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-700 outline-none" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Política de desconto</span>
                  <textarea value={discountPresentation.policySummary || commercialDraft.discount_policy_summary} readOnly rows={2} className="w-full rounded-xl border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-700 outline-none" />
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
          description="Defina a política global de desconto, a autonomia normal da IA e a policy opcional de alto valor sem transformar exceções de venda em configuração."
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
              label="Primeiro degrau"
              value={discountPresentation.defaultDiscountPercent == null ? "Não definido" : `${discountPresentation.defaultDiscountPercent}%`}
              tone={discountPresentation.defaultDiscountPercent == null ? "gray" : "green"}
              hint="Primeira concessão normal permitida pela política global."
            />
            <StatusCard
              label="Teto normal"
              value={discountPresentation.maxDiscountPercent == null ? "Não definido" : `${discountPresentation.maxDiscountPercent}%`}
              tone={discountPresentation.maxDiscountPercent == null ? "gray" : "green"}
              hint="Teto normal da política de desconto."
            />
            <StatusCard
              label="Autonomia"
              value={discountPresentation.autonomyMode || "approval_required"}
              tone="gray"
              hint="Define quando a IA pode conceder dentro da política normal."
            />
            <StatusCard
              label="Alto valor"
              value={discountPresentation.highValueEnabled ? "Ativo" : "Desativado"}
              tone={discountPresentation.highValueEnabled ? "green" : "gray"}
              hint="Policy global opcional para quotes elegíveis de maior valor."
            />
          </div>

          {discountPresentation.hasHistoricalConflict ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Há valores históricos divergentes nesta política. Revise os percentuais antes de salvar uma nova configuração.
              <div className="mt-1 text-amber-800">
                {discountPresentation.historicalConflictSummary}
              </div>
            </div>
          ) : null}

          {isDiscountEditing ? (
            <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <div className="mb-3 text-sm font-semibold text-gray-900">Editar descontos na mesma página</div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Primeiro degrau normal</span>
                  <input
                    value={discountDraft.default_discount_percent}
                    onChange={(e) => handleDiscountDraftChange("default_discount_percent", formatStoreDiscountPercentInput(e.target.value))}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                    placeholder="Ex.: 5"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Teto normal de desconto</span>
                  <input
                    value={discountDraft.max_discount_percent}
                    onChange={(e) => handleDiscountDraftChange("max_discount_percent", formatStoreDiscountPercentInput(e.target.value))}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                    placeholder="Ex.: 10 ou 15"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Modo de autonomia</span>
                  <select
                    value={discountDraft.discount_autonomy_mode}
                    onChange={(e) => handleDiscountDraftChange("discount_autonomy_mode", e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  >
                    <option value="approval_required">approval_required</option>
                    <option value="default_step_autonomous">default_step_autonomous</option>
                    <option value="within_policy_autonomous">within_policy_autonomous</option>
                  </select>
                </label>

                <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={discountDraft.allow_ask_above_max_discount}
                    onChange={(e) =>
                      handleDiscountDraftChange(
                        "allow_ask_above_max_discount",
                        e.target.checked,
                      )
                    }
                  />
                  Pode consultar humano acima do teto normal
                </label>

                <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 md:col-span-2">
                  <input
                    type="checkbox"
                    checked={discountDraft.high_value_enabled}
                    onChange={(e) =>
                      handleDiscountDraftChange("high_value_enabled", e.target.checked)
                    }
                  />
                  Ativar política global de alto valor
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Threshold alto valor (R$ inteiros)</span>
                  <input
                    value={discountDraft.high_value_threshold_amount}
                    onChange={(e) => handleDiscountDraftChange("high_value_threshold_amount", formatStoreDiscountMoneyInput(e.target.value))}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                    placeholder="Ex.: 50000"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Percentual alto valor</span>
                  <input
                    value={discountDraft.high_value_discount_percent}
                    onChange={(e) => handleDiscountDraftChange("high_value_discount_percent", formatStoreDiscountPercentInput(e.target.value))}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                    placeholder="Ex.: 18"
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
                  "O teto normal define o limite máximo da política normal. Quem pode conceder dentro desse limite depende do modo de autonomia.",
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

          <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4 md:p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-base font-semibold text-gray-900">WhatsApp da loja</div>
                <p className="mt-1 max-w-3xl text-sm text-gray-600">
                  Status real e seguro da integracao oficial da loja com o WhatsApp Cloud API da Meta.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusToneClass(
                    storeWhatsappVisualStatus.tone
                  )}`}
                >
                  {storeWhatsappVisualStatus.label}
                </span>
                <button
                  type="button"
                  disabled
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-500 opacity-80"
                >
                  Solicitar conexao do WhatsApp
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {storeWhatsappStatusMetrics.map((item) => (
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
              <div className="rounded-2xl border border-gray-200 bg-white p-4">
                <div className="mb-2 text-sm font-semibold text-gray-900">Resumo seguro da integracao</div>
                <SummaryList
                  items={[
                    "Canal: WhatsApp Cloud API / Meta",
                    `Numero conectado: ${cleanText(storeWhatsappStatus?.displayPhoneNumber) || "Nao informado"}`,
                    `WABA ID: ${cleanText(storeWhatsappStatus?.whatsappBusinessAccountId) || "Nao informado"}`,
                    `Phone Number ID: ${cleanText(storeWhatsappStatus?.phoneNumberId) || "Nao informado"}`,
                    `Status recente de entrega: ${Number(storeWhatsappStatus?.recentDeliveryStatus?.sentCount ?? 0)} envio(s), ${Number(storeWhatsappStatus?.recentDeliveryStatus?.deliveredCount ?? 0)} entregue(s), ${Number(storeWhatsappStatus?.recentDeliveryStatus?.readCount ?? 0)} lido(s)`,
                  ]}
                />
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-4">
                <div className="mb-2 text-sm font-semibold text-gray-900">Saude operacional</div>
                <SummaryList
                  items={[
                    storeWhatsappSafeErrorText
                      ? `${
                          storeWhatsappStatus?.connected && storeWhatsappStatus?.isActive
                            ? "Ultimo aviso registrado"
                            : "Ultimo erro seguro"
                        }: ${storeWhatsappSafeErrorText}`
                      : `${
                          storeWhatsappStatus?.connected && storeWhatsappStatus?.isActive
                            ? "Nenhum aviso recente encontrado."
                            : "Nenhum erro seguro recente encontrado."
                        }`,
                    "A conexao do WhatsApp e acompanhada pela equipe ZION. A loja nao precisa configurar tokens, Webhook, WABA ou Phone Number ID manualmente.",
                    "Processamento automatico frequente ainda depende de infraestrutura adequada. No piloto, a rota de processamento esta pronta, mas o cron por minuto nao esta ativo no plano Hobby da Vercel.",
                  ]}
                />
              </div>
            </div>

            {storeWhatsappStatusLoading ? (
              <div className="mt-4 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
                Carregando status real do WhatsApp da loja...
              </div>
            ) : null}

            {storeWhatsappStatusErrorText ? (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {storeWhatsappStatusErrorText}
              </div>
            ) : null}
          </div>


          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <div className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="mb-2 text-sm font-semibold text-gray-900">Como preencher rápido</div>
              <SummaryList
                items={[
                  "Confirme o WhatsApp comercial conectado e revise o responsável principal derivado.",
                  "Edite aqui apenas a descrição comercial canônica e a configuração permanente da integração principal.",
                  "Os comportamentos operacionais do responsável e da Assistente ficam fora desta família.",
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
                  "Os 10 campos canônicos desta família revisados quando necessário.",
                ]}
              />
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="mb-2 text-sm font-semibold text-gray-900">O que pode ficar para depois</div>
              <SummaryList
                items={[
                  "Detalhes operacionais do responsável e da Assistente.",
                  "Chat interno, alertas, urgências e relatórios.",
                  "Fallback e roteamentos operacionais legados.",
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
                          value={connectedCommercialWhatsapp}
                          readOnly
                          className="w-full rounded-xl border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-700 outline-none"
                          placeholder="Conecte o canal oficial da loja"
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

                      <div className="rounded-2xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-700">
                        O WhatsApp comercial oficial é derivado da fonte viva da integração. Esta aba só mantém a descrição canônica do canal.
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
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">WhatsApp do responsável principal</span>
                        <input
                          value={primaryResponsibleWhatsapp}
                          readOnly
                          className="w-full rounded-xl border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-700 outline-none"
                          placeholder="Defina o responsável principal na configuração canônica"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Canal derivado do responsável</span>
                        <input
                          value={primaryResponsibleChannelLabel}
                          readOnly
                          className="w-full rounded-xl border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-700 outline-none"
                          placeholder="Canal do responsável principal"
                        />
                      </label>

                      <div className="rounded-2xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-700">
                        Alertas, urgências, relatórios e comandos humanos do responsável pertencem ao Bloco 5 e não são editados nesta família.
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-gray-200 bg-white p-4">
                    <div className="mb-3 text-sm font-semibold text-gray-900">3. Integração externa</div>
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
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Status real da integração oficial</span>
                        <input
                          value={storeWhatsappVisualStatus.label}
                          readOnly
                          className="w-full rounded-xl border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-700 outline-none"
                          placeholder="Status derivado da fonte viva"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-gray-200 bg-white p-4 xl:col-span-2">
                    <div className="mb-3 text-sm font-semibold text-gray-900">4. Escopo desta família</div>
                    <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                      Esta edição salva somente os 10 campos canônicos de canal comercial e integração principal. Chat interno, alertas, urgências, relatórios e roteamentos operacionais permanecem fora desta família.
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
                        `WhatsApp comercial: ${connectedCommercialWhatsapp || "Não definido"}`,
                        `Status real do WhatsApp: ${storeWhatsappVisualStatus.label || "Não definido"}`,
                        `Canal oficial da IA: ${channelDraft.commercial_is_official_sales_channel || "Não definido"}`,
                      ]}
                    />
                  </div>
                  <div>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Resumo do canal do responsável</div>
                    <SummaryList
                      items={[
                        `Canal do responsável: ${primaryResponsibleChannelLabel || "Não definido"}`,
                        `WhatsApp do responsável: ${primaryResponsibleWhatsapp || "Não definido"}`,
                        "Origem: configuração canônica de responsáveis.",
                        "Alertas, urgências e relatórios operacionais ficam fora desta família.",
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
                      Abra só se quiser detalhar observações permanentes do canal comercial e da integração principal.
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
                      <div className="mb-3 text-sm font-semibold text-gray-900">Integração principal — detalhes</div>
                      <div className="grid gap-3">
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Status real da integração oficial</span>
                          <input value={storeWhatsappVisualStatus.label} readOnly className="w-full rounded-xl border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-700 outline-none" />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Observações permanentes da integração</span>
                          <textarea value={channelDraft.integrations_notes} onChange={(e)=>handleChannelDraftChange("integrations_notes", e.target.value)} rows={2} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black" />
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
              <div className="mb-2 text-sm font-semibold text-gray-900">Integrações externas</div>
              <SummaryList items={channelOtherAndIntegrationItems} />
            </div>
          </div>
        </SectionBlock>
      ) : null}

      {activeTab === "contratos" ? (
        <SectionBlock
          title="10. Contratos"
          description="Envie, acompanhe e aprove o contrato base oficial da loja."
          actions={
            contractsLoading ? (
              <span className="text-xs text-gray-500">Carregando...</span>
            ) : null
          }
        >
          <div className="space-y-4">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <div className="space-y-2 text-sm text-gray-700">
                <p>
                  Envie aqui o contrato base oficial da sua loja. O ZION usara esse
                  contrato como referencia para gerar contratos futuros e entender
                  regras como pagamento, instalacao, garantia, obrigacoes da loja e
                  obrigacoes do cliente.
                </p>
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  O contrato base so sera usado depois de revisao e aprovacao do
                  responsavel da loja.
                </div>
              </div>
            </div>

            {contractsErrorText ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {contractsErrorText}
              </div>
            ) : null}

            {contractsSuccessText ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {contractsSuccessText}
              </div>
            ) : null}

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-4">
                <div className="rounded-2xl border border-gray-200 bg-white p-4">
                  <div className="text-sm font-semibold text-gray-900">Enviar contrato base</div>

                  <input
                    ref={contractBaseInputRef}
                    type="file"
                    accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    className="hidden"
                    onChange={(event) => {
                      const nextFile = event.target.files?.[0] ?? null;
                      setSelectedContractBaseFile(nextFile);
                      setContractsErrorText(null);
                      setContractsSuccessText(null);
                      event.currentTarget.value = "";
                    }}
                  />

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => contractBaseInputRef.current?.click()}
                      disabled={!hasValidStoreContext || uploadingContractBase || contractsLoading}
                      className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Escolher arquivo
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleUploadContractBase()}
                      disabled={
                        !hasValidStoreContext ||
                        !selectedContractBaseFile ||
                        uploadingContractBase ||
                        contractsLoading
                      }
                      className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {uploadingContractBase ? "Enviando contrato base..." : "Enviar contrato base"}
                    </button>
                  </div>

                  <div className="mt-3 space-y-2 text-sm text-gray-700">
                    <div>
                      <span className="font-semibold text-gray-900">Arquivo selecionado:</span>{" "}
                      {selectedContractBaseFile?.name || "Nenhum arquivo selecionado"}
                    </div>
                    <div className="text-xs text-gray-500">
                      Formatos aceitos: PDF, DOC e DOCX. Tamanho maximo sugerido: 15 MB.
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-4">
                  <div className="mb-3 text-sm font-semibold text-gray-900">Versoes enviadas</div>

                  {contractsLoading && storeContractVersions.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-4 text-sm text-gray-600">
                      Carregando contratos base da loja...
                    </div>
                  ) : storeContractVersions.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-4 text-sm text-gray-600">
                      <div className="font-semibold text-gray-900">
                        Nenhum contrato base enviado ainda.
                      </div>
                      <div className="mt-1">
                        Envie o contrato oficial usado pela sua loja para comecar.
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {storeContractVersions.map((version) => {
                        const status = resolveContractVersionStatus(version.status);
                        const isActiveVersion =
                          storeContractActiveVersion?.id === version.id ||
                          cleanText(version.status).toLowerCase() === "active";
                        const normalizedStatus = cleanText(version.status).toLowerCase();
                        const hasExtractedText = Boolean(cleanText(version.raw_extracted_text));
                        const isVersionBusy = contractActionVersionId === version.id;
                        const isAnalyzeBusy =
                          isVersionBusy && contractActionType === "analyze";
                        const isExtractRulesBusy =
                          isVersionBusy && contractActionType === "extract-rules";
                        const isApproveBusy =
                          isVersionBusy && contractActionType === "approve";
                        const isRejectBusy =
                          isVersionBusy && contractActionType === "reject";
                        const canAnalyze =
                          (isActiveVersion && !hasExtractedText) ||
                          (!isActiveVersion && ["uploaded", "failed"].includes(normalizedStatus));
                        const canExtractRules = hasExtractedText;
                        const canApprove =
                          !isActiveVersion &&
                          ["uploaded", "analyzed", "awaiting_review", "approved"].includes(
                            normalizedStatus
                          );
                        const canReject = !isActiveVersion;
                        const versionRules = storeContractExtractedRules.filter(
                          (rule) => rule.template_version_id === version.id
                        );
                        const pendingRulesCount = versionRules.filter(
                          (rule) =>
                            String(rule.review_status || "").trim().toLowerCase() === "pending"
                        ).length;
                        const approvedRulesCount = versionRules.filter(
                          (rule) =>
                            String(rule.review_status || "").trim().toLowerCase() === "approved"
                        ).length;
                        const rejectedRulesCount = versionRules.filter(
                          (rule) =>
                            String(rule.review_status || "").trim().toLowerCase() === "rejected"
                        ).length;
                        const editedRulesCount = versionRules.filter(
                          (rule) =>
                            String(rule.review_status || "").trim().toLowerCase() === "edited"
                        ).length;
                        const maskedTextPreview = summarizeContractUiText(
                          version.raw_extracted_text,
                          160
                        );
                        const maskedAnalysisSummary = summarizeContractUiText(
                          version.analysis_summary,
                          140
                        );

                        return (
                          <div
                            key={version.id}
                            className="rounded-2xl border border-gray-200 bg-gray-50 p-4"
                          >
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                              <div className="min-w-0 space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="text-sm font-semibold text-gray-900">
                                    Versao {version.version_number ?? "-"}
                                  </div>
                                  <span
                                    className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${statusToneClass(
                                      status.tone
                                    )}`}
                                  >
                                    {status.label}
                                  </span>
                                  {isActiveVersion ? (
                                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                                      Ativo
                                    </span>
                                  ) : null}
                                </div>

                                <div className="break-words text-sm text-gray-700">
                                  <span className="font-semibold text-gray-900">Arquivo:</span>{" "}
                                  {cleanText(version.original_filename) || "Arquivo sem nome"}
                                </div>

                                <div className="flex flex-wrap gap-2 text-xs text-gray-600">
                                  <span className="rounded-full bg-white px-2 py-1 ring-1 ring-gray-200">
                                    Enviado em {formatImportDate(version.created_at)}
                                  </span>
                                  <span className="rounded-full bg-white px-2 py-1 ring-1 ring-gray-200">
                                    Tamanho: {formatFileSize(version.size_bytes)}
                                  </span>
                                  {version.approved_at ? (
                                    <span className="rounded-full bg-white px-2 py-1 ring-1 ring-gray-200">
                                      Aprovado em {formatImportDate(version.approved_at)}
                                    </span>
                                  ) : null}
                                </div>

                                {cleanText(version.rejection_reason) ? (
                                  <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                                    Motivo da rejeicao: {cleanText(version.rejection_reason)}
                                  </div>
                                ) : null}

                                {cleanText(version.analysis_summary) ? (
                                  <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
                                    {maskedAnalysisSummary}
                                  </div>
                                ) : null}

                                <div className="grid gap-2 sm:grid-cols-2">
                                  <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
                                    <span className="font-semibold text-gray-900">Texto lido:</span>{" "}
                                    {hasExtractedText ? "Disponivel" : "Ainda nao lido"}
                                  </div>
                                  <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
                                    <span className="font-semibold text-gray-900">Regras encontradas:</span>{" "}
                                    {versionRules.length}
                                  </div>
                                </div>

                                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                                  <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
                                    <span className="font-semibold text-gray-900">Aguardando revisao:</span>{" "}
                                    {pendingRulesCount}
                                  </div>
                                  <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
                                    <span className="font-semibold text-gray-900">Aprovadas:</span>{" "}
                                    {approvedRulesCount}
                                  </div>
                                  <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
                                    <span className="font-semibold text-gray-900">Ignoradas:</span>{" "}
                                    {rejectedRulesCount}
                                  </div>
                                  <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
                                    <span className="font-semibold text-gray-900">Ajustadas:</span>{" "}
                                    {editedRulesCount}
                                  </div>
                                </div>

                                {hasExtractedText ? (
                                  <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
                                    <span className="font-semibold text-gray-900">Resumo curto:</span>{" "}
                                    {maskedTextPreview}
                                  </div>
                                ) : null}
                              </div>

                              <div className="w-full max-w-sm space-y-2">
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => void handleAnalyzeContractVersion(version.id)}
                                    disabled={
                                      !canAnalyze ||
                                      isVersionBusy ||
                                      uploadingContractBase ||
                                      contractsLoading
                                    }
                                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {isAnalyzeBusy ? "Lendo arquivo..." : "Analisar contrato"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setContractContentModal({
                                        type: "text",
                                        versionId: version.id,
                                      })
                                    }
                                    disabled={!hasExtractedText}
                                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    Ver texto lido
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleExtractContractRules(version.id)}
                                    disabled={
                                      !canExtractRules ||
                                      isVersionBusy ||
                                      uploadingContractBase ||
                                      contractsLoading
                                    }
                                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {isExtractRulesBusy ? "Buscando regras..." : "Encontrar regras do contrato"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setContractContentModal({
                                        type: "rules",
                                        versionId: version.id,
                                      })
                                    }
                                    disabled={versionRules.length === 0}
                                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    Ver regras encontradas
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleApproveContractVersion(version.id)}
                                    disabled={
                                      !canApprove ||
                                      isVersionBusy ||
                                      uploadingContractBase ||
                                      contractsLoading
                                    }
                                    className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {isApproveBusy ? "Aprovando..." : "Aprovar versao"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleRejectContractVersion(version.id)}
                                    disabled={
                                      !canReject ||
                                      isVersionBusy ||
                                      uploadingContractBase ||
                                      contractsLoading
                                    }
                                    className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {isRejectBusy ? "Rejeitando..." : "Rejeitar versao"}
                                  </button>
                                </div>

                                {!isActiveVersion ? (
                                  <textarea
                                    value={contractRejectReasonDrafts[version.id] || ""}
                                    onChange={(event) =>
                                      setContractRejectReasonDrafts((current) => ({
                                        ...current,
                                        [version.id]: event.target.value,
                                      }))
                                    }
                                    rows={2}
                                    placeholder="Motivo da rejeicao (opcional)"
                                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                                  />
                                ) : (
                                  <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-500">
                                    A versao ativa nao pode ser rejeitada pela interface.
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <div className="text-sm font-semibold text-gray-900">Contrato base ativo</div>

                  {storeContractActiveVersion ? (
                    <div className="mt-3 space-y-2 text-sm text-gray-700">
                      <div className="break-words">
                        <span className="font-semibold text-gray-900">Arquivo:</span>{" "}
                        {cleanText(storeContractActiveVersion.original_filename) || "Arquivo sem nome"}
                      </div>
                      <div>
                        <span className="font-semibold text-gray-900">Versao:</span>{" "}
                        {storeContractActiveVersion.version_number ?? "-"}
                      </div>
                      <div>
                        <span className="font-semibold text-gray-900">Data de aprovacao:</span>{" "}
                        {formatImportDate(storeContractActiveVersion.approved_at)}
                      </div>
                      <div>
                        <span className="font-semibold text-gray-900">Status:</span>{" "}
                        Ativo
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 rounded-xl border border-dashed border-gray-300 bg-white px-4 py-4 text-sm text-gray-600">
                      Nenhum contrato base ativo no momento.
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-4">
                  <div className="mb-3 text-sm font-semibold text-gray-900">
                    Resumo rapido
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <CompactMetric
                      label="Versoes enviadas"
                      value={String(storeContractVersions.length)}
                      tone={storeContractVersions.length > 0 ? "green" : "gray"}
                    />
                    <CompactMetric
                      label="Status atual"
                      value={
                        storeContractActiveVersion
                          ? "Ativo"
                          : storeContractTemplate
                            ? resolveContractVersionStatus(storeContractTemplate?.status).label
                            : "Sem envio"
                      }
                      tone={storeContractActiveVersion ? "green" : "gray"}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </SectionBlock>
      ) : null}

      {activeTab === "identidade" ? (
        <SectionBlock
          title="11. Identidade da loja"
          description="Nome, assinatura e dados institucionais usados pela IA e pelos documentos da loja."
        >
          <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <div className="text-sm font-semibold text-gray-900">Logo da loja</div>
              <p className="mt-1 text-sm text-gray-600">
                Essa logo sera usada nos orcamentos em PDF.
              </p>

              <div className="mt-4 flex min-h-[220px] items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-white p-4">
                {storeLogoPreviewUrl ? (
                  <img
                    src={storeLogoPreviewUrl}
                    alt={`Logo da loja ${storeName}`}
                    className="max-h-44 w-full object-contain"
                  />
                ) : (
                  <div className="text-center text-sm text-gray-500">
                    Nenhuma logo enviada ainda.
                  </div>
                )}
              </div>

              <div className="mt-4 space-y-2 text-sm text-gray-700">
                <div className="break-words">
                  <span className="font-semibold text-gray-900">Arquivo:</span>{" "}
                  {displayedLogoFileName}
                </div>
                <div>
                  <span className="font-semibold text-gray-900">Tamanho:</span>{" "}
                  {formatFileSize(displayedLogoSize)}
                </div>
                <div>
                  <span className="font-semibold text-gray-900">Enviada em:</span>{" "}
                  {storeBranding?.logo_uploaded_at
                    ? formatImportDate(storeBranding.logo_uploaded_at)
                    : "Ainda nao enviada"}
                </div>
                {selectedStoreLogoFile ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Nova logo selecionada. Clique em salvar para atualizar a identidade da loja.
                  </div>
                ) : null}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-gray-200 bg-white p-4">
                <input
                  ref={storeLogoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(event) => {
                    handleStoreLogoFileChange(event.target.files);
                    event.currentTarget.value = "";
                  }}
                />

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => storeLogoInputRef.current?.click()}
                    disabled={!hasValidStoreContext || savingStoreLogo || removingStoreLogo}
                    className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {hasStoredLogo || selectedStoreLogoFile ? "Trocar logo" : "Enviar logo"}
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleSaveStoreLogo()}
                    disabled={
                      !hasValidStoreContext ||
                      !selectedStoreLogoFile ||
                      savingStoreLogo ||
                      removingStoreLogo
                    }
                    className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingStoreLogo ? "Salvando logo..." : "Salvar logo"}
                  </button>

                  {hasStoredLogo ? (
                    <button
                      type="button"
                      onClick={() => void handleRemoveStoreLogo()}
                      disabled={!hasValidStoreContext || savingStoreLogo || removingStoreLogo}
                      className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {removingStoreLogo ? "Removendo..." : "Remover logo"}
                    </button>
                  ) : null}
                </div>

                <div className="mt-3 text-xs text-gray-500">
                  Formatos aceitos: PNG, JPEG e WebP. Tamanho maximo sugerido: 2 MB.
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <div className="mb-2 text-sm font-semibold text-gray-900">
                  Resumo da identidade
                </div>
                <SummaryList items={identityItems} />
              </div>
            </div>
          </div>
        </SectionBlock>
      ) : null}

      {isManualCatalogItemModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6"
          onClick={closeManualCatalogItemModal}
        >
          <div
            className="flex max-h-[82vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 bg-gray-950 px-5 py-4 text-white">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/70">
                  Cadastro visual
                </div>
                <h2 className="mt-1 text-lg font-bold">Adicionar item manualmente</h2>
              </div>
              <button
                type="button"
                onClick={closeManualCatalogItemModal}
                className="rounded-xl border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
              >
                Fechar
              </button>
            </div>

            <div className="overflow-y-auto px-5 py-5">
              <div className="space-y-4">
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Categoria</span>
                  <select
                    value={manualCatalogItemCategory}
                    onChange={(event) =>
                      handleManualCatalogItemCategoryChange(
                        event.target.value as "piscina" | "quimicos" | "acessorios" | "outros"
                      )
                    }
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                  >
                    <option value="piscina">Piscina</option>
                    <option value="quimicos">Químico</option>
                    <option value="acessorios">Acessório</option>
                    <option value="outros">Outro</option>
                  </select>
                </label>

                {manualCatalogItemModalError ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {manualCatalogItemModalError}
                  </div>
                ) : null}

                {manualCatalogItemModalSuccess ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    {manualCatalogItemModalSuccess}
                  </div>
                ) : null}

                {manualCatalogItemCategory === "piscina" ? (
                  <>
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

                      <label className="space-y-1 md:col-span-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Aplicação / uso recomendado</span>
                        <textarea
                          value={poolForm.application}
                          onChange={(event) => handlePoolFormChange("application", event.target.value)}
                          rows={3}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: lazer familiar, uso residencial, instalação em áreas gourmet..."
                        />
                      </label>

                      <label className="space-y-1 md:col-span-2">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Observações técnicas</span>
                        <textarea
                          value={poolForm.technical_notes}
                          onChange={(event) => handlePoolFormChange("technical_notes", event.target.value)}
                          rows={3}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                          placeholder="Ex.: espessura, reforços estruturais, requisitos técnicos..."
                        />
                      </label>

                      <label className="space-y-1 md:col-span-2 xl:col-span-4">
                        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Fotos do item</span>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={(event) => handleManualCatalogPoolPhotosChange(event.target.files)}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 file:mr-3 file:rounded-lg file:border-0 file:bg-black file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
                        />
                        <div className="text-xs text-gray-500">Máximo de 10 fotos por item. Cada foto pode ter até 50 MB.</div>
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
                        Item em estado vendível / ativo
                      </label>

                      <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={poolForm.track_stock}
                          onChange={(event) => handlePoolFormChange("track_stock", event.target.checked)}
                        />
                        Controlar estoque deste item
                      </label>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
                          onChange={(event) => handleManualCatalogGeneralPhotosChange(event.target.files)}
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
                  </>
                )}

                <div className="mt-5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleManualCatalogItemVisualSave}
                    disabled={savingPool || savingCatalogItem || !hasValidStoreContext}
                    className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingPool
                      ? "Salvando piscina..."
                      : savingCatalogItem
                        ? "Salvando item..."
                        : "Salvar item"}
                  </button>
                  <button
                    type="button"
                    onClick={resetManualCatalogItemModalForm}
                    disabled={savingPool || savingCatalogItem}
                    className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
                  >
                    Limpar formulário
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {contractContentModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6"
          onClick={() => setContractContentModal(null)}
        >
          <div
            className="flex max-h-[82vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            {(() => {
              const selectedVersion = storeContractVersions.find(
                (item) => item.id === contractContentModal.versionId
              );
              const selectedRules = storeContractExtractedRules.filter(
                (item) => item.template_version_id === contractContentModal.versionId
              );
              const isTextModal = contractContentModal.type === "text";
              const title = isTextModal ? "Texto lido do contrato" : "Regras encontradas";

              return (
                <>
                  <div className="flex items-start justify-between gap-3 bg-gray-950 px-5 py-4 text-white">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-gray-400">
                        Contratos
                      </div>
                      <h2 className="mt-1 text-lg font-bold">{title}</h2>
                      <p className="mt-1 text-xs text-gray-300">
                        {cleanText(selectedVersion?.original_filename) || "Arquivo sem nome"}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setContractContentModal(null)}
                      className="rounded-xl border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
                    >
                      Fechar
                    </button>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    {isTextModal ? (
                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                        <div className="mb-2 text-sm font-semibold text-gray-900">
                          Texto mascarado para revisao
                        </div>
                        <div className="whitespace-pre-wrap">
                          {maskSensitiveContractPreview(
                            cleanText(selectedVersion?.raw_extracted_text) ||
                              "Nenhum texto lido disponivel."
                          )}
                        </div>
                      </div>
                    ) : selectedRules.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-4 text-sm text-gray-600">
                        Nenhuma regra encontrada ainda.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {selectedRules.map((rule) => (
                          (() => {
                            const ruleStatus = resolveContractRuleStatus(rule.review_status);
                            const isEditing = contractRuleEditingIds[rule.id] === true;
                            const isRuleBusy = contractRuleActionRuleId === rule.id;
                            const ruleDraft =
                              contractRuleEditDrafts[rule.id] ?? cleanText(rule.value_text) ?? "";

                            return (
                              <div
                                key={rule.id}
                                className="rounded-2xl border border-gray-200 bg-gray-50 p-4"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="text-sm font-semibold text-gray-900">
                                    {cleanText(rule.label) || "Regra encontrada"}
                                  </div>
                                  <span
                                    className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${statusToneClass(
                                      ruleStatus.tone
                                    )}`}
                                  >
                                    {ruleStatus.label}
                                  </span>
                                  <span className="rounded-full border border-gray-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-600">
                                    {resolveContractRuleGroupLabel(rule.rule_group)}
                                  </span>
                                </div>

                                {!isEditing ? (
                                  <div className="mt-2 text-sm text-gray-700">
                                    {maskSensitiveContractPreview(
                                      cleanText(rule.value_text) || "Trecho nao disponivel"
                                    )}
                                  </div>
                                ) : (
                                  <div className="mt-3 space-y-2">
                                    <div className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
                                      Editar texto
                                    </div>
                                    <textarea
                                      value={ruleDraft}
                                      onChange={(event) =>
                                        setContractRuleEditDrafts((current) => ({
                                          ...current,
                                          [rule.id]: event.target.value,
                                        }))
                                      }
                                      rows={5}
                                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-black"
                                    />
                                  </div>
                                )}

                                {cleanText(rule.source_excerpt) ? (
                                  <div className="mt-3 rounded-xl border border-gray-200 bg-white px-3 py-3 text-xs text-gray-600">
                                    <div className="mb-1 font-semibold text-gray-900">
                                      Trecho encontrado no contrato
                                    </div>
                                    <div className="whitespace-pre-wrap">
                                      {maskSensitiveContractPreview(cleanText(rule.source_excerpt))}
                                    </div>
                                  </div>
                                ) : null}

                                <div className="mt-3 flex flex-wrap gap-2">
                                  {isEditing ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void handleReviewContractRule({
                                            ruleId: rule.id,
                                            reviewStatus: "edited",
                                          })
                                        }
                                        disabled={isRuleBusy}
                                        className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        {isRuleBusy && contractRuleActionType === "save-edit"
                                          ? "Salvando..."
                                          : "Salvar ajuste"}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setContractRuleEditingIds((current) => ({
                                            ...current,
                                            [rule.id]: false,
                                          }));
                                          setContractRuleEditDrafts((current) => ({
                                            ...current,
                                            [rule.id]: cleanText(rule.value_text) || "",
                                          }));
                                        }}
                                        disabled={isRuleBusy}
                                        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        Cancelar
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setContractRuleEditingIds((current) => ({
                                            ...current,
                                            [rule.id]: true,
                                          }))
                                        }
                                        disabled={isRuleBusy}
                                        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        Editar texto
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void handleReviewContractRule({
                                            ruleId: rule.id,
                                            reviewStatus: "approved",
                                          })
                                        }
                                        disabled={isRuleBusy}
                                        className="rounded-xl bg-black px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        {isRuleBusy && contractRuleActionType === "approve"
                                          ? "Aprovando..."
                                          : "Aprovar"}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void handleReviewContractRule({
                                            ruleId: rule.id,
                                            reviewStatus: "rejected",
                                          })
                                        }
                                        disabled={isRuleBusy}
                                        className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        {isRuleBusy && contractRuleActionType === "reject"
                                          ? "Ignorando..."
                                          : "Ignorar"}
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })()
                        ))}
                        <div className="text-xs text-gray-500">
                          Revise essas informacoes antes de usar no contrato final.
                        </div>
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      ) : null}

      {rawImportFilesModalTab ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6"
          onClick={() => setRawImportFilesModalTab(null)}
        >
          <div
            className="flex max-h-[82vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 bg-gray-950 px-5 py-4 text-white">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-gray-400">
                  Arquivos do upload inteligente
                </div>
                <h2 className="mt-1 text-lg font-bold">{rawImportFilesModalTitle}</h2>
                <p className="mt-1 text-xs text-gray-300">
                  Excluir aqui remove apenas o arquivo bruto e o vínculo de importação. Os itens já salvos no catálogo permanecem.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setRawImportFilesModalTab(null)}
                className="rounded-xl border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
              >
                Fechar
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {rawImportFilesModalFiles.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-4 text-sm text-gray-600">
                  {rawImportFilesModalEmptyText}
                </div>
              ) : (
                <div className="space-y-2.5">
                  {rawImportFilesModalFiles.map((file, index) => (
                    <div
                      key={buildImportFileKey(file, index)}
                      className="rounded-2xl border border-gray-200 bg-gray-50 p-3"
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0">
                          <div className="break-words text-sm font-semibold text-gray-900">
                            {cleanText(file.original_file_name) || "Arquivo sem nome"}
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            Importado em {formatImportDate(file.created_at)}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-gray-600">
                            <span className="rounded-full bg-white px-2 py-1 ring-1 ring-gray-200">
                              Tipo: {cleanText(file.extension)?.toUpperCase() || cleanText(file.mime_type) || "Não definido"}
                            </span>
                            <span className="rounded-full bg-white px-2 py-1 ring-1 ring-gray-200">
                              Tamanho: {formatFileSize(file.size_bytes)}
                            </span>
                            <span className="rounded-full bg-white px-2 py-1 ring-1 ring-gray-200">
                              Status: {cleanText(file.status) || "Não definido"}
                            </span>
                            <span className="rounded-full bg-white px-2 py-1 ring-1 ring-gray-200">
                              {getImportSummaryText(file.import_summary || null)}
                            </span>
                          </div>
                        </div>

                        <div className="flex shrink-0 flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void handleDownloadImportFile(file)}
                            disabled={
                              downloadingImportFileId === file.id ||
                              deletingImportFileId === file.id
                            }
                            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-800 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {downloadingImportFileId === file.id ? "Gerando..." : "Baixar"}
                          </button>

                          <button
                            type="button"
                            onClick={() => void handleDeleteImportFile(file)}
                            disabled={deletingImportFileId === file.id}
                            className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {deletingImportFileId === file.id ? "Excluindo..." : "Excluir arquivo"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
