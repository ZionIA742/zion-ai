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
  eventKind: "message" | "status" | "change";
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

function extractEventsFromPayload(payload: unknown): ExtractedEvent[] {
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

      const messages = Array.isArray(rawValue.messages) ? rawValue.messages : [];
      const statuses = Array.isArray(rawValue.statuses) ? rawValue.statuses : [];

      for (const message of messages) {
        if (!isRecord(message)) continue;
        const messageId = asTrimmedString(message.id);
        if (!messageId) continue;

        events.push({
          eventKind: "message",
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

      if (messages.length === 0 && statuses.length === 0) {
        events.push({
          eventKind: "change",
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
}) {
  return toJson({
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
}) {
  const { error } = await args.supabase.from("external_webhooks").insert({
    provider: args.provider,
    organization_id: args.organizationId,
    store_id: args.storeId,
    payload: args.payload,
  });

  if (error) {
    console.error("[webhooks/whatsapp] Falha segura ao gravar auditoria em external_webhooks.");
  }
}

export async function GET(request: Request) {
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

export async function POST(request: Request) {
  try {
    const appSecret = process.env.META_APP_SECRET?.trim() || "";
    const signatureHeader = request.headers.get("x-hub-signature-256") || "";
    const rawBody = await request.text();

    if (appSecret) {
      if (!signatureHeader || !verifyMetaSignature(rawBody, signatureHeader, appSecret)) {
        return safeWebhookError("INVALID_WEBHOOK_SIGNATURE", 401);
      }
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
      });

      await insertExternalWebhookAudit({
        supabase,
        provider: "meta_whatsapp",
        organizationId: integration?.organization_id || null,
        storeId: integration?.store_id || null,
        payload: payloadToStore,
      });

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
  } catch (error) {
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
