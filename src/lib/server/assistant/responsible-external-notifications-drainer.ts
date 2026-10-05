import { createClient } from "@supabase/supabase-js";
import {
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
  created_at: string | null;
};

type DrainerDependencies = {
  supabase?: any;
  materialize?: typeof materializeResponsibleOperationalApprovalNotifications;
  prepare?: typeof prepareResponsibleExternalNotification;
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

  return (
    cleanText(row.channel) === RESPONSIBLE_CHANNEL &&
    normalizeText(row.notification_type) === "important_alert" &&
    normalizeText(context.source) === OPERATIONAL_APPROVAL_SOURCE &&
    normalizeText(context.reason) === OPERATIONAL_APPROVAL_REASON &&
    normalizeText(context.classification) === OPERATIONAL_APPROVAL_CLASSIFICATION &&
    context.suggested_available === true
  );
}

async function loadResponsibleOperationalApprovalCandidates(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  limit: number;
}) {
  const { data, error } = await args.supabase
    .from("store_responsible_external_notifications")
    .select(
      "id, organization_id, store_id, channel, notification_type, status, context, attempts, external_message_id, sent_at, created_at",
    )
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("channel", RESPONSIBLE_CHANNEL)
    .eq("notification_type", "important_alert")
    .in("status", ["materialized", "ready_to_send", "failed", "processing"])
    .contains("context", {
      source: OPERATIONAL_APPROVAL_SOURCE,
      reason: OPERATIONAL_APPROVAL_REASON,
      classification: OPERATIONAL_APPROVAL_CLASSIFICATION,
      suggested_available: true,
    })
    .is("external_message_id", null)
    .is("sent_at", null)
    .order("created_at", { ascending: true })
    .limit(args.limit);

  if (error) {
    throw new Error(
      `Falha ao carregar outbox de aprovacao operacional do responsavel: ${error.message}`,
    );
  }

  return (data || []) as ResponsibleOperationalApprovalOutboxRow[];
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
    .eq("notification_type", "important_alert")
    .in("priority", ["high", "urgent"])
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
    if (!isOperationalApprovalInternalNotification(notification)) {
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

export async function drainResponsibleOperationalApprovalNotifications(
  args: {
    organizationId: string;
    storeId: string;
    limit?: number;
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

    const attempts = Math.max(0, Number(row.attempts || 0));
    if (attempts >= MAX_AUTOMATIC_SEND_ATTEMPTS) {
      skipped += 1;
      incrementReason(skippedReasons, "automatic_attempt_limit_reached");
      continue;
    }

    let status = normalizeText(row.status);

    try {
      if (status === "processing") {
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
        status = "failed";
      }
      if (status === "materialized" || status === "failed") {
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
        status = "ready_to_send";
      }

      if (status !== "ready_to_send") {
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
