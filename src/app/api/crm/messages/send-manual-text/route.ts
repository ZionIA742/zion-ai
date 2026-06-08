import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

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

function createSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      "Verifique NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variaveis de ambiente."
    );
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function buildJsonResponse(body: unknown, status = 200) {
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

async function isRealWhatsappConversation(args: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
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

  if (recentWhatsappIncoming.error) {
    throw new Error(
      `Falha ao verificar origem WhatsApp da conversa: ${recentWhatsappIncoming.error.message}`
    );
  }

  if (activeIntegration.error) {
    throw new Error(
      `Falha ao verificar integracao WhatsApp ativa: ${activeIntegration.error.message}`
    );
  }

  const hasRecentWhatsappIncoming = Boolean(
    Array.isArray(recentWhatsappIncoming.data) &&
      recentWhatsappIncoming.data[0] &&
      recentWhatsappIncoming.data[0].id
  );

  const hasActiveIntegration = Boolean(
    Array.isArray(activeIntegration.data) &&
      (activeIntegration.data[0] as ExternalIntegrationRow | undefined)?.id
  );

  return hasRecentWhatsappIncoming && hasActiveIntegration;
}

export async function POST(request: Request) {
  try {
    const sessionSupabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await sessionSupabase.auth.getUser();

    if (userError || !user) {
      return buildJsonResponse(
        {
          ok: false,
          error: "UNAUTHENTICATED",
          message: "Usuario nao autenticado.",
        },
        401
      );
    }

    const body = (await request.json()) as RequestBody;
    const organizationId = String(body.organizationId || "").trim();
    const requestedStoreId = String(body.storeId || "").trim();
    const conversationId = String(body.conversationId || "").trim();
    const text = String(body.text || "").trim();

    if (!organizationId || !requestedStoreId || !conversationId || !text) {
      return buildJsonResponse(
        {
          ok: false,
          error: "MISSING_FIELDS",
          message: "Envie organizationId, storeId, conversationId e text.",
        },
        400
      );
    }

    const adminSupabase = createSupabaseAdminClient();

    const { data: conversation, error: conversationError } = await adminSupabase
      .from("conversations")
      .select("id, organization_id, lead_id")
      .eq("id", conversationId)
      .eq("organization_id", organizationId)
      .maybeSingle<ConversationRow>();

    if (conversationError) {
      return buildJsonResponse(
        {
          ok: false,
          error: "CONVERSATION_LOOKUP_FAILED",
          message: conversationError.message,
        },
        500
      );
    }

    if (!conversation) {
      return buildJsonResponse(
        {
          ok: false,
          error: "CONVERSATION_NOT_FOUND_OR_FORBIDDEN",
          message: "Conversa nao encontrada para a organizacao informada.",
        },
        404
      );
    }

    const normalizedConversation = conversation as ConversationRow;

    if (!normalizedConversation.lead_id) {
      return buildJsonResponse(
        {
          ok: false,
          error: "CONVERSATION_WITHOUT_LEAD",
          message: "A conversa nao possui lead vinculada.",
        },
        400
      );
    }

    const { data: lead, error: leadError } = await adminSupabase
      .from("leads")
      .select("id, organization_id, store_id")
      .eq("id", normalizedConversation.lead_id)
      .eq("organization_id", organizationId)
      .maybeSingle<LeadRow>();

    if (leadError) {
      return buildJsonResponse(
        {
          ok: false,
          error: "LEAD_LOOKUP_FAILED",
          message: leadError.message,
        },
        500
      );
    }

    if (!lead) {
      return buildJsonResponse(
        {
          ok: false,
          error: "LEAD_NOT_FOUND_OR_FORBIDDEN",
          message: "Lead nao encontrado para a conversa informada.",
        },
        404
      );
    }

    const resolvedStoreId = String((lead as LeadRow).store_id || "").trim();

    if (!resolvedStoreId) {
      return buildJsonResponse(
        {
          ok: false,
          error: "LEAD_STORE_ID_MISSING",
          message: "store_id nao encontrado para este lead.",
        },
        400
      );
    }

    if (requestedStoreId !== resolvedStoreId) {
      return buildJsonResponse(
        {
          ok: false,
          error: "STORE_ID_MISMATCH",
          message: "O storeId informado nao corresponde ao store_id real da lead.",
        },
        400
      );
    }

    const isWhatsappReal = await isRealWhatsappConversation({
      supabase: adminSupabase,
      organizationId,
      storeId: resolvedStoreId,
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

      const { data, error } = await adminSupabase.rpc("insert_message", {
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
        return buildJsonResponse(
          {
            ok: false,
            error: "INSERT_MANUAL_TEXT_FAILED",
            message: error.message,
          },
          500
        );
      }

      return buildJsonResponse({
        ok: true,
        messageId: extractMessageId(data),
        route: "manual_text_whatsapp",
        externalEligible: true,
        metadata,
      });
    }

    const { data, error } = await sessionSupabase.rpc("panel_send_message_scoped", {
      p_organization_id: organizationId,
      p_conversation_id: conversationId,
      p_text: text,
    });

    if (error) {
      return buildJsonResponse(
        {
          ok: false,
          error: "PANEL_SEND_MESSAGE_SCOPED_FAILED",
          message: error.message,
        },
        500
      );
    }

    const messageId = extractMessageId(data);
    const metadata =
      data && typeof data === "object" && !Array.isArray(data) && "metadata" in data
        ? isRecord((data as { metadata?: unknown }).metadata)
          ? (data as { metadata: Record<string, unknown> }).metadata
          : null
        : null;

    return buildJsonResponse({
      ok: true,
      messageId,
      route: "manual_text_panel",
      externalEligible: false,
      metadata,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro interno ao enviar texto manual.";

    return buildJsonResponse(
      {
        ok: false,
        error: "SEND_MANUAL_TEXT_ROUTE_FAILED",
        message,
      },
      500
    );
  }
}
