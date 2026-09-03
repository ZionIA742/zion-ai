import { strict as assert } from "node:assert";
import {
  buildSalesAiAppointmentPromptBlock,
  loadSalesAiAppointmentContext,
} from "./sales-ai-appointment-context";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

function createAppointmentSupabase(rows: Array<Record<string, unknown>>) {
  const states: Array<{
    eq: Array<{ column: string; value: unknown }>;
    in: Array<{ column: string; values: unknown[] }>;
    limit: number | null;
  }> = [];

  return {
    states,
    supabase: {
      from(table: string) {
        assert.equal(table, "store_appointments");
        const state = {
          eq: [] as Array<{ column: string; value: unknown }>,
          in: [] as Array<{ column: string; values: unknown[] }>,
          limit: null as number | null,
        };
        return {
          select(_selection: string) {
            return this;
          },
          eq(column: string, value: unknown) {
            state.eq.push({ column, value });
            return this;
          },
          in(column: string, values: unknown[]) {
            state.in.push({ column, values });
            return this;
          },
          async limit(value: number) {
            state.limit = value;
            states.push(state);
            const filtered = rows.filter((row) => {
              const eqOk = state.eq.every(({ column, value: expected }) => row[column] === expected);
              const inOk = state.in.every(({ column, values }) => values.includes(String(row[column] || "")));
              return eqOk && inOk;
            });
            return { data: filtered, error: null };
          },
        };
      },
    },
  };
}

const tests: TestCase[] = [
  {
    name: "matching scheduled appointment in the same opportunity is recognized as real",
    run: async () => {
      const recorder = createAppointmentSupabase([
        {
          id: "appt-1",
          organization_id: "org-1",
          store_id: "store-1",
          conversation_id: "conv-1",
          lead_id: "lead-1",
          commercial_opportunity_id: "opp-1",
          appointment_type: "installation",
          status: "scheduled",
          scheduled_start: "2026-09-04T11:00:00.000Z",
          scheduled_end: "2026-09-04T13:00:00.000Z",
        },
      ]);

      const result = await loadSalesAiAppointmentContext({
        supabase: recorder.supabase,
        organizationId: "org-1",
        storeId: "store-1",
        conversationId: "conv-1",
        leadId: "lead-1",
        commercialOpportunityId: "opp-1",
        lastCustomerMessage: "Voce consegue confirmar a instalacao amanha as 8h?",
      });

      assert.equal(result.hasMatchingScheduledAppointment, true);
      assert.equal(result.matchingAppointments[0]?.id, "appt-1");
      assert.deepEqual(recorder.states[0]?.eq, [
        { column: "organization_id", value: "org-1" },
        { column: "store_id", value: "store-1" },
        { column: "conversation_id", value: "conv-1" },
        { column: "commercial_opportunity_id", value: "opp-1" },
      ]);
    },
  },
  {
    name: "appointment from another opportunity cannot confirm the current commitment",
    run: async () => {
      const recorder = createAppointmentSupabase([
        {
          id: "appt-other",
          organization_id: "org-1",
          store_id: "store-1",
          conversation_id: "conv-1",
          lead_id: "lead-1",
          commercial_opportunity_id: "opp-other",
          appointment_type: "installation",
          status: "scheduled",
          scheduled_start: "2026-09-04T11:00:00.000Z",
          scheduled_end: "2026-09-04T13:00:00.000Z",
        },
      ]);

      const result = await loadSalesAiAppointmentContext({
        supabase: recorder.supabase,
        organizationId: "org-1",
        storeId: "store-1",
        conversationId: "conv-1",
        leadId: "lead-1",
        commercialOpportunityId: "opp-1",
        lastCustomerMessage: "A instalacao esta agendada para amanha?",
      });

      assert.equal(result.hasMatchingScheduledAppointment, false);
      assert.equal(result.matchingAppointments.length, 0);
    },
  },
  {
    name: "cancelled appointment cannot be confirmed as scheduled",
    run: async () => {
      const recorder = createAppointmentSupabase([
        {
          id: "appt-cancelled",
          organization_id: "org-1",
          store_id: "store-1",
          conversation_id: "conv-1",
          lead_id: "lead-1",
          commercial_opportunity_id: "opp-1",
          appointment_type: "installation",
          status: "cancelled",
          scheduled_start: "2026-09-04T11:00:00.000Z",
          scheduled_end: "2026-09-04T13:00:00.000Z",
        },
      ]);

      const result = await loadSalesAiAppointmentContext({
        supabase: recorder.supabase,
        organizationId: "org-1",
        storeId: "store-1",
        conversationId: "conv-1",
        leadId: "lead-1",
        commercialOpportunityId: "opp-1",
        lastCustomerMessage: "Pode confirmar se a instalacao esta marcada?",
      });

      assert.equal(result.hasMatchingScheduledAppointment, false);
    },
  },
  {
    name: "missing appointment prompt forbids inventing the scheduled commitment",
    run: () => {
      const block = buildSalesAiAppointmentPromptBlock({
        requestedAppointmentConfirmation: true,
        hasMatchingScheduledAppointment: false,
        matchingAppointments: [],
        scopedCommercialOpportunityId: "opp-1",
      });

      assert.equal(block.includes("nao existe appointment scheduled/rescheduled"), true);
      assert.equal(block.includes("nao confirme que a equipe ira comparecer"), true);
      assert.equal(block.includes("sem escalar humano automaticamente"), true);
    },
  },
];

async function main() {
  let passed = 0;

  for (const test of tests) {
    try {
      await test.run();
      passed += 1;
    } catch (error) {
      console.error(`FAIL ${test.name}`);
      throw error;
    }
  }

  console.log(`sales-ai-appointment-context: ${passed}/${tests.length} tests passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
