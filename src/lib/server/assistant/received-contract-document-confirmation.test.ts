import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import {
  enqueueReceivedContractDocumentConfirmation,
  RECEIVED_CONTRACT_DOCUMENT_CONFIRMATION_RPC,
} from "./received-contract-document-confirmation";

const context = {
  organizationId: "org-1",
  storeId: "store-1",
  conversationId: "conversation-1",
  notificationId: "notification-1",
  contractId: "contract-1",
  contractVersionId: "version-1",
  evidenceSourceMessageId: "source-1",
};

test("materializa a confirmacao com classificacao operacional e identidade completa", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const result = await enqueueReceivedContractDocumentConfirmation({
    supabase: {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return {
          data: {
            message_id: "confirmation-1",
            outbound_idempotency_key: "received_contract_document_confirmation:event-1",
            outcome: "queued",
          },
          error: null,
        };
      },
    } as never,
    ...context,
    customerName: "Regina",
  });

  assert.equal(result.outcome, "queued");
  assert.equal(calls[0]?.name, RECEIVED_CONTRACT_DOCUMENT_CONFIRMATION_RPC);
  assert.equal(calls[0]?.args.p_customer_name, "Regina");
  assert.equal(calls[0]?.args.p_evidence_source_message_id, "source-1");
});

test("aceita replay idempotente e falha fechado sem conversa ou origem", async () => {
  const result = await enqueueReceivedContractDocumentConfirmation({
    supabase: {
      rpc: async () => ({
        data: {
          message_id: "confirmation-1",
          outbound_idempotency_key: "confirmation-key",
          outcome: "replayed",
        },
        error: null,
      }),
    } as never,
    ...context,
  });
  assert.equal(result.outcome, "replayed");

  await assert.rejects(
    enqueueReceivedContractDocumentConfirmation({
      supabase: { rpc: async () => ({ data: null, error: null }) } as never,
      ...context,
      conversationId: "",
    }),
    /RECEIVED_CONTRACT_DOCUMENT_CONFIRMATION_CONTEXT_INVALID/,
  );
});

test("a migration fixa a mensagem, a classificacao e a chave por confirmacao", () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20261106190000_p9_9_3_c5_received_document_confirmation.sql",
    ),
    "utf8",
  );

  assert.match(migration, /está tudo certo com seu contrato/);
  assert.doesNotMatch(migration, /está tudo certo com seu contrato\.'/);
  assert.match(migration, /'outbound_kind', 'received_contract_document_confirmation'/);
  assert.match(migration, /contract_row\.conversation_id = p_conversation_id/);
  assert.match(migration, /v_c\.conversation_id/);
  assert.match(migration, /received_contract_document_confirmation:' \|\| v_event\.id::text/);
  assert.match(migration, /received_contract_confirmation_event_scope_mismatch/);
  assert.match(migration, /received_contract_confirmation_contract_not_completed/);
  assert.match(migration, /received_contract_confirmation_version_not_completed/);
  assert.match(migration, /received_contract_confirmation_source_scope_mismatch/);
  assert.match(migration, /received_contract_document_confirmation:/);
  assert.match(migration, /v_contract\.status <> 'completed'/);
  assert.match(migration, /v_version\.status <> 'completed'/);
});

test("a migration nova parte do guard resultante do ACK e falha fechado por patch", () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20261106190000_p9_9_3_c5_received_document_confirmation.sql",
    ),
    "utf8",
  );
  const ackMigration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20261106140000_p9_9_3_c5_received_document_ack_outbound_kind.sql",
    ),
    "utf8",
  );
  const originMigration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20261106173000_p9_9_3_c5_received_document_ack_origin_order_fix.sql",
    ),
    "utf8",
  );

  assert.match(ackMigration, /received_contract_document_ack/);
  assert.match(originMigration, /v_message\.metadata ->> 'outbound_origin'/);
  assert.match(
    migration,
    /'canonical_followup',\s+'received_contract_document_ack'[\s\S]*'received_contract_document_confirmation'/,
  );
  assert.match(
    migration,
    /v_initial_outbound_kind <> 'received_contract_document_ack'[\s\S]*v_initial_outbound_kind <> 'received_contract_document_confirmation'/,
  );
  assert.match(
    migration,
    /v_outbound_kind <> 'received_contract_document_ack'[\s\S]*v_outbound_kind <> 'received_contract_document_confirmation'/,
  );
  assert.match(migration, /CONFIRMATION_CLASSIFICATION_PATCH_PATTERN_NOT_FOUND/);
  assert.match(migration, /CONFIRMATION_INITIAL_OPPORTUNITY_PATCH_PATTERN_NOT_FOUND/);
  assert.match(migration, /CONFIRMATION_FINAL_OPPORTUNITY_PATCH_PATTERN_NOT_FOUND/);
  assert.match(migration, /CONFIRMATION_BRANCH_ANCHOR_NOT_FOUND/);
  assert.match(migration, /CONFIRMATION_CLASSIFICATION_PATCH_NOT_APPLIED/);
  assert.match(migration, /CONFIRMATION_INITIAL_OPPORTUNITY_PATCH_NOT_APPLIED/);
  assert.match(migration, /CONFIRMATION_FINAL_OPPORTUNITY_PATCH_NOT_APPLIED/);
  assert.match(migration, /v_message\.metadata ->> 'outbound_origin'/);
  assert.match(migration, /event_row\.conversation_id = p_conversation_id/);
});

test("texto incremental da confirmacao remove o ponto final", () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20261106220000_p9_9_3_c5_contract_message_text_no_period.sql",
    ),
    "utf8",
  );

  assert.match(migration, /está tudo certo com seu contrato/);
  assert.equal(migration.includes("$$v_name || ', está tudo certo com seu contrato'$$"), true);
  assert.equal(migration.includes("$$'Está tudo certo com seu contrato'$$"), true);
});
