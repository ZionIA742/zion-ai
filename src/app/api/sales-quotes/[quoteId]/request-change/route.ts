import { NextResponse } from "next/server";
import { requestQuoteChangeAtomically } from "@/lib/server/sales-quotes/quote-change-requests";
import { ensureQuoteConversationReadyForQuoteEvent } from "@/lib/server/sales-quotes/quote-conversation-readiness";
import { canInsertQuoteConversationEvent } from "@/lib/server/sales-quotes/quote-events";
import {
  QuoteAccessError,
  resolveAuthorizedExistingQuote,
} from "@/lib/server/sales-quotes/quote-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANGE_REQUEST_EVENT_TYPE = "orcamento_alteracao_solicitada";

type RequestChangeDeps = {
  resolveQuoteScope?: typeof resolveAuthorizedExistingQuote;
  ensureConversationReady?: typeof ensureQuoteConversationReadyForQuoteEvent;
  canInsertEvent?: typeof canInsertQuoteConversationEvent;
  requestQuoteChange?: typeof requestQuoteChangeAtomically;
};

function buildErrorResponse(error: unknown) {
  if (error instanceof QuoteAccessError) {
    return NextResponse.json(
      {
        ok: false,
        error: error.code,
        message: error.message,
      },
      { status: error.status },
    );
  }

  return NextResponse.json(
    {
      ok: false,
      error: "UNEXPECTED_ERROR",
      message:
        error instanceof Error
          ? error.message
          : "Erro inesperado ao registrar alteracao do orcamento.",
    },
    { status: 500 },
  );
}

export function createRequestChangePostHandler(deps?: RequestChangeDeps) {
  const resolveQuoteScope = deps?.resolveQuoteScope ?? resolveAuthorizedExistingQuote;
  const ensureConversationReady =
    deps?.ensureConversationReady ?? ensureQuoteConversationReadyForQuoteEvent;
  const canInsertEvent = deps?.canInsertEvent ?? canInsertQuoteConversationEvent;
  const requestQuoteChange = deps?.requestQuoteChange ?? requestQuoteChangeAtomically;

  return async function POST(
    request: Request,
    context: { params: Promise<{ quoteId: string }> },
  ) {
    try {
      const body = (await request.json().catch(() => null)) as
        | { request_text?: string | null }
        | null;
      const requestText = String(body?.request_text || "").trim();

      if (!requestText) {
        throw new QuoteAccessError(
          400,
          "INVALID_REQUEST_TEXT",
          "Descreva a alteracao solicitada.",
        );
      }

      const { quoteId: rawQuoteId } = await context.params;
      const quoteId = String(rawQuoteId || "").trim();
      const scope = await resolveQuoteScope(quoteId);
      const conversationId =
        String(scope.conversation?.id || scope.quote.conversation_id || "").trim() || null;
      const leadId = String(scope.lead?.id || scope.quote.lead_id || "").trim() || null;

      await ensureConversationReady({
        supabase: scope.supabase,
        actorUserId: scope.user.id,
        organizationId: scope.organizationId,
        conversationId,
        leadId,
        source: "quote_change_request",
      });

      const eventGuard = await canInsertEvent({
        supabase: scope.supabase,
        quote: scope.quote,
        eventType: CHANGE_REQUEST_EVENT_TYPE,
      });

      if (!eventGuard.allowed) {
        throw new QuoteAccessError(
          409,
          "QUOTE_EVENT_NOT_ALLOWED",
          "A solicitacao de alteracao do orcamento nao esta permitida no estado atual da conversa.",
        );
      }

      if (!conversationId || !leadId) {
        throw new QuoteAccessError(
          409,
          "QUOTE_CONVERSATION_CONTEXT_REQUIRED",
          "Este orcamento precisa de conversa e lead para registrar a solicitacao de alteracao.",
        );
      }

      const result = await requestQuoteChange({
        supabase: scope.supabase,
        quote: scope.quote,
        organizationId: scope.organizationId,
        storeId: scope.store.id,
        conversationId,
        leadId,
        requestText,
      });

      return NextResponse.json({
        ok: true,
        quoteId: scope.quote.id,
        quoteNumber: scope.quote.quote_number,
        changeRequestId: result.changeRequestId,
        status: result.status,
        reusedExistingRequest: result.reusedExistingRequest,
        replayed: result.reusedExistingRequest,
        conversationEvent: {
          created: result.eventCreated,
          skippedReason: null,
        },
      });
    } catch (error) {
      return buildErrorResponse(error);
    }
  };
}

export const POST = createRequestChangePostHandler();
