import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route-handler";

test("CRM commitment route contract is explicit and scoped", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("./route-handler.ts", import.meta.url), "utf8"));
  assert.match(source, /responsibleUserId: access\.sessionUserId/);
  assert.match(source, /sourceKind: "panel"/);
  assert.match(source, /explicitConfirmation: body\.explicitConfirmation === true/);
  assert.match(source, /readHumanResponseCommitmentsBySystem/);
  assert.match(source, /transitionHumanResponseCommitmentBySystem/);
});

test("POST rejeita confirmação ausente antes de chamar o writer", async () => {
  let rpcCalled = false;
  const result = await POST(
    new Request("http://crm.test/api/crm/human-response-commitments", {
      method: "POST",
      body: JSON.stringify({ conversationId: "conversation-1", sourceMessageId: "message-1", dueAt: "2099-01-01T12:00:00.000Z", operationKey: "op-1", explicitConfirmation: false }),
    }),
    {
      resolveStoreAccess: async () => ({ ok: true, organizationId: "org-1", storeId: "store-1", sessionUserId: "user-1" }) as never,
      createServiceSupabaseClient: () => ({ rpc: async () => { rpcCalled = true; return { data: "id", error: null }; } }) as never,
    },
  );
  assert.equal(result.status, 400);
  assert.equal(rpcCalled, false);
});

test("POST envia somente o responsável autenticado e o writer canônico", async () => {
  let rpcName = "";
  let rpcArgs: Record<string, unknown> | null = null;
  const result = await POST(
    new Request("http://crm.test/api/crm/human-response-commitments", {
      method: "POST",
      body: JSON.stringify({ conversationId: "conversation-1", sourceMessageId: "message-1", dueAt: "2099-01-01T12:00:00.000Z", operationKey: "op-2", explicitConfirmation: true }),
    }),
    {
      resolveStoreAccess: async () => ({ ok: true, organizationId: "org-1", storeId: "store-1", sessionUserId: "user-1" }) as never,
      createServiceSupabaseClient: () => ({ rpc: async (name: string, args: Record<string, unknown>) => { rpcName = name; rpcArgs = args; return { data: "commitment-1", error: null }; } }) as never,
    },
  );
  assert.equal(result.status, 200);
  assert.equal(rpcName, "record_human_response_commitment_by_system");
  assert.equal(rpcArgs?.p_responsible_user_id, "user-1");
  assert.equal(rpcArgs?.p_explicit_confirmation, true);
});
