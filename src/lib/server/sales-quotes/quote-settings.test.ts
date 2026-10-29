import { strict as assert } from "node:assert";
import { test } from "node:test";
import { reserveNextQuoteNumber } from "./quote-settings";

function createSupabaseMock(args: {
  settings: Record<string, unknown> | null;
  rpcResult?: { data: unknown; error: { message: string } | null };
}) {
  const calls: Array<{ kind: string; name?: string; payload?: unknown }> = [];
  const supabase = {
    from(table: string) {
      calls.push({ kind: "from", name: table });
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        maybeSingle: async () => ({ data: args.settings, error: null }),
      };
      return builder;
    },
    rpc: async (name: string, payload: unknown) => {
      calls.push({ kind: "rpc", name, payload });
      return args.rpcResult || {
        data: [{
          quote_number: "ORC-000062",
          reserved_number: 62,
          quote_number_prefix: "ORC",
        }],
        error: null,
      };
    },
  };
  return { calls, supabase };
}

function settingsRow(nextQuoteNumber = 62) {
  return {
    id: "settings-1",
    organization_id: "org-1",
    store_id: "store-1",
    quote_pdf_enabled: true,
    ai_can_generate_quote: true,
    ai_can_send_quote_to_customer: false,
    requires_human_approval_before_send: true,
    quote_number_prefix: "ORC",
    next_quote_number: nextQuoteNumber,
  };
}

test("reserveNextQuoteNumber uses the atomic RPC result and preserves its public shape", async () => {
  const { calls, supabase } = createSupabaseMock({ settings: settingsRow() });

  const result = await reserveNextQuoteNumber({
    supabase,
    organizationId: "org-1",
    storeId: "store-1",
  });

  assert.deepEqual(result, {
    settings: {
      quotePdfEnabled: true,
      aiCanGenerateQuote: true,
      aiCanSendQuoteToCustomer: false,
      requiresHumanApprovalBeforeSend: true,
      quoteNumberPrefix: "ORC",
      nextQuoteNumber: 62,
    },
    quoteNumber: "ORC-000062",
    reservedNumber: 62,
  });
  assert.deepEqual(calls.find((call) => call.kind === "rpc"), {
    kind: "rpc",
    name: "reserve_next_sales_quote_number_by_system",
    payload: {
      p_organization_id: "org-1",
      p_store_id: "store-1",
    },
  });
  assert.equal(calls.some((call) => call.name === "sales_quotes"), false);
});

test("reserveNextQuoteNumber fails when store numbering settings are absent", async () => {
  const { calls, supabase } = createSupabaseMock({ settings: null });

  await assert.rejects(
    reserveNextQuoteNumber({ supabase, organizationId: "org-1", storeId: "store-1" }),
    /Configuracao de numeracao do orcamento nao encontrada/,
  );
  assert.equal(calls.some((call) => call.kind === "rpc"), false);
});

test("reserveNextQuoteNumber propagates an RPC reservation error", async () => {
  const { supabase } = createSupabaseMock({
    settings: settingsRow(),
    rpcResult: { data: null, error: { message: "P19A_QUOTE_NUMBER_COUNTER_EXHAUSTED" } },
  });

  await assert.rejects(
    reserveNextQuoteNumber({ supabase, organizationId: "org-1", storeId: "store-1" }),
    /P19A_QUOTE_NUMBER_COUNTER_EXHAUSTED/,
  );
});

test("reserveNextQuoteNumber rejects empty and invalid RPC results without fallback", async () => {
  for (const data of [[], [{ quote_number: "ORC-000062" }]]) {
    const { calls, supabase } = createSupabaseMock({
      settings: settingsRow(),
      rpcResult: { data, error: null },
    });

    await assert.rejects(
      reserveNextQuoteNumber({ supabase, organizationId: "org-1", storeId: "store-1" }),
      /autoridade de numeracao do orcamento retornou/,
    );
    assert.equal(calls.some((call) => call.name === "sales_quotes"), false);
  }
});
