import { NextResponse } from "next/server";
import {
  mapCommercialActionReadinessFailure,
  refreshCommercialActionReadiness,
  type RefreshCommercialActionReadinessResult,
} from "@/lib/server/commercial-action-readiness";
import { resolveAuthorizedQuoteForContract, ContractAccessError } from "@/lib/server/sales-contracts/contract-auth";
import { registerContractBusinessEvent } from "@/lib/server/sales-contracts/contract-events";
import {
  addDaysToDateString,
  parseDateCandidate,
  parseValidityDays,
} from "@/lib/sales-quotes/validity";
import type { CreateContractFromQuoteInput, SalesContract } from "@/lib/server/sales-contracts/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QuoteMetadata = Record<string, unknown> | null;

type CreateContractFromQuoteDeps = {
  resolveQuoteForContract: typeof resolveAuthorizedQuoteForContract;
  registerBusinessEvent: typeof registerContractBusinessEvent;
  refreshActionReadiness: typeof refreshCommercialActionReadiness;
};

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

function buildReadinessGateResponse(
  result: RefreshCommercialActionReadinessResult,
) {
  const mapped = mapCommercialActionReadinessFailure(result);

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: mapped.error,
        message: "Nao foi possivel validar a prontidao da criacao do contrato agora.",
      },
      { status: mapped.status },
    );
  }

  return NextResponse.json(
    {
      ok: false,
      error: mapped.error,
      message: "A criacao do contrato ainda nao esta pronta para execucao.",
      actionKey: result.decision.actionKey,
      readinessState: result.decision.readinessState,
      reasonCode: result.decision.reasonCode,
      blockingItems: result.decision.blockingItems,
      authorityFingerprint: result.decision.authorityFingerprint,
    },
    { status: mapped.status },
  );
}

export function createCreateContractFromQuotePostHandler(
  deps: Partial<CreateContractFromQuoteDeps> = {},
) {
  const resolveQuoteForContract =
    deps.resolveQuoteForContract ?? resolveAuthorizedQuoteForContract;
  const registerBusinessEvent =
    deps.registerBusinessEvent ?? registerContractBusinessEvent;
  const refreshActionReadiness =
    deps.refreshActionReadiness ?? refreshCommercialActionReadiness;

  return async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as CreateContractFromQuoteInput | null;
    const quoteId = String(body?.quoteId || "").trim();

    if (!quoteId) {
      throw new ContractAccessError(400, "INVALID_QUOTE_ID", "quoteId nao informado.");
    }

    const scope = await resolveQuoteForContract(quoteId);
    const quoteMetadata = (scope.quote.metadata ?? null) as QuoteMetadata;
    const commercialOpportunityId =
      String(scope.quote.commercial_opportunity_id || "").trim() || null;

    if (!commercialOpportunityId) {
      return NextResponse.json(
        {
          ok: false,
          error: "QUOTE_COMMERCIAL_OPPORTUNITY_REQUIRED_FOR_CONTRACT",
          message:
            "Este orcamento precisa de commercial_opportunity_id explicita para gerar contrato.",
        },
        { status: 409 },
      );
    }

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

    const readiness = await refreshActionReadiness({
      supabase: scope.supabase,
      organizationId: scope.organizationId,
      storeId: scope.store.id,
      commercialOpportunityId,
      actionKey: "create_contract",
    });

    if (!readiness.ok || readiness.decision.readinessState !== "ready") {
      return buildReadinessGateResponse(readiness);
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
        commercial_opportunity_id: commercialOpportunityId,
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

    await registerBusinessEvent({
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
        commercial_opportunity_id: commercialOpportunityId,
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
  };
}

export const POST = createCreateContractFromQuotePostHandler();
