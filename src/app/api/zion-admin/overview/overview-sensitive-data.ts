export type OverviewIssueSource =
  | "ai_run_queue"
  | "ai_sales_action_queue"
  | "channel_whatsapp_inbox"
  | "ai_run";

const TECHNICAL_NUMBER_RULES: Record<string, { min: number; max: number }> = {
  attempt: { min: 1, max: 100 },
  retry_count: { min: 0, max: 100 },
  duration_ms: { min: 0, max: 86_400_000 },
  http_status: { min: 100, max: 599 },
};
const SOURCE_LABELS: Record<OverviewIssueSource, string> = {
  ai_run_queue: "fila de IA",
  ai_sales_action_queue: "ação comercial da IA",
  channel_whatsapp_inbox: "evento de WhatsApp",
  ai_run: "execução da IA",
};

function isSafeTechnicalNumber(value: unknown, key: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return false;

  const rule = TECHNICAL_NUMBER_RULES[key];
  return rule !== undefined && value >= rule.min && value <= rule.max;
}

export function sanitizeTechnicalPreview(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const safe: Record<string, number> = {};

  for (const key of Object.keys(TECHNICAL_NUMBER_RULES)) {
    if (isSafeTechnicalNumber(source[key], key)) {
      safe[key] = source[key] as number;
    }
  }

  const keys = Object.keys(safe).sort();
  return keys.length === 0
    ? null
    : JSON.stringify(Object.fromEntries(keys.map((key) => [key, safe[key]])));
}

export function sanitizeOverviewError(args: {
  source: OverviewIssueSource;
  rawError: unknown;
  pending?: boolean;
}) {
  const hasError = typeof args.rawError === "string"
    ? args.rawError.trim().length > 0
    : args.rawError != null;
  const label = SOURCE_LABELS[args.source];
  if (hasError) return `Falha operacional na ${label}.`;
  if (args.pending) return `${label[0].toUpperCase()}${label.slice(1)} aguardando processamento.`;
  return null;
}
