// src/app/api/crm/lead-details/[id]/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type LeadRow = {
  id: string;
  organization_id: string;
  name: string | null;
  phone: string | null;
  state: string;
};

type ConversationRow = {
  id: string;
  organization_id: string;
  lead_id: string;
  created_at: string | null;
  status: string | null;
  is_human_active: boolean | null;
};

type MessageRow = {
  id: string;
  sender: string | null;
  content: string | null;
  direction: string | null;
  message_type: string | null;
  created_at: string | null;
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const leadId = String(parts[parts.length - 1] || "").trim();

    if (!leadId) {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_LEAD_ID",
          message: "Lead ID não informado na rota.",
        },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "SUPABASE_ENV_MISSING",
          message:
            "Verifique NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variáveis de ambiente.",
        },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data: leadData, error: leadError } = await supabase
      .from("leads")
      .select("id, organization_id, name, phone, state")
      .eq("id", leadId)
      .maybeSingle<LeadRow>();

    if (leadError) {
      return NextResponse.json(
        {
          ok: false,
          error: "LOAD_LEAD_FAILED",
          message: leadError.message,
        },
        { status: 500 }
      );
    }

    if (!leadData) {
      return NextResponse.json(
        {
          ok: false,
          error: "LEAD_NOT_FOUND",
          message: "Lead não encontrado.",
        },
        { status: 404 }
      );
    }

    const { data: conversationsData, error: conversationsError } = await supabase
      .from("conversations")
      .select("id, organization_id, lead_id, created_at, status, is_human_active")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (conversationsError) {
      return NextResponse.json(
        {
          ok: false,
          error: "LOAD_CONVERSATION_FAILED",
          message: conversationsError.message,
        },
        { status: 500 }
      );
    }

    const conversation =
      conversationsData && conversationsData.length > 0
        ? (conversationsData[0] as ConversationRow)
        : null;

    let messages: MessageRow[] = [];

    if (conversation) {
      const { data: messagesData, error: messagesError } = await supabase
        .from("messages")
        .select("id, sender, content, direction, message_type, created_at")
        .eq("conversation_id", conversation.id)
        .order("created_at", { ascending: true });

      if (messagesError) {
        return NextResponse.json(
          {
            ok: false,
            error: "LOAD_MESSAGES_FAILED",
            message: messagesError.message,
          },
          { status: 500 }
        );
      }

      messages = (messagesData || []) as MessageRow[];
    }

    return NextResponse.json({
      ok: true,
      lead: leadData,
      conversation,
      messages,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "LEAD_DETAILS_ROUTE_FAILED",
        message: error?.message || "Erro interno ao carregar dados do lead.",
      },
      { status: 500 }
    );
  }
}