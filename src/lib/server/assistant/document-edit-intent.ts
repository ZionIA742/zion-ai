import type { AssistantMessageRow, StoreAssistantContextStateRow } from "@/lib/server/assistant/types";
import { pushAssistantDocumentReviewMessage } from "@/lib/server/assistant/document-review-messages";
import { registerContractBusinessEvent } from "@/lib/server/sales-contracts/contract-events";
import { resolveAuthorizedExistingContract } from "@/lib/server/sales-contracts/contract-auth";

type AssistantDocumentReviewActionMetadata = {
  id?: string;
  kind?: string;
};

type AssistantDocumentReviewMetadata = {
  kind?: string;
  document_type?: string;
  document_id?: string;
  document_version_id?: string;
  document_number?: string;
  document_status?: string;
  related_quote_id?: string | null;
  related_contract_id?: string | null;
  related_lead_id?: string | null;
  related_conversation_id?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  original_file_name?: string | null;
  file_kind?: string | null;
  mime_type?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  assistant_prompt?: string | null;
  available_actions?: AssistantDocumentReviewActionMetadata[] | null;
  source?: string | null;
};

type AssistantDocumentMessageRow = AssistantMessageRow & {
  metadata?: Record<string, unknown> | null;
};

type SupportedDocumentType = "quote" | "contract";

type DocumentEditPatch =
  | {
      mode: "structured";
      summary: string;
      quoteApplyBody?: Record<string, unknown>;
      contractUpdates?: Record<string, unknown>;
      fieldKeys: string[];
    }
  | {
      mode: "manual";
      summary: string;
      fieldKeys: string[];
      reason: "unsupported_or_complex";
    };

type DocumentContextCandidate = {
  documentType: SupportedDocumentType;
  documentId: string;
  documentVersionId: string | null;
  documentNumber: string | null;
  documentStatus: string | null;
  relatedQuoteId: string | null;
  relatedContractId: string | null;
  relatedLeadId: string | null;
  relatedConversationId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  originalFileName: string | null;
  fileKind: string | null;
  mimeType: string | null;
  storageBucket: string | null;
  storagePath: string | null;
  source: string | null;
  createdAt: string | null;
  hasPendingAction: boolean;
};

type HandleDocumentEditArgs = {
  request: Request;
  supabase: any;
  organizationId: string;
  storeId: string;
  threadId: string;
  assistantContextState?: StoreAssistantContextStateRow | null;
  recentMessages: AssistantDocumentMessageRow[];
  lastHumanMessage: string;
};

type HandleDocumentEditResult =
  | {
      handled: false;
    }
  | {
      handled: true;
      reply: string;
      metadata: Record<string, unknown>;
    };

const TERMINAL_STATUSES = new Set(["completed", "cancelled", "expired", "failed"]);
const SENT_STATUSES = new Set(["sent", "sent_to_customer", "customer_signed", "partially_signed"]);
const EDIT_VERBS = [
  "alterar",
  "altere",
  "altera",
  "editar",
  "edite",
  "mudar",
  "mude",
  "trocar",
  "troque",
  "corrigir",
  "corrija",
  "remover",
  "remova",
  "tirar",
  "tire",
  "adicionar",
  "adicione",
  "colocar",
  "coloque",
  "atualizar",
  "atualize",
];
const DOCUMENT_SIGNALS = [
  "orcamento",
  "contrato",
  "documento",
  "pdf",
  "garantia",
  "prazo",
  "validade",
  "desconto",
  "observacao",
  "observacao",
  "pagamento",
  "instalacao",
  "entrega",
];

function normalizeText(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function cleanText(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasAnyTerm(text: string, terms: string[]) {
  return terms.some((term) => text.includes(normalizeText(term)));
}

function getDocumentMetadata(message: AssistantDocumentMessageRow): AssistantDocumentReviewMetadata | null {
  if (!isRecord(message.metadata)) return null;
  if (cleanText(message.metadata.kind) !== "document_review") return null;
  return message.metadata as AssistantDocumentReviewMetadata;
}

function getCandidatePendingActionFlag(metadata: AssistantDocumentReviewMetadata) {
  const actions = Array.isArray(metadata.available_actions) ? metadata.available_actions : [];
  return actions.some((action) => {
    const id = cleanText(action?.id);
    const kind = cleanText(action?.kind);
    return (
      id === "approve_and_send" ||
      kind === "approve_and_send" ||
      id === "confirm_store_signature" ||
      kind === "confirm_store_signature"
    );
  });
}

function formatDocumentNumber(candidate: DocumentContextCandidate) {
  return candidate.documentNumber || candidate.documentId;
}

function detectDocumentTypeHint(messageText: string): SupportedDocumentType | null {
  const normalized = normalizeText(messageText);
  const mentionsQuote = normalized.includes("orcamento");
  const mentionsContract = normalized.includes("contrato");

  if (mentionsQuote && !mentionsContract) return "quote";
  if (mentionsContract && !mentionsQuote) return "contract";
  return null;
}

function detectDemonstrativeReference(messageText: string) {
  const normalized = normalizeText(messageText);
  return (
    normalized.includes("esse orcamento") ||
    normalized.includes("esse contrato") ||
    normalized.includes("esse documento") ||
    normalized.includes("nesse orcamento") ||
    normalized.includes("nesse contrato") ||
    normalized.includes("nesse documento") ||
    normalized.includes("neste orcamento") ||
    normalized.includes("neste contrato") ||
    normalized.includes("neste documento")
  );
}

function extractExplicitDocumentNumber(messageText: string) {
  const match = String(messageText || "").match(/\b((?:ORC|CTR)-[A-Z0-9-]+)\b/i);
  return match ? match[1].toUpperCase() : null;
}

function inferDocumentTypeFromExplicitNumber(
  explicitNumber: string | null
): SupportedDocumentType | null {
  const normalized = normalizeText(explicitNumber);
  if (normalized.startsWith("orc-")) return "quote";
  if (normalized.startsWith("ctr-")) return "contract";
  return null;
}

function extractFirstCapturedValue(messageText: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = String(messageText || "").match(pattern);
    const value = cleanText(match?.[1]);
    if (value) {
      return value.replace(/[.?!]+$/, "").trim();
    }
  }

  return null;
}

function sentenceCase(value: string) {
  const text = cleanText(value);
  if (!text) return null;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function detectDocumentEditIntent(messageText: string): DocumentEditPatch | null {
  const normalized = normalizeText(messageText);
  if (!hasAnyTerm(normalized, EDIT_VERBS) || !hasAnyTerm(normalized, DOCUMENT_SIGNALS)) {
    return null;
  }

  if (/\b(tire|tirar|remova|remover|remove|tirando)\b[\s\S]{0,30}\bdesconto\b/i.test(messageText)) {
    return {
      mode: "structured",
      summary: "remover o desconto",
      quoteApplyBody: {
        discount_cents: 0,
      },
      fieldKeys: ["discount_cents"],
    };
  }

  const warrantyValue = extractFirstCapturedValue(messageText, [
    /garantia[\s\S]{0,60}?\b(?:para|pra)\b\s+(.+?)(?:[.?!]|$)/i,
  ]);
  if (warrantyValue) {
    return {
      mode: "structured",
      summary: `ajustar a garantia para ${warrantyValue}`,
      quoteApplyBody: {
        warranty_terms: sentenceCase(warrantyValue),
      },
      contractUpdates: {
        warranty_terms: sentenceCase(warrantyValue),
      },
      fieldKeys: ["warranty_terms"],
    };
  }

  const validityValue = extractFirstCapturedValue(messageText, [
    /(?:prazo\s+de\s+validade|validade)[\s\S]{0,60}?\b(?:para|pra)\b\s+(.+?)(?:[.?!]|$)/i,
  ]);
  if (validityValue) {
    return {
      mode: "structured",
      summary: `ajustar a validade para ${validityValue}`,
      quoteApplyBody: {
        validity_days: validityValue,
      },
      contractUpdates: {
        valid_until: validityValue,
      },
      fieldKeys: ["validity_days"],
    };
  }

  if (/\bpix\b/i.test(messageText) && /\bpagamento\b/i.test(messageText)) {
    return {
      mode: "structured",
      summary: "ajustar a forma de pagamento para Pix",
      quoteApplyBody: {
        payment_terms: "Pagamento por Pix.",
      },
      contractUpdates: {
        payment_terms: "Pagamento por Pix.",
      },
      fieldKeys: ["payment_terms"],
    };
  }

  const paymentValue = extractFirstCapturedValue(messageText, [
    /pagamento[\s\S]{0,60}?\b(?:sera|será|ficara|ficará|fica|por|em)\b\s+(.+?)(?:[.?!]|$)/i,
  ]);
  if (paymentValue) {
    return {
      mode: "structured",
      summary: `ajustar o pagamento para ${paymentValue}`,
      quoteApplyBody: {
        payment_terms: sentenceCase(paymentValue),
      },
      contractUpdates: {
        payment_terms: sentenceCase(paymentValue),
      },
      fieldKeys: ["payment_terms"],
    };
  }

  const deliveryValue =
    extractFirstCapturedValue(messageText, [
      /instala(?:cao|ção)[\s\S]{0,80}?\bque\b\s+(.+?)(?:[.?!]|$)/i,
      /entrega[\s\S]{0,80}?\b(?:para|pra|que)\b\s+(.+?)(?:[.?!]|$)/i,
    ]) ||
    extractFirstCapturedValue(messageText, [
      /instala(?:cao|ção)[\s\S]{0,80}?\b(?:sera|será|ficara|ficará|fica)\b\s+(.+?)(?:[.?!]|$)/i,
    ]);
  if (deliveryValue) {
    const normalizedDeliveryValue = sentenceCase(deliveryValue);
    return {
      mode: "structured",
      summary: `ajustar a instalacao/entrega para ${deliveryValue}`,
      quoteApplyBody: {
        delivery_terms: normalizedDeliveryValue,
      },
      contractUpdates: {
        delivery_terms: normalizedDeliveryValue,
      },
      fieldKeys: ["delivery_terms"],
    };
  }

  const observationValue = extractFirstCapturedValue(messageText, [
    /observa(?:cao|ção)[\s\S]{0,80}?\b(?:dizer|dizendo|colocar|coloque|informar|para)\b\s+(.+?)(?:[.?!]|$)/i,
  ]);
  if (observationValue) {
    return {
      mode: "structured",
      summary: `ajustar a observacao para ${observationValue}`,
      quoteApplyBody: {
        customer_notes: sentenceCase(observationValue),
      },
      fieldKeys: ["customer_notes"],
    };
  }

  if (/\b(clausula|cláusula|juridic|jurídic|termo contratual)\b/i.test(messageText)) {
    return {
      mode: "manual",
      summary: cleanText(messageText)?.slice(0, 180) || "pedido de alteracao contratual",
      fieldKeys: [],
      reason: "unsupported_or_complex",
    };
  }

  return {
    mode: "manual",
    summary: cleanText(messageText)?.slice(0, 180) || "pedido de alteracao do documento",
    fieldKeys: [],
    reason: "unsupported_or_complex",
  };
}

function findRecentAssistantDocumentContext(args: {
  recentMessages: AssistantDocumentMessageRow[];
  messageText: string;
}) {
  const documentTypeHint = detectDocumentTypeHint(args.messageText);
  const demonstrativeReference = detectDemonstrativeReference(args.messageText);

  const candidates = args.recentMessages
    .map((message) => {
      const metadata = getDocumentMetadata(message);
      if (!metadata) return null;

      const documentType = cleanText(metadata.document_type);
      const documentId = cleanText(metadata.document_id);

      if (!documentId || (documentType !== "quote" && documentType !== "contract")) {
        return null;
      }

      return {
        documentType,
        documentId,
        documentVersionId: cleanText(metadata.document_version_id),
        documentNumber: cleanText(metadata.document_number),
        documentStatus: cleanText(metadata.document_status),
        relatedQuoteId: cleanText(metadata.related_quote_id),
        relatedContractId: cleanText(metadata.related_contract_id),
        relatedLeadId: cleanText(metadata.related_lead_id),
        relatedConversationId: cleanText(metadata.related_conversation_id),
        customerName: cleanText(metadata.customer_name),
        customerPhone: cleanText(metadata.customer_phone),
        originalFileName: cleanText(metadata.original_file_name),
        fileKind: cleanText(metadata.file_kind),
        mimeType: cleanText(metadata.mime_type),
        storageBucket: cleanText(metadata.storage_bucket),
        storagePath: cleanText(metadata.storage_path),
        source: cleanText(metadata.source),
        createdAt: cleanText(message.created_at),
        hasPendingAction: getCandidatePendingActionFlag(metadata),
      } satisfies DocumentContextCandidate;
    })
    .filter(Boolean) as DocumentContextCandidate[];

  const sortedCandidates = candidates.sort((a, b) => {
    if (Number(b.hasPendingAction) !== Number(a.hasPendingAction)) {
      return Number(b.hasPendingAction) - Number(a.hasPendingAction);
    }

    const leftTime = new Date(a.createdAt || 0).getTime();
    const rightTime = new Date(b.createdAt || 0).getTime();
    return rightTime - leftTime;
  });

  if (sortedCandidates.length === 0) {
    return {
      kind: "not_found" as const,
      candidates: [],
    };
  }

  const typedCandidates = documentTypeHint
    ? sortedCandidates.filter((candidate) => candidate.documentType === documentTypeHint)
    : sortedCandidates;

  if (typedCandidates.length === 1) {
    return {
      kind: "selected" as const,
      candidate: typedCandidates[0],
      candidates: sortedCandidates,
    };
  }

  if (documentTypeHint && typedCandidates.length > 1) {
    return {
      kind: "ambiguous" as const,
      candidates: typedCandidates,
    };
  }

  if (demonstrativeReference) {
    const pendingCandidates = sortedCandidates.filter((candidate) => candidate.hasPendingAction);
    if (pendingCandidates.length === 1) {
      return {
        kind: "selected" as const,
        candidate: pendingCandidates[0],
        candidates: sortedCandidates,
      };
    }
  }

  if (!documentTypeHint && sortedCandidates.length === 1) {
    return {
      kind: "selected" as const,
      candidate: sortedCandidates[0],
      candidates: sortedCandidates,
    };
  }

  return {
    kind: "ambiguous" as const,
    candidates: sortedCandidates.slice(0, 4),
  };
}

async function resolveExplicitDocumentReference(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  explicitNumber: string;
  documentTypeHint: SupportedDocumentType | null;
}) {
  const explicitType = inferDocumentTypeFromExplicitNumber(args.explicitNumber);
  const effectiveType = explicitType || args.documentTypeHint;

  if (effectiveType === "quote") {
    const { data, error } = await args.supabase
      .from("sales_quotes")
      .select(
        "id, quote_number, status, current_version_id, lead_id, conversation_id, customer_name, customer_phone, organization_id, store_id, updated_at"
      )
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .eq("quote_number", args.explicitNumber)
      .maybeSingle();

    if (error) {
      throw new Error(`Falha ao buscar orcamento explicito: ${error.message}`);
    }

    if (!data?.id) {
      return {
        kind: "not_found" as const,
        explicitNumber: args.explicitNumber,
        documentType: "quote" as const,
      };
    }

    return {
      kind: "selected" as const,
      candidate: {
        documentType: "quote" as const,
        documentId: cleanText(data.id) || "",
        documentVersionId: cleanText(data.current_version_id),
        documentNumber: cleanText(data.quote_number),
        documentStatus: cleanText(data.status),
        relatedQuoteId: cleanText(data.id),
        relatedContractId: null,
        relatedLeadId: cleanText(data.lead_id),
        relatedConversationId: cleanText(data.conversation_id),
        customerName: cleanText(data.customer_name),
        customerPhone: cleanText(data.customer_phone),
        originalFileName: null,
        fileKind: "sales_quote_pdf",
        mimeType: "application/pdf",
        storageBucket: null,
        storagePath: null,
        source: "explicit_document_reference",
        createdAt: cleanText(data.updated_at),
        hasPendingAction: true,
      } satisfies DocumentContextCandidate,
    };
  }

  if (effectiveType === "contract") {
    const { data, error } = await args.supabase
      .from("sales_contracts")
      .select(
        "id, contract_number, status, current_version_id, quote_id, lead_id, conversation_id, customer_name, customer_phone, organization_id, store_id, updated_at"
      )
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .eq("contract_number", args.explicitNumber)
      .maybeSingle();

    if (error) {
      throw new Error(`Falha ao buscar contrato explicito: ${error.message}`);
    }

    if (!data?.id) {
      return {
        kind: "not_found" as const,
        explicitNumber: args.explicitNumber,
        documentType: "contract" as const,
      };
    }

    return {
      kind: "selected" as const,
      candidate: {
        documentType: "contract" as const,
        documentId: cleanText(data.id) || "",
        documentVersionId: cleanText(data.current_version_id),
        documentNumber: cleanText(data.contract_number),
        documentStatus: cleanText(data.status),
        relatedQuoteId: cleanText(data.quote_id),
        relatedContractId: cleanText(data.id),
        relatedLeadId: cleanText(data.lead_id),
        relatedConversationId: cleanText(data.conversation_id),
        customerName: cleanText(data.customer_name),
        customerPhone: cleanText(data.customer_phone),
        originalFileName: null,
        fileKind: "sales_contract_pdf",
        mimeType: "application/pdf",
        storageBucket: null,
        storagePath: null,
        source: "explicit_document_reference",
        createdAt: cleanText(data.updated_at),
        hasPendingAction: true,
      } satisfies DocumentContextCandidate,
    };
  }

  return {
    kind: "unknown_type" as const,
    explicitNumber: args.explicitNumber,
  };
}

function buildAmbiguityReply(candidates: DocumentContextCandidate[]) {
  const options = candidates
    .slice(0, 3)
    .map((candidate) => `${candidate.documentType === "contract" ? "contrato" : "orcamento"} ${formatDocumentNumber(candidate)}`)
    .join(" ou ");

  return `Encontrei mais de um documento recente. Voce quer alterar o ${options}?`;
}

async function callInternalJson(
  request: Request,
  path: string,
  init?: RequestInit
) {
  const url = new URL(path, request.url);
  const headers = new Headers(init?.headers || {});
  const cookieHeader = request.headers.get("cookie");

  if (cookieHeader && !headers.has("cookie")) {
    headers.set("cookie", cookieHeader);
  }

  if (!headers.has("accept")) {
    headers.set("accept", "application/json");
  }

  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
  });

  const body = await response.json().catch(() => null);

  return {
    ok: response.ok && Boolean(body?.ok ?? true),
    status: response.status,
    body,
  };
}

async function pushUpdatedQuoteDocumentReview(args: {
  request: Request;
  supabase: any;
  organizationId: string;
  storeId: string;
  quoteId: string;
}) {
  const detailResult = await callInternalJson(
    args.request,
    `/api/sales-quotes/${encodeURIComponent(args.quoteId)}`,
    { method: "GET" }
  );

  if (!detailResult.ok) {
    return {
      ok: false as const,
      reason: "load_quote_detail_failed",
    };
  }

  const quote = isRecord(detailResult.body?.quote) ? detailResult.body.quote : null;
  const currentVersion = isRecord(detailResult.body?.current_version)
    ? detailResult.body.current_version
    : null;

  const documentVersionId = cleanText(currentVersion?.id);
  if (!quote || !documentVersionId) {
    return {
      ok: false as const,
      reason: "missing_quote_version_context",
    };
  }

  await pushAssistantDocumentReviewMessage({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    documentType: "quote",
    documentId: cleanText(quote.id) || args.quoteId,
    documentVersionId,
    documentNumber: cleanText(quote.quote_number) || args.quoteId,
    documentStatus: "pending_review",
    relatedQuoteId: cleanText(quote.id) || args.quoteId,
    relatedLeadId: cleanText(quote.lead_id),
    relatedConversationId: cleanText(quote.conversation_id),
    customerName: cleanText(quote.customer_name),
    customerPhone: cleanText(quote.customer_phone),
    originalFileName: cleanText(currentVersion.original_filename),
    fileKind: "sales_quote_pdf",
    mimeType: cleanText(currentVersion.mime_type) || "application/pdf",
    storageBucket: cleanText(currentVersion.storage_bucket),
    storagePath: cleanText(currentVersion.storage_path),
    sourceOverride: "assistant_document_edit_workflow_v1",
  });

  return {
    ok: true as const,
  };
}

async function handleQuoteEdit(args: {
  request: Request;
  supabase: any;
  organizationId: string;
  storeId: string;
  candidate: DocumentContextCandidate;
  patch: DocumentEditPatch;
  lastHumanMessage: string;
}) {
  const normalizedStatus = normalizeText(args.candidate.documentStatus);
  const documentNumber = formatDocumentNumber(args.candidate);

  if (TERMINAL_STATUSES.has(normalizedStatus)) {
    return {
      reply: `Esse documento ja esta concluido ou encerrado. Para alterar agora, o mais seguro e gerar uma nova versao ou um novo documento. Vou deixar isso como pendencia para revisao.`,
      metadata: {
        documentEditMode: "blocked_terminal",
        documentType: "quote",
        documentId: args.candidate.documentId,
        documentStatus: normalizedStatus,
      },
    };
  }

  if (SENT_STATUSES.has(normalizedStatus)) {
    return {
      reply: `Esse documento ja foi enviado ao cliente. Nao vou alterar silenciosamente o arquivo enviado. Posso preparar uma nova versao para revisao antes de reenviar.`,
      metadata: {
        documentEditMode: "blocked_sent",
        documentType: "quote",
        documentId: args.candidate.documentId,
        documentStatus: normalizedStatus,
      },
    };
  }

  const requestChangeResult = await callInternalJson(
    args.request,
    `/api/sales-quotes/${encodeURIComponent(args.candidate.documentId)}/request-change`,
    {
      method: "POST",
      body: JSON.stringify({
        request_text: args.lastHumanMessage,
      }),
    }
  );

  if (!requestChangeResult.ok) {
    return {
      reply: `Entendi o pedido para o orcamento ${documentNumber}, mas nao consegui registrar a alteracao com seguranca agora.`,
      metadata: {
        documentEditMode: "request_change_failed",
        documentType: "quote",
        documentId: args.candidate.documentId,
        documentStatus: normalizedStatus,
        requestChangeError: cleanText(requestChangeResult.body?.error),
      },
    };
  }

  const changeRequestId = cleanText(requestChangeResult.body?.changeRequestId);

  if (args.patch.mode === "structured" && normalizedStatus === "pending_review" && changeRequestId) {
    const applyChangeResult = await callInternalJson(
      args.request,
      `/api/sales-quotes/${encodeURIComponent(args.candidate.documentId)}/apply-change`,
      {
        method: "POST",
        body: JSON.stringify({
          changeRequestId,
          ...(args.patch.quoteApplyBody || {}),
        }),
      }
    );

    if (applyChangeResult.ok) {
      await pushUpdatedQuoteDocumentReview({
        request: args.request,
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: args.storeId,
        quoteId: args.candidate.documentId,
      });

      return {
        reply: `Entendi. Preparei essa alteracao no documento ${documentNumber} antes do envio. Depois disso ele voltou para revisao aqui no chat.`,
        metadata: {
          documentEditMode: "quote_auto_applied",
          documentType: "quote",
          documentId: args.candidate.documentId,
          documentStatus: normalizedStatus,
          changeRequestId,
          appliedFieldKeys: args.patch.fieldKeys,
        },
      };
    }
  }

  return {
    reply: `Entendi. Registrei esse pedido de alteracao no ${documentNumber} e vou manter o documento sem envio automatico. Se quiser, eu posso preparar a nova versao quando a alteracao estiver mais especifica.`,
    metadata: {
      documentEditMode: "quote_change_requested",
      documentType: "quote",
      documentId: args.candidate.documentId,
      documentStatus: normalizedStatus,
      changeRequestId,
      requestedFieldKeys: args.patch.fieldKeys,
      requestHandling: args.patch.mode,
    },
  };
}

function buildContractRequestMetadataEntry(args: {
  requestText: string;
  patch: DocumentEditPatch;
  mode: "manual_review" | "auto_applied";
}) {
  return {
    id: crypto.randomUUID(),
    requested_at: new Date().toISOString(),
    requested_by: "human",
    source: "assistant_document_edit_workflow_v1",
    mode: args.mode,
    request_text: args.requestText,
    summary: args.patch.summary,
    field_keys: args.patch.fieldKeys,
    status: args.mode === "auto_applied" ? "applied" : "open",
  };
}

function appendContractChangeRequestMetadata(
  metadata: Record<string, unknown> | null | undefined,
  entry: Record<string, unknown>
) {
  const base = metadata && typeof metadata === "object" ? { ...metadata } : {};
  const existing = Array.isArray(base.assistant_pending_change_requests)
    ? base.assistant_pending_change_requests.filter((item) => isRecord(item))
    : [];
  const next = [...existing, entry].slice(-20);
  return {
    ...base,
    assistant_pending_change_requests: next,
    assistant_last_change_request: entry,
  };
}

async function handleContractEdit(args: {
  request: Request;
  candidate: DocumentContextCandidate;
  patch: DocumentEditPatch;
  lastHumanMessage: string;
}) {
  const scope = await resolveAuthorizedExistingContract(args.candidate.documentId);
  const normalizedStatus = normalizeText(scope.contract.status);
  const documentNumber = cleanText(scope.contract.contract_number) || formatDocumentNumber(args.candidate);

  if (TERMINAL_STATUSES.has(normalizedStatus)) {
    return {
      reply: `Esse documento ja esta concluido. Para alterar agora, o mais seguro e gerar uma nova versao ou um novo documento. Vou deixar isso como pendencia para revisao.`,
      metadata: {
        documentEditMode: "blocked_terminal",
        documentType: "contract",
        documentId: scope.contract.id,
        documentStatus: normalizedStatus,
      },
    };
  }

  if (SENT_STATUSES.has(normalizedStatus)) {
    return {
      reply: `Esse documento ja foi enviado ao cliente. Nao vou alterar silenciosamente o arquivo enviado. Posso preparar uma nova versao para revisao antes de reenviar.`,
      metadata: {
        documentEditMode: "blocked_sent",
        documentType: "contract",
        documentId: scope.contract.id,
        documentStatus: normalizedStatus,
      },
    };
  }

  if (args.patch.mode === "structured" && normalizedStatus === "pending_review" && args.patch.contractUpdates) {
    const requestEntry = buildContractRequestMetadataEntry({
      requestText: args.lastHumanMessage,
      patch: args.patch,
      mode: "auto_applied",
    });
    const nextMetadata = appendContractChangeRequestMetadata(scope.contract.metadata, requestEntry);
    const updatePayload: Record<string, unknown> = {
      ...args.patch.contractUpdates,
      metadata: nextMetadata,
      status: "pending_review",
      approved_at: null,
      approved_by: null,
      updated_at: new Date().toISOString(),
    };

    const { error: updateError } = await scope.supabase
      .from("sales_contracts")
      .update(updatePayload)
      .eq("id", scope.contract.id)
      .eq("organization_id", scope.organizationId)
      .eq("store_id", scope.store.id);

    if (!updateError) {
      await registerContractBusinessEvent({
        supabase: scope.supabase,
        organizationId: scope.organizationId,
        storeId: scope.store.id,
        eventKey: "contrato_alteracao_solicitada_assistente",
        actorType: "human",
        actorUserId: scope.userId,
        leadId: scope.lead?.id || scope.contract.lead_id || null,
        conversationId: scope.conversation?.id || scope.contract.conversation_id || null,
        eventPayload: {
          contract_id: scope.contract.id,
          contract_number: scope.contract.contract_number,
          status_before: scope.contract.status,
          status_after: "pending_review",
          request_text: args.lastHumanMessage,
          applied_fields: args.patch.fieldKeys,
          source: "assistant_document_edit_workflow_v1",
        },
      });

      const generateResult = await callInternalJson(
        args.request,
        `/api/sales-contracts/${encodeURIComponent(scope.contract.id)}/generate-pdf`,
        { method: "POST" }
      );

      if (generateResult.ok) {
        return {
          reply: `Entendi. Preparei essa alteracao no contrato ${documentNumber} antes do envio. Depois disso ele voltou para revisao aqui no chat.`,
          metadata: {
            documentEditMode: "contract_auto_applied",
            documentType: "contract",
            documentId: scope.contract.id,
            documentStatus: normalizedStatus,
            appliedFieldKeys: args.patch.fieldKeys,
          },
        };
      }
    }
  }

  const requestEntry = buildContractRequestMetadataEntry({
    requestText: args.lastHumanMessage,
    patch: args.patch,
    mode: "manual_review",
  });
  const nextMetadata = appendContractChangeRequestMetadata(scope.contract.metadata, requestEntry);

  const { error: metadataUpdateError } = await scope.supabase
    .from("sales_contracts")
    .update({
      metadata: nextMetadata,
      updated_at: new Date().toISOString(),
    })
    .eq("id", scope.contract.id)
    .eq("organization_id", scope.organizationId)
    .eq("store_id", scope.store.id);

  if (!metadataUpdateError) {
    await registerContractBusinessEvent({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
      eventKey: "contrato_alteracao_solicitada_assistente",
      actorType: "human",
      actorUserId: scope.userId,
      leadId: scope.lead?.id || scope.contract.lead_id || null,
      conversationId: scope.conversation?.id || scope.contract.conversation_id || null,
      eventPayload: {
        contract_id: scope.contract.id,
        contract_number: scope.contract.contract_number,
        status_before: scope.contract.status,
        request_text: args.lastHumanMessage,
        requested_fields: args.patch.fieldKeys,
        source: "assistant_document_edit_workflow_v1",
      },
    });
  }

  return {
    reply: `Entendi. Vou considerar essa alteracao no contrato ${documentNumber} antes do envio. Para seguranca, vou deixar o contrato aguardando revisao e nao vou enviar ao cliente ate voce aprovar a nova versao.`,
    metadata: {
      documentEditMode: "contract_manual_request",
      documentType: "contract",
      documentId: scope.contract.id,
      documentStatus: normalizedStatus,
      requestedFieldKeys: args.patch.fieldKeys,
      requestHandling: args.patch.mode,
    },
  };
}

export async function handleAssistantDocumentEditRequest(
  args: HandleDocumentEditArgs
): Promise<HandleDocumentEditResult> {
  const patch = detectDocumentEditIntent(args.lastHumanMessage);
  if (!patch) {
    return { handled: false };
  }

  try {
    const explicitNumber = extractExplicitDocumentNumber(args.lastHumanMessage);
    const documentTypeHint = detectDocumentTypeHint(args.lastHumanMessage);
    const explicitContextResult = explicitNumber
      ? await resolveExplicitDocumentReference({
          supabase: args.supabase,
          organizationId: args.organizationId,
          storeId: args.storeId,
          explicitNumber,
          documentTypeHint,
        })
      : null;

    if (explicitContextResult?.kind === "not_found") {
      const documentLabel =
        explicitContextResult.documentType === "contract" ? "contrato" : "orcamento";
      return {
        handled: true,
        reply: `Nao encontrei o ${documentLabel} ${explicitContextResult.explicitNumber} nessa loja. Confirme o numero ou escolha um documento recente.`,
        metadata: {
          source: "assistant_document_edit_workflow_v1",
          documentEditMode: "explicit_document_not_found",
          explicitDocumentNumber: explicitContextResult.explicitNumber,
          explicitDocumentType: explicitContextResult.documentType,
          patchMode: patch.mode,
        },
      };
    }

    const contextResult =
      explicitContextResult?.kind === "selected"
        ? ({
            kind: "selected" as const,
            candidate: explicitContextResult.candidate,
            candidates: [explicitContextResult.candidate],
          } as const)
        : findRecentAssistantDocumentContext({
            recentMessages: args.recentMessages,
            messageText: args.lastHumanMessage,
          });

    if (contextResult.kind === "not_found") {
      return {
        handled: true,
        reply:
          "Entendi que voce quer alterar um documento, mas nao encontrei um orcamento ou contrato recente aqui no chat. Me diga qual documento devo usar antes de editar.",
        metadata: {
          source: "assistant_document_edit_workflow_v1",
          documentEditMode: "document_not_found",
          patchMode: patch.mode,
        },
      };
    }

    if (contextResult.kind === "ambiguous") {
      return {
        handled: true,
        reply: buildAmbiguityReply(contextResult.candidates),
        metadata: {
          source: "assistant_document_edit_workflow_v1",
          documentEditMode: "ambiguous_document",
          patchMode: patch.mode,
          candidateDocuments: contextResult.candidates.map((candidate) => ({
            documentType: candidate.documentType,
            documentId: candidate.documentId,
            documentNumber: candidate.documentNumber,
            documentStatus: candidate.documentStatus,
          })),
        },
      };
    }

    const candidate = contextResult.candidate;
    const handledResult =
      candidate.documentType === "quote"
        ? await handleQuoteEdit({
            request: args.request,
            supabase: args.supabase,
            organizationId: args.organizationId,
            storeId: args.storeId,
            candidate,
            patch,
            lastHumanMessage: args.lastHumanMessage,
          })
        : await handleContractEdit({
            request: args.request,
            candidate,
            patch,
            lastHumanMessage: args.lastHumanMessage,
          });

    return {
      handled: true,
      reply: handledResult.reply,
      metadata: {
        source: "assistant_document_edit_workflow_v1",
        threadId: args.threadId,
        contextDocumentType: candidate.documentType,
        contextDocumentId: candidate.documentId,
        contextDocumentNumber: candidate.documentNumber,
        contextDocumentStatus: candidate.documentStatus,
        patchMode: patch.mode,
        patchSummary: patch.summary,
        ...handledResult.metadata,
      },
    };
  } catch (error) {
    console.warn("[assistant_document_edit_workflow] fallback after error:", error);

    return {
      handled: true,
      reply:
        "Entendi o pedido de alteracao, mas nao consegui preparar essa mudanca com seguranca agora. O documento continua sem envio automatico ate voce revisar.",
      metadata: {
        source: "assistant_document_edit_workflow_v1",
        documentEditMode: "safe_fallback_after_error",
        patchMode: patch.mode,
      },
    };
  }
}
