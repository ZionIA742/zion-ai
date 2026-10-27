import type {
  OpenAiCostExecutionGateOutcome,
} from "./zion-admin-openai-cost-execution-gate";

export const FIRST_OPENAI_COST_OPERATION_ID =
  "2a776f83-1282-4ce0-9482-30e85f6a422a";

export const FIRST_OPENAI_COST_CONFIRMATION =
  "EXECUTAR_COLETA_OPENAI_2026_10_25";

export type FirstOpenAiCostCollectionHandlerOptions = {
  run: (operationId: string) =>
    Promise<OpenAiCostExecutionGateOutcome>;
  isEnabled?: () => boolean;
};

function json(
  payload: Record<string, unknown>,
  status: number,
): Response {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function reject(status: number, code: string): Response {
  return json({
    ok: false,
    code,
  }, status);
}

function trustedOrigin(request: Request): boolean {
  try {
    const expected = new URL(request.url).origin;
    const supplied = request.headers.get("origin");
    const fetchSite = request.headers.get("sec-fetch-site");

    return supplied !== null &&
      supplied === expected &&
      (fetchSite === null || fetchSite === "same-origin");
  } catch {
    return false;
  }
}

function validPayload(value: unknown): boolean {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return false;
  }

  const body = value as Record<string, unknown>;
  const keys = Object.keys(body).sort();

  return keys.length === 2 &&
    keys[0] === "confirmation" &&
    keys[1] === "operationId" &&
    body.operationId === FIRST_OPENAI_COST_OPERATION_ID &&
    body.confirmation === FIRST_OPENAI_COST_CONFIRMATION;
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
 * One-operation manual authorization envelope.
 *
 * This module does not implement financial authorization:
 * the injected runner MUST be the existing protected targeted
 * runner, which checks flags, session, capability and allowlist.
 *
 * An additional one-shot flag is OFF unless explicitly "true".
 * Never register this handler as a cron or automated workflow.
 *
 * No route is created here. Construction performs no I/O.
 */
export function createFirstOpenAiCostCollectionHandler(
  options: FirstOpenAiCostCollectionHandlerOptions,
) {
  return async (request: Request): Promise<Response> => {
    let enabled = false;

    try {
      enabled = options.isEnabled?.() ??
        (
          process.env
            .ZION_ADMIN_OPENAI_COST_MANUAL_FIRST_RUN_ENABLED === "true"
        );
    } catch {
      enabled = false;
    }

    if (!enabled) {
      return reject(503, "OPENAI_COST_FIRST_RUN_DISABLED");
    }

    if (request.method !== "POST") {
      return reject(405, "OPENAI_COST_FIRST_RUN_METHOD_INVALID");
    }

    if (!trustedOrigin(request)) {
      return reject(403, "OPENAI_COST_FIRST_RUN_ORIGIN_DENIED");
    }

    const mediaType = (
      request.headers.get("content-type") ?? ""
    ).split(";")[0].trim().toLowerCase();

    if (mediaType !== "application/json") {
      return reject(415, "OPENAI_COST_FIRST_RUN_MEDIA_INVALID");
    }

    const length = request.headers.get("content-length");

    if (
      length !== null &&
      (!/^\d+$/.test(length) || Number(length) > 512)
    ) {
      return reject(413, "OPENAI_COST_FIRST_RUN_BODY_TOO_LARGE");
    }

    let body: unknown;

    try {
      const raw = await request.text();

      if (Buffer.byteLength(raw, "utf8") > 512) {
        return reject(413, "OPENAI_COST_FIRST_RUN_BODY_TOO_LARGE");
      }

      body = JSON.parse(raw);
    } catch {
      return reject(400, "OPENAI_COST_FIRST_RUN_BODY_INVALID");
    }

    if (!validPayload(body)) {
      return reject(400, "OPENAI_COST_FIRST_RUN_TARGET_INVALID");
    }

    let outcome: OpenAiCostExecutionGateOutcome;

    try {
      outcome = await options.run(
        FIRST_OPENAI_COST_OPERATION_ID,
      );
    } catch {
      // The claim may have committed before transport failed.
      // Never retry automatically.
      return reject(503, "OPENAI_COST_EXECUTION_UNCONFIRMED");
    }

    if (
      !outcome ||
      typeof outcome !== "object" ||
      typeof outcome.status !== "string" ||
      typeof outcome.ok !== "boolean"
    ) {
      return reject(503, "OPENAI_COST_EXECUTION_RESULT_INVALID");
    }

    return json({
      ...outcome,
      operationId: FIRST_OPENAI_COST_OPERATION_ID,
    }, resultStatus(outcome));
  };
}
