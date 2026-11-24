import { NextResponse } from "next/server";
import {
  QuoteAccessError,
  resolveAuthorizedExistingQuote,
} from "@/lib/server/sales-quotes/quote-auth";
import {
  HumanQuoteDraftInputError,
  buildHumanQuoteDraftEditRpcArgs,
} from "@/lib/server/sales-quotes/human-quote-draft-edit-input";
import {
  HumanQuoteEditBoundaryError,
  prepareHumanQuoteEditBoundary,
} from "@/lib/server/sales-quotes/human-quote-edit-boundary";
import {
  HumanQuoteEditProvenanceError,
} from "@/lib/server/sales-quotes/human-quote-edit-provenance";
import type {
  SalesQuoteItemRow,
} from "@/lib/server/sales-quotes/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function failure(
  status: number,
  code: string,
  message: string,
) {
  return NextResponse.json(
    { ok: false, error: code, message },
    { status },
  );
}

function versionedFlowRequired() {
  return failure(
    409,
    "HUMAN_QUOTE_EDIT_VERSIONED_FLOW_REQUIRED",
    "Este orcamento exige o fluxo de edicao versionada.",
  );
}

function databaseFailure(error: {
  code?: string;
  message?: string;
}) {
  switch (error.message) {
    case "ZION_HUMAN_QUOTE_EDIT_STALE":
      return failure(
        409,
        "HUMAN_QUOTE_EDIT_STALE",
        "O orcamento foi modificado. Recarregue antes de salvar.",
      );

    case "ZION_HUMAN_QUOTE_EDIT_NOT_FOUND":
    case "ZION_SALES_QUOTE_APPLY_CHANGE_QUOTE_NOT_FOUND":
      return failure(
        404,
        "QUOTE_NOT_FOUND",
        "Orcamento nao encontrado.",
      );

    case "ZION_HUMAN_QUOTE_EDIT_PROVENANCE_REQUIRED":
      return failure(
        403,
        "HUMAN_QUOTE_EDIT_PROVENANCE_REQUIRED",
        "Origem humana do orcamento nao comprovada.",
      );

    case "ZION_HUMAN_QUOTE_EDIT_FORBIDDEN":
      return failure(
        403,
        "HUMAN_QUOTE_EDIT_FORBIDDEN",
        "Edicao nao autorizada.",
      );

    case "ZION_HUMAN_QUOTE_EDIT_VERSIONED_FLOW_REQUIRED":
      return versionedFlowRequired();

    case "ZION_HUMAN_QUOTE_EDIT_ARGUMENTS_INVALID":
    case "ZION_HUMAN_QUOTE_EDIT_ITEMS_INVALID":
    case "ZION_HUMAN_QUOTE_EDIT_ITEMS_REQUIRED":
    case "ZION_SALES_QUOTE_APPLY_CHANGE_ATOMIC_ARGUMENTS_INVALID":
    case "ZION_SALES_QUOTE_APPLY_CHANGE_HEADER_ITEMS_MISMATCH":
    case "ZION_SALES_QUOTE_APPLY_CHANGE_ITEM_INVALID":
    case "ZION_SALES_QUOTE_APPLY_CHANGE_ITEM_MONEY_INVALID":
    case "ZION_SALES_QUOTE_APPLY_CHANGE_MONEY_OUT_OF_RANGE":
      return failure(
        400,
        "INVALID_QUOTE_EDIT",
        "Revise os itens e valores do orcamento.",
      );

    default:
      if (error.code === "40001" || error.code === "40P01") {
        return failure(
          409,
          "HUMAN_QUOTE_EDIT_CONFLICT",
          "Recarregue o orcamento antes de tentar novamente.",
        );
      }

      return failure(
        500,
        "HUMAN_QUOTE_EDIT_FAILED",
        "Nao foi possivel confirmar a edicao.",
      );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ quoteId: string }> },
) {
  try {
    const { quoteId } = await context.params;

    if (!UUID_RE.test(quoteId)) {
      return failure(
        400,
        "INVALID_QUOTE_ID",
        "Identificador do orcamento invalido.",
      );
    }

    // Autenticacao e autorizacao antes de qualquer escrita.
    const scope = await resolveAuthorizedExistingQuote(quoteId);

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return failure(
        400,
        "INVALID_JSON",
        "Conteudo da edicao invalido.",
      );
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return failure(
        400,
        "INVALID_EDIT_INPUT",
        "Conteudo da edicao invalido.",
      );
    }

    const input = body as Record<string, unknown>;

    // Rejeita origem indevida ou edicao obsoleta antes de ler itens.
    const boundary = prepareHumanQuoteEditBoundary({
      quote: scope.quote,
      expectedUpdatedAt: input.expected_updated_at,
      expectedCurrentVersionId: input.expected_current_version_id,
    });

    if (
      boundary.preservedStatus !== "draft" ||
      boundary.expectedCurrentVersionId !== null
    ) {
      return versionedFlowRequired();
    }

    const { data: items, error: itemsError } =
      await scope.supabase
        .from("sales_quote_items")
        .select(
          "id, quote_id, organization_id, store_id, commercial_opportunity_id, profile_component_id, pool_id, catalog_item_id, item_type, name, description, quantity, unit_price_cents, discount_cents, subtotal_cents, total_cents, sort_order, sku, metadata, created_at, updated_at",
        )
        .eq("quote_id", scope.quote.id)
        .eq("organization_id", scope.organizationId)
        .eq("store_id", scope.store.id)
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true });

    if (itemsError) {
      return failure(
        500,
        "LOAD_QUOTE_ITEMS_FAILED",
        "Nao foi possivel carregar os itens do orcamento.",
      );
    }

    const rpcArgs = buildHumanQuoteDraftEditRpcArgs({
      quote: scope.quote,
      currentItems: (items || []) as SalesQuoteItemRow[],
      body,
    });

    // A autoridade SQL repete as verificacoes sob bloqueio.
    const { data, error } = await scope.supabase.rpc(
      "apply_human_sales_quote_draft_edit_by_system",
      rpcArgs,
    );

    if (error) {
      return databaseFailure(error);
    }

    const row = Array.isArray(data)
      ? data.length === 1 ? data[0] : null
      : data;

    if (
      !row ||
      row.quote_id !== scope.quote.id ||
      row.quote_status !== "draft" ||
      row.current_version_id !== null ||
      row.item_count !== rpcArgs.p_items.length ||
      row.subtotal_cents !== rpcArgs.p_subtotal_cents ||
      row.discount_cents !== rpcArgs.p_discount_cents ||
      row.total_cents !== rpcArgs.p_total_cents ||
      typeof row.updated_at !== "string" ||
      !row.updated_at ||
      row.updated_at === rpcArgs.p_expected_updated_at
    ) {
      return failure(
        500,
        "HUMAN_QUOTE_EDIT_RESULT_INVALID",
        "Recarregue o orcamento para confirmar seu estado.",
      );
    }

    return NextResponse.json({
      ok: true,
      quote: {
        id: row.quote_id,
        status: row.quote_status,
        current_version_id: row.current_version_id,
        updated_at: row.updated_at,
        subtotal_cents: row.subtotal_cents,
        discount_cents: row.discount_cents,
        total_cents: row.total_cents,
      },
      item_count: row.item_count,
    });

  } catch (error) {
    if (
      error instanceof QuoteAccessError ||
      error instanceof HumanQuoteEditBoundaryError ||
      error instanceof HumanQuoteEditProvenanceError ||
      error instanceof HumanQuoteDraftInputError
    ) {
      if (
        error.code === "HUMAN_QUOTE_EDIT_VERSIONED_FLOW_REQUIRED"
      ) {
        return versionedFlowRequired();
      }

      return failure(
        error.status,
        error.code,
        error.status >= 500
          ? "Nao foi possivel concluir a edicao."
          : error.message,
      );
    }

    return failure(
      500,
      "UNEXPECTED_ERROR",
      "Nao foi possivel concluir a edicao.",
    );
  }
}
