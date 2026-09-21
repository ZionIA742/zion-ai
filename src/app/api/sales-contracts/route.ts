import { NextResponse } from "next/server";
import { authenticateContractRequest, ContractAccessError } from "@/lib/server/sales-contracts/contract-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LeadScopeRow = {
  id: string;
  organization_id: string;
  store_id: string | null;
};

type CommercialOpportunityScopeRow = {
  id: string;
  organization_id: string;
  store_id: string;
  origin_lead_id: string | null;
};

type QuoteScopeRow = {
  id: string;
};

function buildJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export function createSalesContractsListGetHandler(deps?: {
  authenticateContractRequest?: typeof authenticateContractRequest;
}) {
  const resolveAuth = deps?.authenticateContractRequest ?? authenticateContractRequest;

  return async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const leadId = String(url.searchParams.get("leadId") || "").trim();
    const conversationId = String(url.searchParams.get("conversationId") || "").trim();
    const quoteId = String(url.searchParams.get("quoteId") || "").trim();
    const storeId = String(url.searchParams.get("storeId") || "").trim();
    const organizationId = String(url.searchParams.get("organizationId") || "").trim();
    const commercialOpportunityId = String(
      url.searchParams.get("commercialOpportunityId") || ""
    ).trim();

    const auth = await resolveAuth();

    let validatedLead: LeadScopeRow | null = null;
    let validatedOpportunity: CommercialOpportunityScopeRow | null = null;
    let scopedQuoteIds: string[] | null = null;

    if (commercialOpportunityId) {
      if (!leadId) {
        throw new ContractAccessError(
          400,
          "MISSING_LEAD_ID_FOR_COMMERCIAL_OPPORTUNITY",
          "Lead ID nao informado para validar a opportunity comercial."
        );
      }

      const { data: lead, error: leadError } = await auth.supabase
        .from("leads")
        .select("id, organization_id, store_id")
        .eq("id", leadId)
        .in("organization_id", auth.organizationIds)
        .maybeSingle<LeadScopeRow>();

      if (leadError) {
        throw new ContractAccessError(500, "LOAD_LEAD_FAILED", leadError.message);
      }

      if (!lead) {
        throw new ContractAccessError(
          404,
          "LEAD_NOT_FOUND",
          "Lead nao encontrada ou fora do escopo do usuario."
        );
      }

      const leadStoreId = String(lead.store_id || "").trim();

      if (!leadStoreId) {
        throw new ContractAccessError(
          403,
          "LEAD_STORE_REQUIRED_FOR_COMMERCIAL_OPPORTUNITY",
          "A lead informada nao possui loja para validar a opportunity."
        );
      }

      if (storeId && storeId !== leadStoreId) {
        throw new ContractAccessError(
          403,
          "CONTRACT_OPPORTUNITY_SCOPE_MISMATCH",
          "A loja informada nao pertence a lead da opportunity."
        );
      }

      if (organizationId && organizationId !== lead.organization_id) {
        throw new ContractAccessError(
          403,
          "CONTRACT_OPPORTUNITY_SCOPE_MISMATCH",
          "A organizacao informada nao pertence a lead da opportunity."
        );
      }

      const { data: store, error: storeError } = await auth.supabase
        .from("stores")
        .select("id, organization_id")
        .eq("id", leadStoreId)
        .eq("organization_id", lead.organization_id)
        .in("organization_id", auth.organizationIds)
        .maybeSingle<{ id: string; organization_id: string }>();

      if (storeError) {
        throw new ContractAccessError(500, "LOAD_STORE_FAILED", storeError.message);
      }

      if (!store) {
        throw new ContractAccessError(
          403,
          "STORE_SCOPE_INVALID",
          "A lead informada pertence a uma loja fora do escopo autorizado."
        );
      }

      const { data: opportunity, error: opportunityError } = await auth.supabase
        .from("commercial_opportunities")
        .select("id, organization_id, store_id, origin_lead_id")
        .eq("id", commercialOpportunityId)
        .eq("organization_id", lead.organization_id)
        .eq("store_id", leadStoreId)
        .eq("origin_lead_id", lead.id)
        .maybeSingle<CommercialOpportunityScopeRow>();

      if (opportunityError) {
        throw new ContractAccessError(
          500,
          "LOAD_COMMERCIAL_OPPORTUNITY_FAILED",
          opportunityError.message
        );
      }

      if (!opportunity) {
        throw new ContractAccessError(
          403,
          "COMMERCIAL_OPPORTUNITY_NOT_FOUND_OR_FORBIDDEN",
          "Opportunity comercial nao encontrada no escopo da lead."
        );
      }

      const { data: quoteRows, error: quoteRowsError } = await auth.supabase
        .from("sales_quotes")
        .select("id")
        .eq("organization_id", opportunity.organization_id)
        .eq("store_id", opportunity.store_id)
        .eq("lead_id", lead.id)
        .eq("commercial_opportunity_id", opportunity.id);

      if (quoteRowsError) {
        throw new ContractAccessError(
          500,
          "LOAD_OPPORTUNITY_QUOTES_FAILED",
          quoteRowsError.message
        );
      }

      validatedLead = lead;
      validatedOpportunity = opportunity;
      scopedQuoteIds = Array.isArray(quoteRows)
        ? quoteRows
            .map((row) => String((row as QuoteScopeRow).id || "").trim())
            .filter(Boolean)
        : [];
    }

    let query = auth.supabase
      .from("sales_contracts")
      .select("*")
      .in("organization_id", auth.organizationIds)
      .order("created_at", { ascending: false });

    if (validatedLead && validatedOpportunity) {
      query = query
        .eq("organization_id", validatedOpportunity.organization_id)
        .eq("store_id", validatedOpportunity.store_id)
        .eq("lead_id", validatedLead.id);

      if (scopedQuoteIds && scopedQuoteIds.length > 0) {
        query = query.in("quote_id", scopedQuoteIds);
      } else {
        return buildJsonResponse({
          ok: true,
          leadId: validatedLead.id,
          commercialOpportunityId: validatedOpportunity.id,
          organizationId: validatedOpportunity.organization_id,
          storeId: validatedOpportunity.store_id,
          contracts: [],
        });
      }
    }

    if (leadId) {
      query = query.eq("lead_id", leadId);
    }

    if (conversationId) {
      query = query.eq("conversation_id", conversationId);
    }

    if (quoteId) {
      query = query.eq("quote_id", quoteId);
    }

    if (storeId) {
      query = query.eq("store_id", storeId);
    }

    if (organizationId) {
      if (!auth.organizationIds.includes(organizationId)) {
        throw new ContractAccessError(
          403,
          "FORBIDDEN_ORGANIZATION",
          "Voce nao pode acessar contratos desta organizacao."
        );
      }

      query = query.eq("organization_id", organizationId);
    }

    const { data, error } = await query;

    if (error) {
      throw new ContractAccessError(500, "LOAD_CONTRACTS_FAILED", error.message);
    }

    const contracts = Array.isArray(data)
      ? data.map((contract) => ({
          id: contract.id,
          contract_number: contract.contract_number || null,
          status: contract.status || null,
          title: contract.title || null,
          total_cents:
            typeof contract.total_cents === "number" ? contract.total_cents : null,
          current_version_id: contract.current_version_id || null,
          quote_id: contract.quote_id || null,
          quote_version_id: contract.quote_version_id || null,
          sent_at: contract.sent_at || null,
          customer_signed_at: contract.customer_signed_at || null,
          store_signed_at: contract.store_signed_at || null,
          completed_at: contract.completed_at || null,
          created_at: contract.created_at || null,
        }))
      : [];

    return buildJsonResponse({
      ok: true,
      leadId: validatedLead?.id ?? (leadId || null),
      commercialOpportunityId: validatedOpportunity?.id ?? null,
      organizationId: validatedOpportunity?.organization_id ?? (organizationId || null),
      storeId: validatedOpportunity?.store_id ?? (storeId || null),
      contracts,
    });
  } catch (error) {
    if (error instanceof ContractAccessError) {
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
        error: "SALES_CONTRACTS_LIST_FAILED",
        message: error instanceof Error ? error.message : "Erro interno ao listar contratos.",
      },
      500
    );
  }
  };
}

export const GET = createSalesContractsListGetHandler();
