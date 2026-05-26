import { NextResponse } from "next/server";
import { insertQuoteConversationEvent } from "@/lib/server/sales-quotes/quote-events";
import {
  QuoteAccessError,
  resolveAuthorizedExistingQuote,
} from "@/lib/server/sales-quotes/quote-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
        error instanceof Error
          ? error.message
          : "Erro inesperado ao registrar alteracao do orcamento.",
    },
    { status: 500 }
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ quoteId: string }> }
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
        "Descreva a alteracao solicitada."
      );
    }

    const { quoteId: rawQuoteId } = await context.params;
    const quoteId = String(rawQuoteId || "").trim();
    const scope = await resolveAuthorizedExistingQuote(quoteId);

    const { data: changeRequest, error: changeRequestError } = await scope.supabase
      .from("sales_quote_change_requests")
      .insert({
        quote_id: scope.quote.id,
        organization_id: scope.organizationId,
        store_id: scope.store.id,
        status: "open",
        requested_by: "human",
        request_text: requestText,
      })
      .select("id, quote_id, organization_id, store_id, status, requested_by, request_text, created_at")
      .maybeSingle();

    if (changeRequestError || !changeRequest?.id) {
      throw new Error(
        changeRequestError?.message ||
          "Falha ao registrar sales_quote_change_requests."
      );
    }

    const { error: quoteUpdateError } = await scope.supabase
      .from("sales_quotes")
      .update({
        status: "changes_requested",
      })
      .eq("id", scope.quote.id);

    if (quoteUpdateError) {
      throw new Error(quoteUpdateError.message);
    }

    await insertQuoteConversationEvent({
      supabase: scope.supabase,
      quote: scope.quote,
      eventType: "orcamento_alteracao_solicitada",
      payload: {
        quote_id: scope.quote.id,
        change_request_id: changeRequest.id,
        status: "changes_requested",
      },
      createdBy: "human",
    });

    return NextResponse.json({
      ok: true,
      quoteId: scope.quote.id,
      changeRequestId: changeRequest.id,
      status: "changes_requested",
    });
  } catch (error) {
    return buildErrorResponse(error);
  }
}

