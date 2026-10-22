import { NextResponse } from "next/server";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";
import { createServiceSupabaseClient } from "@/lib/server/zion-account-provisioning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REVIEW_RPC = "record_i8_whatsapp_uncertain_review_by_system";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVIEW_ACTIONS = new Set([
  "investigating",
  "inconclusive",
  "escalated",
  "reference_unverified",
]);
const EVIDENCE_KINDS = new Set([
  "none",
  "internal_observation",
  "provider_reference_unverified",
  "customer_report",
]);

type ReviewBody = {
  operation_key?: unknown;
  review_action?: unknown;
  evidence_kind?: unknown;
  evidence_reference?: unknown;
  review_note?: unknown;
};

type ReviewResult = {
  review_id: string;
  result: "recorded" | "already_recorded";
  outbound_delivery_state: string | null;
  message_state_changed: boolean;
  message_retried: boolean;
};

type ReviewRpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: { message?: string | null; code?: string | null } | null;
  }>;
};

type RouteDeps = {
  resolveAccess: (params: {
    requirement: "active";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  createServiceClient: () => ReviewRpcClient;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function invalidField(field: string) {
  return json(
    { ok: false, error: "INVALID_REVIEW_INPUT", field },
    400,
  );
}

function optionalText(value: unknown) {
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value.trim() : "";
}

function parseReviewBody(body: ReviewBody | null) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false as const, response: json({ ok: false, error: "INVALID_REVIEW_BODY" }, 400) };
  }

  const values = {
    operationKey: text(body.operation_key),
    reviewAction: text(body.review_action),
    evidenceKind: body.evidence_kind === undefined ? "none" : text(body.evidence_kind),
    evidenceReference: optionalText(body.evidence_reference),
    reviewNote: optionalText(body.review_note),
  };

  if (!UUID_RE.test(values.operationKey)) {
    return { ok: false as const, response: invalidField("operation_key") };
  }
  if (!REVIEW_ACTIONS.has(values.reviewAction)) {
    return { ok: false as const, response: invalidField("review_action") };
  }
  if (!EVIDENCE_KINDS.has(values.evidenceKind)) {
    return { ok: false as const, response: invalidField("evidence_kind") };
  }
  if (body.evidence_reference !== undefined && body.evidence_reference !== null && typeof body.evidence_reference !== "string") {
    return { ok: false as const, response: invalidField("evidence_reference") };
  }
  if (body.review_note !== undefined && body.review_note !== null && typeof body.review_note !== "string") {
    return { ok: false as const, response: invalidField("review_note") };
  }
  if (values.evidenceReference !== null && values.evidenceReference.length > 512) {
    return { ok: false as const, response: invalidField("evidence_reference") };
  }
  if (values.reviewNote !== null && values.reviewNote.length > 1500) {
    return { ok: false as const, response: invalidField("review_note") };
  }

  return { ok: true as const, values };
}

function normalizeRpcResult(data: unknown): ReviewResult | null {
  const row = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data;
  if (!row || typeof row !== "object") return null;
  const value = row as Record<string, unknown>;
  const result = text(value.result);
  const reviewId = text(value.review_id);
  if (
    !UUID_RE.test(reviewId) ||
    (result !== "recorded" && result !== "already_recorded") ||
    typeof value.message_state_changed !== "boolean" ||
    typeof value.message_retried !== "boolean"
  ) {
    return null;
  }
  return {
    review_id: reviewId,
    result,
    outbound_delivery_state: text(value.outbound_delivery_state) || null,
    message_state_changed: value.message_state_changed,
    message_retried: value.message_retried,
  };
}

function createHandler(deps: RouteDeps) {
  return async function POST(
    request: Request,
    context: { params: Promise<{ messageId: string }> },
  ) {
    const access = await deps.resolveAccess({ requirement: "active" });
    if (!access.ok) return createStoreApiDeniedResponse(access);

    const { messageId: rawMessageId } = await context.params;
    const messageId = text(rawMessageId);
    if (!UUID_RE.test(messageId)) {
      return json({ ok: false, error: "INVALID_MESSAGE_ID" }, 400);
    }

    const parsed = parseReviewBody(
      (await request.json().catch(() => null)) as ReviewBody | null,
    );
    if (!parsed.ok) return parsed.response;

    try {
      const result = await deps.createServiceClient().rpc(REVIEW_RPC, {
        p_organization_id: access.organizationId,
        p_store_id: access.storeId,
        p_message_id: messageId,
        p_actor_user_id: access.sessionUserId,
        p_operation_key: parsed.values.operationKey,
        p_review_action: parsed.values.reviewAction,
        p_evidence_kind: parsed.values.evidenceKind,
        p_evidence_reference: parsed.values.evidenceReference,
        p_review_note: parsed.values.reviewNote,
      });

      if (result.error) {
        return json(
          { ok: false, error: "UNCERTAIN_REVIEW_REJECTED", message: result.error.message || "A revisao nao foi registrada." },
          409,
        );
      }

      const review = normalizeRpcResult(result.data);
      if (!review) {
        return json({ ok: false, error: "UNCERTAIN_REVIEW_INVALID_RESULT" }, 502);
      }

      return json({
        ok: true,
        review,
        messageWasNotRetried: review.message_retried === false,
      });
    } catch {
      return json({ ok: false, error: "UNCERTAIN_REVIEW_FAILED" }, 500);
    }
  };
}

export const POST = createHandler({
  resolveAccess: resolveStoreApiAccess,
  createServiceClient: createServiceSupabaseClient,
});

export { createHandler, normalizeRpcResult, parseReviewBody };
