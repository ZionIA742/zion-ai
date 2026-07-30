import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestBody = {
  organizationId?: string;
  storeId?: string;
  conversationId?: string;
  text?: string;
};

type ConversationRow = {
  id: string;
  organization_id: string;
  store_id: string | null;
  lead_id: string | null;
};

type LeadRow = {
  id: string;
  organization_id: string;
  store_id: string | null;
};

type ExternalIntegrationRow = {
  id: string;
};

type ServiceSupabaseClient = ReturnType<typeof createServiceSupabaseClient>;

type SendManualTextDeps = {
  resolveStoreAccess: (params: {
    requirement: "active";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  createServiceSupabaseClient: () => ServiceSupabaseClient;
  isRealWhatsappConversation: (args: {
    supabase: ServiceSupabaseClient;
    organizationId: string;
    storeId: string;
    conversationId: string;
  }) => Promise<boolean>;
};

function createServiceSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("service_role_unavailable");
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function createJsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractMessageId(data: unknown) {
  if (Array.isArray(data)) {
    const first = data[0];
    if (first && typeof first === "object" && "id" in first) {
      return String((first as { id?: string | null }).id || "").trim() || null;
    }
    if (typeof first === "string") {
      return first.trim() || null;
    }
  }

  if (data && typeof data === "object" && "id" in data) {
    return String((data as { id?: string | null }).id || "").trim() || null;
  }

  if (typeof data === "string") {
    return data.trim() || null;
  }

  return null;
}

async function defaultIsRealWhatsappConversation(args: {
  supabase: ServiceSupabaseClient;
  organizationId: string;
  storeId: string;
  conversationId: string;
}) {
  const whatsappMetadataFilter: Record<string, unknown> = {
    source: "meta_whatsapp_webhook",
    channel: "whatsapp",
    external_channel: "whatsapp",
  };

  const [recentWhatsappIncoming, activeIntegration] = await Promise.all([
    args.supabase
      .from("messages")
      .select("id")
      .eq("conversation_id", args.conversationId)
      .eq("sender", "user")
      .eq("direction", "incoming")
      .contains("metadata", whatsappMetadataFilter)
      .limit(1),
    args.supabase
      .from("external_integrations")
      .select("id")
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .eq("provider", "whatsapp")
      .eq("is_active", true)
      .eq("status", "active")
      .limit(1),
  ]);

  if (recentWhatsappIncoming.error || activeIntegration.error) {
    throw new Error("whatsapp_scope_validation_failed");
  }

  const hasRecentWhatsappIncoming = Boolean(
    Array.isArray(recentWhatsappIncoming.data) &&
      recentWhatsappIncoming.data[0] &&
      recentWhatsappIncoming.data[0].id,
  );

  const hasActiveIntegration = Boolean(
    Array.isArray(activeIntegration.data) &&
      (activeIntegration.data[0] as ExternalIntegrationRow | undefined)?.id,
  );

  return hasRecentWhatsappIncoming && hasActiveIntegration;
}

async function loadScopedConversation(args: {
  supabase: ServiceSupabaseClient;
  conversationId: string;
  organizationId: string;
  storeId: string;
}) {
  const { data, error } = await args.supabase
    .from("conversations")
    .select("id, organization_id, store_id, lead_id")
    .eq("id", args.conversationId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle<ConversationRow>();

  if (error) {
    return {
      ok: false as const,
      response: createJsonResponse(
        {
          ok: false,
          error: "CONVERSATION_LOOKUP_FAILED",
          message: "Nao foi possivel validar a conversa informada.",
        },
        500,
      ),
    };
  }

  if (!data) {
    return {
      ok: false as const,
      response: createJsonResponse(
        {
          ok: false,
          error: "CONVERSATION_NOT_FOUND_OR_FORBIDDEN",
          message: "Conversa nao encontrada para a loja informada.",
        },
        404,
      ),
    };
  }

  return {
    ok: true as const,
    conversation: data,
  };
}

async function loadScopedLead(args: {
  supabase: ServiceSupabaseClient;
  leadId: string;
  organizationId: string;
  storeId: string;
}) {
  const { data, error } = await args.supabase
    .from("leads")
    .select("id, organization_id, store_id")
    .eq("id", args.leadId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle<LeadRow>();

  if (error) {
    return {
      ok: false as const,
      response: createJsonResponse(
        {
          ok: false,
          error: "LEAD_LOOKUP_FAILED",
          message: "Nao foi possivel validar o lead da conversa informada.",
        },
        500,
      ),
    };
  }

  if (!data) {
    return {
      ok: false as const,
      response: createJsonResponse(
        {
          ok: false,
          error: "LEAD_NOT_FOUND_OR_FORBIDDEN",
          message: "Lead nao encontrado para a conversa informada.",
        },
        404,
      ),
    };
  }

  return {
    ok: true as const,
    lead: data,
  };
}

export async function handleSendManualTextPost(
  request: Request,
  deps: SendManualTextDeps = {
    resolveStoreAccess: resolveStoreApiAccess,
    createServiceSupabaseClient,
    isRealWhatsappConversation: defaultIsRealWhatsappConversation,
  },
) {
  try {
    const access = await deps.resolveStoreAccess({
      requirement: "active",
    });

    if (!access.ok) {
      return createStoreApiDeniedResponse(access);
    }

    const body = (await request.json()) as RequestBody;
    const conversationId = String(body.conversationId || "").trim();
    const text = String(body.text || "").trim();

    if (!conversationId || !text) {
      return createJsonResponse(
        {
          ok: false,
          error: "MISSING_FIELDS",
          message: "Envie conversationId e text.",
        },
        400,
      );
    }

    const serviceSupabase = deps.createServiceSupabaseClient();

    const conversationResult = await loadScopedConversation({
      supabase: serviceSupabase,
      conversationId,
      organizationId: access.organizationId,
      storeId: access.storeId,
    });

    if (!conversationResult.ok) {
      return conversationResult.response;
    }

    if (!conversationResult.conversation.lead_id) {
      return createJsonResponse(
        {
          ok: false,
          error: "CONVERSATION_WITHOUT_LEAD",
          message: "A conversa nao possui lead vinculada.",
        },
        400,
      );
    }

    const leadResult = await loadScopedLead({
      supabase: serviceSupabase,
      leadId: conversationResult.conversation.lead_id,
      organizationId: access.organizationId,
      storeId: access.storeId,
    });

    if (!leadResult.ok) {
      return leadResult.response;
    }

    const isWhatsappReal = await deps.isRealWhatsappConversation({
      supabase: serviceSupabase,
      organizationId: access.organizationId,
      storeId: access.storeId,
      conversationId,
    });

    if (isWhatsappReal) {
      const metadata = {
        source: "panel",
        channel: "whatsapp",
        external_channel: "whatsapp",
        send_external: true,
        outbound_origin: "crm_manual_text",
        whatsapp_detected_from_conversation: true,
      };

      const { data, error } = await serviceSupabase.rpc("insert_message", {
        p_conversation_id: conversationId,
        p_sender: "human",
        p_direction: "outgoing",
        p_message_type: "text",
        p_content: text,
        p_external_message_id: null,
        p_media_url: null,
        p_metadata: metadata,
      });

      if (error) {
        return createJsonResponse(
          {
            ok: false,
            error: "INSERT_MANUAL_TEXT_FAILED",
            message: "Nao foi possivel registrar a mensagem manual agora.",
          },
          500,
        );
      }

      return createJsonResponse({
        ok: true,
        messageId: extractMessageId(data),
        route: "manual_text_whatsapp",
        externalEligible: true,
        metadata,
      });
    }

    const { data, error } = await access.supabase.rpc("panel_send_message_scoped", {
      p_organization_id: access.organizationId,
      p_conversation_id: conversationId,
      p_text: text,
    });

    if (error) {
      return createJsonResponse(
        {
          ok: false,
          error: "PANEL_SEND_MESSAGE_SCOPED_FAILED",
          message: "Nao foi possivel enviar a mensagem manual agora.",
        },
        500,
      );
    }

    const messageId = extractMessageId(data);
    const metadata =
      data && typeof data === "object" && !Array.isArray(data) && "metadata" in data
        ? isRecord((data as { metadata?: unknown }).metadata)
          ? (data as { metadata: Record<string, unknown> }).metadata
          : null
        : null;

    return createJsonResponse({
      ok: true,
      messageId,
      route: "manual_text_panel",
      externalEligible: false,
      metadata,
    });
  } catch {
    return createJsonResponse(
      {
        ok: false,
        error: "SEND_MANUAL_TEXT_ROUTE_FAILED",
        message: "Erro interno ao enviar texto manual.",
      },
      500,
    );
  }
}

export async function POST(request: Request) {
  return handleSendManualTextPost(request);
}
