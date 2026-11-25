import type { SupabaseClient } from "@supabase/supabase-js";

export const HUMAN_RESPONSE_ALERT_THRESHOLDS_MINUTES = [10, 30] as const;
const ALERT_SOURCE = "p10_7_a1_2_human_response_scanner";

function isAtomicEventKeyConflict(error: { code?: string | null } | null) {
  return error?.code === "23505";
}

export type HumanResponseCommitmentCandidate = {
  id: string;
  organization_id: string;
  store_id: string;
  conversation_id: string;
  source_message_id: string;
  due_at: string;
  status: string;
};

export type HumanResponseSourceMessage = {
  id: string;
  conversation_id: string;
  created_at: string;
};

export type HumanResponseAuthority = {
  conversation_id: string;
  released_at: string | null;
};

export type ExistingHumanResponseAlert = {
  status: string | null;
  context: Record<string, unknown> | null;
};

export type HumanResponseAlertPlan = {
  commitmentId: string;
  organizationId: string;
  storeId: string;
  conversationId: string;
  relatedLeadId: string | null;
  thresholdMinutes: (typeof HUMAN_RESPONSE_ALERT_THRESHOLDS_MINUTES)[number];
  eventKey: string;
  title: string;
  body: string;
  priority: "normal" | "high";
};

export function planHumanResponseAlerts(args: {
  commitments: HumanResponseCommitmentCandidate[];
  sourceMessages: HumanResponseSourceMessage[];
  authorities: HumanResponseAuthority[];
  existingAlerts: ExistingHumanResponseAlert[];
  now?: Date;
}): HumanResponseAlertPlan[] {
  const nowMs = (args.now ?? new Date()).getTime();
  const sourceById = new Map(args.sourceMessages.map((row) => [row.id, row]));
  const authorityByConversation = new Map(
    args.authorities.map((row) => [row.conversation_id, row]),
  );
  const deliveredOrQueuedKeys = new Set(
    args.existingAlerts
      .filter((row) => ["pending", "processing", "sent"].includes(row.status ?? ""))
      .map((row) => String(row.context?.event_key ?? "").trim())
      .filter(Boolean),
  );

  return args.commitments.flatMap((commitment) => {
    if (commitment.status !== "active") return [];
    if (Date.parse(commitment.due_at) > nowMs) return [];

    const source = sourceById.get(commitment.source_message_id);
    const authority = authorityByConversation.get(commitment.conversation_id);
    if (!source || !authority || authority.released_at !== null) return [];

    const elapsedMinutes = (nowMs - Date.parse(source.created_at)) / 60000;
    const thresholdMinutes = [...HUMAN_RESPONSE_ALERT_THRESHOLDS_MINUTES]
      .reverse()
      .find((threshold) => elapsedMinutes >= threshold);
    if (!thresholdMinutes) return [];

    const eventKey = `human-response:${commitment.id}:${thresholdMinutes}`;
    if (deliveredOrQueuedKeys.has(eventKey)) return [];

    return [{
      commitmentId: commitment.id,
      organizationId: commitment.organization_id,
      storeId: commitment.store_id,
      conversationId: commitment.conversation_id,
      relatedLeadId: null,
      thresholdMinutes,
      eventKey,
      title: `Resposta humana pendente há ${thresholdMinutes} minutos`,
      body: `A conversa ${commitment.conversation_id} aguarda resposta humana há pelo menos ${thresholdMinutes} minutos.`,
      priority: thresholdMinutes === 30 ? "high" : "normal",
    }];
  });
}

function isVerifiedHumanResponse(row: Record<string, unknown>) {
  if (row.sender !== "human" || row.direction !== "outgoing") return false;
  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  if (metadata.source === "panel") {
    return typeof metadata.sent_by_user_id === "string" && metadata.sent_by_user_id.length > 0;
  }
  return (
    metadata.source === "meta_whatsapp_webhook" &&
    metadata.channel === "whatsapp" &&
    metadata.origin === "whatsapp_business_app" &&
    metadata.event_kind === "message_echo" &&
    (row.message_type !== "audio" ||
      (metadata.transcription_status === "succeeded" &&
        typeof metadata.audio_transcript === "string" &&
        metadata.audio_transcript.trim().length > 0))
  );
}

export async function scanHumanResponseAlerts(args: {
  supabase: SupabaseClient;
  organizationId: string;
  storeId: string;
  now?: Date;
}) {
  const { data: commitments, error: commitmentsError } = await args.supabase.rpc(
    "read_human_response_commitments_by_system",
    {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_conversation_id: null,
    },
  );
  if (commitmentsError) {
    return { ok: false as const, reason: "commitments_unavailable", alerted: 0, fulfilled: 0 };
  }

  const rows = (commitments ?? []) as HumanResponseCommitmentCandidate[];
  if (rows.length === 0) return { ok: true as const, reason: "no_active_commitments", alerted: 0, fulfilled: 0 };

  const sourceIds = rows.map((row) => row.source_message_id);
  const conversationIds = [...new Set(rows.map((row) => row.conversation_id))];
  const sourceResult = await args.supabase
    .from("messages")
    .select("id, conversation_id, created_at")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .in("id", sourceIds);
  const authorityResult = await args.supabase
    .from("conversation_human_takeover_leases")
    .select("conversation_id, released_at")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .in("conversation_id", conversationIds);
  if (sourceResult.error || authorityResult.error) {
    return { ok: false as const, reason: "human_authority_unavailable", alerted: 0, fulfilled: 0 };
  }

  const followupResult = await args.supabase
    .from("messages")
    .select("id, conversation_id, sender, direction, message_type, created_at, metadata")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .in("conversation_id", conversationIds)
    .eq("sender", "human")
    .eq("direction", "outgoing");
  if (followupResult.error) {
    return { ok: false as const, reason: "human_response_lookup_unavailable", alerted: 0, fulfilled: 0 };
  }

  let fulfilled = 0;
  const sourceById = new Map((sourceResult.data ?? []).map((row) => [row.id, row]));
  for (const commitment of rows.filter((row) => row.status === "active")) {
    const source = sourceById.get(commitment.source_message_id);
    const response = (followupResult.data ?? []).find(
      (row) => row.conversation_id === commitment.conversation_id &&
        row.id !== commitment.source_message_id &&
        Date.parse(row.created_at) > Date.parse(source?.created_at ?? "") &&
        isVerifiedHumanResponse(row as Record<string, unknown>),
    );
    if (!response) continue;
    const { error } = await args.supabase.rpc("transition_human_response_commitment_by_system", {
      p_commitment_id: commitment.id,
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_status: "fulfilled",
      p_operation_key: `p10-7-a1-2:fulfilled:${commitment.id}:${response.id}`,
      p_due_at: null,
    });
    if (error) return { ok: false as const, reason: "commitment_transition_failed", alerted: 0, fulfilled };
    commitment.status = "fulfilled";
    fulfilled += 1;
  }

  const existingResult = await args.supabase
    .from("store_assistant_notification_queue")
    .select("status, context")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .limit(500);
  if (existingResult.error) return { ok: false as const, reason: "notification_queue_unavailable", alerted: 0, fulfilled };

  const plans = planHumanResponseAlerts({
    commitments: rows,
    sourceMessages: (sourceResult.data ?? []) as HumanResponseSourceMessage[],
    authorities: (authorityResult.data ?? []) as HumanResponseAuthority[],
    existingAlerts: (existingResult.data ?? []) as ExistingHumanResponseAlert[],
    now: args.now,
  });
  let alerted = 0;
  for (const plan of plans) {
    const { error } = await args.supabase.rpc("assistant_enqueue_internal_notification", {
      p_organization_id: plan.organizationId,
      p_store_id: plan.storeId,
      p_notification_type: "important_alert",
      p_title: plan.title,
      p_body: plan.body,
      p_priority: plan.priority,
      p_context: {
        source: ALERT_SOURCE,
        reason: "human_response_pending",
        commitment_id: plan.commitmentId,
        threshold_minutes: plan.thresholdMinutes,
        event_key: plan.eventKey,
        needs_human_action: true,
      },
      p_related_lead_id: plan.relatedLeadId,
      p_related_conversation_id: plan.conversationId,
      p_related_appointment_id: null,
      p_event_key: plan.eventKey,
    });
    if (error) {
      // A concurrent scanner may have won the partial unique index. That is
      // a successful deduplication outcome, not a reason to retry or reopen.
      if (isAtomicEventKeyConflict(error)) {
        continue;
      }
      return { ok: false as const, reason: "notification_enqueue_failed", alerted, fulfilled };
    }
    alerted += 1;
  }
  return { ok: true as const, reason: "scanned", alerted, fulfilled };
}
