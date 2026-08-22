import { strict as assert } from "node:assert";
import {
  CURRENT_COMMERCIAL_PROPOSAL_PROJECTION_ACCEPTED_OUTCOMES,
  CURRENT_COMMERCIAL_PROPOSAL_PROJECTION_SOURCE,
  CurrentCommercialProposalProjectionError,
  buildCurrentCommercialProposalIdempotencyKey,
  buildCurrentCommercialProposalProjectionIdempotencyKey,
  projectCurrentCommercialProposalBySystem,
} from "./commercial-opportunity-current-proposal-projection";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

function createRpcHarness(result?: {
  data?: unknown;
  error?: { message: string } | null;
}) {
  const calls: Array<{ fn: string; payload: Record<string, unknown> }> = [];

  return {
    calls,
    supabase: {
      rpc: async (fn: string, payload: Record<string, unknown>) => {
        calls.push({ fn, payload });
        return {
          data:
            result?.data ??
            [
              {
                commercial_opportunity_id: "opp-1",
                current_quote_id: "quote-1",
                current_quote_version_id: "version-1",
                changed: true,
                outcome: "current_proposal_updated",
                updated_at: null,
              },
            ],
          error: result?.error ?? null,
        };
      },
    },
  };
}

const tests: TestCase[] = [
  {
    name: "idempotency key uses opportunity quote and version ids",
    run: () => {
      assert.equal(
        buildCurrentCommercialProposalIdempotencyKey({
          commercialOpportunityId: "opp-1",
          salesQuoteId: "quote-1",
          salesQuoteVersionId: "version-1",
        }),
        "current_commercial_proposal:opp-1:quote-1:version-1",
      );
      assert.equal(
        buildCurrentCommercialProposalProjectionIdempotencyKey({
          commercialOpportunityId: "opp-1",
          salesQuoteId: "quote-1",
          salesQuoteVersionId: "version-1",
        }),
        "current_commercial_proposal:opp-1:quote-1:version-1",
      );
    },
  },
  {
    name: "same ids produce same key and different ids produce different keys",
    run: () => {
      assert.equal(
        buildCurrentCommercialProposalIdempotencyKey({
          commercialOpportunityId: "opp-1",
          salesQuoteId: "quote-1",
          salesQuoteVersionId: "version-1",
        }),
        buildCurrentCommercialProposalIdempotencyKey({
          commercialOpportunityId: "opp-1",
          salesQuoteId: "quote-1",
          salesQuoteVersionId: "version-1",
        }),
      );
      assert.notEqual(
        buildCurrentCommercialProposalIdempotencyKey({
          commercialOpportunityId: "opp-1",
          salesQuoteId: "quote-1",
          salesQuoteVersionId: "version-1",
        }),
        buildCurrentCommercialProposalIdempotencyKey({
          commercialOpportunityId: "opp-1",
          salesQuoteId: "quote-2",
          salesQuoteVersionId: "version-1",
        }),
      );
    },
  },
  {
    name: "writer uses explicit ids and canonical source",
    run: async () => {
      const harness = createRpcHarness();

      await projectCurrentCommercialProposalBySystem({
        supabase: harness.supabase,
        organizationId: "org-1",
        storeId: "store-1",
        commercialOpportunityId: "opp-1",
        salesQuoteId: "quote-1",
        salesQuoteVersionId: "version-1",
      });

      assert.deepEqual(harness.calls, [
        {
          fn: "set_current_commercial_proposal_from_sent_quote_by_system",
          payload: {
            p_organization_id: "org-1",
            p_store_id: "store-1",
            p_commercial_opportunity_id: "opp-1",
            p_sales_quote_id: "quote-1",
            p_sales_quote_version_id: "version-1",
            p_idempotency_key:
              "current_commercial_proposal:opp-1:quote-1:version-1",
            p_source: CURRENT_COMMERCIAL_PROPOSAL_PROJECTION_SOURCE,
          },
        },
      ]);
    },
  },
  {
    name: "rpc error becomes controlled projection error",
    run: async () => {
      const harness = createRpcHarness({
        error: { message: "boom" },
      });

      await assert.rejects(
        projectCurrentCommercialProposalBySystem({
          supabase: harness.supabase,
          organizationId: "org-1",
          storeId: "store-1",
          commercialOpportunityId: "opp-1",
          salesQuoteId: "quote-1",
          salesQuoteVersionId: "version-1",
        }),
        (error: unknown) =>
          error instanceof CurrentCommercialProposalProjectionError &&
          error.message.includes("nao foi possivel sincronizar"),
      );
    },
  },
  {
    name: "invalid outcome is rejected fail closed",
    run: async () => {
      const harness = createRpcHarness({
        data: [{ outcome: "unexpected" }],
      });

      await assert.rejects(
        projectCurrentCommercialProposalBySystem({
          supabase: harness.supabase,
          organizationId: "org-1",
          storeId: "store-1",
          commercialOpportunityId: "opp-1",
          salesQuoteId: "quote-1",
          salesQuoteVersionId: "version-1",
        }),
        (error: unknown) =>
          error instanceof CurrentCommercialProposalProjectionError &&
          error.message.includes("resultado invalido"),
      );
    },
  },
  {
    name: "accepted outcomes set matches contract",
    run: () => {
      assert.deepEqual(
        Array.from(CURRENT_COMMERCIAL_PROPOSAL_PROJECTION_ACCEPTED_OUTCOMES),
        [
          "current_proposal_updated",
          "already_current_proposal",
          "stale_sent_proposal_ignored",
        ],
      );
    },
  },
  {
    name: "stale outcome is accepted as safe noop",
    run: async () => {
      const harness = createRpcHarness({
        data: [
          {
            commercial_opportunity_id: "opp-1",
            current_quote_id: "quote-2",
            current_quote_version_id: "version-2",
            changed: false,
            outcome: "stale_sent_proposal_ignored",
            updated_at: null,
          },
        ],
      });

      const row = await projectCurrentCommercialProposalBySystem({
        supabase: harness.supabase,
        organizationId: "org-1",
        storeId: "store-1",
        commercialOpportunityId: "opp-1",
        salesQuoteId: "quote-1",
        salesQuoteVersionId: "version-1",
      });

      assert.equal(row.outcome, "stale_sent_proposal_ignored");
      assert.equal(row.changed, false);
    },
  },
];

void (async () => {
  const failures: string[] = [];

  for (const testCase of tests) {
    try {
      await testCase.run();
      process.stdout.write(`ok - ${testCase.name}\n`);
    } catch (error) {
      failures.push(
        `not ok - ${testCase.name}\n${error instanceof Error ? error.stack || error.message : String(error)}`,
      );
    }
  }

  if (failures.length > 0) {
    process.stderr.write(`${failures.join("\n")}\n`);
    process.exitCode = 1;
  }
})();
