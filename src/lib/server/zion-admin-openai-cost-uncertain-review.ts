import { createClient } from "@supabase/supabase-js";

import {
  resolveZionAdminApiAccess,
  type ZionAdminApiAccessResult,
} from "./zion-admin-api-access";

export const OPENAI_COST_REVIEW_RPC =
  "zion_admin_record_uncertain_openai_cost_review_by_system";

export type OpenAiCostReviewFinding =
  | "insufficient_evidence"
  | "matching_candidates_observed"
  | "external_confirmation_required"
  | "no_financial_effect_observed";

export type OpenAiCostReviewInput = {
  operationId: string;
  reviewKey: string;
  finding: OpenAiCostReviewFinding;
  reason: string;
  evidence: Record<string, unknown>;
};

type ReviewBase = {
  operationId: string;
  reviewEventId: string;
  state: "uncertain";
  operationModified: false;
  snapshotModified: false;
  financialConfirmationPerformed: false;
  retryAuthorized: false;
  retryScheduled: false;
};

export type OpenAiCostReviewResult = ReviewBase & (
  | {
      outcome: "review_recorded";
      idempotentReplay: false;
      reviewFinding: OpenAiCostReviewFinding;
      resolution: "requires_manual_reconciliation";
    }
  | {
      outcome: "review_already_recorded";
      idempotentReplay: true;
    }
);

export type OpenAiCostReviewRpc = (
  name: typeof OPENAI_COST_REVIEW_RPC,
  parameters: {
    p_operation_id: string;
    p_review_key: string;
    p_review_finding: OpenAiCostReviewFinding;
    p_review_reason: string;
    p_review_evidence: Record<string, unknown>;
    p_actor: string;
  },
) => Promise<{
  data: unknown;
  error: {
    code?: string | null;
    message?: string | null;
  } | null;
}>;

export type OpenAiCostReviewDependencies = {
  resolveAccess?: () => Promise<ZionAdminApiAccessResult>;
  rpc?: OpenAiCostReviewRpc;
};

export type OpenAiCostReviewErrorCode =
  | "OPENAI_COST_REVIEW_INPUT_INVALID"
  | "OPENAI_COST_REVIEW_ACCESS_UNAVAILABLE"
  | "OPENAI_COST_REVIEW_ACCESS_DENIED"
  | "OPENAI_COST_REVIEW_CONFIG_MISSING"
  | "OPENAI_COST_REVIEW_UNCONFIRMED";

export class OpenAiCostReviewError extends Error {
  constructor(readonly code: OpenAiCostReviewErrorCode) {
    super(code);
    this.name = "OpenAiCostReviewError";
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FINDINGS = new Set<string>([
  "insufficient_evidence",
  "matching_candidates_observed",
  "external_confirmation_required",
  "no_financial_effect_observed",
]);

const BASE_KEYS = [
  "outcome",
  "operation_id",
  "review_event_id",
  "idempotent_replay",
  "state",
  "operation_modified",
  "snapshot_modified",
  "financial_confirmation_performed",
  "retry_authorized",
  "retry_scheduled",
] as const;

const NEW_KEYS = [
  ...BASE_KEYS,
  "review_finding",
  "resolution",
] as const;

function fail(code: OpenAiCostReviewErrorCode): never {
  throw new OpenAiCostReviewError(code);
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length &&
    keys.every((key) => expected.includes(key));
}

function validJson(
  value: unknown,
  seen: Set<object>,
  depth = 0,
): boolean {
  if (depth > 16) return false;

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.every((item) => validJson(item, seen, depth + 1));
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }

  return Object.keys(value).every(
    (key) => validJson(
      (value as Record<string, unknown>)[key],
      seen,
      depth + 1,
    ),
  );
}

function normalizeInput(
  input: OpenAiCostReviewInput,
): OpenAiCostReviewInput {
  if (
    !object(input) ||
    typeof input.operationId !== "string" ||
    !UUID.test(input.operationId) ||
    typeof input.reviewKey !== "string" ||
    input.reviewKey !== input.reviewKey.trim() ||
    [...input.reviewKey].length < 1 ||
    [...input.reviewKey].length > 128 ||
    !FINDINGS.has(input.finding) ||
    typeof input.reason !== "string" ||
    input.reason !== input.reason.trim() ||
    [...input.reason].length < 12 ||
    [...input.reason].length > 2000 ||
    !object(input.evidence) ||
    Object.keys(input.evidence).length === 0 ||
    !validJson(input.evidence, new Set<object>())
  ) {
    fail("OPENAI_COST_REVIEW_INPUT_INVALID");
  }

  let serialized: string;

  try {
    serialized = JSON.stringify(input.evidence);
  } catch {
    fail("OPENAI_COST_REVIEW_INPUT_INVALID");
  }

  if (
    !serialized ||
    Buffer.byteLength(serialized, "utf8") > 16000
  ) {
    fail("OPENAI_COST_REVIEW_INPUT_INVALID");
  }

  return {
    operationId: input.operationId.toLowerCase(),
    reviewKey: input.reviewKey,
    finding: input.finding,
    reason: input.reason,
    evidence: JSON.parse(serialized) as Record<string, unknown>,
  };
}

function validateResponse(
  value: unknown,
  input: OpenAiCostReviewInput,
): OpenAiCostReviewResult {
  if (
    !object(value) ||
    (
      value.outcome !== "review_recorded" &&
      value.outcome !== "review_already_recorded"
    ) ||
    !exactKeys(
      value,
      value.outcome === "review_recorded"
        ? NEW_KEYS
        : BASE_KEYS,
    ) ||
    value.operation_id !== input.operationId ||
    typeof value.review_event_id !== "string" ||
    !UUID.test(value.review_event_id) ||
    value.state !== "uncertain" ||
    value.operation_modified !== false ||
    value.snapshot_modified !== false ||
    value.financial_confirmation_performed !== false ||
    value.retry_authorized !== false ||
    value.retry_scheduled !== false
  ) {
    fail("OPENAI_COST_REVIEW_UNCONFIRMED");
  }

  const base: ReviewBase = {
    operationId: input.operationId,
    reviewEventId: value.review_event_id,
    state: "uncertain",
    operationModified: false,
    snapshotModified: false,
    financialConfirmationPerformed: false,
    retryAuthorized: false,
    retryScheduled: false,
  };

  if (value.outcome === "review_recorded") {
    if (
      value.idempotent_replay !== false ||
      value.review_finding !== input.finding ||
      value.resolution !== "requires_manual_reconciliation"
    ) {
      fail("OPENAI_COST_REVIEW_UNCONFIRMED");
    }

    return {
      ...base,
      outcome: "review_recorded",
      idempotentReplay: false,
      reviewFinding: input.finding,
      resolution: "requires_manual_reconciliation",
    };
  }

  if (value.idempotent_replay !== true) {
    fail("OPENAI_COST_REVIEW_UNCONFIRMED");
  }

  return {
    ...base,
    outcome: "review_already_recorded",
    idempotentReplay: true,
  };
}

function defaultRpc(): OpenAiCostReviewRpc {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    fail("OPENAI_COST_REVIEW_CONFIG_MISSING");
  }

  const supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return async (name, parameters) => {
    const response = await supabase.rpc(name, parameters);

    return {
      data: response.data,
      error: response.error,
    };
  };
}

/**
 * Records an immutable audit event for an uncertain operation.
 *
 * The actor comes exclusively from existing server-side ZION-ADM
 * authorization. Never accept p_actor from a browser payload.
 *
 * This does not settle the operation, confirm an expense, attach
 * a snapshot, schedule retries, or create an HTTP/cron entrypoint.
 * No automatic retry occurs if the RPC response is uncertain.
 */
export async function recordUncertainOpenAiCostReview(
  rawInput: OpenAiCostReviewInput,
  dependencies: OpenAiCostReviewDependencies = {},
): Promise<OpenAiCostReviewResult> {
  const input = normalizeInput(rawInput);

  let access: ZionAdminApiAccessResult;

  try {
    access = await (
      dependencies.resolveAccess ??
      (() => resolveZionAdminApiAccess({
        requiredCapability: "manage_accounts",
      }))
    )();
  } catch {
    fail("OPENAI_COST_REVIEW_ACCESS_UNAVAILABLE");
  }

  if (
    !access ||
    !access.ok ||
    access.resolution.domain !== "zion_admin" ||
    access.resolution.status !== "zion_admin_allowed" ||
    access.resolution.sessionUserId !== access.sessionUserId ||
    !UUID.test(access.sessionUserId) ||
    !access.resolution.capabilities.includes("manage_accounts")
  ) {
    fail("OPENAI_COST_REVIEW_ACCESS_DENIED");
  }

  const rpc = dependencies.rpc ?? defaultRpc();

  let response: Awaited<ReturnType<OpenAiCostReviewRpc>>;

  try {
    response = await rpc(OPENAI_COST_REVIEW_RPC, {
      p_operation_id: input.operationId,
      p_review_key: input.reviewKey,
      p_review_finding: input.finding,
      p_review_reason: input.reason,
      p_review_evidence: input.evidence,
      p_actor: access.sessionUserId,
    });
  } catch {
    fail("OPENAI_COST_REVIEW_UNCONFIRMED");
  }

  if (!response || response.error) {
    fail("OPENAI_COST_REVIEW_UNCONFIRMED");
  }

  return validateResponse(response.data, input);
}
