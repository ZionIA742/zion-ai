import { createClient } from "@supabase/supabase-js";

const QUOTE_PREPARATION_QUEUE_TYPE = "quote_preparation_request" as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RpcLikeError = { code?: unknown; message?: unknown };

export type QuotePreparationQueueInput = {
  organizationId: string;
  storeId: string;
  taskId: string;
  conversationId: string;
  requestMessageId: string;
  leadId: string;
  commercialOpportunityId: string;
  authorizationId: string;
  supabase?: QuotePreparationQueueSupabase;
};

export type QuotePreparationQueueResult = {
  outcome: "created" | "idempotent_replay";
  queueId: string;
  organizationId: string;
  storeId: string;
  taskId: string;
  conversationId: string;
  requestMessageId: string;
  status: string;
};

export type QuotePreparationQueueSupabase = {
  from(table: string): QuotePreparationQueueQuery;
};

type QuotePreparationQueueQuery = {
  insert(payload: Record<string, unknown>): QuotePreparationQueueQuery;
  select(selection?: string): QuotePreparationQueueQuery;
  eq(column: string, value: unknown): QuotePreparationQueueQuery;
  maybeSingle(): Promise<{ data: unknown; error: RpcLikeError | null }>;
};

export class QuotePreparationQueueError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly kind: "input" | "rejected" | "uncertain",
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "QuotePreparationQueueError";
  }
}

function requireUuid(value: unknown, code: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    throw new QuotePreparationQueueError(code, code, "input");
  }
  return value.trim();
}

function requireRow(row: unknown, identity: QuotePreparationQueueInput): QuotePreparationQueueResult {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new QuotePreparationQueueError(
      "A fila de preparacao nao retornou uma identidade confirmada.",
      "P19A_QUOTE_PREP_QUEUE_RESULT_INVALID",
      "uncertain",
    );
  }

  const value = row as Record<string, unknown>;
  if (
    typeof value.id !== "string" ||
    !UUID_PATTERN.test(value.id) ||
    value.organization_id !== identity.organizationId ||
    value.store_id !== identity.storeId ||
    value.task_id !== identity.taskId ||
    value.conversation_id !== identity.conversationId ||
    value.message_id !== identity.requestMessageId ||
    value.queue_type !== QUOTE_PREPARATION_QUEUE_TYPE ||
    typeof value.status !== "string" ||
    !value.status.trim()
  ) {
    throw new QuotePreparationQueueError(
      "A fila retornada esta fora do escopo canonico.",
      "P19A_QUOTE_PREP_QUEUE_RESULT_SCOPE_INVALID",
      "uncertain",
    );
  }

  return {
    outcome: "created",
    queueId: value.id,
    organizationId: identity.organizationId,
    storeId: identity.storeId,
    taskId: identity.taskId,
    conversationId: identity.conversationId,
    requestMessageId: identity.requestMessageId,
    status: value.status,
  };
}

function createServiceRoleClient(): QuotePreparationQueueSupabase {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new QuotePreparationQueueError(
      "SUPABASE_SERVICE_ROLE_ENV_MISSING",
      "SUPABASE_SERVICE_ROLE_ENV_MISSING",
      "input",
    );
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as QuotePreparationQueueSupabase;
}

function validateInput(input: QuotePreparationQueueInput): QuotePreparationQueueInput {
  return {
    ...input,
    organizationId: requireUuid(input?.organizationId, "P19A_QUOTE_PREP_QUEUE_ORGANIZATION_ID_INVALID"),
    storeId: requireUuid(input?.storeId, "P19A_QUOTE_PREP_QUEUE_STORE_ID_INVALID"),
    taskId: requireUuid(input?.taskId, "P19A_QUOTE_PREP_QUEUE_TASK_ID_INVALID"),
    conversationId: requireUuid(input?.conversationId, "P19A_QUOTE_PREP_QUEUE_CONVERSATION_ID_INVALID"),
    requestMessageId: requireUuid(input?.requestMessageId, "P19A_QUOTE_PREP_QUEUE_MESSAGE_ID_INVALID"),
    leadId: requireUuid(input?.leadId, "P19A_QUOTE_PREP_QUEUE_LEAD_ID_INVALID"),
    commercialOpportunityId: requireUuid(input?.commercialOpportunityId, "P19A_QUOTE_PREP_QUEUE_OPPORTUNITY_ID_INVALID"),
    authorizationId: requireUuid(input?.authorizationId, "P19A_QUOTE_PREP_QUEUE_AUTHORIZATION_ID_INVALID"),
  };
}

export async function enqueueQuotePreparationTaskBySystem(
  rawInput: QuotePreparationQueueInput,
): Promise<QuotePreparationQueueResult> {
  const identity = validateInput(rawInput);
  const supabase = identity.supabase ?? createServiceRoleClient();
  const now = new Date().toISOString();
  const row = {
    organization_id: identity.organizationId,
    store_id: identity.storeId,
    task_id: identity.taskId,
    conversation_id: identity.conversationId,
    message_id: identity.requestMessageId,
    queue_type: QUOTE_PREPARATION_QUEUE_TYPE,
    status: "pending",
    attempts: 0,
    available_at: now,
    payload: {
      source: "ai_sales_quote_preparation",
      request_message_id: identity.requestMessageId,
      authorization_id: identity.authorizationId,
      lead_id: identity.leadId,
      commercial_opportunity_id: identity.commercialOpportunityId,
    },
    created_at: now,
    updated_at: now,
  };

  let insertResponse: { data: unknown; error: RpcLikeError | null };
  try {
    insertResponse = await supabase
      .from("store_assistant_operational_task_queue")
      .insert(row)
      .select("*")
      .maybeSingle();
  } catch (error) {
    throw new QuotePreparationQueueError(
      "A insercao da fila nao foi confirmada; o estado permanece incerto.",
      "P19A_QUOTE_PREP_QUEUE_INSERT_UNCERTAIN",
      "uncertain",
      error,
    );
  }

  if (!insertResponse.error) {
    const created = requireRow(insertResponse.data, identity);
    return { ...created, outcome: "created" };
  }

  let replayResponse: { data: unknown; error: RpcLikeError | null };
  try {
    replayResponse = await supabase
      .from("store_assistant_operational_task_queue")
      .select("*")
      .eq("organization_id", identity.organizationId)
      .eq("store_id", identity.storeId)
      .eq("task_id", identity.taskId)
      .eq("conversation_id", identity.conversationId)
      .eq("message_id", identity.requestMessageId)
      .eq("queue_type", QUOTE_PREPARATION_QUEUE_TYPE)
      .maybeSingle();
  } catch (error) {
    throw new QuotePreparationQueueError(
      "O conflito da fila nao pode ser reconciliado com seguranca.",
      "P19A_QUOTE_PREP_QUEUE_RECONCILIATION_UNCERTAIN",
      "uncertain",
      error,
    );
  }

  const insertError = insertResponse.error;
  if (replayResponse.error || !replayResponse.data || !insertError) {
    throw new QuotePreparationQueueError(
      String(insertError?.message || "A fila de preparacao foi rejeitada."),
      typeof insertError?.code === "string"
        ? insertError.code
        : "P19A_QUOTE_PREP_QUEUE_INSERT_REJECTED",
      "rejected",
      insertError,
    );
  }

  const replay = requireRow(replayResponse.data, identity);
  return { ...replay, outcome: "idempotent_replay" };
}
