import { NextResponse } from "next/server";
import {
  ContractAccessError,
  resolveQuoteForContractForAuthorizedStoreScope,
} from "@/lib/server/sales-contracts/contract-auth";
import type { CreateContractFromQuoteInput } from "@/lib/server/sales-contracts/types";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateContractFromQuoteDeps = {
  resolveAccess: (params: {
    requirement: "active";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  resolveQuoteForContract: typeof resolveQuoteForContractForAuthorizedStoreScope;
};

type ContractWriterOutcome = "created" | "already_exists";

type ContractWriterRow = {
  outcome?: unknown;
  contract_id?: unknown;
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

const CONTRACT_WRITER_CONFLICT_CODES = new Set([
  "ZION_CONTRACT_CREATE_PROPOSAL_STALE",
  "ZION_CONTRACT_CREATE_ACCEPTANCE_NOT_CURRENT",
  "ZION_CONTRACT_CREATE_READINESS_NOT_READY",
  "ZION_CONTRACT_CREATE_READINESS_LINEAGE_MISMATCH",
  "ZION_CONTRACT_CREATE_DUPLICATE_ACTIVE_LINEAGE_CONFLICT",
]);

function extractRpcErrorCode(error: { message?: string | null; details?: string | null; hint?: string | null; code?: string | null }) {
  const candidates = [error.message, error.details, error.hint, error.code];
  for (const candidate of candidates) {
    const value = String(candidate || "");
    const match = value.match(/ZION_CONTRACT_CREATE_[A-Z0-9_]+/);
    if (match) return match[0];
  }
  return null;
}

function translateContractWriterError(error: { message?: string | null; details?: string | null; hint?: string | null; code?: string | null }) {
  const canonicalCode = extractRpcErrorCode(error);
  if (canonicalCode && CONTRACT_WRITER_CONFLICT_CODES.has(canonicalCode)) {
    throw new ContractAccessError(
      409,
      canonicalCode,
      error.message || "Criacao de contrato recusada pelo writer canonico."
    );
  }

  throw new Error(error.message || "Falha ao criar contrato pelo writer canonico.");
}

function normalizeContractWriterRow(data: unknown): {
  outcome: ContractWriterOutcome;
  contractId: string;
} {
  const row = Array.isArray(data) ? data[0] : data;
  const outcome = String((row as ContractWriterRow | null)?.outcome || "").trim();
  const contractId = String((row as ContractWriterRow | null)?.contract_id || "").trim();

  if ((outcome !== "created" && outcome !== "already_exists") || !contractId) {
    throw new Error("Writer canonico retornou resultado invalido para criacao de contrato.");
  }

  return { outcome, contractId };
}

export function createCreateContractFromQuotePostHandler(
  deps: Partial<CreateContractFromQuoteDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const resolveQuoteForContract =
    deps.resolveQuoteForContract ?? resolveQuoteForContractForAuthorizedStoreScope;

  return async function POST(request: Request) {
    try {
      const access = await resolveAccess({ requirement: "active" });
      if (!access.ok) return createStoreApiDeniedResponse(access);

      const body = (await request.json().catch(() => null)) as CreateContractFromQuoteInput | null;
      const quoteId = String(body?.quoteId || "").trim();
      const quoteVersionId = String(body?.quoteVersionId || "").trim();

    if (!quoteId) {
      throw new ContractAccessError(400, "INVALID_QUOTE_ID", "quoteId nao informado.");
    }

    if (!quoteVersionId) {
      throw new ContractAccessError(
        400,
        "INVALID_QUOTE_VERSION_ID",
        "quoteVersionId nao informado para criar contrato."
      );
    }

      const scope = await resolveQuoteForContract(quoteId, quoteVersionId, {
        organizationId: access.organizationId,
        storeId: access.storeId,
        sessionUserId: access.sessionUserId,
      });

      if (
        scope.organizationId !== access.organizationId ||
        scope.store.id !== access.storeId ||
        scope.store.organization_id !== access.organizationId ||
        scope.quote.organization_id !== access.organizationId ||
        scope.quote.store_id !== access.storeId ||
        scope.quote.id !== quoteId ||
        scope.quoteVersion.id !== quoteVersionId ||
        (scope.quoteVersion.quote_id !== undefined && scope.quoteVersion.quote_id !== scope.quote.id) ||
        (scope.quoteVersion.organization_id !== undefined && scope.quoteVersion.organization_id !== access.organizationId) ||
        (scope.quoteVersion.store_id !== undefined && scope.quoteVersion.store_id !== access.storeId)
      ) {
        throw new ContractAccessError(
          403,
          "CONTRACT_SCOPE_MISMATCH",
          "O escopo retornado esta fora da autoridade canonica autorizada.",
        );
      }
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

    const contractNumber = buildContractNumber();
    const { data: writerData, error: writerError } = await scope.supabase.rpc(
      "create_sales_contract_with_current_acceptance_event_by_system",
      {
        p_organization_id: access.organizationId,
        p_store_id: access.storeId,
        p_commercial_opportunity_id: commercialOpportunityId,
        p_quote_id: scope.quote.id,
        p_quote_version_id: scope.quoteVersion.id,
        p_contract_number: contractNumber,
        p_actor_user_id: access.sessionUserId,
      },
    );

    if (writerError) {
      translateContractWriterError(writerError);
    }

    const writerResult = normalizeContractWriterRow(writerData);

    const { data: contract, error: contractError } = await scope.supabase
      .from("sales_contracts")
      .select("*")
      .eq("id", writerResult.contractId)
      .eq("organization_id", access.organizationId)
      .eq("store_id", access.storeId)
      .maybeSingle();

      if (contractError) {
        throw new Error(contractError.message);
      }

      if (
        !contract?.id ||
        contract.id !== writerResult.contractId ||
        (contract.organization_id !== undefined && contract.organization_id !== access.organizationId) ||
        (contract.store_id !== undefined && contract.store_id !== access.storeId)
      ) {
        throw new ContractAccessError(
          403,
          "CONTRACT_SCOPE_MISMATCH",
          "O contrato criado esta fora do escopo canonico autorizado.",
        );
    }

    return NextResponse.json({
      ok: true,
      contract,
    });
    } catch (error) {
      return buildErrorResponse(error);
    }
  };
}

export const POST = createCreateContractFromQuotePostHandler();
