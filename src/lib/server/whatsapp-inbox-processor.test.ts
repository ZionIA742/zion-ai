import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  dispatchAiSalesReplyForConversation,
  bootstrapCommercialContextBeforeInsert,
  extractIncomingMessage,
  processWhatsappInbox,
  resolveWhatsappInboundThreadBySystem,
} from "./whatsapp-inbox-processor.js";

function readProcessorSource() {
  return readFileSync(
    join(process.cwd(), "src/lib/server/whatsapp-inbox-processor.ts"),
    "utf8",
  );
}

function jsonFetchResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function processResponsibleTerminalScenario(args: {
  currentResultEventId?: string;
  currentMissing?: boolean;
  decisionError?: boolean;
  responseIdMissing?: boolean;
}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  process.env.OPENAI_API_KEY = "openai-test";
  const previousFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: string }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const method = init?.method || "GET";
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ url, method, body });
    if (url.includes("/rest/v1/channel_whatsapp_inbox") && method === "GET") return jsonFetchResponse([{ id: "inbox-terminal", organization_id: "org-1", store_id: "store-1", provider: "whatsapp", external_event_id: "event-terminal", payload: { source: "meta_whatsapp_webhook", event_kind: "message", phone_number_id: "phone-1", message: { id: "inbound-terminal", from: "5511999999999", type: "text", text: { body: "A visita ocorreu" }, context: { id: "outbound-context" } } }, received_at: "2026-09-29T12:00:00.000Z", processed_at: null, processing_error: null }]);
    if (url.includes("/rest/v1/messages") && method === "GET") return jsonFetchResponse([]);
    if (url.includes("/rest/v1/store_responsibles") && method === "GET") return jsonFetchResponse([{ id: "responsible-1", name: "Responsavel", role: "owner", whatsapp_number: "5511999999999" }]);
    if (url.includes("/rest/v1/rpc/record_post_technical_visit_followup_response")) return jsonFetchResponse({ handled: true, correlation_status: "matched", response_id: args.responseIdMissing ? null : "response-terminal" });
    if (url.includes("/rest/v1/schedule_post_appointment_followup_responses") && method === "GET") return jsonFetchResponse([{ id: "response-terminal", organization_id: "org-1", store_id: "store-1", raw_content: "A visita ocorreu" }]);
    if (url.includes("/rest/v1/store_technical_visit_result_events") && method === "GET") return jsonFetchResponse([{ id: "result-old", organization_id: "org-1", store_id: "store-1", appointment_id: "appointment-1", source_response_id: "response-terminal" }]);
    if (url.includes("/rest/v1/store_technical_visit_result_current") && method === "GET") return jsonFetchResponse(args.currentMissing ? [] : [{ organization_id: "org-1", store_id: "store-1", appointment_id: "appointment-1", current_result_event_id: args.currentResultEventId || "result-new" }]);
    if (url.includes("/rest/v1/rpc/decide_post_technical_visit_by_system")) return args.decisionError ? jsonFetchResponse({ message: "decision unavailable" }, 500) : jsonFetchResponse([]);
    if (url.includes("/rest/v1/channel_whatsapp_inbox") && method === "PATCH") return jsonFetchResponse([]);
    if (url.includes("api.openai.com/v1/responses")) throw new Error("LLM must not run for terminal result");
    throw new Error(`unexpected terminal fetch: ${method} ${url}`);
  }) as typeof fetch;
  try {
    return { result: await processWhatsappInbox({ organizationId: "org-1", storeId: "store-1", limit: 1 }), calls };
  } finally {
    globalThis.fetch = previousFetch;
  }
}

test("responsible primary inbound is recorded before the customer thread path", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  process.env.OPENAI_API_KEY = "openai-test";

  const previousFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: string }> = [];

  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const method = init?.method || "GET";
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ url, method, body });

    if (url.includes("/rest/v1/channel_whatsapp_inbox") && method === "GET") {
      return jsonFetchResponse([
        {
          id: "inbox-responsible",
          organization_id: "org-1",
          store_id: "store-1",
          provider: "whatsapp",
          external_event_id: "event-responsible",
          payload: {
            source: "meta_whatsapp_webhook",
            event_kind: "message",
            phone_number_id: "phone-1",
            message: {
              id: "inbound-responsible",
              from: "5511999999999",
              type: "text",
              text: { body: "A visita ocorreu" },
              context: { id: "outbound-context" },
            },
          },
          received_at: "2026-09-29T12:00:00.000Z",
          processed_at: null,
          processing_error: null,
        },
      ]);
    }

    if (url.includes("/rest/v1/messages") && method === "GET") {
      return jsonFetchResponse([]);
    }

    if (url.includes("/rest/v1/store_responsibles") && method === "GET") {
      return jsonFetchResponse([
        {
          id: "responsible-1",
          name: "Responsável",
          role: "owner",
          whatsapp_number: "5511999999999",
        },
      ]);
    }

    if (url.includes("/rest/v1/rpc/record_post_technical_visit_followup_response")) {
      return jsonFetchResponse({
        handled: true,
        correlation_status: "matched",
        response_id: "response-1",
      });
    }

    if (url.includes("/rest/v1/schedule_post_appointment_followup_responses") && method === "GET") {
      return jsonFetchResponse([
        {
          id: "response-1",
          organization_id: "org-1",
          store_id: "store-1",
          raw_content: "A visita ocorreu",
        },
      ]);
    }

    if (url.includes("/rest/v1/store_technical_visit_result_events") && method === "GET") {
      return jsonFetchResponse([]);
    }

    if (url.includes("api.openai.com/v1/responses") && method === "POST") {
      return jsonFetchResponse({
        output_text: JSON.stringify({
          result_kind: "pending",
          evidence_text: "A visita ocorreu",
          adjustment_summary: null,
          uncertainty_reason: null,
          occurrence: "occurred",
          occurrence_evidence_text: "A visita ocorreu",
        }),
      });
    }

    if (url.includes("/rest/v1/rpc/persist_post_technical_visit_result_by_system")) {
      return jsonFetchResponse([{ event_id: "result-event-1" }]);
    }

    if (url.includes("/rest/v1/rpc/decide_post_technical_visit_by_system")) {
      return jsonFetchResponse([{
        decision_id: "decision-1",
        organization_id: "org-1",
        store_id: "store-1",
        appointment_id: "appointment-1",
        commercial_opportunity_id: "opportunity-1",
        lifecycle_cycle: 1,
        result_event_id: "result-event-1",
        decision_kind: "needs_resolution",
        decision_reason: "technical_visit_result_pending",
        decision_basis: {},
        replayed: false,
      }]);
    }

    if (url.includes("/rest/v1/channel_whatsapp_inbox") && method === "PATCH") {
      return jsonFetchResponse([]);
    }

    throw new Error(`unexpected responsible inbound fetch: ${method} ${url}`);
  }) as typeof fetch;

  try {
    const result = await processWhatsappInbox({
      organizationId: "org-1",
      storeId: "store-1",
      limit: 1,
    });

    assert.equal(result.succeeded, 1);
    assert.equal(result.results[0]?.detail, "responsible_inbound_matched");
    assert.equal(
      calls.some((call) => call.url.includes("resolve_whatsapp_inbound_thread_by_system")),
      false,
    );
    assert.equal(
      calls.some((call) => call.url.includes("generateAndSaveAiSalesReply")),
      false,
    );

    const recordCall = calls.find((call) =>
      call.url.includes("record_post_technical_visit_followup_response"),
    );
    assert.ok(recordCall);
    const recordBody = JSON.parse(recordCall.body) as Record<string, unknown>;
    assert.equal(recordBody.p_inbound_external_message_id, "inbound-responsible");
    assert.equal(recordBody.p_replied_to_external_message_id, "outbound-context");
    assert.equal(
      calls.some(
        (call) =>
          call.url.includes("channel_whatsapp_inbox") && call.method === "PATCH",
      ),
      true,
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("inbox marks superseded responsible inbound as processed without decision", async () => {
  const { result, calls } = await processResponsibleTerminalScenario({});
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 0);
  assert.equal(calls.some((call) => call.url.includes("decide_post_technical_visit_by_system")), false);
  const successPatch = calls.find((call) => call.method === "PATCH");
  assert.ok(successPatch);
  const payload = JSON.parse(successPatch.body) as Record<string, unknown>;
  assert.equal(payload.processing_error, null);
  assert.equal(typeof payload.processed_at, "string");
});

test("inbox keeps current-missing responsible inbound retryable", async () => {
  const { result, calls } = await processResponsibleTerminalScenario({ currentMissing: true });
  assert.equal(result.succeeded, 0);
  assert.equal(result.failed, 1);
  const failurePatch = calls.find((call) => call.method === "PATCH");
  assert.ok(failurePatch);
  const payload = JSON.parse(failurePatch.body) as Record<string, unknown>;
  assert.equal(typeof payload.processing_error, "string");
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "processed_at"), false);
});

test("inbox keeps decision failure retryable instead of converting it to success", async () => {
  const { result, calls } = await processResponsibleTerminalScenario({ currentResultEventId: "result-old", decisionError: true });
  assert.equal(result.succeeded, 0);
  assert.equal(result.failed, 1);
  const failurePatch = calls.find((call) => call.method === "PATCH");
  assert.ok(failurePatch);
  const payload = JSON.parse(failurePatch.body) as Record<string, unknown>;
  assert.equal(typeof payload.processing_error, "string");
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "processed_at"), false);
});

test("inbox fails closed when handled response has no response id", async () => {
  const { result, calls } = await processResponsibleTerminalScenario({ responseIdMissing: true });
  assert.equal(result.succeeded, 0);
  assert.equal(result.failed, 1);
  const failurePatch = calls.find((call) => call.method === "PATCH");
  assert.ok(failurePatch);
  const payload = JSON.parse(failurePatch.body) as Record<string, unknown>;
  assert.match(String(payload.processing_error), /RESPONSE_ID_MISSING/);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "processed_at"), false);
});

test("non-responsible inbound continues to the customer thread resolver", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";

  const previousFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const method = init?.method || "GET";
    calls.push(`${method} ${url}`);

    if (url.includes("/rest/v1/channel_whatsapp_inbox") && method === "GET") {
      return jsonFetchResponse([
        {
          id: "inbox-customer",
          organization_id: "org-1",
          store_id: "store-1",
          provider: "whatsapp",
          external_event_id: "event-customer",
          payload: {
            source: "meta_whatsapp_webhook",
            event_kind: "message",
            phone_number_id: "phone-1",
            message: {
              id: "inbound-customer",
              from: "5511888888888",
              type: "text",
              text: { body: "Olá" },
            },
          },
          received_at: "2026-09-29T12:00:00.000Z",
          processed_at: null,
          processing_error: null,
        },
      ]);
    }

    if (url.includes("/rest/v1/messages") && method === "GET") {
      return jsonFetchResponse([]);
    }

    if (url.includes("/rest/v1/store_responsibles") && method === "GET") {
      return jsonFetchResponse([
        {
          id: "responsible-1",
          name: "Responsável",
          role: "owner",
          whatsapp_number: "5511999999999",
        },
      ]);
    }

    if (url.includes("/rest/v1/rpc/resolve_whatsapp_inbound_thread_by_system")) {
      throw new Error("customer_thread_resolver_reached");
    }

    if (url.includes("/rest/v1/channel_whatsapp_inbox") && method === "PATCH") {
      return jsonFetchResponse([]);
    }

    throw new Error(`unexpected customer inbound fetch: ${method} ${url}`);
  }) as typeof fetch;

  try {
    const result = await processWhatsappInbox({
      organizationId: "org-1",
      storeId: "store-1",
      limit: 1,
    });

    assert.equal(result.failed, 1);
    assert.match(result.results[0]?.detail || "", /customer_thread_resolver_reached/);
    assert.equal(
      calls.some((call) => call.includes("record_post_technical_visit_followup_response")),
      false,
    );
    assert.equal(
      calls.some((call) => call.includes("resolve_whatsapp_inbound_thread_by_system")),
      true,
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

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

test("dispatchAiSalesReplyForConversation applies the live status, takeover, terminal, unknown, and pause gates", async () => {
  const cases = [
    { status: "active", human: false, expected: "called" },
    { status: "qualificacao", human: false, expected: "called" },
    { status: "qualificacao", human: true, expected: "skipped_human_active" },
    { status: "closed", human: false, expected: "failed" },
    { status: "unknown_status", human: false, expected: "failed" },
  ] as const;

  for (const scenario of cases) {
    let aiCalls = 0;
    const supabase = {
      from(table: string) {
        const builder = {
          select() {
            return builder;
          },
          eq() {
            return builder;
          },
          async maybeSingle() {
            if (table === "conversations") {
              return {
                data: {
                  id: "conv-1",
                  organization_id: "org-1",
                  lead_id: "lead-1",
                  status: scenario.status,
                  is_human_active: scenario.human,
                },
                error: null,
              };
            }
            return { data: null, error: null };
          },
        };
        return builder;
      },
    };

    const result = await dispatchAiSalesReplyForConversation({
      supabase: supabase as never,
      organizationId: "org-1",
      storeId: "store-1",
      conversationId: "conv-1",
      runAiFlow: async () => {
        aiCalls += 1;
        return {
          ok: true,
          aiText: "ok",
          context: {},
          usage: null,
          persisted: true,
          messageId: "ai-1",
        };
      },
    });

    assert.equal(result.ai_status, scenario.expected, scenario.status);
    assert.equal(aiCalls, scenario.expected === "called" ? 1 : 0, scenario.status);
  }

  let pausedCalls = 0;
  const pausedSupabase = {
    from(table: string) {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        async maybeSingle() {
          if (table === "conversations") {
            return {
              data: {
                id: "conv-1",
                organization_id: "org-1",
                lead_id: "lead-1",
                status: "qualificacao",
                is_human_active: false,
              },
              error: null,
            };
          }
          return {
            data: {
              conversation_id: "conv-1",
              next_resume_at: "2999-01-01T00:00:00.000Z",
            },
            error: null,
          };
        },
      };
      return builder;
    },
  };

  const pausedResult = await dispatchAiSalesReplyForConversation({
    supabase: pausedSupabase as never,
    organizationId: "org-1",
    storeId: "store-1",
    conversationId: "conv-1",
    runAiFlow: async () => {
      pausedCalls += 1;
      throw new Error("future window must not run");
    },
  });
  assert.equal(pausedResult.ai_status, "skipped_ai_paused");
  assert.equal(pausedCalls, 0);
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

test("processor marks self-originated and group messages as non-AI inputs", () => {
  const selfMessage = extractIncomingMessage({
    source: "meta_whatsapp_webhook",
    event_kind: "message",
    phone_number_id: "phone-1",
    display_phone_number: "+55 11 90000-0000",
    message: {
      id: "self-1",
      from: "5511900000000",
      type: "text",
      text: { body: "enviado pela loja" },
    },
  });
  const echoMessage = extractIncomingMessage({
    source: "meta_whatsapp_webhook",
    event_kind: "smb_message_echoes",
    phone_number_id: "phone-1",
    message: {
      id: "echo-1",
      from: "5511999999999",
      type: "text",
      text: { body: "echo" },
    },
  });
  const groupMessage = extractIncomingMessage({
    source: "meta_whatsapp_webhook",
    event_kind: "message",
    phone_number_id: "phone-1",
    message: {
      id: "group-1",
      from: "5511999999999",
      group_id: "group-identity",
      type: "text",
      text: { body: "grupo" },
    },
  });

  assert.equal(selfMessage.isSelfOriginated, true);
  assert.equal(echoMessage.isSelfOriginated, true);
  assert.equal(groupMessage.isGroupMessage, true);
});

async function processCustomerMediaScenario(args: {
  type: "image" | "audio" | "video" | "document";
  caption?: string;
  filename?: string;
  existingMessage?: Record<string, unknown> | null;
  transcriptionFailure?: boolean;
  visualFailure?: boolean;
  metadataUpdateReturnsNoRows?: boolean;
}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  process.env.META_WHATSAPP_ACCESS_TOKEN = "meta-test";
  process.env.OPENAI_API_KEY = "openai-test";

  const previousFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: string }> = [];
  let messageReads = 0;
  let inboxReads = 0;
  let insertedMetadata: Record<string, unknown> | null = null;
  const persistedMessage = args.existingMessage || {
    id: "message-media-1",
    conversation_id: "conversation-1",
    lead_id: "lead-1",
    store_id: "store-1",
    external_message_id: "external-media-1",
    message_type: args.type,
    content: args.caption || `Cliente enviou uma ${args.type}.`,
    metadata: {
      media_origin: "customer",
      storage_bucket: "zion-store-files",
      storage_path: "org-1/store-1/whatsapp-inbound/conversation-1/media.bin",
      original_file_name: args.filename || `media.${args.type === "audio" ? "webm" : "bin"}`,
      mime_type:
        args.type === "audio"
          ? "audio/webm"
          : args.type === "image"
            ? "image/jpeg"
            : args.type === "video"
              ? "video/mp4"
              : "application/pdf",
    },
  };

  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const method = init?.method || "GET";
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ url, method, body });

    if (url.includes("/rest/v1/channel_whatsapp_inbox") && method === "GET") {
      inboxReads += 1;
      return inboxReads === 1
        ? jsonFetchResponse([{
            id: "inbox-media-1",
            organization_id: "org-1",
            store_id: "store-1",
            provider: "whatsapp",
            external_event_id: "event-media-1",
            payload: {
              source: "meta_whatsapp_webhook",
              event_kind: "message",
              phone_number_id: "phone-1",
              message: {
                id: "external-media-1",
                from: "5511999999999",
                type: args.type,
                [args.type]: {
                  id: "meta-media-1",
                  mime_type: persistedMessage.metadata?.mime_type,
                  caption: args.caption,
                  filename: args.filename,
                },
              },
            },
            received_at: "2026-10-08T12:00:00.000Z",
            processed_at: null,
            processing_error: null,
          }])
        : jsonFetchResponse([]);
    }

    if (url.includes("/rest/v1/messages") && method === "GET") {
      messageReads += 1;
      if (args.existingMessage) return jsonFetchResponse([args.existingMessage]);
      return messageReads === 1 ? jsonFetchResponse([]) : jsonFetchResponse([{
        ...persistedMessage,
        metadata: insertedMetadata || persistedMessage.metadata,
      }]);
    }

    if (url.includes("/rest/v1/store_responsibles") && method === "GET") {
      return jsonFetchResponse([]);
    }

    if (url.includes("/rest/v1/rpc/resolve_whatsapp_inbound_thread_by_system")) {
      return jsonFetchResponse([{
        lead_id: "lead-1",
        conversation_id: "conversation-1",
        normalized_whatsapp_identity: "5511999999999",
        thread_state: "existing_active_thread",
      }]);
    }

    if (url.includes("/rest/v1/rpc/bootstrap_first_commercial_context_for_inbound_by_system")) {
      return jsonFetchResponse([{
        customer_id: "customer-1",
        customer_channel_identity_id: "identity-1",
        customer_store_link_id: "store-link-1",
        lead_customer_link_id: "lead-link-1",
        commercial_opportunity_id: "opportunity-1",
        bootstrap_state: "existing_active_commercial_context",
      }]);
    }

    if (url.includes("/rest/v1/rpc/insert_message")) {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      insertedMetadata = parsed.p_metadata as Record<string, unknown>;
      if (parsed.p_message_type === "document") {
        assert.equal(parsed.p_media_url, insertedMetadata.storage_path);
        assert.equal(typeof parsed.p_media_url, "string");
        assert.notEqual(parsed.p_media_url, "");
        assert.equal(insertedMetadata.attachment_kind, "file");
      }
      return jsonFetchResponse([{
        id: "message-media-1",
        conversation_id: "conversation-1",
        lead_id: "lead-1",
        store_id: "store-1",
        external_message_id: "external-media-1",
      }]);
    }

    if (url.includes("/rest/v1/conversations") && method === "GET") {
      return jsonFetchResponse([{
        id: "conversation-1",
        organization_id: "org-1",
        lead_id: "lead-1",
        status: "active",
        is_human_active: false,
      }]);
    }

    if (url.includes("/rest/v1/conversation_ai_window_state") && method === "GET") {
      return jsonFetchResponse([]);
    }

    if (url.includes("/rest/v1/store_assistant_operational_tasks") && method === "GET") {
      return jsonFetchResponse([]);
    }

    if (url.includes("/rest/v1/messages") && method === "PATCH") {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      const metadata = parsed.metadata as Record<string, unknown> | undefined;
      if (metadata?.audio_transcript || metadata?.location_photo_analysis) {
        calls.push({ url: "event:metadata_update", method: "PATCH", body });
      }
      return args.metadataUpdateReturnsNoRows
        ? jsonFetchResponse(null)
        : jsonFetchResponse({ id: "message-media-1" });
    }

    if (url.includes("/rest/v1/channel_whatsapp_inbox") && method === "PATCH") {
      return jsonFetchResponse([]);
    }

    if (url.includes("graph.facebook.com") && method === "GET") {
      return jsonFetchResponse({
        url: "https://media.test/object",
        mime_type: persistedMessage.metadata?.mime_type,
        sha256: "sha-media",
      });
    }

    if (url === "https://media.test/object" && method === "GET") {
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": String(persistedMessage.metadata?.mime_type) },
      });
    }

    if (url.includes("/storage/v1/object/") && method === "GET") {
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }

    if (url.includes("api.openai.com/v1/audio/transcriptions") && method === "POST") {
      return args.transcriptionFailure
        ? jsonFetchResponse({ error: { message: "transcription failed" } }, 500)
        : jsonFetchResponse({ text: "Cliente quer instalar uma piscina." });
    }

    if (url.includes("api.openai.com/v1/responses") && method === "POST") {
      return args.visualFailure
        ? jsonFetchResponse({ error: { message: "visual failed" } }, 500)
        : jsonFetchResponse({
            output_text: JSON.stringify({
              summary: "O local aparenta ter espaco para avaliacao.",
              space_size_signal: "medium",
              environment_type: "outdoor",
              access_constraints: [],
              ground_context: [],
              confidence: "medium",
              needs_measurements_confirmation: true,
              safe_commercial_hints: ["confirmar medidas"],
            }),
          });
    }

    if (url.includes("/storage/v1/object/") && method !== "GET") {
      return jsonFetchResponse({});
    }

    throw new Error(`unexpected media fetch: ${method} ${url}`);
  }) as typeof fetch;

  try {
    const aiCalls: string[] = [];
    const result = await processWhatsappInbox({
      organizationId: "org-1",
      storeId: "store-1",
      limit: 1,
      runAiFlow: async () => {
        aiCalls.push("sales-ai");
        calls.push({ url: "event:sales-ai", method: "CALL", body: "" });
        return { ok: true, aiText: "ok", context: {}, usage: null, persisted: true, messageId: "ai-1" };
      },
    });
    return { result, calls, aiCalls };
  } finally {
    globalThis.fetch = previousFetch;
  }
}

test("customer audio follows insert, transcription metadata, then Sales AI", async () => {
  const { result, calls, aiCalls } = await processCustomerMediaScenario({ type: "audio" });
  assert.equal(result.failed, 0);
  assert.deepEqual(aiCalls, ["sales-ai"]);
  const metadataIndex = calls.findIndex(
    (call) => call.method === "PATCH" && call.body.includes("audio_transcript"),
  );
  const aiIndex = calls.findIndex((call) => call.url === "event:sales-ai");
  assert.equal(metadataIndex >= 0, true);
  assert.equal(aiIndex > metadataIndex, true);
  const insertIndex = calls.findIndex((call) => call.url.includes("/rpc/insert_message"));
  assert.equal(insertIndex < metadataIndex, true);
  const metadataPatch = calls[metadataIndex];
  assert.match(metadataPatch.body, /audio_transcript/);
  assert.match(metadataPatch.body, /transcription_status/);
  assert.match(metadataPatch.url, /organization_id=eq\.org-1/);
  assert.match(metadataPatch.url, /store_id=eq\.store-1/);
  assert.match(metadataPatch.url, /conversation_id=eq\.conversation-1/);
});

test("already transcribed audio retry avoids transcription and duplicate insert", async () => {
  const existing = {
    id: "message-media-1",
    conversation_id: "conversation-1",
    lead_id: "lead-1",
    store_id: "store-1",
    external_message_id: "external-media-1",
    message_type: "audio",
    content: "Cliente enviou um audio.",
    metadata: {
      storage_bucket: "zion-store-files",
      storage_path: "org-1/store-1/audio.webm",
      original_file_name: "audio.webm",
      mime_type: "audio/webm",
      audio_transcript: "ja transcrito",
      transcription_status: "succeeded",
    },
  };
  const { result, calls, aiCalls } = await processCustomerMediaScenario({ type: "audio", existingMessage: existing });
  assert.equal(result.failed, 0);
  assert.equal(calls.some((call) => call.url.includes("/rpc/insert_message")), false);
  assert.equal(calls.some((call) => call.url.includes("/v1/audio/transcriptions")), false);
  assert.deepEqual(aiCalls, ["sales-ai"]);
});

test("metadata update with zero rows remains retryable and does not dispatch Sales AI", async () => {
  const { result, calls, aiCalls } = await processCustomerMediaScenario({
    type: "audio",
    metadataUpdateReturnsNoRows: true,
  });
  assert.equal(result.failed, 1);
  assert.deepEqual(aiCalls, []);
  assert.equal(
    calls.some((call) => call.method === "PATCH" && call.body.includes('"processed_at"')),
    false,
  );
});

test("audio transcription failure stays retryable and does not dispatch Sales AI", async () => {
  const { result, calls, aiCalls } = await processCustomerMediaScenario({ type: "audio", transcriptionFailure: true });
  assert.equal(result.failed, 1);
  assert.deepEqual(aiCalls, []);
  assert.equal(calls.some((call) => call.method === "PATCH" && call.body.includes('"processed_at"')), false);
  assert.equal(calls.some((call) => call.method === "PATCH" && call.body.includes("transcription_error")), true);
});

test("customer location photo follows classification, analysis metadata, then Sales AI", async () => {
  const { result, calls, aiCalls } = await processCustomerMediaScenario({ type: "image", caption: "foto do local" });
  assert.equal(result.failed, 0);
  assert.deepEqual(aiCalls, ["sales-ai"]);
  assert.equal(calls.some((call) => call.url.includes("/v1/responses")), true);
  const insertCall = calls.find((call) => call.url.includes("/rpc/insert_message"));
  assert.ok(insertCall);
  assert.match(insertCall.body, /customer_location_photo/);
  const metadataCall = calls.find((call) => call.url === "event:metadata_update");
  assert.ok(metadataCall);
  assert.match(metadataCall.body, /location_photo_analysis/);
});

test("already analyzed location photo retry avoids visual analysis", async () => {
  const existing = {
    id: "message-media-1",
    conversation_id: "conversation-1",
    lead_id: "lead-1",
    store_id: "store-1",
    external_message_id: "external-media-1",
    message_type: "image",
    content: "foto do local",
    metadata: {
      storage_bucket: "zion-store-files",
      storage_path: "org-1/store-1/location.jpg",
      original_file_name: "location.jpg",
      mime_type: "image/jpeg",
      media_purpose_normalized: "customer_location_photo",
      location_photo_analysis: { summary: "ja analisada" },
      visual_analysis_status: "succeeded",
    },
  };
  const { result, calls, aiCalls } = await processCustomerMediaScenario({ type: "image", caption: "foto do local", existingMessage: existing });
  assert.equal(result.failed, 0);
  assert.equal(calls.some((call) => call.url.includes("/v1/responses")), false);
  assert.equal(calls.some((call) => call.url.includes("/rpc/insert_message")), false);
  assert.deepEqual(aiCalls, ["sales-ai"]);
});

test("visual analysis failure stays retryable", async () => {
  const { result, calls, aiCalls } = await processCustomerMediaScenario({ type: "image", caption: "foto do local", visualFailure: true });
  assert.equal(result.failed, 1);
  assert.deepEqual(aiCalls, []);
  assert.equal(calls.some((call) => call.method === "PATCH" && call.body.includes('"processed_at"')), false);
});

test("non-location image does not invent visual analysis", async () => {
  const { result, calls, aiCalls } = await processCustomerMediaScenario({ type: "image", caption: "essa piscina" });
  assert.equal(result.failed, 0);
  assert.deepEqual(aiCalls, ["sales-ai"]);
  assert.equal(calls.some((call) => call.url.includes("/v1/responses")), false);
});

test("video remains video and document remains document with file attachment kind", async () => {
  const video = await processCustomerMediaScenario({ type: "video", caption: "video da area" });
  assert.equal(video.result.failed, 0);
  const videoInsert = video.calls.find((call) => call.url.includes("/rpc/insert_message"));
  assert.ok(videoInsert);
  assert.match(videoInsert.body, /"p_message_type":"video"/);
  assert.doesNotMatch(videoInsert.body, /"p_message_type":"text"/);

  const document = await processCustomerMediaScenario({ type: "document", filename: "comprovante.pdf" });
  assert.equal(document.result.failed, 0);
  const documentInsert = document.calls.find((call) => call.url.includes("/rpc/insert_message"));
  assert.ok(documentInsert);
  const documentPayload = JSON.parse(documentInsert.body) as Record<string, unknown>;
  const documentMetadata = documentPayload.p_metadata as Record<string, unknown>;
  assert.equal(documentPayload.p_message_type, "document");
  assert.equal(documentPayload.p_media_url, documentMetadata.storage_path);
  assert.equal(documentMetadata.attachment_kind, "file");
});
