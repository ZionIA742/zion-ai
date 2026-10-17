export type SalesAiErrorAuthority =
  | "write_commercial_message_intent_resolution_by_system"
  | "materialize_sales_ai_reply_set_by_system"
  | "resolve_commercial_message_intent_semantically";

export type SalesAiErrorDiagnostic = {
  authority: SalesAiErrorAuthority;
  sqlstate: string | null;
  constraint: string | null;
  reason: string | null;
  httpStatus?: number | null;
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
  status?: unknown;
  statusCode?: unknown;
  response?: { status?: unknown };
};

type SalesAiErrorDiagnosticOptions = {
  reason?: string;
  includeHttpStatus?: boolean;
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

function safeHttpStatus(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : null;
}

export function createSalesAiErrorDiagnostic(
  authority: SalesAiErrorAuthority,
  error: unknown,
  options: SalesAiErrorDiagnosticOptions = {},
): SalesAiErrorDiagnostic {
  const candidate = error && typeof error === "object"
    ? (error as SupabaseErrorLike)
    : {};

  const diagnostic: SalesAiErrorDiagnostic = {
    authority,
    sqlstate: safeSqlState(candidate.code),
    constraint: safeIdentifier(candidate.constraint),
    reason: safeReason(options.reason) || safeReason(candidate.message),
  };

  if (options.includeHttpStatus) {
    diagnostic.httpStatus = safeHttpStatus(
      candidate.status ?? candidate.statusCode ?? candidate.response?.status,
    );
  }

  return diagnostic;
}

export type SalesAiSemanticFailureReason =
  | "SALES_AI_CMI_OPENAI_EXCEPTION"
  | "SALES_AI_CMI_JSON_MISSING"
  | "SALES_AI_CMI_JSON_INVALID"
  | "SALES_AI_CMI_DECISION_INVALID"
  | "SALES_AI_CMI_EVIDENCE_INVALID";

export function createSalesAiSemanticErrorDiagnostic(
  reason: SalesAiSemanticFailureReason,
  error?: unknown,
): SalesAiErrorDiagnostic {
  const diagnostic = createSalesAiErrorDiagnostic(
    "resolve_commercial_message_intent_semantically",
    error,
    { reason, includeHttpStatus: true },
  );

  return {
    ...diagnostic,
    sqlstate: null,
    constraint: null,
  };
}

export function formatSalesAiProcessingError(
  functionalCode: string,
  diagnostic?: SalesAiErrorDiagnostic,
): string {
  if (!diagnostic) return functionalCode;

  const fields = [
    functionalCode,
    `authority=${diagnostic.authority}`,
    `sqlstate=${diagnostic.sqlstate || "unknown"}`,
    `constraint=${diagnostic.constraint || "unknown"}`,
    `reason=${diagnostic.reason || "unknown"}`,
  ];

  if (diagnostic.authority === "resolve_commercial_message_intent_semantically") {
    fields.push(`http_status=${diagnostic.httpStatus ?? "unknown"}`);
  }

  return fields.join(";");
}
