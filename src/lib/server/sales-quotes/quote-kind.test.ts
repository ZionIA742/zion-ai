import { strict as assert } from "node:assert";
import { resolveSalesQuoteKindForVersion } from "./quote-kind";

function checklistMaterializationRow() {
  return {
    current_checklist_version_id: "checklist-version-1",
    outcome: "checklist_materialized",
    changed: true,
    replayed: false,
    preserved: false,
  };
}

function progressMaterializationRow() {
  return {
    current_progress_version_id: "progress-version-1",
    checklist_version_id: "checklist-version-1",
    outcome: "progress_materialized",
    changed: true,
    replayed: false,
  };
}

function createSupabaseRecorder(row: Record<string, unknown> | null, error?: { message?: string }) {
  const calls: Array<{ fn: string; payload: Record<string, unknown> }> = [];

  return {
    calls,
    supabase: {
      async rpc(fn: string, payload: Record<string, unknown>) {
        calls.push({ fn, payload });

        if (fn === "materialize_commercial_opportunity_checklist_by_system") {
          return { data: [checklistMaterializationRow()], error: null };
        }

        if (fn === "materialize_commercial_opportunity_checklist_progress_by_system") {
          return { data: [progressMaterializationRow()], error: null };
        }

        if (fn === "resolve_sales_quote_kind_for_generation_by_system") {
          return { data: row ? [row] : null, error: error ?? null };
        }

        return { data: null, error: { message: `unexpected rpc: ${fn}` } };
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
      assert.deepEqual(
        recorder.calls.map((call) => call.fn),
        [
          "materialize_commercial_opportunity_checklist_by_system",
          "materialize_commercial_opportunity_checklist_progress_by_system",
          "resolve_sales_quote_kind_for_generation_by_system",
        ],
      );

      const checklistEventKey = String(
        recorder.calls[0]?.payload.p_materialization_event_key || "",
      );
      const progressEventKey = String(
        recorder.calls[1]?.payload.p_materialization_event_key || "",
      );

      assert.equal(
        checklistEventKey.startsWith("commercial_checklist_progress:"),
        true,
      );
      assert.equal(
        checklistEventKey.endsWith(":checklist"),
        true,
      );
      assert.equal(
        progressEventKey,
        checklistEventKey.replace(/:checklist$/, ":progress"),
      );

      assert.equal(
        recorder.calls[2]?.payload.p_commercial_opportunity_id,
        "opp-1",
      );
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
    name: "checklist preparation failure stops before quote kind resolver",
    run: async () => {
      const calls: Array<{ fn: string; payload: Record<string, unknown> }> = [];
      const supabase = {
        async rpc(fn: string, payload: Record<string, unknown>) {
          calls.push({ fn, payload });

          if (fn === "materialize_commercial_opportunity_checklist_by_system") {
            return {
              data: null,
              error: { message: "checklist unavailable" },
            };
          }

          return {
            data: null,
            error: { message: `unexpected rpc: ${fn}` },
          };
        },
      };

      await assert.rejects(
        resolveSalesQuoteKindForVersion({
          supabase,
          organizationId: "org-1",
          storeId: "store-1",
          quoteId: "quote-1",
          commercialOpportunityId: "opp-1",
        }),
        (error: unknown) =>
          Boolean(
            error &&
              typeof error === "object" &&
              (error as { code?: string }).code === "QUOTE_KIND_PREPARATION_FAILED" &&
              (error as { status?: number }).status === 503,
          ),
      );

      assert.deepEqual(
        calls.map((call) => call.fn),
        ["materialize_commercial_opportunity_checklist_by_system"],
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
