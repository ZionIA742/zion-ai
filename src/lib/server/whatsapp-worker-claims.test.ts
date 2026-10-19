import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_RUN_QUEUE_CLAIM_RPC,
  WHATSAPP_INBOX_CLAIM_RPC,
  assertWorkerClaimActiveBySystem,
  claimAiRunQueueTasksBySystem,
  claimWhatsappInboxEventsBySystem,
  finalizeWorkerTaskBySystem,
  normalizeWorkerClaimRows,
} from "./whatsapp-worker-claims";
import { getWhatsappProcessAllHttpStatus } from "./whatsapp-process-all-status";

const row = {
  id: "id-1",
  organization_id: "org-1",
  store_id: "store-1",
  claim_token: "token-1",
  claim_expires_at: new Date(Date.now() + 120_000).toISOString(),
  attempt_count: 1,
  provider: "meta",
  external_event_id: "event-1",
  payload: { source: "meta_whatsapp_webhook", event_kind: "message" },
  received_at: new Date().toISOString(),
  processed_at: null,
  processing_error: null,
  conversation_id: "conversation-1",
  lead_id: "lead-1",
  queue_key: "resume:conversation-1:test",
  input: { type: "resume_sales_conversation", reason: "fast_lead_delay" },
};

test("claim RPCs carry tenant scope, lease and attempt limit", async () => {
  const calls: string[] = [];
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push(`${name}:${JSON.stringify(args)}`);
      return { data: [row], error: null };
    },
  };

  const inbox = await claimWhatsappInboxEventsBySystem(client, {
    organizationId: "org-1",
    storeId: "store-1",
    limit: 2,
    claimedBy: "worker-a",
  });
  const queue = await claimAiRunQueueTasksBySystem(client, {
    organizationId: "org-1",
    storeId: "store-1",
    limit: 2,
    claimedBy: "worker-b",
  });

  assert.equal(inbox[0]?.claim_token, "token-1");
  assert.equal(queue[0]?.claim_token, "token-1");
  assert.match(calls[0], new RegExp(WHATSAPP_INBOX_CLAIM_RPC));
  assert.match(calls[1], new RegExp(AI_RUN_QUEUE_CLAIM_RPC));
  assert.match(calls[0], /p_max_attempts/);
});

test("malformed claim rows fail closed and old finalization uses the claim token", async () => {
  assert.throws(() => normalizeWorkerClaimRows({ data: [row] }), /nao-array/);
  assert.throws(() => normalizeWorkerClaimRows([{ id: "id-1" }]), /ausente/);
  assert.throws(() => normalizeWorkerClaimRows([{ ...row, claim_expires_at: new Date(Date.now() - 1_000).toISOString() }]), /expirado/);
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return { data: [{ ok: true, id: "id-1", claim_token: "token-old", outcome: "failed_final" }], error: null };
    },
  };
  await finalizeWorkerTaskBySystem(client, {
    kind: "inbox",
    organizationId: "org-1",
    storeId: "store-1",
    id: "id-1",
    claimToken: "token-old",
    outcome: "failed_final",
    errorText: "terminal",
  });
  assert.equal(calls[0].args.p_claim_token, "token-old");
});

test("finalization rejects an ambiguous success response", async () => {
  const client = {
    async rpc() {
      return { data: [{ ok: true, id: "other-id", claim_token: "other-token", outcome: "processed" }], error: null };
    },
  };
  await assert.rejects(
    finalizeWorkerTaskBySystem(client, {
      kind: "ai_run_queue",
      organizationId: "org-1",
      storeId: "store-1",
      id: "id-1",
      claimToken: "token-1",
      outcome: "processed",
    }),
    /divergente/,
  );
});

test("active-claim assertion rejects an expired or different token", async () => {
  const client = {
    async rpc() {
      return {
        data: [{
          ok: true,
          id: "id-1",
          claim_token: "token-new",
          claim_expires_at: new Date(Date.now() - 1_000).toISOString(),
        }],
        error: null,
      };
    },
  };
  await assert.rejects(
    assertWorkerClaimActiveBySystem(client, {
      kind: "inbox",
      organizationId: "org-1",
      storeId: "store-1",
      id: "id-1",
      claimToken: "token-old",
    }),
    /divergente|expirado/,
  );
});

test("Job 13 exposes complete, partial and total failure distinctly", () => {
  assert.equal(getWhatsappProcessAllHttpStatus(3, 0), 200);
  assert.equal(getWhatsappProcessAllHttpStatus(3, 1), 207);
  assert.equal(getWhatsappProcessAllHttpStatus(3, 3), 500);
});
