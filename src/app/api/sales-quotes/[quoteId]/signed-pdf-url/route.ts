import { NextResponse } from "next/server";
import {
  QuoteAccessError,
  resolveAuthorizedExistingQuote,
} from "@/lib/server/sales-quotes/quote-auth";
import type { SalesQuoteVersionRow } from "@/lib/server/sales-quotes/types";

const SIGNED_URL_EXPIRATION_SECONDS = 60 * 15;

function buildJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ quoteId: string }> }
) {
  try {
    const { quoteId: rawQuoteId } = await context.params;
    const quoteId = String(rawQuoteId || "").trim();

    if (!quoteId) {
      return buildJsonResponse(
        {
          ok: false,
          error: "INVALID_QUOTE_ID",
          message: "Quote ID nao informado.",
        },
        400
      );
    }

    const scope = await resolveAuthorizedExistingQuote(quoteId);
    const currentVersionId = String(scope.quote.current_version_id || "").trim();

    if (!currentVersionId) {
      return buildJsonResponse(
        {
          ok: false,
          error: "QUOTE_WITHOUT_CURRENT_VERSION",
          message: "O orcamento ainda nao possui PDF gerado na versao atual.",
        },
        404
      );
    }

    const { data: version, error: versionError } = await scope.supabase
      .from("sales_quote_versions")
      .select(
        "id, quote_id, organization_id, store_id, version_number, status, store_file_id, storage_bucket, storage_path, original_filename, mime_type, size_bytes, quote_snapshot, created_at, sent_at"
      )
      .eq("id", currentVersionId)
      .eq("quote_id", scope.quote.id)
      .eq("organization_id", scope.organizationId)
      .eq("store_id", scope.store.id)
      .maybeSingle<SalesQuoteVersionRow>();

    if (versionError) {
      return buildJsonResponse(
        {
          ok: false,
          error: "LOAD_QUOTE_VERSION_FAILED",
          message: versionError.message,
        },
        500
      );
    }

    if (!version) {
      return buildJsonResponse(
        {
          ok: false,
          error: "QUOTE_VERSION_NOT_FOUND",
          message: "A versao atual do orcamento nao foi encontrada.",
        },
        404
      );
    }

    const storageBucket = String(version.storage_bucket || "").trim();
    const storagePath = String(version.storage_path || "").trim();

    if (!storageBucket || !storagePath) {
      return buildJsonResponse(
        {
          ok: false,
          error: "QUOTE_PDF_STORAGE_MISSING",
          message: "A versao atual do orcamento nao possui arquivo PDF valido para abrir.",
        },
        422
      );
    }

    const { data: signedData, error: signedError } = await scope.supabase.storage
      .from(storageBucket)
      .createSignedUrl(storagePath, SIGNED_URL_EXPIRATION_SECONDS);

    if (signedError || !signedData?.signedUrl) {
      return buildJsonResponse(
        {
          ok: false,
          error: "SIGNED_URL_GENERATION_FAILED",
          message:
            signedError?.message || "Nao foi possivel gerar o link temporario deste PDF.",
        },
        500
      );
    }

    return buildJsonResponse({
      ok: true,
      signedUrl: signedData.signedUrl,
      originalFilename: version.original_filename || null,
      mimeType: version.mime_type || "application/pdf",
      expiresIn: SIGNED_URL_EXPIRATION_SECONDS,
    });
  } catch (error: unknown) {
    if (error instanceof QuoteAccessError) {
      return buildJsonResponse(
        {
          ok: false,
          error: error.code,
          message: error.message,
        },
        error.status
      );
    }

    return buildJsonResponse(
      {
        ok: false,
        error: "SIGNED_QUOTE_PDF_URL_FAILED",
        message:
          error instanceof Error ? error.message : "Erro interno ao abrir o PDF do orcamento.",
      },
      500
    );
  }
}
