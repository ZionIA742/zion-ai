import { strict as assert } from "node:assert";
import { resolveSalesQuoteKindForVersion } from "./quote-kind";

function createSupabaseRecorder(row: Record<string, unknown> | null, error?: { message?: string }) {
  const calls: Array<{ fn: string; payload: Record<string, unknown> }> = [];
  return {
    calls,
    supabase: {
      async rpc(fn: string, payload: Record<string, unknown>) {
        calls.push({ fn, payload });
        return { data: row ? [row] : null, error: error ?? null };
      },
    },
  };
}

const tests = [
  {
    name: "modern quote resolves definitive through canonical rpc",
    run: async () => {
      const recorder = createSupabaseRecorder({
        resolution_state: "ready",
        quote_kind: "definitive",
        reason_code: "definitive_quote_ready",
        blocking_items: [],
        authority_fingerprint: "fp",
      });

      const kind = await resolveSalesQuoteKindForVersion({
        supabase: recorder.supabase,
        organizationId: "org-1",
        storeId: "store-1",
        quoteId: "quote-1",
        commercialOpportunityId: "opp-1",
      });

      assert.equal(kind, "definitive");
      assert.equal(recorder.calls[0]?.fn, "resolve_sales_quote_kind_for_generation_by_system");
      assert.equal(recorder.calls[0]?.payload.p_commercial_opportunity_id, "opp-1");
    },
  },
  {
    name: "modern quote resolves preliminary through canonical rpc",
    run: async () => {
      const recorder = createSupabaseRecorder({
        resolution_state: "ready",
        quote_kind: "preliminary",
        reason_code: "preliminary_quote_before_visit_allowed",
        blocking_items: [],
        authority_fingerprint: "fp",
      });

      const kind = await resolveSalesQuoteKindForVersion({
        supabase: recorder.supabase,
        organizationId: "org-1",
        storeId: "store-1",
        quoteId: "quote-1",
        commercialOpportunityId: "opp-1",
      });

      assert.equal(kind, "preliminary");
    },
  },
  {
    name: "blocked or needs_resolution fails closed",
    run: async () => {
      const recorder = createSupabaseRecorder({
        resolution_state: "blocked",
        quote_kind: null,
        reason_code: "preliminary_quote_before_visit_not_allowed",
        blocking_items: [{ item_key: "preliminary_quote_before_technical_visit" }],
        authority_fingerprint: "fp",
      });

      await assert.rejects(
        resolveSalesQuoteKindForVersion({
          supabase: recorder.supabase,
          organizationId: "org-1",
          storeId: "store-1",
          quoteId: "quote-1",
          commercialOpportunityId: "opp-1",
        }),
        (error: unknown) =>
          Boolean(
            error &&
              typeof error === "object" &&
              (error as { code?: string }).code === "QUOTE_KIND_BLOCKED",
          ),
      );
    },
  },
  {
    name: "legacy quote without commercial opportunity preserves previous kind",
    run: async () => {
      const recorder = createSupabaseRecorder(null);

      const kind = await resolveSalesQuoteKindForVersion({
        supabase: recorder.supabase,
        organizationId: "org-1",
        storeId: "store-1",
        quoteId: "quote-1",
        commercialOpportunityId: null,
        fallbackQuoteKind: "preliminary",
      });

      assert.equal(kind, "preliminary");
      assert.equal(recorder.calls.length, 0);
    },
  },
];

async function main() {
  for (const test of tests) {
    await test.run();
  }

  console.log(`quote-kind: ${tests.length} tests passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
