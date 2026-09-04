import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCommercialOpportunitySelectOptions,
  isCommercialOpportunitySelectionCompatible,
  resolveCommercialOpportunityIdForAppointmentCreate,
  type LeadCommercialOpportunityOption,
} from "./appointment-create-contract";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

const leadOpportunities: LeadCommercialOpportunityOption[] = [
  {
    id: "opp-qualificacao-a",
    stage: "qualificacao",
    primaryConversationId: "conv-a",
  },
  {
    id: "opp-qualificacao-b",
    stage: "qualificacao",
    primaryConversationId: "conv-b",
  },
];

const tests: TestCase[] = [
  {
    name: "technical_visit with explicit opportunity keeps the exact commercial_opportunity_id",
    run: () => {
      const result = resolveCommercialOpportunityIdForAppointmentCreate({
        appointmentType: "technical_visit",
        selectedCommercialOpportunityId: "opp-qualificacao-a",
        availableCommercialOpportunities: leadOpportunities,
      });

      assert.deepEqual(result, {
        ok: true,
        commercialOpportunityId: "opp-qualificacao-a",
      });
    },
  },
  {
    name: "two opportunities from the same lead stay explicit and do not mix ids",
    run: () => {
      const options = buildCommercialOpportunitySelectOptions({
        opportunities: leadOpportunities,
        selectedConversationId: null,
      });

      assert.equal(options.length, 2);
      assert.deepEqual(
        options.map((option) => option.value),
        ["opp-qualificacao-a", "opp-qualificacao-b"],
      );
      assert.notEqual(options[0]?.label, options[1]?.label);
      assert.equal(options[0]?.stage, "qualificacao");
      assert.equal(options[1]?.stage, "qualificacao");
    },
  },
  {
    name: "conversation filtering keeps only compatible opportunities",
    run: () => {
      const options = buildCommercialOpportunitySelectOptions({
        opportunities: leadOpportunities,
        selectedConversationId: "conv-b",
      });

      assert.deepEqual(
        options.map((option) => option.value),
        ["opp-qualificacao-b"],
      );
    },
  },
  {
    name: "incompatible opportunity selection is detected for cleanup",
    run: () => {
      assert.equal(
        isCommercialOpportunitySelectionCompatible({
          selectedCommercialOpportunityId: "opp-qualificacao-a",
          availableCommercialOpportunities: [
            {
              id: "opp-qualificacao-b",
              stage: "qualificacao",
              primaryConversationId: "conv-b",
            },
          ],
        }),
        false,
      );
    },
  },
  {
    name: "technical_visit with represented commercial options but missing selection is blocked",
    run: () => {
      const result = resolveCommercialOpportunityIdForAppointmentCreate({
        appointmentType: "technical_visit",
        selectedCommercialOpportunityId: "",
        availableCommercialOpportunities: leadOpportunities,
      });

      assert.equal(result.ok, false);
      assert.equal(
        "errorMessage" in result &&
          result.errorMessage.includes("Selecione explicitamente"),
        true,
      );
    },
  },
  {
    name: "regular appointment without commercial context still works with null opportunity",
    run: () => {
      const result = resolveCommercialOpportunityIdForAppointmentCreate({
        appointmentType: "installation",
        selectedCommercialOpportunityId: "",
        availableCommercialOpportunities: leadOpportunities,
      });

      assert.deepEqual(result, {
        ok: true,
        commercialOpportunityId: null,
      });
    },
  },
  {
    name: "technical visit creation checks action readiness before appointment rpc",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/app/(app)/schedule/page.tsx"),
        "utf8",
      );
      const readinessIndex = source.indexOf(
        'fetch(\n          "/api/crm/opportunities/action-readiness"',
      );
      const rpcIndex = source.indexOf(
        'supabase.rpc("create_store_appointment_with_commercial_context"',
      );

      assert.equal(source.includes('actionKey: "schedule_technical_visit"'), true);
      assert.equal(source.includes('readinessBody.readinessState !== "ready"'), true);
      assert.equal(readinessIndex > -1, true);
      assert.equal(rpcIndex > -1, true);
      assert.equal(readinessIndex < rpcIndex, true);
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
