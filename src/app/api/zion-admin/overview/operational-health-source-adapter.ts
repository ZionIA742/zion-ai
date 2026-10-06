import type {
  AiLatestRunState,
  StoreOperationalHealthInput,
} from "./operational-health-resolution";

export type OperationalHealthSourceThresholds = {
  genericQueueStaleMs: number;
  assistantProcessingStaleMs: number;
  responsibleProcessingStaleMs: number;
  firstPostAppointmentFollowupDelayMs: number;
  subsequentPostAppointmentFollowupDelayMs: number;
  maxPostAppointmentPrompts: number;
};

export type WhatsappInboxHealthRow = {
  store_id: string | null;
  received_at: string | null;
  processed_at: string | null;
  processing_error: string | null;
};

export type WhatsappOutboundHealthRow = {
  store_id: string | null;
  outbound_delivery_state: string | null;
  outbound_claimed_at: string | null;
  outbound_attempt_started_at: string | null;
  created_at: string | null;
};

export type AiRunHealthRow = {
  store_id: string | null;
  status: string | null;
  error: string | null;
  created_at: string | null;
};

export type AiRunQueueHealthRow = {
  store_id: string | null;
  processed_at: string | null;
  enqueued_at: string | null;
};

export type AssistantOperationalQueueHealthRow = {
  store_id: string | null;
  status: string | null;
  available_at: string | null;
  locked_at: string | null;
  created_at: string | null;
};

export type ResponsibleNotificationHealthRow = {
  store_id: string | null;
  status: string | null;
  locked_at: string | null;
};

export type InternalNotificationHealthRow = {
  store_id: string | null;
  status: string | null;
  available_at: string | null;
  created_at: string | null;
};

export type AppointmentHealthRow = {
  store_id: string | null;
  status: string | null;
  scheduled_end: string | null;
};

export type PostAppointmentFollowupHealthRow = {
  store_id: string | null;
  scheduled_end: string | null;
  prompt_count: number | string | null;
  last_prompted_at: string | null;
  resolved_at: string | null;
};

export type OperationalHealthSources = {
  whatsappInboxRows: WhatsappInboxHealthRow[] | null;
  whatsappOutboundRows: WhatsappOutboundHealthRow[] | null;
  aiRunRows: AiRunHealthRow[] | null;
  aiRunQueueRows: AiRunQueueHealthRow[] | null;
  assistantOperationalQueueRows: AssistantOperationalQueueHealthRow[] | null;
  responsibleNotificationRows: ResponsibleNotificationHealthRow[] | null;
  internalNotificationRows: InternalNotificationHealthRow[] | null;
  appointmentRows: AppointmentHealthRow[] | null;
  postAppointmentFollowupRows: PostAppointmentFollowupHealthRow[] | null;
};

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeStatus(value: unknown) {
  return cleanText(value).toLowerCase();
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!cleanText(value)) {
    return null;
  }

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function isErroredText(value: string | null | undefined) {
  return cleanText(value).length > 0;
}

function validateThreshold(value: number, label: string) {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid operational health threshold: ${label}`);
  }
}

function validateThresholds(thresholds: OperationalHealthSourceThresholds) {
  validateThreshold(thresholds.genericQueueStaleMs, "genericQueueStaleMs");
  validateThreshold(
    thresholds.assistantProcessingStaleMs,
    "assistantProcessingStaleMs",
  );
  validateThreshold(
    thresholds.responsibleProcessingStaleMs,
    "responsibleProcessingStaleMs",
  );
  validateThreshold(
    thresholds.firstPostAppointmentFollowupDelayMs,
    "firstPostAppointmentFollowupDelayMs",
  );
  validateThreshold(
    thresholds.subsequentPostAppointmentFollowupDelayMs,
    "subsequentPostAppointmentFollowupDelayMs",
  );
  validateThreshold(
    thresholds.maxPostAppointmentPrompts,
    "maxPostAppointmentPrompts",
  );
}

function createEmptyInput(): StoreOperationalHealthInput {
  return {
    whatsapp: {
      staleInboundEvents: 0,
      inboundErrors: 0,
      failedOutboundMessages: 0,
      uncertainOutboundMessages: 0,
      staleOutboundMessages: 0,
    },
    ai: {
      latestRunState: "none",
      staleQueueItems: 0,
    },
    assistant: {
      failedTasks: 0,
      staleProcessingTasks: 0,
      stalePendingTasks: 0,
      failedResponsibleNotifications: 0,
      uncertainResponsibleNotifications: 0,
      staleResponsibleNotifications: 0,
      staleInternalNotifications: 0,
    },
    operations: {
      overdueAppointments: 0,
      overduePostAppointmentFollowups: 0,
    },
  };
}

function createStoreInputMap(storeIds: string[]) {
  const result = new Map<string, StoreOperationalHealthInput>();

  for (const rawStoreId of storeIds) {
    const storeId = cleanText(rawStoreId);
    if (!storeId || result.has(storeId)) {
      continue;
    }

    result.set(storeId, createEmptyInput());
  }

  return result;
}

function getInput(
  inputs: Map<string, StoreOperationalHealthInput>,
  storeId: string | null | undefined,
) {
  return inputs.get(cleanText(storeId)) ?? null;
}

function increment(
  input: StoreOperationalHealthInput | null,
  dimension: "whatsapp" | "ai" | "assistant" | "operations",
  key: string,
) {
  if (!input) {
    return;
  }

  const target = input[dimension] as unknown as Record<string, unknown>;
  const current = target[key];

  if (current === null) {
    return;
  }

  if (typeof current !== "number" || !Number.isFinite(current)) {
    target[key] = null;
    return;
  }

  target[key] = current + 1;
}

function markUnknown(
  input: StoreOperationalHealthInput | null,
  dimension: "whatsapp" | "ai" | "assistant" | "operations",
  key: string,
) {
  if (!input) {
    return;
  }

  const target = input[dimension] as unknown as Record<string, unknown>;
  target[key] = null;
}

function markAllStoresUnknown(
  inputs: Map<string, StoreOperationalHealthInput>,
  dimension: "whatsapp" | "ai" | "assistant" | "operations",
  keys: string[],
) {
  for (const input of inputs.values()) {
    for (const key of keys) {
      markUnknown(input, dimension, key);
    }
  }
}

function isAtOrBefore(value: string | null, cutoffMs: number) {
  const timestamp = parseTimestamp(value);

  if (timestamp === null) {
    return null;
  }

  return timestamp <= cutoffMs;
}

function applyWhatsappInbox(args: {
  inputs: Map<string, StoreOperationalHealthInput>;
  rows: WhatsappInboxHealthRow[] | null;
  nowMs: number;
  thresholds: OperationalHealthSourceThresholds;
}) {
  if (args.rows === null) {
    markAllStoresUnknown(args.inputs, "whatsapp", [
      "staleInboundEvents",
      "inboundErrors",
    ]);
    return;
  }

  const staleCutoff = args.nowMs - args.thresholds.genericQueueStaleMs;

  for (const row of args.rows) {
    const input = getInput(args.inputs, row.store_id);
    if (!input) continue;

    if (isErroredText(row.processing_error)) {
      increment(input, "whatsapp", "inboundErrors");
      continue;
    }

    if (row.processed_at) {
      continue;
    }

    const stale = isAtOrBefore(row.received_at, staleCutoff);

    if (stale === null) {
      markUnknown(input, "whatsapp", "staleInboundEvents");
    } else if (stale) {
      increment(input, "whatsapp", "staleInboundEvents");
    }
  }
}

function applyWhatsappOutbound(args: {
  inputs: Map<string, StoreOperationalHealthInput>;
  rows: WhatsappOutboundHealthRow[] | null;
  nowMs: number;
  thresholds: OperationalHealthSourceThresholds;
}) {
  if (args.rows === null) {
    markAllStoresUnknown(args.inputs, "whatsapp", [
      "failedOutboundMessages",
      "uncertainOutboundMessages",
      "staleOutboundMessages",
    ]);
    return;
  }

  const staleCutoff = args.nowMs - args.thresholds.genericQueueStaleMs;

  for (const row of args.rows) {
    const input = getInput(args.inputs, row.store_id);
    if (!input) continue;

    const status = normalizeStatus(row.outbound_delivery_state);

    if (status === "failed") {
      increment(input, "whatsapp", "failedOutboundMessages");
      continue;
    }

    if (status === "uncertain") {
      increment(input, "whatsapp", "uncertainOutboundMessages");
      continue;
    }

    if (status === "pending") {
      const stale = isAtOrBefore(row.created_at, staleCutoff);

      if (stale === null) {
        markUnknown(input, "whatsapp", "staleOutboundMessages");
      } else if (stale) {
        increment(input, "whatsapp", "staleOutboundMessages");
      }

      continue;
    }

    if (status === "processing") {
      const anchor = row.outbound_claimed_at || row.created_at;
      const stale = isAtOrBefore(anchor, staleCutoff);

      if (stale === null) {
        markUnknown(input, "whatsapp", "staleOutboundMessages");
      } else if (stale) {
        increment(input, "whatsapp", "staleOutboundMessages");
      }
    }
  }
}

function applyAiRuns(args: {
  inputs: Map<string, StoreOperationalHealthInput>;
  rows: AiRunHealthRow[] | null;
}) {
  if (args.rows === null) {
    for (const input of args.inputs.values()) {
      input.ai.latestRunState = "unknown";
    }
    return;
  }

  const latestByStore = new Map<
    string,
    { timestamp: number; row: AiRunHealthRow }
  >();
  const invalidTimestampStores = new Set<string>();

  for (const row of args.rows) {
    const storeId = cleanText(row.store_id);
    if (!args.inputs.has(storeId)) continue;

    const timestamp = parseTimestamp(row.created_at);

    if (timestamp === null) {
      invalidTimestampStores.add(storeId);
      continue;
    }

    const current = latestByStore.get(storeId);

    if (!current || timestamp > current.timestamp) {
      latestByStore.set(storeId, { timestamp, row });
    }
  }

  for (const [storeId, input] of args.inputs) {
    if (invalidTimestampStores.has(storeId)) {
      input.ai.latestRunState = "unknown";
      continue;
    }

    const latest = latestByStore.get(storeId);

    if (!latest) {
      input.ai.latestRunState = "none";
      continue;
    }

    const status = normalizeStatus(latest.row.status);

    let latestRunState: AiLatestRunState;

    if (status === "failed" || isErroredText(latest.row.error)) {
      latestRunState = "failed";
    } else if (status === "succeeded") {
      latestRunState = "succeeded";
    } else {
      latestRunState = "unknown";
    }

    input.ai.latestRunState = latestRunState;
  }
}

function applyAiRunQueue(args: {
  inputs: Map<string, StoreOperationalHealthInput>;
  rows: AiRunQueueHealthRow[] | null;
  nowMs: number;
  thresholds: OperationalHealthSourceThresholds;
}) {
  if (args.rows === null) {
    markAllStoresUnknown(args.inputs, "ai", ["staleQueueItems"]);
    return;
  }

  const staleCutoff = args.nowMs - args.thresholds.genericQueueStaleMs;

  for (const row of args.rows) {
    const input = getInput(args.inputs, row.store_id);
    if (!input || row.processed_at) continue;

    const stale = isAtOrBefore(row.enqueued_at, staleCutoff);

    if (stale === null) {
      markUnknown(input, "ai", "staleQueueItems");
    } else if (stale) {
      increment(input, "ai", "staleQueueItems");
    }
  }
}

function applyAssistantOperationalQueue(args: {
  inputs: Map<string, StoreOperationalHealthInput>;
  rows: AssistantOperationalQueueHealthRow[] | null;
  nowMs: number;
  thresholds: OperationalHealthSourceThresholds;
}) {
  if (args.rows === null) {
    markAllStoresUnknown(args.inputs, "assistant", [
      "failedTasks",
      "staleProcessingTasks",
      "stalePendingTasks",
    ]);
    return;
  }

  const processingCutoff =
    args.nowMs - args.thresholds.assistantProcessingStaleMs;
  const pendingCutoff = args.nowMs - args.thresholds.genericQueueStaleMs;

  for (const row of args.rows) {
    const input = getInput(args.inputs, row.store_id);
    if (!input) continue;

    const status = normalizeStatus(row.status);

    if (status === "failed") {
      increment(input, "assistant", "failedTasks");
      continue;
    }

    if (status === "processing") {
      const stale = isAtOrBefore(row.locked_at, processingCutoff);

      if (stale === null) {
        markUnknown(input, "assistant", "staleProcessingTasks");
      } else if (stale) {
        increment(input, "assistant", "staleProcessingTasks");
      }

      continue;
    }

    if (status === "pending") {
      const anchor = row.available_at || row.created_at;
      const stale = isAtOrBefore(anchor, pendingCutoff);

      if (stale === null) {
        markUnknown(input, "assistant", "stalePendingTasks");
      } else if (stale) {
        increment(input, "assistant", "stalePendingTasks");
      }
    }
  }
}

function applyResponsibleNotifications(args: {
  inputs: Map<string, StoreOperationalHealthInput>;
  rows: ResponsibleNotificationHealthRow[] | null;
  nowMs: number;
  thresholds: OperationalHealthSourceThresholds;
}) {
  if (args.rows === null) {
    markAllStoresUnknown(args.inputs, "assistant", [
      "failedResponsibleNotifications",
      "uncertainResponsibleNotifications",
      "staleResponsibleNotifications",
    ]);
    return;
  }

  const staleCutoff =
    args.nowMs - args.thresholds.responsibleProcessingStaleMs;

  for (const row of args.rows) {
    const input = getInput(args.inputs, row.store_id);
    if (!input) continue;

    const status = normalizeStatus(row.status);

    if (status === "failed") {
      increment(input, "assistant", "failedResponsibleNotifications");
      continue;
    }

    if (status === "uncertain") {
      increment(input, "assistant", "uncertainResponsibleNotifications");
      continue;
    }

    if (status === "processing") {
      const stale = isAtOrBefore(row.locked_at, staleCutoff);

      if (stale === null) {
        markUnknown(input, "assistant", "staleResponsibleNotifications");
      } else if (stale) {
        increment(input, "assistant", "staleResponsibleNotifications");
      }
    }
  }
}

function applyInternalNotifications(args: {
  inputs: Map<string, StoreOperationalHealthInput>;
  rows: InternalNotificationHealthRow[] | null;
  nowMs: number;
  thresholds: OperationalHealthSourceThresholds;
}) {
  if (args.rows === null) {
    markAllStoresUnknown(args.inputs, "assistant", [
      "staleInternalNotifications",
    ]);
    return;
  }

  const staleCutoff = args.nowMs - args.thresholds.genericQueueStaleMs;

  for (const row of args.rows) {
    const input = getInput(args.inputs, row.store_id);
    if (!input || normalizeStatus(row.status) !== "pending") {
      continue;
    }

    const anchor = row.available_at || row.created_at;
    const stale = isAtOrBefore(anchor, staleCutoff);

    if (stale === null) {
      markUnknown(input, "assistant", "staleInternalNotifications");
    } else if (stale) {
      increment(input, "assistant", "staleInternalNotifications");
    }
  }
}

function applyAppointments(args: {
  inputs: Map<string, StoreOperationalHealthInput>;
  rows: AppointmentHealthRow[] | null;
  nowMs: number;
}) {
  if (args.rows === null) {
    markAllStoresUnknown(args.inputs, "operations", [
      "overdueAppointments",
    ]);
    return;
  }

  for (const row of args.rows) {
    const input = getInput(args.inputs, row.store_id);
    if (!input) continue;

    const status = normalizeStatus(row.status);

    if (status !== "scheduled" && status !== "rescheduled") {
      continue;
    }

    const scheduledEnd = parseTimestamp(row.scheduled_end);

    if (scheduledEnd === null) {
      markUnknown(input, "operations", "overdueAppointments");
    } else if (scheduledEnd < args.nowMs) {
      increment(input, "operations", "overdueAppointments");
    }
  }
}

function parsePromptCount(value: number | string | null) {
  if (value === null || cleanText(value) === "") {
    return 0;
  }

  const parsed = Number(value);

  if (
    !Number.isFinite(parsed) ||
    !Number.isInteger(parsed) ||
    parsed < 0
  ) {
    return null;
  }

  return parsed;
}

function applyPostAppointmentFollowups(args: {
  inputs: Map<string, StoreOperationalHealthInput>;
  rows: PostAppointmentFollowupHealthRow[] | null;
  nowMs: number;
  thresholds: OperationalHealthSourceThresholds;
}) {
  if (args.rows === null) {
    markAllStoresUnknown(args.inputs, "operations", [
      "overduePostAppointmentFollowups",
    ]);
    return;
  }

  for (const row of args.rows) {
    const input = getInput(args.inputs, row.store_id);
    if (!input || row.resolved_at) continue;

    const promptCount = parsePromptCount(row.prompt_count);

    if (promptCount === null) {
      markUnknown(
        input,
        "operations",
        "overduePostAppointmentFollowups",
      );
      continue;
    }

    if (promptCount >= args.thresholds.maxPostAppointmentPrompts) {
      continue;
    }

    if (promptCount === 0) {
      const scheduledEnd = parseTimestamp(row.scheduled_end);

      if (scheduledEnd === null) {
        markUnknown(
          input,
          "operations",
          "overduePostAppointmentFollowups",
        );
      } else if (
        scheduledEnd +
          args.thresholds.firstPostAppointmentFollowupDelayMs <=
        args.nowMs
      ) {
        increment(
          input,
          "operations",
          "overduePostAppointmentFollowups",
        );
      }

      continue;
    }

    const lastPromptedAt = parseTimestamp(row.last_prompted_at);

    if (lastPromptedAt === null) {
      markUnknown(
        input,
        "operations",
        "overduePostAppointmentFollowups",
      );
    } else if (
      lastPromptedAt +
        args.thresholds.subsequentPostAppointmentFollowupDelayMs <=
      args.nowMs
    ) {
      increment(
        input,
        "operations",
        "overduePostAppointmentFollowups",
      );
    }
  }
}

export function buildStoreOperationalHealthInputs(args: {
  storeIds: string[];
  now: Date;
  thresholds: OperationalHealthSourceThresholds;
  sources: OperationalHealthSources;
}) {
  validateThresholds(args.thresholds);

  const nowMs = args.now.getTime();

  if (!Number.isFinite(nowMs)) {
    throw new Error("Invalid operational health now timestamp");
  }

  const inputs = createStoreInputMap(args.storeIds);

  applyWhatsappInbox({
    inputs,
    rows: args.sources.whatsappInboxRows,
    nowMs,
    thresholds: args.thresholds,
  });

  applyWhatsappOutbound({
    inputs,
    rows: args.sources.whatsappOutboundRows,
    nowMs,
    thresholds: args.thresholds,
  });

  applyAiRuns({
    inputs,
    rows: args.sources.aiRunRows,
  });

  applyAiRunQueue({
    inputs,
    rows: args.sources.aiRunQueueRows,
    nowMs,
    thresholds: args.thresholds,
  });

  applyAssistantOperationalQueue({
    inputs,
    rows: args.sources.assistantOperationalQueueRows,
    nowMs,
    thresholds: args.thresholds,
  });

  applyResponsibleNotifications({
    inputs,
    rows: args.sources.responsibleNotificationRows,
    nowMs,
    thresholds: args.thresholds,
  });

  applyInternalNotifications({
    inputs,
    rows: args.sources.internalNotificationRows,
    nowMs,
    thresholds: args.thresholds,
  });

  applyAppointments({
    inputs,
    rows: args.sources.appointmentRows,
    nowMs,
  });

  applyPostAppointmentFollowups({
    inputs,
    rows: args.sources.postAppointmentFollowupRows,
    nowMs,
    thresholds: args.thresholds,
  });

  return inputs;
}