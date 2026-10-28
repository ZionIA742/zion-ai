import type {
  OpenAiCostExecutionGateOutcome,
} from "./zion-admin-openai-cost-execution-gate";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FLAG =
  "ZION_ADMIN_OPENAI_COST_MANUAL_TARGETED_ENABLED";

export type OpenAiCostManualTargetedHandlerOptions = {
  run: (operationId: string) =>
    Promise<OpenAiCostExecutionGateOutcome>;
  isEnabled?: () => boolean;
};

function json(
  body: Record<string, unknown>,
  status: number,
): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function reject(status: number, code: string): Response {
  return json({ ok: false, code }, status);
}

function trustedOrigin(request: Request): boolean {
  try {
    const expected = new URL(request.url).origin;
    const origin = request.headers.get("origin");
    const site = request.headers.get("sec-fetch-site");

    return origin === expected &&
      (site === null || site === "same-origin");
  } catch {
    return false;
  }
}

function validatedOperationId(
  body: unknown,
): string | null {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return null;
  }

  const value = body as Record<string, unknown>;
  const keys = Object.keys(value).sort();

  if (
    keys.length !== 2 ||
    keys[0] !== "confirmation" ||
    keys[1] !== "operationId" ||
    typeof value.operationId !== "string" ||
    !UUID.test(value.operationId)
  ) {
    return null;
  }

  const operationId = value.operationId.toLowerCase();

  if (
    value.confirmation !==
    `EXECUTAR_COLETA_OPENAI:${operationId}`
  ) {
    return null;
  }

  return operationId;
}

function resultStatus(
  outcome: OpenAiCostExecutionGateOutcome,
): number {
  switch (outcome.status) {
    case "confirmed":
    case "no_work":
      return 200;
    case "input_invalid":
      return 400;
    case "access_denied":
    case "identity_not_allowlisted":
      return 403;
    case "failures_recorded":
    case "requires_review":
      return 409;
    default:
      return 503;
  }
}

/**
 * Reusable manual execution for a prepared operation.
 *
 * No preparation, scheduling, retry or reconciliation.
 * The injected runner must enforce administrator access,
 * financial flags, capability and operator allowlist.
 */
export function createOpenAiCostManualTargetedHandler(
  options: OpenAiCostManualTargetedHandlerOptions,
) {
  return async (request: Request): Promise<Response> => {
    let enabled = false;

    try {
      enabled = options.isEnabled?.() ??
        (process.env[FLAG] === "true");
    } catch {
      enabled = false;
    }

    if (!enabled) {
      return reject(
        503,
        "OPENAI_COST_MANUAL_TARGETED_DISABLED",
      );
    }

    if (request.method !== "POST") {
      return reject(
        405,
        "OPENAI_COST_MANUAL_TARGETED_METHOD_INVALID",
      );
    }

    if (!trustedOrigin(request)) {
      return reject(
        403,
        "OPENAI_COST_MANUAL_TARGETED_ORIGIN_DENIED",
      );
    }

    const mediaType = (
      request.headers.get("content-type") ?? ""
    ).split(";")[0].trim().toLowerCase();

    if (mediaType !== "application/json") {
      return reject(
        415,
        "OPENAI_COST_MANUAL_TARGETED_MEDIA_INVALID",
      );
    }

    const length = request.headers.get("content-length");

    if (
      length !== null &&
      (!/^\d+$/.test(length) || Number(length) > 512)
    ) {
      return reject(
        413,
        "OPENAI_COST_MANUAL_TARGETED_BODY_TOO_LARGE",
      );
    }

    let body: unknown;

    try {
      const raw = await request.text();

      if (Buffer.byteLength(raw, "utf8") > 512) {
        return reject(
          413,
          "OPENAI_COST_MANUAL_TARGETED_BODY_TOO_LARGE",
        );
      }

      body = JSON.parse(raw);
    } catch {
      return reject(
        400,
        "OPENAI_COST_MANUAL_TARGETED_BODY_INVALID",
      );
    }

    const operationId = validatedOperationId(body);

    if (!operationId) {
      return reject(
        400,
        "OPENAI_COST_MANUAL_TARGETED_TARGET_INVALID",
      );
    }

    let outcome: OpenAiCostExecutionGateOutcome;

    try {
      outcome = await options.run(operationId);
    } catch {
      // Claim may already have committed. Never retry here.
      return reject(
        503,
        "OPENAI_COST_EXECUTION_UNCONFIRMED",
      );
    }

    if (
      !outcome ||
      typeof outcome !== "object" ||
      typeof outcome.status !== "string" ||
      typeof outcome.ok !== "boolean"
    ) {
      return reject(
        503,
        "OPENAI_COST_EXECUTION_RESULT_INVALID",
      );
    }

    return json({
      ...outcome,
      operationId,
    }, resultStatus(outcome));
  };
}