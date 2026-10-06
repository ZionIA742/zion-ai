import assert from "node:assert/strict";
import { resolveStoreOperationalHealth } from "./operational-health-resolution.ts";

const base = (overrides = {}) => ({
  whatsapp: {
    staleInboundEvents: 0,
    inboundErrors: 0,
    failedOutboundMessages: 0,
    uncertainOutboundMessages: 0,
    ...(overrides.whatsapp || {}),
  },
  ai: {
    latestRunState: "succeeded",
    staleQueueItems: 0,
    ...(overrides.ai || {}),
  },
  assistant: {
    failedTasks: 0,
    staleProcessingTasks: 0,
    failedResponsibleNotifications: 0,
    uncertainResponsibleNotifications: 0,
    staleInternalNotifications: 0,
    ...(overrides.assistant || {}),
  },
  operations: {
    overdueAppointments: 0,
    overduePostAppointmentFollowups: 0,
    ...(overrides.operations || {}),
  },
});

const tests = [
  ["healthy", base(), "healthy"],
  ["ai sem uso nao e erro", base({ ai: { latestRunState: "none" } }), "healthy"],
  ["whatsapp inbound stale", base({ whatsapp: { staleInboundEvents: 1 } }), "broken"],
  ["whatsapp inbound error", base({ whatsapp: { inboundErrors: 1 } }), "broken"],
  ["whatsapp outbound failed", base({ whatsapp: { failedOutboundMessages: 2 } }), "broken"],
  ["whatsapp outbound uncertain", base({ whatsapp: { uncertainOutboundMessages: 1 } }), "broken"],
  ["latest ai run failed", base({ ai: { latestRunState: "failed" } }), "broken"],
  ["ai queue stale", base({ ai: { staleQueueItems: 1 } }), "warning"],
  ["assistant task failed", base({ assistant: { failedTasks: 1 } }), "broken"],
  ["assistant task stale processing", base({ assistant: { staleProcessingTasks: 1 } }), "broken"],
  ["responsible notification failed", base({ assistant: { failedResponsibleNotifications: 1 } }), "broken"],
  ["responsible notification uncertain", base({ assistant: { uncertainResponsibleNotifications: 1 } }), "broken"],
  ["internal notification stale", base({ assistant: { staleInternalNotifications: 1 } }), "warning"],
  ["appointment overdue", base({ operations: { overdueAppointments: 1 } }), "warning"],
  ["post appointment followup overdue", base({ operations: { overduePostAppointmentFollowups: 1 } }), "warning"],
  ["unknown whatsapp source", base({ whatsapp: { inboundErrors: null } }), "unknown"],
  ["unknown ai source", base({ ai: { latestRunState: "unknown" } }), "unknown"],
  ["invalid ai state fails closed", base({ ai: { latestRunState: "banana" } }), "unknown"],
  ["unknown assistant source", base({ assistant: { failedTasks: null } }), "unknown"],
  ["unknown operations source", base({ operations: { overdueAppointments: null } }), "unknown"],
  ["broken outranks unknown", base({ whatsapp: { inboundErrors: 1, staleInboundEvents: null } }), "broken"],
  ["unknown outranks warning", base({ ai: { staleQueueItems: 1 }, operations: { overdueAppointments: null } }), "unknown"],
  ["negative count fails closed", base({ assistant: { failedTasks: -1 } }), "unknown"],
  ["nan count fails closed", base({ operations: { overdueAppointments: Number.NaN } }), "unknown"],
  ["fractional count fails closed", base({ operations: { overdueAppointments: 0.5 } }), "unknown"],
];

for (const [name, input, expectedState] of tests) {
  const result = resolveStoreOperationalHealth(input);
  assert.equal(result.state, expectedState, name);
}

{
  const result = resolveStoreOperationalHealth(
    base({
      ai: {
        latestRunState: "none",
      },
    }),
  );

  assert.equal(result.state, "healthy");
  assert.equal(result.ai.state, "idle");
  assert.equal(result.issues.length, 0);
}

{
  const result = resolveStoreOperationalHealth(
    base({
      whatsapp: {
        inboundErrors: 2,
        failedOutboundMessages: 1,
      },
    }),
  );

  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ["whatsapp_inbound_error", "whatsapp_outbound_failed"],
  );
  assert.equal(result.issues[0].count, 2);
  assert.equal(result.whatsapp.state, "broken");
}

{
  const result = resolveStoreOperationalHealth(
    base({
      operations: {
        overdueAppointments: 2,
        overduePostAppointmentFollowups: 3,
      },
    }),
  );

  assert.equal(result.state, "warning");
  assert.equal(result.operations.state, "warning");
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ["appointment_overdue", "post_appointment_followup_overdue"],
  );
}

{
  const result = resolveStoreOperationalHealth(base());

  assert.equal(result.whatsapp.liveConnectivity, "unverified");
  assert.equal(result.observability.workerHeartbeatAvailable, false);
}

{
  const result = resolveStoreOperationalHealth(
    base({
      assistant: {
        failedTasks: 1,
        staleInternalNotifications: null,
      },
    }),
  );

  assert.equal(result.assistant.state, "broken");
  assert.equal(result.state, "broken");
}

console.log(
  `zion-admin-overview-operational-health-resolution: ${tests.length + 5} tests passed`,
);