type SalesAiFailureSource = "inbox" | "ai_run_queue";

type FailureAlertQuery = {
  select: (columns: string) => FailureAlertQuery;
  eq: (column: string, value: unknown) => FailureAlertQuery;
  is: (column: string, value: unknown) => FailureAlertQuery;
  like: (column: string, value: string) => PromiseLike<{
    data: unknown;
    error: { message?: string } | null;
  }>;
};

export type SalesAiFailureAlertClient = {
  from: (table: string) => {
    select: (columns: string) => FailureAlertQuery;
  };
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data?: unknown;
    error?: { message?: string } | null;
  }>;
};

type TerminalFailureRow = {
  id?: unknown;
  organization_id?: unknown;
  store_id?: unknown;
  processing_error?: unknown;
  payload?: unknown;
  external_event_id?: unknown;
  conversation_id?: unknown;
  lead_id?: unknown;
  queue_key?: unknown;
};

const FINAL_FAILURE_PREFIX = "sales_ai_failed_final:";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMetaInboxRow(row: TerminalFailureRow): boolean {
  return (
    isRecord(row.payload) &&
    text(row.payload.source) === "meta_whatsapp_webhook" &&
    text(row.payload.event_kind) === "message"
  );
}

function eventKey(source: SalesAiFailureSource, id: string): string {
  return `sales_ai_failed_final:${source}:${id}`;
}

async function enqueueAlert(
  client: SalesAiFailureAlertClient,
  args: {
    source: SalesAiFailureSource;
    id: string;
    organizationId: string;
    storeId: string;
    processingError: string;
    eventKind?: unknown;
    externalEventId?: string | null;
    conversationId?: string | null;
    leadId?: string | null;
    queueKey?: string | null;
  },
) {
  const key = eventKey(args.source, args.id);
  const context = {
    source: "sales_ai_worker",
    reason: "sales_ai_failed_final",
    event_key: key,
    failure_source: args.source,
    failure_record_id: args.id,
    processing_error: args.processingError,
    external_event_id: args.externalEventId || null,
    conversation_id: args.conversationId || null,
    queue_key: args.queueKey || null,
    needs_human_action: true,
  };

  const { error } = await client.rpc("assistant_enqueue_internal_notification", {
    p_organization_id: args.organizationId,
    p_store_id: args.storeId,
    p_notification_type: "important_alert",
    p_title: "Falha definitiva no processamento da IA Vendedora",
    p_body:
      "Uma mensagem recebida não foi processada após o limite de tentativas. Verifique o atendimento no painel antes de qualquer ação.",
    p_priority: "high",
    p_context: context,
    p_related_lead_id: args.leadId || null,
    p_related_conversation_id: args.conversationId || null,
    p_related_appointment_id: null,
    p_event_key: key,
  });

  if (error) {
    throw new Error(error.message || "SALES_AI_FAILURE_ALERT_RPC_FAILED");
  }

  return { eventKey: key };
}

export async function enqueueSalesAiFailureOperationalAlert(
  client: unknown,
  args: {
    source: SalesAiFailureSource;
    id: string;
    organizationId: string;
    storeId: string;
    processingError: string;
    eventKind?: unknown;
    externalEventId?: string | null;
    conversationId?: string | null;
    leadId?: string | null;
    queueKey?: string | null;
  },
) {
  if (
    !text(args.id) ||
    !text(args.organizationId) ||
    !text(args.storeId) ||
    !text(args.processingError).startsWith(FINAL_FAILURE_PREFIX)
  ) {
    throw new Error("SALES_AI_FAILURE_ALERT_INPUT_INVALID");
  }
  if (args.source === "inbox" && text(args.eventKind) !== "message") {
    throw new Error("SALES_AI_FAILURE_ALERT_INBOX_EVENT_KIND_INVALID");
  }

  return enqueueAlert(client as SalesAiFailureAlertClient, {
    ...args,
    id: text(args.id),
    organizationId: text(args.organizationId),
    storeId: text(args.storeId),
    processingError: text(args.processingError),
  });
}

export async function enqueuePersistedSalesAiFailureAlerts(
  client: unknown,
  args: { organizationId: string; storeId: string; source: SalesAiFailureSource },
) {
  const organizationId = text(args.organizationId);
  const storeId = text(args.storeId);
  if (!organizationId || !storeId) throw new Error("SALES_AI_FAILURE_ALERT_SCOPE_INVALID");

  const table = args.source === "inbox" ? "channel_whatsapp_inbox" : "ai_run_queue";
  const alertClient = client as SalesAiFailureAlertClient;
  const select =
    args.source === "inbox"
      ? "id, organization_id, store_id, processing_error, payload, external_event_id"
      : "id, organization_id, store_id, processing_error, conversation_id, lead_id, queue_key";
  const query = alertClient
    .from(table)
    .select(select)
    .eq("organization_id", organizationId)
    .eq("store_id", storeId)
    .is("processed_at", null)
    .like("processing_error", `${FINAL_FAILURE_PREFIX}%`);
  const { data, error } = await query;
  if (error) throw new Error(error.message || "SALES_AI_FAILURE_ALERT_LOOKUP_FAILED");

  let created = 0;
  for (const row of Array.isArray(data) ? (data as TerminalFailureRow[]) : []) {
    const id = text(row.id);
    const rowOrganizationId = text(row.organization_id);
    const rowStoreId = text(row.store_id);
    const processingError = text(row.processing_error);
    if (
      !id ||
      rowOrganizationId !== organizationId ||
      rowStoreId !== storeId ||
      !processingError.startsWith(FINAL_FAILURE_PREFIX) ||
      (args.source === "inbox" && !isMetaInboxRow(row))
    ) {
      continue;
    }

    await enqueueAlert(alertClient, {
      source: args.source,
      id,
      organizationId,
      storeId,
      processingError,
      externalEventId: text(row.external_event_id) || null,
      conversationId: text(row.conversation_id) || null,
      leadId: text(row.lead_id) || null,
      queueKey: text(row.queue_key) || null,
    });
    created += 1;
  }

  return { inspected: Array.isArray(data) ? data.length : 0, created };
}
