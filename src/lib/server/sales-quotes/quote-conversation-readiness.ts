import { QuoteAccessError } from "./quote-auth";

const QUOTE_EVENT_ALLOWED_STATES = new Set(["orcamento"]);

function normalizeState(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export async function loadCurrentQuoteConversationState(args: {
  supabase: any;
  organizationId: string;
  conversationId: string | null;
  leadId: string | null;
}) {
  const conversationId = String(args.conversationId || "").trim();
  if (!conversationId) {
    return null;
  }

  const { data, error } = await args.supabase
    .from("conversation_states")
    .select("conversation_id, organization_id, state")
    .eq("conversation_id", conversationId)
    .eq("organization_id", args.organizationId)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao carregar estado atual da conversation_states: ${error.message}`);
  }

  const rowLeadId = String(args.leadId || "").trim();
  if (rowLeadId) {
    const { data: conversationRow, error: conversationError } = await args.supabase
      .from("conversations")
      .select("id, lead_id, organization_id")
      .eq("id", conversationId)
      .eq("organization_id", args.organizationId)
      .maybeSingle();

    if (conversationError) {
      throw new Error(`Falha ao validar conversa para transicao do orcamento: ${conversationError.message}`);
    }

    if (!conversationRow?.id) {
      throw new QuoteAccessError(
        404,
        "QUOTE_CONVERSATION_NOT_FOUND",
        "Conversa nao encontrada para preparar o orcamento.",
      );
    }

    if (String(conversationRow.lead_id || "").trim() !== rowLeadId) {
      throw new QuoteAccessError(
        409,
        "QUOTE_CONVERSATION_LEAD_MISMATCH",
        "A conversa vinculada ao orcamento nao corresponde ao lead esperado.",
      );
    }
  }

  return normalizeState(data?.state) || null;
}

async function transitionQuoteConversationState(args: {
  supabase: any;
  actorUserId: string;
  organizationId: string;
  conversationId: string;
  toState: "qualificacao" | "orcamento";
  reason: string;
  source: string;
}) {
  const { error } = await args.supabase.rpc(
    "transition_conversation_state_by_user",
    {
      p_conversation_id: args.conversationId,
      p_to_state: args.toState,
      p_actor_user_id: args.actorUserId,
      p_reason: args.reason,
      p_source: args.source,
      p_request_organization_id: args.organizationId,
      p_event_key: null,
      p_metadata: {
        source: args.source,
      },
    },
  );

  if (error) {
    throw new QuoteAccessError(
      409,
      "QUOTE_CRM_TRANSITION_FAILED",
      `Nao foi possivel preparar o funil comercial para gerar o orcamento: ${error.message}`,
    );
  }
}

function buildQuoteConversationPreparationReasons(source: string) {
  if (source === "quote_change_request") {
    return {
      qualification: "manual_quote_change_request_prepare_qualification",
      budget: "manual_quote_change_request_prepare_budget",
    };
  }

  return {
    qualification: "manual_quote_pdf_prepare_qualification",
    budget: "manual_quote_pdf_prepare_budget",
  };
}

export async function ensureQuoteConversationReadyForQuoteEvent(args: {
  supabase: any;
  actorUserId: string;
  organizationId: string;
  conversationId: string | null;
  leadId: string | null;
  source?: string;
}) {
  const conversationId = String(args.conversationId || "").trim();
  const source = String(args.source || "").trim() || "quote_event_prepare";
  const reasons = buildQuoteConversationPreparationReasons(source);
  if (!conversationId) {
    return {
      transitioned: false,
      currentState: null,
      skippedReason: "missing_conversation_id",
    };
  }

  const initialState = await loadCurrentQuoteConversationState({
    supabase: args.supabase,
    organizationId: args.organizationId,
    conversationId,
    leadId: args.leadId,
  });

  if (!initialState) {
    return {
      transitioned: false,
      currentState: null,
      skippedReason: "missing_current_state",
    };
  }

  if (QUOTE_EVENT_ALLOWED_STATES.has(initialState)) {
    return {
      transitioned: false,
      currentState: initialState,
      skippedReason: "already_allowed",
    };
  }

  if (initialState === "novo_lead") {
    await transitionQuoteConversationState({
      supabase: args.supabase,
      actorUserId: args.actorUserId,
      organizationId: args.organizationId,
      conversationId,
      toState: "qualificacao",
      reason: reasons.qualification,
      source,
    });

    const qualificationState = await loadCurrentQuoteConversationState({
      supabase: args.supabase,
      organizationId: args.organizationId,
      conversationId,
      leadId: args.leadId,
    });

    if (qualificationState !== "qualificacao") {
      throw new QuoteAccessError(
        409,
        "QUOTE_EVENT_STATE_NOT_READY",
        "A conversa nao entrou em qualificacao antes da etapa de orcamento.",
      );
    }

    await transitionQuoteConversationState({
      supabase: args.supabase,
      actorUserId: args.actorUserId,
      organizationId: args.organizationId,
      conversationId,
      toState: "orcamento",
      reason: reasons.budget,
      source,
    });
  } else if (initialState === "qualificacao") {
    await transitionQuoteConversationState({
      supabase: args.supabase,
      actorUserId: args.actorUserId,
      organizationId: args.organizationId,
      conversationId,
      toState: "orcamento",
      reason: reasons.budget,
      source,
    });
  }

  const finalState = await loadCurrentQuoteConversationState({
    supabase: args.supabase,
    organizationId: args.organizationId,
    conversationId,
    leadId: args.leadId,
  });

  if (!finalState || !QUOTE_EVENT_ALLOWED_STATES.has(finalState)) {
    throw new QuoteAccessError(
      409,
      "QUOTE_EVENT_STATE_NOT_READY",
      "A conversa ainda nao esta em um estado compativel para gerar o orcamento.",
    );
  }

  return {
    transitioned: finalState !== initialState,
    currentState: finalState,
    skippedReason: finalState === initialState ? "already_allowed" : "transitioned",
  };
}
