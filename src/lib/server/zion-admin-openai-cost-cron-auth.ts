import {
  createHash,
  timingSafeEqual,
} from "node:crypto";

export type OpenAiCostCronAuthorization =
  | { ok: true; status: "authorized" }
  | {
      ok: false;
      status:
        | "disabled"
        | "invalid_method"
        | "invalid_request"
        | "secret_unavailable"
        | "unauthorized";
    };

export type OpenAiCostCronAuthOptions = {
  isEnabled?: () => boolean;
  getSecret?: () => string | undefined;
};

function equalSecret(
  provided: string,
  expected: string,
): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();

  return timingSafeEqual(a, b);
}

/**
 * Dedicated service authentication for the financial cron.
 *
 * Does not grant a human administrator session.
 * Does not prepare, claim, collect or finalize costs.
 * The automation flag defaults to disabled.
 */
export function authorizeOpenAiCostCron(
  request: Request,
  options: OpenAiCostCronAuthOptions = {},
): OpenAiCostCronAuthorization {
  let enabled = false;
  let secret: string | undefined;

  try {
    enabled = options.isEnabled?.() ??
      process.env.ZION_ADMIN_OPENAI_COST_AUTO_ENABLED === "true";
  } catch {
    return { ok: false, status: "disabled" };
  }

  if (!enabled) {
    return { ok: false, status: "disabled" };
  }

  if (!request || request.method !== "GET") {
    return { ok: false, status: "invalid_method" };
  }

  try {
    if (new URL(request.url).search !== "") {
      return { ok: false, status: "invalid_request" };
    }
  } catch {
    return { ok: false, status: "invalid_request" };
  }

  try {
    secret = options.getSecret?.() ??
      process.env.ZION_ADMIN_OPENAI_COST_CRON_SECRET;
  } catch {
    return { ok: false, status: "secret_unavailable" };
  }

  if (
    typeof secret !== "string" ||
    secret.length < 32 ||
    secret !== secret.trim()
  ) {
    return { ok: false, status: "secret_unavailable" };
  }

  const authorization =
    request.headers.get("authorization") ?? "";

  const prefix = "Bearer ";

  if (!authorization.startsWith(prefix)) {
    return { ok: false, status: "unauthorized" };
  }

  const provided = authorization.slice(prefix.length);

  if (
    provided.length === 0 ||
    !equalSecret(provided, secret)
  ) {
    return { ok: false, status: "unauthorized" };
  }

  return { ok: true, status: "authorized" };
}
