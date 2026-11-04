import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { join } from "node:path";
import {
  decideReceivedContractDocument,
  RECEIVED_CONTRACT_DOCUMENT_DECISION_RPC,
  resolveReceivedContractDocumentDecision,
  tryHandleReceivedContractDocumentDecision,
} from "./received-contract-document-decision";

const context = {
  organizationId: "org-1",
  storeId: "store-1",
  notificationId: "notification-1",
  contractId: "contract-1",
  contractVersionId: "version-1",
  evidenceSourceMessageId: "message-1",
  decisionMessageId: "decision-1",
  channel: "assistant" as const,
};

test("aceita somente SIM/NAO standalone e preserva acentuacao", () => {
  assert.equal(resolveReceivedContractDocumentDecision("SIM"), "confirmed");
  assert.equal(resolveReceivedContractDocumentDecision("não"), "rejected");
  assert.equal(resolveReceivedContractDocumentDecision("sim, pode"), null);
  assert.equal(resolveReceivedContractDocumentDecision("assinei"), null);
  assert.equal(resolveReceivedContractDocumentDecision(""), null);
});

test("envia identidade exata para a autoridade e aceita replay valido", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const result = await decideReceivedContractDocument({
    supabase: {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return {
          data: {
            outcome: "replayed",
            decision: "confirmed",
            notification_id: context.notificationId,
            contract_id: context.contractId,
            contract_version_id: context.contractVersionId,
            evidence_source_message_id: context.evidenceSourceMessageId,
          },
          error: null,
        };
      },
    } as never,
    decision: "confirmed",
    context,
  });
  assert.equal(result.outcome, "replayed");
  assert.equal(calls[0]?.name, RECEIVED_CONTRACT_DOCUMENT_DECISION_RPC);
  assert.equal(calls[0]?.args.p_contract_version_id, context.contractVersionId);
  assert.equal(calls[0]?.args.p_evidence_source_message_id, context.evidenceSourceMessageId);
  assert.equal(calls[0]?.args.p_channel, "assistant_chat");
});

test("falha fechado para retorno vazio, cardinalidade ou identidade divergente", async () => {
  for (const data of [null, [], [{ outcome: "decided" }, { outcome: "decided" }], {
    outcome: "decided",
    decision: "confirmed",
    notification_id: context.notificationId,
    contract_id: "other-contract",
    contract_version_id: context.contractVersionId,
    evidence_source_message_id: context.evidenceSourceMessageId,
  }]) {
    await assert.rejects(
      decideReceivedContractDocument({
        supabase: { rpc: async () => ({ data, error: null }) } as never,
        decision: "confirmed",
        context,
      }),
      /RECEIVED_CONTRACT_DOCUMENT_DECISION_RPC_RETURN_INVALID/,
    );
  }
});

test("nao transforma erro da autoridade em decisao", async () => {
  await assert.rejects(
    decideReceivedContractDocument({
      supabase: {
        rpc: async () => ({ data: null, error: { message: "rpc unavailable" } }),
      } as never,
      decision: "rejected",
      context,
    }),
    /RECEIVED_CONTRACT_DOCUMENT_DECISION_RPC_FAILED:rpc unavailable/,
  );
});

test("nao executa com contexto incompleto", async () => {
  await assert.rejects(
    decideReceivedContractDocument({
      supabase: { rpc: async () => ({ data: null, error: null }) } as never,
      decision: "confirmed",
      context: { ...context, contractVersionId: "" },
    }),
    /RECEIVED_CONTRACT_DOCUMENT_DECISION_CONTEXT_INVALID/,
  );
});

test("rejeita canal fora do contrato RPC antes de qualquer chamada", async () => {
  let rpcCalls = 0;
  await assert.rejects(
    decideReceivedContractDocument({
      supabase: {
        rpc: async () => {
          rpcCalls += 1;
          return { data: null, error: null };
        },
      } as never,
      decision: "confirmed",
      context: { ...context, channel: "whatsapp_legacy" as never },
    }),
    /RECEIVED_CONTRACT_DOCUMENT_DECISION_CHANNEL_INVALID/,
  );
  assert.equal(rpcCalls, 0);
});

function createResolverSupabase(args: {
  message?: { id: string; thread_id: string | null } | null;
  notifications?: Array<Record<string, unknown>>;
  externalNotifications?: Array<Record<string, unknown>>;
  rpcResult?: { data: unknown; error: unknown };
}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const rows = args.message ?? null;
  const notifications = args.notifications ?? [];
  const externalNotifications = args.externalNotifications ?? [];
  const rpcResult = args.rpcResult ?? {
    data: {
      outcome: "applied",
      decision: "confirmed",
      notification_id: "notification-1",
      contract_id: "contract-1",
      contract_version_id: "version-1",
      evidence_source_message_id: "message-1",
    },
    error: null,
  };

  const query = (table: string) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      contains: () => builder,
      neq: () => builder,
      order: () => builder,
      limit: async () => ({
        data: table === "store_assistant_notification_queue"
          ? notifications
          : externalNotifications,
        error: null,
      }),
      maybeSingle: async () => ({ data: rows, error: null }),
    };
    return builder;
  };

  return {
    calls,
    supabase: {
      from: (table: string) => query(table),
      rpc: async (name: string, rpcArgs: Record<string, unknown>) => {
        calls.push({ name, args: rpcArgs });
        return rpcResult;
      },
    },
  };
}

const identifiedNotification = {
  id: "notification-1",
  thread_id: "thread-1",
  status: "pending",
  context: {
    source: "received_contract_document_evidence_v1",
    received_identification_status: "identified",
    related_contract_id: "contract-1",
    document_version_id: "version-1",
    received_evidence_source_message_id: "message-1",
    customer_name: "Regina",
  },
};

test("integra SIM no WhatsApp com a notificacao externa exata", async () => {
  const harness = createResolverSupabase({
    message: { id: "decision-1", thread_id: "thread-1" },
    notifications: [identifiedNotification],
    externalNotifications: [{ internal_notification_id: "notification-1" }],
  });
  const result = await tryHandleReceivedContractDocumentDecision({
    supabase: harness.supabase,
    organizationId: "org-1",
    storeId: "store-1",
    decisionMessageId: "decision-1",
    content: "SIM",
    channel: "whatsapp",
    contextMessageId: "external-1",
  });
  assert.equal(result?.result.decision, "confirmed");
  assert.equal(harness.calls[0]?.args.p_notification_id, "notification-1");
  assert.equal(harness.calls[0]?.args.p_decision_message_id, "decision-1");
  assert.equal(harness.calls[0]?.args.p_channel, "whatsapp_assistant");
});

test("integra NAO no chat interno pelo thread exato", async () => {
  const harness = createResolverSupabase({
    message: { id: "decision-2", thread_id: "thread-1" },
    notifications: [identifiedNotification],
    rpcResult: {
      data: {
        outcome: "applied",
        decision: "rejected",
        notification_id: "notification-1",
        contract_id: "contract-1",
        contract_version_id: "version-1",
        evidence_source_message_id: "message-1",
      },
      error: null,
    },
  });
  const result = await tryHandleReceivedContractDocumentDecision({
    supabase: harness.supabase,
    organizationId: "org-1",
    storeId: "store-1",
    decisionMessageId: "decision-2",
    content: "NÃO",
    channel: "assistant",
  });
  assert.equal(result?.result.decision, "rejected");
  assert.equal(harness.calls[0]?.args.p_decision_message_id, "decision-2");
  assert.equal(harness.calls[0]?.args.p_channel, "assistant_chat");
});

test("permanece sem mutacao quando ha mais de uma notificacao candidata", async () => {
  const harness = createResolverSupabase({
    message: { id: "decision-3", thread_id: "thread-1" },
    notifications: [identifiedNotification, { ...identifiedNotification, id: "notification-2" }],
  });
  const result = await tryHandleReceivedContractDocumentDecision({
    supabase: harness.supabase,
    organizationId: "org-1",
    storeId: "store-1",
    decisionMessageId: "decision-3",
    content: "SIM",
    channel: "assistant",
  });
  assert.equal(result, null);
  assert.equal(harness.calls.length, 0);
});

test("propaga falha da autoridade sem transformar em sucesso", async () => {
  const harness = createResolverSupabase({
    message: { id: "decision-4", thread_id: "thread-1" },
    notifications: [identifiedNotification],
    rpcResult: { data: null, error: { message: "rpc unavailable" } },
  });
  await assert.rejects(
    tryHandleReceivedContractDocumentDecision({
      supabase: harness.supabase,
      organizationId: "org-1",
      storeId: "store-1",
      decisionMessageId: "decision-4",
      content: "SIM",
      channel: "assistant",
    }),
    /RECEIVED_CONTRACT_DOCUMENT_DECISION_RPC_FAILED:rpc unavailable/,
  );
});

test("os dois canais chamam o resolvedor antes do fluxo normal", () => {
  const whatsappSource = readFileSync(
    join(process.cwd(), "src/lib/server/whatsapp-inbox-processor.ts"),
    "utf8",
  );
  const assistantSource = readFileSync(
    join(process.cwd(), "src/app/api/assistant/reply/route.ts"),
    "utf8",
  );

  assert.match(whatsappSource, /tryHandleReceivedContractDocumentDecision/);
  assert.match(whatsappSource, /channel: "whatsapp"/);
  assert.match(assistantSource, /tryHandleReceivedContractDocumentDecision/);
  assert.match(assistantSource, /channel: "assistant"/);
  assert.ok(
    assistantSource.indexOf("const receivedContractDecision =") <
      assistantSource.indexOf("const contractGenerationResult ="),
  );
});
