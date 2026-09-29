import { createClient } from "@supabase/supabase-js";
import {
  sendResponsibleExternalNotification,
} from "@/lib/server/assistant/responsible-external-notifications-sender";

export const POST_TECHNICAL_VISIT_MAX_ATTEMPTS = 3;
export const POST_TECHNICAL_VISIT_SOURCE = "p9_7_4";

type CompletionOutcome = "fully_completed" | "needs_followup" | null;

export function calculatePostTechnicalVisitDue(input: {
  scheduledEnd: string | Date | null | undefined;
  promptCount: number;
  lastPromptedAt?: string | Date | null;
}) {
  const anchor = toDate(input.scheduledEnd);
  if (!anchor || !Number.isFinite(input.promptCount) || input.promptCount < 0) {
    return null;
  }
  if (input.promptCount === 0) {
    return new Date(anchor.getTime() + 10 * 60 * 1000);
  }
  const last = toDate(input.lastPromptedAt) || anchor;
  return new Date(last.getTime() + 30 * 60 * 1000);
}

export function isPostTechnicalVisitEligible(input: {
  appointmentType?: string | null;
  status?: string | null;
  scheduledEnd?: string | Date | null;
  now?: string | Date;
  completionOutcome?: CompletionOutcome;
  resolvedAt?: string | Date | null;
  promptCount?: number;
}) {
  if (input.appointmentType !== "technical_visit") return false;
  if (input.status === "cancelled") return false;
  if (input.resolvedAt) return false;
  if ((input.promptCount ?? 0) >= POST_TECHNICAL_VISIT_MAX_ATTEMPTS) return false;
  if (input.completionOutcome === "fully_completed") return false;
  if (input.status === "completed" && !input.completionOutcome) return false;
  if (input.completionOutcome && input.completionOutcome !== "needs_followup") {
    return false;
  }
  const due = calculatePostTechnicalVisitDue({
    scheduledEnd: input.scheduledEnd,
    promptCount: input.promptCount ?? 0,
  });
  const now = toDate(input.now) || new Date();
  return Boolean(due && due.getTime() <= now.getTime());
}

function toDate(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials are missing");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type PostTechnicalVisitFollowupRun = {
  processed: number;
  sent: number;
  failed: number;
  uncertain: number;
  skipped: number;
};

export async function processPostTechnicalVisitFollowups(input: {
  organizationId: string;
  storeId: string;
  limit?: number;
}): Promise<PostTechnicalVisitFollowupRun> {
  const supabase = getSupabaseAdmin();
  const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? 10), 100));
  const result: PostTechnicalVisitFollowupRun = {
    processed: 0,
    sent: 0,
    failed: 0,
    uncertain: 0,
    skipped: 0,
  };

  for (let index = 0; index < limit; index += 1) {
    const claim = await supabase.rpc("claim_post_technical_visit_followup_attempt", {
      p_organization_id: input.organizationId,
      p_store_id: input.storeId,
      p_now: new Date().toISOString(),
    });
    if (claim.error) throw new Error(`7.4 claim failed: ${claim.error.message}`);
    const claimed = Array.isArray(claim.data) ? claim.data[0] : claim.data;
    if (!claimed?.attempt_id || !claimed?.notification_id) break;

    result.processed += 1;
    const send = await sendResponsibleExternalNotification({
      organizationId: input.organizationId,
      storeId: input.storeId,
      notificationId: claimed.notification_id,
      uncertainOnTransportFailure: true,
    });
    if (!send.ok && ["already_processing_or_not_ready", "not_ready_to_send"].includes(send.reason)) {
      // Another worker owns the transport or the notification is being
      // reconciled. Never turn that ownership state into a business failure.
      result.skipped += 1;
      continue;
    }
    const outcome = send.ok ? "sent" : send.reason === "send_uncertain" ? "uncertain" : "failed";
    const finalized = await supabase.rpc("finalize_post_technical_visit_followup_attempt", {
      p_organization_id: input.organizationId,
      p_store_id: input.storeId,
      p_attempt_id: claimed.attempt_id,
      p_outcome: outcome,
      p_external_notification_id: claimed.notification_id,
      p_external_message_id: send.ok ? send.externalMessageId : null,
      p_error: send.ok ? null : send.reason,
    });
    if (finalized.error) throw new Error(`7.4 finalize failed: ${finalized.error.message}`);
    if (finalized.data === false) {
      result.skipped += 1;
      continue;
    }

    if (send.ok) result.sent += 1;
    else if (outcome === "uncertain") result.uncertain += 1;
    else result.failed += 1;
  }

  return result;
}

export async function recordPostTechnicalVisitResponsibleInbound(input: {
  organizationId: string;
  storeId: string;
  responsibleId: string;
  inboundExternalMessageId: string;
  repliedToExternalMessageId?: string | null;
  rawContent?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "record_post_technical_visit_followup_response",
    {
      p_organization_id: input.organizationId,
      p_store_id: input.storeId,
      p_responsible_id: input.responsibleId,
      p_inbound_external_message_id: input.inboundExternalMessageId,
      p_replied_to_external_message_id: input.repliedToExternalMessageId || null,
      p_raw_content: input.rawContent || null,
      p_metadata: input.metadata || {},
      p_received_at: new Date().toISOString(),
    },
  );
  if (error) throw new Error(`7.4 inbound response failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    handled: Boolean(row?.handled),
    correlationStatus: String(row?.correlation_status || "unmatched"),
    responseId: row?.response_id || null,
  };
}
