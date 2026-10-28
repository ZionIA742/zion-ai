import { strict as assert } from "node:assert";
import {
  SALES_CONTRACT_SEND_FINALIZE_RPC,
  SALES_CONTRACT_SEND_MATERIALIZE_RPC,
  buildSalesContractSendIdempotencyKey,
  buildSalesContractSendMessageMetadata,
  finalizeSalesContractSendBySystem,
  materializeSalesContractSendBySystem,
} from "./contract-send";

function rpcHarness(data: unknown) {
  const calls: Array<{ fn: string; payload: Record<string, unknown> }> = [];
  return {
    calls,
    supabase: { rpc: async (fn: string, payload: Record<string, unknown>) => { calls.push({ fn, payload }); return { data, error: null }; } },
  };
}

async function main() {
  assert.equal(buildSalesContractSendIdempotencyKey({ organizationId: "org-1", storeId: "store-1", contractId: "contract-1", contractVersionId: "version-1" }), "sales_contract_send:org-1:store-1:contract-1:version-1");
  const metadata = buildSalesContractSendMessageMetadata({ organizationId: "org-1", storeId: "store-1", contractId: "contract-1", contractVersionId: "version-1", outboundIdempotencyKey: "sales_contract_send:org-1:store-1:contract-1:version-1", baseMetadata: { storage_path: "contract.pdf", mime_type: "application/pdf" }, actorUserId: "user-1" });
  assert.equal(metadata.outbound_origin, "sales_contract_send"); assert.equal(metadata.send_external, true); assert.equal(metadata.sent_by_user_id, "user-1");
  const materialize = rpcHarness([{ message_id: "message-1", outbound_idempotency_key: "sales_contract_send:org-1:store-1:contract-1:version-1", outbound_delivery_state: "pending", sales_contract_id: "contract-1", sales_contract_version_id: "version-1", outcome: "queued" }]);
  await materializeSalesContractSendBySystem({ supabase: materialize.supabase, organizationId: "org-1", storeId: "store-1", contractId: "contract-1", contractVersionId: "version-1", conversationId: "conversation-1", messageContent: "Segue o contrato.", messageMetadata: metadata });
  assert.equal(materialize.calls[0].fn, SALES_CONTRACT_SEND_MATERIALIZE_RPC); assert.equal(materialize.calls[0].payload.p_idempotency_key, "sales_contract_send:org-1:store-1:contract-1:version-1");
  const finalize = rpcHarness([{ sales_contract_id: "contract-1", sales_contract_version_id: "version-1", message_id: "message-1", external_message_id: "wamid-1", sent_at: "2026-10-08T12:00:00Z", conversation_event_created: true, outcome: "finalized" }]);
  await finalizeSalesContractSendBySystem({ supabase: finalize.supabase, organizationId: "org-1", storeId: "store-1", contractId: "contract-1", contractVersionId: "version-1", messageId: "message-1" });
  assert.equal(finalize.calls[0].fn, SALES_CONTRACT_SEND_FINALIZE_RPC); assert.equal(finalize.calls[0].payload.p_source, "system_sales_contract_send_reconciliation");
  console.log("PASS 4 contract send helper tests");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
