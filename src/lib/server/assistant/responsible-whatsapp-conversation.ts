import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import {
  generateAssistantReply,
  getOrCreateAssistantThread,
} from "@/app/api/assistant/reply/route";
import { loadCanonicalActivePrimaryStoreResponsible } from "@/lib/server/store-responsibles";
import { sendResponsibleAssistantText } from "@/lib/server/assistant/responsible-external-notifications-sender";
import { downloadAndStoreWhatsappInboundMedia, removeWhatsappInboundStoredMedia } from "@/lib/server/whatsapp-inbound-media";
import { transcribeCustomerAudioFromStorage } from "@/lib/server/transcribe-customer-audio";
import type { QuoteApprovalDecisionResult } from "@/lib/server/sales-quotes/quote-approval-decision";

type ResponsibleWhatsappEvent = {
  id: string;
  organization_id?: string | null;
  store_id?: string | null;
  responsible_id?: string | null;
  destination?: string | null;
  external_message_id?: string | null;
  status: string;
  claim_token: string | null;
  inbound_message_id?: string | null;
  assistant_message_id?: string | null;
  attempts?: number | null;
  max_attempts?: number | null;
  outbound_status?: string | null;
  outbound_started_at?: string | null;
  external_response_id?: string | null;
  error_text?: string | null;
  created_at?: string | null;
};

type PersistedInboundMessage = {
  id: string;
  organization_id: string;
  store_id: string;
  thread_id: string | null;
  content: string | null;
  metadata: Record<string, unknown> | null;
};

export class ResponsibleAudioTranscriptionError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ResponsibleAudioTranscriptionError";
  }
}

const RESPONSIBLE_EVENT_RECOVERY_MAX_AGE_MS = 23 * 60 * 60 * 1000;
const RESPONSIBLE_EVENT_RECOVERY_MAX_LIMIT = 10;

export type PersistedResponsibleWhatsappEventResumeResult =
  | { status: "resumed"; eventId: string }
  | { status: "skipped"; eventId: string; reason: string };

type ResumePersistedResponsibleWhatsappEventDeps = {
  loadResponsible: typeof loadCanonicalActivePrimaryStoreResponsible;
  resumeRoute: typeof routeResponsibleWhatsappToAssistant;
};

type ResponsibleWhatsappRouteDeps = {
  transcribeAudio: typeof transcribeCustomerAudioFromStorage;
};

type ResponsibleWhatsappMedia = {
  mediaId: string;
  mediaKind: "image" | "audio" | "document";
  mimeType?: string | null;
  sha256?: string | null;
  fileName?: string | null;
  caption?: string | null;
  voice?: boolean | null;
};

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role nao configurada.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          cache: "no-store",
        }),
    },
  });
}

function clean(value: unknown) {
  return String(value || "").trim();
}

function isValidExternalMessageId(value: string) {
  return /^[\x21-\x7E]{1,512}$/.test(value);
}

async function loadOrCreateEvent(args: {
  supabase: SupabaseClient;
  organizationId: string;
  storeId: string;
  responsibleId: string;
  externalMessageId: string;
  destination: string;
}) {
  const { data: inserted, error: insertError } = await args.supabase
    .from("store_assistant_responsible_whatsapp_events")
    .insert({
      organization_id: args.organizationId,
      store_id: args.storeId,
      responsible_id: args.responsibleId,
      external_message_id: args.externalMessageId,
      destination: args.destination,
      status: "received",
    })
    .select("id, status, claim_token, inbound_message_id, assistant_message_id, attempts, outbound_status")
    .maybeSingle();

  if (!insertError && inserted) return inserted as ResponsibleWhatsappEvent;

  const { data: existing, error: existingError } = await args.supabase
    .from("store_assistant_responsible_whatsapp_events")
    .select("id, status, claim_token, inbound_message_id, assistant_message_id, attempts, outbound_status")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("external_message_id", args.externalMessageId)
    .maybeSingle();

  if (existingError || !existing) {
    throw new Error(insertError?.message || existingError?.message || "responsible WhatsApp event unavailable");
  }

  return existing as ResponsibleWhatsappEvent;
}

async function claimEvent(args: {
  supabase: SupabaseClient;
  event: ResponsibleWhatsappEvent;
}) {
  if (["sent", "uncertain", "failed"].includes(args.event.status)) return false;

  const claimToken = randomUUID();
  const { data, error } = await args.supabase.rpc(
    "claim_store_assistant_responsible_whatsapp_event",
    {
      p_event_id: args.event.id,
      p_claim_token: claimToken,
      p_now: new Date().toISOString(),
      p_stale_after: "00:10:00",
    },
  );

  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.claimed) {
    args.event.status = String(row?.status || args.event.status);
    return false;
  }
  args.event.claim_token = String(row.claim_token || claimToken);
  args.event.status = String(row.status || "processing");
  return true;
}

async function updateEvent(
  supabase: SupabaseClient,
  id: string,
  claimToken: string,
  values: Record<string, unknown>,
) {
  const { data, error } = await supabase
    .from("store_assistant_responsible_whatsapp_events")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "processing")
    .eq("locked_by", claimToken)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error("RESPONSIBLE_ASSISTANT_EVENT_CLAIM_LOST");
}

export async function recoverStaleResponsibleWhatsappEvents(args: {
  supabase?: SupabaseClient;
  organizationId: string;
  storeId: string;
  limit?: number;
}) {
  const supabase = args.supabase || getSupabaseAdmin();
  const { data, error } = await supabase.rpc(
    "recover_stale_store_assistant_responsible_whatsapp_events",
    {
      p_organization_id: clean(args.organizationId),
      p_store_id: clean(args.storeId),
      p_now: new Date().toISOString(),
      p_stale_after: "00:10:00",
      p_limit: Math.max(1, Math.min(Number(args.limit || 20), 100)),
    },
  );
  if (error) throw new Error(`Falha ao recuperar inbound stale do responsavel: ${error.message}`);
  return (data || []) as Array<{
    event_id: string;
    status: "received" | "uncertain" | "failed";
    action: string;
  }>;
}

async function loadPersistedResponsibleWhatsappEvent(args: {
  supabase: SupabaseClient;
  eventId: string;
}) {
  const { data, error } = await args.supabase
    .from("store_assistant_responsible_whatsapp_events")
    .select("id, organization_id, store_id, responsible_id, destination, external_message_id, status, claim_token, inbound_message_id, assistant_message_id, attempts, max_attempts, outbound_status, outbound_started_at, external_response_id, error_text, created_at")
    .eq("id", args.eventId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data || null) as ResponsibleWhatsappEvent | null;
}

async function loadPersistedResponsibleWhatsappInbound(args: {
  supabase: SupabaseClient;
  event: ResponsibleWhatsappEvent;
  organizationId: string;
  storeId: string;
}) {
  const { data, error } = await args.supabase
    .from("store_assistant_messages")
    .select("id, organization_id, store_id, thread_id, content, metadata")
    .eq("id", args.event.inbound_message_id || "")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("sender_role", "store_responsible")
    .eq("direction", "incoming")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data || null) as PersistedInboundMessage | null;
}

async function hasPersistedResponsibleWhatsappReply(args: {
  supabase: SupabaseClient;
  organizationId: string;
  storeId: string;
  threadId: string;
  externalMessageId: string;
}) {
  const { data, error } = await args.supabase
    .from("store_assistant_messages")
    .select("id")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("thread_id", args.threadId)
    .in("sender_role", ["assistant", "assistant_operational"])
    .contains("metadata", { source_external_message_id: args.externalMessageId })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data?.id);
}

function isAudioInbound(inbound: PersistedInboundMessage) {
  return clean(inbound.metadata?.attachment_kind) === "audio";
}

function isRetryableAudioTranscriptionError(error: string) {
  return error === "AUDIO_DOWNLOAD_FAILED" || error === "OPENAI_AUDIO_TRANSCRIPTION_FAILED";
}

export async function ensureResponsibleAudioTranscript(args: {
  supabase: SupabaseClient;
  organizationId: string;
  storeId: string;
  inbound: PersistedInboundMessage;
  transcribeAudio?: typeof transcribeCustomerAudioFromStorage;
}) {
  if (!isAudioInbound(args.inbound)) return null;

  const metadata = { ...(args.inbound.metadata || {}) };
  const existingTranscript = clean(metadata.audio_transcript);
  if (existingTranscript && clean(metadata.audio_transcription_status) === "completed") {
    return { transcript: existingTranscript, metadata };
  }

  if (
    clean(metadata.audio_transcription_status) === "failed" &&
    metadata.audio_transcription_retryable === false
  ) {
    throw new ResponsibleAudioTranscriptionError(
      clean(metadata.audio_transcription_error) || "RESPONSIBLE_AUDIO_TRANSCRIPTION_PERMANENT_FAILURE",
      false,
      clean(metadata.audio_transcription_error_code) || "RESPONSIBLE_AUDIO_TRANSCRIPTION_PERMANENT_FAILURE",
    );
  }

  const storageBucket = clean(metadata.storage_bucket);
  const storagePath = clean(metadata.storage_path);
  const organizationPrefix = `${args.organizationId}/${args.storeId}/`;
  if (!storageBucket || !storagePath || !storagePath.startsWith(organizationPrefix)) {
    throw new ResponsibleAudioTranscriptionError(
      "RESPONSIBLE_AUDIO_STORAGE_METADATA_INVALID",
      false,
      "RESPONSIBLE_AUDIO_STORAGE_METADATA_INVALID",
    );
  }

  const transcribeAudio = args.transcribeAudio || transcribeCustomerAudioFromStorage;
  const result = await transcribeAudio({
    supabase: args.supabase,
    bucket: storageBucket,
    storagePath,
    fileName: clean(metadata.original_file_name) || "responsible-audio.webm",
    mimeType: clean(metadata.mime_type) || "audio/webm",
  });

  const nextMetadata: Record<string, unknown> = {
    ...metadata,
    audio_transcription_provider: result.provider,
    audio_transcription_model: result.model,
    audio_transcription_attempted_at: new Date().toISOString(),
  };

  if (!result.ok) {
    const retryable = isRetryableAudioTranscriptionError(result.error);
    Object.assign(nextMetadata, {
      audio_transcription_status: "failed",
      audio_transcription_error_code: result.error,
      audio_transcription_error: result.message,
      audio_transcription_retryable: retryable,
    });

    const { data: updatedMessage, error } = await args.supabase
      .from("store_assistant_messages")
      .update({ metadata: nextMetadata })
      .eq("id", args.inbound.id)
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .select("id")
      .maybeSingle();
    if (error || !updatedMessage?.id) {
      throw new Error(error?.message || "RESPONSIBLE_AUDIO_METADATA_UPDATE_EMPTY");
    }

    throw new ResponsibleAudioTranscriptionError(result.message, retryable, result.error);
  }

  const transcript = clean(result.transcript);
  if (!transcript) {
    throw new ResponsibleAudioTranscriptionError(
      "RESPONSIBLE_AUDIO_TRANSCRIPTION_EMPTY",
      false,
      "EMPTY_AUDIO_TRANSCRIPT",
    );
  }

  Object.assign(nextMetadata, {
    audio_transcript: transcript,
    audio_transcription_status: "completed",
    audio_transcription_error_code: null,
    audio_transcription_error: null,
    audio_transcription_retryable: false,
    audio_transcribed_at: new Date().toISOString(),
  });

  const { data: updatedMessage, error } = await args.supabase
    .from("store_assistant_messages")
    .update({ metadata: nextMetadata })
    .eq("id", args.inbound.id)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .select("id")
    .maybeSingle();
  if (error || !updatedMessage?.id) {
    throw new Error(error?.message || "RESPONSIBLE_AUDIO_METADATA_UPDATE_EMPTY");
  }

  return { transcript, metadata: nextMetadata };
}

function recoverySkip(eventId: string, reason: string): PersistedResponsibleWhatsappEventResumeResult {
  return { status: "skipped", eventId, reason };
}

export async function resumePersistedResponsibleWhatsappEvent(args: {
  supabase?: SupabaseClient;
  organizationId: string;
  storeId: string;
  eventId: string;
  now?: Date;
  deps?: Partial<ResumePersistedResponsibleWhatsappEventDeps>;
}): Promise<PersistedResponsibleWhatsappEventResumeResult> {
  const organizationId = clean(args.organizationId);
  const storeId = clean(args.storeId);
  const eventId = clean(args.eventId);
  const now = args.now || new Date();
  const supabase = args.supabase || getSupabaseAdmin();

  if (!organizationId || !storeId || !eventId || Number.isNaN(now.getTime())) {
    throw new Error("INVALID_RESPONSIBLE_ASSISTANT_RECOVERY_INPUT");
  }

  const event = await loadPersistedResponsibleWhatsappEvent({ supabase, eventId });
  if (!event) return recoverySkip(eventId, "event_not_found");
  if (event.organization_id !== organizationId || event.store_id !== storeId) {
    return recoverySkip(event.id, "event_scope_mismatch");
  }
  if (event.status !== "received") return recoverySkip(event.id, "event_not_received");

  const attempts = Number(event.attempts || 0);
  const maxAttempts = Number(event.max_attempts || 3);
  if (!Number.isInteger(attempts) || !Number.isInteger(maxAttempts) || attempts < 0 || maxAttempts < 1 || attempts >= maxAttempts) {
    return recoverySkip(event.id, "attempt_limit_reached");
  }
  if (!clean(event.error_text)) return recoverySkip(event.id, "recovery_error_missing");
  if (
    clean(event.assistant_message_id) ||
    clean(event.external_response_id) ||
    clean(event.outbound_started_at) ||
    !["", "failed"].includes(clean(event.outbound_status).toLowerCase())
  ) {
    return recoverySkip(event.id, "outbound_or_reply_already_started");
  }

  const createdAt = new Date(String(event.created_at || ""));
  if (
    Number.isNaN(createdAt.getTime()) ||
    createdAt.getTime() > now.getTime() ||
    now.getTime() - createdAt.getTime() > RESPONSIBLE_EVENT_RECOVERY_MAX_AGE_MS
  ) {
    return recoverySkip(event.id, "recovery_window_expired");
  }

  const externalMessageId = clean(event.external_message_id);
  const responsibleId = clean(event.responsible_id);
  if (!externalMessageId || !responsibleId || !clean(event.inbound_message_id)) {
    return recoverySkip(event.id, "event_identity_incomplete");
  }

  const inbound = await loadPersistedResponsibleWhatsappInbound({
    supabase,
    event,
    organizationId,
    storeId,
  });
  const metadata = inbound?.metadata || {};
  if (
    !inbound?.thread_id ||
    clean(metadata.origin) !== "whatsapp" ||
    clean(metadata.external_message_id) !== externalMessageId ||
    clean(metadata.responsible_id) !== responsibleId ||
    !clean(inbound.content)
  ) {
    return recoverySkip(event.id, "persisted_inbound_mismatch");
  }

  if (await hasPersistedResponsibleWhatsappReply({
    supabase,
    organizationId,
    storeId,
    threadId: inbound.thread_id,
    externalMessageId,
  })) {
    return recoverySkip(event.id, "assistant_reply_already_persisted");
  }

  const loadResponsible = args.deps?.loadResponsible ?? loadCanonicalActivePrimaryStoreResponsible;
  const responsible = await loadResponsible({ supabase, organizationId, storeId });
  if (
    !responsible.ok ||
    responsible.responsible.id !== responsibleId ||
    clean(responsible.responsible.whatsappNumber) !== clean(event.destination)
  ) {
    return recoverySkip(event.id, "responsible_scope_mismatch");
  }

  const resumeRoute = args.deps?.resumeRoute ?? routeResponsibleWhatsappToAssistant;
  const result = await resumeRoute({
    supabase,
    organizationId,
    storeId,
    responsibleId,
    externalMessageId,
    fromPhone: clean(metadata.from_phone),
    phoneNumberId: clean(metadata.phone_number_id),
    content: clean(inbound.content),
    messageType: "text",
    metadata: {
      origin: "whatsapp",
      channel: "whatsapp",
      responsible_id: responsibleId,
      external_message_id: externalMessageId,
    },
  });

  if (result.duplicate) return recoverySkip(event.id, "claim_not_acquired");
  return { status: "resumed", eventId: event.id };
}

export async function resumeEligiblePersistedResponsibleWhatsappEvents(args: {
  supabase?: SupabaseClient;
  organizationId: string;
  storeId: string;
  limit?: number;
  now?: Date;
}) {
  const organizationId = clean(args.organizationId);
  const storeId = clean(args.storeId);
  const now = args.now || new Date();
  const supabase = args.supabase || getSupabaseAdmin();
  const limit = Math.max(1, Math.min(Number(args.limit || RESPONSIBLE_EVENT_RECOVERY_MAX_LIMIT), RESPONSIBLE_EVENT_RECOVERY_MAX_LIMIT));
  const cutoff = new Date(now.getTime() - RESPONSIBLE_EVENT_RECOVERY_MAX_AGE_MS).toISOString();

  const { data, error } = await supabase
    .from("store_assistant_responsible_whatsapp_events")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("store_id", storeId)
    .eq("status", "received")
    .not("error_text", "is", null)
    .not("inbound_message_id", "is", null)
    .is("assistant_message_id", null)
    .is("outbound_started_at", null)
    .is("external_response_id", null)
    .or("outbound_status.is.null,outbound_status.eq.failed")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`RESPONSIBLE_ASSISTANT_RECOVERY_CANDIDATES_FAILED: ${error.message}`);

  const results: Array<PersistedResponsibleWhatsappEventResumeResult | { status: "failed"; eventId: string; reason: string }> = [];
  for (const row of (data || []) as Array<{ id?: string | null }>) {
    const eventId = clean(row.id);
    if (!eventId) continue;
    try {
      results.push(await resumePersistedResponsibleWhatsappEvent({
        supabase,
        organizationId,
        storeId,
        eventId,
        now,
      }));
    } catch (error) {
      results.push({
        status: "failed",
        eventId,
        reason: error instanceof Error ? error.message : "responsible_assistant_recovery_failed",
      });
    }
  }

  return {
    scanned: results.length,
    resumed: results.filter((result) => result.status === "resumed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    failed: results.filter((result) => result.status === "failed").length,
    results,
  };
}

export async function routeResponsibleWhatsappToAssistant(args: {
  supabase?: SupabaseClient;
  organizationId: string;
  storeId: string;
  responsibleId: string;
  externalMessageId: string;
  fromPhone: string;
  phoneNumberId: string;
  content: string;
  messageType?: string;
  metadata?: Record<string, unknown>;
  media?: ResponsibleWhatsappMedia | null;
  deps?: Partial<ResponsibleWhatsappRouteDeps>;
  onInboundPersisted?: (input: {
    inboundMessageId: string;
    externalMessageId: string;
    content: string;
    contextMessageId: string | null;
  }) => Promise<QuoteApprovalDecisionResult | null>;
}) {
  const organizationId = clean(args.organizationId);
  const storeId = clean(args.storeId);
  const responsibleId = clean(args.responsibleId);
  const externalMessageId = clean(args.externalMessageId);
  const content = clean(args.content);
  const media = args.media || null;

  if (
    !organizationId ||
    !storeId ||
    !responsibleId ||
    (!content && !media) ||
    !isValidExternalMessageId(externalMessageId)
  ) {
    throw new Error("INVALID_RESPONSIBLE_ASSISTANT_INBOUND");
  }

  const supabase = args.supabase || getSupabaseAdmin();
  const responsible = await loadCanonicalActivePrimaryStoreResponsible({
    supabase,
    organizationId,
    storeId,
  });
  if (!responsible.ok || responsible.responsible.id !== responsibleId) {
    throw new Error("RESPONSIBLE_SCOPE_MISMATCH");
  }

  const event = await loadOrCreateEvent({
    supabase,
    organizationId,
    storeId,
    responsibleId,
    externalMessageId,
    destination: responsible.responsible.whatsappNumber,
  });

  if (event.status !== "received") {
    return { handled: true, duplicate: true, status: event.status } as const;
  }
  if (!(await claimEvent({ supabase, event }))) {
    return { handled: true, duplicate: true, status: event.status } as const;
  }

  let uploadedMediaStoragePath: string | null = null;
  let mediaMessagePersisted = false;
  try {
    const thread = await getOrCreateAssistantThread({
      supabase,
      organizationId,
      storeId,
    });
    if (!thread.ok || !thread.threadId) {
      throw new Error(thread.error || "ASSISTANT_THREAD_NOT_READY");
    }

    const { data: existingInbound, error: existingInboundError } = await supabase
      .from("store_assistant_messages")
      .select("id, thread_id, content, metadata")
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .eq("sender_role", "store_responsible")
      .eq("direction", "incoming")
      .contains("metadata", { origin: "whatsapp", external_message_id: externalMessageId })
      .limit(1)
      .maybeSingle();
    if (existingInboundError) throw new Error(existingInboundError.message);

    let inbound = existingInbound;
    if (!inbound) {
      const storedMedia = media
        ? await downloadAndStoreWhatsappInboundMedia({
            supabase,
            organizationId,
            storeId,
            conversationId: thread.threadId,
            mediaId: media.mediaId,
            mediaKind: media.mediaKind,
            preferredMimeType: media.mimeType,
            preferredFileName: media.fileName,
            fallbackBaseName: `responsible-whatsapp-${media.mediaKind}`,
          })
        : null;
      uploadedMediaStoragePath = storedMedia && !storedMedia.reusedExisting
        ? storedMedia.storagePath
        : null;
      const attachmentKind = media?.mediaKind === "document" ? "file" : media?.mediaKind;
      const messageContent = content || media?.caption ||
        (media?.mediaKind === "image"
          ? "Responsável enviou uma imagem."
          : media?.mediaKind === "audio"
            ? "Responsável enviou um áudio."
            : "Responsável enviou um documento.");
      const { data: insertedInbound, error: inboundError } = await supabase
        .from("store_assistant_messages")
        .insert({
          organization_id: organizationId,
          store_id: storeId,
          thread_id: thread.threadId,
          sender: "human",
          sender_role: "store_responsible",
          direction: "incoming",
          message_type: media?.mediaKind || "text",
          content: messageContent,
          metadata: {
            ...(args.metadata || {}),
            origin: "whatsapp",
            channel: "whatsapp",
            responsible_id: responsibleId,
            external_message_id: externalMessageId,
            from_phone: args.fromPhone,
            phone_number_id: args.phoneNumberId,
            ...(media && storedMedia
              ? {
                  media_origin: "responsible",
                  attachment_kind: attachmentKind,
                  whatsapp_media_id: media.mediaId,
                  mime_type: storedMedia.mimeType || media.mimeType || null,
                  sha256: media.sha256 || storedMedia.sha256 || null,
                  original_file_name: storedMedia.originalFileName,
                  size_bytes: storedMedia.sizeBytes,
                  storage_bucket: storedMedia.storageBucket,
                  storage_path: storedMedia.storagePath,
                  downloaded_from_meta: true,
                  ...(media.caption ? { caption: media.caption } : {}),
                  ...(media.voice !== undefined ? { voice: media.voice } : {}),
                }
              : {}),
            received_at: new Date().toISOString(),
          },
        })
        .select("id, thread_id, content, metadata")
        .maybeSingle();
      if (inboundError || !insertedInbound?.id) {
        throw new Error(inboundError?.message || "ASSISTANT_INBOUND_PERSIST_FAILED");
      }
      inbound = insertedInbound;
      mediaMessagePersisted = Boolean(storedMedia);
    }

    await updateEvent(supabase, event.id, event.claim_token!, {
      inbound_message_id: inbound.id,
      thread_id: inbound.thread_id,
    });

    await ensureResponsibleAudioTranscript({
      supabase,
      organizationId,
      storeId,
      inbound: inbound as PersistedInboundMessage,
      transcribeAudio: args.deps?.transcribeAudio,
    });

    let inboundHookResult: QuoteApprovalDecisionResult | null = null;
    if (args.onInboundPersisted && args.messageType === "text") {
      inboundHookResult = await args.onInboundPersisted({
        inboundMessageId: inbound.id,
        externalMessageId,
        content,
        contextMessageId:
          typeof args.metadata?.context_message_id === "string"
            ? args.metadata.context_message_id
            : null,
      });
    }

    if (inboundHookResult) {
      await updateEvent(supabase, event.id, event.claim_token!, {
        status: "sent",
        outbound_status: null,
        outbound_finished_at: null,
        outbound_error: null,
        error_text: null,
        locked_at: null,
        locked_by: null,
      });
      return {
        handled: true,
        duplicate: false,
        status: "sent",
        decisionHandled: true,
        decision: inboundHookResult,
        threadId: thread.threadId,
      } as const;
    }

    const { data: existingAssistant, error: existingAssistantError } = await supabase
      .from("store_assistant_messages")
      .select("id, content")
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .eq("thread_id", inbound.thread_id)
      .in("sender_role", ["assistant", "assistant_operational"])
      .contains("metadata", { source_external_message_id: externalMessageId })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingAssistantError) throw new Error(existingAssistantError.message);

    const reply = existingAssistant?.id
      ? { ok: true as const, aiText: String(existingAssistant.content || "") }
      : await generateAssistantReply({
          request: new Request("https://internal.invalid/assistant/reply", {
            method: "POST",
          }),
          organizationId,
          storeId,
          sourceExternalMessageId: externalMessageId,
        });
    if (!reply.ok) throw new Error(reply.message || reply.error || "ASSISTANT_EXECUTION_FAILED");
    if (!reply.aiText) throw new Error("ASSISTANT_EXECUTION_FAILED");

    const { data: assistantMessage, error: assistantMessageError } = await supabase
      .from("store_assistant_messages")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .eq("thread_id", inbound.thread_id)
      .in("sender_role", ["assistant", "assistant_operational"])
      .contains("metadata", { source_external_message_id: externalMessageId })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (assistantMessageError || !assistantMessage?.id) {
      throw new Error(assistantMessageError?.message || "ASSISTANT_REPLY_PERSIST_FAILED");
    }

    await updateEvent(supabase, event.id, event.claim_token!, { assistant_message_id: assistantMessage.id });
    await updateEvent(supabase, event.id, event.claim_token!, {
      outbound_status: "sending",
      outbound_attempt: event.attempts || 1,
      outbound_started_at: new Date().toISOString(),
      outbound_error: null,
    });
    const outbound = await sendResponsibleAssistantText({
      organizationId,
      storeId,
      responsibleId,
      destination: responsible.responsible.whatsappNumber,
      text: reply.aiText,
    });
    if (!outbound.ok) throw new Error(outbound.reason);

    await updateEvent(supabase, event.id, event.claim_token!, {
      status: "sent",
      outbound_status: "sent",
      outbound_finished_at: new Date().toISOString(),
      external_response_id: outbound.externalMessageId,
      locked_at: null,
      locked_by: null,
    });
    return { handled: true, duplicate: false, status: "sent", threadId: thread.threadId } as const;
  } catch (error) {
    if (uploadedMediaStoragePath && !mediaMessagePersisted) {
      await removeWhatsappInboundStoredMedia({
        supabase,
        storagePath: uploadedMediaStoragePath,
      }).catch(() => undefined);
    }
    const errorText = error instanceof Error ? error.message : String(error);
    const uncertain = errorText === "send_uncertain";
    const retryable =
      !uncertain &&
      (!(error instanceof ResponsibleAudioTranscriptionError) || error.retryable) &&
      Number(event.attempts || 1) < 3;
    await updateEvent(supabase, event.id, event.claim_token!, {
      status: uncertain ? "uncertain" : retryable ? "received" : "failed",
      outbound_status: uncertain ? "uncertain" : "failed",
      outbound_finished_at: new Date().toISOString(),
      outbound_error: errorText,
      error_text: errorText,
      locked_at: null,
      locked_by: null,
    });
    throw error;
  }
}
