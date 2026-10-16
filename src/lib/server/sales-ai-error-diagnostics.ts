export type SalesAiErrorAuthority =
  | "write_commercial_message_intent_resolution_by_system"
  | "materialize_sales_ai_reply_set_by_system";

export type SalesAiErrorDiagnostic = {
  authority: SalesAiErrorAuthority;
  sqlstate: string | null;
  constraint: string | null;
  reason: string | null;
};

export class SalesAiPersistenceError extends Error {
  readonly functionalCode: string;
  readonly diagnostic: SalesAiErrorDiagnostic;

  constructor(functionalCode: string, diagnostic: SalesAiErrorDiagnostic) {
    super(functionalCode);
    this.name = "SalesAiPersistenceError";
    this.functionalCode = functionalCode;
    this.diagnostic = diagnostic;
  }
}

type SupabaseErrorLike = {
  code?: unknown;
  constraint?: unknown;
  message?: unknown;
};

const SAFE_REASON_PREFIXES = ["P19A_", "P9_", "SALES_AI_", "ZION_"] as const;
const SAFE_REASON_MAX_LENGTH = 96;

function safeSqlState(value: unknown): string | null {
  return typeof value === "string" && /^[0-9A-Z]{5}$/.test(value)
    ? value
    : null;
}

function safeIdentifier(value: unknown): string | null {
  return typeof value === "string" && /^[a-z_][a-z0-9_]{0,127}$/i.test(value)
    ? value
    : null;
}

function safeReason(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length < 3 ||
    value.length > SAFE_REASON_MAX_LENGTH ||
    !/^[A-Z0-9_]+$/.test(value) ||
    !SAFE_REASON_PREFIXES.some((prefix) => value.startsWith(prefix))
  ) {
    return null;
  }
  return value;
}

export function createSalesAiErrorDiagnostic(
  authority: SalesAiErrorAuthority,
  error: unknown,
): SalesAiErrorDiagnostic {
  const candidate = error && typeof error === "object"
    ? (error as SupabaseErrorLike)
    : {};

  return {
    authority,
    sqlstate: safeSqlState(candidate.code),
    constraint: safeIdentifier(candidate.constraint),
    reason: safeReason(candidate.message),
  };
}

export function formatSalesAiProcessingError(
  functionalCode: string,
  diagnostic?: SalesAiErrorDiagnostic,
): string {
  if (!diagnostic) return functionalCode;

  return [
    functionalCode,
    `authority=${diagnostic.authority}`,
    `sqlstate=${diagnostic.sqlstate || "unknown"}`,
    `constraint=${diagnostic.constraint || "unknown"}`,
    `reason=${diagnostic.reason || "unknown"}`,
  ].join(";");
}
