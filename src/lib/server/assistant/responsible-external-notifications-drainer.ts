import { createClient } from "@supabase/supabase-js";
import {
  cancelResponsibleExternalNotification,
  enqueueResponsibleExternalNotificationFromAssistantNotification,
  prepareResponsibleExternalNotification,
  unlockStuckResponsibleExternalNotificationProcessing,
} from "./responsible-external-notifications";
import { sendResponsibleExternalNotification } from "./responsible-external-notifications-sender";

const RESPONSIBLE_CHANNEL = "whatsapp_responsible";
const OPERATIONAL_APPROVAL_REASON =
  "customer_suggested_available_time_requires_approval";
const OPERATIONAL_APPROVAL_SOURCE = "assistant_operational_task_worker";
const OPERATIONAL_APPROVAL_CLASSIFICATION = "suggested_other_time";
const MAX_AUTOMATIC_SEND_ATTEMPTS = 3;
const DEFAULT_LIMIT = 20;
const AUTOMATIC_REPORT_TYPES = ["morning_report", "evening_report"] as const;
const AUTOMATIC_REPORT_SOURCE = "assistant_automatic_reports";
const AUTOMATIC_REPORT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const AUTOMATIC_REPORT_POLICY_FAILURES = new Set([
  "RESPONSIBLE_WHATSAPP_TEMPLATE_KIND_REQUIRED",
  "RESPONSIBLE_WHATSAPP_TEMPLATE_REQUIRED",
  "AUTOMATIC_REPORT_WHATSAPP_WINDOW_CLOSED",
]);

type ResponsibleOperationalApprovalOutboxRow = {
  id: string;
  organization_id: string;
  store_id: string;
  channel: string | null;
  notification_type: string | null;
  status: string | null;
  context: Record<string, unknown> | null;
  attempts: number | null;
  external_message_id: string | null;
  sent_at: string | null;
  error_text: string | null;
  created_at: string | null;
};

type DrainerDependencies = {
  supabase?: any;
  materialize?: typeof materializeResponsibleOperationalApprovalNotifications;
  prepare?: typeof prepareResponsibleExternalNotification;
  cancel?: typeof cancelResponsibleExternalNotification;
  send?: typeof sendResponsibleExternalNotification;
  loadCandidates?: (args: {
    supabase: any;
    organizationId: string;
    storeId: string;
    limit: number;
  }) => Promise<ResponsibleOperationalApprovalOutboxRow[]>;
};

export type DrainResponsibleOperationalApprovalNotificationsResult = {
  ok: true;
  scanned: number;
  eligible: number;
  prepared: number;
  sent: number;
  failed: number;
  uncertain: number;
  skipped: number;
  skippedReasons: Record<string, number>;
};

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function normalizeText(value: unknown) {
  return cleanText(value).toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAutomaticReportSource(context: Record<string, unknown>) {
  return [context.source, context.report_source].some(
    (value) => normalizeText(value) === AUTOMATIC_REPORT_SOURCE,
  );
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente para drainer do responsavel.",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function isResponsibleOperationalApprovalAutoDrainCandidate(
  row: ResponsibleOperationalApprovalOutboxRow,
) {
  const context = isRecord(row.context) ? row.context : {};

  const operationalApproval = (
    cleanText(row.channel) === RESPONSIBLE_CHANNEL &&
    normalizeText(row.notification_type) === "important_alert" &&
    normalizeText(context.source) === OPERATIONAL_APPROVAL_SOURCE &&
    normalizeText(context.reason) === OPERATIONAL_APPROVAL_REASON &&
    normalizeText(context.classification) === OPERATIONAL_APPROVAL_CLASSIFICATION &&
    context.suggested_available === true
  );

  if (operationalApproval) return true;

  const reportType = normalizeText(row.notification_type);
  const localDate = cleanText(context.local_date);
  return Boolean(
    cleanText(row.channel) === RESPONSIBLE_CHANNEL &&
      AUTOMATIC_REPORT_TYPES.includes(reportType as (typeof AUTOMATIC_REPORT_TYPES)[number]) &&
      isAutomaticReportSource(context) &&
      normalizeText(context.report_type) === reportType &&
      cleanText(context.event_key) === `assistant-automatic-report:${cleanText(row.organization_id)}:${cleanText(row.store_id)}:${localDate}:${reportType}` &&
      localDate &&
      Number.isFinite(Date.parse(cleanText(context.target_iso))),
  );
}

function isAutomaticReportCandidate(row: ResponsibleOperationalApprovalOutboxRow) {
  const context = isRecord(row.context) ? row.context : {};
  const reportType = normalizeText(row.notification_type);
  return (
    AUTOMATIC_REPORT_TYPES.includes(reportType as (typeof AUTOMATIC_REPORT_TYPES)[number]) &&
    isAutomaticReportSource(context)
  );
}

function isAutomaticReportStale(row: ResponsibleOperationalApprovalOutboxRow, now: Date) {
  const context = isRecord(row.context) ? row.context : {};
  const createdAt = Date.parse(cleanText(row.created_at));
  const targetAt = Date.parse(cleanText(context.target_iso));
  const reference = Number.isFinite(createdAt) ? createdAt : targetAt;
  return Number.isFinite(reference) && now.getTime() - reference > AUTOMATIC_REPORT_MAX_AGE_MS;
}

function isAutomaticReportPolicyFailure(row: ResponsibleOperationalApprovalOutboxRow) {
  return AUTOMATIC_REPORT_POLICY_FAILURES.has(cleanText(row.error_text));
}

export async function loadResponsibleOperationalApprovalCandidates(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  limit: number;
}) {
  const select =
    "id, organization_id, store_id, channel, notification_type, status, context, attempts, external_message_id, sent_at, error_text, created_at";
  const statuses = ["materialized", "ready_to_send", "failed", "processing"];

  // Reports use a distinct bounded query so old, non-allowlisted important
  // alerts cannot consume their entire FIFO page before the in-process
  // provenance check. Reports remain first because they expire after 24h.
  const reportsResult = await args.supabase
    .from("store_responsible_external_notifications")
    .select(select)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("channel", RESPONSIBLE_CHANNEL)
    .in("notification_type", AUTOMATIC_REPORT_TYPES)
    .in("status", statuses)
    .is("external_message_id", null)
    .is("sent_at", null)
    .order("created_at", { ascending: true })
    .limit(args.limit);

  if (reportsResult.error) {
    throw new Error(
      `Falha ao carregar outbox de aprovacao operacional do responsavel: ${reportsResult.error.message}`,
    );
  }

  const reports = (reportsResult.data || []) as ResponsibleOperationalApprovalOutboxRow[];
  const remainingLimit = Math.max(0, args.limit - reports.length);
  if (remainingLimit === 0) return reports;

  const alertsResult = await args.supabase
    .from("store_responsible_external_notifications")
    .select(select)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("channel", RESPONSIBLE_CHANNEL)
    .eq("notification_type", "important_alert")
    .in("status", statuses)
    .is("external_message_id", null)
    .is("sent_at", null)
    .order("created_at", { ascending: true })
    .limit(remainingLimit);

  if (alertsResult.error) {
    throw new Error(
      `Falha ao carregar outbox de aprovacao operacional do responsavel: ${alertsResult.error.message}`,
    );
  }

  return [...reports, ...((alertsResult.data || []) as ResponsibleOperationalApprovalOutboxRow[])];
}

function incrementReason(target: Record<string, number>, reason: string) {
  target[reason] = (target[reason] || 0) + 1;
}

type OperationalApprovalInternalNotificationRow = {
  id: string;
  organization_id: string;
  store_id: string;
  notification_type: string | null;
  priority: string | null;
  status: string | null;
  title: string | null;
  body: string | null;
  context: Record<string, unknown> | null;
  related_lead_id: string | null;
  related_conversation_id: string | null;
  related_appointment_id: string | null;
  created_at: string | null;
};

async function materializeResponsibleOperationalApprovalNotifications(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  limit: number;
}) {
  const { data, error } = await args.supabase
    .from("store_assistant_notification_queue")
    .select(
      "id, organization_id, store_id, notification_type, priority, status, title, body, context, related_lead_id, related_conversation_id, related_appointment_id, created_at",
    )
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .in("notification_type", ["important_alert", ...AUTOMATIC_REPORT_TYPES])
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(args.limit);

  if (error) {
    throw new Error(
      `Falha ao carregar notificacoes operacionais para materializacao: ${error.message}`,
    );
  }

  const notifications =
    (data || []) as OperationalApprovalInternalNotificationRow[];

  let created = 0;
  let skipped = 0;
  const skippedReasons: Record<string, number> = {};

  for (const notification of notifications) {
    if (!isOperationalApprovalInternalNotification(notification) && !isAutomaticReportInternalNotification(notification)) {
      skipped += 1;
      incrementReason(
        skippedReasons,
        "not_operational_approval_allowlist",
      );
      continue;
    }

    const result =
      await enqueueResponsibleExternalNotificationFromAssistantNotification({
        supabase: args.supabase,
        internalNotification: notification,
      });

    if (result.created) {
      created += 1;
      continue;
    }

    skipped += 1;
    incrementReason(
      skippedReasons,
      cleanText(result.skippedReason) || "not_materialized",
    );
  }

  return {
    scanned: notifications.length,
    created,
    skipped,
    skippedReasons,
  };
}

function isOperationalApprovalInternalNotification(
  notification: OperationalApprovalInternalNotificationRow,
) {
  const context =
    notification.context && typeof notification.context === "object"
      ? notification.context
      : null;

  return (
    cleanText(notification.notification_type) === "important_alert" &&
    (cleanText(notification.priority) === "high" ||
      cleanText(notification.priority) === "urgent") &&
    cleanText(notification.status) !== "cancelled" &&
    cleanText(context?.source) === OPERATIONAL_APPROVAL_SOURCE &&
    cleanText(context?.reason) === OPERATIONAL_APPROVAL_REASON &&
    cleanText(context?.classification) ===
      OPERATIONAL_APPROVAL_CLASSIFICATION &&
    context?.suggested_available === true
  );
}

export function isAutomaticReportInternalNotification(
  notification: OperationalApprovalInternalNotificationRow,
) {
  const context = isRecord(notification.context) ? notification.context : {};
  const notificationType = normalizeText(notification.notification_type);
  return Boolean(
    AUTOMATIC_REPORT_TYPES.includes(notificationType as (typeof AUTOMATIC_REPORT_TYPES)[number]) &&
      isAutomaticReportSource(context) &&
      normalizeText(context.report_type) === notificationType &&
      cleanText(context.event_key) &&
      cleanText(context.local_date) &&
      cleanText(context.target_iso),
  );
}

export async function drainResponsibleOperationalApprovalNotifications(
  args: {
    organizationId: string;
    storeId: string;
    limit?: number;
    now?: Date;
  },
  deps: DrainerDependencies = {},
): Promise<DrainResponsibleOperationalApprovalNotificationsResult> {
  const organizationId = cleanText(args.organizationId);
  const storeId = cleanText(args.storeId);
  const limit = Math.max(
    1,
    Math.min(Number(args.limit || DEFAULT_LIMIT), 100),
  );

  if (!organizationId || !storeId) {
    throw new Error(
      "organizationId e storeId sao obrigatorios para drenar alertas do responsavel.",
    );
  }

  const supabase = deps.supabase || getSupabaseAdmin();
  const materialize =
    deps.materialize || materializeResponsibleOperationalApprovalNotifications;
  const prepare =
    deps.prepare || prepareResponsibleExternalNotification;
  const cancel =
    deps.cancel || cancelResponsibleExternalNotification;
  const send =
    deps.send || sendResponsibleExternalNotification;
  const loadCandidates =
    deps.loadCandidates || loadResponsibleOperationalApprovalCandidates;

  await materialize({
    supabase,
    organizationId,
    storeId,
    limit,
  });

  const candidates = await loadCandidates({
    supabase,
    organizationId,
    storeId,
    limit,
  });

  let eligible = 0;
  let prepared = 0;
  let sent = 0;
  let failed = 0;
  let uncertain = 0;
  let skipped = 0;
  const skippedReasons: Record<string, number> = {};

  for (const row of candidates) {
    if (!isResponsibleOperationalApprovalAutoDrainCandidate(row)) {
      skipped += 1;
      incrementReason(skippedReasons, "not_operational_approval_allowlist");
      continue;
    }

    eligible += 1;

    if (isAutomaticReportCandidate(row) && isAutomaticReportStale(row, args.now || new Date())) {
      await cancel({
        supabase,
        organizationId,
        storeId,
        notificationId: cleanText(row.id),
      });
      skipped += 1;
      incrementReason(skippedReasons, "automatic_report_expired");
      continue;
    }

    const status = normalizeText(row.status);
    if (isAutomaticReportCandidate(row) && status === "failed" && isAutomaticReportPolicyFailure(row)) {
      skipped += 1;
      incrementReason(skippedReasons, "automatic_report_policy_failure_not_retried");
      continue;
    }

    const attempts = Math.max(0, Number(row.attempts || 0));
    if (attempts >= MAX_AUTOMATIC_SEND_ATTEMPTS) {
      skipped += 1;
      incrementReason(skippedReasons, "automatic_attempt_limit_reached");
      continue;
    }

    let currentStatus = status;

    try {
      if (currentStatus === "processing") {
        const recovery = await unlockStuckResponsibleExternalNotificationProcessing({
          supabase,
          organizationId,
          storeId,
          notificationId: cleanText(row.id),
        });
        if (!recovery.ok) {
          skipped += 1;
          incrementReason(skippedReasons, recovery.reason);
          continue;
        }
        if (recovery.status === "uncertain") {
          uncertain += 1;
          continue;
        }
        currentStatus = "failed";
      }
      if (currentStatus === "materialized" || currentStatus === "failed") {
        const prepareResult = await prepare({
          supabase,
          organizationId,
          storeId,
          notificationId: cleanText(row.id),
        });

        if (!prepareResult.ok) {
          skipped += 1;
          incrementReason(
            skippedReasons,
            cleanText(prepareResult.reason) || "prepare_failed",
          );
          continue;
        }

        prepared += 1;
        currentStatus = "ready_to_send";
      }

      if (currentStatus !== "ready_to_send") {
        skipped += 1;
        incrementReason(skippedReasons, "status_not_ready_to_send");
        continue;
      }

      const sendResult = await send({
        organizationId,
        storeId,
        notificationId: cleanText(row.id),
        uncertainOnTransportFailure: true,
      });

      if (sendResult.ok) {
        sent += 1;
        continue;
      }

      if (sendResult.reason === "send_uncertain") {
        uncertain += 1;
      } else {
        failed += 1;
      }
    } catch (error) {
      failed += 1;
      incrementReason(
        skippedReasons,
        error instanceof Error ? `exception:${error.message}` : "exception:unknown",
      );
    }
  }

  return {
    ok: true,
    scanned: candidates.length,
    eligible,
    prepared,
    sent,
    failed,
    uncertain,
    skipped,
    skippedReasons,
  };
}
