import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { materializeSalesAiReplySet } from "./generate-and-save-ai-sales-reply";

const UUID = "11111111-1111-4111-8111-111111111111";
const CLAIM_TOKEN = "22222222-2222-4222-8222-222222222222";

const baseArgs = {
  organizationId: UUID,
  storeId: "33333333-3333-4333-8333-333333333333",
  conversationId: "44444444-4444-4444-8444-444444444444",
  leadId: "55555555-5555-4555-8555-555555555555",
  anchorMessageId: "66666666-6666-4666-8666-666666666666",
  commercialOpportunityId: null,
  aiText: "Resposta comercial de teste.",
  outboundKind: "reactive_ai_reply" as const,
  externalAuthorized: false,
  documentActions: [],
  photoAction: null,
};

function confirmedRow() {
  return {
    response_set_id: UUID,
    text_message_id: "77777777-7777-4777-8777-777777777777",
    document_message_ids: [],
    photo_message_id: null,
    request_fingerprint: "a".repeat(64),
    replayed: false,
  };
}

function clientFor(data: unknown, error: { message?: string } | null = null) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    client: {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { data, error };
      },
    },
  };
}

test("worker claim uses the fenced materialization RPC and forwards its identity", async () => {
  const fixture = clientFor([confirmedRow()]);

  await materializeSalesAiReplySet({
    ...baseArgs,
    supabase: fixture.client,
    workerClaim: { kind: "inbox", id: UUID, token: CLAIM_TOKEN },
  });

  assert.equal(fixture.calls[0]?.name, "materialize_sales_ai_reply_set_by_worker_by_system");
  assert.equal(fixture.calls[0]?.args.p_claim_kind, "inbox");
  assert.equal(fixture.calls[0]?.args.p_claim_id, UUID);
  assert.equal(fixture.calls[0]?.args.p_claim_token, CLAIM_TOKEN);
});

test("worker claim validation fails closed before any RPC call", async () => {
  const fixture = clientFor([confirmedRow()]);

  await assert.rejects(
    materializeSalesAiReplySet({
      ...baseArgs,
      supabase: fixture.client,
      workerClaim: { kind: "ai_run_queue", id: "not-a-uuid", token: CLAIM_TOKEN },
    }),
    /SALES_AI_WORKER_CLAIM_INVALID/,
  );
  assert.equal(fixture.calls.length, 0);
});

test("simulation without a claim preserves the original materialization RPC", async () => {
  const fixture = clientFor([confirmedRow()]);

  await materializeSalesAiReplySet({ ...baseArgs, supabase: fixture.client });

  assert.equal(fixture.calls[0]?.name, "materialize_sales_ai_reply_set_by_system");
  assert.equal("p_claim_kind" in (fixture.calls[0]?.args || {}), false);
});

test("confirmed replay remains accepted through the fenced RPC", async () => {
  const row = { ...confirmedRow(), replayed: true };
  const fixture = clientFor([row]);

  const result = await materializeSalesAiReplySet({
    ...baseArgs,
    supabase: fixture.client,
    workerClaim: { kind: "ai_run_queue", id: UUID, token: CLAIM_TOKEN },
  });

  assert.equal(result.replayed, true);
  assert.equal(fixture.calls[0]?.name, "materialize_sales_ai_reply_set_by_worker_by_system");
});

test("fenced RPC rejection is surfaced without falling back to the original RPC", async () => {
  const fixture = clientFor(null, { message: "ZION_WORKER_FENCE_CLAIM_INVALID_OR_EXPIRED" });

  await assert.rejects(
    materializeSalesAiReplySet({
      ...baseArgs,
      supabase: fixture.client,
      workerClaim: { kind: "ai_run_queue", id: UUID, token: CLAIM_TOKEN },
    }),
    /SALES_AI_REPLY_SET_MATERIALIZATION_FAILED/,
  );
  assert.deepEqual(
    fixture.calls.map((call) => call.name),
    ["materialize_sales_ai_reply_set_by_worker_by_system"],
  );
});

test("Job 13 paths propagate their claim context and reject missing claims", () => {
  const inbox = readFileSync(
    join(process.cwd(), "src/lib/server/whatsapp-inbox-processor.ts"),
    "utf8",
  );
  const queue = readFileSync(
    join(process.cwd(), "src/lib/server/process-ai-run-queue.ts"),
    "utf8",
  );

  assert.match(inbox, /WHATSAPP_INBOX_WORKER_CLAIM_MISSING/);
  assert.match(inbox, /workerClaim/);
  assert.match(queue, /AI_RUN_QUEUE_WORKER_CLAIM_MISSING/);
  assert.match(queue, /kind: "ai_run_queue"/);
});
