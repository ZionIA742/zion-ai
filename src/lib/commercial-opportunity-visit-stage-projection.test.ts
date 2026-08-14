import { strict as assert } from "node:assert";
import {
  TECHNICAL_VISIT_STAGE_PROJECTION_ACCEPTED_OUTCOMES,
  TechnicalVisitStageProjectionError,
  buildTechnicalVisitStageProjectionIdempotencyKey,
  projectTechnicalVisitStageBySystem,
  projectTechnicalVisitStageByUser,
  shouldAttemptTechnicalVisitStageProjection,
} from "./commercial-opportunity-visit-stage-projection";

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
                appointment_id: "appt-1",
                stage: "visita_tecnica",
                lifecycle_cycle: 1,
                lifecycle_event_id: "evt-1",
                event_type: "stage_transition",
                reason_code: "visit_eligibility_required",
                stage_changed: true,
                outcome: "advanced_to_visita_tecnica",
                stage_changed_at: null,
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
    name: "idempotency key uses appointment and opportunity ids",
    run: () => {
      assert.equal(
        buildTechnicalVisitStageProjectionIdempotencyKey({
          appointmentId: "appt-1",
          commercialOpportunityId: "opp-1",
        }),
        "technical_visit_stage_projection:appt-1:opp-1",
      );
    },
  },
  {
    name: "projection attempts only for technical visit with scheduled or rescheduled status and explicit opportunity",
    run: () => {
      assert.equal(
        shouldAttemptTechnicalVisitStageProjection({
          appointmentType: "technical_visit",
          appointmentStatus: "scheduled",
          commercialOpportunityId: "opp-1",
        }),
        true,
      );
      assert.equal(
        shouldAttemptTechnicalVisitStageProjection({
          appointmentType: "installation",
          appointmentStatus: "scheduled",
          commercialOpportunityId: "opp-1",
        }),
        false,
      );
      assert.equal(
        shouldAttemptTechnicalVisitStageProjection({
          appointmentType: "technical_visit",
          appointmentStatus: "cancelled",
          commercialOpportunityId: "opp-1",
        }),
        false,
      );
      assert.equal(
        shouldAttemptTechnicalVisitStageProjection({
          appointmentType: "technical_visit",
          appointmentStatus: "rescheduled",
          commercialOpportunityId: null,
        }),
        false,
      );
    },
  },
  {
    name: "by_user writer uses dedicated rpc and explicit scope",
    run: async () => {
      const harness = createRpcHarness();

      await projectTechnicalVisitStageByUser({
        supabase: harness.supabase,
        organizationId: "org-1",
        storeId: "store-1",
        commercialOpportunityId: "opp-1",
        appointmentId: "appt-1",
        source: "schedule_page",
      });

      assert.deepEqual(harness.calls, [
        {
          fn: "advance_commercial_opportunity_to_technical_visit_stage_by_user",
          payload: {
            p_request_organization_id: "org-1",
            p_store_id: "store-1",
            p_commercial_opportunity_id: "opp-1",
            p_appointment_id: "appt-1",
            p_idempotency_key: "technical_visit_stage_projection:appt-1:opp-1",
            p_reason_details: "technical visit scheduled",
            p_source: "schedule_page",
          },
        },
      ]);
    },
  },
  {
    name: "by_system writer uses dedicated rpc and explicit scope",
    run: async () => {
      const harness = createRpcHarness();

      await projectTechnicalVisitStageBySystem({
        supabase: harness.supabase,
        organizationId: "org-1",
        storeId: "store-1",
        commercialOpportunityId: "opp-1",
        appointmentId: "appt-1",
        source: "assistant_reply_route",
      });

      assert.deepEqual(harness.calls, [
        {
          fn: "advance_commercial_opportunity_to_technical_visit_stage_by_system",
          payload: {
            p_organization_id: "org-1",
            p_store_id: "store-1",
            p_commercial_opportunity_id: "opp-1",
            p_appointment_id: "appt-1",
            p_idempotency_key: "technical_visit_stage_projection:appt-1:opp-1",
            p_reason_details: "technical visit scheduled",
            p_source: "assistant_reply_route",
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
        projectTechnicalVisitStageBySystem({
          supabase: harness.supabase,
          organizationId: "org-1",
          storeId: "store-1",
          commercialOpportunityId: "opp-1",
          appointmentId: "appt-1",
          source: "assistant_reply_route",
        }),
        (error: unknown) =>
          error instanceof TechnicalVisitStageProjectionError &&
          error.message.includes("nao foi possivel sincronizar"),
      );
    },
  },
  {
    name: "invalid outcome is rejected fail-closed",
    run: async () => {
      const harness = createRpcHarness({
        data: [
          {
            outcome: "unexpected",
          },
        ],
      });

      await assert.rejects(
        projectTechnicalVisitStageByUser({
          supabase: harness.supabase,
          organizationId: "org-1",
          storeId: "store-1",
          commercialOpportunityId: "opp-1",
          appointmentId: "appt-1",
          source: "schedule_page",
        }),
        (error: unknown) =>
          error instanceof TechnicalVisitStageProjectionError &&
          error.message.includes("resultado invalido"),
      );
    },
  },
  {
    name: "accepted outcomes set matches contract",
    run: () => {
      assert.deepEqual(
        Array.from(TECHNICAL_VISIT_STAGE_PROJECTION_ACCEPTED_OUTCOMES),
        [
          "advanced_to_visita_tecnica",
          "already_in_visit_stage",
          "stage_not_eligible_for_automatic_visit_projection",
          "idempotent_replay",
        ],
      );
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
