
"use client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import OrgGuard from "../../components/OrgGuard";
import { StoreProvider, useStoreContext } from "../../components/StoreProvider";
import { supabase } from "@/lib/supabaseBrowser";
type Step1FormData = {
  store_display_name: string;
  store_description: string;
  city: string;
  state: string;
  service_regions: string;
  commercial_whatsapp: string;
  store_services: string[];
  store_services_other: string;
  service_region_modes: string[];
  service_region_notes: string;
  service_region_primary_mode: string;
  service_region_outside_consultation: boolean;
};
type Step2FormData = {
  pool_types: string;
  sells_chemicals: string;
  sells_accessories: string;
  offers_installation: string;
  offers_technical_visit: string;
  brands_worked: string;
  pool_types_selected: string[];
  pool_types_other: string;
  main_store_brand: string;
};
type Step3FormData = {
  average_installation_time_days: string;
  installation_days_rule: string;
  installation_available_days: string[];
  technical_visit_days_rule: string;
  technical_visit_available_days: string[];
  average_human_response_time: string;
  installation_process_steps: string[];
  installation_process_other: string;
  technical_visit_rules_selected: string[];
  technical_visit_rules_other: string;
  important_limitations_selected: string[];
  important_limitations_other: string;
  sales_flow_start_steps: string[];
  sales_flow_middle_steps: string[];
  sales_flow_final_steps: string[];
  sales_flow_notes: string;
  sales_flow_start_confirmed: boolean;
  sales_flow_middle_confirmed: boolean;
  sales_flow_final_confirmed: boolean;
};
type Step4FormData = {
  average_ticket: string;
  can_offer_discount: string;
  max_discount_percent: string;
  accepted_payment_methods: string[];
  ai_can_send_price_directly: string;
  price_direct_rule: string;
  human_help_discount_cases: string;
  human_help_custom_project_cases: string;
  human_help_payment_cases: string;
  price_direct_conditions: string[];
  price_direct_rule_other: string;
  human_help_discount_cases_selected: string[];
  human_help_discount_cases_other: string;
  human_help_custom_project_cases_selected: string[];
  human_help_custom_project_cases_other: string;
  human_help_payment_cases_selected: string[];
  human_help_payment_cases_other: string;
  price_needs_human_help: string;
  price_talk_mode: string;
  price_must_understand_before: string[];
};
type Step5FormData = {
  responsible_name: string;
  responsible_whatsapp: string;
  ai_should_notify_responsible: string;
  final_activation_notes: string;
  confirm_information_is_correct: boolean;
  responsible_notification_cases: string[];
  responsible_notification_cases_other: string;
  activation_preferences: string[];
  activation_preferences_other: string;
};
type AnswersMap = Record<string, unknown>;
type IntelligentImportSummary = {
  totalFiles: number;
  extractedFiles: number;
  normalizedItems: number;
  dedupedItems: number;
  duplicateItems: number;
};
type IntelligentImportExtractedPreview = {
  fileName: string;
  mimeType: string;
  extension: string;
  textPreview: string;
};
type IntelligentImportNormalizedPreview = {
  type: string;
  sourceFileName: string;
  title: string;
  rawText: string;
  confidence: number;
  metadata: Record<string, string>;
};
type IntelligentImportDedupedPreview = IntelligentImportNormalizedPreview & {
  dedupKey: string;
  duplicateOf?: string;
  isDuplicate: boolean;
};
type IntelligentImportResponse =
  | {
      ok: true;
      message: string;
      summary: IntelligentImportSummary;
      extractedPreview: IntelligentImportExtractedPreview[];
      extractedImagePreview?: Array<{
        sourceFileName: string;
        fileName: string;
        source: string;
        mimeType: string;
        dataUrl: string;
      }>;
      normalizedPreview: IntelligentImportNormalizedPreview[];
      dedupedPreview: IntelligentImportDedupedPreview[];
    }
  | {
      ok: false;
      error: string;
      message: string;
    };
type IntelligentImportSelectedFilePreview = {
  name: string;
  type: string;
  size: number;
  lastModified: number;
};
type PersistedIntelligentImportState = {
  selectedFiles: IntelligentImportSelectedFilePreview[];
  result: IntelligentImportResponse | null;
  successMessage: string | null;
  errorMessage: string | null;
};
type DiscountSettingsRow = {
  store_id: string;
  organization_id: string;
  default_discount_percent: number;
  max_discount_percent: number;
  allow_ask_above_max_discount: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};
type ExistingCatalogItemRow = {
  id: string;
  sku: string | null;
  price_cents: number | null;
  stock_quantity: number | null;
  description: string | null;
  metadata: Record<string, unknown> | null;
};
type Option = {
  value: string;
  label: string;
  hint?: string;
};
const YES_NO_OPTIONS: Option[] = [
  { value: "sim", label: "Sim" },
  { value: "não", label: "Não" },
];
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
const SALES_FLOW_START_OPTIONS: Option[] = [
  { value: "primeiro_atendimento", label: "Primeiro atendimento" },
  { value: "cliente_explica_o_que_quer", label: "Cliente explica o que quer" },
  { value: "cliente_manda_foto_do_local", label: "Cliente manda foto do local" },
  { value: "cliente_pergunta_preco", label: "Cliente pergunta preço" },
  { value: "cliente_pede_visita_tecnica", label: "Cliente pede visita técnica" },
  { value: "cliente_pede_orcamento", label: "Cliente pede orçamento" },
];
const SALES_FLOW_MIDDLE_OPTIONS: Option[] = [
  { value: "entender_melhor_a_necessidade", label: "Entender melhor a necessidade" },
  { value: "mostrar_opcoes_de_piscina", label: "Mostrar opções de piscina" },
  { value: "passar_faixa_de_valor", label: "Passar faixa de valor" },
  { value: "montar_orcamento", label: "Montar orçamento" },
  { value: "tirar_duvidas_tecnicas", label: "Tirar dúvidas técnicas" },
  { value: "negociar_condicao", label: "Negociar condição" },
  { value: "agendar_visita_tecnica", label: "Agendar visita técnica" },
];
const SALES_FLOW_FINAL_OPTIONS: Option[] = [
  { value: "aprovacao_do_orcamento", label: "Aprovação do orçamento" },
  { value: "pagamento_sinal", label: "Pagamento / sinal" },
  { value: "confirmacao_do_pagamento", label: "Confirmação do pagamento" },
  { value: "agendamento_da_instalacao", label: "Agendamento da instalação" },
  { value: "instalacao", label: "Instalação" },
  { value: "entrega_final", label: "Entrega final" },
  { value: "pos_venda", label: "Pós-venda" },
];
const PAYMENT_METHOD_MAIN_OPTIONS: Option[] = [
  { value: "pix", label: "Pix" },
  { value: "cartao_credito", label: "Cartão de crédito" },
  { value: "cartao_debito", label: "Cartão de débito" },
  { value: "boleto", label: "Boleto" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "transferencia", label: "Transferência" },
];
const PAYMENT_METHOD_CONDITION_OPTIONS: Option[] = [
  { value: "parcelado", label: "Aceita parcelamento" },
  { value: "financiamento", label: "Trabalha com financiamento" },
];
const PRICE_DIRECT_BEFORE_OPTIONS: Option[] = [
  { value: "so_apos_entender_objetivo", label: "Só depois de entender o que o cliente quer" },
  {
    value: "so_apos_identificar_interesse_real",
    label: "Só depois de perceber interesse real",
  },
  {
    value: "so_apos_entender_tipo",
    label: "Só depois de entender o tipo de piscina ou produto",
  },
  {
    value: "so_apos_entender_medidas",
    label: "Só depois de entender medidas ou porte do projeto",
  },
  {
    value: "so_apos_entender_instalacao",
    label: "Só depois de entender se precisa instalação",
  },
];
const PRICE_TALK_MODE_OPTIONS: Option[] = [
  {
    value: "quando_cliente_perguntar",
    label: "Pode falar preço quando o cliente perguntar",
  },
  {
    value: "apenas_faixa_inicial",
    label: "Pode falar só uma faixa inicial, não valor fechado",
  },
  { value: "nao_falar_sozinha", label: "Não deve falar preço sozinha" },
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
function parseArrayAnswer(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}
function joinSelectedLabels(values: string[], options: Option[], extra?: string) {
  const labels = values
    .map((value) => options.find((option) => option.value === value)?.label || value)
    .filter(Boolean);
  if (extra?.trim()) labels.push(extra.trim());
  return labels.join(", ");
}
function formatBrazilCurrencyInput(value: string) {
  return value.replace(/[^\d.]/g, "");
}
function formatPercentInput(value: string) {
  return value.replace(/[^\d]/g, "");
}
function formatWhatsappInput(value: string) {
  return value.replace(/[^\d]/g, "");
}
function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
function isImageLikeFileType(fileType: string) {
  return fileType.startsWith("image/");
}
function buildImageFallbackTitle(fileName: string) {
  const normalized = String(fileName ?? "").trim();
  if (!normalized) return "Imagem enviada pela loja";
  const withoutExtension = normalized.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return withoutExtension || normalized;
}
async function createImagePreviewDataUrl(file: File, maxSide = 240) {
  if (typeof window === "undefined" || !isImageLikeFileType(file.type)) return undefined;
  try {
    const objectUrl = URL.createObjectURL(file);
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Falha ao gerar miniatura da imagem."));
      img.src = objectUrl;
    });
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
    canvas.height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Falha ao abrir contexto da miniatura.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const previewDataUrl = canvas.toDataURL("image/jpeg", 0.62);
    URL.revokeObjectURL(objectUrl);
    return previewDataUrl;
  } catch (error) {
    console.error("[OnboardingPage] createImagePreviewDataUrl error:", error);
    return undefined;
  }
}
async function buildSelectedFilePreviews(files: File[]) {
  return files.map((file) => ({
    name: file.name,
    type: file.type || "tipo não informado",
    size: file.size,
    lastModified: file.lastModified,
  }));
}

function persistToLocalStorageSafe(key: string, value: string) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    console.error("[OnboardingPage] localStorage setItem error:", error);
  }
}

function removeFromLocalStorageSafe(key: string) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    console.error("[OnboardingPage] localStorage removeItem error:", error);
  }
}

function buildLightPersistedIntelligentImportState(params: {
  selectedFiles: IntelligentImportSelectedFilePreview[];
  successMessage: string | null;
  errorMessage: string | null;
}): PersistedIntelligentImportState {
  return {
    selectedFiles: params.selectedFiles,
    result: null,
    successMessage: params.successMessage,
    errorMessage: params.errorMessage,
  };
}
function decorateIntelligentImportResultWithImageFallback(
  result: IntelligentImportResponse,
  selectedFiles: IntelligentImportSelectedFilePreview[]
): IntelligentImportResponse {
  if (!result.ok) return result;
  const hasStructuredItems = result.normalizedPreview.length > 0 || result.dedupedPreview.length > 0;
  if (hasStructuredItems) return result;
  const visualSources = selectedFiles.filter((file) => isImageLikeFileType(file.type));
  if (visualSources.length === 0) return result;
  const fallbackItems = visualSources.slice(0, 12).map((file, index) => ({
    type: "image_reference",
    sourceFileName: file.name,
    title: buildImageFallbackTitle(file.name),
    rawText:
      "Imagem enviada como referência visual da loja. Nesta prévia, a importação inteligente preservou o arquivo visual, mas ainda não transformou automaticamente a imagem em um item textual estruturado.",
    confidence: 0.42,
    metadata: {
      origem: "imagem_enviada",
      mime_type: file.type || "image/*",
      modo: "fallback_visual_frontend",
    },
  }));
  return {
    ...result,
    message: result.message || "Importação inteligente processada com apoio visual para imagens.",
    normalizedPreview: fallbackItems,
    dedupedPreview: fallbackItems.map((item, index) => ({
      ...item,
      dedupKey: `${item.sourceFileName}:${index}`,
      duplicateOf: undefined,
      isDuplicate: false,
    })),
  };
}

function buildFrontendNormalizedPreviewFromItems(
  items: Array<IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview>
): IntelligentImportNormalizedPreview[] {
  return items.map((item) => ({
    type: item.type,
    sourceFileName: item.sourceFileName,
    title: item.title,
    rawText: item.rawText,
    confidence: item.confidence,
    metadata: item.metadata ?? {},
  }));
}

function buildFrontendDedupedPreviewFromItems(
  items: Array<IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview>
): IntelligentImportDedupedPreview[] {
  return items.map((item, index) => ({
    type: item.type,
    sourceFileName: item.sourceFileName,
    title: item.title,
    rawText: item.rawText,
    confidence: item.confidence,
    metadata: item.metadata ?? {},
    dedupKey: `${buildImportedSaveKey(item)}::frontend::${index}`,
    duplicateOf: undefined,
    isDuplicate: false,
  }));
}

function normalizeIntelligentImportResultForFrontend(
  result: IntelligentImportResponse
): IntelligentImportResponse {
  if (!result.ok) return result;

  const rawSourceItems =
    result.dedupedPreview.length > 0
      ? result.dedupedPreview.filter((item) => !item.isDuplicate)
      : result.normalizedPreview;

  const filteredSourceItems = rawSourceItems.filter((item) => !shouldSkipImportedItem(item));
  const saveReadyItems = dedupeImportedItemsForSave(filteredSourceItems);

  if (saveReadyItems.length === 0) {
    return result;
  }

  const discardedItems = Math.max(0, rawSourceItems.length - saveReadyItems.length);

  return {
    ...result,
    message:
      discardedItems > 0
        ? `${
            result.message || "Importação inteligente processada com sucesso."
          } A prévia foi ajustada para mostrar apenas os itens prontos para salvar.`
        : result.message,
    summary: {
      ...result.summary,
      normalizedItems: saveReadyItems.length,
      dedupedItems: saveReadyItems.length,
      duplicateItems: discardedItems,
    },
    normalizedPreview: buildFrontendNormalizedPreviewFromItems(saveReadyItems),
    dedupedPreview: buildFrontendDedupedPreviewFromItems(saveReadyItems),
  };
}

type ImportedDestination = "pool" | "acessorios" | "quimicos" | "outros";
type ImportedCatalogCategory = "acessorios" | "quimicos" | "outros";
function normalizeImportedCatalogCategory(value: string): ImportedCatalogCategory {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    normalized.includes("quim") ||
    normalized.includes("cloro") ||
    normalized.includes("algicida") ||
    normalized.includes("ph") ||
    normalized.includes("elevador") ||
    normalized.includes("redutor") ||
    normalized.includes("clarificante") ||
    normalized.includes("sulfato")
  ) {
    return "quimicos";
  }
  if (
    normalized.includes("acessor") ||
    normalized.includes("aspirador") ||
    normalized.includes("escova") ||
    normalized.includes("peneira") ||
    normalized.includes("dispositivo") ||
    normalized.includes("led") ||
    normalized.includes("lumin") ||
    normalized.includes("mangueira") ||
    normalized.includes("clorador") ||
    normalized.includes("hidromassagem") ||
    normalized.includes("nicho") ||
    normalized.includes("retorno")
  ) {
    return "acessorios";
  }
  return "outros";
}
function inferImportedDestination(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
): ImportedDestination {
  const source = [
    item.type,
    item.title,
    item.rawText,
    item.sourceFileName,
    ...Object.values(item.metadata ?? {}),
  ]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");
  const chemicalScore =
    (source.includes("quim") ? 4 : 0) +
    (source.includes("cloro") ? 4 : 0) +
    (source.includes("algicida") ? 4 : 0) +
    (source.includes("clarificante") ? 4 : 0) +
    (source.includes("sulfato") ? 4 : 0) +
    (source.includes("elevador de ph") ? 4 : 0) +
    (source.includes("redutor de ph") ? 4 : 0) +
    (source.includes("ph") ? 2 : 0);
  const accessoryScore =
    (source.includes("acessor") ? 4 : 0) +
    (source.includes("peneira") ? 4 : 0) +
    (source.includes("escova") ? 4 : 0) +
    (source.includes("aspirador") ? 4 : 0) +
    (source.includes("dispositivo") ? 4 : 0) +
    (source.includes("led") ? 3 : 0) +
    (source.includes("mangueira") ? 3 : 0) +
    (source.includes("clorador") ? 3 : 0) +
    (source.includes("nicho") ? 3 : 0) +
    (source.includes("retorno") ? 3 : 0);
  const hasPoolKeyword =
    source.includes("piscina") ||
    source.includes("spa") ||
    source.includes("vinil") ||
    source.includes("fibra") ||
    source.includes("alvenaria") ||
    source.includes("pastilha");
  const poolScore =
    (source.includes("piscina") ? 4 : 0) +
    (source.includes("fibra") ? 2 : 0) +
    (source.includes("vinil") ? 2 : 0) +
    (source.includes("alvenaria") ? 2 : 0) +
    (source.includes("pastilha") ? 2 : 0) +
    (source.includes("profundidade") ? 2 : 0) +
    (source.includes("capacidade") ? 2 : 0) +
    (source.includes("litros") ? 2 : 0) +
    (/\b\d+[\.,]?\d*\s*x\s*\d+[\.,]?\d*\s*m\b/i.test(source) ? 3 : 0) +
    (/\b\d+[\.,]?\d*\s*m\s*di[âa]m/i.test(source) ? 3 : 0);
  if (chemicalScore >= 4 && chemicalScore >= accessoryScore && chemicalScore >= poolScore) {
    return "quimicos";
  }
  if (accessoryScore >= 4 && accessoryScore > chemicalScore && accessoryScore >= poolScore) {
    return "acessorios";
  }
  if (hasPoolKeyword && poolScore >= 6) {
    return "pool";
  }
  const category = normalizeImportedCatalogCategory(source);
  return category;
}

function extractImportedLabeledValue(
  source: string,
  labels: string[]
) {
  const lines = String(source || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const label of labels) {
    const normalizedLabel = normalizeImportedLoose(label);
    for (const line of lines) {
      const normalizedLine = normalizeImportedLoose(line);
      if (!normalizedLine) continue;
      if (
        normalizedLine.startsWith(`${normalizedLabel} `) ||
        normalizedLine.startsWith(`${normalizedLabel}:`) ||
        normalizedLine.startsWith(`${normalizedLabel} -`)
      ) {
        const value = line.replace(/^\s*[^:–-]+\s*[:–-]\s*/u, "").trim();
        if (value) return value;
      }
    }
  }

  return "";
}

function extractImportedFirstCurrencyValue(value: string | null | undefined) {
  const source = String(value || "");
  if (!source) return null;

  const match =
    source.match(/r\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[\.,]?\d*)/i) ||
    source.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[\.,]?\d*)/);

  if (!match) return null;
  return parseImportedDecimal(match[1]);
}

function extractImportedExcelLikeName(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const explicit = [
    extractMetadataValue(item, ["nome_do_produto", "nome do produto", "product_name", "productName", "name", "nome", "title", "titulo"]),
    extractImportedLabeledValue(String(item.rawText || ""), ["Nome do produto", "Produto", "Nome"]),
  ]
    .map((value) => String(value || "").trim())
    .find(Boolean);

  if (explicit) return explicit.slice(0, 160);
  return "";
}

function extractImportedCatalogSku(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const source = String(item.rawText || "");
  return (
    extractMetadataValue(item, ["sku", "codigo", "código"]) ||
    extractImportedLabeledValue(source, ["SKU", "Código", "Codigo"]) ||
    ""
  ).slice(0, 120);
}

function extractImportedCatalogStockQuantity(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const source = String(item.rawText || "");

  const labeledStock =
    extractImportedLabeledValue(source, [
      "Quantidade atual",
      "Estoque inicial",
      "Quantidade",
      "Stock inicial",
      "Stock quantity",
    ]) ||
    extractMetadataValue(item, [
      "quantidade_atual",
      "quantidade atual",
      "estoque_inicial",
      "estoque inicial",
      "stock_quantity",
    ]);

  const parsedLabeledStock = parseImportedDecimal(labeledStock);
  if (parsedLabeledStock != null) {
    return Math.max(0, Math.round(parsedLabeledStock));
  }

  const fallbackStock =
    extractImportedLabeledValue(source, ["Estoque", "Stock"]) ||
    extractMetadataValue(item, ["stock", "estoque"]);

  const parsedFallbackStock = parseImportedDecimal(fallbackStock);
  if (parsedFallbackStock == null) return 0;
  return Math.max(0, Math.round(parsedFallbackStock));
}

function buildImportedSaveKey(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const destination = resolveImportedDestination(item);
  if (destination === "pool") {
    return `pool::${normalizeImportedLoose(buildImportedPoolName(item))}`;
  }

  const sku = normalizeImportedLoose(extractImportedCatalogSku(item));
  if (sku) {
    return `catalog::${destination}::sku::${sku}`;
  }

  return `catalog::${destination}::name::${normalizeImportedLoose(buildImportedCatalogName(item))}`;
}

function buildImportedRuntimeIdentityKeys(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const destination = resolveImportedDestination(item);

  if (destination === "pool") {
    const poolName = normalizeImportedLoose(buildImportedPoolName(item));
    return poolName ? [`pool::${poolName}`] : [];
  }

  const itemName = normalizeImportedLoose(buildImportedCatalogName(item));
  const sku = normalizeImportedLoose(extractImportedCatalogSku(item));

  const keys = [
    sku ? `catalog::${destination}::sku::${sku}` : "",
    itemName ? `catalog::${destination}::name::${itemName}` : "",
  ].filter(Boolean);

  return Array.from(new Set(keys));
}

function scoreImportedItemForSave(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const description = buildImportedCatalogDescription(item) || buildImportedPoolDescription(item) || "";
  const hasSku = Boolean(extractImportedCatalogSku(item));
  const hasPrice = extractImportedCatalogPriceCents(item) != null;
  const stockQuantity = extractImportedCatalogStockQuantity(item);
  const nonEmptyMetadata = Object.values(item.metadata ?? {}).filter(
    (value) => typeof value === "string" && value.trim()
  ).length;

  return (
    (hasSku ? 120 : 0) +
    (hasPrice ? 90 : 0) +
    (stockQuantity != null && stockQuantity > 0 ? 60 : 0) +
    Math.min(description.length, 600) +
    nonEmptyMetadata * 4 +
    (item.confidence ?? 0) * 10
  );
}

function dedupeImportedItemsForSave(
  items: Array<IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview>
) {
  const bestByKey = new Map<string, {
    item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview;
    score: number;
    index: number;
  }>();

  items.forEach((item, index) => {
    const key = buildImportedSaveKey(item);
    const score = scoreImportedItemForSave(item);
    const current = bestByKey.get(key);
    if (!current || score > current.score) {
      bestByKey.set(key, { item, score, index });
    }
  });

  const exactDedupedItems = Array.from(bestByKey.values())
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.item);

  const bestByRuntimeIdentity = new Map<string, {
    item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview;
    score: number;
    index: number;
  }>();

  exactDedupedItems.forEach((item, index) => {
    const identityKeys = buildImportedRuntimeIdentityKeys(item);
    const score = scoreImportedItemForSave(item);

    if (identityKeys.length === 0) {
      bestByRuntimeIdentity.set(`fallback::${index}`, { item, score, index });
      return;
    }

    const currentEntries = identityKeys
      .map((key) => bestByRuntimeIdentity.get(key))
      .filter(Boolean) as Array<{
      item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview;
      score: number;
      index: number;
    }>;

    const bestCurrent = currentEntries.sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.index - right.index;
    })[0];

    if (!bestCurrent || score > bestCurrent.score) {
      for (const key of identityKeys) {
        bestByRuntimeIdentity.set(key, { item, score, index });
      }
    }
  });

  const uniqueItems = new Map<string, {
    item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview;
    score: number;
    index: number;
  }>();

  for (const entry of bestByRuntimeIdentity.values()) {
    const stableKey = buildImportedSaveKey(entry.item);
    const current = uniqueItems.get(stableKey);
    if (!current || entry.score > current.score) {
      uniqueItems.set(stableKey, entry);
    }
  }

  return Array.from(uniqueItems.values())
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.item);
}

function buildImportedCatalogName(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const excelLikeName = extractImportedExcelLikeName(item);
  if (excelLikeName) return excelLikeName;

  const title = String(item.title ?? "").trim();
  if (title && !/\.xlsx?\s*[•·-]\s*item\s*\d+/i.test(title)) {
    return title.slice(0, 160);
  }

  const raw = String(item.rawText ?? "").trim();
  if (!raw) return "Item importado";

  const fromRaw = extractImportedLabeledValue(raw, ["Nome do produto", "Produto", "Nome"]);
  if (fromRaw) return fromRaw.slice(0, 160);

  return raw.slice(0, 160);
}

function dedupeDescriptionLines(lines: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    const key = normalizeImportedLoose(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(line.trim());
  }
  return result;
}
function sanitizeImportedDescriptionText(
  source: string,
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const title = buildImportedCatalogName(item);
  const titleLoose = normalizeImportedLoose(title);
  const rawLines = String(source || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const filtered = rawLines.filter((line) => {
    const normalized = normalizeImportedLoose(line);
    if (!normalized) return false;
    if (normalized === titleLoose) return false;

    const blockedStarts = [
      "categoria ",
      "categoria:",
      "nome ",
      "nome:",
      "nome do produto ",
      "nome do produto:",
      "linha ",
      "linha:",
      "aplicacao ",
      "aplicacao:",
      "aplicação ",
      "aplicação:",
      "embalagem ",
      "embalagem:",
      "preco ",
      "preco:",
      "preço ",
      "preço:",
      "valor ",
      "valor:",
      "medidas ",
      "medidas:",
      "profundidade ",
      "profundidade:",
      "capacidade ",
      "capacidade:",
      "material ",
      "material:",
      "formato ",
      "formato:",
      "marca ",
      "marca:",
      "sku ",
      "sku:",
      "peso ",
      "peso:",
      "peso volume ",
      "peso volume:",
      "peso/volume ",
      "peso/volume:",
      "dosagem ",
      "dosagem:",
      "cor ",
      "cor:",
      "uso ",
      "uso:",
      "quantidade atual ",
      "quantidade atual:",
      "estoque minimo ",
      "estoque minimo:",
      "estoque máximo ",
      "estoque máximo:",
      "estoque maximo ",
      "estoque maximo:",
      "estoque ",
      "estoque:",
      "controlar estoque ",
      "controlar estoque:",
      "codigo de barras ",
      "codigo de barras:",
      "código de barras ",
      "código de barras:",
      "barcode ",
      "barcode:",
      "observacao ",
      "observacao:",
      "observação ",
      "observação:",
    ];

    if (blockedStarts.some((value) => normalized.startsWith(value))) {
      return false;
    }

    const blockedIncludes = [
      "arquivo de teste",
      "validar upload inteligente",
      "validar leitura",
      "upload inteligente",
      "categoria esperada no sistema",
      "salvar em configuracoes",
      "guia leitura",
      "guia de leitura",
      "aba guia leitura",
      "aba guia de leitura",
      "planilha estoque",
      "aba estoque",
      "sheet estoque",
      "catalogo_quimicos",
      "catalogo quimicos",
      "planilha catalogo quimicos",
      "planilha catalogo_quimicos",
      "=== item",
      "controlar estoque ativo",
    ];

    if (blockedIncludes.some((value) => normalized.includes(value))) {
      return false;
    }

    return true;
  });

  const joined = dedupeDescriptionLines(filtered).join("\n").trim();
  return joined ? joined.slice(0, 4000) : null;
}
function buildImportedCleanDescription(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const metadataCandidates = [
    extractMetadataValue(item, ["clean_description", "cleanDescription"]),
    extractMetadataValue(item, ["descricao", "descrição", "description"]),
    extractMetadataValue(item, ["notes", "observacao", "observação"]),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  for (const candidate of metadataCandidates) {
    const cleaned = sanitizeImportedDescriptionText(candidate, item);
    if (cleaned) return cleaned;
  }
  return sanitizeImportedDescriptionText(String(item.rawText || ""), item);
}


function escapeImportedRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanupImportedDescriptionLine(value: string) {
  return String(value || "")
    .replace(/\s*[-–—]+\s*item\s*\d+\b/giu, " ")
    .replace(/\bitem\s*\d+\b/giu, " ")
    .replace(/^\s*(descri[cç][aã]o curta|descri[cç][aã]o resumida|descri[cç][aã]o|observa[cç][oõ]es|observa[cç][aã]o|obs\.?|notas?|notes?)\s*[:–-]\s*/giu, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([,.;:])\1+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^[-–—:;,\.\s]+/u, "")
    .replace(/[-–—:;,\.\s]+$/u, "")
    .trim();
}

function normalizeImportedNarrativeLine(value: string) {
  const cleaned = cleanupImportedDescriptionLine(value);
  if (!cleaned) return "";
  if (/^item\s*\d+$/iu.test(cleaned)) return "";
  return cleaned;
}

function stripImportedRepeatedDetailsFromText(
  source: string,
  details: Array<{ label: string; value: string }>
) {
  let cleaned = String(source || "");

  for (const detail of details) {
    const value = String(detail.value || "").trim();
    if (!value) continue;

    const labelPattern = escapeImportedRegExp(detail.label);
    const valuePattern = escapeImportedRegExp(value);

    cleaned = cleaned.replace(
      new RegExp(`(?:^|\\s)${labelPattern}\\s*[:–-]\\s*${valuePattern}(?=$|[\\s,.;])`, "giu"),
      " "
    );
  }

  const cleanedLines = cleaned
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => normalizeImportedNarrativeLine(line))
    .filter(Boolean);

  return cleanedLines.join("\n").trim();
}

function sanitizeImportedDescriptionText(
  source: string,
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const title = buildImportedCatalogName(item);
  const titleLoose = normalizeImportedLoose(title);
  const rawLines = String(source || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => normalizeImportedNarrativeLine(line))
    .filter(Boolean);

  const filtered = rawLines.filter((line) => {
    const normalized = normalizeImportedLoose(line);
    if (!normalized) return false;
    if (normalized === titleLoose) return false;

    const blockedStarts = [
      "categoria ",
      "categoria:",
      "nome ",
      "nome:",
      "nome do produto ",
      "nome do produto:",
      "linha ",
      "linha:",
      "aplicacao ",
      "aplicacao:",
      "aplicação ",
      "aplicação:",
      "embalagem ",
      "embalagem:",
      "preco ",
      "preco:",
      "preço ",
      "preço:",
      "valor ",
      "valor:",
      "medidas ",
      "medidas:",
      "profundidade ",
      "profundidade:",
      "capacidade ",
      "capacidade:",
      "material ",
      "material:",
      "formato ",
      "formato:",
      "marca ",
      "marca:",
      "sku ",
      "sku:",
      "peso ",
      "peso:",
      "peso volume ",
      "peso volume:",
      "peso/volume ",
      "peso/volume:",
      "dosagem ",
      "dosagem:",
      "cor ",
      "cor:",
      "uso ",
      "uso:",
      "quantidade atual ",
      "quantidade atual:",
      "estoque minimo ",
      "estoque minimo:",
      "estoque máximo ",
      "estoque máximo:",
      "estoque maximo ",
      "estoque maximo:",
      "estoque ",
      "estoque:",
      "controlar estoque ",
      "controlar estoque:",
      "codigo de barras ",
      "codigo de barras:",
      "código de barras ",
      "código de barras:",
      "barcode ",
      "barcode:",
    ];

    if (blockedStarts.some((value) => normalized.startsWith(value))) {
      return false;
    }

    const blockedIncludes = [
      "arquivo de teste",
      "validar upload inteligente",
      "validar leitura",
      "upload inteligente",
      "categoria esperada no sistema",
      "salvar em configuracoes",
      "salvar em configurações",
      "guia leitura",
      "guia de leitura",
      "aba guia leitura",
      "aba guia de leitura",
      "planilha estoque",
      "aba estoque",
      "sheet estoque",
      "catalogo_quimicos",
      "catalogo quimicos",
      "catálogo químicos",
      "planilha catalogo quimicos",
      "planilha catalogo_quimicos",
      "=== item",
      "controlar estoque ativo",
    ];

    if (blockedIncludes.some((value) => normalized.includes(value))) {
      return false;
    }

    return true;
  });

  const joined = dedupeDescriptionLines(filtered).join("\n").trim();
  return joined ? joined.slice(0, 4000) : null;
}

function buildImportedCleanDescription(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const metadataCandidates = [
    extractMetadataValue(item, ["clean_description", "cleanDescription"]),
    extractMetadataValue(item, ["descricao", "descrição", "description"]),
    extractMetadataValue(item, ["notes", "observacao", "observação"]),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  for (const candidate of metadataCandidates) {
    const cleaned = sanitizeImportedDescriptionText(candidate, item);
    if (cleaned) return cleaned;
  }

  return sanitizeImportedDescriptionText(String(item.rawText || ""), item);
}

function buildImportedApplicationSupportLine(application: string) {
  const normalized = normalizeImportedLoose(application);
  if (!normalized) return "";

  if (normalized.includes("acabamento")) {
    return "Ajuda no acabamento e na manutenção visual da piscina.";
  }
  if (normalized.includes("tratamento de superficie") || normalized.includes("tratamento superficie")) {
    return "Ajuda na remoção de resíduos e no tratamento de superfície.";
  }
  if (normalized.includes("piscinas especiais")) {
    return "Indicado para rotinas de manutenção em piscinas especiais.";
  }
  if (normalized.includes("uso preventivo")) {
    return "Pode ser usado na rotina preventiva de manutenção.";
  }
  if (normalized.includes("tratamento corretivo")) {
    return "Indicado para correções pontuais na água quando necessário.";
  }

  return application.trim() ? `Indicado para ${application.trim().toLowerCase()}.` : "";
}

function buildImportedCatalogDescription(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const source = String(item.rawText || "");
  const application =
    extractMetadataValue(item, ["aplicacao", "aplicação", "application"]) ||
    extractImportedLabeledValue(source, ["Aplicação", "Aplicacao"]);
  const packageValue =
    extractMetadataValue(item, ["embalagem", "package", "packaging"]) ||
    extractImportedLabeledValue(source, ["Embalagem"]);
  const dosageValue =
    extractMetadataValue(item, ["dosagem", "dose", "diluição", "diluicao"]) ||
    extractImportedLabeledValue(source, ["Dosagem", "Dose"]);
  const shortDescription =
    extractMetadataValue(item, ["descricao_curta", "descrição curta", "short_description"]) ||
    extractImportedLabeledValue(source, ["Descrição curta", "Descricao curta", "Descrição", "Descricao"]);
  const notesValue =
    extractMetadataValue(item, ["observacoes", "observações", "notes", "observacao", "observação"]) ||
    extractImportedLabeledValue(source, ["Observações", "Observacoes", "Notas"]);

  const detailsToStrip = [
    { label: "Aplicação", value: application },
    { label: "Aplicacao", value: application },
    { label: "Embalagem", value: packageValue },
    { label: "Dosagem", value: dosageValue },
  ];

  const narrativePool = [shortDescription || "", buildImportedCleanDescription(item) || "", notesValue || ""]
    .map((value) => stripImportedRepeatedDetailsFromText(value, detailsToStrip))
    .map((value) => sanitizeImportedDescriptionText(value, item) || "")
    .flatMap((value) => value.split("\n"))
    .map((value) => normalizeImportedNarrativeLine(value))
    .filter(Boolean);

  const narrativeLines = dedupeDescriptionLines(narrativePool).filter((line) => {
    const normalized = normalizeImportedLoose(line);
    if (!normalized) return false;
    if (/^item\s*\d+$/iu.test(line)) return false;
    return true;
  });

  const applicationSupportLine = buildImportedApplicationSupportLine(application);
  const shouldAddSupportLine =
    Boolean(applicationSupportLine) &&
    !narrativeLines.some((line) => {
      const normalizedLine = normalizeImportedLoose(line);
      const normalizedSupport = normalizeImportedLoose(applicationSupportLine);
      const normalizedApplication = normalizeImportedLoose(application);
      return (
        normalizedLine === normalizedSupport ||
        (normalizedApplication && normalizedLine.includes(normalizedApplication))
      );
    }) &&
    (narrativeLines.length <= 1 || narrativeLines.join(" ").length < 90);

  const finalLines = dedupeDescriptionLines([
    ...narrativeLines,
    shouldAddSupportLine ? applicationSupportLine : "",
  ]).slice(0, 4);

  return finalLines.join("\n").trim() || null;
}

function parseImportedDecimal(value: string | null | undefined) {
  if (value == null) return null;

  const source = String(value)
    .trim()
    .replace(/[^\d,.-]/g, "");

  if (!source) return null;

  const lastComma = source.lastIndexOf(",");
  const lastDot = source.lastIndexOf(".");

  let normalized = source;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    normalized =
      decimalSeparator === ","
        ? source.replace(/\./g, "").replace(",", ".")
        : source.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const fractional = source.slice(lastComma + 1).replace(/\D/g, "");
    normalized =
      fractional.length > 0 && fractional.length <= 2
        ? source.replace(/\./g, "").replace(",", ".")
        : source.replace(/,/g, "");
  } else if (lastDot >= 0) {
    const fractional = source.slice(lastDot + 1).replace(/\D/g, "");
    normalized =
      fractional.length > 0 && fractional.length <= 2
        ? source.replace(/,/g, "")
        : source.replace(/\./g, "");
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractImportedBestMoneyValue(value: string | null | undefined) {
  const source = String(value || "").trim();
  if (!source) return null;

  const currencyMatch = source.match(/r\$\s*([\d.,]+)/i);
  if (currencyMatch) {
    const parsedCurrency = parseImportedDecimal(currencyMatch[1]);
    if (parsedCurrency != null) return parsedCurrency;
  }

  const decimalMatch = source.match(/(\d+[.,]\d{2})/);
  if (decimalMatch) {
    const parsedDecimal = parseImportedDecimal(decimalMatch[1]);
    if (parsedDecimal != null) return parsedDecimal;
  }

  const normalized = normalizeImportedLoose(source);
  const integerTokens = source.match(/\d+/g) ?? [];
  if (
    (normalized.includes("preco") ||
      normalized.includes("valor") ||
      normalized.includes("price")) &&
    integerTokens.length >= 2
  ) {
    const cents = integerTokens[integerTokens.length - 1];
    const integer = integerTokens[integerTokens.length - 2];

    if (cents.length === 2) {
      const reconstructed = parseImportedDecimal(`${integer}.${cents}`);
      if (reconstructed != null) return reconstructed;
    }
  }

  const genericParsed = extractImportedFirstCurrencyValue(source);
  if (genericParsed != null) return genericParsed;

  const numericMatches = source.match(/\d+(?:[.,]\d+)?/g) ?? [];
  if (numericMatches.length === 1) {
    const parsedSingle = parseImportedDecimal(numericMatches[0]);
    if (parsedSingle != null) return parsedSingle;
  }

  return null;
}
function extractImportedPoolMetrics(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const source = [item.title, item.rawText, ...Object.values(item.metadata ?? {})]
    .map((value) => String(value ?? ""))
    .join(" ");
  const lowered = source.toLowerCase();
  let width: number | null = null;
  let length: number | null = null;
  let depth: number | null = null;
  let capacity: number | null = null;
  let price: number | null = null;
  const rectMatch = source.match(/(\d+[\.,]?\d*)\s*x\s*(\d+[\.,]?\d*)\s*m/i);
  if (rectMatch) {
    width = parseImportedDecimal(rectMatch[1]);
    length = parseImportedDecimal(rectMatch[2]);
  }
  const diamMatch = source.match(/(\d+[\.,]?\d*)\s*m\s*di[âa]m/i);
  if (diamMatch) {
    width = parseImportedDecimal(diamMatch[1]);
    length = parseImportedDecimal(diamMatch[1]);
  }
  const depthMatch =
    source.match(/profundidade\s*(?:de|do|da)?\s*(\d+[\.,]?\d*)\s*m/i) ||
    source.match(/prof\.?\s*(\d+[\.,]?\d*)\s*m/i);
  if (depthMatch) {
    depth = parseImportedDecimal(depthMatch[1]);
  }
  const capacityMatch =
    source.match(/capacidade(?:\s+estimada|\s+m[áa]xima|\s+aproximada)?\s*(?:de)?\s*(\d{1,3}(?:\.\d{3})+|\d+[\.,]?\d*)\s*(?:l|litros?)?/i) ||
    source.match(/(\d{1,3}(?:\.\d{3})+|\d+[\.,]?\d*)\s*(?:l|litros?)\b/i);
  if (capacityMatch) {
    capacity = parseImportedDecimal(capacityMatch[1]);
  }
  const priceMatch =
    source.match(/r\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[\.,]?\d*)/i) ||
    source.match(/pre[cç]o\s*(?:estimado|aproximado)?\s*(?:de)?\s*r\$?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+[\.,]?\d*)/i);
  if (priceMatch) {
    price = parseImportedDecimal(priceMatch[1]);
  }
  let material = "fibra";
  if (lowered.includes("vinil")) material = "vinil";
  else if (lowered.includes("alvenaria")) material = "alvenaria";
  else if (lowered.includes("pastilha")) material = "pastilha";
  else if (lowered.includes("fibra")) material = "fibra";
  let shape = "retangular";
  if (lowered.includes("diâm") || lowered.includes("diam") || lowered.includes("redonda")) {
    shape = "redonda";
  } else if (lowered.includes("oval")) {
    shape = "oval";
  } else if (lowered.includes("raia")) {
    shape = "raia";
  } else if (lowered.includes("retangular")) {
    shape = "retangular";
  }
  return {
    width_m: width,
    length_m: length,
    depth_m: depth,
    max_capacity_l: capacity,
    material,
    shape,
    price,
  };
}

function extractImportedCatalogPriceCents(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const source = String(item.rawText || "");
  const metadataEntries = Object.entries(item.metadata ?? {});
  const normalizedMetadataEntries = metadataEntries.map(([key, value]) => [
    normalizeImportedLoose(key),
    String(value ?? "").trim(),
  ] as const);

  for (const [normalizedKey, rawValue] of normalizedMetadataEntries) {
    if (
      normalizedKey.includes("price cents") ||
      normalizedKey.includes("price_cents") ||
      normalizedKey.includes("preco centavos") ||
      normalizedKey.includes("preco_centavos")
    ) {
      const centsValue = Number(String(rawValue).replace(/[^\d-]/g, ""));
      if (Number.isFinite(centsValue) && centsValue > 0) {
        return Math.round(centsValue);
      }
    }
  }

  const labeledPrice =
    extractImportedLabeledValue(source, [
      "Preço venda (R$)",
      "Preço de venda (R$)",
      "Preço venda",
      "Preço de venda",
      "Preco venda (R$)",
      "Preco de venda (R$)",
      "Preco venda",
      "Preco de venda",
      "Preço final (R$)",
      "Preço final",
      "Preco final (R$)",
      "Preco final",
      "Preço unitário (R$)",
      "Preço unitário",
      "Preco unitario (R$)",
      "Preco unitario",
      "Valor unitário",
      "Valor unitario",
      "Preço",
      "Preco",
      "Valor",
    ]) ||
    extractMetadataValue(item, [
      "preco_venda",
      "preco_de_venda",
      "preço_venda",
      "preço_de_venda",
      "preço venda",
      "preço de venda",
      "preco venda",
      "preco de venda",
      "preco_final",
      "preço_final",
      "preço final",
      "preco final",
      "preco_unitario",
      "preço_unitário",
      "preço unitário",
      "preco unitario",
      "valor_venda",
      "valor venda",
      "valor_unitario",
      "valor unitario",
      "price",
      "valor",
    ]);

  const directPrice = extractImportedBestMoneyValue(labeledPrice);
  if (directPrice != null) return Math.round(directPrice * 100);

  const metadataPriceCandidates = normalizedMetadataEntries
    .filter(([normalizedKey, rawValue]) => {
      if (!rawValue) return false;
      return (
        normalizedKey.includes("preco") ||
        normalizedKey.includes("valor") ||
        normalizedKey.includes("price")
      );
    })
    .map(([, rawValue]) => rawValue);

  for (const candidate of metadataPriceCandidates) {
    const parsedCandidate = extractImportedBestMoneyValue(candidate);
    if (parsedCandidate != null) return Math.round(parsedCandidate * 100);
  }

  const lines = source
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const priceLines = lines.filter((line) => {
    const normalized = normalizeImportedLoose(line);
    return (
      normalized.startsWith("preco venda") ||
      normalized.startsWith("preco de venda") ||
      normalized.startsWith("preço venda") ||
      normalized.startsWith("preço de venda") ||
      normalized.startsWith("preco final") ||
      normalized.startsWith("preço final") ||
      normalized.startsWith("preco unitario") ||
      normalized.startsWith("preço unitário") ||
      normalized.startsWith("valor unitario") ||
      normalized === "preco" ||
      normalized.startsWith("preco ") ||
      normalized === "preço" ||
      normalized.startsWith("preço ") ||
      normalized === "valor" ||
      normalized.startsWith("valor ") ||
      line.includes("R$")
    );
  });

  for (const line of priceLines) {
    const parsedLineValue = extractImportedBestMoneyValue(line);
    if (parsedLineValue != null) return Math.round(parsedLineValue * 100);
  }

  const fullSource = [item.title, item.rawText, ...Object.values(item.metadata ?? {})]
    .map((value) => String(value ?? ""))
    .join(" ");

  const salePriceMatch =
    fullSource.match(
      /pre[cç]o\s+(?:de\s+)?venda(?:\s*\(r\$\))?\s*[:\-]?\s*r?\$?\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d+)?)/i
    ) ||
    fullSource.match(
      /valor\s+(?:de\s+)?venda\s*[:\-]?\s*r?\$?\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d+)?)/i
    );

  if (salePriceMatch) {
    const parsedSale = parseImportedDecimal(salePriceMatch[1]);
    if (parsedSale != null) return Math.round(parsedSale * 100);
  }

  const genericPriceMatch =
    fullSource.match(/r\$\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d+)?)/i) ||
    fullSource.match(
      /pre[cç]o\s*(?:estimado|aproximado)?\s*(?:de)?\s*r\$?\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d+)?)/i
    );

  if (!genericPriceMatch) return null;

  const parsedGeneric = parseImportedDecimal(genericPriceMatch[1]);
  if (parsedGeneric == null) return null;

  return Math.round(parsedGeneric * 100);
}

function pickRelatedExtractedImages(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview,
  extractedImageBuckets: Map<
    string,
    Array<{
      id: string;
      fileName: string;
      mimeType: string;
      dataUrl: string;
      sourceFileName: string;
    }>
  >,
  extractedImageBucketCursors: Map<string, number>,
  extractedImageSequence: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    dataUrl: string;
    sourceFileName: string;
  }>,
  consumedExtractedImageIds: Set<string>,
  totalSourceItems: number
) {
  const sourceKey = String(item.sourceFileName || "").trim().toLowerCase();

  const tryConsumeFromBucket = (bucketKey: string) => {
    const bucket = extractedImageBuckets.get(bucketKey);
    if (!bucket || bucket.length === 0) {
      return [] as Array<{ fileName: string; mimeType: string; dataUrl: string }>;
    }

    let cursor = extractedImageBucketCursors.get(bucketKey) ?? 0;

    while (cursor < bucket.length) {
      const candidate = bucket[cursor];
      cursor += 1;
      extractedImageBucketCursors.set(bucketKey, cursor);

      if (!candidate || consumedExtractedImageIds.has(candidate.id)) {
        continue;
      }

      consumedExtractedImageIds.add(candidate.id);
      return [
        {
          fileName: candidate.fileName,
          mimeType: candidate.mimeType,
          dataUrl: candidate.dataUrl,
        },
      ];
    }

    return [] as Array<{ fileName: string; mimeType: string; dataUrl: string }>;
  };

  if (sourceKey) {
    const direct = tryConsumeFromBucket(sourceKey);
    if (direct.length > 0) return direct;
  }

  const normalizedSourceKey = sourceKey.replace(/\.[^.]+$/, "");
  if (normalizedSourceKey) {
    for (const key of extractedImageBuckets.keys()) {
      const normalizedKey = key.replace(/\.[^.]+$/, "");
      if (
        normalizedKey === normalizedSourceKey ||
        normalizedKey.includes(normalizedSourceKey) ||
        normalizedSourceKey.includes(normalizedKey)
      ) {
        const related = tryConsumeFromBucket(key);
        if (related.length > 0) return related;
      }
    }
  }

  if (totalSourceItems === 1) {
    for (const key of extractedImageBuckets.keys()) {
      const fallback = tryConsumeFromBucket(key);
      if (fallback.length > 0) return fallback;
    }
  }

  const globalFallback = extractedImageSequence.find(
    (candidate) => !consumedExtractedImageIds.has(candidate.id)
  );

  if (!globalFallback) {
    return [] as Array<{ fileName: string; mimeType: string; dataUrl: string }>;
  }

  consumedExtractedImageIds.add(globalFallback.id);
  return [
    {
      fileName: globalFallback.fileName,
      mimeType: globalFallback.mimeType,
      dataUrl: globalFallback.dataUrl,
    },
  ];
}
function canPersistAsPool(metrics: {
  width_m: number | null;
  length_m: number | null;
  depth_m: number | null;
  max_capacity_l: number | null;
}) {
  return (
    metrics.width_m != null ||
    metrics.length_m != null ||
    metrics.depth_m != null ||
    metrics.max_capacity_l != null
  );
}
function normalizeImportedLoose(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function extractMetadataValue(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview,
  keys: string[]
) {
  for (const key of keys) {
    const direct = item.metadata?.[key];
    if (typeof direct === "string" && direct.trim()) return direct.trim();
  }
  const lowerKeyMap = Object.entries(item.metadata ?? {}).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      if (typeof value === "string" && value.trim()) {
        acc[key.toLowerCase()] = value.trim();
      }
      return acc;
    },
    {}
  );
  for (const key of keys) {
    const found = lowerKeyMap[key.toLowerCase()];
    if (found) return found;
  }
  return "";
}
function isGenericImportedTitle(title: string) {
  const normalized = normalizeImportedLoose(title);
  if (!normalized) return true;
  const blockedStarts = [
    "catalogo de teste",
    "descricao detalhada",
    "regra comercial",
    "arquivo de teste",
    "nome do item",
  ];
  if (blockedStarts.some((item) => normalized === item || normalized.startsWith(item))) {
    return true;
  }
  if (normalized === "piscina" || normalized === "item importado") {
    return true;
  }
  return false;
}
function shouldSkipImportedItem(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const normalizedTitle = normalizeImportedLoose(item.title);
  const normalizedRaw = normalizeImportedLoose(item.rawText);
  const normalizedType = normalizeImportedLoose(item.type);
  if (normalizedType === "commercial rule" || normalizedType === "commercial_rule") {
    return true;
  }
  if (normalizedType === "store info" || normalizedType === "store_info") {
    return true;
  }
  if (normalizedType === "responsible info" || normalizedType === "responsible_info") {
    return true;
  }
  if (normalizedType === "unknown" && item.confidence <= 0.35) {
    return true;
  }
  if (isGenericImportedTitle(item.title) && item.confidence <= 0.75) {
    return true;
  }
  if (
    normalizedRaw.includes("arquivo de teste") &&
    normalizedRaw.includes("validar upload inteligente") &&
    !normalizedRaw.includes("r$") &&
    !normalizedRaw.includes("capacidade") &&
    !normalizedRaw.includes("profundidade")
  ) {
    return true;
  }

if (
  normalizedRaw.includes("planilha estoque") ||
  normalizedRaw.includes("aba estoque") ||
  normalizedRaw.includes("sheet estoque")
) {
  return true;
}

  return false;
}
function resolveImportedDestination(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
): ImportedDestination {
  const explicitDestination = normalizeImportedLoose(
    extractMetadataValue(item, [
      "destination",
      "destino",
      "categoryhint",
      "category_hint",
      "categoria",
      "source_type",
      "import_type",
    ])
  );
  if (explicitDestination === "pool") return "pool";
  if (explicitDestination === "quimicos" || explicitDestination === "quimico") return "quimicos";
  if (explicitDestination === "acessorios" || explicitDestination === "acessorio")
    return "acessorios";
  if (explicitDestination === "outros" || explicitDestination === "outro") return "outros";
  const inferred = inferImportedDestination(item);
  if (inferred !== "outros") return inferred;
  const raw = normalizeImportedLoose([item.title, item.rawText].join(" "));
  if (
    raw.includes("capacidade") ||
    raw.includes("profundidade") ||
    /\b\d+[\.,]?\d*\s*x\s*\d+[\.,]?\d*\s*m\b/i.test(raw) ||
    /\b\d+[\.,]?\d*\s*m\s*diam/i.test(raw)
  ) {
    return "pool";
  }
  return inferred;
}
function buildImportedPoolName(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const explicitTitle = extractMetadataValue(item, ["title", "titulo", "nome", "productName"]);
  const candidate = explicitTitle || item.title || item.rawText || "Piscina importada";
  return candidate
    .replace(/^Piscina\s*:\s*/i, "")
    .replace(/^Cat[aá]logo\s*:\s*/i, "")
    .replace(/^Nome do item\s*:\s*/i, "")
    .trim()
    .slice(0, 160);
}
function buildImportedPoolDescription(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  return buildImportedCleanDescription(item);
}

function extractImportedWeightOrVolume(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview
) {
  const source = String(item.rawText || "");

  return (
    extractMetadataValue(item, [
      "peso_volume",
      "peso volume",
      "peso",
      "volume",
      "conteudo",
      "conteúdo",
      "embalagem",
      "package",
      "packaging",
    ]) ||
    extractImportedLabeledValue(source, [
      "Peso/Volume",
      "Peso / Volume",
      "Peso",
      "Volume",
      "Conteúdo",
      "Conteudo",
      "Embalagem",
    ]) ||
    ""
  ).trim();
}

function buildImportedCatalogMetadata(
  item: IntelligentImportDedupedPreview | IntelligentImportNormalizedPreview,
  category: ImportedCatalogCategory
) {
  const source = String(item.rawText || "");
  const sku =
    extractImportedCatalogSku(item) ||
    extractMetadataValue(item, ["sku", "codigo", "código"]);
  const line =
    extractMetadataValue(item, ["linha", "line"]) ||
    extractImportedLabeledValue(source, ["Linha"]);
  const application =
    extractMetadataValue(item, ["aplicacao", "aplicação", "application"]) ||
    extractImportedLabeledValue(source, ["Aplicação", "Aplicacao"]);
  const packaging =
    extractMetadataValue(item, ["embalagem", "package", "packaging"]) ||
    extractImportedLabeledValue(source, ["Embalagem"]);
  const dosage =
    extractMetadataValue(item, ["dosagem", "dose", "diluição", "diluicao"]) ||
    extractImportedLabeledValue(source, ["Dosagem", "Dose"]);
  const barcode =
    extractMetadataValue(item, ["codigo_barras", "código de barras", "barcode"]) ||
    extractImportedLabeledValue(source, ["Código de barras", "Codigo de barras", "Barcode"]);
  const stockInitial = extractImportedCatalogStockQuantity(item);

  return {
    categoria: category,
    source: "onboarding_intelligent_import",
    source_file_name: item.sourceFileName,
    source_type: item.type,
    confidence: item.confidence,
    dedup_key: "dedupKey" in item ? item.dedupKey : null,
    imported_title: buildImportedCatalogName(item),
    imported_dimensions: extractMetadataValue(item, ["medidas", "dimensions"]),
    imported_depth: extractMetadataValue(item, ["profundidade", "depth"]),
    imported_capacity: extractMetadataValue(item, ["capacidade", "capacity"]),
    imported_material: extractMetadataValue(item, ["material"]),
    imported_shape: extractMetadataValue(item, ["formato", "shape"]),
    imported_package: packaging,
    imported_weight_or_volume:
      extractMetadataValue(item, ["peso_volume", "peso", "volume", "conteudo", "conteúdo"]) ||
      extractImportedWeightOrVolume(item),
    imported_dosage: dosage,
    imported_barcode: barcode,
    clean_description: buildImportedCatalogDescription(item) || "",
    sku,
    line,
    application,
    embalagem: packaging,
    dosage,
    barcode,
    stock_initial: stockInitial,
  };
}

function dataUrlToBlob(dataUrl: string) {
  const [header, data] = String(dataUrl || "").split(",");
  if (!header || !data) {
    throw new Error("Data URL inválida para upload da imagem.");
  }
  const mimeMatch = header.match(/data:(.*?);base64/i);
  const mimeType = mimeMatch?.[1] || "image/jpeg";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}
function buildSafeImportedImageExtension(fileName: string, mimeType: string) {
  const byName = String(fileName || "").split(".").pop()?.toLowerCase();
  if (byName) return byName;
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  return "jpg";
}
async function uploadExtractedImageToPool(
  organizationId: string,
  storeId: string,
  poolId: string,
  image: { fileName: string; mimeType: string; dataUrl: string },
  sortOrder: number
) {
  const blob = dataUrlToBlob(image.dataUrl);
  const extension = buildSafeImportedImageExtension(image.fileName, image.mimeType);
  const filePath = `${organizationId}/${storeId}/${poolId}/${Date.now()}-${sortOrder}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from("pool-photos")
    .upload(filePath, blob, {
      upsert: false,
      contentType: image.mimeType || blob.type || "image/jpeg",
    });
  if (uploadError) throw uploadError;
  const { error: metadataError } = await supabase.from("pool_photos").insert({
    organization_id: organizationId,
    store_id: storeId,
    pool_id: poolId,
    storage_path: filePath,
    file_name: image.fileName,
    file_size_bytes: blob.size,
    sort_order: sortOrder,
  });
  if (metadataError) throw metadataError;
}
async function uploadExtractedImageToCatalog(
  organizationId: string,
  storeId: string,
  catalogItemId: string,
  image: { fileName: string; mimeType: string; dataUrl: string },
  sortOrder: number
) {
  const blob = dataUrlToBlob(image.dataUrl);
  const extension = buildSafeImportedImageExtension(image.fileName, image.mimeType);
  const filePath = `${organizationId}/${storeId}/${catalogItemId}/${Date.now()}-${sortOrder}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from("store-catalog-photos")
    .upload(filePath, blob, {
      upsert: false,
      contentType: image.mimeType || blob.type || "image/jpeg",
    });
  if (uploadError) throw uploadError;
  const { error: metadataError } = await supabase.from("store_catalog_item_photos").insert({
    catalog_item_id: catalogItemId,
    storage_path: filePath,
    file_name: image.fileName,
    file_size_bytes: blob.size,
    sort_order: sortOrder,
  });
  if (metadataError) throw metadataError;
}
async function clearCatalogItemPhotos(catalogItemId: string) {
  const { data: existingPhotos, error: existingPhotosError } = await supabase
    .from("store_catalog_item_photos")
    .select("id, storage_path")
    .eq("catalog_item_id", catalogItemId);

  if (existingPhotosError) throw existingPhotosError;

  const storagePaths = (existingPhotos ?? [])
    .map((photo) => String(photo.storage_path || "").trim())
    .filter(Boolean);

  if (storagePaths.length > 0) {
    const { error: removeStorageError } = await supabase.storage
      .from("store-catalog-photos")
      .remove(storagePaths);

    if (removeStorageError) {
      console.error("[OnboardingPage] clearCatalogItemPhotos remove storage error:", removeStorageError);
    }
  }

  const { error: deleteMetadataError } = await supabase
    .from("store_catalog_item_photos")
    .delete()
    .eq("catalog_item_id", catalogItemId);

  if (deleteMetadataError) throw deleteMetadataError;
}

async function replaceCatalogItemPhotos(
  organizationId: string,
  storeId: string,
  catalogItemId: string,
  images: Array<{ fileName: string; mimeType: string; dataUrl: string }>
) {
  const normalizedImages = images.filter((image) => Boolean(image?.dataUrl)).slice(0, 1);
  if (normalizedImages.length === 0) return;

  await clearCatalogItemPhotos(catalogItemId);

  for (let index = 0; index < normalizedImages.length; index += 1) {
    await uploadExtractedImageToCatalog(
      organizationId,
      storeId,
      catalogItemId,
      normalizedImages[index],
      index
    );
  }
}
function StepBadge({
  step,
  currentStep,
  title,
  onClick,
}: {
  step: number;
  currentStep: number;
  title: string;
  onClick: () => void;
}) {
  const active = step === currentStep;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "rounded-xl border px-4 py-3 text-left transition",
        active
          ? "border-black bg-black text-white"
          : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
      )}
    >
      <p className="text-xs font-medium opacity-80">Etapa {step}</p>
      <p className="mt-1 text-sm font-semibold">{title}</p>
    </button>
  );
}
function SectionTitle({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-medium text-gray-900">{title}</h2>
      {hint ? <p className="mt-1 text-sm text-gray-500">{hint}</p> : null}
    </div>
  );
}
function InfoBlock({
  title,
  description,
  subtle = false,
}: {
  title: string;
  description: string;
  subtle?: boolean;
}) {
  return (
    <div
      className={cx(
        "rounded-xl border px-4 py-3",
        subtle
          ? "border-gray-200 bg-gray-50 text-gray-700"
          : "border-amber-300 bg-amber-50 text-amber-900"
      )}
    >
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-sm leading-6">{description}</p>
    </div>
  );
}
function SelectorGrid({
  options,
  selectedValues,
  onToggle,
}: {
  options: Option[];
  selectedValues: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {options.map((option) => {
        const selected = selectedValues.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onToggle(option.value)}
            className={cx(
              "rounded-xl border px-4 py-3 text-left transition",
              selected
                ? "border-black bg-black text-white"
                : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
            )}
          >
            <div className="flex items-center gap-3">
              <span
                className={cx(
                  "inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs",
                  selected
                    ? "border-white bg-white text-black"
                    : "border-gray-300 bg-white text-transparent"
                )}
              >
                ✓
              </span>
              <div>
                <p className="text-sm font-medium">{option.label}</p>
                {option.hint ? (
                  <p className={cx("mt-1 text-xs", selected ? "text-white/80" : "text-gray-500")}>
                    {option.hint}
                  </p>
                ) : null}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
function SingleSelectorGrid({
  options,
  value,
  onChange,
}: {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cx(
              "rounded-xl border px-4 py-3 text-left transition",
              selected
                ? "border-black bg-black text-white"
                : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
            )}
          >
            <div className="flex items-center gap-3">
              <span
                className={cx(
                  "inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs",
                  selected
                    ? "border-white bg-white text-black"
                    : "border-gray-300 bg-white text-transparent"
                )}
              >
                ✓
              </span>
              <div>
                <p className="text-sm font-medium">{option.label}</p>
                {option.hint ? (
                  <p className={cx("mt-1 text-xs", selected ? "text-white/80" : "text-gray-500")}>
                    {option.hint}
                  </p>
                ) : null}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeStore, organizationId, loading: storeLoading } = useStoreContext();
  const [currentStep, setCurrentStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [hasCompletedOnboardingOnce, setHasCompletedOnboardingOnce] = useState(false);
  const [intelligentImportFiles, setIntelligentImportFiles] = useState<File[]>([]);
  const [intelligentImportSelectedFilesPreview, setIntelligentImportSelectedFilesPreview] = useState<
    IntelligentImportSelectedFilePreview[]
  >([]);
  const [intelligentImportLoading, setIntelligentImportLoading] = useState(false);
  const [intelligentImportError, setIntelligentImportError] = useState<string | null>(null);
  const [intelligentImportSuccess, setIntelligentImportSuccess] = useState<string | null>(null);
  const [intelligentImportRecovered, setIntelligentImportRecovered] = useState(false);
  const [intelligentImportResult, setIntelligentImportResult] =
    useState<IntelligentImportResponse | null>(null);
  const [discountSettings, setDiscountSettings] = useState<DiscountSettingsRow | null>(null);
  const [savingImportedCatalog, setSavingImportedCatalog] = useState(false);
  const hasDiscountConfigOverride = Boolean(discountSettings);
  const [step1DraftRecovered, setStep1DraftRecovered] = useState(false);
  const [step2DraftRecovered, setStep2DraftRecovered] = useState(false);
  const [step3DraftRecovered, setStep3DraftRecovered] = useState(false);
  const [step4DraftRecovered, setStep4DraftRecovered] = useState(false);
  const [step5DraftRecovered, setStep5DraftRecovered] = useState(false);
  const scrollRestoreTimeoutRef = useRef<number | null>(null);
  const lastRestoredScrollRef = useRef<number | null>(null);
  const [step1Form, setStep1Form] = useState<Step1FormData>({
    store_display_name: "",
    store_description: "",
    city: "",
    state: "",
    service_regions: "",
    commercial_whatsapp: "",
    store_services: [],
    store_services_other: "",
    service_region_modes: [],
    service_region_notes: "",
    service_region_primary_mode: "",
    service_region_outside_consultation: false,
  });
  const [step2Form, setStep2Form] = useState<Step2FormData>({
    pool_types: "",
    sells_chemicals: "",
    sells_accessories: "",
    offers_installation: "",
    offers_technical_visit: "",
    brands_worked: "",
    pool_types_selected: [],
    pool_types_other: "",
    main_store_brand: "",
  });
  const [step3Form, setStep3Form] = useState<Step3FormData>({
    average_installation_time_days: "",
    installation_days_rule: "",
    installation_available_days: [],
    technical_visit_days_rule: "",
    technical_visit_available_days: [],
    average_human_response_time: "",
    installation_process_steps: [],
    installation_process_other: "",
    technical_visit_rules_selected: [],
    technical_visit_rules_other: "",
    important_limitations_selected: [],
    important_limitations_other: "",
    sales_flow_start_steps: [],
    sales_flow_middle_steps: [],
    sales_flow_final_steps: [],
    sales_flow_notes: "",
    sales_flow_start_confirmed: false,
    sales_flow_middle_confirmed: false,
    sales_flow_final_confirmed: false,
  });
  const [step4Form, setStep4Form] = useState<Step4FormData>({
    average_ticket: "",
    can_offer_discount: "",
    max_discount_percent: "",
    accepted_payment_methods: [],
    ai_can_send_price_directly: "",
    price_direct_rule: "",
    human_help_discount_cases: "",
    human_help_custom_project_cases: "",
    human_help_payment_cases: "",
    price_direct_conditions: [],
    price_direct_rule_other: "",
    human_help_discount_cases_selected: [],
    human_help_discount_cases_other: "",
    human_help_custom_project_cases_selected: [],
    human_help_custom_project_cases_other: "",
    human_help_payment_cases_selected: [],
    human_help_payment_cases_other: "",
    price_needs_human_help: "",
    price_talk_mode: "",
    price_must_understand_before: [],
  });
  const [step5Form, setStep5Form] = useState<Step5FormData>({
    responsible_name: "",
    responsible_whatsapp: "",
    ai_should_notify_responsible: "",
    final_activation_notes: "",
    confirm_information_is_correct: false,
    responsible_notification_cases: [],
    responsible_notification_cases_other: "",
    activation_preferences: [],
    activation_preferences_other: "",
  });
  const effectiveDiscountCanOffer = useMemo(() => {
    if (!discountSettings) {
      return step4Form.can_offer_discount === "sim";
    }
    return (
      Number(discountSettings.default_discount_percent ?? 0) > 0 ||
      Number(discountSettings.max_discount_percent ?? 0) > 0 ||
      Boolean(discountSettings.allow_ask_above_max_discount)
    );
  }, [discountSettings, step4Form.can_offer_discount]);
  const effectiveDiscountCanOfferValue = effectiveDiscountCanOffer ? "sim" : "não";
  const effectiveOnboardingDiscountPercent = useMemo(() => {
    if (!discountSettings) {
      return step4Form.max_discount_percent;
    }
    return String(discountSettings.default_discount_percent ?? 0);
  }, [discountSettings, step4Form.max_discount_percent]);
  const step1DraftStorageKey = useMemo(() => {
    if (!organizationId || !activeStore?.id) return null;
    return `zion_onboarding_step1_draft:${organizationId}:${activeStore.id}`;
  }, [organizationId, activeStore?.id]);
  const step2DraftStorageKey = useMemo(() => {
    if (!organizationId || !activeStore?.id) return null;
    return `zion_onboarding_step2_draft:${organizationId}:${activeStore.id}`;
  }, [organizationId, activeStore?.id]);
  const step3DraftStorageKey = useMemo(() => {
    if (!organizationId || !activeStore?.id) return null;
    return `zion_onboarding_step3_draft:${organizationId}:${activeStore.id}`;
  }, [organizationId, activeStore?.id]);
  const step4DraftStorageKey = useMemo(() => {
    if (!organizationId || !activeStore?.id) return null;
    return `zion_onboarding_step4_draft:${organizationId}:${activeStore.id}`;
  }, [organizationId, activeStore?.id]);
  const step5DraftStorageKey = useMemo(() => {
    if (!organizationId || !activeStore?.id) return null;
    return `zion_onboarding_step5_draft:${organizationId}:${activeStore.id}`;
  }, [organizationId, activeStore?.id]);
  const currentStepStorageKey = useMemo(() => {
    if (!organizationId || !activeStore?.id) return null;
    return `zion_onboarding_current_step:${organizationId}:${activeStore.id}`;
  }, [organizationId, activeStore?.id]);
  const pageScrollStorageKey = useMemo(() => {
    if (!organizationId || !activeStore?.id) return null;
    return `zion_onboarding_scroll:${organizationId}:${activeStore.id}`;
  }, [organizationId, activeStore?.id]);
  const intelligentImportStorageKey = useMemo(() => {
    if (!organizationId || !activeStore?.id) return null;
    return `zion_onboarding_intelligent_import:${organizationId}:${activeStore.id}`;
  }, [organizationId, activeStore?.id]);
  const ignoreNextStepScrollRef = useRef(false);
  const savePageScroll = useCallback(() => {
    if (!pageScrollStorageKey || typeof window === "undefined") return;
    persistToLocalStorageSafe(pageScrollStorageKey, String(window.scrollY || 0));
  }, [pageScrollStorageKey]);
  const restorePageScroll = useCallback((delay = 0) => {
    if (!pageScrollStorageKey || typeof window === "undefined") return;
    const runRestore = () => {
      const raw = window.localStorage.getItem(pageScrollStorageKey);
      if (!raw) return;
      const scroll = Number(raw);
      if (!Number.isFinite(scroll)) return;
      lastRestoredScrollRef.current = scroll;
      window.scrollTo({ top: scroll, behavior: "auto" });
    };
    if (scrollRestoreTimeoutRef.current !== null) {
      window.clearTimeout(scrollRestoreTimeoutRef.current);
      scrollRestoreTimeoutRef.current = null;
    }
    if (delay <= 0) {
      window.requestAnimationFrame(runRestore);
      return;
    }
    scrollRestoreTimeoutRef.current = window.setTimeout(() => {
      runRestore();
      scrollRestoreTimeoutRef.current = null;
    }, delay);
  }, [pageScrollStorageKey]);
  const storeHasInstallation = useMemo(
    () => step1Form.store_services.includes("instalacao_piscinas"),
    [step1Form.store_services]
  );
  const storeHasTechnicalVisit = useMemo(
    () => step1Form.store_services.includes("visita_tecnica"),
    [step1Form.store_services]
  );
  const visibleIntelligentImportFiles = useMemo(() => {
    if (intelligentImportFiles.length > 0) {
      return intelligentImportFiles.map((file) => ({
        name: file.name,
        type: file.type || "tipo não informado",
        size: file.size,
        lastModified: file.lastModified,
      }));
    }
    return intelligentImportSelectedFilesPreview;
  }, [intelligentImportFiles, intelligentImportSelectedFilesPreview]);
  const selectedImagePreviews = useMemo(() => {
    return intelligentImportFiles
      .filter((file) => isImageLikeFileType(file.type))
      .map((file) => ({
        name: file.name,
        url: URL.createObjectURL(file),
      }));
  }, [intelligentImportFiles]);
  const safeExtractedPreview = useMemo(() => {
    if (!intelligentImportResult || !intelligentImportResult.ok) return [];
    return Array.isArray(intelligentImportResult.extractedPreview)
      ? intelligentImportResult.extractedPreview
      : [];
  }, [intelligentImportResult]);
  const safeNormalizedPreview = useMemo(() => {
    if (!intelligentImportResult || !intelligentImportResult.ok) return [];
    return Array.isArray(intelligentImportResult.normalizedPreview)
      ? intelligentImportResult.normalizedPreview
      : [];
  }, [intelligentImportResult]);
  const safeDedupedPreview = useMemo(() => {
    if (!intelligentImportResult || !intelligentImportResult.ok) return [];
    return Array.isArray(intelligentImportResult.dedupedPreview)
      ? intelligentImportResult.dedupedPreview
      : [];
  }, [intelligentImportResult]);
  const safeExtractedImagePreview = useMemo(() => {
    if (!intelligentImportResult || !intelligentImportResult.ok) return [];
    const candidate = intelligentImportResult.extractedImagePreview;
    return Array.isArray(candidate) ? candidate : [];
  }, [intelligentImportResult]);
  useEffect(() => {
    return () => {
      for (const preview of selectedImagePreviews) {
        URL.revokeObjectURL(preview.url);
      }
    };
  }, [selectedImagePreviews]);
  const updateStep1Field = <K extends keyof Step1FormData>(field: K, value: Step1FormData[K]) => {
    setStep1Form((prev) => ({ ...prev, [field]: value }));
  };
  const updateStep2Field = <K extends keyof Step2FormData>(field: K, value: Step2FormData[K]) => {
    setStep2Form((prev) => ({ ...prev, [field]: value }));
  };
  const updateStep3Field = <K extends keyof Step3FormData>(field: K, value: Step3FormData[K]) => {
    setStep3Form((prev) => ({ ...prev, [field]: value }));
  };
  const updateStep4Field = <K extends keyof Step4FormData>(field: K, value: Step4FormData[K]) => {
    setStep4Form((prev) => ({ ...prev, [field]: value }));
  };
  const updateStep5Field = <K extends keyof Step5FormData>(field: K, value: Step5FormData[K]) => {
    setStep5Form((prev) => ({ ...prev, [field]: value }));
  };
  const toggleArrayValue = <T extends string>(
    setter: Dispatch<SetStateAction<T[]>>,
    value: T
  ) => {
    setter((prev) => (prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]));
  };
  const toggleStep1ArrayField = (field: "store_services" | "service_region_modes", value: string) => {
    setStep1Form((prev) => ({
      ...prev,
      [field]: prev[field].includes(value)
        ? prev[field].filter((item) => item !== value)
        : [...prev[field], value],
    }));
  };
  const toggleStep2ArrayField = (field: "pool_types_selected", value: string) => {
    setStep2Form((prev) => ({
      ...prev,
      [field]: prev[field].includes(value)
        ? prev[field].filter((item) => item !== value)
        : [...prev[field], value],
    }));
  };
  const toggleStep3ArrayField = (
    field:
      | "installation_available_days"
      | "technical_visit_available_days"
      | "installation_process_steps"
      | "technical_visit_rules_selected"
      | "important_limitations_selected"
      | "sales_flow_start_steps"
      | "sales_flow_middle_steps"
      | "sales_flow_final_steps",
    value: string
  ) => {
    setStep3Form((prev) => ({
      ...prev,
      [field]: prev[field].includes(value)
        ? prev[field].filter((item) => item !== value)
        : [...prev[field], value],
    }));
  };
  const toggleStep4ArrayField = (
    field:
      | "accepted_payment_methods"
      | "price_direct_conditions"
      | "human_help_discount_cases_selected"
      | "human_help_custom_project_cases_selected"
      | "human_help_payment_cases_selected"
      | "price_must_understand_before",
    value: string
  ) => {
    setStep4Form((prev) => ({
      ...prev,
      [field]: prev[field].includes(value)
        ? prev[field].filter((item) => item !== value)
        : [...prev[field], value],
    }));
  };
  const toggleStep5ArrayField = (
    field: "responsible_notification_cases" | "activation_preferences",
    value: string
  ) => {
    setStep5Form((prev) => ({
      ...prev,
      [field]: prev[field].includes(value)
        ? prev[field].filter((item) => item !== value)
        : [...prev[field], value],
    }));
  };
  function changeStep(step: number) {
    ignoreNextStepScrollRef.current = false;
    setCurrentStep(step);
  }
  function clearIntelligentImportState() {
    setIntelligentImportFiles([]);
    setIntelligentImportSelectedFilesPreview([]);
    setIntelligentImportError(null);
    setIntelligentImportSuccess(null);
    setIntelligentImportResult(null);
    setIntelligentImportRecovered(false);
    if (intelligentImportStorageKey && typeof window !== "undefined") {
      removeFromLocalStorageSafe(intelligentImportStorageKey);
    }
  }
  function navigateWithFallback(path: string) {
    savePageScroll();
    try {
      router.push(path);
    } catch (error) {
      console.error("[OnboardingPage] router push error:", error);
    }
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        if (window.location.pathname !== path) {
          window.location.href = path;
        }
      }, 120);
    }
  }
  async function handleRunIntelligentImport() {
    if (!organizationId || !activeStore?.id) {
      setIntelligentImportError("Não foi possível identificar a organização e a loja ativa.");
      return;
    }
    if (intelligentImportFiles.length === 0) {
      setIntelligentImportError(
        "Selecione pelo menos um arquivo para testar a importação inteligente novamente."
      );
      return;
    }
    setIntelligentImportLoading(true);
    setIntelligentImportError(null);
    setIntelligentImportSuccess(null);
    setIntelligentImportResult(null);
    setIntelligentImportRecovered(false);
    const selectedFilesPreview = await buildSelectedFilePreviews(intelligentImportFiles);
    setIntelligentImportSelectedFilesPreview(selectedFilesPreview);
    try {
      const formData = new FormData();
      formData.append("organizationId", organizationId);
      formData.append("storeId", activeStore.id);
      for (const file of intelligentImportFiles) {
        formData.append("files", file);
      }
      const response = await fetch("/api/onboarding/intelligent-import", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as IntelligentImportResponse;
      if (!response.ok || !result.ok) {
        setIntelligentImportError(result.message || "Falha ao processar a importação inteligente.");
        setIntelligentImportResult(result);
        return;
      }
      const decoratedResult = decorateIntelligentImportResultWithImageFallback(result, selectedFilesPreview);
      const frontendReadyResult = normalizeIntelligentImportResultForFrontend(decoratedResult);
      setIntelligentImportResult(frontendReadyResult);
      setIntelligentImportSuccess(
        frontendReadyResult.message || "Importação inteligente processada com sucesso."
      );
    } catch (error) {
      console.error("[OnboardingPage] handleRunIntelligentImport error:", error);
      setIntelligentImportError("Erro inesperado ao testar a importação inteligente.");
    } finally {
      setIntelligentImportLoading(false);
    }
  }
  
  async function uploadImportedImageToPool(poolId: string, file: File, sortOrder = 0) {
    if (!organizationId || !activeStore?.id) {
      throw new Error("Loja ativa não identificada para salvar a foto da piscina.");
    }
    const extension = file.name.includes(".") ? file.name.split(".").pop() : "jpg";
    const safeExtension = extension ? extension.toLowerCase() : "jpg";
    const filePath = `${organizationId}/${activeStore.id}/${poolId}/${Date.now()}-${sortOrder}.${safeExtension}`;
    const { error: uploadError } = await supabase.storage
      .from("pool-photos")
      .upload(filePath, file, {
        upsert: false,
        contentType: file.type || undefined,
      });
    if (uploadError) throw uploadError;
    const { error: metadataError } = await supabase.from("pool_photos").insert({
      organization_id: organizationId,
      store_id: activeStore.id,
      pool_id: poolId,
      storage_path: filePath,
      file_name: file.name,
      file_size_bytes: file.size,
      sort_order: sortOrder,
    });
    if (metadataError) throw metadataError;
  }
  async function uploadImportedImageToCatalog(catalogItemId: string, file: File, sortOrder = 0) {
    if (!organizationId || !activeStore?.id) {
      throw new Error("Loja ativa não identificada para salvar a foto do catálogo.");
    }
    const extension = file.name.includes(".") ? file.name.split(".").pop() : "jpg";
    const safeExtension = extension ? extension.toLowerCase() : "jpg";
    const filePath = `${organizationId}/${activeStore.id}/${catalogItemId}/${Date.now()}-${sortOrder}.${safeExtension}`;
    const { error: uploadError } = await supabase.storage
      .from("store-catalog-photos")
      .upload(filePath, file, {
        upsert: false,
        contentType: file.type || undefined,
      });
    if (uploadError) throw uploadError;
    const { error: metadataError } = await supabase.from("store_catalog_item_photos").insert({
      catalog_item_id: catalogItemId,
      storage_path: filePath,
      file_name: file.name,
      file_size_bytes: file.size,
      sort_order: sortOrder,
    });
    if (metadataError) throw metadataError;
  }
  
async function handleSaveImportedItemsToCatalog() {
    if (!organizationId || !activeStore?.id) {
      setFormError("Não foi possível identificar a organização e a loja ativa.");
      return;
    }
    if (!intelligentImportResult || !intelligentImportResult.ok) {
      setFormError("Faça a importação inteligente antes de salvar no sistema.");
      return;
    }

    const rawSourceItems =
      intelligentImportResult.dedupedPreview.length > 0
        ? intelligentImportResult.dedupedPreview.filter((item) => !item.isDuplicate)
        : intelligentImportResult.normalizedPreview;

    const filteredSourceItems = rawSourceItems.filter((item) => !shouldSkipImportedItem(item));
    const sourceItems = dedupeImportedItemsForSave(filteredSourceItems);

    if (sourceItems.length === 0) {
      setFormError(
        "A análise não encontrou itens prontos para salvar. Tente um arquivo mais direto ou revise a importação."
      );
      return;
    }

    setSavingImportedCatalog(true);
    setFormError(null);
    setSuccessMessage(null);

    try {
      const selectedImageFiles = intelligentImportFiles.filter((file) =>
        String(file.type || "").startsWith("image/")
      );

      const extractedImageBuckets = new Map<
        string,
        Array<{
          id: string;
          fileName: string;
          mimeType: string;
          dataUrl: string;
          sourceFileName: string;
        }>
      >();

      const extractedImageBucketCursors = new Map<string, number>();
      const consumedExtractedImageIds = new Set<string>();

      const extractedImageSequence = safeExtractedImagePreview.map((image, index) => ({
        id: `${String(image.sourceFileName || "").trim().toLowerCase()}::${image.fileName || "imagem-extraida.jpg"}::${index}`,
        fileName: image.fileName || "imagem-extraida.jpg",
        mimeType: image.mimeType || "image/jpeg",
        dataUrl: image.dataUrl,
        sourceFileName: String(image.sourceFileName || "").trim().toLowerCase(),
      }));

      for (const image of extractedImageSequence) {
        const bucketKey = image.sourceFileName || "__sem_origem__";
        const currentBucket = extractedImageBuckets.get(bucketKey) ?? [];
        currentBucket.push(image);
        extractedImageBuckets.set(bucketKey, currentBucket);
      }

      let firstPoolId: string | null = null;
      let firstCatalogCategory: ImportedCatalogCategory | null = null;

      let savedPools = 0;
      let savedAcessorios = 0;
      let savedQuimicos = 0;
      let savedOutros = 0;
      let imageCursor = 0;

      const itemErrors: string[] = [];
      const savedRuntimeIdentityKeys = new Set<string>();

      for (const item of sourceItems) {
        try {
          const destination = resolveImportedDestination(item);
          const runtimeIdentityKeys = buildImportedRuntimeIdentityKeys(item);

          if (
            runtimeIdentityKeys.length > 0 &&
            runtimeIdentityKeys.some((key) => savedRuntimeIdentityKeys.has(key))
          ) {
            continue;
          }

          const relatedExtractedImages = pickRelatedExtractedImages(
            item,
            extractedImageBuckets,
            extractedImageBucketCursors,
            extractedImageSequence,
            consumedExtractedImageIds,
            sourceItems.length
          );

          if (destination === "pool") {
            const metrics = extractImportedPoolMetrics(item);
            const poolName = buildImportedPoolName(item);

            if (!poolName || isGenericImportedTitle(poolName)) {
              continue;
            }

            let poolDescription = buildImportedPoolDescription(item);
            let safeDepth = metrics.depth_m;

            if (safeDepth == null) {
              safeDepth = 1.4;
              poolDescription = [
                poolDescription || "",
                "Importação automática: a profundidade não foi identificada com segurança no arquivo. Foi usado 1,40 m de forma provisória para permitir o cadastro. Revise este item depois.",
              ]
                .filter(Boolean)
                .join("\n");
            }

            const { data: existingPool } = await supabase
              .from("pools")
              .select("id")
              .eq("organization_id", organizationId)
              .eq("store_id", activeStore.id)
              .eq("name", poolName)
              .maybeSingle();

            let persistedPoolId: string | null = existingPool?.id ?? null;

            if (existingPool?.id) {
              const { error: updatePoolError } = await supabase
                .from("pools")
                .update({
                  width_m: metrics.width_m,
                  length_m: metrics.length_m,
                  depth_m: safeDepth,
                  shape: metrics.shape,
                  material: metrics.material,
                  max_capacity_l: metrics.max_capacity_l,
                  price: metrics.price,
                  description: poolDescription,
                  is_active: true,
                  track_stock: true,
                })
                .eq("id", existingPool.id);

              if (updatePoolError) throw updatePoolError;
            } else {
              const { data: createdPool, error } = await supabase
                .from("pools")
                .insert({
                  organization_id: organizationId,
                  store_id: activeStore.id,
                  name: poolName,
                  width_m: metrics.width_m,
                  length_m: metrics.length_m,
                  depth_m: safeDepth,
                  shape: metrics.shape,
                  material: metrics.material,
                  max_capacity_l: metrics.max_capacity_l,
                  weight_kg: null,
                  price: metrics.price,
                  description: poolDescription,
                  is_active: true,
                  track_stock: true,
                  stock_quantity: 0,
                })
                .select("id")
                .single();

              if (error) throw error;
              persistedPoolId = createdPool.id;
            }

            if (!persistedPoolId) {
              throw new Error("Falha ao persistir a piscina importada.");
            }

            if (!firstPoolId) firstPoolId = persistedPoolId;
            savedPools += 1;
            runtimeIdentityKeys.forEach((key) => savedRuntimeIdentityKeys.add(key));

            const poolImages = relatedExtractedImages.slice(0, 1);
            if (poolImages.length > 0) {
              for (let index = 0; index < poolImages.length; index += 1) {
                await uploadExtractedImageToPool(
                  organizationId,
                  activeStore.id,
                  persistedPoolId,
                  poolImages[index],
                  index
                );
              }
            } else if (selectedImageFiles[imageCursor]) {
              try {
                await uploadImportedImageToPool(persistedPoolId, selectedImageFiles[imageCursor], 0);
                imageCursor += 1;
              } catch (uploadError) {
                console.error("[OnboardingPage] uploadImportedImageToPool error:", uploadError);
              }
            }

            continue;
          }

          const category =
            destination === "quimicos" || destination === "acessorios" || destination === "outros"
              ? destination
              : normalizeImportedCatalogCategory(
                  [item.type, item.title, item.rawText, ...Object.values(item.metadata ?? {})].join(" ")
                );

          const itemName = buildImportedCatalogName(item);
          if (!itemName || isGenericImportedTitle(itemName)) {
            continue;
          }

          const sku = extractImportedCatalogSku(item) || null;
          const priceCents = extractImportedCatalogPriceCents(item);
          const stockQuantity = extractImportedCatalogStockQuantity(item);
          const metadata = buildImportedCatalogMetadata(item, category);
          const description = buildImportedCatalogDescription(item);

          let existingCatalogItem: ExistingCatalogItemRow | null = null;

          if (sku) {
            const { data } = await supabase
              .from("store_catalog_items")
              .select("id, sku, price_cents, stock_quantity, description, metadata")
              .eq("organization_id", organizationId)
              .eq("store_id", activeStore.id)
              .eq("sku", sku)
              .maybeSingle();
            existingCatalogItem = (data as ExistingCatalogItemRow | null) ?? null;
          }

          if (!existingCatalogItem) {
            const { data } = await supabase
              .from("store_catalog_items")
              .select("id, sku, price_cents, stock_quantity, description, metadata")
              .eq("organization_id", organizationId)
              .eq("store_id", activeStore.id)
              .eq("name", itemName)
              .maybeSingle();
            existingCatalogItem = (data as ExistingCatalogItemRow | null) ?? null;
          }

          const safePriceCents = priceCents ?? existingCatalogItem?.price_cents ?? null;
          const safeStockQuantity =
            stockQuantity > 0 ? stockQuantity : existingCatalogItem?.stock_quantity ?? 0;

          let persistedCatalogItemId: string | null = existingCatalogItem?.id ?? null;

          if (existingCatalogItem?.id) {
            const mergedMetadata = {
              ...(existingCatalogItem.metadata ?? {}),
              ...metadata,
            } as Record<string, unknown>;

            const { error: updateCatalogError } = await supabase
              .from("store_catalog_items")
              .update({
                sku,
                name: itemName,
                description: description ?? existingCatalogItem.description ?? null,
                price_cents: safePriceCents,
                currency: "BRL",
                is_active: true,
                track_stock: true,
                stock_quantity: safeStockQuantity,
                metadata: mergedMetadata,
              })
              .eq("id", existingCatalogItem.id);

            if (updateCatalogError) throw updateCatalogError;
          } else {
            const { data: createdItem, error } = await supabase
              .from("store_catalog_items")
              .insert({
                organization_id: organizationId,
                store_id: activeStore.id,
                sku,
                name: itemName,
                description,
                price_cents: safePriceCents,
                currency: "BRL",
                is_active: true,
                track_stock: true,
                stock_quantity: safeStockQuantity,
                metadata,
              })
              .select("id")
              .single();

            if (error) throw error;
            persistedCatalogItemId = createdItem.id;
          }

          if (!persistedCatalogItemId) {
            throw new Error("Falha ao persistir o item importado do catálogo.");
          }

          if (!firstCatalogCategory) firstCatalogCategory = category;
          if (category === "quimicos") savedQuimicos += 1;
          else if (category === "acessorios") savedAcessorios += 1;
          else savedOutros += 1;
          runtimeIdentityKeys.forEach((key) => savedRuntimeIdentityKeys.add(key));

          const catalogImages = relatedExtractedImages.slice(0, 1);
          if (catalogImages.length > 0) {
            try {
              await replaceCatalogItemPhotos(
                organizationId,
                activeStore.id,
                persistedCatalogItemId,
                catalogImages
              );
            } catch (uploadError) {
              console.error("[OnboardingPage] replaceCatalogItemPhotos error:", uploadError);
            }
          } else if (selectedImageFiles[imageCursor]) {
            try {
              await clearCatalogItemPhotos(persistedCatalogItemId);
              await uploadImportedImageToCatalog(
                persistedCatalogItemId,
                selectedImageFiles[imageCursor],
                0
              );
              imageCursor += 1;
            } catch (uploadError) {
              console.error("[OnboardingPage] replaceCatalogItemPhotosFromFiles error:", uploadError);
            }
          }
        } catch (itemError) {
          console.error("[OnboardingPage] handleSaveImportedItemsToCatalog item error:", itemError);
          itemErrors.push(
            itemError instanceof Error
              ? itemError.message
              : "Erro inesperado ao salvar um item importado."
          );
        }
      }

      const totalCreated = savedPools + savedAcessorios + savedQuimicos + savedOutros;

      if (totalCreated === 0) {
        if (itemErrors.length > 0) {
          setFormError(`Nenhum item foi salvo. Primeiros erros: ${itemErrors.slice(0, 3).join(" | ")}`);
        } else {
          setFormError(
            "A análise foi concluída, mas nenhum item válido ficou pronto para salvar. Revise o arquivo e teste novamente."
          );
        }
        return;
      }

      setSuccessMessage(
        `Importação salva com sucesso. Piscinas: ${savedPools}. Químicos: ${savedQuimicos}. Acessórios: ${savedAcessorios}. Outros: ${savedOutros}.`
      );

      clearIntelligentImportState();
      ignoreNextStepScrollRef.current = false;
      setCurrentStep(2);
      return;
    } catch (error) {
      console.error("[OnboardingPage] handleSaveImportedItemsToCatalog error:", error);
      setFormError(
        error instanceof Error
          ? error.message
          : "Erro ao salvar os itens importados no sistema."
      );
    } finally {
      setSavingImportedCatalog(false);
    }
  }
async function upsertAnswers(
    payloads: Array<[string, unknown]>,
    nextSuccessMessage: string,
    nextStep?: number,
    finalStatus?: "in_progress" | "completed"
  ) {
    if (!organizationId || !activeStore?.id) return;
    setSaving(true);
    setFormError(null);
    setSuccessMessage(null);
    try {
      for (const [questionKey, answer] of payloads) {
        const { error: rpcError } = await supabase.rpc("onboarding_upsert_answer_scoped", {
          p_organization_id: organizationId,
          p_store_id: activeStore.id,
          p_question_key: questionKey,
          p_answer: answer,
        });
        if (rpcError) throw new Error(`Falha ao salvar campo: ${questionKey}`);
      }
      const { error: statusError } = await supabase.rpc("onboarding_upsert_store_onboarding_scoped", {
        p_organization_id: organizationId,
        p_store_id: activeStore.id,
        p_status: finalStatus ?? "in_progress",
      });
      if (statusError) throw new Error("Falha ao atualizar status do onboarding.");
      setSuccessMessage(nextSuccessMessage);
      if (typeof nextStep === "number") {
        ignoreNextStepScrollRef.current = false;
        setCurrentStep(nextStep);
      }
    } catch (err) {
      console.error("[OnboardingPage] upsertAnswers error:", err);
      setFormError(err instanceof Error ? err.message : "Erro ao salvar etapa.");
    } finally {
      setSaving(false);
    }
  }
  useEffect(() => {
    if (!currentStepStorageKey || typeof window === "undefined") return;
    const storedStep = window.localStorage.getItem(currentStepStorageKey);
    const paramStep = Number(searchParams.get("step"));
    if (paramStep >= 1 && paramStep <= 5) {
      setCurrentStep(paramStep);
      return;
    }
    if (storedStep) {
      const parsedStep = Number(storedStep);
      if (parsedStep >= 1 && parsedStep <= 5) {
        setCurrentStep(parsedStep);
      }
    }
  }, [currentStepStorageKey, searchParams]);
  useEffect(() => {
    if (!currentStepStorageKey || typeof window === "undefined") return;
    persistToLocalStorageSafe(currentStepStorageKey, String(currentStep));
  }, [currentStep, currentStepStorageKey]);
  useEffect(() => {
    if (!intelligentImportStorageKey || typeof window === "undefined") return;
    const raw = window.localStorage.getItem(intelligentImportStorageKey);
    if (!raw) {
      setIntelligentImportRecovered(false);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as PersistedIntelligentImportState;
      setIntelligentImportSelectedFilesPreview(
        Array.isArray(parsed.selectedFiles) ? parsed.selectedFiles : []
      );
      setIntelligentImportResult(null);
      setIntelligentImportSuccess(parsed.successMessage ?? null);
      setIntelligentImportError(parsed.errorMessage ?? null);
      setIntelligentImportRecovered(Boolean((parsed.selectedFiles?.length ?? 0) > 0));
    } catch (error) {
      console.error("[OnboardingPage] intelligent import restore error:", error);
      removeFromLocalStorageSafe(intelligentImportStorageKey);
      setIntelligentImportRecovered(false);
    }
  }, [intelligentImportStorageKey]);
  useEffect(() => {
    if (!intelligentImportStorageKey || typeof window === "undefined") return;
    const hasPersistedContent =
      visibleIntelligentImportFiles.length > 0 ||
      Boolean(intelligentImportSuccess) ||
      Boolean(intelligentImportError);
    if (!hasPersistedContent) {
      removeFromLocalStorageSafe(intelligentImportStorageKey);
      return;
    }
    const payload = buildLightPersistedIntelligentImportState({
      selectedFiles: visibleIntelligentImportFiles,
      successMessage: intelligentImportSuccess,
      errorMessage: intelligentImportError,
    });
    persistToLocalStorageSafe(intelligentImportStorageKey, JSON.stringify(payload));
  }, [
    intelligentImportStorageKey,
    visibleIntelligentImportFiles,
    intelligentImportSuccess,
    intelligentImportError,
  ]);
  useEffect(() => {
    if (!pageScrollStorageKey || typeof window === "undefined") return;
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
    restorePageScroll();
    restorePageScroll(120);
    return () => {
      if (scrollRestoreTimeoutRef.current !== null) {
        window.clearTimeout(scrollRestoreTimeoutRef.current);
        scrollRestoreTimeoutRef.current = null;
      }
    };
  }, [pageScrollStorageKey, currentStep, restorePageScroll]);
  useEffect(() => {
    if (!pageScrollStorageKey || typeof window === "undefined") return;
    const onScroll = () => savePageScroll();
    const onPageHide = () => savePageScroll();
    const onPageShow = () => restorePageScroll(30);
    const onFocus = () => restorePageScroll(30);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        savePageScroll();
        return;
      }
      restorePageScroll(30);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      savePageScroll();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [pageScrollStorageKey, restorePageScroll, savePageScroll]);
  useEffect(() => {
    if (!step1DraftStorageKey || typeof window === "undefined") return;
    const raw = window.localStorage.getItem(step1DraftStorageKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Step1FormData;
      setStep1Form((prev) => ({ ...prev, ...parsed }));
      setStep1DraftRecovered(true);
    } catch {}
  }, [step1DraftStorageKey]);
  useEffect(() => {
    if (!step2DraftStorageKey || typeof window === "undefined") return;
    const raw = window.localStorage.getItem(step2DraftStorageKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Step2FormData;
      setStep2Form((prev) => ({ ...prev, ...parsed }));
      setStep2DraftRecovered(true);
    } catch {}
  }, [step2DraftStorageKey]);
  useEffect(() => {
    if (!step3DraftStorageKey || typeof window === "undefined") return;
    const raw = window.localStorage.getItem(step3DraftStorageKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Step3FormData;
      setStep3Form((prev) => ({ ...prev, ...parsed }));
      setStep3DraftRecovered(true);
    } catch {}
  }, [step3DraftStorageKey]);
  useEffect(() => {
    if (!step4DraftStorageKey || typeof window === "undefined") return;
    const raw = window.localStorage.getItem(step4DraftStorageKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Step4FormData;
      setStep4Form((prev) => ({ ...prev, ...parsed }));
      setStep4DraftRecovered(true);
    } catch {}
  }, [step4DraftStorageKey]);
  useEffect(() => {
    if (!step5DraftStorageKey || typeof window === "undefined") return;
    const raw = window.localStorage.getItem(step5DraftStorageKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Step5FormData;
      setStep5Form((prev) => ({ ...prev, ...parsed }));
      setStep5DraftRecovered(true);
    } catch {}
  }, [step5DraftStorageKey]);
  useEffect(() => {
    if (!step1DraftStorageKey || typeof window === "undefined") return;
    persistToLocalStorageSafe(step1DraftStorageKey, JSON.stringify(step1Form));
  }, [step1Form, step1DraftStorageKey]);
  useEffect(() => {
    if (!step2DraftStorageKey || typeof window === "undefined") return;
    persistToLocalStorageSafe(step2DraftStorageKey, JSON.stringify(step2Form));
  }, [step2Form, step2DraftStorageKey]);
  useEffect(() => {
    if (!step3DraftStorageKey || typeof window === "undefined") return;
    persistToLocalStorageSafe(step3DraftStorageKey, JSON.stringify(step3Form));
  }, [step3Form, step3DraftStorageKey]);
  useEffect(() => {
    if (!step4DraftStorageKey || typeof window === "undefined") return;
    persistToLocalStorageSafe(step4DraftStorageKey, JSON.stringify(step4Form));
  }, [step4Form, step4DraftStorageKey]);
  useEffect(() => {
    if (!step5DraftStorageKey || typeof window === "undefined") return;
    persistToLocalStorageSafe(step5DraftStorageKey, JSON.stringify(step5Form));
  }, [step5Form, step5DraftStorageKey]);
  useEffect(() => {
    const loadAnswers = async () => {
      if (!organizationId || !activeStore?.id) return;
      try {
        const { data, error: rpcError } = await supabase.rpc("onboarding_get_answers_scoped", {
          p_organization_id: organizationId,
          p_store_id: activeStore.id,
        });
        if (rpcError) {
          console.error("[OnboardingPage] loadAnswers RPC error:", rpcError);
          setFatalError("Falha ao carregar respostas do onboarding.");
          return;
        }
        const answers = (data ?? {}) as AnswersMap;
        const remoteStoreServices = parseArrayAnswer(answers.store_services);
        const remotePoolTypesSelected = parseArrayAnswer(answers.pool_types_selected);
        const remoteTechnicalVisitRulesSelected = parseArrayAnswer(answers.technical_visit_rules_selected);
        const remoteImportantLimitationsSelected = parseArrayAnswer(answers.important_limitations_selected);
        const remoteHumanHelpDiscountSelected = parseArrayAnswer(answers.human_help_discount_cases_selected);
        const remoteHumanHelpCustomProjectSelected = parseArrayAnswer(
          answers.human_help_custom_project_cases_selected
        );
        const remoteHumanHelpPaymentSelected = parseArrayAnswer(answers.human_help_payment_cases_selected);
        const remoteResponsibleNotificationCases = parseArrayAnswer(answers.responsible_notification_cases);
        const remoteActivationPreferences = parseArrayAnswer(answers.activation_preferences);
        const remoteSalesFlowStartSteps = parseArrayAnswer(answers.sales_flow_start_steps);
        const remoteSalesFlowMiddleSteps = parseArrayAnswer(answers.sales_flow_middle_steps);
        const remoteSalesFlowFinalSteps = parseArrayAnswer(answers.sales_flow_final_steps);
        const legacyInstallationSteps = parseArrayAnswer(answers.installation_process_steps);
        const remoteServiceRegionModes = parseArrayAnswer(answers.service_region_modes);
        const fallbackPrimaryRegion =
          String(answers.service_region_primary_mode ?? "") ||
          remoteServiceRegionModes.find((value) => value !== "sob_consulta") ||
          "";
        const fallbackOutsideConsultation =
          typeof answers.service_region_outside_consultation === "boolean"
            ? answers.service_region_outside_consultation
            : remoteServiceRegionModes.includes("sob_consulta");
        setStep1Form((prev) => ({
          store_display_name: prev.store_display_name || String(answers.store_display_name ?? activeStore.name ?? ""),
          store_description: prev.store_description || String(answers.store_description ?? ""),
          city: prev.city || String(answers.city ?? ""),
          state: prev.state || String(answers.state ?? ""),
          service_regions:
            prev.service_regions ||
            (Array.isArray(answers.service_regions)
              ? answers.service_regions.join(", ")
              : String(answers.service_regions ?? "")),
          commercial_whatsapp: prev.commercial_whatsapp || String(answers.commercial_whatsapp ?? ""),
          store_services: prev.store_services.length ? prev.store_services : remoteStoreServices,
          store_services_other: prev.store_services_other || String(answers.store_services_other ?? ""),
          service_region_modes: prev.service_region_modes.length ? prev.service_region_modes : remoteServiceRegionModes,
          service_region_notes: prev.service_region_notes || String(answers.service_region_notes ?? ""),
          service_region_primary_mode: prev.service_region_primary_mode || fallbackPrimaryRegion,
          service_region_outside_consultation:
            prev.service_region_outside_consultation || fallbackOutsideConsultation,
        }));
        setStep2Form((prev) => ({
          pool_types:
            prev.pool_types ||
            (Array.isArray(answers.pool_types) ? answers.pool_types.join(", ") : String(answers.pool_types ?? "")),
          sells_chemicals:
            prev.sells_chemicals ||
            (typeof answers.sells_chemicals === "boolean"
              ? answers.sells_chemicals
                ? "sim"
                : "não"
              : String(answers.sells_chemicals ?? "")),
          sells_accessories:
            prev.sells_accessories ||
            (typeof answers.sells_accessories === "boolean"
              ? answers.sells_accessories
                ? "sim"
                : "não"
              : String(answers.sells_accessories ?? "")),
          offers_installation:
            prev.offers_installation ||
            (typeof answers.offers_installation === "boolean"
              ? answers.offers_installation
                ? "sim"
                : "não"
              : String(answers.offers_installation ?? "")),
          offers_technical_visit:
            prev.offers_technical_visit ||
            (typeof answers.offers_technical_visit === "boolean"
              ? answers.offers_technical_visit
                ? "sim"
                : "não"
              : String(answers.offers_technical_visit ?? "")),
          brands_worked:
            prev.brands_worked ||
            (Array.isArray(answers.brands_worked)
              ? answers.brands_worked.join(", ")
              : String(answers.brands_worked ?? "")),
          pool_types_selected: prev.pool_types_selected.length ? prev.pool_types_selected : remotePoolTypesSelected,
          pool_types_other: prev.pool_types_other || String(answers.pool_types_other ?? ""),
          main_store_brand:
            prev.main_store_brand ||
            String(answers.main_store_brand ?? "") ||
            (Array.isArray(answers.brands_worked)
              ? String(answers.brands_worked[0] ?? "")
              : String(answers.brands_worked ?? "")),
        }));
        setStep3Form((prev) => ({
          average_installation_time_days:
            prev.average_installation_time_days || String(answers.average_installation_time_days ?? ""),
          installation_days_rule: prev.installation_days_rule || String(answers.installation_days_rule ?? ""),
          installation_available_days:
            prev.installation_available_days.length
              ? prev.installation_available_days
              : Array.isArray(answers.installation_available_days)
              ? answers.installation_available_days.map(String)
              : [],
          technical_visit_days_rule:
            prev.technical_visit_days_rule || String(answers.technical_visit_days_rule ?? ""),
          technical_visit_available_days:
            prev.technical_visit_available_days.length
              ? prev.technical_visit_available_days
              : Array.isArray(answers.technical_visit_available_days)
              ? answers.technical_visit_available_days.map(String)
              : [],
          average_human_response_time:
            prev.average_human_response_time || String(answers.average_human_response_time ?? ""),
          installation_process_steps:
            prev.installation_process_steps.length
              ? prev.installation_process_steps
              : legacyInstallationSteps,
          installation_process_other:
            prev.installation_process_other || String(answers.installation_process_other ?? ""),
          technical_visit_rules_selected:
            prev.technical_visit_rules_selected.length
              ? prev.technical_visit_rules_selected
              : remoteTechnicalVisitRulesSelected,
          technical_visit_rules_other:
            prev.technical_visit_rules_other || String(answers.technical_visit_rules_other ?? ""),
          important_limitations_selected:
            prev.important_limitations_selected.length
              ? prev.important_limitations_selected
              : remoteImportantLimitationsSelected,
          important_limitations_other:
            prev.important_limitations_other || String(answers.important_limitations_other ?? ""),
          sales_flow_start_steps:
            prev.sales_flow_start_steps.length ? prev.sales_flow_start_steps : remoteSalesFlowStartSteps,
          sales_flow_middle_steps:
            prev.sales_flow_middle_steps.length ? prev.sales_flow_middle_steps : remoteSalesFlowMiddleSteps,
          sales_flow_final_steps:
            prev.sales_flow_final_steps.length ? prev.sales_flow_final_steps : remoteSalesFlowFinalSteps,
          sales_flow_notes: prev.sales_flow_notes || String(answers.sales_flow_notes ?? ""),
          sales_flow_start_confirmed:
            prev.sales_flow_start_confirmed || Boolean(answers.sales_flow_start_confirmed),
          sales_flow_middle_confirmed:
            prev.sales_flow_middle_confirmed || Boolean(answers.sales_flow_middle_confirmed),
          sales_flow_final_confirmed:
            prev.sales_flow_final_confirmed || Boolean(answers.sales_flow_final_confirmed),
        }));
        const remotePriceMustUnderstandBefore = parseArrayAnswer(
          answers.price_must_understand_before ?? answers.price_direct_conditions
        );
        setStep4Form((prev) => ({
          average_ticket: prev.average_ticket || String(answers.average_ticket ?? ""),
          can_offer_discount:
            prev.can_offer_discount ||
            (typeof answers.can_offer_discount === "boolean"
              ? answers.can_offer_discount
                ? "sim"
                : "não"
              : String(answers.can_offer_discount ?? "")),
          max_discount_percent: prev.max_discount_percent || String(answers.max_discount_percent ?? ""),
          accepted_payment_methods:
            prev.accepted_payment_methods.length
              ? prev.accepted_payment_methods
              : Array.isArray(answers.accepted_payment_methods)
              ? answers.accepted_payment_methods.map(String)
              : [],
          ai_can_send_price_directly:
            prev.ai_can_send_price_directly ||
            (typeof answers.ai_can_send_price_directly === "boolean"
              ? answers.ai_can_send_price_directly
                ? "sim"
                : "não"
              : String(answers.ai_can_send_price_directly ?? "")),
          price_direct_rule: prev.price_direct_rule || String(answers.price_direct_rule ?? ""),
          human_help_discount_cases:
            prev.human_help_discount_cases || String(answers.human_help_discount_cases ?? ""),
          human_help_custom_project_cases:
            prev.human_help_custom_project_cases || String(answers.human_help_custom_project_cases ?? ""),
          human_help_payment_cases:
            prev.human_help_payment_cases || String(answers.human_help_payment_cases ?? ""),
          price_direct_conditions: prev.price_direct_conditions.length ? prev.price_direct_conditions : [],
          price_direct_rule_other: prev.price_direct_rule_other || String(answers.price_direct_rule_other ?? ""),
          human_help_discount_cases_selected:
            prev.human_help_discount_cases_selected.length
              ? prev.human_help_discount_cases_selected
              : remoteHumanHelpDiscountSelected,
          human_help_discount_cases_other:
            prev.human_help_discount_cases_other || String(answers.human_help_discount_cases_other ?? ""),
          human_help_custom_project_cases_selected:
            prev.human_help_custom_project_cases_selected.length
              ? prev.human_help_custom_project_cases_selected
              : remoteHumanHelpCustomProjectSelected,
          human_help_custom_project_cases_other:
            prev.human_help_custom_project_cases_other ||
            String(answers.human_help_custom_project_cases_other ?? ""),
          human_help_payment_cases_selected:
            prev.human_help_payment_cases_selected.length
              ? prev.human_help_payment_cases_selected
              : remoteHumanHelpPaymentSelected,
          human_help_payment_cases_other:
            prev.human_help_payment_cases_other || String(answers.human_help_payment_cases_other ?? ""),
          price_needs_human_help:
            prev.price_needs_human_help || String(answers.price_needs_human_help ?? ""),
          price_talk_mode: prev.price_talk_mode || String(answers.price_talk_mode ?? ""),
          price_must_understand_before:
            prev.price_must_understand_before.length
              ? prev.price_must_understand_before
              : remotePriceMustUnderstandBefore,
        }));
        setStep5Form((prev) => ({
          responsible_name: prev.responsible_name || String(answers.responsible_name ?? ""),
          responsible_whatsapp: prev.responsible_whatsapp || String(answers.responsible_whatsapp ?? ""),
          ai_should_notify_responsible:
            prev.ai_should_notify_responsible ||
            (typeof answers.ai_should_notify_responsible === "boolean"
              ? answers.ai_should_notify_responsible
                ? "sim"
                : "não"
              : String(answers.ai_should_notify_responsible ?? "")),
          final_activation_notes: prev.final_activation_notes || String(answers.final_activation_notes ?? ""),
          confirm_information_is_correct:
            prev.confirm_information_is_correct || Boolean(answers.confirm_information_is_correct),
          responsible_notification_cases:
            prev.responsible_notification_cases.length
              ? prev.responsible_notification_cases
              : remoteResponsibleNotificationCases,
          responsible_notification_cases_other:
            prev.responsible_notification_cases_other ||
            String(answers.responsible_notification_cases_other ?? ""),
          activation_preferences:
            prev.activation_preferences.length ? prev.activation_preferences : remoteActivationPreferences,
          activation_preferences_other:
            prev.activation_preferences_other || String(answers.activation_preferences_other ?? ""),
        }));
        setHasCompletedOnboardingOnce(Boolean((answers as any)?.status === "completed"));
      } catch (err) {
        console.error("[OnboardingPage] loadAnswers unexpected error:", err);
        setFatalError("Falha ao carregar respostas do onboarding.");
      }
    };
    loadAnswers();
  }, [organizationId, activeStore?.id, activeStore?.name]);
  useEffect(() => {
    const loadDiscountSettings = async () => {
      if (!organizationId || !activeStore?.id) return;
      try {
        const { data, error } = await supabase
          .from("store_discount_settings")
          .select(
            "store_id,organization_id,default_discount_percent,max_discount_percent,allow_ask_above_max_discount,created_at,updated_at"
          )
          .eq("organization_id", organizationId)
          .eq("store_id", activeStore.id)
          .maybeSingle();
        if (error) {
          console.error("[OnboardingPage] loadDiscountSettings error:", error);
          return;
        }
        const row = (data ?? null) as DiscountSettingsRow | null;
        setDiscountSettings(row);
        if (row) {
          const canOffer =
            Number(row.default_discount_percent ?? 0) > 0 ||
            Number(row.max_discount_percent ?? 0) > 0 ||
            Boolean(row.allow_ask_above_max_discount);
          setStep4Form((prev) => ({
            ...prev,
            can_offer_discount: canOffer ? "sim" : "não",
            max_discount_percent: String(row.default_discount_percent ?? 0),
          }));
        }
      } catch (err) {
        console.error("[OnboardingPage] loadDiscountSettings unexpected error:", err);
      }
    };
    loadDiscountSettings();
  }, [organizationId, activeStore?.id]);
  useEffect(() => {
    if (currentStep === 1 && step1DraftRecovered) {
      setSuccessMessage("Rascunho local da etapa 1 recuperado.");
    } else if (currentStep === 2 && step2DraftRecovered) {
      setSuccessMessage("Rascunho local da etapa 2 recuperado.");
    } else if (currentStep === 3 && step3DraftRecovered) {
      setSuccessMessage("Rascunho local da etapa 3 recuperado.");
    } else if (currentStep === 4 && step4DraftRecovered) {
      setSuccessMessage("Rascunho local da etapa 4 recuperado.");
    } else if (currentStep === 5 && step5DraftRecovered) {
      setSuccessMessage("Rascunho local da etapa 5 recuperado.");
    }
  }, [
    currentStep,
    step1DraftRecovered,
    step2DraftRecovered,
    step3DraftRecovered,
    step4DraftRecovered,
    step5DraftRecovered,
  ]);
  async function saveStep1(e: FormEvent) {
    e.preventDefault();
    if (!step1Form.store_display_name.trim()) {
      setFormError("Preencha o nome que a loja quer usar no sistema.");
      return;
    }
    if (!step1Form.city.trim()) {
      setFormError("Preencha a cidade da loja.");
      return;
    }
    if (!step1Form.state.trim()) {
      setFormError("Preencha o estado da loja.");
      return;
    }
    if (!step1Form.commercial_whatsapp.trim()) {
      setFormError("Preencha o WhatsApp comercial da loja.");
      return;
    }
    if (!step1Form.service_region_primary_mode) {
      setFormError("Escolha o alcance regional principal da loja.");
      return;
    }
    if (step1Form.store_services.length === 0 && !step1Form.store_services_other.trim()) {
      setFormError("Marque pelo menos um serviço principal da loja.");
      return;
    }
    if (!organizationId || !activeStore?.id) return;
    await upsertAnswers(
      [
        ["store_display_name", step1Form.store_display_name.trim()],
        ["store_description", step1Form.store_description.trim()],
        ["city", step1Form.city.trim()],
        ["state", step1Form.state.trim()],
        ["service_regions", step1Form.service_regions.trim()],
        ["commercial_whatsapp", step1Form.commercial_whatsapp.trim()],
        ["store_services", step1Form.store_services],
        ["store_services_other", step1Form.store_services_other.trim()],
        ["service_region_modes", step1Form.service_region_modes],
        ["service_region_notes", step1Form.service_region_notes.trim()],
        ["service_region_primary_mode", step1Form.service_region_primary_mode],
        ["service_region_outside_consultation", step1Form.service_region_outside_consultation],
      ],
      "Etapa 1 salva com sucesso.",
      2
    );
    setStep1DraftRecovered(false);
  }
  async function saveStep2(e: FormEvent) {
    e.preventDefault();
    if (step2Form.pool_types_selected.length === 0 && !step2Form.pool_types_other.trim()) {
      setFormError("Marque pelo menos um tipo de piscina ou preencha o campo complementar.");
      return;
    }
    if (!step2Form.sells_chemicals) {
      setFormError("Informe se a loja vende produtos químicos.");
      return;
    }
    if (!step2Form.sells_accessories) {
      setFormError("Informe se a loja vende acessórios.");
      return;
    }
    if (!step2Form.offers_installation) {
      setFormError("Informe se a loja oferece instalação.");
      return;
    }
    if (!step2Form.offers_technical_visit) {
      setFormError("Informe se a loja oferece visita técnica.");
      return;
    }
    if (!step2Form.main_store_brand.trim()) {
      setFormError("Preencha a principal marca trabalhada pela loja.");
      return;
    }
    if (!organizationId || !activeStore?.id) return;
    await upsertAnswers(
      [
        ["pool_types", step2Form.pool_types.trim()],
        ["sells_chemicals", step2Form.sells_chemicals.trim().toLowerCase() === "sim"],
        ["sells_accessories", step2Form.sells_accessories.trim().toLowerCase() === "sim"],
        ["offers_installation", step2Form.offers_installation.trim().toLowerCase() === "sim"],
        ["offers_technical_visit", step2Form.offers_technical_visit.trim().toLowerCase() === "sim"],
        ["brands_worked", step2Form.brands_worked.trim()],
        ["pool_types_selected", step2Form.pool_types_selected],
        ["pool_types_other", step2Form.pool_types_other.trim()],
        ["main_store_brand", step2Form.main_store_brand.trim()],
      ],
      "Etapa 2 salva com sucesso.",
      3
    );
    setStep2DraftRecovered(false);
  }
  async function saveStep3(e: FormEvent) {
    e.preventDefault();
    if (!step3Form.average_human_response_time.trim()) {
      setFormError("Preencha o tempo médio de resposta humana.");
      return;
    }
    if (storeHasInstallation) {
      if (!step3Form.average_installation_time_days.trim()) {
        setFormError("Preencha o tempo médio de instalação.");
        return;
      }
      if (step3Form.installation_available_days.length === 0) {
        setFormError("Marque os dias disponíveis para instalação.");
        return;
      }
      if (
        step3Form.installation_process_steps.length === 0 &&
        !step3Form.installation_process_other.trim()
      ) {
        setFormError("Explique como normalmente funciona a instalação.");
        return;
      }
    }
    if (storeHasTechnicalVisit) {
      if (step3Form.technical_visit_available_days.length === 0) {
        setFormError("Marque os dias disponíveis para visita técnica.");
        return;
      }
      if (
        step3Form.technical_visit_rules_selected.length === 0 &&
        !step3Form.technical_visit_rules_other.trim()
      ) {
        setFormError("Explique as regras principais da visita técnica.");
        return;
      }
    }
    if (
      step3Form.important_limitations_selected.length === 0 &&
      !step3Form.important_limitations_other.trim()
    ) {
      setFormError("Marque ou escreva pelo menos uma limitação importante.");
      return;
    }
    if (step3Form.sales_flow_start_steps.length === 0) {
      setFormError("Marque pelo menos uma etapa do início do fluxo comercial.");
      return;
    }
    if (step3Form.sales_flow_middle_steps.length === 0) {
      setFormError("Marque pelo menos uma etapa da negociação.");
      return;
    }
    if (step3Form.sales_flow_final_steps.length === 0) {
      setFormError("Marque pelo menos uma etapa do final do fluxo.");
      return;
    }
    if (!organizationId || !activeStore?.id) return;
    await upsertAnswers(
      [
        ["average_installation_time_days", step3Form.average_installation_time_days.trim()],
        ["installation_days_rule", step3Form.installation_days_rule.trim()],
        ["installation_available_days", step3Form.installation_available_days],
        ["technical_visit_days_rule", step3Form.technical_visit_days_rule.trim()],
        ["technical_visit_available_days", step3Form.technical_visit_available_days],
        ["average_human_response_time", step3Form.average_human_response_time.trim()],
        ["installation_process_steps", step3Form.installation_process_steps],
        ["installation_process_other", step3Form.installation_process_other.trim()],
        ["technical_visit_rules_selected", step3Form.technical_visit_rules_selected],
        ["technical_visit_rules_other", step3Form.technical_visit_rules_other.trim()],
        ["important_limitations_selected", step3Form.important_limitations_selected],
        ["important_limitations_other", step3Form.important_limitations_other.trim()],
        ["sales_flow_start_steps", step3Form.sales_flow_start_steps],
        ["sales_flow_middle_steps", step3Form.sales_flow_middle_steps],
        ["sales_flow_final_steps", step3Form.sales_flow_final_steps],
        ["sales_flow_notes", step3Form.sales_flow_notes.trim()],
        ["sales_flow_start_confirmed", step3Form.sales_flow_start_confirmed],
        ["sales_flow_middle_confirmed", step3Form.sales_flow_middle_confirmed],
        ["sales_flow_final_confirmed", step3Form.sales_flow_final_confirmed],
      ],
      "Etapa 3 salva com sucesso.",
      4
    );
    setStep3DraftRecovered(false);
  }
  async function saveStep4(e: FormEvent) {
    e.preventDefault();
    if (!step4Form.average_ticket.trim()) {
      setFormError("Informe o ticket médio da loja.");
      return;
    }
    if (!hasDiscountConfigOverride) {
      if (!step4Form.can_offer_discount) {
        setFormError("Informe se a loja pode ou não dar desconto.");
        return;
      }
      if (step4Form.can_offer_discount === "sim" && !step4Form.max_discount_percent.trim()) {
        setFormError("Informe o desconto máximo permitido.");
        return;
      }
    }
    if (step4Form.accepted_payment_methods.length === 0) {
      setFormError("Selecione pelo menos uma forma de pagamento ou condição comercial.");
      return;
    }
    if (!step4Form.ai_can_send_price_directly) {
      setFormError("Informe se a IA pode ou não falar preço sem chamar alguém da loja.");
      return;
    }
    if (step4Form.ai_can_send_price_directly === "sim") {
      if (
        step4Form.price_must_understand_before.length === 0 &&
        !step4Form.price_direct_rule_other.trim()
      ) {
        setFormError("Informe o que a IA precisa entender antes de falar preço.");
        return;
      }
      if (!step4Form.price_talk_mode) {
        setFormError("Escolha como a IA pode falar preço.");
        return;
      }
      if (!step4Form.price_needs_human_help) {
        setFormError("Informe se a IA precisa ou não de ajuda humana para falar preço.");
        return;
      }
    }
    if (
      step4Form.human_help_discount_cases_selected.length === 0 &&
      !step4Form.human_help_discount_cases_other.trim()
    ) {
      setFormError("Informe em quais casos a IA deve chamar alguém por causa de desconto.");
      return;
    }
    if (
      step4Form.human_help_custom_project_cases_selected.length === 0 &&
      !step4Form.human_help_custom_project_cases_other.trim()
    ) {
      setFormError("Informe em quais casos a IA deve chamar alguém por causa de projeto especial.");
      return;
    }
    if (
      step4Form.human_help_payment_cases_selected.length === 0 &&
      !step4Form.human_help_payment_cases_other.trim()
    ) {
      setFormError("Informe em quais casos a IA deve chamar alguém por causa de pagamento.");
      return;
    }
    const effectiveCanOfferDiscountForSave = hasDiscountConfigOverride
      ? effectiveDiscountCanOfferValue
      : step4Form.can_offer_discount;
    const effectiveMaxDiscountPercentForSave = hasDiscountConfigOverride
      ? effectiveOnboardingDiscountPercent
      : step4Form.max_discount_percent.trim();
    const priceDirectConditionsLegacy = [
      ...step4Form.price_must_understand_before,
      ...(step4Form.price_talk_mode ? [step4Form.price_talk_mode] : []),
      ...(step4Form.price_needs_human_help === "sim" ? ["nunca_sem_chamar_humano"] : []),
    ];
    const priceDirectRuleText =
      step4Form.ai_can_send_price_directly === "não"
        ? "A IA não pode falar preço sem chamar uma pessoa da loja."
        : [
            joinSelectedLabels(step4Form.price_must_understand_before, PRICE_DIRECT_BEFORE_OPTIONS),
            step4Form.price_talk_mode
              ? PRICE_TALK_MODE_OPTIONS.find((option) => option.value === step4Form.price_talk_mode)
                  ?.label ?? ""
              : "",
            step4Form.price_needs_human_help === "sim"
              ? "Precisa de ajuda humana para falar preço."
              : "Não precisa de ajuda humana para falar preço na regra normal.",
            step4Form.price_direct_rule_other.trim(),
          ]
            .filter(Boolean)
            .join(" | ");
    const humanHelpDiscountText = joinSelectedLabels(
      step4Form.human_help_discount_cases_selected,
      HUMAN_HELP_DISCOUNT_OPTIONS,
      step4Form.human_help_discount_cases_other
    );
    const humanHelpCustomProjectText = joinSelectedLabels(
      step4Form.human_help_custom_project_cases_selected,
      HUMAN_HELP_CUSTOM_PROJECT_OPTIONS,
      step4Form.human_help_custom_project_cases_other
    );
    const humanHelpPaymentText = joinSelectedLabels(
      step4Form.human_help_payment_cases_selected,
      HUMAN_HELP_PAYMENT_OPTIONS,
      step4Form.human_help_payment_cases_other
    );
    if (!organizationId || !activeStore?.id) return;
    setSaving(true);
    setFormError(null);
    setSuccessMessage(null);
    try {
      const payloads: Array<[string, unknown]> = [
        ["average_ticket", step4Form.average_ticket.trim()],
        ["can_offer_discount", effectiveCanOfferDiscountForSave.trim().toLowerCase() === "sim"],
        ["max_discount_percent", effectiveMaxDiscountPercentForSave],
        ["accepted_payment_methods", step4Form.accepted_payment_methods],
        [
          "ai_can_send_price_directly",
          step4Form.ai_can_send_price_directly.trim().toLowerCase() === "sim",
        ],
        ["price_direct_rule", priceDirectRuleText],
        ["human_help_discount_cases", humanHelpDiscountText],
        ["human_help_custom_project_cases", humanHelpCustomProjectText],
        ["human_help_payment_cases", humanHelpPaymentText],
        ["price_direct_conditions", priceDirectConditionsLegacy],
        ["price_direct_rule_other", step4Form.price_direct_rule_other.trim()],
        ["human_help_discount_cases_selected", step4Form.human_help_discount_cases_selected],
        ["human_help_discount_cases_other", step4Form.human_help_discount_cases_other.trim()],
        [
          "human_help_custom_project_cases_selected",
          step4Form.human_help_custom_project_cases_selected,
        ],
        ["human_help_custom_project_cases_other", step4Form.human_help_custom_project_cases_other.trim()],
        ["human_help_payment_cases_selected", step4Form.human_help_payment_cases_selected],
        ["human_help_payment_cases_other", step4Form.human_help_payment_cases_other.trim()],
        ["price_needs_human_help", step4Form.price_needs_human_help],
        ["price_talk_mode", step4Form.price_talk_mode],
        ["price_must_understand_before", step4Form.price_must_understand_before],
      ];
      for (const [questionKey, answer] of payloads) {
        const { error: rpcError } = await supabase.rpc("onboarding_upsert_answer_scoped", {
          p_organization_id: organizationId,
          p_store_id: activeStore.id,
          p_question_key: questionKey,
          p_answer: answer,
        });
        if (rpcError) throw new Error(`Falha ao salvar campo: ${questionKey}`);
      }
      if (!discountSettings) {
        const onboardingDiscountPercent =
          step4Form.can_offer_discount === "sim"
            ? Number(step4Form.max_discount_percent.trim() || 0)
            : 0;
        const bootstrapPayload = {
          organization_id: organizationId,
          store_id: activeStore.id,
          default_discount_percent: onboardingDiscountPercent,
          max_discount_percent: onboardingDiscountPercent,
          allow_ask_above_max_discount: false,
        };
        const { data: bootData, error: bootstrapError } = await supabase
          .from("store_discount_settings")
          .upsert(bootstrapPayload, { onConflict: "store_id" })
          .select(
            "store_id,organization_id,default_discount_percent,max_discount_percent,allow_ask_above_max_discount,created_at,updated_at"
          )
          .single();
        if (bootstrapError) {
          throw new Error("Falha ao criar a política inicial de desconto nas Configurações.");
        }
        setDiscountSettings((bootData ?? bootstrapPayload) as DiscountSettingsRow);
      }
      const { error: statusError } = await supabase.rpc("onboarding_upsert_store_onboarding_scoped", {
        p_organization_id: organizationId,
        p_store_id: activeStore.id,
        p_status: "in_progress",
      });
      if (statusError) throw new Error("Falha ao atualizar status do onboarding.");
      setSuccessMessage(
        hasDiscountConfigOverride
          ? "Etapa 4 salva com sucesso. Os descontos continuam sendo controlados pela aba Configurações."
          : "Etapa 4 salva com sucesso. A política inicial de desconto foi criada em Configurações."
      );
      ignoreNextStepScrollRef.current = false;
      setCurrentStep(5);
      setStep4DraftRecovered(false);
    } catch (err) {
      console.error("[OnboardingPage] saveStep4 error:", err);
      setFormError(err instanceof Error ? err.message : "Erro ao salvar etapa.");
    } finally {
      setSaving(false);
    }
  }
  async function saveStep5(e: FormEvent) {
    e.preventDefault();
    if (!step5Form.responsible_name.trim()) {
      setFormError("Preencha o nome da pessoa principal que a IA deve acionar.");
      return;
    }
    if (!step5Form.responsible_whatsapp.trim()) {
      setFormError("Preencha o WhatsApp dessa pessoa.");
      return;
    }
    if (!step5Form.ai_should_notify_responsible) {
      setFormError("Informe se a IA deve ou não avisar essa pessoa quando surgir algo importante.");
      return;
    }
    if (
      step5Form.ai_should_notify_responsible === "sim" &&
      step5Form.responsible_notification_cases.length === 0 &&
      !step5Form.responsible_notification_cases_other.trim()
    ) {
      setFormError("Informe em quais casos essa pessoa deve ser avisada.");
      return;
    }
    if (
      step5Form.activation_preferences.length === 0 &&
      !step5Form.activation_preferences_other.trim()
    ) {
      setFormError("Marque pelo menos uma orientação final para ativar a IA.");
      return;
    }
    if (!step5Form.confirm_information_is_correct) {
      setFormError("Confirme que as informações estão corretas para concluir o onboarding.");
      return;
    }
    const finalActivationNotesText = joinSelectedLabels(
      step5Form.activation_preferences,
      [...ACTIVATION_STYLE_OPTIONS, ...ACTIVATION_GUARDRAIL_OPTIONS],
      step5Form.activation_preferences_other
    );
    if (!organizationId || !activeStore?.id) return;
    setSaving(true);
    setFormError(null);
    setSuccessMessage(null);
    try {
      const payloads: Array<[string, unknown]> = [
        ["responsible_name", step5Form.responsible_name.trim()],
        ["responsible_whatsapp", step5Form.responsible_whatsapp.trim()],
        [
          "ai_should_notify_responsible",
          step5Form.ai_should_notify_responsible.trim().toLowerCase() === "sim",
        ],
        ["final_activation_notes", finalActivationNotesText],
        ["confirm_information_is_correct", step5Form.confirm_information_is_correct],
        ["responsible_notification_cases", step5Form.responsible_notification_cases],
        ["responsible_notification_cases_other", step5Form.responsible_notification_cases_other.trim()],
        ["activation_preferences", step5Form.activation_preferences],
        ["activation_preferences_other", step5Form.activation_preferences_other.trim()],
      ];
      for (const [questionKey, answer] of payloads) {
        const { error: rpcError } = await supabase.rpc("onboarding_upsert_answer_scoped", {
          p_organization_id: organizationId,
          p_store_id: activeStore.id,
          p_question_key: questionKey,
          p_answer: answer,
        });
        if (rpcError) throw new Error(`Falha ao salvar campo: ${questionKey}`);
      }
      const { error: statusError } = await supabase.rpc("onboarding_upsert_store_onboarding_scoped", {
        p_organization_id: organizationId,
        p_store_id: activeStore.id,
        p_status: "completed",
      });
      if (statusError) throw new Error("Falha ao concluir o onboarding.");
      setSuccessMessage("Onboarding concluído com sucesso.");
      setHasCompletedOnboardingOnce(true);
      setStep5DraftRecovered(false);
      setTimeout(() => {
        router.push("/configuracoes");
      }, 1000);
    } catch (err) {
      console.error("[OnboardingPage] saveStep5 error:", err);
      setFormError(err instanceof Error ? err.message : "Erro ao salvar etapa.");
    } finally {
      setSaving(false);
    }
  }
  if (storeLoading) {
    return (
      <div className="min-h-screen bg-gray-100 px-4 py-6">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-gray-600">Carregando loja...</p>
          </div>
        </div>
      </div>
    );
  }
  if (fatalError) {
    return (
      <div className="min-h-screen bg-gray-100 px-4 py-6">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 shadow-sm">
            <p className="text-sm text-red-800">{fatalError}</p>
          </div>
        </div>
      </div>
    );
  }
  if (!activeStore || !organizationId) return null;
  return (
    <div className="min-h-screen bg-gray-100 px-4 py-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          <StepBadge step={1} currentStep={currentStep} title="Loja" onClick={() => changeStep(1)} />
          <StepBadge step={2} currentStep={currentStep} title="Piscinas" onClick={() => changeStep(2)} />
          <StepBadge step={3} currentStep={currentStep} title="Operação" onClick={() => changeStep(3)} />
          <StepBadge step={4} currentStep={currentStep} title="Comercial" onClick={() => changeStep(4)} />
          <StepBadge step={5} currentStep={currentStep} title="Ativação" onClick={() => changeStep(5)} />
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="mb-1 text-sm font-medium text-gray-500">Onboarding inicial</p>
              <h1 className="mb-2 text-2xl font-bold text-gray-900">
                {currentStep === 1 && "Etapa 1 — Loja"}
                {currentStep === 2 && "Etapa 2 — Piscinas"}
                {currentStep === 3 && "Etapa 3 — Operação da loja"}
                {currentStep === 4 && "Etapa 4 — Comercial"}
                {currentStep === 5 && "Etapa 5 — Ativação"}
              </h1>
              <p className="text-sm leading-6 text-gray-600">
                {currentStep === 1 &&
                  "Vamos preencher os dados principais da loja de um jeito rápido, claro e sem complicação."}
                {currentStep === 2 &&
                  "Agora vamos definir os tipos de piscina e a marca principal da loja, sem repetir o que já foi marcado antes."}
                {currentStep === 3 &&
                  "Agora vamos organizar como a loja funciona no dia a dia para a IA responder do jeito certo."}
                {currentStep === 4 &&
                  "Agora vamos definir a parte comercial da loja, principalmente preço, desconto, pagamento e quando chamar alguém da equipe."}
                {currentStep === 5 &&
                  "Por fim, vamos organizar quem a IA deve avisar, em quais casos e quais orientações finais ela precisa seguir."}
              </p>
              {hasCompletedOnboardingOnce ? (
                <div className="mt-3">
                  <InfoBlock
                    title="Onboarding já concluído antes"
                    description="Você pode revisar e ajustar os dados quando quiser. As regras vivas da loja continuam sendo controladas pela aba Configurações."
                    subtle
                  />
                </div>
              ) : null}
            </div>
            <div className="flex w-full flex-wrap items-center gap-3 lg:w-auto lg:justify-end">
              <button
                type="button"
                onClick={() => navigateWithFallback("/configuracoes")}
                className="inline-flex items-center justify-center rounded-xl border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                Ir para Configurações
              </button>
              <button
                type="button"
                onClick={() => navigateWithFallback("/dashboard")}
                className="inline-flex items-center justify-center rounded-xl bg-black px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
              >
                Salvar e sair
              </button>
            </div>
          </div>
          {formError ? (
            <div className="mb-6">
              <InfoBlock title="Ajuste necessário" description={formError} />
            </div>
          ) : null}
          {currentStep === 1 && (
            <form onSubmit={saveStep1} className="space-y-6">
              <div>
                <SectionTitle
                  title="Como a loja quer aparecer no sistema?"
                  hint="Use o nome que faz mais sentido para os atendimentos, mensagens e organização interna."
                />
                <input
                  type="text"
                  value={step1Form.store_display_name}
                  onChange={(e) => updateStep1Field("store_display_name", e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Ex.: Loja Matriz"
                  required
                />
              </div>
              <div>
                <SectionTitle
                  title="Como você descreve a loja em poucas palavras?"
                  hint="Isso ajuda a IA a entender o posicionamento principal da empresa."
                />
                <textarea
                  value={step1Form.store_description}
                  onChange={(e) => updateStep1Field("store_description", e.target.value)}
                  rows={4}
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Ex.: Loja especializada em piscinas, produtos químicos e instalação."
                />
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <SectionTitle title="Cidade da loja" />
                  <input
                    type="text"
                    value={step1Form.city}
                    onChange={(e) => updateStep1Field("city", e.target.value)}
                    className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                    placeholder="Ex.: Suzano"
                    required
                  />
                </div>
                <div>
                  <SectionTitle title="Estado da loja" />
                  <input
                    type="text"
                    value={step1Form.state}
                    onChange={(e) => updateStep1Field("state", e.target.value)}
                    className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                    placeholder="Ex.: SP"
                    required
                  />
                </div>
              </div>
              <div>
                <SectionTitle
                  title="Quais regiões a loja atende?"
                  hint="Pode escrever cidades, bairros ou uma descrição simples."
                />
                <input
                  type="text"
                  value={step1Form.service_regions}
                  onChange={(e) => updateStep1Field("service_regions", e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Ex.: Suzano, Mogi, Poá e região"
                />
              </div>
              <div>
                <SectionTitle
                  title="Qual é o WhatsApp comercial da loja?"
                  hint="Esse é o canal principal em que os clientes falam com a loja."
                />
                <input
                  type="text"
                  value={step1Form.commercial_whatsapp}
                  onChange={(e) => updateStep1Field("commercial_whatsapp", formatWhatsappInput(e.target.value))}
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Ex.: 5511999999999"
                  required
                />
              </div>
              <div>
                <SectionTitle
                  title="Quais serviços principais a loja oferece?"
                  hint="Marque tudo o que realmente faz sentido hoje."
                />
                <SelectorGrid
                  options={STORE_SERVICE_OPTIONS}
                  selectedValues={step1Form.store_services}
                  onToggle={(value) => toggleStep1ArrayField("store_services", value)}
                />
                <input
                  type="text"
                  value={step1Form.store_services_other}
                  onChange={(e) => updateStep1Field("store_services_other", e.target.value)}
                  className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Se tiver algo fora da lista, escreva aqui (opcional)"
                />
              </div>
              <div>
                <SectionTitle
                  title="Qual é o alcance regional principal da loja?"
                  hint="Escolha a opção que melhor representa a operação real."
                />
                <SingleSelectorGrid
                  options={SERVICE_REGION_MODE_OPTIONS.filter((option) => option.value !== "sob_consulta")}
                  value={step1Form.service_region_primary_mode}
                  onChange={(value) => updateStep1Field("service_region_primary_mode", value)}
                />
              </div>
              <div>
                <SectionTitle
                  title="Como a loja trata atendimento fora da região principal?"
                  hint="Marque as formas de atendimento que podem acontecer na prática."
                />
                <SelectorGrid
                  options={SERVICE_REGION_MODE_OPTIONS}
                  selectedValues={step1Form.service_region_modes}
                  onToggle={(value) => toggleStep1ArrayField("service_region_modes", value)}
                />
              </div>
              <div>
                <SectionTitle
                  title="A loja atende fora da região principal só sob consulta?"
                  hint="Use isso para deixar claro quando precisa avaliar caso a caso."
                />
                <SingleSelectorGrid
                  options={YES_NO_OPTIONS}
                  value={step1Form.service_region_outside_consultation ? "sim" : "não"}
                  onChange={(value) => updateStep1Field("service_region_outside_consultation", value === "sim")}
                />
              </div>
              <div>
                <SectionTitle
                  title="Observações sobre a região atendida"
                  hint="Escreva regras extras se quiser complementar."
                />
                <textarea
                  value={step1Form.service_region_notes}
                  onChange={(e) => updateStep1Field("service_region_notes", e.target.value)}
                  rows={4}
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Ex.: Fora da região só com taxa, dependendo do projeto."
                />
              </div>
              <div className="flex flex-col gap-3 border-t border-gray-200 pt-4 md:flex-row md:items-center md:justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-black px-5 py-2.5 font-medium text-white disabled:opacity-60"
                >
                  {saving ? "Salvando..." : "Salvar e ir para etapa 2"}
                </button>
              </div>
            </form>
          )}
          {currentStep === 2 && (
            <form onSubmit={saveStep2} className="space-y-6">
              <div>
                <SectionTitle
                  title="Quais tipos de piscina a loja trabalha?"
                  hint="Marque tudo o que faz sentido hoje. Se precisar, complemente no campo abaixo."
                />
                <SelectorGrid
                  options={POOL_TYPE_OPTIONS}
                  selectedValues={step2Form.pool_types_selected}
                  onToggle={(value) => toggleStep2ArrayField("pool_types_selected", value)}
                />
                <input
                  type="text"
                  value={step2Form.pool_types_other}
                  onChange={(e) => updateStep2Field("pool_types_other", e.target.value)}
                  className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Se quiser complementar, escreva aqui (opcional)"
                />
              </div>
              <div>
                <SectionTitle title="A loja vende produtos químicos?" />
                <SingleSelectorGrid
                  options={YES_NO_OPTIONS}
                  value={step2Form.sells_chemicals}
                  onChange={(value) => updateStep2Field("sells_chemicals", value)}
                />
              </div>
              <div>
                <SectionTitle title="A loja vende acessórios?" />
                <SingleSelectorGrid
                  options={YES_NO_OPTIONS}
                  value={step2Form.sells_accessories}
                  onChange={(value) => updateStep2Field("sells_accessories", value)}
                />
              </div>
              <div>
                <SectionTitle title="A loja oferece instalação?" />
                <SingleSelectorGrid
                  options={YES_NO_OPTIONS}
                  value={step2Form.offers_installation}
                  onChange={(value) => updateStep2Field("offers_installation", value)}
                />
              </div>
              <div>
                <SectionTitle title="A loja oferece visita técnica?" />
                <SingleSelectorGrid
                  options={YES_NO_OPTIONS}
                  value={step2Form.offers_technical_visit}
                  onChange={(value) => updateStep2Field("offers_technical_visit", value)}
                />
              </div>
              <div>
                <SectionTitle
                  title="Quais marcas a loja trabalha?"
                  hint="Pode ser uma lista simples separada por vírgula."
                />
                <input
                  type="text"
                  value={step2Form.brands_worked}
                  onChange={(e) => updateStep2Field("brands_worked", e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Ex.: Cris Água, Brustec, Sodramar"
                />
              </div>
              <div>
                <SectionTitle
                  title="Qual é a principal marca trabalhada pela loja?"
                  hint="Escolha a marca principal para referência da IA."
                />
                <input
                  type="text"
                  value={step2Form.main_store_brand}
                  onChange={(e) => updateStep2Field("main_store_brand", e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Ex.: Cris Água"
                  required
                />
              </div>
              <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4">
                <SectionTitle
                  title="Importar catálogo, piscinas e materiais da loja"
                  hint="Envie fotos, Excel básico, Word básico ou PDF básico para a IA começar a entender os produtos, piscinas, acessórios e materiais mais comuns da loja. Nesta fase ela ainda mostra uma prévia da leitura antes da parte de salvamento real."
                />
                <div className="space-y-3">
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx,.txt,.xlsx,.xls,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.gif,.bmp,.heic,.heif,image/*"
                    onChange={async (e) => {
                      const input = e.currentTarget;
                      const selectedFiles = Array.from(input.files ?? []) as File[];
                      setIntelligentImportFiles(selectedFiles);
                      setIntelligentImportSelectedFilesPreview(
                        await buildSelectedFilePreviews(selectedFiles)
                      );
                      setIntelligentImportRecovered(false);
                      setIntelligentImportError(null);
                      setIntelligentImportSuccess(null);
                      setIntelligentImportResult(null);
                      if (input) {
                        input.value = "";
                      }
                    }}
                    className="block w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-700 outline-none file:mr-3 file:rounded-lg file:border-0 file:bg-black file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
                  />
                  <div className="rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm text-gray-700">
                    Você pode enviar fotos do catálogo, imagens de produtos, tabelas simples em foto, PDF, Word, Excel e PowerPoint. As imagens selecionadas aparecem em pré-visualização logo abaixo para facilitar a conferência antes do teste.
                  </div>
                  {visibleIntelligentImportFiles.length > 0 ? (
                    <div className="rounded-xl border border-gray-200 bg-white p-3">
                      <p className="text-sm font-semibold text-gray-900">
                        Arquivos selecionados ou restaurados (mostrando até 10 de {visibleIntelligentImportFiles.length})
                      </p>
                      <div className="mt-2 overflow-hidden rounded-lg border border-gray-200">
                        {visibleIntelligentImportFiles.slice(0, 10).map((file, index) => (
                          <div
                            key={`${file.name}-${file.size}-${file.lastModified}`}
                            className={cx(
                              "grid gap-1 px-3 py-2 text-sm text-gray-700 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-3",
                              index > 0 ? "border-t border-gray-200" : ""
                            )}
                          >
                            <span className="truncate font-medium text-gray-900">{file.name}</span>
                            <span className="text-xs text-gray-500 md:text-right">
                              {file.type || "tipo não informado"} • {formatFileSize(file.size)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {selectedImagePreviews.length > 0 ? (
                    <div className="rounded-xl border border-gray-200 bg-white p-3">
                      <p className="text-sm font-semibold text-gray-900">
                        Pré-visualização das fotos selecionadas (mostrando até 10 de {selectedImagePreviews.length})
                      </p>
                      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                        {selectedImagePreviews.slice(0, 10).map((preview) => (
                          <div
                            key={preview.name}
                            className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50"
                          >
                            <div className="aspect-square w-full bg-white">
                              <img
                                src={preview.url}
                                alt={preview.name}
                                className="h-full w-full object-cover"
                              />
                            </div>
                            <div className="border-t border-gray-200 px-3 py-2">
                              <p className="truncate text-xs font-medium text-gray-700">
                                {preview.name}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-3 md:flex-row md:items-center">
                    <button
                      type="button"
                      onClick={() => void handleRunIntelligentImport()}
                      disabled={intelligentImportLoading}
                      className="rounded-xl bg-black px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
                    >
                      {intelligentImportLoading
                        ? "Processando importação..."
                        : "Testar importação inteligente"}
                    </button>
                    {visibleIntelligentImportFiles.length > 0 ? (
                      <button
                        type="button"
                        onClick={clearIntelligentImportState}
                        disabled={intelligentImportLoading}
                        className="rounded-xl border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-60"
                      >
                        Limpar arquivos e análise
                      </button>
                    ) : null}
                  </div>
                  {intelligentImportError ? (
                    <InfoBlock
                      title="Falha na importação inteligente"
                      description={intelligentImportError}
                    />
                  ) : null}
                  {intelligentImportSuccess ? (
                    <InfoBlock
                      title="Importação inteligente processada"
                      description={intelligentImportSuccess}
                      subtle
                    />
                  ) : null}
                  {intelligentImportResult?.ok ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                        <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
                          <p className="text-xs text-gray-500">Arquivos enviados</p>
                          <p className="mt-1 text-lg font-semibold text-gray-900">
                            {intelligentImportResult.summary.totalFiles}
                          </p>
                        </div>
                        <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
                          <p className="text-xs text-gray-500">Arquivos lidos</p>
                          <p className="mt-1 text-lg font-semibold text-gray-900">
                            {intelligentImportResult.summary.extractedFiles}
                          </p>
                        </div>
                        <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
                          <p className="text-xs text-gray-500">Blocos normalizados</p>
                          <p className="mt-1 text-lg font-semibold text-gray-900">
                            {intelligentImportResult.summary.normalizedItems}
                          </p>
                        </div>
                        <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
                          <p className="text-xs text-gray-500">Itens deduplicados</p>
                          <p className="mt-1 text-lg font-semibold text-gray-900">
                            {intelligentImportResult.summary.dedupedItems}
                          </p>
                        </div>
                        <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
                          <p className="text-xs text-gray-500">Duplicados detectados</p>
                          <p className="mt-1 text-lg font-semibold text-gray-900">
                            {intelligentImportResult.summary.duplicateItems}
                          </p>
                        </div>
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-white p-3">
                        <p className="text-sm font-semibold text-gray-900">Prévia dos arquivos extraídos</p>
                        {safeExtractedPreview.length === 0 ? (
                          <p className="mt-2 text-sm text-gray-500">
                            Nenhum texto foi extraído nesta tentativa.
                          </p>
                        ) : (
                          <div className="mt-2 overflow-hidden rounded-lg border border-gray-200">
                            {safeExtractedPreview.slice(0, 10).map((item, index) => (
                              <div
                                key={`${item.fileName}-${item.extension}`}
                                className={cx("px-3 py-2.5", index > 0 ? "border-t border-gray-200" : "")}
                              >
                                <div className="grid gap-1 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-3">
                                  <p className="truncate text-sm font-semibold text-gray-900">{item.fileName}</p>
                                  <p className="text-xs text-gray-500 md:text-right">
                                    {item.extension.toUpperCase()} • {item.mimeType}
                                  </p>
                                </div>
                                <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm leading-5 text-gray-700">
                                  {item.textPreview || "Sem texto extraído nesta fase."}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-white p-3">
                        <p className="text-sm font-semibold text-gray-900">
                          Fotos encontradas nos arquivos
                        </p>
                        {safeExtractedImagePreview.length === 0 ? (
                          <p className="mt-2 text-sm text-gray-500">
                            Nenhuma foto embutida foi encontrada nos arquivos desta análise.
                          </p>
                        ) : (
                          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                            {safeExtractedImagePreview.slice(0, 10).map((image, index) => (
                              <div
                                key={`${image.sourceFileName}-${image.fileName}-${index}`}
                                className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50"
                              >
                                <div className="aspect-square w-full bg-white">
                                  <img
                                    src={image.dataUrl}
                                    alt={image.fileName}
                                    className="h-full w-full object-cover"
                                  />
                                </div>
                                <div className="border-t border-gray-200 px-3 py-2">
                                  <p className="truncate text-xs font-semibold text-gray-800">
                                    {image.fileName}
                                  </p>
                                  <p className="mt-1 truncate text-[11px] text-gray-500">
                                    Origem: {image.sourceFileName}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-white p-3">
                        <p className="text-sm font-semibold text-gray-900">Prévia dos blocos classificados</p>
                        {safeNormalizedPreview.length === 0 ? (
                          <p className="mt-2 text-sm text-gray-500">
                            Nenhum bloco foi classificado nesta tentativa.
                          </p>
                        ) : (
                          <div className="mt-2 overflow-hidden rounded-lg border border-gray-200">
                            {safeNormalizedPreview.slice(0, 12).map((item, index) => (
                              <div key={`${item.sourceFileName}-${item.title}-${index}`} className={cx("px-3 py-2.5", index > 0 ? "border-t border-gray-200" : "")}>
                                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-3">
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-gray-900">{item.title}</p>
                                    <p className="text-xs text-gray-500">
                                      Tipo: {item.type} • Arquivo: {item.sourceFileName}
                                    </p>
                                  </div>
                                  <span className="inline-flex rounded-full bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700 ring-1 ring-gray-200">
                                    {Math.round(item.confidence * 100)}%
                                  </span>
                                </div>
                                <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm leading-5 text-gray-700">
                                  {item.rawText}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-white p-3">
                        <p className="text-sm font-semibold text-gray-900">Prévia da deduplicação</p>
                        {safeDedupedPreview.length === 0 ? (
                          <p className="mt-2 text-sm text-gray-500">
                            Nenhum item foi analisado na deduplicação.
                          </p>
                        ) : (
                          <div className="mt-2 overflow-hidden rounded-lg border border-gray-200">
                            {safeDedupedPreview.slice(0, 12).map((item, index) => (
                              <div
                                key={`${item.dedupKey}-${index}`}
                                className={cx(
                                  "px-3 py-2.5",
                                  index > 0 ? "border-t border-gray-200" : "",
                                  item.isDuplicate ? "bg-amber-50" : "bg-white"
                                )}
                              >
                                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-3">
                                  <div>
                                    <p className="truncate text-sm font-semibold text-gray-900">{item.title}</p>
                                    <p className="text-xs text-gray-500">
                                      Tipo: {item.type} • Arquivo: {item.sourceFileName}
                                    </p>
                                  </div>
                                  <span
                                    className={cx(
                                      "rounded-full px-3 py-1 text-xs font-medium ring-1",
                                      item.isDuplicate
                                        ? "bg-white text-amber-800 ring-amber-200"
                                        : "bg-white text-gray-700 ring-gray-200"
                                    )}
                                  >
                                    {item.isDuplicate
                                      ? `Duplicado de: ${item.duplicateOf ?? "item anterior"}`
                                      : "Único nesta análise"}
                                  </span>
                                </div>
                                <p className="mt-3 break-all text-xs text-gray-500">
                                  Chave: {item.dedupKey}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              {intelligentImportResult?.ok ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-base font-semibold text-emerald-900">
                        Salvar resultado no catálogo da loja
                      </p>
                      <p className="mt-1 text-sm leading-6 text-emerald-900">
                        Isso salva tudo no lugar certo: piscinas em Piscinas, produtos químicos em Químicos,
                        acessórios em Acessórios e o restante em Outros.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleSaveImportedItemsToCatalog()}
                      disabled={savingImportedCatalog || intelligentImportLoading}
                      className="rounded-xl bg-black px-5 py-3 text-sm font-medium text-white disabled:opacity-60"
                    >
                      {savingImportedCatalog ? "Salvando no sistema..." : "Salvar no catálogo"}
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="flex flex-col gap-3 border-t border-gray-200 pt-4 md:flex-row md:items-center md:justify-between">
                <button
                  type="button"
                  onClick={() => changeStep(1)}
                  className="rounded-xl border border-gray-300 px-5 py-2.5 font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-black px-5 py-2.5 font-medium text-white disabled:opacity-60"
                >
                  {saving ? "Salvando..." : "Salvar e ir para etapa 3"}
                </button>
              </div>
            </form>
          )}
          {currentStep === 3 && (
            <form onSubmit={saveStep3} className="space-y-6">
              <div>
                <SectionTitle
                  title="Qual é o tempo médio de resposta humana da loja?"
                  hint="Pode ser em minutos ou horas. Ex.: 15 min, 1h, 2h."
                />
                <input
                  type="text"
                  value={step3Form.average_human_response_time}
                  onChange={(e) => updateStep3Field("average_human_response_time", e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Ex.: 15 min"
                  required
                />
              </div>
              {storeHasInstallation && (
                <>
                  <div>
                    <SectionTitle
                      title="Qual é o tempo médio de instalação?"
                      hint="Escreva de forma prática. Ex.: 7 dias, 15 dias."
                    />
                    <input
                      type="text"
                      value={step3Form.average_installation_time_days}
                      onChange={(e) => updateStep3Field("average_installation_time_days", e.target.value)}
                      className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                      placeholder="Ex.: 10 dias"
                    />
                  </div>
                  <div>
                    <SectionTitle
                      title="Quais dias a loja costuma instalar?"
                      hint="Marque os dias reais disponíveis."
                    />
                    <SelectorGrid
                      options={DAYS_OF_WEEK_OPTIONS}
                      selectedValues={step3Form.installation_available_days}
                      onToggle={(value) => toggleStep3ArrayField("installation_available_days", value)}
                    />
                    <input
                      type="text"
                      value={step3Form.installation_days_rule}
                      onChange={(e) => updateStep3Field("installation_days_rule", e.target.value)}
                      className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                      placeholder="Regra complementar da instalação (opcional)"
                    />
                  </div>
                  <div>
                    <SectionTitle
                      title="Como costuma funcionar a instalação?"
                      hint="Marque as etapas principais."
                    />
                    <SelectorGrid
                      options={SALES_FLOW_FINAL_OPTIONS}
                      selectedValues={step3Form.installation_process_steps}
                      onToggle={(value) => toggleStep3ArrayField("installation_process_steps", value)}
                    />
                    <textarea
                      value={step3Form.installation_process_other}
                      onChange={(e) => updateStep3Field("installation_process_other", e.target.value)}
                      rows={4}
                      className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                      placeholder="Complemento da instalação (opcional)"
                    />
                  </div>
                </>
              )}
              {storeHasTechnicalVisit && (
                <>
                  <div>
                    <SectionTitle
                      title="Quais dias a loja costuma fazer visita técnica?"
                      hint="Marque os dias reais disponíveis."
                    />
                    <SelectorGrid
                      options={DAYS_OF_WEEK_OPTIONS}
                      selectedValues={step3Form.technical_visit_available_days}
                      onToggle={(value) => toggleStep3ArrayField("technical_visit_available_days", value)}
                    />
                    <input
                      type="text"
                      value={step3Form.technical_visit_days_rule}
                      onChange={(e) => updateStep3Field("technical_visit_days_rule", e.target.value)}
                      className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                      placeholder="Regra complementar da visita técnica (opcional)"
                    />
                  </div>
                  <div>
                    <SectionTitle
                      title="Quais regras a IA precisa respeitar na visita técnica?"
                      hint="Marque as regras principais."
                    />
                    <SelectorGrid
                      options={TECHNICAL_VISIT_RULE_OPTIONS}
                      selectedValues={step3Form.technical_visit_rules_selected}
                      onToggle={(value) => toggleStep3ArrayField("technical_visit_rules_selected", value)}
                    />
                    <textarea
                      value={step3Form.technical_visit_rules_other}
                      onChange={(e) => updateStep3Field("technical_visit_rules_other", e.target.value)}
                      rows={4}
                      className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                      placeholder="Complemento das regras de visita (opcional)"
                    />
                  </div>
                </>
              )}
              <div>
                <SectionTitle
                  title="Quais limitações importantes a IA precisa saber?"
                  hint="Marque o que for real hoje na operação."
                />
                <SelectorGrid
                  options={IMPORTANT_LIMITATION_OPTIONS}
                  selectedValues={step3Form.important_limitations_selected}
                  onToggle={(value) => toggleStep3ArrayField("important_limitations_selected", value)}
                />
                <textarea
                  value={step3Form.important_limitations_other}
                  onChange={(e) => updateStep3Field("important_limitations_other", e.target.value)}
                  rows={4}
                  className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Se quiser complementar, escreva aqui (opcional)"
                />
              </div>
              <div>
                <SectionTitle
                  title="Como começa o fluxo comercial?"
                  hint="Marque os pontos mais comuns do início do atendimento."
                />
                <SelectorGrid
                  options={SALES_FLOW_START_OPTIONS}
                  selectedValues={step3Form.sales_flow_start_steps}
                  onToggle={(value) => toggleStep3ArrayField("sales_flow_start_steps", value)}
                />
              </div>
              <div>
                <SectionTitle
                  title="Como costuma seguir a negociação?"
                  hint="Marque as etapas da parte do meio."
                />
                <SelectorGrid
                  options={SALES_FLOW_MIDDLE_OPTIONS}
                  selectedValues={step3Form.sales_flow_middle_steps}
                  onToggle={(value) => toggleStep3ArrayField("sales_flow_middle_steps", value)}
                />
              </div>
              <div>
                <SectionTitle
                  title="Como costuma terminar o fluxo?"
                  hint="Marque as etapas finais mais comuns."
                />
                <SelectorGrid
                  options={SALES_FLOW_FINAL_OPTIONS}
                  selectedValues={step3Form.sales_flow_final_steps}
                  onToggle={(value) => toggleStep3ArrayField("sales_flow_final_steps", value)}
                />
              </div>
              <div>
                <SectionTitle
                  title="Observações extras sobre o fluxo"
                  hint="Use esse espaço para complementar o que a IA precisa saber."
                />
                <textarea
                  value={step3Form.sales_flow_notes}
                  onChange={(e) => updateStep3Field("sales_flow_notes", e.target.value)}
                  rows={4}
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Ex.: Antes de falar preço, normalmente a loja entende o tipo de piscina e se tem instalação."
                />
              </div>
              <div className="space-y-3">
                <label className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={step3Form.sales_flow_start_confirmed}
                    onChange={(e) => updateStep3Field("sales_flow_start_confirmed", e.target.checked)}
                  />
                  <span className="text-sm text-gray-700">Confirmo que o início do fluxo está correto</span>
                </label>
                <label className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={step3Form.sales_flow_middle_confirmed}
                    onChange={(e) => updateStep3Field("sales_flow_middle_confirmed", e.target.checked)}
                  />
                  <span className="text-sm text-gray-700">Confirmo que a parte do meio do fluxo está correta</span>
                </label>
                <label className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={step3Form.sales_flow_final_confirmed}
                    onChange={(e) => updateStep3Field("sales_flow_final_confirmed", e.target.checked)}
                  />
                  <span className="text-sm text-gray-700">Confirmo que o final do fluxo está correto</span>
                </label>
              </div>
              <div className="flex flex-col gap-3 border-t border-gray-200 pt-4 md:flex-row md:items-center md:justify-between">
                <button
                  type="button"
                  onClick={() => changeStep(2)}
                  className="rounded-xl border border-gray-300 px-5 py-2.5 font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-black px-5 py-2.5 font-medium text-white disabled:opacity-60"
                >
                  {saving ? "Salvando..." : "Salvar e ir para etapa 4"}
                </button>
              </div>
            </form>
          )}
          {currentStep === 4 && (
            <form onSubmit={saveStep4} className="space-y-6">
              <div>
                <SectionTitle
                  title="Qual é o ticket médio da loja?"
                  hint="Esse é o valor médio das vendas mais comuns da loja."
                />
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-gray-500">
                    R$
                  </span>
                  <input
                    type="text"
                    value={step4Form.average_ticket}
                    onChange={(e) =>
                      updateStep4Field("average_ticket", formatBrazilCurrencyInput(e.target.value))
                    }
                    className="w-full rounded-xl border border-gray-300 py-2.5 pl-12 pr-4 outline-none focus:border-black"
                    placeholder="12.000"
                    required
                  />
                </div>
              </div>
              {hasDiscountConfigOverride ? (
                <div className="space-y-4">
                  <InfoBlock
                    title="Desconto controlado pela aba Configurações"
                    description="Esses valores agora estão em modo espelho no onboarding. Quando você muda em Configurações, aqui atualiza junto. Alterações feitas aqui no onboarding não sobrescrevem mais a política viva."
                  />
                  <div>
                    <SectionTitle title="A loja pode dar desconto?" />
                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800">
                      Valor efetivo atual: <strong>{effectiveDiscountCanOffer ? "Sim" : "Não"}</strong>
                    </div>
                  </div>
                  {effectiveDiscountCanOffer && (
                    <div>
                      <SectionTitle
                        title="Qual é o desconto máximo sem precisar chamar alguém da loja?"
                        hint="Esse valor está vindo de Configurações > Descontos."
                      />
                      <div className="relative">
                        <input
                          type="text"
                          value={effectiveOnboardingDiscountPercent}
                          disabled
                          className="w-full rounded-xl border border-gray-300 bg-gray-100 py-2.5 pl-4 pr-10 text-gray-700 outline-none"
                          placeholder="0"
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-gray-500">
                          %
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                      <p className="text-xs text-gray-500">Desconto padrão atual</p>
                      <p className="mt-1 text-lg font-semibold text-gray-900">
                        {discountSettings?.default_discount_percent ?? 0}%
                      </p>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                      <p className="text-xs text-gray-500">Desconto máximo com autorização</p>
                      <p className="mt-1 text-lg font-semibold text-gray-900">
                        {discountSettings?.max_discount_percent ?? 0}%
                      </p>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                      <p className="text-xs text-gray-500">Consultar acima do máximo</p>
                      <p className="mt-1 text-lg font-semibold text-gray-900">
                        {discountSettings?.allow_ask_above_max_discount ? "Sim" : "Não"}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <SectionTitle title="A loja pode dar desconto?" />
                    <SingleSelectorGrid
                      options={YES_NO_OPTIONS}
                      value={step4Form.can_offer_discount}
                      onChange={(value) => updateStep4Field("can_offer_discount", value)}
                    />
                  </div>
                  {step4Form.can_offer_discount === "sim" && (
                    <div>
                      <SectionTitle
                        title="Qual é o desconto máximo sem precisar chamar alguém da loja?"
                        hint="Preencha apenas o número."
                      />
                      <div className="relative">
                        <input
                          type="text"
                          value={step4Form.max_discount_percent}
                          onChange={(e) =>
                            updateStep4Field("max_discount_percent", formatPercentInput(e.target.value))
                          }
                          className="w-full rounded-xl border border-gray-300 py-2.5 pl-4 pr-10 outline-none focus:border-black"
                          placeholder="10"
                          required
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-gray-500">
                          %
                        </span>
                      </div>
                    </div>
                  )}
                </>
              )}
              <div className="space-y-4">
                <SectionTitle
                  title="Como o cliente pode pagar?"
                  hint="Marque as formas de pagamento e também as condições comerciais que a loja aceita."
                />
                <div>
                  <p className="mb-2 text-sm font-medium text-gray-700">Formas de pagamento</p>
                  <SelectorGrid
                    options={PAYMENT_METHOD_MAIN_OPTIONS}
                    selectedValues={step4Form.accepted_payment_methods}
                    onToggle={(value) => toggleStep4ArrayField("accepted_payment_methods", value)}
                  />
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium text-gray-700">Condições comerciais</p>
                  <SelectorGrid
                    options={PAYMENT_METHOD_CONDITION_OPTIONS}
                    selectedValues={step4Form.accepted_payment_methods}
                    onToggle={(value) => toggleStep4ArrayField("accepted_payment_methods", value)}
                  />
                </div>
              </div>
              <div>
                <SectionTitle
                  title="A IA pode falar preço sem chamar alguém da loja?"
                  hint="A ideia aqui não é preço seco. Na maioria dos casos, a IA deve qualificar rápido antes de falar valor."
                />
                <SingleSelectorGrid
                  options={YES_NO_OPTIONS}
                  value={step4Form.ai_can_send_price_directly}
                  onChange={(value) => updateStep4Field("ai_can_send_price_directly", value)}
                />
              </div>
              {step4Form.ai_can_send_price_directly === "sim" && (
                <div className="space-y-6">
                  <div>
                    <SectionTitle
                      title="Antes de falar preço, o que a IA precisa entender?"
                      hint="Marque tudo o que normalmente precisa ser entendido antes."
                    />
                    <SelectorGrid
                      options={PRICE_DIRECT_BEFORE_OPTIONS}
                      selectedValues={step4Form.price_must_understand_before}
                      onToggle={(value) => toggleStep4ArrayField("price_must_understand_before", value)}
                    />
                  </div>
                  <div>
                    <SectionTitle
                      title="Como a IA pode falar preço?"
                      hint="Escolha a forma principal."
                    />
                    <SingleSelectorGrid
                      options={PRICE_TALK_MODE_OPTIONS}
                      value={step4Form.price_talk_mode}
                      onChange={(value) => updateStep4Field("price_talk_mode", value)}
                    />
                  </div>
                  <div>
                    <SectionTitle
                      title="A IA precisa de ajuda humana para isso?"
                      hint="Defina se a loja quer ajuda humana no momento de falar preço."
                    />
                    <SingleSelectorGrid
                      options={YES_NO_OPTIONS}
                      value={step4Form.price_needs_human_help}
                      onChange={(value) => updateStep4Field("price_needs_human_help", value)}
                    />
                  </div>
                  <input
                    type="text"
                    value={step4Form.price_direct_rule_other}
                    onChange={(e) => updateStep4Field("price_direct_rule_other", e.target.value)}
                    className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                    placeholder="Se quiser complementar a regra de preço, escreva aqui (opcional)"
                  />
                </div>
              )}
              {step4Form.ai_can_send_price_directly === "não" && (
                <InfoBlock
                  title="Preço com apoio humano"
                  description="Nesse caso, a IA não deve falar preço sozinha. Ela pode qualificar, entender o caso e chamar alguém da loja para seguir."
                  subtle
                />
              )}
              <div>
                <SectionTitle
                  title="Quando a IA deve chamar uma pessoa por causa de desconto?"
                  hint="Marque os casos em que vale sair da IA e envolver alguém da loja."
                />
                <SelectorGrid
                  options={HUMAN_HELP_DISCOUNT_OPTIONS}
                  selectedValues={step4Form.human_help_discount_cases_selected}
                  onToggle={(value) => toggleStep4ArrayField("human_help_discount_cases_selected", value)}
                />
                <input
                  type="text"
                  value={step4Form.human_help_discount_cases_other}
                  onChange={(e) => updateStep4Field("human_help_discount_cases_other", e.target.value)}
                  className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Se quiser complementar, escreva aqui (opcional)"
                />
              </div>
              <div>
                <SectionTitle
                  title="Quando a IA deve chamar uma pessoa por causa de projeto especial?"
                  hint="Marque os casos fora do padrão ou mais sensíveis."
                />
                <SelectorGrid
                  options={HUMAN_HELP_CUSTOM_PROJECT_OPTIONS}
                  selectedValues={step4Form.human_help_custom_project_cases_selected}
                  onToggle={(value) => toggleStep4ArrayField("human_help_custom_project_cases_selected", value)}
                />
                <input
                  type="text"
                  value={step4Form.human_help_custom_project_cases_other}
                  onChange={(e) => updateStep4Field("human_help_custom_project_cases_other", e.target.value)}
                  className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Se quiser complementar, escreva aqui (opcional)"
                />
              </div>
              <div>
                <SectionTitle
                  title="Quando a IA deve chamar uma pessoa por causa de pagamento?"
                  hint="Marque os casos financeiros que precisam sair da IA."
                />
                <SelectorGrid
                  options={HUMAN_HELP_PAYMENT_OPTIONS}
                  selectedValues={step4Form.human_help_payment_cases_selected}
                  onToggle={(value) => toggleStep4ArrayField("human_help_payment_cases_selected", value)}
                />
                <input
                  type="text"
                  value={step4Form.human_help_payment_cases_other}
                  onChange={(e) => updateStep4Field("human_help_payment_cases_other", e.target.value)}
                  className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Se quiser complementar, escreva aqui (opcional)"
                />
              </div>
              <div className="flex flex-col gap-3 border-t border-gray-200 pt-4 md:flex-row md:items-center md:justify-between">
                <button
                  type="button"
                  onClick={() => changeStep(3)}
                  className="rounded-xl border border-gray-300 px-5 py-2.5 font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-black px-5 py-2.5 font-medium text-white disabled:opacity-60"
                >
                  {saving ? "Salvando..." : "Salvar e ir para etapa 5"}
                </button>
              </div>
            </form>
          )}
          {currentStep === 5 && (
            <form onSubmit={saveStep5} className="space-y-6">
              <div>
                <SectionTitle
                  title="Quem é a principal pessoa da loja que a IA deve acionar?"
                  hint="Pode ser o dono, gerente ou alguém responsável pelos casos importantes."
                />
                <input
                  type="text"
                  value={step5Form.responsible_name}
                  onChange={(e) => updateStep5Field("responsible_name", e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Ex.: Junior"
                  required
                />
              </div>
              <div>
                <SectionTitle
                  title="Qual é o WhatsApp dessa pessoa?"
                  hint="Esse número será usado quando a IA precisar chamar alguém da loja."
                />
                <input
                  type="text"
                  value={step5Form.responsible_whatsapp}
                  onChange={(e) => updateStep5Field("responsible_whatsapp", formatWhatsappInput(e.target.value))}
                  className="w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Ex.: 5511955552255"
                  required
                />
              </div>
              <div>
                <SectionTitle
                  title="A IA deve avisar essa pessoa quando surgir algo importante?"
                />
                <SingleSelectorGrid
                  options={YES_NO_OPTIONS}
                  value={step5Form.ai_should_notify_responsible}
                  onChange={(value) => updateStep5Field("ai_should_notify_responsible", value)}
                />
              </div>
              {step5Form.ai_should_notify_responsible === "sim" && (
                <div>
                  <SectionTitle
                    title="Em quais casos essa pessoa deve ser avisada?"
                    hint="Marque os casos em que a IA precisa envolver alguém da loja."
                  />
                  <SelectorGrid
                    options={RESPONSIBLE_NOTIFICATION_CASE_OPTIONS}
                    selectedValues={step5Form.responsible_notification_cases}
                    onToggle={(value) => toggleStep5ArrayField("responsible_notification_cases", value)}
                  />
                  <input
                    type="text"
                    value={step5Form.responsible_notification_cases_other}
                    onChange={(e) => updateStep5Field("responsible_notification_cases_other", e.target.value)}
                    className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                    placeholder="Se quiser complementar, escreva aqui (opcional)"
                  />
                </div>
              )}
              <div>
                <SectionTitle
                  title="Quais orientações finais a IA deve seguir na ativação?"
                  hint="Marque o tom e as travas finais mais importantes."
                />
                <SelectorGrid
                  options={[...ACTIVATION_STYLE_OPTIONS, ...ACTIVATION_GUARDRAIL_OPTIONS]}
                  selectedValues={step5Form.activation_preferences}
                  onToggle={(value) => toggleStep5ArrayField("activation_preferences", value)}
                />
                <textarea
                  value={step5Form.activation_preferences_other}
                  onChange={(e) => updateStep5Field("activation_preferences_other", e.target.value)}
                  rows={4}
                  className="mt-3 w-full rounded-xl border border-gray-300 px-4 py-2.5 outline-none focus:border-black"
                  placeholder="Se quiser complementar, escreva aqui (opcional)"
                />
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-4">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={step5Form.confirm_information_is_correct}
                    onChange={(e) => updateStep5Field("confirm_information_is_correct", e.target.checked)}
                    className="mt-1"
                  />
                  <span className="text-sm text-gray-700">
                    Confirmo que as informações estão corretas para concluir o onboarding.
                  </span>
                </label>
              </div>
              <div className="flex flex-col gap-3 border-t border-gray-200 pt-4 md:flex-row md:items-center md:justify-between">
                <button
                  type="button"
                  onClick={() => changeStep(4)}
                  className="rounded-xl border border-gray-300 px-5 py-2.5 font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-black px-5 py-2.5 font-medium text-white disabled:opacity-60"
                >
                  {saving ? "Concluindo..." : "Concluir onboarding"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
export default function OnboardingPage() {
  return (
    <OrgGuard>
      <StoreProvider>
        <OnboardingContent />
      </StoreProvider>
    </OrgGuard>
  );
}
