export type StoreOperationalHealthState =
  | "healthy"
  | "warning"
  | "broken"
  | "unknown";

export type StoreAiOperationalState =
  | StoreOperationalHealthState
  | "idle";

export type StoreOperationalHealthIssueCode =
  | "whatsapp_inbound_stale"
  | "whatsapp_inbound_error"
  | "whatsapp_outbound_failed"
  | "whatsapp_outbound_uncertain"
  | "whatsapp_outbound_stale"
  | "ai_latest_run_failed"
  | "ai_run_queue_stale"
  | "assistant_task_failed"
  | "assistant_task_stale_processing"
  | "assistant_task_stale_pending"
  | "responsible_notification_failed"
  | "responsible_notification_uncertain"
  | "responsible_notification_stale_processing"
  | "appointment_overdue"
  | "post_appointment_followup_overdue";

export type StoreOperationalHealthIssue = {
  code: StoreOperationalHealthIssueCode;
  severity: "warning" | "error";
  scope: "whatsapp" | "ai" | "assistant" | "schedule" | "followup";
  count: number;
};

type MetricCount = number | null;

export type AiLatestRunState =
  | "succeeded"
  | "failed"
  | "none"
  | "unknown";

export type StoreOperationalHealthInput = {
  whatsapp: {
    staleInboundEvents: MetricCount;
    inboundErrors: MetricCount;
    failedOutboundMessages: MetricCount;
    uncertainOutboundMessages: MetricCount;
    staleOutboundMessages: MetricCount;
  };
  ai: {
    latestRunState: AiLatestRunState;
    staleQueueItems: MetricCount;
  };
  assistant: {
    failedTasks: MetricCount;
    staleProcessingTasks: MetricCount;
    stalePendingTasks: MetricCount;
    failedResponsibleNotifications: MetricCount;
    uncertainResponsibleNotifications: MetricCount;
    staleResponsibleNotifications: MetricCount;
  };
  operations: {
    overdueAppointments: MetricCount;
    overduePostAppointmentFollowups: MetricCount;
  };
};

export type StoreOperationalHealth = {
  state: StoreOperationalHealthState;
  issues: StoreOperationalHealthIssue[];
  whatsapp: StoreOperationalHealthInput["whatsapp"] & {
    state: StoreOperationalHealthState;
    liveConnectivity: "unverified";
  };
  ai: StoreOperationalHealthInput["ai"] & {
    state: StoreAiOperationalState;
  };
  assistant: StoreOperationalHealthInput["assistant"] & {
    state: StoreOperationalHealthState;
  };
  operations: StoreOperationalHealthInput["operations"] & {
    state: StoreOperationalHealthState;
  };
  observability: {
    workerHeartbeatAvailable: false;
  };
};

function isUnavailableCount(value: MetricCount) {
  return (
    value === null ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  );
}

function isPositiveCount(value: MetricCount) {
  return (
    value !== null &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value > 0
  );
}

function isKnownAiLatestRunState(
  value: unknown,
): value is AiLatestRunState {
  return (
    value === "succeeded" ||
    value === "failed" ||
    value === "none" ||
    value === "unknown"
  );
}

function resolveDimensionState(args: {
  issues: StoreOperationalHealthIssue[];
  unavailable: boolean;
}): StoreOperationalHealthState {
  if (args.issues.some((issue) => issue.severity === "error")) {
    return "broken";
  }

  if (args.unavailable) {
    return "unknown";
  }

  if (args.issues.some((issue) => issue.severity === "warning")) {
    return "warning";
  }

  return "healthy";
}

function pushCountIssue(args: {
  issues: StoreOperationalHealthIssue[];
  count: MetricCount;
  code: StoreOperationalHealthIssueCode;
  severity: StoreOperationalHealthIssue["severity"];
  scope: StoreOperationalHealthIssue["scope"];
}) {
  if (!isPositiveCount(args.count)) {
    return;
  }

  args.issues.push({
    code: args.code,
    severity: args.severity,
    scope: args.scope,
    count: args.count as number,
  });
}

export function resolveStoreOperationalHealth(
  input: StoreOperationalHealthInput,
): StoreOperationalHealth {
  const whatsappIssues: StoreOperationalHealthIssue[] = [];
  const aiIssues: StoreOperationalHealthIssue[] = [];
  const assistantIssues: StoreOperationalHealthIssue[] = [];
  const operationsIssues: StoreOperationalHealthIssue[] = [];

  pushCountIssue({
    issues: whatsappIssues,
    count: input.whatsapp.staleInboundEvents,
    code: "whatsapp_inbound_stale",
    severity: "error",
    scope: "whatsapp",
  });

  pushCountIssue({
    issues: whatsappIssues,
    count: input.whatsapp.inboundErrors,
    code: "whatsapp_inbound_error",
    severity: "error",
    scope: "whatsapp",
  });

  pushCountIssue({
    issues: whatsappIssues,
    count: input.whatsapp.failedOutboundMessages,
    code: "whatsapp_outbound_failed",
    severity: "error",
    scope: "whatsapp",
  });

  pushCountIssue({
    issues: whatsappIssues,
    count: input.whatsapp.uncertainOutboundMessages,
    code: "whatsapp_outbound_uncertain",
    severity: "error",
    scope: "whatsapp",
  });

  pushCountIssue({
    issues: whatsappIssues,
    count: input.whatsapp.staleOutboundMessages,
    code: "whatsapp_outbound_stale",
    severity: "error",
    scope: "whatsapp",
  });

  if (input.ai.latestRunState === "failed") {
    aiIssues.push({
      code: "ai_latest_run_failed",
      severity: "error",
      scope: "ai",
      count: 1,
    });
  }

  pushCountIssue({
    issues: aiIssues,
    count: input.ai.staleQueueItems,
    code: "ai_run_queue_stale",
    severity: "warning",
    scope: "ai",
  });

  pushCountIssue({
    issues: assistantIssues,
    count: input.assistant.failedTasks,
    code: "assistant_task_failed",
    severity: "error",
    scope: "assistant",
  });

  pushCountIssue({
    issues: assistantIssues,
    count: input.assistant.staleProcessingTasks,
    code: "assistant_task_stale_processing",
    severity: "error",
    scope: "assistant",
  });

  pushCountIssue({
    issues: assistantIssues,
    count: input.assistant.stalePendingTasks,
    code: "assistant_task_stale_pending",
    severity: "warning",
    scope: "assistant",
  });

  pushCountIssue({
    issues: assistantIssues,
    count: input.assistant.failedResponsibleNotifications,
    code: "responsible_notification_failed",
    severity: "error",
    scope: "assistant",
  });

  pushCountIssue({
    issues: assistantIssues,
    count: input.assistant.uncertainResponsibleNotifications,
    code: "responsible_notification_uncertain",
    severity: "error",
    scope: "assistant",
  });

  pushCountIssue({
    issues: assistantIssues,
    count: input.assistant.staleResponsibleNotifications,
    code: "responsible_notification_stale_processing",
    severity: "error",
    scope: "assistant",
  });


  pushCountIssue({
    issues: operationsIssues,
    count: input.operations.overdueAppointments,
    code: "appointment_overdue",
    severity: "warning",
    scope: "schedule",
  });

  pushCountIssue({
    issues: operationsIssues,
    count: input.operations.overduePostAppointmentFollowups,
    code: "post_appointment_followup_overdue",
    severity: "warning",
    scope: "followup",
  });

  const whatsappUnavailable = [
    input.whatsapp.staleInboundEvents,
    input.whatsapp.inboundErrors,
    input.whatsapp.failedOutboundMessages,
    input.whatsapp.uncertainOutboundMessages,
    input.whatsapp.staleOutboundMessages,
  ].some(isUnavailableCount);

  const aiLatestRunStateKnown = isKnownAiLatestRunState(
    input.ai.latestRunState,
  );

  const aiUnavailable =
    !aiLatestRunStateKnown ||
    input.ai.latestRunState === "unknown" ||
    isUnavailableCount(input.ai.staleQueueItems);

  const assistantUnavailable = [
    input.assistant.failedTasks,
    input.assistant.staleProcessingTasks,
    input.assistant.stalePendingTasks,
    input.assistant.failedResponsibleNotifications,
    input.assistant.uncertainResponsibleNotifications,
    input.assistant.staleResponsibleNotifications,
  ].some(isUnavailableCount);

  const operationsUnavailable = [
    input.operations.overdueAppointments,
    input.operations.overduePostAppointmentFollowups,
  ].some(isUnavailableCount);

  const whatsappState = resolveDimensionState({
    issues: whatsappIssues,
    unavailable: whatsappUnavailable,
  });

  const baseAiState = resolveDimensionState({
    issues: aiIssues,
    unavailable: aiUnavailable,
  });

  const aiState: StoreAiOperationalState =
    baseAiState === "healthy" && input.ai.latestRunState === "none"
      ? "idle"
      : baseAiState;

  const assistantState = resolveDimensionState({
    issues: assistantIssues,
    unavailable: assistantUnavailable,
  });

  const operationsState = resolveDimensionState({
    issues: operationsIssues,
    unavailable: operationsUnavailable,
  });

  const issues = [
    ...whatsappIssues,
    ...aiIssues,
    ...assistantIssues,
    ...operationsIssues,
  ];

  const hasError = issues.some((issue) => issue.severity === "error");
  const hasUnknown =
    whatsappState === "unknown" ||
    aiState === "unknown" ||
    assistantState === "unknown" ||
    operationsState === "unknown";
  const hasWarning = issues.some((issue) => issue.severity === "warning");

  return {
    state: hasError
      ? "broken"
      : hasUnknown
        ? "unknown"
        : hasWarning
          ? "warning"
          : "healthy",
    issues,
    whatsapp: {
      ...input.whatsapp,
      state: whatsappState,
      liveConnectivity: "unverified",
    },
    ai: {
      ...input.ai,
      state: aiState,
    },
    assistant: {
      ...input.assistant,
      state: assistantState,
    },
    operations: {
      ...input.operations,
      state: operationsState,
    },
    observability: {
      workerHeartbeatAvailable: false,
    },
  };
}