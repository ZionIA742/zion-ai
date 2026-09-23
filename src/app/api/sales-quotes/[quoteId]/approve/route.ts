import { NextResponse } from "next/server";
import { assertSalesQuoteVersionNotExpired } from "@/lib/server/sales-quotes/quote-expiration";
import {
  QuoteAccessError,
  resolveAuthorizedExistingQuote,
} from "@/lib/server/sales-quotes/quote-auth";
import type { SalesQuoteVersionRow } from "@/lib/server/sales-quotes/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_QUOTE_STATUS = "pending_review";
const ALLOWED_REPLAY_QUOTE_STATUS = "approved";
const ALLOWED_VERSION_STATUSES = new Set(["generated", "pending_review", "approved"]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ApproveRouteDeps = {
  resolveQuoteScope?: typeof resolveAuthorizedExistingQuote;
  approveQuoteVersion?: typeof approveQuoteVersionBySystem;
};

async function approveQuoteVersionBySystem(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  quoteId: string;
  versionId: string;
  approvedBy: string;
}) {
  const { data, error } = await args.supabase.rpc(
    "approve_sales_quote_version_by_system",
    {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_quote_id: args.quoteId,
      p_sales_quote_version_id: args.versionId,
      p_approved_by: args.approvedBy,
    },
  );

  const row = Array.isArray(data) ? data[0] : data;

  if (error) {
    const mapped = mapApprovalWriterError(error);
    if (mapped) throw mapped;
    throw new Error(`Falha ao aprovar sales_quote_versions: ${error.message}`);
  }

  if (!row) {
    throw new Error("Falha ao aprovar sales_quote_versions: retorno invalido do writer");
  }

  if (
    String(row.id || "") !== args.versionId ||
    String(row.quote_id || "") !== args.quoteId ||
    String(row.organization_id || "") !== args.organizationId ||
    String(row.store_id || "") !== args.storeId ||
    String(row.status || "") !== "approved" ||
    String(row.sent_at || "").trim()
  ) {
    throw new Error("Falha ao aprovar sales_quote_versions: retorno divergente.");
  }

  return row as SalesQuoteVersionRow;
}

function mapApprovalWriterError(error: { message?: string | null } | null) {
  const message = String(error?.message || "").trim();

  if (message.includes("ZION_SALES_QUOTE_VERSION_APPROVAL_ARGUMENTS_INVALID")) {
    return new QuoteAccessError(
      400,
      "QUOTE_VERSION_REQUIRED",
      "Informe a versao exibida para aprovar este orcamento.",
    );
  }

  if (message.includes("ZION_SALES_QUOTE_VERSION_APPROVAL_QUOTE_NOT_FOUND")) {
    return new QuoteAccessError(404, "QUOTE_NOT_FOUND", "Orcamento nao encontrado.");
  }

  if (message.includes("ZION_SALES_QUOTE_VERSION_APPROVAL_VERSION_NOT_FOUND")) {
    return new QuoteAccessError(
      404,
      "QUOTE_VERSION_NOT_FOUND",
      "Versao do orcamento nao encontrada.",
    );
  }

  if (message.includes("ZION_SALES_QUOTE_VERSION_APPROVAL_VERSION_QUOTE_MISMATCH")) {
    return new QuoteAccessError(
      409,
      "QUOTE_VERSION_QUOTE_MISMATCH",
      "A versao informada nao pertence a este orcamento.",
    );
  }

  if (message.includes("ZION_SALES_QUOTE_VERSION_APPROVAL_REQUIRES_CURRENT_VERSION")) {
    return new QuoteAccessError(
      409,
      "QUOTE_VERSION_STALE",
      "Existe uma versao mais recente do orcamento. Revise a versao atual antes de aprovar.",
    );
  }

  if (message.includes("ZION_SALES_QUOTE_VERSION_EXPIRED")) {
    return new QuoteAccessError(
      409,
      "QUOTE_VERSION_EXPIRED",
      "A versao atual do orcamento esta vencida.",
    );
  }

  if (message.includes("ZION_SALES_QUOTE_APPROVAL_QUOTE_STATUS_INVALID")) {
    return new QuoteAccessError(
      409,
      "QUOTE_STATUS_NOT_APPROVABLE",
      "Apenas orcamentos em revisao pendente podem ser aprovados nesta etapa.",
    );
  }

  if (message.includes("ZION_SALES_QUOTE_VERSION_APPROVAL_STATUS_INVALID")) {
    return new QuoteAccessError(
      409,
      "QUOTE_VERSION_STATUS_NOT_APPROVABLE",
      "A versao informada do orcamento nao esta em um status valido para aprovacao.",
    );
  }

  if (message.includes("ZION_SALES_QUOTE_APPROVAL_EVENT_CONTEXT_REQUIRED")) {
    return new QuoteAccessError(
      409,
      "QUOTE_CONVERSATION_CONTEXT_REQUIRED",
      "Este orcamento precisa de conversa e lead para registrar a aprovacao.",
    );
  }

  if (message.includes("ZION_QUOTE_APPROVAL_EVENT_NOT_ALLOWED")) {
    return new QuoteAccessError(
      409,
      "QUOTE_EVENT_NOT_ALLOWED",
      "A aprovacao do orcamento nao esta permitida no estado atual da conversa.",
    );
  }

  if (message.includes("ZION_SALES_QUOTE_APPROVAL_EVENT_INCONSISTENT")) {
    return new QuoteAccessError(
      409,
      "QUOTE_APPROVAL_EVENT_INCONSISTENT",
      "A aprovacao deste orcamento possui evento canonico inconsistente.",
    );
  }

  return null;
}

function buildErrorResponse(error: unknown) {
  if (error instanceof QuoteAccessError) {
    return NextResponse.json(
      {
        ok: false,
        error: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
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

function readQuoteVersionIdFromBody(body: unknown) {
  const candidate =
    body && typeof body === "object" && !Array.isArray(body)
      ? String((body as { quoteVersionId?: unknown }).quoteVersionId || "").trim()
      : "";

  if (!candidate || !UUID_RE.test(candidate)) {
    throw new QuoteAccessError(
      400,
      "QUOTE_VERSION_REQUIRED",
      "Informe a versao exibida para aprovar este orcamento.",
    );
  }

  return candidate;
}

export function createApproveQuotePostHandler(deps?: ApproveRouteDeps) {
  const resolveQuoteScope = deps?.resolveQuoteScope ?? resolveAuthorizedExistingQuote;
  const approveQuoteVersion = deps?.approveQuoteVersion ?? approveQuoteVersionBySystem;

  return async function POST(
    request: Request,
    context: { params: Promise<{ quoteId: string }> },
  ) {
    try {
      const body = (await request.json().catch(() => null)) as unknown;
      const requestedVersionId = readQuoteVersionIdFromBody(body);
      const { quoteId: rawQuoteId } = await context.params;
      const quoteId = String(rawQuoteId || "").trim();
      const scope = await resolveQuoteScope(quoteId);

      const currentQuoteStatus = String(scope.quote.status || "").trim().toLowerCase();
      if (currentQuoteStatus === "sent") {
        return NextResponse.json(
          {
            ok: false,
            error: "QUOTE_ALREADY_SENT",
            message: "Este orcamento ja foi enviado e nao pode ser aprovado novamente.",
          },
          { status: 409 },
        );
      }

      if (
        currentQuoteStatus !== ALLOWED_QUOTE_STATUS &&
        currentQuoteStatus !== ALLOWED_REPLAY_QUOTE_STATUS
      ) {
        return NextResponse.json(
          {
            ok: false,
            error: "QUOTE_STATUS_NOT_APPROVABLE",
            message: "Apenas orcamentos em revisao pendente podem ser aprovados nesta etapa.",
          },
          { status: 409 },
        );
      }

      const currentVersionId = String(scope.quote.current_version_id || "").trim();
      if (!currentVersionId) {
        throw new QuoteAccessError(
          409,
          "QUOTE_VERSION_STALE",
          "Este orcamento nao possui versao atual para comparar com a versao exibida.",
        );
      }

      const { data: versionData, error: versionError } = await scope.supabase
        .from("sales_quote_versions")
        .select(
          "id, quote_id, organization_id, store_id, version_number, status, store_file_id, storage_bucket, storage_path, original_filename, mime_type, size_bytes, quote_snapshot, created_at, sent_at",
        )
        .eq("id", requestedVersionId)
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
          "Versao do orcamento nao encontrada.",
        );
      }

      const version = versionData as SalesQuoteVersionRow;
      if (String(version.quote_id || "").trim() !== scope.quote.id) {
        throw new QuoteAccessError(
          409,
          "QUOTE_VERSION_QUOTE_MISMATCH",
          "A versao informada nao pertence a este orcamento.",
        );
      }

      if (currentVersionId !== requestedVersionId) {
        throw new QuoteAccessError(
          409,
          "QUOTE_VERSION_STALE",
          "Existe uma versao mais recente do orcamento. Revise a versao atual antes de aprovar.",
          {
            requestedVersionId,
            currentVersionId,
          },
        );
      }

      const currentVersionStatus = String(version.status || "").trim().toLowerCase();
      if (currentVersionStatus === "sent") {
        return NextResponse.json(
          {
            ok: false,
            error: "QUOTE_VERSION_ALREADY_SENT",
            message:
              "A versao informada deste orcamento ja foi enviada e nao pode ser aprovada novamente.",
          },
          { status: 409 },
        );
      }

      if (!ALLOWED_VERSION_STATUSES.has(currentVersionStatus)) {
        return NextResponse.json(
          {
            ok: false,
            error: "QUOTE_VERSION_STATUS_NOT_APPROVABLE",
            message:
              "A versao informada do orcamento nao esta em um status valido para aprovacao.",
          },
          { status: 409 },
        );
      }

      assertSalesQuoteVersionNotExpired({
        version,
        quote: scope.quote,
      });

      await approveQuoteVersion({
        supabase: scope.supabase,
        organizationId: scope.organizationId,
        storeId: scope.store.id,
        quoteId: scope.quote.id,
        versionId: version.id,
        approvedBy: scope.user.id,
      });

      return NextResponse.json({
        ok: true,
        quoteId: scope.quote.id,
        quoteNumber: scope.quote.quote_number,
        status: "approved",
        versionId: version.id,
        alreadyApproved:
          currentQuoteStatus === ALLOWED_REPLAY_QUOTE_STATUS &&
          currentVersionStatus === "approved",
        replayed:
          currentQuoteStatus === ALLOWED_REPLAY_QUOTE_STATUS &&
          currentVersionStatus === "approved",
      });
    } catch (error) {
      return buildErrorResponse(error);
    }
  };
}

export const POST = createApproveQuotePostHandler();
