import { NextResponse } from "next/server";
import {
  buildQuotePdf,
  loadStoreLogoForPdf,
} from "@/lib/server/sales-quotes/build-quote-pdf";
import {
  canInsertQuoteConversationEvent,
  insertQuoteConversationEvent,
} from "@/lib/server/sales-quotes/quote-events";
import {
  QuoteAccessError,
  resolveAuthorizedExistingQuote,
} from "@/lib/server/sales-quotes/quote-auth";
import { loadStoreQuoteSettings } from "@/lib/server/sales-quotes/quote-settings";
import { storeQuotePdfFile } from "@/lib/server/sales-quotes/quote-storage";
import { pushAssistantDocumentReviewMessage } from "@/lib/server/assistant/document-review-messages";
import {
  buildQuoteSnapshot,
  createQuoteVersion,
  getNextQuoteVersionNumber,
  recordQuoteGenerationFailure,
} from "@/lib/server/sales-quotes/quote-versioning";
import type { SalesQuoteItemRow } from "@/lib/server/sales-quotes/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QUOTE_EVENT_ALLOWED_STATES = new Set(["orcamento"]);

function normalizeState(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

async function loadCurrentQuoteConversationState(args: {
  supabase: any;
  organizationId: string;
  conversationId: string | null;
  leadId: string | null;
}) {
  const conversationId = String(args.conversationId || "").trim();
  if (!conversationId) {
    return null;
  }

  const { data, error } = await args.supabase
    .from("conversation_states")
    .select("conversation_id, organization_id, state")
    .eq("conversation_id", conversationId)
    .eq("organization_id", args.organizationId)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao carregar estado atual da conversation_states: ${error.message}`);
  }

  const rowLeadId = String(args.leadId || "").trim();
  if (rowLeadId) {
    const { data: conversationRow, error: conversationError } = await args.supabase
      .from("conversations")
      .select("id, lead_id, organization_id")
      .eq("id", conversationId)
      .eq("organization_id", args.organizationId)
      .maybeSingle();

    if (conversationError) {
      throw new Error(`Falha ao validar conversa para transicao do orcamento: ${conversationError.message}`);
    }

    if (!conversationRow?.id) {
      throw new QuoteAccessError(
        404,
        "QUOTE_CONVERSATION_NOT_FOUND",
        "Conversa nao encontrada para preparar o orcamento."
      );
    }

    if (String(conversationRow.lead_id || "").trim() !== rowLeadId) {
      throw new QuoteAccessError(
        409,
        "QUOTE_CONVERSATION_LEAD_MISMATCH",
        "A conversa vinculada ao orcamento nao corresponde ao lead esperado."
      );
    }
  }

  return normalizeState(data?.state) || null;
}

async function transitionQuoteConversationState(args: {
  supabase: any;
  organizationId: string;
  conversationId: string;
  toState: "qualificacao" | "orcamento";
  reason: string;
}) {
  const { error } = await args.supabase.rpc("panel_transition_conversation_state_scoped", {
    p_organization_id: args.organizationId,
    p_conversation_id: args.conversationId,
    p_to_state: args.toState,
    p_reason: args.reason,
  });

  if (error) {
    throw new QuoteAccessError(
      409,
      "QUOTE_CRM_TRANSITION_FAILED",
      `Nao foi possivel preparar o funil comercial para gerar o orcamento: ${error.message}`
    );
  }
}

async function ensureQuoteConversationReadyForGeneration(args: {
  supabase: any;
  organizationId: string;
  conversationId: string | null;
  leadId: string | null;
}) {
  const conversationId = String(args.conversationId || "").trim();
  if (!conversationId) {
    return {
      transitioned: false,
      currentState: null,
      skippedReason: "missing_conversation_id",
    };
  }

  const initialState = await loadCurrentQuoteConversationState({
    supabase: args.supabase,
    organizationId: args.organizationId,
    conversationId,
    leadId: args.leadId,
  });

  if (!initialState) {
    return {
      transitioned: false,
      currentState: null,
      skippedReason: "missing_current_state",
    };
  }

  if (QUOTE_EVENT_ALLOWED_STATES.has(initialState)) {
    return {
      transitioned: false,
      currentState: initialState,
      skippedReason: "already_allowed",
    };
  }

  if (initialState === "novo_lead") {
    await transitionQuoteConversationState({
      supabase: args.supabase,
      organizationId: args.organizationId,
      conversationId,
      toState: "qualificacao",
      reason: "manual_quote_pdf_prepare_qualification",
    });

    const qualificationState = await loadCurrentQuoteConversationState({
      supabase: args.supabase,
      organizationId: args.organizationId,
      conversationId,
      leadId: args.leadId,
    });

    if (qualificationState !== "qualificacao") {
      throw new QuoteAccessError(
        409,
        "QUOTE_EVENT_STATE_NOT_READY",
        "A conversa nao entrou em qualificacao antes da etapa de orcamento."
      );
    }

    await transitionQuoteConversationState({
      supabase: args.supabase,
      organizationId: args.organizationId,
      conversationId,
      toState: "orcamento",
      reason: "manual_quote_pdf_prepare_budget",
    });
  } else if (initialState === "qualificacao") {
    await transitionQuoteConversationState({
      supabase: args.supabase,
      organizationId: args.organizationId,
      conversationId,
      toState: "orcamento",
      reason: "manual_quote_pdf_prepare_budget",
    });
  }

  const finalState = await loadCurrentQuoteConversationState({
    supabase: args.supabase,
    organizationId: args.organizationId,
    conversationId,
    leadId: args.leadId,
  });

  if (!finalState || !QUOTE_EVENT_ALLOWED_STATES.has(finalState)) {
    throw new QuoteAccessError(
      409,
      "QUOTE_EVENT_STATE_NOT_READY",
      "A conversa ainda nao esta em um estado compativel para gerar o orcamento."
    );
  }

  return {
    transitioned: finalState !== initialState,
    currentState: finalState,
    skippedReason: finalState === initialState ? "already_allowed" : "transitioned",
  };
}

function normalizeOptionalText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function readQuoteTextField(
  quote: Record<string, unknown>,
  metadata: Record<string, unknown> | null,
  key: "payment_terms" | "delivery_terms" | "warranty_terms" | "valid_until"
) {
  return normalizeOptionalText(quote[key]) || normalizeOptionalText(metadata?.[key]);
}

function buildErrorResponse(error: unknown) {
  if (error instanceof QuoteAccessError) {
    return NextResponse.json(
      {
        ok: false,
        error: error.code,
        message: error.message,
      },
      { status: error.status }
    );
  }

  return NextResponse.json(
    {
      ok: false,
      error: "UNEXPECTED_ERROR",
      message:
        error instanceof Error ? error.message : "Erro inesperado ao gerar PDF do orcamento.",
    },
    { status: 500 }
  );
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ quoteId: string }> }
) {
  let generationContext:
    | {
        supabase: any;
        quote: any;
        versionNumber: number;
        snapshot: any;
      }
    | null = null;
  let versionCreated = false;

  try {
    const { quoteId: rawQuoteId } = await context.params;
    const quoteId = String(rawQuoteId || "").trim();
    const scope = await resolveAuthorizedExistingQuote(quoteId);
    await ensureQuoteConversationReadyForGeneration({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      conversationId: scope.conversation?.id || scope.quote.conversation_id || null,
      leadId: scope.lead?.id || scope.quote.lead_id || null,
    });

    const eventGuard = await canInsertQuoteConversationEvent({
      supabase: scope.supabase,
      quote: scope.quote,
      eventType: "orcamento_gerado",
    });

    if (!eventGuard.allowed) {
      throw new QuoteAccessError(
        409,
        "QUOTE_EVENT_NOT_ALLOWED",
        "A geracao do orcamento nao esta permitida no estado atual da conversa."
      );
    }

    const { settings } = await loadStoreQuoteSettings({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
    });

    const { data: itemsData, error: itemsError } = await scope.supabase
      .from("sales_quote_items")
      .select(
        "id, quote_id, organization_id, store_id, name, description, quantity, unit_price_cents, discount_cents, subtotal_cents, total_cents, sort_order, sku, metadata, created_at, updated_at"
      )
      .eq("quote_id", scope.quote.id)
      .order("sort_order", { ascending: true });

    if (itemsError) {
      throw new Error(itemsError.message);
    }

    const items = (itemsData || []) as SalesQuoteItemRow[];

    if (items.length === 0) {
      throw new QuoteAccessError(
        400,
        "QUOTE_WITHOUT_ITEMS",
        "Nao e possivel gerar PDF para um orcamento sem itens."
      );
    }

    const versionNumber = await getNextQuoteVersionNumber({
      supabase: scope.supabase,
      quoteId: scope.quote.id,
    });

    const snapshot = buildQuoteSnapshot({
      quote: scope.quote,
      items,
      settings,
      store: scope.store,
      lead: scope.lead,
    });

    generationContext = {
      supabase: scope.supabase,
      quote: scope.quote,
      versionNumber,
      snapshot,
    };

    const quoteMetadata =
      scope.quote.metadata && typeof scope.quote.metadata === "object"
        ? scope.quote.metadata
        : null;

    const storeLogo = await loadStoreLogoForPdf({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
    });

    const pdfBytes = await buildQuotePdf({
      storeName: scope.store.name,
      storeLogo,
      quoteNumber: String(scope.quote.quote_number || "").trim() || scope.quote.id,
      title: scope.quote.title,
      customerName: scope.lead?.name || null,
      customerPhone: scope.lead?.phone || null,
      createdAt: scope.quote.created_at,
      validUntil: readQuoteTextField(scope.quote as Record<string, unknown>, quoteMetadata, "valid_until"),
      items: items.map((item) => ({
        name: item.name,
        description: item.description,
        quantity: item.quantity,
        unitPriceCents: item.unit_price_cents,
        discountCents: item.discount_cents,
        totalCents: item.total_cents,
      })),
      subtotalCents: Number(scope.quote.subtotal_cents || 0),
      discountCents: Number(scope.quote.discount_cents || 0),
      totalCents: Number(scope.quote.total_cents || 0),
      customerNotes: scope.quote.customer_notes,
      paymentTerms: readQuoteTextField(scope.quote as Record<string, unknown>, quoteMetadata, "payment_terms"),
      deliveryTerms: readQuoteTextField(scope.quote as Record<string, unknown>, quoteMetadata, "delivery_terms"),
      warrantyTerms: readQuoteTextField(scope.quote as Record<string, unknown>, quoteMetadata, "warranty_terms"),
      settings,
    });

    const storedFile = await storeQuotePdfFile({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
      quoteId: scope.quote.id,
      quoteNumber: String(scope.quote.quote_number || "").trim() || scope.quote.id,
      versionNumber,
      pdfBytes,
    });

    const versionRow = await createQuoteVersion({
      supabase: scope.supabase,
      quote: scope.quote,
      versionNumber,
      storeFileId: storedFile.storeFileId,
      storageBucket: storedFile.storageBucket,
      storagePath: storedFile.storagePath,
      originalFilename: storedFile.originalFilename,
      sizeBytes: storedFile.sizeBytes,
      quoteSnapshot: snapshot,
      nextQuoteStatus: "pending_review",
    });
    versionCreated = true;

    await insertQuoteConversationEvent({
      supabase: scope.supabase,
      quote: scope.quote,
      eventType: "orcamento_gerado",
      payload: {
        quote_id: scope.quote.id,
        version_id: versionRow.id,
        quote_number: scope.quote.quote_number,
        total_cents: scope.quote.total_cents,
        status: "pending_review",
      },
      createdBy: "system",
    });

    try {
      await pushAssistantDocumentReviewMessage({
        supabase: scope.supabase,
        organizationId: scope.organizationId,
        storeId: scope.store.id,
        documentType: "quote",
        documentId: scope.quote.id,
        documentVersionId: versionRow.id,
        documentNumber: String(scope.quote.quote_number || "").trim() || scope.quote.id,
        documentStatus: "pending_review",
        relatedQuoteId: scope.quote.id,
        relatedContractId: null,
        relatedLeadId: scope.lead?.id || scope.quote.lead_id || null,
        relatedConversationId:
          scope.conversation?.id || scope.quote.conversation_id || null,
        customerName: scope.quote.customer_name || scope.lead?.name || null,
        customerPhone: scope.quote.customer_phone || scope.lead?.phone || null,
        originalFileName: storedFile.originalFilename,
        fileKind: "sales_quote_pdf",
        mimeType: "application/pdf",
        storageBucket: storedFile.storageBucket,
        storagePath: storedFile.storagePath,
      });
    } catch (assistantMessageError) {
      console.warn(
        "[sales-quotes/generate-pdf] falha ao criar mensagem document_review da assistente:",
        assistantMessageError
      );
    }

    return NextResponse.json({
      ok: true,
      quoteId: scope.quote.id,
      versionId: versionRow.id,
      storeFileId: storedFile.storeFileId,
      storagePath: storedFile.storagePath,
      status: "pending_review",
    });
  } catch (error) {
    if (generationContext && !versionCreated) {
      try {
        await recordQuoteGenerationFailure({
          supabase: generationContext.supabase,
          quote: generationContext.quote,
          versionNumber: generationContext.versionNumber,
          quoteSnapshot: {
            ...generationContext.snapshot,
            generationError:
              error instanceof Error ? error.message : "Erro inesperado na geracao.",
          },
        });
      } catch {
        // best effort
      }
    }

    return buildErrorResponse(error);
  }
}
