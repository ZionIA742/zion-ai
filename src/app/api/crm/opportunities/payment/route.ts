import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OpportunityRow = {
  id: string;
  organization_id: string;
  store_id: string;
  lifecycle_cycle: number | null;
};

type PaymentAction =
  | "confirm_payment"
  | "settle"
  | "reopen";

type RequestBody = {
  commercialOpportunityId?: string;
  expectedLifecycleCycle?: number | null;
  action?: PaymentAction | string;
  amountCents?: number | null;
  paymentMethod?: string | null;
  notes?: string | null;
  requestId?: string | null;

  // Deliberately ignored if a client sends them.
  organizationId?: string;
  storeId?: string;
};

type PaymentProgressRow = {
  assessment_state: string;
  progress_state: string;
  resolver_key: string;
  resolver_version: number;
  authority_fingerprint: string;
  resolution_basis: Record<string, unknown> | null;
  reason_code: string;
};

type PaymentRouteDeps = {
  resolveAccess: (params: {
    requirement: "active";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  createServiceSupabaseClient: () => any;
};

function createServiceSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      "Verifique NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variaveis de ambiente.",
    );
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function buildJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function normalizeText(value: unknown, maxLength = 2000) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function normalizeRequestId(value: unknown) {
  const normalized = String(value || "").trim();

  if (
    normalized.length < 8 ||
    normalized.length > 100 ||
    !/^[A-Za-z0-9_-]+$/.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

function normalizeAction(value: unknown): PaymentAction | null {
  const normalized = String(value || "").trim().toLowerCase();

  if (
    normalized === "confirm_payment" ||
    normalized === "settle" ||
    normalized === "reopen"
  ) {
    return normalized;
  }

  return null;
}

function buildFingerprint(value: Record<string, unknown>) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

async function loadScopedOpportunity(args: {
  access: StoreApiAccessGranted;
  commercialOpportunityId: string;
}) {
  return args.access.supabase
    .from("commercial_opportunities")
    .select("id, organization_id, store_id, lifecycle_cycle")
    .eq("id", args.commercialOpportunityId)
    .eq("organization_id", args.access.organizationId)
    .eq("store_id", args.access.storeId)
    .maybeSingle<OpportunityRow>();
}

async function resolvePaymentProgress(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  commercialOpportunityId: string;
}) {
  const { data, error } = await args.supabase.rpc(
    "p9_resolve_payment_progress_internal",
    {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_commercial_opportunity_id: args.commercialOpportunityId,
    },
  );

  if (error) {
    return {
      ok: false as const,
      error,
    };
  }

  const row = Array.isArray(data)
    ? (data[0] as PaymentProgressRow | undefined)
    : (data as PaymentProgressRow | null);

  if (!row) {
    return {
      ok: false as const,
      error: new Error("PAYMENT_PROGRESS_EMPTY"),
    };
  }

  const basis =
    row.resolution_basis && typeof row.resolution_basis === "object"
      ? row.resolution_basis
      : {};

  return {
    ok: true as const,
    payment: {
      assessmentState: row.assessment_state,
      progressState: row.progress_state,
      reasonCode: row.reason_code,
      resolverKey: row.resolver_key,
      resolverVersion: row.resolver_version,
      authorityFingerprint: row.authority_fingerprint,
      confirmedAmountCents:
        typeof basis.confirmed_amount_cents === "number"
          ? basis.confirmed_amount_cents
          : 0,
      eventCount:
        typeof basis.event_count === "number"
          ? basis.event_count
          : 0,
      obligationSatisfied:
        basis.payment_obligation_satisfied === true,
      settlementEventCount:
        typeof basis.settlement_event_count === "number"
          ? basis.settlement_event_count
          : 0,
    },
  };
}

export function createPaymentGetHandler(
  deps: Partial<PaymentRouteDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const makeServiceSupabase =
    deps.createServiceSupabaseClient ?? createServiceSupabaseClient;

  return async function GET(request: Request) {
    try {
      const access = await resolveAccess({ requirement: "active" });
      if (!access.ok) return createStoreApiDeniedResponse(access);

      const requestUrl = new URL(request.url);
      const commercialOpportunityId = String(
        requestUrl.searchParams.get("commercialOpportunityId") || "",
      ).trim();

      if (!commercialOpportunityId) {
        return buildJsonResponse(
          {
            ok: false,
            error: "MISSING_COMMERCIAL_OPPORTUNITY_ID",
            message: "Selecione uma oportunidade comercial.",
          },
          400,
        );
      }

      const { data: opportunity, error: opportunityError } =
        await loadScopedOpportunity({
          access,
          commercialOpportunityId,
        });

      if (opportunityError) {
        return buildJsonResponse(
          {
            ok: false,
            error: "LOAD_PAYMENT_OPPORTUNITY_FAILED",
            message: "Nao foi possivel validar a oportunidade.",
          },
          500,
        );
      }

      if (!opportunity) {
        return buildJsonResponse(
          {
            ok: false,
            error: "COMMERCIAL_OPPORTUNITY_NOT_FOUND",
            message: "Oportunidade comercial nao encontrada.",
          },
          404,
        );
      }

      const resolution = await resolvePaymentProgress({
        supabase: makeServiceSupabase(),
        organizationId: access.organizationId,
        storeId: access.storeId,
        commercialOpportunityId: opportunity.id,
      });

      if (!resolution.ok) {
        return buildJsonResponse(
          {
            ok: false,
            error: "PAYMENT_PROGRESS_UNAVAILABLE",
            message: "Nao foi possivel carregar o estado do pagamento.",
          },
          503,
        );
      }

      return buildJsonResponse({
        ok: true,
        commercialOpportunityId: opportunity.id,
        lifecycleCycle: opportunity.lifecycle_cycle,
        payment: resolution.payment,
      });
    } catch {
      return buildJsonResponse(
        {
          ok: false,
          error: "PAYMENT_ROUTE_FAILED",
          message: "Erro interno ao carregar o pagamento.",
        },
        500,
      );
    }
  };
}

export function createPaymentPostHandler(
  deps: Partial<PaymentRouteDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;

  return async function POST(request: Request) {
    try {
      const access = await resolveAccess({ requirement: "active" });
      if (!access.ok) return createStoreApiDeniedResponse(access);

      const body = (await request.json().catch(() => null)) as RequestBody | null;

      const commercialOpportunityId = String(
        body?.commercialOpportunityId || "",
      ).trim();
      const expectedLifecycleCycle =
        Number.isInteger(body?.expectedLifecycleCycle)
          ? Number(body?.expectedLifecycleCycle)
          : null;
      const action = normalizeAction(body?.action);
      const requestId = normalizeRequestId(body?.requestId);

      if (!commercialOpportunityId) {
        return buildJsonResponse(
          {
            ok: false,
            error: "MISSING_COMMERCIAL_OPPORTUNITY_ID",
            message: "Selecione uma oportunidade comercial.",
          },
          400,
        );
      }

      if (expectedLifecycleCycle === null) {
        return buildJsonResponse(
          {
            ok: false,
            error: "MISSING_OPERATION_SNAPSHOT",
            message: "Recarregue a oportunidade antes de registrar o pagamento.",
          },
          400,
        );
      }

      if (!action) {
        return buildJsonResponse(
          {
            ok: false,
            error: "PAYMENT_ACTION_INVALID",
            message: "Acao de pagamento invalida.",
          },
          400,
        );
      }

      if (!requestId) {
        return buildJsonResponse(
          {
            ok: false,
            error: "PAYMENT_REQUEST_ID_INVALID",
            message: "Nao foi possivel identificar esta operacao de pagamento.",
          },
          400,
        );
      }

      const { data: opportunity, error: opportunityError } =
        await loadScopedOpportunity({
          access,
          commercialOpportunityId,
        });

      if (opportunityError) {
        return buildJsonResponse(
          {
            ok: false,
            error: "LOAD_PAYMENT_OPPORTUNITY_FAILED",
            message: "Nao foi possivel validar a oportunidade.",
          },
          500,
        );
      }

      if (!opportunity) {
        return buildJsonResponse(
          {
            ok: false,
            error: "COMMERCIAL_OPPORTUNITY_NOT_FOUND",
            message: "Oportunidade comercial nao encontrada.",
          },
          404,
        );
      }

      if (
        opportunity.lifecycle_cycle === null ||
        opportunity.lifecycle_cycle !== expectedLifecycleCycle
      ) {
        return buildJsonResponse(
          {
            ok: false,
            error: "PAYMENT_STATE_OUTDATED",
            message:
              "A oportunidade mudou desde que esta tela foi carregada. Recarregue e tente novamente.",
          },
          409,
        );
      }

      const notes = normalizeText(body?.notes);
      const operationKey =
        action === "confirm_payment"
          ? `crm_payment:${opportunity.id}:${expectedLifecycleCycle}:${requestId}`
          : `crm_payment_settlement:${opportunity.id}:${expectedLifecycleCycle}:${requestId}`;

      if (action === "confirm_payment") {
        const amountCents =
          Number.isInteger(body?.amountCents)
            ? Number(body?.amountCents)
            : null;

        if (amountCents === null || amountCents <= 0) {
          return buildJsonResponse(
            {
              ok: false,
              error: "PAYMENT_AMOUNT_INVALID",
              message: "Informe um valor de pagamento maior que zero.",
            },
            400,
          );
        }

        const paymentMethod = normalizeText(body?.paymentMethod, 120);

        const fingerprint = buildFingerprint({
          action,
          commercialOpportunityId: opportunity.id,
          lifecycleCycle: expectedLifecycleCycle,
          amountCents,
          paymentMethod,
          notes,
        });

        const { data, error } = await access.supabase.rpc(
          "record_commercial_opportunity_payment_by_user",
          {
            p_organization_id: access.organizationId,
            p_store_id: access.storeId,
            p_commercial_opportunity_id: opportunity.id,
            p_expected_lifecycle_cycle: expectedLifecycleCycle,
            p_operation_key: operationKey,
            p_request_fingerprint: fingerprint,
            p_event_type: "confirmation",
            p_amount_cents: amountCents,
            p_payment_method: paymentMethod,
            p_reversed_payment_event_id: null,
            p_notes: notes,
            p_metadata: {
              source: "crm_payment_action",
            },
          },
        );

        if (error) {
          const rpcMessage = String(error.message || "").trim();

          if (
            rpcMessage === "PAYMENT_LIFECYCLE_CYCLE_MISMATCH" ||
            rpcMessage === "PAYMENT_OPERATION_KEY_REUSED"
          ) {
            return buildJsonResponse(
              {
                ok: false,
                error: "PAYMENT_STATE_OUTDATED",
                message: "O estado do pagamento mudou. Recarregue e tente novamente.",
              },
              409,
            );
          }

          if (rpcMessage === "PAYMENT_MEMBERSHIP_REQUIRED") {
            return buildJsonResponse(
              {
                ok: false,
                error: "PAYMENT_FORBIDDEN",
                message: "Voce nao pode registrar pagamento nesta oportunidade.",
              },
              403,
            );
          }

          return buildJsonResponse(
            {
              ok: false,
              error: "PAYMENT_CONFIRMATION_FAILED",
              message: "Nao foi possivel registrar o pagamento agora.",
            },
            409,
          );
        }

        const row = Array.isArray(data) ? data[0] : data;

        return buildJsonResponse({
          ok: true,
          action,
          commercialOpportunityId: opportunity.id,
          lifecycleCycle: expectedLifecycleCycle,
          operationKey,
          result: row ?? null,
        });
      }

      const settlementState =
        action === "settle" ? "satisfied" : "reopened";

      const fingerprint = buildFingerprint({
        action,
        commercialOpportunityId: opportunity.id,
        lifecycleCycle: expectedLifecycleCycle,
        settlementState,
        notes,
      });

      const { data, error } = await access.supabase.rpc(
        "set_commercial_opportunity_payment_settlement_by_user",
        {
          p_organization_id: access.organizationId,
          p_store_id: access.storeId,
          p_commercial_opportunity_id: opportunity.id,
          p_expected_lifecycle_cycle: expectedLifecycleCycle,
          p_operation_key: operationKey,
          p_request_fingerprint: fingerprint,
          p_settlement_state: settlementState,
          p_notes: notes,
          p_metadata: {
            source: "crm_payment_action",
          },
        },
      );

      if (error) {
        const rpcMessage = String(error.message || "").trim();

        if (
          rpcMessage === "PAYMENT_SETTLEMENT_LIFECYCLE_CYCLE_MISMATCH" ||
          rpcMessage === "PAYMENT_SETTLEMENT_OPERATION_KEY_REUSED"
        ) {
          return buildJsonResponse(
            {
              ok: false,
              error: "PAYMENT_STATE_OUTDATED",
              message: "O estado do pagamento mudou. Recarregue e tente novamente.",
            },
            409,
          );
        }

        if (rpcMessage === "PAYMENT_SETTLEMENT_REQUIRES_CONFIRMED_AMOUNT") {
          return buildJsonResponse(
            {
              ok: false,
              error: "PAYMENT_SETTLEMENT_REQUIRES_CONFIRMED_AMOUNT",
              message:
                "Registre primeiro pelo menos um valor de pagamento confirmado.",
            },
            409,
          );
        }

        if (rpcMessage === "PAYMENT_SETTLEMENT_MEMBERSHIP_REQUIRED") {
          return buildJsonResponse(
            {
              ok: false,
              error: "PAYMENT_FORBIDDEN",
              message: "Voce nao pode alterar a quitacao desta oportunidade.",
            },
            403,
          );
        }

        return buildJsonResponse(
          {
            ok: false,
            error: "PAYMENT_SETTLEMENT_FAILED",
            message: "Nao foi possivel atualizar a quitacao agora.",
          },
          409,
        );
      }

      const row = Array.isArray(data) ? data[0] : data;

      return buildJsonResponse({
        ok: true,
        action,
        commercialOpportunityId: opportunity.id,
        lifecycleCycle: expectedLifecycleCycle,
        operationKey,
        result: row ?? null,
      });
    } catch {
      return buildJsonResponse(
        {
          ok: false,
          error: "PAYMENT_ROUTE_FAILED",
          message: "Erro interno ao atualizar o pagamento.",
        },
        500,
      );
    }
  };
}

export const GET = createPaymentGetHandler();
export const POST = createPaymentPostHandler();
