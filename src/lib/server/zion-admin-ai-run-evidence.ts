export type SafeAiRunOrigin = "assistant_ai" | "unknown";

export type SafeAiRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "error"
  | "success"
  | "cancelled";

export type SafeAiRunEvidenceV1 = {
  schema_version: 1;
  origin: SafeAiRunOrigin;
  execution_type: "assistant_chat" | null;
  provider: "openai" | null;
  model: string | null;
  status: SafeAiRunStatus | null;
  latency_ms: number | null;
};

const ALLOWED_MODELS = new Set([
  "gpt-4o-mini",
  "gpt-4o",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-5.1",
  "gpt-5.2",
  "gpt-5.3",
  "gpt-5.4",
  "gpt-5.5",
  "gpt-5.6",
  "gpt-6",
]);

const ALLOWED_STATUSES = new Set<SafeAiRunStatus>([
  "queued",
  "running",
  "completed",
  "failed",
  "error",
  "success",
  "cancelled",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function extractSafeAiRunEvidence(
  source: unknown,
): SafeAiRunEvidenceV1 {
  const row = asRecord(source);
  const input = asRecord(row?.input);

  const isAssistant = input?.type === "assistant_chat";
  const provider = row?.provider === "openai" ? "openai" : null;

  const model =
    provider === "openai" &&
    typeof row?.model === "string" &&
    ALLOWED_MODELS.has(row.model)
      ? row.model
      : null;

  const status =
    typeof row?.status === "string" &&
    ALLOWED_STATUSES.has(row.status as SafeAiRunStatus)
      ? (row.status as SafeAiRunStatus)
      : null;

  const latency =
    typeof row?.latency_ms === "number" &&
    Number.isSafeInteger(row.latency_ms) &&
    row.latency_ms >= 0 &&
    row.latency_ms <= 86_400_000
      ? row.latency_ms
      : null;

  return {
    schema_version: 1,
    origin: isAssistant ? "assistant_ai" : "unknown",
    execution_type: isAssistant ? "assistant_chat" : null,
    provider,
    model,
    status,
    latency_ms: latency,
  };
}
