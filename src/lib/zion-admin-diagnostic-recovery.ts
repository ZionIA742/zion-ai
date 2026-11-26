const failureCodes = [
  "whatsapp_sales_ai_failed_final",
  "whatsapp_status_failed_final",
  "ai_run_queue_failed_final",
  "sales_action_processing_failed",
] as const;

const recoveryCodes = [
  "whatsapp_status_applied",
  "whatsapp_quote_status_reconciled",
  "whatsapp_sales_ai_reply_persisted",
  "ai_queue_reply_persisted",
  "ai_queue_recovery_completed",
  "sales_action_message_persisted",
] as const;

export type OperationalRecovery = {
  confirmed: boolean;
  last_failure_at: string | null;
  recovered_at: string | null;
  evidence_kind: string | null;
  events: {
    kind: "failure" | "recovery";
    at: string;
    code: string;
  }[];
};

function record(
  value: unknown,
): value is Record<string, unknown> {
  return !!value &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function date(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 64
  ) return null;

  const time = Date.parse(value);

  return Number.isFinite(time)
    ? new Date(time).toISOString()
    : null;
}

function allowed(
  values: readonly string[],
  value: unknown,
): value is string {
  return typeof value === "string" &&
    values.includes(value);
}

export function safeOperationalRecovery(
  value: unknown,
  incidentStatus: unknown,
  resolvedAt: unknown,
): OperationalRecovery | null {

  if (
    !record(value) ||
    typeof value.confirmed !== "boolean" ||
    !Array.isArray(value.events) ||
    value.events.length > 20
  ) {
    return null;
  }

  const lastFailure = date(value.last_failure_at);
  const recoveredAt = date(value.recovered_at);

  const evidenceKind =
    allowed(recoveryCodes, value.evidence_kind)
      ? value.evidence_kind
      : null;

  const events: OperationalRecovery["events"] = [];

  for (const event of value.events) {

    if (!record(event)) return null;

    const at = date(event.at);

    if (!at) return null;

    if (
      event.kind === "failure" &&
      allowed(failureCodes, event.code)
    ) {
      events.push({
        kind: "failure",
        at,
        code: event.code,
      });
    } else if (
      event.kind === "recovery" &&
      allowed(recoveryCodes, event.code)
    ) {
      events.push({
        kind: "recovery",
        at,
        code: event.code,
      });
    } else {
      return null;
    }

  }

  if (
    value.confirmed &&
    (
      incidentStatus !== "resolved" ||
      !lastFailure ||
      !recoveredAt ||
      !evidenceKind ||
      recoveredAt !== date(resolvedAt) ||
      Date.parse(recoveredAt) <
        Date.parse(lastFailure) ||
      !events.some(
        e => e.kind === "recovery" &&
          e.at === recoveredAt &&
          e.code === evidenceKind
      ) ||
      events.some(
        e => e.kind === "failure" &&
          Date.parse(e.at) > Date.parse(recoveredAt)
      )
    )
  ) {
    return null;
  }

  return {
    confirmed: value.confirmed,
    last_failure_at: lastFailure,
    recovered_at: value.confirmed
      ? recoveredAt
      : null,
    evidence_kind: value.confirmed
      ? evidenceKind
      : null,
    events,
  };
}

export function recoveryEvidenceLabel(
  value: string | null,
): string {

  switch(value) {

    case "whatsapp_status_applied":
      return "Status do WhatsApp processado";

    case "whatsapp_quote_status_reconciled":
      return "Status do or\u00e7amento reconciliado";

    case "whatsapp_sales_ai_reply_persisted":
      return "Resposta da IA persistida e vinculada";

    case "ai_queue_reply_persisted":
      return "Resposta da fila da IA persistida";

    case "ai_queue_recovery_completed":
      return "Recupera\u00e7\u00e3o da fila da IA conclu\u00edda";

    case "sales_action_message_persisted":
      return "Mensagem da a\u00e7\u00e3o comercial persistida";

    default:
      return "Evid\u00eancia indispon\u00edvel";
  }

}

export function recoveryElapsed(
  recovery: OperationalRecovery,
): string | null {

  if (
    !recovery.confirmed ||
    !recovery.last_failure_at ||
    !recovery.recovered_at
  ) return null;

  const ms =
    Date.parse(recovery.recovered_at) -
    Date.parse(recovery.last_failure_at);

  if (!Number.isFinite(ms) || ms < 0) return null;

  const seconds = Math.floor(ms / 1000);

  if (seconds < 1) return "Menos de 1 s";

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remaining = seconds % 60;

  return [
    days ? days + " d" : "",
    hours ? hours + " h" : "",
    minutes ? minutes + " min" : "",
    remaining ? remaining + " s" : "",
  ].filter(Boolean).join(" ");

}
