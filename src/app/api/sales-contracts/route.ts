import { NextResponse } from "next/server";
import { authenticateContractRequest, ContractAccessError } from "@/lib/server/sales-contracts/contract-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const leadId = String(url.searchParams.get("leadId") || "").trim();
    const conversationId = String(url.searchParams.get("conversationId") || "").trim();
    const quoteId = String(url.searchParams.get("quoteId") || "").trim();
    const storeId = String(url.searchParams.get("storeId") || "").trim();
    const organizationId = String(url.searchParams.get("organizationId") || "").trim();

    const auth = await authenticateContractRequest();

    let query = auth.supabase
      .from("sales_contracts")
      .select("*")
      .in("organization_id", auth.organizationIds)
      .order("created_at", { ascending: false });

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
}
