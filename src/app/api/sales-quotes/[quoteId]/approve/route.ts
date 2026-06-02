import { NextResponse } from "next/server";
import { insertQuoteConversationEvent } from "@/lib/server/sales-quotes/quote-events";
import {
  QuoteAccessError,
  resolveAuthorizedExistingQuote,
} from "@/lib/server/sales-quotes/quote-auth";
import type { SalesQuoteVersionRow } from "@/lib/server/sales-quotes/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APPROVE_EVENT_TYPE = "orcamento_aprovado";
const ALLOWED_QUOTE_STATUS = "pending_review";
const ALLOWED_VERSION_STATUSES = new Set(["generated", "pending_review"]);

async function readQuoteApprovalAudit(args: {
  supabase: any;
  quoteId: string;
}) {
  const { data, error } = await args.supabase
    .from("sales_quotes")
    .select("id, status, approved_at, approved_by")
    .eq("id", args.quoteId)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao carregar auditoria de aprovacao do orcamento: ${error.message}`);
  }

  return data as
    | {
        id?: string | null;
        status?: string | null;
        approved_at?: string | null;
        approved_by?: string | null;
      }
    | null;
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
        error instanceof Error ? error.message : "Erro inesperado ao aprovar o orcamento.",
    },
    { status: 500 }
  );
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ quoteId: string }> }
) {
  try {
    const { quoteId: rawQuoteId } = await context.params;
    const quoteId = String(rawQuoteId || "").trim();
    const scope = await resolveAuthorizedExistingQuote(quoteId);

    const currentQuoteStatus = String(scope.quote.status || "").trim().toLowerCase();
    const approvalTimestamp = new Date().toISOString();

    if (currentQuoteStatus === "approved") {
      const audit = await readQuoteApprovalAudit({
        supabase: scope.supabase,
        quoteId: scope.quote.id,
      });
      const approvedAt = String(audit?.approved_at || "").trim();
      const approvedBy = String(audit?.approved_by || "").trim();

      if (!approvedAt || !approvedBy) {
        const { error: approvalAuditError } = await scope.supabase
          .from("sales_quotes")
          .update({
            approved_at: approvedAt || approvalTimestamp,
            approved_by: approvedBy || scope.user.id,
            updated_at: approvalTimestamp,
          })
          .eq("id", scope.quote.id);

        if (approvalAuditError) {
          throw new Error(
            `Falha ao complementar auditoria de aprovacao do orcamento: ${approvalAuditError.message}`
          );
        }

        return NextResponse.json({
          ok: true,
          quoteId: scope.quote.id,
          quoteNumber: scope.quote.quote_number,
          status: "approved",
          alreadyApproved: true,
          approvalAuditBackfilled: true,
        });
      }

      return NextResponse.json(
        {
          ok: false,
          error: "QUOTE_ALREADY_APPROVED",
          message: "Este orcamento ja foi aprovado.",
        },
        { status: 409 }
      );
    }

    if (currentQuoteStatus === "sent") {
      return NextResponse.json(
        {
          ok: false,
          error: "QUOTE_ALREADY_SENT",
          message: "Este orcamento ja foi enviado e nao pode ser aprovado novamente.",
        },
        { status: 409 }
      );
    }

    if (currentQuoteStatus !== ALLOWED_QUOTE_STATUS) {
      return NextResponse.json(
        {
          ok: false,
          error: "QUOTE_STATUS_NOT_APPROVABLE",
          message: "Apenas orcamentos em revisao pendente podem ser aprovados nesta etapa.",
        },
        { status: 409 }
      );
    }

    const currentVersionId = String(scope.quote.current_version_id || "").trim();
    if (!currentVersionId) {
      throw new QuoteAccessError(
        400,
        "QUOTE_VERSION_REQUIRED",
        "Este orcamento ainda nao possui uma versao atual para aprovacao."
      );
    }

    const { data: versionData, error: versionError } = await scope.supabase
      .from("sales_quote_versions")
      .select(
        "id, quote_id, organization_id, store_id, version_number, status, store_file_id, storage_bucket, storage_path, original_filename, mime_type, size_bytes, quote_snapshot, created_at, sent_at"
      )
      .eq("id", currentVersionId)
      .eq("quote_id", scope.quote.id)
      .eq("organization_id", scope.organizationId)
      .eq("store_id", scope.store.id)
      .maybeSingle();

    if (versionError) {
      throw new Error(`Falha ao carregar sales_quote_versions: ${versionError.message}`);
    }

    if (!versionData) {
      throw new QuoteAccessError(
        404,
        "QUOTE_VERSION_NOT_FOUND",
        "Versao atual do orcamento nao encontrada."
      );
    }

    const version = versionData as SalesQuoteVersionRow;
    const currentVersionStatus = String(version.status || "").trim().toLowerCase();

    if (currentVersionStatus === "approved") {
      return NextResponse.json(
        {
          ok: false,
          error: "QUOTE_VERSION_ALREADY_APPROVED",
          message: "A versao atual deste orcamento ja foi aprovada.",
        },
        { status: 409 }
      );
    }

    if (currentVersionStatus === "sent") {
      return NextResponse.json(
        {
          ok: false,
          error: "QUOTE_VERSION_ALREADY_SENT",
          message: "A versao atual deste orcamento ja foi enviada e nao pode ser aprovada novamente.",
        },
        { status: 409 }
      );
    }

    if (!ALLOWED_VERSION_STATUSES.has(currentVersionStatus)) {
      return NextResponse.json(
        {
          ok: false,
          error: "QUOTE_VERSION_STATUS_NOT_APPROVABLE",
          message: "A versao atual do orcamento nao esta em um status valido para aprovacao.",
        },
        { status: 409 }
      );
    }

    const { error: quoteUpdateError } = await scope.supabase
      .from("sales_quotes")
      .update({
        status: "approved",
        approved_at: approvalTimestamp,
        approved_by: scope.user.id,
        updated_at: approvalTimestamp,
      })
      .eq("id", scope.quote.id);

    if (quoteUpdateError) {
      throw new Error(`Falha ao atualizar sales_quotes: ${quoteUpdateError.message}`);
    }

    const { error: versionUpdateError } = await scope.supabase
      .from("sales_quote_versions")
      .update({
        status: "approved",
      })
      .eq("id", version.id);

    if (versionUpdateError) {
      throw new Error(
        `Falha ao atualizar sales_quote_versions: ${versionUpdateError.message}`
      );
    }

    await insertQuoteConversationEvent({
      supabase: scope.supabase,
      quote: {
        ...scope.quote,
        status: "approved",
      },
      eventType: APPROVE_EVENT_TYPE,
      payload: {
        quote_id: scope.quote.id,
        version_id: version.id,
        quote_number: scope.quote.quote_number,
        total_cents: scope.quote.total_cents,
        status: "approved",
      },
      createdBy: "human",
    });

    return NextResponse.json({
      ok: true,
      quoteId: scope.quote.id,
      quoteNumber: scope.quote.quote_number,
      status: "approved",
      versionId: version.id,
    });
  } catch (error) {
    return buildErrorResponse(error);
  }
}
