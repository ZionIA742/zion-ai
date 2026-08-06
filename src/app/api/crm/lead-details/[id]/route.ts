// src/app/api/crm/lead-details/[id]/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import {
  resolveLeadConversationOpportunityContext,
  type LeadConversationContextRow,
  type LeadOpportunityContextRow,
} from "@/lib/server/crm/lead-conversation-opportunity-context";

export const runtime = "nodejs";

type LeadRow = {
  id: string;
  organization_id: string;
  store_id: string | null;
  name: string | null;
  phone: string | null;
  state: string;
};

type MembershipRow = {
  organization_id: string;
};

type StoreRow = {
  id: string;
  organization_id: string;
};

type ConversationRow = {
  id: string;
  organization_id: string;
  lead_id: string;
  created_at: string | null;
  status: string | null;
  is_human_active: boolean | null;
  last_status_reason: string | null;
  last_status_metadata: Record<string, unknown> | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_direction: string | null;
  last_message_sender: string | null;
};

type MessageRow = {
  id: string;
  sender: string | null;
  content: string | null;
  direction: string | null;
  message_type: string | null;
  media_url: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
};

type CommercialTaskPayload = {
  intent?: string | null;
  next_step?: string | null;
  space_text?: string | null;
  handoff_type?: string | null;
  location_text?: string | null;
  handoff_origin?: string | null;
  recommended_model?: string | null;
  requested_area_m2?: number | string | null;
  needs_human_action?: boolean | null;
  relevant_objection?: string | null;
  conversation_summary?: string | null;
  customer_preferences?: string | null;
  last_customer_message?: string | null;
  preferred_period_text?: string | null;
  ad_model_or_requested_model?: string | null;
  allow_sales_ai_while_pending?: boolean | null;
};

type CommercialTaskRow = {
  id: string;
  organization_id: string;
  store_id: string | null;
  task_type: string;
  status: string | null;
  priority: string | null;
  title: string | null;
  description: string | null;
  related_lead_id: string | null;
  related_conversation_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  task_payload: CommercialTaskPayload | null;
  created_at: string | null;
  updated_at: string | null;
};

type AppointmentRow = {
  id: string;
  organization_id: string;
  store_id: string | null;
  lead_id: string | null;
  conversation_id: string | null;
  appointment_type: string | null;
  status: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  address_text: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type OpportunityRow = {
  id: string;
  organization_id: string;
  store_id: string;
  origin_lead_id: string | null;
  primary_conversation_id: string | null;
  stage: string | null;
  stage_changed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const leadId = String(parts[parts.length - 1] || "").trim();
    const requestedConversationId =
      String(url.searchParams.get("conversationId") || "").trim() || null;
    const requestedOpportunityId =
      String(url.searchParams.get("opportunityId") || "").trim() || null;

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

    const sessionSupabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await sessionSupabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        {
          ok: false,
          error: "UNAUTHENTICATED",
          message: "Usuario nao autenticado.",
        },
        { status: 401 }
      );
    }

    const { data: scopedLead, error: scopedLeadError } = await sessionSupabase
      .from("leads")
      .select("id, organization_id, store_id, name, phone, state")
      .eq("id", leadId)
      .maybeSingle<LeadRow>();

    if (scopedLeadError) {
      return NextResponse.json(
        {
          ok: false,
          error: "LOAD_LEAD_FAILED",
          message: scopedLeadError.message,
        },
        { status: 500 }
      );
    }

    if (!scopedLead) {
      return NextResponse.json(
        {
          ok: false,
          error: "LEAD_NOT_FOUND",
          message: "Lead nÃ£o encontrado.",
        },
        { status: 404 }
      );
    }

    const leadOrganizationId = String(scopedLead.organization_id || "").trim();
    const leadStoreId = String(scopedLead.store_id || "").trim();

    if (!leadOrganizationId) {
      return NextResponse.json(
        {
          ok: false,
          error: "FORBIDDEN_LEAD_SCOPE",
          message: "O lead informado nao possui escopo valido de organizacao.",
        },
        { status: 403 }
      );
    }

    const { data: membership, error: membershipError } = await sessionSupabase
      .from("memberships")
      .select("organization_id")
      .eq("user_id", user.id)
      .eq("organization_id", leadOrganizationId)
      .maybeSingle<MembershipRow>();

    if (membershipError) {
      return NextResponse.json(
        {
          ok: false,
          error: "LOAD_MEMBERSHIP_FAILED",
          message: membershipError.message,
        },
        { status: 500 }
      );
    }

    if (!membership) {
      return NextResponse.json(
        {
          ok: false,
          error: "FORBIDDEN_ORGANIZATION",
          message: "Voce nao pode acessar leads desta organizacao.",
        },
        { status: 403 }
      );
    }

    if (leadStoreId) {
      const { data: store, error: storeError } = await sessionSupabase
        .from("stores")
        .select("id, organization_id")
        .eq("id", leadStoreId)
        .eq("organization_id", leadOrganizationId)
        .maybeSingle<StoreRow>();

      if (storeError) {
        return NextResponse.json(
          {
            ok: false,
            error: "LOAD_STORE_FAILED",
            message: storeError.message,
          },
          { status: 500 }
        );
      }

      if (!store) {
        return NextResponse.json(
          {
            ok: false,
            error: "FORBIDDEN_STORE",
            message: "A loja vinculada ao lead nao pertence a esta organizacao.",
          },
          { status: 403 }
        );
      }
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
      .select("id, organization_id, store_id, name, phone, state")
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
      .select(
        "id, organization_id, lead_id, created_at, status, is_human_active, last_status_reason, last_status_metadata, last_message_at, last_message_preview, last_message_direction, last_message_sender"
      )
      .eq("organization_id", leadData.organization_id)
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false });

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

    const allConversations = ((conversationsData || []) as ConversationRow[]).map(
      (row) =>
        ({
          id: row.id,
          organizationId: row.organization_id,
          leadId: row.lead_id,
          createdAt: row.created_at,
        }) satisfies LeadConversationContextRow
    );

    const { data: opportunitiesData, error: opportunitiesError } = await supabase
      .from("commercial_opportunities")
      .select(
        "id, organization_id, store_id, origin_lead_id, primary_conversation_id, stage, stage_changed_at, created_at, updated_at"
      )
      .eq("organization_id", leadData.organization_id)
      .eq("store_id", leadStoreId)
      .eq("origin_lead_id", leadId)
      .order("updated_at", { ascending: false });

    if (opportunitiesError) {
      return NextResponse.json(
        {
          ok: false,
          error: "LOAD_OPPORTUNITIES_FAILED",
          message: opportunitiesError.message,
        },
        { status: 500 }
      );
    }

    const allOpportunities = ((opportunitiesData || []) as OpportunityRow[]).map(
      (row) =>
        ({
          id: row.id,
          organizationId: row.organization_id,
          storeId: row.store_id,
          leadId: row.origin_lead_id || "",
          conversationId: row.primary_conversation_id || null,
          stage: row.stage,
          stageChangedAt: row.stage_changed_at,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }) satisfies LeadOpportunityContextRow
    );

    const contextResult = resolveLeadConversationOpportunityContext({
      organizationId: leadData.organization_id,
      storeId: leadStoreId || null,
      leadId,
      requestedConversationId,
      requestedOpportunityId,
      conversations: allConversations,
      opportunities: allOpportunities,
    });

    if (!contextResult.ok) {
      return NextResponse.json(
        {
          ok: false,
          error:
            contextResult.error === "conversation_scope_rejected"
              ? "FORBIDDEN_CONVERSATION"
              : "FORBIDDEN_OPPORTUNITY",
          message:
            contextResult.error === "conversation_scope_rejected"
              ? "A conversa solicitada nao pertence ao lead aberto."
              : "A oportunidade solicitada nao pertence ao lead aberto.",
        },
        { status: 403 }
      );
    }

    const conversationId = contextResult.conversation?.id || null;
    const conversation =
      conversationId !== null
        ? ((conversationsData || []) as ConversationRow[]).find((row) => row.id === conversationId) ||
          null
        : null;

    let messages: MessageRow[] = [];
    let commercialTasks: CommercialTaskRow[] = [];
    let appointments: AppointmentRow[] = [];

    if (conversation) {
      const { data: messagesData, error: messagesError } = await supabase
        .from("messages")
        .select(
          "id, sender, content, direction, message_type, media_url, metadata, created_at"
        )
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

    const tasksQuery = supabase
      .from("store_assistant_operational_tasks")
      .select(
        "id, organization_id, store_id, task_type, status, priority, title, description, related_lead_id, related_conversation_id, customer_name, customer_phone, task_payload, created_at, updated_at"
      )
      .eq("organization_id", leadData.organization_id)
      .in("task_type", ["commercial_visit_request", "commercial_quote_request"])
      .order("updated_at", { ascending: false })
      .limit(10);

    if (leadData.store_id) {
      tasksQuery.eq("store_id", leadData.store_id);
    }

    if (conversation) {
      tasksQuery.or(
        `related_lead_id.eq.${leadId},related_conversation_id.eq.${conversation.id}`
      );
    } else {
      tasksQuery.eq("related_lead_id", leadId);
    }

    const { data: commercialTasksData, error: commercialTasksError } =
      await tasksQuery;

    if (commercialTasksError) {
      return NextResponse.json(
        {
          ok: false,
          error: "LOAD_COMMERCIAL_TASKS_FAILED",
          message: commercialTasksError.message,
        },
        { status: 500 }
      );
    }

    commercialTasks = Array.from(
      new Map(
        ((commercialTasksData || []) as CommercialTaskRow[]).map((task) => [
          task.id,
          task,
        ])
      ).values()
    );

    const appointmentsQuery = supabase
      .from("store_appointments")
      .select(
        "id, organization_id, store_id, lead_id, conversation_id, appointment_type, status, scheduled_start, scheduled_end, address_text, notes, created_at, updated_at"
      )
      .eq("organization_id", leadData.organization_id)
      .order("updated_at", { ascending: false })
      .limit(10);

    if (leadData.store_id) {
      appointmentsQuery.eq("store_id", leadData.store_id);
    }

    if (conversation) {
      appointmentsQuery.or(
        `lead_id.eq.${leadId},conversation_id.eq.${conversation.id}`
      );
    } else {
      appointmentsQuery.eq("lead_id", leadId);
    }

    const { data: appointmentsData, error: appointmentsError } =
      await appointmentsQuery;

    if (appointmentsError) {
      return NextResponse.json(
        {
          ok: false,
          error: "LOAD_APPOINTMENTS_FAILED",
          message: appointmentsError.message,
        },
        { status: 500 }
      );
    }

    appointments = Array.from(
      new Map(
        ((appointmentsData || []) as AppointmentRow[]).map((appointment) => [
          appointment.id,
          appointment,
        ])
      ).values()
    );

    return NextResponse.json({
      ok: true,
      lead: leadData,
      conversation,
      messages,
      commercialTasks,
      appointments,
      opportunities: contextResult.opportunities,
      selectedOpportunityId: contextResult.selectedOpportunity?.id || null,
      requiresOpportunitySelection: contextResult.requiresOpportunitySelection,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error: "LEAD_DETAILS_ROUTE_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Erro interno ao carregar dados do lead.",
      },
      { status: 500 }
    );
  }
}
