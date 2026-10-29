import assert from "node:assert/strict";
import test from "node:test";

import {
  buildQuotePreparationOperationKey,
  buildQuotePreparationRequestFingerprint,
  registerQuotePreparationFromTaskBySystem,
} from "./register-quote-preparation-from-task-by-system";
import type { QuotePreparationIdentity } from "./resolve-quote-preparation-identity-by-system";

const IDS = {
  task: "11111111-1111-4111-8111-111111111111",
  organization: "22222222-2222-4222-8222-222222222222",
  store: "33333333-3333-4333-8333-333333333333",
  lead: "44444444-4444-4444-8444-444444444444",
  conversation: "55555555-5555-4555-8555-555555555555",
  opportunity: "66666666-6666-4666-8666-666666666666",
  message: "77777777-7777-4777-8777-777777777777",
  profile: "88888888-8888-4888-8888-888888888888",
  operation: "99999999-9999-4999-8999-999999999999",
};

type Row = Record<string, unknown>;

function createSupabase(options?: {
  rpcData?: unknown;
  rpcError?: { code?: string; message?: string } | null;
  taskStatus?: string;
  omitMessage?: boolean;
}) {
  const calls: Array<{ functionName: string; args: Record<string, unknown> }> = [];
  const task = {
    id: IDS.task,
    organization_id: IDS.organization,
    store_id: IDS.store,
    task_type: "commercial_quote_request",
    status: options?.taskStatus ?? "open",
    related_lead_id: IDS.lead,
    related_conversation_id: IDS.conversation,
    commercial_opportunity_id: IDS.opportunity,
    task_payload: { quote_preparation: { request_message_id: IDS.message } },
  };
  const rows: Record<string, Row | null> = {
    store_assistant_operational_tasks: task,
    messages: options?.omitMessage
      ? null
      : {
          id: IDS.message,
          organization_id: IDS.organization,
          store_id: IDS.store,
          lead_id: IDS.lead,
          conversation_id: IDS.conversation,
          sender: "user",
          direction: "incoming",
          deleted_at: null,
        },
    leads: { id: IDS.lead, organization_id: IDS.organization, store_id: IDS.store },
    conversations: {
      id: IDS.conversation,
      organization_id: IDS.organization,
      lead_id: IDS.lead,
    },
    commercial_opportunities: {
      id: IDS.opportunity,
      organization_id: IDS.organization,
      store_id: IDS.store,
      origin_lead_id: IDS.lead,
      primary_conversation_id: IDS.conversation,
      stage: "qualified",
    },
    commercial_opportunity_profile_current: {
      organization_id: IDS.organization,
      store_id: IDS.store,
      commercial_opportunity_id: IDS.opportunity,
      current_profile_version_id: IDS.profile,
    },
    commercial_opportunity_profile_versions: {
      id: IDS.profile,
      organization_id: IDS.organization,
      store_id: IDS.store,
      commercial_opportunity_id: IDS.opportunity,
      version_number: 3,
      profile_state: "resolved",
    },
  };

  const supabase = {
    from(table: string) {
      const row = rows[table];
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        in() {
          return this;
        },
        async maybeSingle() {
          return { data: row, error: null };
        },
      };
    },
    async rpc(functionName: string, args: Record<string, unknown>) {
      calls.push({ functionName, args });
      return {
        data: options?.rpcData ?? {
          outcome: "created",
          operation_id: IDS.operation,
          organization_id: IDS.organization,
          store_id: IDS.store,
          status: "queued",
          profile_version_id: IDS.profile,
          request_message_id: IDS.message,
        },
        error: options?.rpcError ?? null,
      };
    },
  };

  return { supabase, calls };
}

function identity(overrides?: Partial<QuotePreparationIdentity>): QuotePreparationIdentity {
  return {
    taskId: IDS.task,
    organizationId: IDS.organization,
    storeId: IDS.store,
    leadId: IDS.lead,
    conversationId: IDS.conversation,
    commercialOpportunityId: IDS.opportunity,
    requestMessageId: IDS.message,
    profileVersionId: IDS.profile,
    profileVersionNumber: 3,
    ...overrides,
  };
}

test("registra identidade canônica com os dez argumentos e não chama writer", async () => {
  const { supabase, calls } = createSupabase();
  const result = await registerQuotePreparationFromTaskBySystem({
    taskId: IDS.task,
    organizationId: IDS.organization,
    storeId: IDS.store,
    supabase,
  });

  assert.equal(result.outcome, "created");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.functionName, "register_quote_preparation_operation_by_system");
  assert.deepEqual(Object.keys(calls[0]?.args ?? {}).sort(), [
    "p_commercial_opportunity_id",
    "p_conversation_id",
    "p_lead_id",
    "p_operation_key",
    "p_organization_id",
    "p_profile_version_id",
    "p_profile_version_number",
    "p_request_fingerprint",
    "p_request_message_id",
    "p_store_id",
  ].sort());
});

test("a mesma identidade mantém chave e fingerprint, incluindo a versão no fingerprint", () => {
  const first = identity();
  const replay = identity();
  const changedProfile = identity({ profileVersionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", profileVersionNumber: 4 });

  assert.equal(buildQuotePreparationOperationKey(first), buildQuotePreparationOperationKey(replay));
  assert.equal(buildQuotePreparationRequestFingerprint(first), buildQuotePreparationRequestFingerprint(replay));
  assert.notEqual(buildQuotePreparationRequestFingerprint(first), buildQuotePreparationRequestFingerprint(changedProfile));
  assert.match(buildQuotePreparationRequestFingerprint(first), /^[0-9a-f]{64}$/);
  assert.ok(buildQuotePreparationOperationKey(first).length <= 200);
});

test("escopos e mensagens diferentes não compartilham a identidade", () => {
  const first = identity();
  const different = identity({
    storeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    requestMessageId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  });

  assert.notEqual(buildQuotePreparationOperationKey(first), buildQuotePreparationOperationKey(different));
  assert.notEqual(buildQuotePreparationRequestFingerprint(first), buildQuotePreparationRequestFingerprint(different));
});

test("replay retorna a mesma operação sem chamadas adicionais", async () => {
  const { supabase, calls } = createSupabase({
    rpcData: {
      outcome: "idempotent_replay",
      operation_id: IDS.operation,
      organization_id: IDS.organization,
      store_id: IDS.store,
      status: "queued",
      profile_version_id: IDS.profile,
      request_message_id: IDS.message,
    },
  });

  const result = await registerQuotePreparationFromTaskBySystem({
    taskId: IDS.task,
    organizationId: IDS.organization,
    storeId: IDS.store,
    supabase,
  });

  assert.equal(result.outcome, "idempotent_replay");
  assert.equal(calls.length, 1);
});

test("identidade ausente ou tarefa inelegível não chama a RPC", async () => {
  for (const options of [{ omitMessage: true }, { taskStatus: "cancelled" }]) {
    const { supabase, calls } = createSupabase(options);
    const result = await registerQuotePreparationFromTaskBySystem({
      taskId: IDS.task,
      organizationId: IDS.organization,
      storeId: IDS.store,
      supabase,
    });

    assert.equal(result.outcome, "ineligible");
    assert.equal(calls.length, 0);
  }
});

test("blocked não é convertido em nova chave ou tentativa", async () => {
  const { supabase, calls } = createSupabase({
    rpcData: {
      outcome: "blocked",
      operation_id: null,
      status: "blocked",
      reason: "active_preparation_exists",
    },
  });

  const result = await registerQuotePreparationFromTaskBySystem({
    taskId: IDS.task,
    organizationId: IDS.organization,
    storeId: IDS.store,
    supabase,
  });

  assert.equal(result.outcome, "blocked");
  assert.equal(calls.length, 1);
});

test("erro RPC é propagado sem retry automático e sem writer", async () => {
  const { supabase, calls } = createSupabase({
    rpcError: { code: "P19A_QUOTE_PREP_TIMEOUT", message: "uncertain" },
  });

  await assert.rejects(
    () => registerQuotePreparationFromTaskBySystem({
      taskId: IDS.task,
      organizationId: IDS.organization,
      storeId: IDS.store,
      supabase,
    }),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.functionName, "register_quote_preparation_operation_by_system");
});
