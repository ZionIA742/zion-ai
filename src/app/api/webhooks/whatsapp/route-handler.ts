import { withBackendDiagnosticRoute } from "../../../../lib/server/zion-admin-diagnostic-backend-next";
import { NextResponse } from "next/server";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];

type JsonObject = { [key: string]: Json };

type MetaWebhookPayload = {
  entry?: MetaEntry[];
};

type MetaEntry = {
  id?: string;
  changes?: MetaChange[];
};

type MetaChange = {
  field?: string;
  value?: {
    metadata?: {
      phone_number_id?: string;
      display_phone_number?: string;
    };
    messages?: MetaMessage[];
    statuses?: MetaStatus[];
    [key: string]: unknown;
  };
};

type MetaMessage = {
  id?: string;
  [key: string]: unknown;
};

type MetaStatus = {
  id?: string;
  status?: string;
  timestamp?: string;
  [key: string]: unknown;
};

type IntegrationRow = {
  id: string;
  organization_id: string;
  store_id: string;
  phone_number_id: string | null;
  whatsapp_business_account_id: string | null;
  display_phone_number: string | null;
  status: string | null;
  is_active: boolean | null;
};

type ExtractedEvent = {
  eventKind:
    | "message"
    | "status"
    | "change"
    | "message_echo"
    | "history"
    | "smb_app_state_sync"
    | "account_update"
    | "group_message";
  externalEventId: string;
  phoneNumberId: string;
  entryId: string | null;
  changeField: string | null;
  whatsappBusinessAccountId: string | null;
  displayPhoneNumber: string | null;
  message: Record<string, unknown> | null;
  status: Record<string, unknown> | null;
  change: Record<string, unknown>;
};

function buildJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY ou NEXT_PUBLIC_SUPABASE_URL ausente.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function toJson(value: unknown): Json {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJson(item));
  }

  if (isRecord(value)) {
    const next: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      next[key] = toJson(item);
    }
    return next;
  }

  return String(value);
}

function safeWebhookError(message: string, status: number) {
  return buildJsonResponse(
    {
      ok: false,
      error: message,
    },
    status
  );
}

function isProductionEnvironment() {
  return (process.env.NODE_ENV || "development") === "production";
}

function verifyMetaSignature(rawBody: string, signatureHeader: string, appSecret: string) {
  const normalizedHeader = signatureHeader.trim();

  if (!normalizedHeader.startsWith("sha256=")) {
    return false;
  }

  const providedHex = normalizedHeader.slice("sha256=".length).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(providedHex)) {
    return false;
  }

  const expectedHex = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const providedBuffer = Buffer.from(providedHex, "hex");
  const expectedBuffer = Buffer.from(expectedHex, "hex");

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function buildGenericChangeExternalEventId(args: {
  entryId: string | null;
  changeField: string | null;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  change: Record<string, unknown>;
}) {
  const rawHash = createHash("sha256")
    .update(
      JSON.stringify({
        entryId: args.entryId,
        changeField: args.changeField,
        phoneNumberId: args.phoneNumberId,
        displayPhoneNumber: args.displayPhoneNumber,
        change: args.change,
      })
    )
    .digest("hex")
    .slice(0, 16);

  return `change:${args.entryId || "unknown"}:${args.changeField || "unknown"}:${args.phoneNumberId}:${rawHash}`;
}

function isGroupMessage(message: Record<string, unknown>) {
  return (
    typeof message.group_id === "string" ||
    typeof message.groupId === "string" ||
    message.is_group === true ||
    message.isGroup === true ||
    message.chat_type === "group"
  );
}

function isCoexistenceControlField(field: string | null) {
  return (
    field === "history" ||
    field === "smb_app_state_sync" ||
    field === "account_update"
  );
}

export function extractEventsFromPayload(payload: unknown): ExtractedEvent[] {
  if (!isRecord(payload)) {
    return [];
  }

  const typedPayload = payload as MetaWebhookPayload;
  const entries = Array.isArray(typedPayload.entry) ? typedPayload.entry : [];
  const events: ExtractedEvent[] = [];

  for (const entry of entries) {
    const entryId = asTrimmedString(entry?.id);
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];

    for (const change of changes) {
      if (!isRecord(change)) continue;

      const changeField = asTrimmedString(change.field);
      const rawValue = isRecord(change.value) ? change.value : {};
      const metadata = isRecord(rawValue.metadata) ? rawValue.metadata : {};
      const phoneNumberId = asTrimmedString(metadata.phone_number_id);
      const displayPhoneNumber = asTrimmedString(metadata.display_phone_number);

      if (!phoneNumberId) {
        continue;
      }

      const isMessageEchoesField =
        changeField === "message_echoes" || changeField === "smb_message_echoes";
      const messages = !isMessageEchoesField && Array.isArray(rawValue.messages)
        ? rawValue.messages
        : [];
      const echoMessages = isMessageEchoesField
        ? [
            ...(Array.isArray(rawValue.message_echoes) ? rawValue.message_echoes : []),
            ...(Array.isArray(rawValue.smb_message_echoes) ? rawValue.smb_message_echoes : []),
            ...(Array.isArray(rawValue.messages) ? rawValue.messages : []),
          ]
        : [];
      const statuses = Array.isArray(rawValue.statuses) ? rawValue.statuses : [];

      const messageEntries: Array<{
        message: unknown;
        eventKind: ExtractedEvent["eventKind"];
      }> = [
        ...messages.map((message) => ({ message, eventKind: "message" as const })),
        ...echoMessages.map((message) => ({ message, eventKind: "message_echo" as const })),
      ];

      for (const entryMessage of messageEntries) {
        const message = entryMessage.message;
        if (!isRecord(message)) continue;
        const messageId = asTrimmedString(message.id);
        if (!messageId) continue;

        const eventKind: ExtractedEvent["eventKind"] =
          entryMessage.eventKind === "message_echo"
            ? entryMessage.eventKind
            : isGroupMessage(message)
              ? "group_message"
              : "message";

        events.push({
          eventKind,
          externalEventId: `message:${messageId}`,
          phoneNumberId,
          entryId,
          changeField,
          whatsappBusinessAccountId: null,
          displayPhoneNumber,
          message,
          status: null,
          change,
        });
      }

      for (const status of statuses) {
        if (!isRecord(status)) continue;
        const statusId = asTrimmedString(status.id);
        const statusValue = asTrimmedString(status.status);
        const statusTimestamp = asTrimmedString(status.timestamp);
        if (!statusId || !statusValue || !statusTimestamp) continue;

        events.push({
          eventKind: "status",
          externalEventId: `status:${statusId}:${statusValue}:${statusTimestamp}`,
          phoneNumberId,
          entryId,
          changeField,
          whatsappBusinessAccountId: null,
          displayPhoneNumber,
          message: null,
          status,
          change,
        });
      }

      if (messages.length === 0 && echoMessages.length === 0 && statuses.length === 0) {
        events.push({
          eventKind: isCoexistenceControlField(changeField)
            ? (changeField as "history" | "smb_app_state_sync" | "account_update")
            : "change",
          externalEventId: buildGenericChangeExternalEventId({
            entryId,
            changeField,
            phoneNumberId,
            displayPhoneNumber,
            change,
          }),
          phoneNumberId,
          entryId,
          changeField,
          whatsappBusinessAccountId: null,
          displayPhoneNumber,
          message: null,
          status: null,
          change,
        });
      }
    }
  }

  return events;
}

async function findWhatsappIntegrationByPhoneNumberId(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  phoneNumberId: string
) {
  const { data, error } = await supabase
    .from("external_integrations")
    .select(
      "id, organization_id, store_id, phone_number_id, whatsapp_business_account_id, display_phone_number, status, is_active"
    )
    .eq("provider", "whatsapp")
    .eq("phone_number_id", phoneNumberId)
    .eq("is_active", true)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao buscar integração WhatsApp por phone_number_id: ${error.message}`);
  }

  return (data as IntegrationRow | null) ?? null;
}

function buildStoredPayload(args: {
  parsedPayload: unknown;
  event: ExtractedEvent;
  integrationId: string | null;
  whatsappBusinessAccountId: string | null;
  resolutionError?: string | null;
  signatureVerified?: boolean;
}) {
  return toJson({
    ...(args.signatureVerified === true &&
       args.event.eventKind === "status"
      ? { human_quote_signature_verified_v1: true }
      : {}),
    raw_payload: args.parsedPayload,
    event_kind: args.event.eventKind,
    phone_number_id: args.event.phoneNumberId,
    whatsapp_business_account_id:
      args.whatsappBusinessAccountId || args.event.whatsappBusinessAccountId,
    entry_id: args.event.entryId,
    change_field: args.event.changeField,
    message: args.event.message,
    status: args.event.status,
    change: args.event.change,
    received_at_iso: new Date().toISOString(),
    source: "meta_whatsapp_webhook",
    integration_id: args.integrationId,
    resolution_error: args.resolutionError || null,
  });
}

function isDuplicateInsertError(error: { code?: string | null; message?: string | null }) {
  const code = String(error.code || "").trim();
  const message = String(error.message || "").toLowerCase();

  return code === "23505" || message.includes("duplicate key") || message.includes("already exists");
}

async function insertExternalWebhookAudit(args: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  provider: string;
  organizationId: string | null;
  storeId: string | null;
  payload: Json;
  requirePersisted?: boolean;
}) {
  const { error } = await args.supabase.from("external_webhooks").insert({
    provider: args.provider,
    organization_id: args.organizationId,
    store_id: args.storeId,
    payload: args.payload,
  });

  if (error) {
    console.error("[webhooks/whatsapp] Falha segura ao gravar auditoria em external_webhooks.");

    if (args.requirePersisted === true) {
      throw new Error("VERIFIED_STATUS_AUDIT_PERSISTENCE_FAILED");
    }
  }
}


/**
 * Only called for status events with verified Meta signatures.
 * The original accepted operation owns the destination scope.
 */
async function processVerifiedHumanQuoteStatusIngress(args: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  event: ExtractedEvent;
  integration: IntegrationRow | null;
  payload: Json;
}): Promise<"unmatched" | "unresolved" | "saved" | "duplicate"> {

  const {supabase,event,integration,payload}=args;

  if (
    event.eventKind !== "status" ||
    !isRecord(payload) ||
    payload.human_quote_signature_verified_v1 !== true ||
    typeof payload.received_at_iso !== "string" ||
    !Number.isFinite(Date.parse(payload.received_at_iso))
  ) {
    throw new Error("HUMAN_QUOTE_VERIFIED_INGRESS_REQUIRED");
  }

  function validId(value:unknown):value is string {

    return (
      typeof value==="string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) &&
      value!=="00000000-0000-0000-0000-000000000000"
    );
  }


  const receivedAt = payload.received_at_iso;

  async function resolveOriginal(){

    const resolution=await supabase.rpc(
      "resolve_human_quote_status_ingress_by_system",
      {
        p_payload:payload,
        p_received_at:receivedAt,
      }
    );

    if (resolution.error || !isRecord(resolution.data)) {
      throw new Error("HUMAN_QUOTE_STATUS_RESOLUTION_FAILED");
    }

    const resolved=resolution.data;

    const unmatched=
      resolved.outcome==="unmatched" &&
      resolved.reason==="ACCEPTED_OPERATION_NOT_FOUND";

    const rejected=
      resolved.outcome==="rejected" &&
      resolved.reason==="ORIGINAL_OPERATION_EVIDENCE_INVALID";

    const matched=
      resolved.outcome==="matched" &&
      resolved.reason==="ORIGINAL_ACCEPTED_OPERATION_PROVEN";

    if (!unmatched && !rejected && !matched) {
      throw new Error("HUMAN_QUOTE_STATUS_RESOLUTION_INVALID");
    }


    if (
      matched &&
      (
        !validId(resolved.organization_id) ||
        !validId(resolved.store_id) ||
        !validId(resolved.actor_user_id) ||
        !validId(resolved.operation_id)
      )
    ) {
      throw new Error("HUMAN_QUOTE_STATUS_SCOPE_INVALID");
    }

    return {resolved,unmatched,rejected,matched};
  }

  let {resolved,unmatched,rejected,matched} =
    await resolveOriginal();

  // Do not attribute raw multi-event payloads to an unrelated
  // tenant when the original operation proves a different scope.

  const retainAuditScope=

    (
      matched &&
      integration?.organization_id===resolved.organization_id &&
      integration?.store_id===resolved.store_id
    );

  await insertExternalWebhookAudit({
    supabase,
    provider:"meta_whatsapp",
    organizationId:retainAuditScope
      ? integration?.organization_id || null
      : null,
    storeId:retainAuditScope
      ? integration?.store_id || null
      : null,
    payload,
    requirePersisted:true,
  });

  if (unmatched) {

    // Evidence is durable before this second lookup.
    // Acceptance that raced with the first lookup can
    // now be resolved without guessing a tenant.

    ({resolved,unmatched,rejected,matched} =
      await resolveOriginal());
  }

  if (unmatched) {
    return "unmatched";
  }

  if (rejected) {
    return "unresolved";
  }

  async function readExactEvent(){

    const response=await supabase
      .from("channel_whatsapp_inbox")
      .select("id,store_id,provider,payload")
      .eq("organization_id",resolved.organization_id)
      .eq("external_event_id",event.externalEventId)
      .maybeSingle();

    if (response.error) {
      throw new Error("HUMAN_QUOTE_STATUS_INBOX_LOOKUP_FAILED");
    }

    return response.data;
  }

  function isExactEvent(row:unknown):boolean {

    if (!isRecord(row)) return false;

    const stored=row.payload;

    if (
      !isRecord(stored) ||
      !isRecord(stored.status) ||
      !isRecord(event.status)
    ) {
      return false;
    }

    const storedStatus = stored.status;
    const incomingStatus = event.status;

    return (

      validId(row.id) &&

      row.store_id===resolved.store_id &&

      row.provider==="meta" &&

      stored.source==="meta_whatsapp_webhook" &&

      stored.event_kind==="status" &&

      stored.phone_number_id===event.phoneNumberId &&

      ["id","status","timestamp","recipient_id"].every(
        key=>
          typeof incomingStatus[key]==="string" &&
          storedStatus[key]===incomingStatus[key]
      )
    );
  }

  const before=await readExactEvent();

  if (before && !isExactEvent(before)) {

    // Never overwrite another store or a conflicting event.
    return "unresolved";
  }

  const recovery=await supabase.rpc(
    "recover_human_quote_status_ingress_by_system",
    {
      p_organization_id:resolved.organization_id,
      p_store_id:resolved.store_id,
      p_actor_user_id:resolved.actor_user_id,
      p_operation_id:resolved.operation_id,
    }
  );

  if (recovery.error || !isRecord(recovery.data)) {
    throw new Error("HUMAN_QUOTE_STATUS_RECOVERY_FAILED");
  }

  const data=recovery.data;

  if (
    data.reason!=="SCOPED_STATUS_INGRESS_RECOVERY" ||
    typeof data.recovered_count!=="number" ||
    typeof data.existing_count!=="number" ||
    typeof data.conflict_count!=="number" ||
    ![
      data.recovered_count,
      data.existing_count,
      data.conflict_count
    ].every(n=>Number.isSafeInteger(n) && n>=0)
  ) {
    throw new Error("HUMAN_QUOTE_STATUS_RECOVERY_INVALID");
  }

  const expectedOutcome=
    data.conflict_count>0
      ? "conflict"
      : data.recovered_count>0
        ? "recovered"
        : "unchanged";

  if (data.outcome!==expectedOutcome) {
    throw new Error("HUMAN_QUOTE_STATUS_RECOVERY_INVALID");
  }

  const after=await readExactEvent();

  if (after && !isExactEvent(after)) {
    return "unresolved";
  }

  if (!after) {

    // Batch counts cannot prove this specific event was stored.
    throw new Error("HUMAN_QUOTE_STATUS_RECOVERY_UNCONFIRMED");
  }

  return before ? "duplicate" : "saved";
}

async function zionBackendOriginalGET(request: Request) {
  const verifyToken = process.env.META_WHATSAPP_VERIFY_TOKEN;

  if (!verifyToken) {
    return safeWebhookError("META_WHATSAPP_VERIFY_TOKEN ausente no servidor.", 500);
  }

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const challenge = searchParams.get("hub.challenge");
  const providedVerifyToken = searchParams.get("hub.verify_token");

  if (mode === "subscribe" && providedVerifyToken === verifyToken && challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  return safeWebhookError("WEBHOOK_VERIFY_FORBIDDEN", 403);
}

const zionBackendObservedGET = withBackendDiagnosticRoute(
  "/api/webhooks/whatsapp",
  "GET",
  zionBackendOriginalGET,
);

export async function GET(request: Request) {
  return zionBackendObservedGET(request);
}

async function zionBackendOriginalPOST(request: Request) {
  try {
    const appSecret = process.env.META_APP_SECRET?.trim() || "";
    const signatureHeader = request.headers.get("x-hub-signature-256") || "";
    const rawBody = await request.text();

    let signatureVerified = false;

    if (appSecret) {
      if (!signatureHeader || !verifyMetaSignature(rawBody, signatureHeader, appSecret)) {
        return safeWebhookError("INVALID_WEBHOOK_SIGNATURE", 401);
      }

      signatureVerified = true;

    } else if (isProductionEnvironment()) {
      return safeWebhookError("META_APP_SECRET ausente no servidor.", 500);
    }

    let parsedPayload: unknown;

    try {
      parsedPayload = JSON.parse(rawBody);
    } catch {
      return safeWebhookError("INVALID_WEBHOOK_JSON", 400);
    }

    const events = extractEventsFromPayload(parsedPayload);
    const supabase = getSupabaseAdmin();
    const integrationCache = new Map<string, IntegrationRow | null>();

    let saved = 0;
    let duplicates = 0;
    let unresolved = 0;

    for (const event of events) {
      let integration = integrationCache.get(event.phoneNumberId) ?? null;

      if (!integrationCache.has(event.phoneNumberId)) {
        integration = await findWhatsappIntegrationByPhoneNumberId(supabase, event.phoneNumberId);
        integrationCache.set(event.phoneNumberId, integration);
      }

      const payloadToStore = buildStoredPayload({
        parsedPayload,
        event,
        integrationId: integration?.id || null,
        whatsappBusinessAccountId: integration?.whatsapp_business_account_id || null,
        resolutionError: integration ? null : "ACTIVE_INTEGRATION_NOT_FOUND",
        signatureVerified,
      });

      if (signatureVerified && event.eventKind === "status") {

        const disposition=
          await processVerifiedHumanQuoteStatusIngress({
            supabase,
            event,
            integration,
            payload:payloadToStore,
          });

        if (disposition !== "unmatched") {

          if (disposition === "saved") saved += 1;
          else if (disposition === "duplicate") duplicates += 1;
          else unresolved += 1;

          continue;
        }

      } else {

        await insertExternalWebhookAudit({
          supabase,
          provider: "meta_whatsapp",
          organizationId: integration?.organization_id || null,
          storeId: integration?.store_id || null,
          payload: payloadToStore,
        });

      }

      if (
        event.eventKind !== "message" &&
        event.eventKind !== "message_echo" &&
        event.eventKind !== "status"
      ) {
        continue;
      }

      if (!integration) {
        unresolved += 1;
        continue;
      }

      const { error } = await supabase.from("channel_whatsapp_inbox").insert({
        organization_id: integration.organization_id,
        store_id: integration.store_id,
        provider: "meta",
        external_event_id: event.externalEventId,
        payload: payloadToStore,
        processed_at: null,
        processing_error: null,
      });

      if (error) {
        if (isDuplicateInsertError(error)) {
          duplicates += 1;
          continue;
        }

        throw new Error(`Falha ao salvar evento em channel_whatsapp_inbox: ${error.message}`);
      }

      saved += 1;
    }

    return buildJsonResponse({
      ok: true,
      received: events.length,
      saved,
      duplicates,
      unresolved,
    });
  } catch {
    console.error("[webhooks/whatsapp] Erro inesperado ao receber webhook.");

    return buildJsonResponse(
      {
        ok: false,
        error: "INTERNAL_WEBHOOK_ERROR",
      },
      500
    );
  }
}

const zionBackendObservedPOST = withBackendDiagnosticRoute(
  "/api/webhooks/whatsapp",
  "POST",
  zionBackendOriginalPOST,
);

export async function POST(request: Request) {
  return zionBackendObservedPOST(request);
}
