import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  buildManualCatalogIdempotencyKey,
  buildManualCatalogPayloadFingerprint,
  isUuid,
  normalizeManualCatalogOperationId,
  normalizeManualCatalogText,
  parseManualCatalogSourceKind,
} from "@/lib/server/manual-catalog-product-contract";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SendCatalogDeps = {
  resolveAccess: (params: { requirement: "active"; deps?: Partial<ResolveStoreApiAccessDeps> }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  createServiceClient: () => SupabaseClient;
  isRealWhatsappConversation: (args: { supabase: SupabaseClient; organizationId: string; storeId: string; conversationId: string }) => Promise<boolean>;
};

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("service_role_unavailable");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function defaultIsRealWhatsappConversation(args: { supabase: SupabaseClient; organizationId: string; storeId: string; conversationId: string }) {
  const [incoming, integration] = await Promise.all([
    args.supabase.from("messages").select("id").eq("conversation_id", args.conversationId).eq("sender", "user").eq("direction", "incoming").contains("metadata", { source: "meta_whatsapp_webhook", channel: "whatsapp", external_channel: "whatsapp" }).limit(1),
    args.supabase.from("external_integrations").select("id").eq("organization_id", args.organizationId).eq("store_id", args.storeId).eq("provider", "whatsapp").eq("is_active", true).eq("status", "active").limit(1),
  ]);
  if (incoming.error || integration.error) throw new Error("whatsapp_scope_validation_failed");
  const incomingRows = (incoming.data || []) as Array<{ id?: string | null }>;
  const integrationRows = (integration.data || []) as Array<{ id?: string | null }>;
  return Boolean(incomingRows[0]?.id && integrationRows[0]?.id);
}

export function createSendManualCatalogProductPostHandler(deps: Partial<SendCatalogDeps> = {}) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const createService = deps.createServiceClient ?? createServiceClient;
  const isRealWhatsapp = deps.isRealWhatsappConversation ?? defaultIsRealWhatsappConversation;

  return async function POST(request: Request) {
    const access = await resolveAccess({ requirement: "active" });
    if (!access.ok) return createStoreApiDeniedResponse(access);

    try {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      const conversationId = normalizeManualCatalogText(body?.conversationId);
      const sourceKind = parseManualCatalogSourceKind(body?.sourceKind);
      const sourceId = normalizeManualCatalogText(body?.sourceId);
      const content = normalizeManualCatalogText(body?.content);
      const operationId = normalizeManualCatalogOperationId(body?.operationId);

      if (!conversationId || !sourceKind || !isUuid(sourceId) || !content) return json({ ok: false, error: "INVALID_CATALOG_MESSAGE_INPUT", message: "Informe conversa, produto e uma legenda nao vazia." }, 400);
      if (!operationId) return json({ ok: false, error: "INVALID_OPERATION_ID", message: "operationId invalido." }, 400);

      const supabase = createService();
      const { data: conversation, error: conversationError } = await supabase.from("conversations").select("id, organization_id, lead_id").eq("id", conversationId).eq("organization_id", access.organizationId).maybeSingle();
      if (conversationError) return json({ ok: false, error: "CONVERSATION_LOOKUP_FAILED", message: "Nao foi possivel validar a conversa." }, 500);
      if (
        !conversation ||
        conversation.id !== conversationId ||
        conversation.organization_id !== access.organizationId
      ) return json({ ok: false, error: "CONVERSATION_NOT_FOUND_OR_FORBIDDEN", message: "Conversa nao encontrada para a loja informada." }, 404);
      const leadId = normalizeManualCatalogText(conversation.lead_id);
      if (!leadId) return json({ ok: false, error: "CONVERSATION_WITHOUT_LEAD", message: "A conversa nao possui lead vinculada." }, 400);
      const { data: lead, error: leadError } = await supabase.from("leads").select("id, organization_id, store_id").eq("id", leadId).eq("organization_id", access.organizationId).eq("store_id", access.storeId).maybeSingle();
      if (leadError) return json({ ok: false, error: "LEAD_LOOKUP_FAILED", message: "Nao foi possivel validar o lead." }, 500);
      if (
        !lead ||
        lead.id !== leadId ||
        lead.organization_id !== access.organizationId ||
        lead.store_id !== access.storeId
      ) return json({ ok: false, error: "LEAD_NOT_FOUND_OR_FORBIDDEN", message: "Lead nao encontrado para a conversa informada." }, 404);

      const sendExternal = await isRealWhatsapp({ supabase, organizationId: access.organizationId, storeId: access.storeId, conversationId });
      const idempotencyKey = buildManualCatalogIdempotencyKey(operationId);
      const payloadFingerprint = buildManualCatalogPayloadFingerprint({ organizationId: access.organizationId, storeId: access.storeId, conversationId, leadId, actorUserId: access.sessionUserId, sourceKind, sourceId, content, sendExternal });
      const { data, error } = await supabase.rpc("finalize_manual_catalog_photo_message", {
        p_organization_id: access.organizationId,
        p_store_id: access.storeId,
        p_conversation_id: conversationId,
        p_lead_id: leadId,
        p_actor_user_id: access.sessionUserId,
        p_catalog_source_kind: sourceKind,
        p_catalog_source_id: sourceId,
        p_content: content,
        p_send_external: sendExternal,
        p_outbound_idempotency_key: idempotencyKey,
        p_payload_fingerprint: payloadFingerprint,
      });
      if (error) return json({ ok: false, error: "FINALIZE_MANUAL_CATALOG_PRODUCT_FAILED", message: "Nao foi possivel finalizar o envio do produto do catalogo." }, 500);
      const result = Array.isArray(data) ? data[0] : data;
      const messageId = normalizeManualCatalogText(result?.message_id || result?.id);
      if (!messageId) return json({ ok: false, error: "INVALID_CATALOG_WRITER_RESULT", message: "Nao foi possivel finalizar o envio do produto do catalogo." }, 500);
      return json({ ok: true, messageId, replayed: result?.replayed === true, sendExternal, externalEligible: sendExternal });
    } catch {
      return json({ ok: false, error: "SEND_MANUAL_CATALOG_PRODUCT_FAILED", message: "Nao foi possivel enviar o produto do catalogo." }, 500);
    }
  };
}

export const POST = createSendManualCatalogProductPostHandler();
