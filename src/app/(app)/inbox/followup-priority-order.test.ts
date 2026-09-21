import assert from "node:assert/strict";
import { sortFollowupRowsByCanonicalPriority } from "./followup-priority-order";

const tests = [
  {
    name: "sorts follow-up rows by higher canonical priority rank first",
    run: () => {
      const rows = [
        { commercial_opportunity_id: "opp-low", hours_since_customer: 40 },
        { commercial_opportunity_id: "opp-missing", hours_since_customer: 999 },
        { commercial_opportunity_id: "opp-urgent", hours_since_customer: 1 },
        { commercial_opportunity_id: "opp-high", hours_since_customer: 2 },
      ];

      const sorted = sortFollowupRowsByCanonicalPriority(rows, {
        "opp-low": { priority_rank: 20 },
        "opp-high": { priority_rank: 70 },
        "opp-urgent": { priority_rank: 90 },
      });

      assert.deepEqual(sorted.map((row) => row.commercial_opportunity_id), [
        "opp-urgent",
        "opp-high",
        "opp-low",
        "opp-missing",
      ]);
    },
  },
  {
    name: "keeps existing tie-breakers after canonical priority",
    run: () => {
      const rows = [
        { commercial_opportunity_id: "opp-b", hours_since_customer: 3, followup_type: "retorno" },
        { commercial_opportunity_id: "opp-a", hours_since_customer: 9, followup_type: "retorno" },
      ];

      const sorted = sortFollowupRowsByCanonicalPriority(rows, {
        "opp-a": { priority_rank: 50 },
        "opp-b": { priority_rank: 50 },
      });

      assert.deepEqual(sorted.map((row) => row.commercial_opportunity_id), ["opp-a", "opp-b"]);
    },
  },
];

async function main() {
  for (const test of tests) {
    await test.run();
    console.log(`ok - ${test.name}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
