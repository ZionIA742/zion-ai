import { extractSafeAiRunEvidence } from "./zion-admin-ai-run-evidence";

export type SafeDiagnosticReaderV2Evidence = {
  registered_component:
    | "sales_ai"
    | "assistant_ai"
    | "ai_origin_unknown"
    | "unknown";
  evidence_origin: "assistant_ai" | "unknown";
  evidence_execution_type: "assistant_chat" | null;
  evidence_provider: "openai" | null;
  evidence_model: string | null;
  evidence_run_status:
    ReturnType<typeof extractSafeAiRunEvidence>["status"];
  evidence_latency_ms: number | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function projectSafeDiagnosticReaderV2Evidence(
  source: unknown,
): SafeDiagnosticReaderV2Evidence {
  const record = asRecord(source);

  const rawComponent = record?.registered_component;

  const component =
    rawComponent === "sales_ai" ||
    rawComponent === "assistant_ai" ||
    rawComponent === "ai_origin_unknown"
      ? rawComponent
      : "unknown";

  const assistantProven =
    component === "assistant_ai" &&
    record?.evidence_origin === "assistant_ai" &&
    record?.evidence_execution_type === "assistant_chat";

  const safe = extractSafeAiRunEvidence({
    input: assistantProven ? { type: "assistant_chat" } : null,
    provider: record?.evidence_provider,
    model: record?.evidence_model,
    status: record?.evidence_run_status,
    latency_ms: record?.evidence_latency_ms,
  });

  return {
    registered_component: component,
    evidence_origin: assistantProven ? "assistant_ai" : "unknown",
    evidence_execution_type: assistantProven ? "assistant_chat" : null,
    evidence_provider: safe.provider,
    evidence_model: safe.model,
    evidence_run_status: safe.status,
    evidence_latency_ms: safe.latency_ms,
  };
}
