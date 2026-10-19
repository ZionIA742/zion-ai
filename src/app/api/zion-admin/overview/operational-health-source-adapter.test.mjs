import assert from "node:assert/strict";
import { buildStoreOperationalHealthInputs } from "./operational-health-source-adapter.ts";

const NOW = new Date("2026-10-06T18:00:00.000Z");

const thresholds = {
  whatsappInboundStaleMs: 10 * 60 * 1000,
  whatsappOutboundStaleMs: 10 * 60 * 1000,
  aiRunQueueStaleMs: 10 * 60 * 1000,
  assistantPendingStaleMs: 10 * 60 * 1000,
  assistantProcessingStaleMs: 10 * 60 * 1000,
  responsibleProcessingStaleMs: 10 * 60 * 1000,
  firstPostAppointmentFollowupDelayMs: 10 * 60 * 1000,
  subsequentPostAppointmentFollowupDelayMs: 30 * 60 * 1000,
  maxPostAppointmentPrompts: 3,
};

const emptySources = (overrides = {}) => ({
  whatsappInboxRows: [],
  whatsappOutboundRows: [],
  aiRunRows: [],
  aiRunQueueRows: [],
  assistantOperationalQueueRows: [],
  responsibleNotificationRows: [],
  appointmentRows: [],
  postAppointmentFollowupRows: [],
  ...overrides,
});

function build(overrides = {}) {
  return buildStoreOperationalHealthInputs({
    storeIds: overrides.storeIds || ["store-1"],
    now: overrides.now || NOW,
    thresholds: {
      ...thresholds,
      ...(overrides.thresholds || {}),
    },
    sources: emptySources(overrides.sources || {}),
  });
}

function store(result, id = "store-1") {
  const value = result.get(id);
  assert.ok(value, `store ${id} missing`);
  return value;
}

const tests = [];

tests.push(() => {
  const input = store(build());
  assert.equal(input.ai.latestRunState, "none");
  assert.equal(input.whatsapp.staleInboundEvents, 0);
  assert.equal(input.assistant.failedTasks, 0);
  assert.equal(input.operations.overdueAppointments, 0);
});

tests.push(() => {
  const result = build({
    storeIds: ["store-1", "store-2"],
    sources: {
      whatsappInboxRows: [{
        store_id: "store-2",
        received_at: "2026-10-06T17:40:00.000Z",
        processed_at: null,
        processing_error: null,
      }],
    },
  });

  assert.equal(store(result, "store-1").whatsapp.staleInboundEvents, 0);
  assert.equal(store(result, "store-2").whatsapp.staleInboundEvents, 1);
});

tests.push(() => {
  const input = store(build({
    sources: {
      whatsappInboxRows: [
        {
          store_id: "store-1",
          received_at: "2026-10-06T17:40:00.000Z",
          processed_at: null,
          processing_error: null,
        },
        {
          store_id: "store-1",
          received_at: "2026-10-06T17:55:00.000Z",
          processed_at: null,
          processing_error: null,
        },
      ],
    },
  }));

  assert.equal(input.whatsapp.staleInboundEvents, 1);
});

tests.push(() => {
  const input = store(build({
    sources: {
      whatsappInboxRows: [{
        store_id: "store-1",
        received_at: "2026-10-06T17:59:00.000Z",
        processed_at: null,
        processing_error: "provider failure",
      }],
    },
  }));

  assert.equal(input.whatsapp.inboundErrors, 1);
  assert.equal(input.whatsapp.staleInboundEvents, 0);
});

tests.push(() => {
  const input = store(build({
    sources: {
      whatsappInboxRows: [{
        store_id: "store-1",
        received_at: "2026-10-06T17:00:00.000Z",
        processed_at: "2026-10-06T17:01:00.000Z",
        processing_error: "historical provider failure",
      }],
    },
  }));

  assert.equal(input.whatsapp.inboundErrors, 0);
  assert.equal(input.whatsapp.staleInboundEvents, 0);
});

tests.push(() => {
  const input = store(build({
    sources: {
      whatsappOutboundRows: [
        {
          store_id: "store-1",
          outbound_delivery_state: "failed",
          outbound_claimed_at: null,
          outbound_attempt_started_at: null,
          created_at: "2026-10-06T17:59:00.000Z",
        },
        {
          store_id: "store-1",
          outbound_delivery_state: "uncertain",
          outbound_claimed_at: null,
          outbound_attempt_started_at: null,
          created_at: "2026-10-06T17:59:00.000Z",
        },
        {
          store_id: "store-1",
          outbound_delivery_state: "pending",
          outbound_claimed_at: null,
          outbound_attempt_started_at: null,
          created_at: "2026-10-06T17:30:00.000Z",
        },
        {
          store_id: "store-1",
          outbound_delivery_state: "processing",
          outbound_claimed_at: "2026-10-06T17:40:00.000Z",
          outbound_attempt_started_at: null,
          created_at: "2026-10-06T17:39:00.000Z",
        },
      ],
    },
  }));

  assert.equal(input.whatsapp.failedOutboundMessages, 1);
  assert.equal(input.whatsapp.uncertainOutboundMessages, 1);
  assert.equal(input.whatsapp.staleOutboundMessages, 2);
});

tests.push(() => {
  const input = store(build({
    sources: {
      whatsappOutboundRows: [{
        store_id: "store-1",
        outbound_delivery_state: "pending",
        outbound_claimed_at: null,
        outbound_attempt_started_at: null,
        created_at: null,
      }],
    },
  }));

  assert.equal(input.whatsapp.staleOutboundMessages, null);
});

tests.push(() => {
  const input = store(build({
    sources: {
      aiRunRows: [
        {
          store_id: "store-1",
          status: "failed",
          error: "old error",
          created_at: "2026-10-06T17:00:00.000Z",
        },
        {
          store_id: "store-1",
          status: "succeeded",
          error: null,
          created_at: "2026-10-06T17:30:00.000Z",
        },
      ],
    },
  }));

  assert.equal(input.ai.latestRunState, "succeeded");
});

tests.push(() => {
  const input = store(build({
    sources: {
      aiRunRows: [{
        store_id: "store-1",
        status: "failed",
        error: "boom",
        created_at: "2026-10-06T17:30:00.000Z",
      }],
    },
  }));

  assert.equal(input.ai.latestRunState, "failed");
});

tests.push(() => {
  const input = store(build({
    sources: {
      aiRunRows: [{
        store_id: "store-1",
        status: "running",
        error: null,
        created_at: "2026-10-06T17:30:00.000Z",
      }],
    },
  }));

  assert.equal(input.ai.latestRunState, "unknown");
});

tests.push(() => {
  const input = store(build({
    sources: {
      aiRunRows: [{
        store_id: "store-1",
        status: "queued",
        error: null,
        created_at: "2026-10-06T17:30:00.000Z",
      }],
    },
  }));

  assert.equal(input.ai.latestRunState, "unknown");
});

tests.push(() => {
  const input = store(build({
    sources: {
      aiRunRows: null,
      aiRunQueueRows: null,
    },
  }));

  assert.equal(input.ai.latestRunState, "unknown");
  assert.equal(input.ai.staleQueueItems, null);
});

tests.push(() => {
  const input = store(build({
    sources: {
      aiRunQueueRows: [
        {
          store_id: "store-1",
          processed_at: null,
          enqueued_at: "2026-10-06T17:40:00.000Z",
        },
        {
          store_id: "store-1",
          processed_at: "2026-10-06T17:45:00.000Z",
          enqueued_at: "2026-10-06T17:00:00.000Z",
        },
      ],
    },
  }));

  assert.equal(input.ai.staleQueueItems, 1);
});

tests.push(() => {
  const input = store(build({
    sources: {
      assistantOperationalQueueRows: [
        {
          store_id: "store-1",
          status: "failed",
          available_at: null,
          locked_at: null,
          created_at: "2026-10-06T17:59:00.000Z",
        },
        {
          store_id: "store-1",
          status: "processing",
          available_at: null,
          locked_at: "2026-10-06T17:40:00.000Z",
          created_at: "2026-10-06T17:39:00.000Z",
        },
        {
          store_id: "store-1",
          status: "pending",
          available_at: "2026-10-06T17:40:00.000Z",
          locked_at: null,
          created_at: "2026-10-06T17:39:00.000Z",
        },
      ],
    },
  }));

  assert.equal(input.assistant.failedTasks, 1);
  assert.equal(input.assistant.staleProcessingTasks, 1);
  assert.equal(input.assistant.stalePendingTasks, 1);
});

tests.push(() => {
  const input = store(build({
    sources: {
      assistantOperationalQueueRows: [{
        store_id: "store-1",
        status: "future_status",
        available_at: null,
        locked_at: null,
        created_at: "2026-10-06T17:59:00.000Z",
      }],
    },
  }));

  assert.equal(input.assistant.failedTasks, null);
  assert.equal(input.assistant.staleProcessingTasks, null);
  assert.equal(input.assistant.stalePendingTasks, null);
});

tests.push(() => {
  const input = store(build({
    sources: {
      responsibleNotificationRows: [
        {
          store_id: "store-1",
          status: "failed",
          locked_at: null,
        },
        {
          store_id: "store-1",
          status: "uncertain",
          locked_at: null,
        },
        {
          store_id: "store-1",
          status: "processing",
          locked_at: "2026-10-06T17:40:00.000Z",
        },
      ],
    },
  }));

  assert.equal(input.assistant.failedResponsibleNotifications, 1);
  assert.equal(input.assistant.uncertainResponsibleNotifications, 1);
  assert.equal(input.assistant.staleResponsibleNotifications, 1);
});

tests.push(() => {
  const input = store(build({
    sources: {
      responsibleNotificationRows: [{
        store_id: "store-1",
        status: "future_status",
        locked_at: null,
      }],
    },
  }));

  assert.equal(input.assistant.failedResponsibleNotifications, null);
  assert.equal(input.assistant.uncertainResponsibleNotifications, null);
  assert.equal(input.assistant.staleResponsibleNotifications, null);
});

tests.push(() => {
  const input = store(build({
    sources: {
      appointmentRows: [
        {
          store_id: "store-1",
          status: "scheduled",
          scheduled_end: "2026-10-06T17:30:00.000Z",
        },
        {
          store_id: "store-1",
          status: "completed",
          scheduled_end: "2026-10-06T17:00:00.000Z",
        },
      ],
    },
  }));

  assert.equal(input.operations.overdueAppointments, 1);
});

tests.push(() => {
  const input = store(build({
    sources: {
      postAppointmentFollowupRows: [{
        store_id: "store-1",
        scheduled_end: "2026-10-06T17:45:00.000Z",
        prompt_count: 0,
        last_prompted_at: null,
        resolved_at: null,
      }],
    },
  }));

  assert.equal(input.operations.overduePostAppointmentFollowups, 1);
});

tests.push(() => {
  const input = store(build({
    sources: {
      postAppointmentFollowupRows: [
        {
          store_id: "store-1",
          scheduled_end: "2026-10-06T16:00:00.000Z",
          prompt_count: 1,
          last_prompted_at: "2026-10-06T17:20:00.000Z",
          resolved_at: null,
        },
        {
          store_id: "store-1",
          scheduled_end: "2026-10-06T16:00:00.000Z",
          prompt_count: 2,
          last_prompted_at: "2026-10-06T17:20:00.000Z",
          resolved_at: null,
        },
      ],
    },
  }));

  assert.equal(input.operations.overduePostAppointmentFollowups, 2);
});

tests.push(() => {
  const input = store(build({
    sources: {
      postAppointmentFollowupRows: [{
        store_id: "store-1",
        scheduled_end: "2026-10-06T16:00:00.000Z",
        prompt_count: 3,
        last_prompted_at: "2026-10-06T17:00:00.000Z",
        resolved_at: null,
      }],
    },
  }));

  assert.equal(input.operations.overduePostAppointmentFollowups, 0);
});

tests.push(() => {
  const input = store(build({
    sources: {
      whatsappInboxRows: null,
      whatsappOutboundRows: null,
      assistantOperationalQueueRows: null,
      responsibleNotificationRows: null,
      appointmentRows: null,
      postAppointmentFollowupRows: null,
    },
  }));

  assert.equal(input.whatsapp.staleInboundEvents, null);
  assert.equal(input.whatsapp.failedOutboundMessages, null);
  assert.equal(input.assistant.failedTasks, null);
  assert.equal(input.assistant.failedResponsibleNotifications, null);
  assert.equal(input.operations.overdueAppointments, null);
  assert.equal(input.operations.overduePostAppointmentFollowups, null);
});

tests.push(() => {
  assert.throws(
    () => buildStoreOperationalHealthInputs({
      storeIds: ["store-1"],
      now: NOW,
      thresholds: {
        ...thresholds,
        aiRunQueueStaleMs: -1,
      },
      sources: emptySources(),
    }),
    /Invalid operational health threshold/,
  );
});

tests.push(() => {
  const input = store(build({
    sources: {
      assistantOperationalQueueRows: [
        { store_id: "store-1", status: "failed", available_at: null, locked_at: null, created_at: NOW.toISOString() },
        { store_id: "store-1", status: "future_status", available_at: null, locked_at: null, created_at: NOW.toISOString() },
      ],
    },
  }));

  assert.equal(input.assistant.failedTasks, 1);
  assert.equal(input.assistant.staleProcessingTasks, null);
  assert.equal(input.assistant.stalePendingTasks, null);
});

tests.push(() => {
  const input = store(build({
    sources: {
      assistantOperationalQueueRows: [
        { store_id: "store-1", status: "future_status", available_at: null, locked_at: null, created_at: NOW.toISOString() },
        { store_id: "store-1", status: "failed", available_at: null, locked_at: null, created_at: NOW.toISOString() },
      ],
    },
  }));

  assert.equal(input.assistant.failedTasks, 1);
});

tests.push(() => {
  const input = store(build({
    sources: {
      responsibleNotificationRows: [
        { store_id: "store-1", status: "failed", locked_at: null },
        { store_id: "store-1", status: "future_status", locked_at: null },
      ],
    },
  }));

  assert.equal(input.assistant.failedResponsibleNotifications, 1);
});

tests.push(() => {
  const input = store(build({
    sources: {
      responsibleNotificationRows: [
        { store_id: "store-1", status: "future_status", locked_at: null },
        { store_id: "store-1", status: "failed", locked_at: null },
      ],
    },
  }));

  assert.equal(input.assistant.failedResponsibleNotifications, 1);
});

tests.push(() => {
  const input = store(build({
    sources: {
      responsibleNotificationRows: [
        { store_id: "store-1", status: "uncertain", locked_at: null },
      ],
    },
  }));

  assert.equal(input.assistant.uncertainResponsibleNotifications, 1);
});

tests.push(() => {
  const input = store(build({
    sources: {
      whatsappOutboundRows: [{
        store_id: "store-1",
        outbound_delivery_state: "future_state",
        outbound_claimed_at: null,
        outbound_attempt_started_at: null,
        created_at: NOW.toISOString(),
      }],
    },
  }));

  assert.equal(input.whatsapp.failedOutboundMessages, 0);
  assert.equal(input.whatsapp.uncertainOutboundMessages, 0);
  assert.equal(input.whatsapp.staleOutboundMessages, null);
});

tests.push(() => {
  const input = store(build({
    sources: {
      whatsappOutboundRows: [
        {
          store_id: "store-1",
          outbound_delivery_state: "failed",
          outbound_claimed_at: null,
          outbound_attempt_started_at: null,
          created_at: NOW.toISOString(),
        },
        {
          store_id: "store-1",
          outbound_delivery_state: "future_state",
          outbound_claimed_at: null,
          outbound_attempt_started_at: null,
          created_at: NOW.toISOString(),
        },
      ],
    },
  }));

  assert.equal(input.whatsapp.failedOutboundMessages, 1);
  assert.equal(input.whatsapp.staleOutboundMessages, null);
});

tests.push(() => {
  const baseRows = [
    { store_id: "store-1", outbound_delivery_state: null, outbound_claimed_at: null, outbound_attempt_started_at: null, created_at: NOW.toISOString() },
    { store_id: "store-1", outbound_delivery_state: "", outbound_claimed_at: null, outbound_attempt_started_at: null, created_at: NOW.toISOString() },
    { store_id: "store-1", outbound_delivery_state: "   ", outbound_claimed_at: null, outbound_attempt_started_at: null, created_at: NOW.toISOString() },
  ];
  const first = store(build({ sources: { whatsappOutboundRows: baseRows } }));
  const second = store(build({ sources: { whatsappOutboundRows: [...baseRows].reverse() } }));

  assert.equal(first.whatsapp.staleOutboundMessages, null);
  assert.equal(second.whatsapp.staleOutboundMessages, null);
  assert.equal(first.ai.latestRunState, "none");
  assert.equal(second.ai.latestRunState, "none");
});

tests.push(() => {
  const rows = [
    { store_id: "store-1", outbound_delivery_state: "failed", outbound_claimed_at: null, outbound_attempt_started_at: null, created_at: NOW.toISOString() },
    { store_id: "store-1", outbound_delivery_state: "", outbound_claimed_at: null, outbound_attempt_started_at: null, created_at: NOW.toISOString() },
  ];
  const first = store(build({ sources: { whatsappOutboundRows: rows } }));
  const second = store(build({ sources: { whatsappOutboundRows: [...rows].reverse() } }));

  assert.equal(first.whatsapp.failedOutboundMessages, 1);
  assert.equal(second.whatsapp.failedOutboundMessages, 1);
  assert.equal(first.whatsapp.staleOutboundMessages, null);
  assert.equal(second.whatsapp.staleOutboundMessages, null);
});

tests.push(() => {
  const input = store(build({
    sources: {
      whatsappOutboundRows: [
        { store_id: "store-1", outbound_delivery_state: null, outbound_claimed_at: null, outbound_attempt_started_at: null, created_at: "2026-10-06T17:30:00.000Z" },
        { store_id: "store-1", outbound_delivery_state: "sent", outbound_claimed_at: null, outbound_attempt_started_at: null, created_at: NOW.toISOString() },
        { store_id: "store-1", outbound_delivery_state: "pending", outbound_claimed_at: null, outbound_attempt_started_at: null, created_at: "2026-10-06T17:30:00.000Z" },
        { store_id: "store-1", outbound_delivery_state: "processing", outbound_claimed_at: "2026-10-06T17:30:00.000Z", outbound_attempt_started_at: null, created_at: NOW.toISOString() },
      ],
    },
  }));

  assert.equal(input.whatsapp.staleOutboundMessages, 3);
});

tests.push(() => {
  const input = store(build({
    sources: {
      aiRunRows: [
        { store_id: "store-1", status: "failed", error: "failure", created_at: "2026-10-06T17:30:00.000Z" },
        { store_id: "store-1", status: "succeeded", error: null, created_at: "not-a-date" },
      ],
    },
  }));

  assert.equal(input.ai.latestRunState, "unknown");
});

tests.push(() => {
  const rows = [
    { store_id: "store-1", received_at: "not-a-date", processed_at: null, processing_error: null },
    { store_id: "store-1", received_at: "2026-10-06T17:40:00.000Z", processed_at: null, processing_error: null },
  ];
  const first = store(build({ sources: { whatsappInboxRows: rows } }));
  const second = store(build({ sources: { whatsappInboxRows: [...rows].reverse() } }));

  assert.equal(first.whatsapp.staleInboundEvents, 1);
  assert.equal(second.whatsapp.staleInboundEvents, 1);
});

tests.push(() => {
  const input = store(build({
    sources: {
      assistantOperationalQueueRows: null,
      responsibleNotificationRows: [
        { store_id: "store-1", status: "failed", locked_at: null },
      ],
    },
  }));

  assert.equal(input.assistant.failedTasks, null);
  assert.equal(input.assistant.failedResponsibleNotifications, 1);
});

tests.push(() => {
  const result = build({
    storeIds: ["store-1", "store-2"],
    sources: {
      assistantOperationalQueueRows: [
        { store_id: "store-1", status: "failed", available_at: null, locked_at: null, created_at: NOW.toISOString() },
        { store_id: "store-2", status: "future_status", available_at: null, locked_at: null, created_at: NOW.toISOString() },
      ],
    },
  });

  assert.equal(store(result, "store-1").assistant.failedTasks, 1);
  assert.equal(store(result, "store-2").assistant.failedTasks, null);
});

for (let index = 0; index < tests.length; index += 1) {
  tests[index]();
}

console.log(
  `zion-admin-overview-operational-health-source-adapter: ${tests.length} tests passed`,
);
