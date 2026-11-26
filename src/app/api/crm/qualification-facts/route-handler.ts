import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FACT_KEYS = new Set([
  "need_summary",
  "interested_product_reference",
  "space_text",
  "requested_area_m2",
  "location_text",
  "preferred_period_text",
  "budget_text",
  "decision_context",
  "installation_interest",
  "payment_interest",
  "technical_visit_interest",
  "customer_preferences_text",
  "relevant_objection_text",
]);

const BOOLEAN_FACT_KEYS = new Set([
  "installation_interest",
  "payment_interest",
  "technical_visit_interest",
]);

const NUMBER_FACT_KEYS = new Set(["requested_area_m2"]);

type RouteDeps = {
  resolveAccess: (params: {
    requirement: "active";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
};

type FactRow = {
  factKey?: string | null;
  state?: string | null;
  value?: unknown;
  valueKind?: string | null;
  lastEventId?: string | null;
};

type FactsSnapshot = {
  organization_id?: string | null;
  store_id?: string | null;
  commercial_opportunity_id?: string | null;
  known_facts?: FactRow[] | null;
  conflicts?: FactRow[] | null;
};

type SupabasePostgrestError = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeDiagnosticText(value: unknown) {
  const normalized = typeof value === "string" ? value : String(value ?? "");
  return normalized
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[JWT_REDACTED]")
    .replace(/([?&](?:access_token|refresh_token|apikey|api_key|token|secret)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 2000);
}

function captureUnexpectedSupabaseError(args: {
  correlationId: string;
  operation: "read" | "write" | "request";
  error: SupabasePostgrestError | unknown;
}) {
  const error = args.error && typeof args.error === "object"
    ? args.error as SupabasePostgrestError
    : {};

  console.error("[qualification-facts] unexpected Supabase/PostgREST error", {
    correlationId: args.correlationId,
    operation: args.operation,
    code: sanitizeDiagnosticText(error.code),
    message: sanitizeDiagnosticText(error.message),
    details: sanitizeDiagnosticText(error.details),
    hint: sanitizeDiagnosticText(error.hint),
  });
}

function isSafeClientError(error: unknown): error is Error {
  return error instanceof Error && new Set([
    "INVALID_BOOLEAN_FACT",
    "INVALID_NUMBER_FACT",
    "INVALID_TEXT_FACT",
  ]).has(error.message);
}

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function normalizeValue(factKey: string, value: unknown) {
  if (BOOLEAN_FACT_KEYS.has(factKey)) {
    if (typeof value !== "boolean") throw new Error("INVALID_BOOLEAN_FACT");
    return value;
  }

  if (NUMBER_FACT_KEYS.has(factKey)) {
    const number = typeof value === "number" ? value : Number(text(value));
    if (!Number.isFinite(number) || number < 0) throw new Error("INVALID_NUMBER_FACT");
    return number;
  }

  const normalized = text(value);
  if (!normalized || normalized.length > 2000) throw new Error("INVALID_TEXT_FACT");
  return normalized;
}

function currentFact(snapshot: FactsSnapshot | null, factKey: string) {
  const conflict = (snapshot?.conflicts || []).find((fact) => fact.factKey === factKey);
  if (conflict) return conflict;
  return (snapshot?.known_facts || []).find((fact) => fact.factKey === factKey) || null;
}

export function createQualificationFactsPostHandler(
  deps: RouteDeps = { resolveAccess: resolveStoreApiAccess },
) {
  return async function POST(request: Request) {
    const correlationId = randomUUID();
    try {
      const access = await deps.resolveAccess({ requirement: "active" });
      if (!access.ok) return createStoreApiDeniedResponse(access);

      const body = (await request.json()) as Record<string, unknown>;
      const leadId = text(body.leadId);
      const opportunityId = text(body.commercialOpportunityId);
      const factKey = text(body.factKey);
      const expectedLastEventId = text(body.expectedLastEventId) || null;
      const operationKey = text(body.operationKey);

      if (!leadId || !opportunityId || !factKey || !operationKey) {
        return response({ ok: false, error: "QUALIFICATION_FACT_INPUT_REQUIRED" }, 400);
      }
      if (!FACT_KEYS.has(factKey)) {
        return response({ ok: false, error: "QUALIFICATION_FACT_KEY_NOT_ALLOWED" }, 400);
      }

      const { data: lead, error: leadError } = await access.supabase
        .from("leads")
        .select("id, organization_id, store_id")
        .eq("id", leadId)
        .eq("organization_id", access.organizationId)
        .eq("store_id", access.storeId)
        .maybeSingle();
      if (leadError || !lead) return response({ ok: false, error: "LEAD_SCOPE_INVALID" }, 403);

      const { data: opportunity, error: opportunityError } = await access.supabase
        .from("commercial_opportunities")
        .select("id, organization_id, store_id, origin_lead_id")
        .eq("id", opportunityId)
        .eq("organization_id", access.organizationId)
        .eq("store_id", access.storeId)
        .eq("origin_lead_id", leadId)
        .maybeSingle();
      if (opportunityError || !opportunity) {
        return response({ ok: false, error: "OPPORTUNITY_SCOPE_INVALID" }, 403);
      }

      const { data: factsData, error: factsError } = await access.supabase.rpc(
        "read_commercial_opportunity_qualification_facts_by_user",
        {
          p_request_organization_id: access.organizationId,
          p_store_id: access.storeId,
          p_commercial_opportunity_id: opportunityId,
        },
      );
      if (factsError) {
        captureUnexpectedSupabaseError({ correlationId, operation: "read", error: factsError });
        return response({ ok: false, error: "QUALIFICATION_FACT_READ_FAILED", correlationId }, 503);
      }

      const snapshot = (Array.isArray(factsData) ? factsData[0] : factsData) as FactsSnapshot | null;
      if (
        snapshot?.organization_id !== access.organizationId ||
        snapshot?.store_id !== access.storeId ||
        snapshot?.commercial_opportunity_id !== opportunityId
      ) {
        return response({ ok: false, error: "QUALIFICATION_FACT_SCOPE_INVALID" }, 403);
      }

      const existing = currentFact(snapshot, factKey);
      const currentLastEventId = text(existing?.lastEventId) || null;
      if (currentLastEventId !== expectedLastEventId) {
        return response({
          ok: false,
          error: "QUALIFICATION_FACT_STALE",
          currentLastEventId,
        }, 409);
      }

      const normalized = normalizeValue(factKey, body.value);
      const resolvesConflict = body.resolvesConflict === true;
      if (resolvesConflict && !snapshot?.conflicts?.some((fact) => fact.factKey === factKey)) {
        return response({ ok: false, error: "QUALIFICATION_FACT_NO_CONFLICT" }, 409);
      }

      const { data: writeData, error: writeError } = await access.supabase.rpc(
        "write_commercial_qualification_fact_by_user_if_current",
        {
          p_request_organization_id: access.organizationId,
          p_store_id: access.storeId,
          p_commercial_opportunity_id: opportunityId,
          p_operation_key: operationKey,
          p_fact_key: factKey,
          p_value_json: normalized,
          p_expected_last_event_id: expectedLastEventId,
          p_source_message_id: null,
          p_source_conversation_id: null,
          p_resolves_conflict: resolvesConflict,
        },
      );
      if (writeError) {
        const message = String(writeError.message || "");
        if (message.includes("ZION_QFACT_EXPECTED_REVISION_MISMATCH")) {
          return response({ ok: false, error: "QUALIFICATION_FACT_STALE" }, 409);
        }
        if (message.includes("IDEMPOTENCY_KEY_REUSED")) {
          return response({ ok: false, error: "QUALIFICATION_FACT_OPERATION_REUSED" }, 409);
        }
        captureUnexpectedSupabaseError({ correlationId, operation: "write", error: writeError });
        return response({ ok: false, error: "QUALIFICATION_FACT_WRITE_FAILED", correlationId }, 409);
      }

      return response({
        ok: true,
        opportunityId,
        factKey,
        result: Array.isArray(writeData) ? writeData[0] || null : writeData,
      });
    } catch (error) {
      if (isSafeClientError(error)) {
        return response({ ok: false, error: error.message }, 400);
      }
      captureUnexpectedSupabaseError({ correlationId, operation: "request", error });
      return response({
        ok: false,
        error: "QUALIFICATION_FACT_REQUEST_FAILED",
        correlationId,
      }, 500);
    }
  };
}

const handler = createQualificationFactsPostHandler();
export const POST = handler;
