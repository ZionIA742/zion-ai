import { NextResponse } from "next/server";
import { resolveAuthorizedQuoteForContract, ContractAccessError } from "@/lib/server/sales-contracts/contract-auth";
import { registerContractBusinessEvent } from "@/lib/server/sales-contracts/contract-events";
import type { CreateContractFromQuoteInput, SalesContract } from "@/lib/server/sales-contracts/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QuoteMetadata = Record<string, unknown> | null;

function buildErrorResponse(error: unknown) {
  if (error instanceof ContractAccessError) {
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
        error instanceof Error ? error.message : "Erro inesperado ao criar contrato.",
    },
    { status: 500 }
  );
}

function normalizeOptionalText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function readMetadataValue(metadata: QuoteMetadata, key: string) {
  return metadata && typeof metadata === "object" ? metadata[key] : null;
}

function isIsoDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function isNumericOnlyValue(value: string) {
  return /^\d+$/.test(value);
}

function parseDateCandidate(value: unknown) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;

  if (isNumericOnlyValue(normalized)) {
    return null;
  }

  if (isIsoDateOnly(normalized)) {
    return normalized;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return normalizeDateOnly(parsed);
}

function parseValidityDays(value: unknown) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  if (!/^\d+$/.test(normalized)) return null;

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;

  return parsed;
}

function addDaysToDateString(baseDateValue: unknown, days: number) {
  const baseDate = new Date(String(baseDateValue || "").trim() || Date.now());
  if (Number.isNaN(baseDate.getTime())) {
    return null;
  }

  baseDate.setUTCHours(0, 0, 0, 0);
  baseDate.setUTCDate(baseDate.getUTCDate() + days);
  return normalizeDateOnly(baseDate);
}

function resolveContractValidUntil(args: {
  quote: {
    valid_until?: string | null;
    created_at?: string | null;
  };
  quoteMetadata: QuoteMetadata;
}) {
  const officialValidUntil = parseDateCandidate(args.quote.valid_until);
  if (officialValidUntil) return officialValidUntil;

  const metadataValidUntil = parseDateCandidate(readMetadataValue(args.quoteMetadata, "valid_until"));
  if (metadataValidUntil) return metadataValidUntil;

  const validityDays =
    parseValidityDays(readMetadataValue(args.quoteMetadata, "validity_days")) ??
    parseValidityDays(readMetadataValue(args.quoteMetadata, "valid_until")) ??
    parseValidityDays(args.quote.valid_until);

  if (validityDays == null) {
    return null;
  }

  return addDaysToDateString(args.quote.created_at, validityDays);
}

function buildContractNumber() {
  const now = new Date();
  const dateKey = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
  ].join("");
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `CTR-${dateKey}-${random}`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as CreateContractFromQuoteInput | null;
    const quoteId = String(body?.quoteId || "").trim();

    if (!quoteId) {
      throw new ContractAccessError(400, "INVALID_QUOTE_ID", "quoteId nao informado.");
    }

    const scope = await resolveAuthorizedQuoteForContract(quoteId);
    const quoteMetadata = (scope.quote.metadata ?? null) as QuoteMetadata;

    const { data: existingContracts, error: existingContractsError } = await scope.supabase
      .from("sales_contracts")
      .select("*")
      .eq("organization_id", scope.organizationId)
      .eq("store_id", scope.store.id)
      .eq("quote_id", scope.quote.id);

    if (existingContractsError) {
      throw new Error(`Falha ao carregar contratos existentes: ${existingContractsError.message}`);
    }

    const hasActiveContract = ((existingContracts || []) as SalesContract[]).some((contract) => {
      const normalizedStatus = String(contract.status || "").trim().toLowerCase();
      return normalizedStatus !== "cancelled" && normalizedStatus !== "failed" && normalizedStatus !== "expired";
    });

    if (hasActiveContract) {
      throw new ContractAccessError(
        409,
        "CONTRACT_ALREADY_EXISTS",
        "Ja existe um contrato ativo vinculado a este orcamento."
      );
    }

    const contractPayload = {
      organization_id: scope.organizationId,
      store_id: scope.store.id,
      lead_id: scope.lead?.id || scope.quote.lead_id || null,
      conversation_id: scope.conversation?.id || scope.quote.conversation_id || null,
      quote_id: scope.quote.id,
      quote_version_id: scope.quoteVersion.id,
      current_version_id: null,
      contract_number: buildContractNumber(),
      status: "pending_review",
      title:
        normalizeOptionalText(scope.quote.title)
          ? `Contrato - ${String(scope.quote.title).trim()}`
          : `Contrato referente ao orcamento ${String(scope.quote.quote_number || "").trim() || scope.quote.id}`,
      customer_name: normalizeOptionalText(scope.quote.customer_name) || normalizeOptionalText(scope.lead?.name),
      customer_phone:
        normalizeOptionalText(scope.quote.customer_phone) || normalizeOptionalText(scope.lead?.phone),
      currency: "BRL",
      subtotal_cents: Number(scope.quote.subtotal_cents || 0),
      discount_cents: Number(scope.quote.discount_cents || 0),
      total_cents: Number(scope.quote.total_cents || 0),
      payment_terms: normalizeOptionalText(readMetadataValue(quoteMetadata, "payment_terms")),
      delivery_terms: normalizeOptionalText(readMetadataValue(quoteMetadata, "delivery_terms")),
      warranty_terms: normalizeOptionalText(readMetadataValue(quoteMetadata, "warranty_terms")),
      contract_terms: null,
      valid_until: resolveContractValidUntil({
        quote: scope.quote,
        quoteMetadata,
      }),
      metadata: {
        source: "quote",
        quote_number: scope.quote.quote_number,
        quote_status: scope.quote.status,
        quote_version_id: scope.quoteVersion.id,
        created_via: "api_sales_contracts_create_from_quote",
      },
    };

    const { data: createdContract, error: createContractError } = await scope.supabase
      .from("sales_contracts")
      .insert(contractPayload)
      .select("*")
      .maybeSingle();

    if (createContractError || !createdContract?.id) {
      throw new Error(createContractError?.message || "Falha ao criar sales_contracts.");
    }

    await registerContractBusinessEvent({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
      eventKey: "contrato_gerado",
      actorType: "human",
      leadId: scope.lead?.id || scope.quote.lead_id || null,
      conversationId: scope.conversation?.id || scope.quote.conversation_id || null,
      actorUserId: scope.userId,
      eventPayload: {
        contract_id: createdContract.id,
        contract_number: createdContract.contract_number,
        quote_id: scope.quote.id,
        quote_version_id: scope.quoteVersion.id,
        status: createdContract.status,
        stage: "contract_record_created",
      },
    });

    return NextResponse.json({
      ok: true,
      contract: createdContract,
    });
  } catch (error) {
    return buildErrorResponse(error);
  }
}
