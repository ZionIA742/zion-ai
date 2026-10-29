import { createClient } from "@supabase/supabase-js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ELIGIBLE_TASK_STATUSES = [
  "open",
  "waiting_user_choice",
  "waiting_customer_response",
  "ready_to_execute",
  "in_progress",
] as const;

type RpcError = {
  code?: unknown;
  message?: unknown;
};

type QueryResult = {
  data: unknown;
  error: RpcError | null;
};

export type QuotePreparationIdentity = {
  taskId: string;
  organizationId: string;
  storeId: string;
  leadId: string;
  conversationId: string;
  commercialOpportunityId: string;
  requestMessageId: string;
  profileVersionId: string;
  profileVersionNumber: number;
};

export type QuotePreparationIdentityResolution =
  | {
      eligible: true;
      identity: QuotePreparationIdentity;
    }
  | {
      eligible: false;
      taskId: string;
      reason:
        | "task_not_found"
        | "task_not_eligible"
        | "request_message_missing"
        | "request_message_invalid"
        | "task_identity_mismatch"
        | "lead_not_found"
        | "conversation_not_found"
        | "opportunity_not_found"
        | "opportunity_context_mismatch"
        | "profile_current_missing"
        | "profile_not_resolved"
        | "query_failed";
      errorCode?: string;
    };

type QueryBuilder = {
  select(columns: string): QueryBuilder;
  eq(column: string, value: unknown): QueryBuilder;
  in(column: string, values: readonly string[]): QueryBuilder;
  maybeSingle(): PromiseLike<QueryResult>;
};

export type QuotePreparationIdentitySupabase = {
  from(table: string): QueryBuilder;
};

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

function normalizedUuid(value: unknown): string | null {
  return isUuid(value) ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function ineligible(
  taskId: string,
  reason: Exclude<QuotePreparationIdentityResolution, { eligible: true }>["reason"],
  errorCode?: string,
): QuotePreparationIdentityResolution {
  return { eligible: false, taskId, reason, ...(errorCode ? { errorCode } : {}) };
}

async function readSingle(
  supabase: QuotePreparationIdentitySupabase,
  table: string,
  columns: string,
  filters: Array<[string, unknown]>,
): Promise<{ row: Record<string, unknown> | null; error: RpcError | null }> {
  let query = supabase.from(table).select(columns);
  for (const [column, value] of filters) {
    query = query.eq(column, value);
  }
  const result = await query.maybeSingle();
  if (result.error) return { row: null, error: result.error };
  return { row: isRecord(result.data) ? result.data : null, error: null };
}

function queryFailure(
  taskId: string,
  error: RpcError,
): QuotePreparationIdentityResolution {
  return ineligible(
    taskId,
    "query_failed",
    typeof error.code === "string" ? error.code : "P19A_QUOTE_PREP_IDENTITY_QUERY_FAILED",
  );
}

function createServiceRoleClient(): QuotePreparationIdentitySupabase {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_ENV_MISSING");
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as QuotePreparationIdentitySupabase;
}

export async function resolveQuotePreparationIdentityBySystem(args: {
  taskId: string;
  organizationId: string;
  storeId: string;
  supabase?: QuotePreparationIdentitySupabase;
}): Promise<QuotePreparationIdentityResolution> {
  const taskId = normalizedUuid(args?.taskId);
  const organizationId = normalizedUuid(args?.organizationId);
  const storeId = normalizedUuid(args?.storeId);

  if (!taskId || !organizationId || !storeId) {
    return ineligible(taskId || "", "task_not_found", "P19A_QUOTE_PREP_IDENTITY_SCOPE_INVALID");
  }

  const supabase = args?.supabase ?? createServiceRoleClient();
  let taskResult: { row: Record<string, unknown> | null; error: RpcError | null };
  try {
    taskResult = await readSingle(
      supabase,
      "store_assistant_operational_tasks",
      "id,organization_id,store_id,task_type,status,related_lead_id,related_conversation_id,commercial_opportunity_id,task_payload",
      [
        ["id", taskId],
        ["organization_id", organizationId],
        ["store_id", storeId],
      ],
    );
  } catch (error) {
    return queryFailure(taskId, {
      code: "P19A_QUOTE_PREP_IDENTITY_TASK_QUERY_FAILED",
      message: error instanceof Error ? error.message : undefined,
    });
  }

  if (taskResult.error) return queryFailure(taskId, taskResult.error);
  if (!taskResult.row) return ineligible(taskId, "task_not_found");

  const task = taskResult.row;
  if (
    task.task_type !== "commercial_quote_request" ||
    typeof task.status !== "string" ||
    !ELIGIBLE_TASK_STATUSES.includes(task.status as (typeof ELIGIBLE_TASK_STATUSES)[number])
  ) {
    return ineligible(taskId, "task_not_eligible");
  }

  const payload = isRecord(task.task_payload) ? task.task_payload : null;
  const quotePreparation = payload && isRecord(payload.quote_preparation)
    ? payload.quote_preparation
    : null;
  const requestMessageId = normalizedUuid(quotePreparation?.request_message_id);
  const leadId = normalizedUuid(task.related_lead_id);
  const conversationId = normalizedUuid(task.related_conversation_id);
  const commercialOpportunityId = normalizedUuid(task.commercial_opportunity_id);

  if (!requestMessageId) return ineligible(taskId, "request_message_missing");
  if (!leadId || !conversationId || !commercialOpportunityId) {
    return ineligible(taskId, "task_identity_mismatch");
  }

  let result: { row: Record<string, unknown> | null; error: RpcError | null };
  try {
    result = await readSingle(
      supabase,
      "messages",
      "id,organization_id,store_id,lead_id,conversation_id,sender,direction,deleted_at",
      [["id", requestMessageId], ["organization_id", organizationId], ["store_id", storeId]],
    );
  } catch (error) {
    return queryFailure(taskId, {
      code: "P19A_QUOTE_PREP_IDENTITY_MESSAGE_QUERY_FAILED",
      message: error instanceof Error ? error.message : undefined,
    });
  }
  if (result.error) return queryFailure(taskId, result.error);
  if (!result.row) return ineligible(taskId, "request_message_invalid");
  const message = result.row;
  if (
    message.id !== requestMessageId ||
    message.organization_id !== organizationId ||
    message.store_id !== storeId ||
    message.lead_id !== leadId ||
    message.conversation_id !== conversationId ||
    message.sender !== "user" ||
    message.direction !== "incoming" ||
    message.deleted_at !== null
  ) {
    return ineligible(taskId, "request_message_invalid");
  }

  try {
    result = await readSingle(
      supabase,
      "leads",
      "id,organization_id,store_id",
      [["id", leadId], ["organization_id", organizationId], ["store_id", storeId]],
    );
  } catch (error) {
    return queryFailure(taskId, {
      code: "P19A_QUOTE_PREP_IDENTITY_LEAD_QUERY_FAILED",
      message: error instanceof Error ? error.message : undefined,
    });
  }
  if (result.error) return queryFailure(taskId, result.error);
  if (!result.row) return ineligible(taskId, "lead_not_found");

  try {
    result = await readSingle(
      supabase,
      "conversations",
      "id,organization_id,lead_id",
      [["id", conversationId], ["organization_id", organizationId], ["lead_id", leadId]],
    );
  } catch (error) {
    return queryFailure(taskId, {
      code: "P19A_QUOTE_PREP_IDENTITY_CONVERSATION_QUERY_FAILED",
      message: error instanceof Error ? error.message : undefined,
    });
  }
  if (result.error) return queryFailure(taskId, result.error);
  if (!result.row) return ineligible(taskId, "conversation_not_found");

  try {
    result = await readSingle(
      supabase,
      "commercial_opportunities",
      "id,organization_id,store_id,origin_lead_id,primary_conversation_id,stage",
      [["id", commercialOpportunityId], ["organization_id", organizationId], ["store_id", storeId]],
    );
  } catch (error) {
    return queryFailure(taskId, {
      code: "P19A_QUOTE_PREP_IDENTITY_OPPORTUNITY_QUERY_FAILED",
      message: error instanceof Error ? error.message : undefined,
    });
  }
  if (result.error) return queryFailure(taskId, result.error);
  if (!result.row) return ineligible(taskId, "opportunity_not_found");
  const opportunity = result.row;
  if (
    opportunity.origin_lead_id !== leadId ||
    opportunity.primary_conversation_id !== conversationId ||
    opportunity.stage === "perdido" ||
    opportunity.stage === "concluido_sem_mais_acoes"
  ) {
    return ineligible(taskId, "opportunity_context_mismatch");
  }

  try {
    result = await readSingle(
      supabase,
      "commercial_opportunity_profile_current",
      "organization_id,store_id,commercial_opportunity_id,current_profile_version_id",
      [
        ["organization_id", organizationId],
        ["store_id", storeId],
        ["commercial_opportunity_id", commercialOpportunityId],
      ],
    );
  } catch (error) {
    return queryFailure(taskId, {
      code: "P19A_QUOTE_PREP_IDENTITY_PROFILE_CURRENT_QUERY_FAILED",
      message: error instanceof Error ? error.message : undefined,
    });
  }
  if (result.error) return queryFailure(taskId, result.error);
  if (!result.row) return ineligible(taskId, "profile_current_missing");
  const currentProfileVersionId = normalizedUuid(result.row.current_profile_version_id);
  if (!currentProfileVersionId) return ineligible(taskId, "profile_current_missing");

  try {
    result = await readSingle(
      supabase,
      "commercial_opportunity_profile_versions",
      "id,organization_id,store_id,commercial_opportunity_id,version_number,profile_state",
      [
        ["id", currentProfileVersionId],
        ["organization_id", organizationId],
        ["store_id", storeId],
        ["commercial_opportunity_id", commercialOpportunityId],
        ["profile_state", "resolved"],
      ],
    );
  } catch (error) {
    return queryFailure(taskId, {
      code: "P19A_QUOTE_PREP_IDENTITY_PROFILE_QUERY_FAILED",
      message: error instanceof Error ? error.message : undefined,
    });
  }
  if (result.error) return queryFailure(taskId, result.error);
  if (!result.row) return ineligible(taskId, "profile_not_resolved");
  const profileVersionNumber = result.row.version_number;
  if (
    typeof profileVersionNumber !== "number" ||
    !Number.isSafeInteger(profileVersionNumber) ||
    profileVersionNumber < 1
  ) {
    return ineligible(taskId, "profile_not_resolved");
  }

  return {
    eligible: true,
    identity: {
      taskId,
      organizationId,
      storeId,
      leadId,
      conversationId,
      commercialOpportunityId,
      requestMessageId,
      profileVersionId: currentProfileVersionId,
      profileVersionNumber,
    },
  };
}
