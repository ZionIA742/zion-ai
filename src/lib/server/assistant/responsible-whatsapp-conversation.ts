import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import {
  generateAssistantReply,
  getOrCreateAssistantThread,
} from "@/app/api/assistant/reply/route";
import { loadCanonicalActivePrimaryStoreResponsible } from "@/lib/server/store-responsibles";
import { sendResponsibleAssistantText } from "@/lib/server/assistant/responsible-external-notifications-sender";

type ResponsibleWhatsappEvent = {
  id: string;
  status: string;
  claim_token: string | null;
  inbound_message_id?: string | null;
  assistant_message_id?: string | null;
};

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role nao configurada.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
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
    .select("id, status, claim_token, inbound_message_id, assistant_message_id")
    .maybeSingle();

  if (!insertError && inserted) return inserted as ResponsibleWhatsappEvent;

  const { data: existing, error: existingError } = await args.supabase
    .from("store_assistant_responsible_whatsapp_events")
    .select("id, status, claim_token, inbound_message_id, assistant_message_id")
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
}) {
  const organizationId = clean(args.organizationId);
  const storeId = clean(args.storeId);
  const responsibleId = clean(args.responsibleId);
  const externalMessageId = clean(args.externalMessageId);
  const content = clean(args.content);

  if (
    !organizationId ||
    !storeId ||
    !responsibleId ||
    !content ||
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
      .select("id, thread_id")
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
      const { data: insertedInbound, error: inboundError } = await supabase
        .from("store_assistant_messages")
        .insert({
          organization_id: organizationId,
          store_id: storeId,
          thread_id: thread.threadId,
          sender: "human",
          sender_role: "store_responsible",
          direction: "incoming",
          message_type: args.messageType === "text" ? "text" : "text",
          content,
          metadata: {
            ...(args.metadata || {}),
            origin: "whatsapp",
            channel: "whatsapp",
            responsible_id: responsibleId,
            external_message_id: externalMessageId,
            from_phone: args.fromPhone,
            phone_number_id: args.phoneNumberId,
            received_at: new Date().toISOString(),
          },
        })
        .select("id, thread_id")
        .maybeSingle();
      if (inboundError || !insertedInbound?.id) {
        throw new Error(inboundError?.message || "ASSISTANT_INBOUND_PERSIST_FAILED");
      }
      inbound = insertedInbound;
    }

    await updateEvent(supabase, event.id, event.claim_token!, {
      inbound_message_id: inbound.id,
      thread_id: inbound.thread_id,
    });

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
      external_response_id: outbound.externalMessageId,
      locked_at: null,
      locked_by: null,
    });
    return { handled: true, duplicate: false, status: "sent", threadId: thread.threadId } as const;
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error);
    await updateEvent(supabase, event.id, event.claim_token!, {
      status: errorText === "send_uncertain" ? "uncertain" : "failed",
      error_text: errorText,
      locked_at: null,
      locked_by: null,
    });
    throw error;
  }
}
