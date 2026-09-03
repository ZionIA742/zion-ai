import { NextResponse } from "next/server";
import {
  QuoteAccessError,
  resolveAuthorizedExistingQuote,
} from "@/lib/server/sales-quotes/quote-auth";
import { loadStoreQuoteSettings } from "@/lib/server/sales-quotes/quote-settings";
import { buildQuotePdfMessageMetadata } from "@/lib/server/sales-quotes/quote-storage";
import {
  SalesQuoteSendMaterializationError,
  buildSalesQuoteSendIdempotencyKey,
  buildSalesQuoteSendMessageMetadata,
  materializeSalesQuoteSendBySystem,
} from "@/lib/server/sales-quotes/quote-send";
import type {
  SalesQuoteVersionRow,
  StoreFileRow,
} from "@/lib/server/sales-quotes/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_MESSAGE_CONTENT = "Segue o orçamento em PDF para você conferir.";
const PDF_MIME_TYPE = "application/pdf";

type SendRouteDeps = {
  resolveQuoteScope?: typeof resolveAuthorizedExistingQuote;
  loadQuoteSettings?: typeof loadStoreQuoteSettings;
  materializeQuoteSend?: typeof materializeSalesQuoteSendBySystem;
};

function buildErrorResponse(error: unknown) {
  if (error instanceof QuoteAccessError) {
    return NextResponse.json(
      { ok: false, error: error.code, message: error.message },
      { status: error.status },
    );
  }

  if (error instanceof SalesQuoteSendMaterializationError) {
    return NextResponse.json(
      {
        ok: false,
        error: "QUOTE_SEND_MATERIALIZATION_FAILED",
        message: error.message,
      },
      { status: 409 },
    );
  }

  return NextResponse.json(
    {
      ok: false,
      error: "UNEXPECTED_ERROR",
      message:
        error instanceof Error
          ? error.message
          : "Erro inesperado ao preparar o envio do orçamento.",
    },
    { status: 500 },
  );
}

function hasCanonicalSentQuoteVersionEvidence(
  version: Pick<SalesQuoteVersionRow, "status" | "sent_at">,
) {
  const normalizedStatus = String(version.status || "").trim().toLowerCase();
  return Boolean(version.sent_at) &&
    (normalizedStatus === "sent" || normalizedStatus === "superseded");
}

function buildQueuedMessage(outcome: string) {
  if (outcome === "already_queued") {
    return "Este orçamento já possui um envio pendente no outbound canônico.";
  }
  return "O orçamento foi colocado na fila canônica de envio ao cliente.";
}

export function createSendQuotePostHandler(deps?: SendRouteDeps) {
  const resolveQuoteScope = deps?.resolveQuoteScope ?? resolveAuthorizedExistingQuote;
  const loadQuoteSettings = deps?.loadQuoteSettings ?? loadStoreQuoteSettings;
  const materializeQuoteSend =
    deps?.materializeQuoteSend ?? materializeSalesQuoteSendBySystem;

  return async function POST(
    _request: Request,
    context: { params: Promise<{ quoteId: string }> },
  ) {
    try {
      const { quoteId: rawQuoteId } = await context.params;
      const quoteId = String(rawQuoteId || "").trim();
      const scope = await resolveQuoteScope(quoteId);
      const commercialOpportunityId =
        String(scope.quote.commercial_opportunity_id || "").trim() || null;
      const currentVersionId = String(scope.quote.current_version_id || "").trim();

      if (!commercialOpportunityId) {
        throw new QuoteAccessError(
          409,
          "QUOTE_COMMERCIAL_OPPORTUNITY_REQUIRED",
          "Este orçamento precisa de commercial_opportunity_id explícita para o envio comercial canônico.",
        );
      }

      if (!currentVersionId) {
        throw new QuoteAccessError(
          400,
          "QUOTE_VERSION_REQUIRED",
          "Este orçamento ainda não possui uma versão de PDF gerada.",
        );
      }

      const { data: versionData, error: versionError } = await scope.supabase
        .from("sales_quote_versions")
        .select(
          "id, quote_id, organization_id, store_id, version_number, status, store_file_id, storage_bucket, storage_path, original_filename, mime_type, size_bytes, quote_snapshot, created_at, sent_at",
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
          "Versão atual do orçamento não encontrada.",
        );
      }

      const version = versionData as SalesQuoteVersionRow;
      const versionStatus = String(version.status || "").trim().toLowerCase();
      const quoteAlreadySent =
        String(scope.quote.status || "").trim().toLowerCase() === "sent";
      const versionHasCanonicalSentEvidence = hasCanonicalSentQuoteVersionEvidence(version);

      if (quoteAlreadySent || versionHasCanonicalSentEvidence) {
        if (!versionHasCanonicalSentEvidence) {
          return NextResponse.json(
            {
              ok: false,
              error: "QUOTE_ALREADY_SENT_RECONCILIATION_REQUIRES_EXPLICIT_VERSION",
              message:
                "Este orçamento já foi enviado ao cliente, mas a versão atual não identifica com segurança a proposta já apresentada.",
            },
            { status: 409 },
          );
        }

        return NextResponse.json({
          ok: true,
          quoteId: scope.quote.id,
          quoteNumber: scope.quote.quote_number,
          versionId: version.id,
          status: "sent",
          sendState: "already_sent",
          alreadySent: true,
          message: "Este orçamento já havia sido enviado ao cliente.",
        });
      }

      if (["failed", "superseded"].includes(versionStatus)) {
        return NextResponse.json(
          {
            ok: false,
            error: "QUOTE_VERSION_NOT_SENDABLE",
            message: "A versão atual do orçamento não está em um estado elegível para envio.",
          },
          { status: 409 },
        );
      }

      if (versionStatus === "sent" && !version.sent_at) {
        return NextResponse.json(
          {
            ok: false,
            error: "QUOTE_VERSION_SENT_EVIDENCE_INCONSISTENT",
            message:
              "A versão está marcada como enviada sem evidência temporal canônica; reconcilie antes de tentar novo envio.",
          },
          { status: 409 },
        );
      }

      const conversationId = String(scope.quote.conversation_id || "").trim();
      if (!conversationId) {
        throw new QuoteAccessError(
          400,
          "QUOTE_CONVERSATION_REQUIRED",
          "Este orçamento não possui conversation_id para envio ao cliente.",
        );
      }

      const { settings } = await loadQuoteSettings({
        supabase: scope.supabase,
        organizationId: scope.organizationId,
        storeId: scope.store.id,
      });

      if (!settings.quotePdfEnabled) {
        return NextResponse.json(
          {
            ok: false,
            error: "QUOTE_PDF_DISABLED",
            message: "O envio de orçamento em PDF está desabilitado para esta loja.",
          },
          { status: 403 },
        );
      }

      if (
        String(scope.quote.status || "").trim().toLowerCase() !== "approved"
      ) {
        return NextResponse.json(
          {
            ok: false,
            error: "QUOTE_REQUIRES_APPROVAL",
            message: "Este orçamento precisa ser aprovado antes de ser enviado ao cliente.",
          },
          { status: 409 },
        );
      }

      const storeFileId = String(version.store_file_id || "").trim();
      let storeFile: StoreFileRow | null = null;

      if (storeFileId) {
        const { data: storeFileData, error: storeFileError } = await scope.supabase
          .from("store_files")
          .select(
            "id, organization_id, store_id, file_kind, storage_bucket, storage_path, original_filename, mime_type, size_bytes, uploaded_by, created_at, updated_at",
          )
          .eq("id", storeFileId)
          .eq("organization_id", scope.organizationId)
          .eq("store_id", scope.store.id)
          .maybeSingle();

        if (storeFileError) {
          throw new Error(`Falha ao carregar store_files: ${storeFileError.message}`);
        }
        if (!storeFileData) {
          throw new QuoteAccessError(
            409,
            "QUOTE_STORE_FILE_NOT_FOUND",
            "A versão atual referencia um arquivo de orçamento que não foi encontrado neste tenant.",
          );
        }
        storeFile = storeFileData as StoreFileRow;
      }

      const storagePath =
        String(storeFile?.storage_path || version.storage_path || "").trim() || null;
      const originalFilename =
        String(storeFile?.original_filename || version.original_filename || "").trim() || null;
      const mimeType = String(storeFile?.mime_type || version.mime_type || "").trim();
      const sizeBytes =
        typeof storeFile?.size_bytes === "number"
          ? storeFile.size_bytes
          : typeof version.size_bytes === "number"
            ? version.size_bytes
            : null;

      if (!storagePath) {
        throw new QuoteAccessError(
          400,
          "QUOTE_FILE_MISSING",
          "A versão atual do orçamento não possui storage_path válido.",
        );
      }
      if (!originalFilename) {
        throw new QuoteAccessError(
          400,
          "QUOTE_FILENAME_MISSING",
          "A versão atual do orçamento não possui original_filename válido.",
        );
      }
      if (mimeType !== PDF_MIME_TYPE) {
        throw new QuoteAccessError(
          409,
          "QUOTE_FILE_NOT_PDF",
          "A versão atual do orçamento não aponta para um PDF canônico.",
        );
      }

      const outboundIdempotencyKey = buildSalesQuoteSendIdempotencyKey({
        organizationId: scope.organizationId,
        storeId: scope.store.id,
        commercialOpportunityId,
        salesQuoteId: scope.quote.id,
        salesQuoteVersionId: version.id,
      });

      const messageMetadata = buildSalesQuoteSendMessageMetadata({
        organizationId: scope.organizationId,
        storeId: scope.store.id,
        commercialOpportunityId,
        salesQuoteId: scope.quote.id,
        salesQuoteVersionId: version.id,
        outboundIdempotencyKey,
        baseMetadata: {
          ...buildQuotePdfMessageMetadata({
            quoteId: scope.quote.id,
            versionId: version.id,
            quoteNumber:
              String(scope.quote.quote_number || "").trim() || scope.quote.id,
            storagePath,
            originalFilename,
            sizeBytes: typeof sizeBytes === "number" ? sizeBytes : 0,
          }),
          mime_type: PDF_MIME_TYPE,
        },
      });

      const operation = await materializeQuoteSend({
        supabase: scope.supabase,
        organizationId: scope.organizationId,
        storeId: scope.store.id,
        commercialOpportunityId,
        conversationId,
        salesQuoteId: scope.quote.id,
        salesQuoteVersionId: version.id,
        messageContent: DEFAULT_MESSAGE_CONTENT,
        messageMetadata,
      });

      if (operation.outcome === "uncertain") {
        return NextResponse.json(
          {
            ok: false,
            error: "QUOTE_SEND_UNCERTAIN_REQUIRES_RECONCILIATION",
            quoteId: scope.quote.id,
            versionId: version.id,
            sendState: operation.outcome,
            messageId: operation.message_id,
            message:
              "O resultado de uma tentativa anterior está incerto; o ZION não fará novo envio cego.",
          },
          { status: 409 },
        );
      }

      if (operation.outcome === "failed") {
        return NextResponse.json(
          {
            ok: false,
            error: "QUOTE_SEND_FAILED_REQUIRES_REVIEW",
            quoteId: scope.quote.id,
            versionId: version.id,
            sendState: operation.outcome,
            messageId: operation.message_id,
            message:
              "Existe uma tentativa de envio encerrada como falha; revise a condição antes de criar nova operação.",
          },
          { status: 409 },
        );
      }

      return NextResponse.json({
        ok: true,
        quoteId: scope.quote.id,
        quoteNumber: scope.quote.quote_number,
        versionId: version.id,
        status: scope.quote.status,
        sendState: operation.outcome,
        messageId: operation.message_id,
        outboundIdempotencyKey: operation.outbound_idempotency_key,
        outboundDeliveryState: operation.outbound_delivery_state,
        externalMessageId: operation.external_message_id,
        message:
          operation.outcome === "already_sent"
            ? "Este orçamento já havia sido enviado ao cliente."
            : buildQueuedMessage(operation.outcome),
      });
    } catch (error) {
      return buildErrorResponse(error);
    }
  };
}

export const POST = createSendQuotePostHandler();
