import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  bootstrapCommercialContextBeforeInsert,
  resolveWhatsappInboundThreadBySystem,
} from "./whatsapp-inbox-processor.js";

function readProcessorSource() {
  return readFileSync(
    join(process.cwd(), "src/lib/server/whatsapp-inbox-processor.ts"),
    "utf8",
  );
}

test("resolveWhatsappInboundThreadBySystem preserves explicit scope in the RPC payload", async () => {
  const calls: Array<{ fn: string; payload: Record<string, unknown> }> = [];
  const result = await resolveWhatsappInboundThreadBySystem({
    supabase: {
      async rpc(fn, payload) {
        calls.push({ fn, payload });
        return {
          data: {
            lead_id: "lead-1",
            conversation_id: "conv-1",
            normalized_whatsapp_identity: "5511999999999",
            thread_state: "created_active_thread",
            lead_created: true,
            conversation_created: true,
          },
          error: null,
        };
      },
    },
    organizationId: "org-1",
    storeId: "store-1",
    whatsappIdentity: "5511999999999",
    contactName: "Cliente",
  });

  assert.deepEqual(calls, [
    {
      fn: "resolve_whatsapp_inbound_thread_by_system",
      payload: {
        p_organization_id: "org-1",
        p_store_id: "store-1",
        p_whatsapp_identity: "5511999999999",
        p_contact_name: "Cliente",
      },
    },
  ]);
  assert.deepEqual(result, {
    leadId: "lead-1",
    conversationId: "conv-1",
    normalizedWhatsappIdentity: "5511999999999",
    threadState: "created_active_thread",
    leadCreated: true,
    conversationCreated: true,
  });
});

test("resolveWhatsappInboundThreadBySystem rejects empty or malformed RPC contracts", async () => {
  await assert.rejects(
    resolveWhatsappInboundThreadBySystem({
      supabase: { async rpc() { return { data: null, error: null }; } },
      organizationId: "org-1",
      storeId: "store-1",
      whatsappIdentity: "5511999999999",
    }),
    /retornou 0 linhas/,
  );

  await assert.rejects(
    resolveWhatsappInboundThreadBySystem({
      supabase: {
        async rpc() {
          return {
            data: {
              lead_id: "lead-1",
              conversation_id: "",
              normalized_whatsapp_identity: "5511999999999",
              thread_state: "existing_active_thread",
            },
            error: null,
          };
        },
      },
      organizationId: "org-1",
      storeId: "store-1",
      whatsappIdentity: "5511999999999",
    }),
    /contrato inválido/,
  );
});

test("bootstrapCommercialContextBeforeInsert preserves explicit ids and first opportunity", async () => {
  const rpcCalls: Array<{ fn: string; payload: Record<string, unknown> }> = [];
  const result = await bootstrapCommercialContextBeforeInsert({
    supabase: {
      async rpc(fn, payload) {
        rpcCalls.push({ fn, payload });
        return {
          data: {
            customer_id: "customer-1",
            customer_channel_identity_id: "identity-1",
            customer_store_link_id: "store-link-1",
            lead_customer_link_id: "lead-link-1",
            commercial_opportunity_id: "opp-1",
            bootstrap_state: "created_first_contextual_opportunity",
            customer_created: true,
            customer_channel_identity_created: true,
            customer_store_link_created: true,
            lead_customer_link_created: true,
            commercial_opportunity_created: true,
          },
          error: null,
        };
      },
    },
    organizationId: "org-1",
    storeId: "store-1",
    leadId: "lead-1",
    conversationId: "conv-1",
    whatsappIdentity: "5511999999999",
    contactName: "Cliente Teste",
  });

  assert.equal(rpcCalls[0]?.fn, "bootstrap_first_commercial_context_for_inbound_by_system");
  assert.equal(result.commercialOpportunityId, "opp-1");
  assert.equal(result.bootstrapState, "created_first_contextual_opportunity");
  assert.equal(result.commercialOpportunityCreated, true);
});

test("bootstrapCommercialContextBeforeInsert allows history fail-closed without fabricating opportunity", async () => {
  const result = await bootstrapCommercialContextBeforeInsert({
    supabase: {
      async rpc() {
        return {
          data: {
            customer_id: "customer-1",
            customer_channel_identity_id: "identity-1",
            customer_store_link_id: "store-link-1",
            lead_customer_link_id: "lead-link-1",
            commercial_opportunity_id: null,
            bootstrap_state: "historical_context_requires_manual_resolution",
            commercial_opportunity_created: false,
          },
          error: null,
        };
      },
    },
    organizationId: "org-1",
    storeId: "store-1",
    leadId: "lead-1",
    conversationId: "conv-1",
    whatsappIdentity: "5511999999999",
  });

  assert.equal(result.bootstrapState, "historical_context_requires_manual_resolution");
  assert.equal(result.commercialOpportunityId, null);
});

test("bootstrapCommercialContextBeforeInsert allows exact ambiguity as a safe pending state", async () => {
  const result = await bootstrapCommercialContextBeforeInsert({
    supabase: {
      async rpc() {
        return {
          data: {
            customer_id: "customer-1",
            customer_channel_identity_id: "identity-1",
            customer_store_link_id: "store-link-1",
            lead_customer_link_id: "lead-link-1",
            commercial_opportunity_id: null,
            bootstrap_state: "commercial_opportunity_exact_context_ambiguous",
            commercial_opportunity_created: false,
          },
          error: null,
        };
      },
    },
    organizationId: "org-1",
    storeId: "store-1",
    leadId: "lead-1",
    conversationId: "conv-1",
    whatsappIdentity: "5511999999999",
  });

  assert.equal(result.commercialOpportunityId, null);
  assert.equal(result.bootstrapState, "commercial_opportunity_exact_context_ambiguous");
});

test("bootstrapCommercialContextBeforeInsert accepts an explicit active context even with historical opportunities", async () => {
  const result = await bootstrapCommercialContextBeforeInsert({
    supabase: {
      async rpc() {
        return {
          data: {
            customer_id: "customer-1",
            customer_channel_identity_id: "identity-1",
            customer_store_link_id: "store-link-1",
            lead_customer_link_id: "lead-link-1",
            commercial_opportunity_id: "opp-active",
            bootstrap_state: "existing_active_commercial_context",
            commercial_opportunity_created: false,
          },
          error: null,
        };
      },
    },
    organizationId: "org-1",
    storeId: "store-1",
    leadId: "lead-1",
    conversationId: "conv-1",
    whatsappIdentity: "5511999999999",
  });

  assert.equal(result.commercialOpportunityId, "opp-active");
  assert.equal(result.bootstrapState, "existing_active_commercial_context");
});

test("bootstrapCommercialContextBeforeInsert rejects empty, unknown or internally inconsistent RPC rows", async () => {
  const baseArgs = {
    organizationId: "org-1",
    storeId: "store-1",
    leadId: "lead-1",
    conversationId: "conv-1",
    whatsappIdentity: "5511999999999",
  };

  await assert.rejects(
    bootstrapCommercialContextBeforeInsert({
      ...baseArgs,
      supabase: { async rpc() { return { data: null, error: null }; } },
    }),
    /retornou 0 linhas/,
  );

  await assert.rejects(
    bootstrapCommercialContextBeforeInsert({
      ...baseArgs,
      supabase: {
        async rpc() {
          return {
            data: {
              customer_id: "customer-1",
              customer_channel_identity_id: "identity-1",
              customer_store_link_id: "store-link-1",
              lead_customer_link_id: "lead-link-1",
              commercial_opportunity_id: "opp-invented",
              bootstrap_state: "historical_context_requires_manual_resolution",
            },
            error: null,
          };
        },
      },
    }),
    /contrato inválido/,
  );

  await assert.rejects(
    bootstrapCommercialContextBeforeInsert({
      ...baseArgs,
      supabase: {
        async rpc() {
          return {
            data: {
              customer_id: "customer-1",
              customer_channel_identity_id: "identity-1",
              customer_store_link_id: "store-link-1",
              lead_customer_link_id: "lead-link-1",
              commercial_opportunity_id: null,
              bootstrap_state: "unknown_state",
            },
            error: null,
          };
        },
      },
    }),
    /contrato inválido/,
  );
});

test("RPC errors are surfaced instead of becoming commercial success", async () => {
  await assert.rejects(
    resolveWhatsappInboundThreadBySystem({
      supabase: { async rpc() { return { data: null, error: { message: "lead identity is ambiguous" } }; } },
      organizationId: "org-1",
      storeId: "store-1",
      whatsappIdentity: "5511999999999",
    }),
    /lead identity is ambiguous/,
  );

  await assert.rejects(
    bootstrapCommercialContextBeforeInsert({
      supabase: { async rpc() { return { data: null, error: { message: "identity conflict" } }; } },
      organizationId: "org-1",
      storeId: "store-1",
      leadId: "lead-1",
      conversationId: "conv-1",
      whatsappIdentity: "5511999999999",
    }),
    /identity conflict/,
  );
});

test("processor resolves thread then commercial context before insert_message and keeps Sales AI after", () => {
  const source = readProcessorSource();
  const threadIndex = source.indexOf("await resolveWhatsappInboundThreadBySystem({");
  const bootstrapIndex = source.indexOf("await bootstrapCommercialContextBeforeInsert({", threadIndex);
  const insertIndex = source.indexOf("inserted = await insertIncomingMessage({", bootstrapIndex);
  const dispatchIndex = source.indexOf("aiDispatchResult = await dispatchAiSalesReplyForConversation({", insertIndex);

  assert.equal(threadIndex > -1, true);
  assert.equal(bootstrapIndex > threadIndex, true);
  assert.equal(insertIndex > bootstrapIndex, true);
  assert.equal(dispatchIndex > insertIndex, true);
});

test("processor no longer uses latest/first lead or conversation resolution helpers", () => {
  const source = readProcessorSource();
  assert.equal(source.includes("async function findLeadByPhone("), false);
  assert.equal(source.includes("async function findOrCreateLead("), false);
  assert.equal(source.includes("async function findConversation("), false);
  assert.equal(source.includes("async function findOrCreateConversation("), false);
  assert.equal(source.includes("resolve_whatsapp_inbound_thread_by_system"), true);
});
