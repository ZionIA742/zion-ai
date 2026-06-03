import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { pushAssistantContractWorkflowDecisionMessage } from "@/lib/server/assistant/contract-workflow-messages";
import { evaluateContractWorkflowDecision } from "@/lib/server/sales-contracts/contract-workflow-decision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestBody = {
  organizationId?: string;
  storeId?: string;
  nowIso?: string;
};

type PostAppointmentFollowupRow = {
  id: string;
  organization_id: string;
  store_id: string;
  appointment_id: string;
  lead_id: string | null;
  conversation_id: string | null;
  scheduled_end: string | null;
  followup_status: string | null;
  prompt_count: number | null;
  last_prompted_at: string | null;
  resolved_at: string | null;
};

type AppointmentRow = {
  id: string;
  organization_id: string;
  store_id: string;
  lead_id: string | null;
  conversation_id: string | null;
  appointment_type: string | null;
  status: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  customer_name: string | null;
};

type ContractWorkflowQuoteCandidateRow = {
  id: string;
  organization_id: string;
  store_id: string;
  conversation_id: string | null;
  lead_id: string | null;
  quote_number: string | null;
  status: string;
  customer_name: string | null;
  total_cents: number | null;
  current_version_id: string | null;
};

type ExistingContractStateRow = {
  id: string;
  status: string | null;
};

const POST_TECHNICAL_VISIT_SOURCE = "post_technical_visit_followup_v1";
const ELIGIBLE_TECHNICAL_VISIT_STATUSES = new Set([
  "completed",
  "fully_completed",
  "done",
]);

function cleanText(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeText(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isEligibleTechnicalVisitStatus(status: unknown) {
  return ELIGIBLE_TECHNICAL_VISIT_STATUSES.has(normalizeText(status));
}

function isTechnicalVisitFollowupEligible(args: {
  appointment: AppointmentRow;
  followup: PostAppointmentFollowupRow;
  now: Date;
}) {
  if (normalizeText(args.appointment.appointment_type) !== "technical_visit") {
    return false;
  }

  const normalizedStatus = normalizeText(args.appointment.status);
  if (!isEligibleTechnicalVisitStatus(normalizedStatus)) {
    return false;
  }

  if (normalizedStatus === "cancelled" || normalizedStatus === "rescheduled") {
    return false;
  }

  const effectiveEnd =
    cleanText(args.appointment.scheduled_end) || cleanText(args.followup.scheduled_end);

  if (!effectiveEnd) {
    return false;
  }

  const effectiveEndDate = new Date(effectiveEnd);
  if (Number.isNaN(effectiveEndDate.getTime())) {
    return false;
  }

  if (effectiveEndDate.getTime() > args.now.getTime()) {
    return false;
  }

  return true;
}

async function loadPendingPostAppointmentFollowups(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
}) {
  const { data, error } = await args.supabase
    .from("schedule_post_appointment_followups")
    .select(
      "id, organization_id, store_id, appointment_id, lead_id, conversation_id, scheduled_end, followup_status, prompt_count, last_prompted_at, resolved_at"
    )
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .is("resolved_at", null)
    .order("scheduled_end", { ascending: true })
    .limit(30);

  if (error) {
    throw new Error(`Falha ao carregar follow-ups pos-visita: ${error.message}`);
  }

  return (data || []) as PostAppointmentFollowupRow[];
}

async function loadAppointmentsByIds(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  appointmentIds: string[];
}) {
  if (args.appointmentIds.length === 0) {
    return new Map<string, AppointmentRow>();
  }

  const { data, error } = await args.supabase
    .from("store_appointments")
    .select(
      "id, organization_id, store_id, lead_id, conversation_id, appointment_type, status, scheduled_start, scheduled_end, customer_name"
    )
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .in("id", args.appointmentIds);

  if (error) {
    throw new Error(`Falha ao carregar appointments dos follow-ups: ${error.message}`);
  }

  return new Map(
    ((data || []) as AppointmentRow[]).map((appointment) => [appointment.id, appointment])
  );
}

async function loadEligibleQuotesByConversationOrLead(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  conversationId?: string | null;
  leadId?: string | null;
}) {
  const select =
    "id, organization_id, store_id, conversation_id, lead_id, quote_number, status, customer_name, total_cents, current_version_id";

  const loadByConversation = async () => {
    const conversationId = cleanText(args.conversationId);
    if (!conversationId) return [] as ContractWorkflowQuoteCandidateRow[];

    const { data, error } = await args.supabase
      .from("sales_quotes")
      .select(select)
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .eq("conversation_id", conversationId)
      .in("status", ["approved", "sent"])
      .not("current_version_id", "is", null)
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5);

    if (error) {
      throw new Error(
        `Falha ao carregar orcamentos elegiveis por conversa: ${error.message}`
      );
    }

    return (data || []) as ContractWorkflowQuoteCandidateRow[];
  };

  const loadByLead = async () => {
    const leadId = cleanText(args.leadId);
    if (!leadId) return [] as ContractWorkflowQuoteCandidateRow[];

    const { data, error } = await args.supabase
      .from("sales_quotes")
      .select(select)
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .eq("lead_id", leadId)
      .in("status", ["approved", "sent"])
      .not("current_version_id", "is", null)
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5);

    if (error) {
      throw new Error(
        `Falha ao carregar orcamentos elegiveis por lead: ${error.message}`
      );
    }

    return (data || []) as ContractWorkflowQuoteCandidateRow[];
  };

  return {
    byConversation: await loadByConversation(),
    byLead: await loadByLead(),
  };
}

function pickInequivocalQuoteCandidate(args: {
  byConversation: ContractWorkflowQuoteCandidateRow[];
  byLead: ContractWorkflowQuoteCandidateRow[];
}) {
  if (args.byConversation.length === 1) {
    return {
      candidate: args.byConversation[0],
      source: "conversation_id" as const,
      ambiguous: false,
    };
  }

  if (args.byConversation.length > 1) {
    return {
      candidate: null,
      source: "conversation_id" as const,
      ambiguous: true,
    };
  }

  if (args.byLead.length === 1) {
    return {
      candidate: args.byLead[0],
      source: "lead_id" as const,
      ambiguous: false,
    };
  }

  if (args.byLead.length > 1) {
    return {
      candidate: null,
      source: "lead_id" as const,
      ambiguous: true,
    };
  }

  return {
    candidate: null,
    source: "none" as const,
    ambiguous: false,
  };
}

async function loadExistingContractsForQuote(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  quoteId: string;
}) {
  const { data, error } = await args.supabase
    .from("sales_contracts")
    .select("id, status")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("quote_id", args.quoteId);

  if (error) {
    throw new Error(`Falha ao carregar contratos do orcamento: ${error.message}`);
  }

  return (data || []) as ExistingContractStateRow[];
}

async function findExistingNoQuoteFollowupMessage(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  appointmentId: string;
}) {
  const eventKey = `${POST_TECHNICAL_VISIT_SOURCE}:${args.appointmentId}:no_quote`;

  const { data, error } = await args.supabase
    .from("store_assistant_messages")
    .select("id")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .contains("metadata", {
      kind: "post_technical_visit_followup_no_quote",
      source: POST_TECHNICAL_VISIT_SOURCE,
      appointment_id: args.appointmentId,
      event_key: eventKey,
    })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Falha ao verificar duplicidade da mensagem pos-visita sem orcamento: ${error.message}`
    );
  }

  return cleanText(data?.id);
}

function buildNoQuotePostVisitContent(args: {
  customerName?: string | null;
  ambiguousQuote?: boolean;
}) {
  const customerName = cleanText(args.customerName) || "o cliente";

  if (args.ambiguousQuote) {
    return [
      `Como foi a visita tecnica com ${customerName}?`,
      "",
      "Encontrei mais de um orcamento aprovado/enviado para essa oportunidade e nao escolhi sozinho qual seguir.",
      "Se a venda avancou, me diga qual orcamento devo considerar antes de preparar o contrato.",
    ].join("\n");
  }

  return [
    `Como foi a visita tecnica com ${customerName}?`,
    "",
    "Ainda nao encontrei um orcamento aprovado/enviado para gerar contrato com seguranca.",
    "Se a venda avancou, me diga se devo ajudar a ajustar ou preparar um orcamento antes do contrato.",
  ].join("\n");
}

async function pushNoQuotePostVisitAssistantMessage(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  appointment: AppointmentRow;
  followup: PostAppointmentFollowupRow;
  ambiguousQuote?: boolean;
}) {
  const existingMessageId = await findExistingNoQuoteFollowupMessage({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    appointmentId: args.appointment.id,
  });

  if (existingMessageId) {
    return {
      created: false,
      deduped: true,
      reason: "assistant_message_deduped",
    };
  }

  const eventKey = `${POST_TECHNICAL_VISIT_SOURCE}:${args.appointment.id}:no_quote`;
  const content = buildNoQuotePostVisitContent({
    customerName: args.appointment.customer_name,
    ambiguousQuote: args.ambiguousQuote,
  });

  const { error } = await args.supabase.rpc("assistant_push_system_message", {
    p_organization_id: args.organizationId,
    p_store_id: args.storeId,
    p_content: content,
    p_message_type: "text",
    p_related_lead_id: args.appointment.lead_id || args.followup.lead_id || null,
    p_related_conversation_id:
      args.appointment.conversation_id || args.followup.conversation_id || null,
    p_related_appointment_id: args.appointment.id,
    p_metadata: {
      kind: "post_technical_visit_followup_no_quote",
      source: POST_TECHNICAL_VISIT_SOURCE,
      event_key: eventKey,
      appointment_id: args.appointment.id,
      followup_id: args.followup.id,
      ambiguous_quote: Boolean(args.ambiguousQuote),
    },
  });

  if (error) {
    throw new Error(
      `Falha ao criar mensagem simples de pos-visita tecnica: ${error.message}`
    );
  }

  return {
    created: true,
    deduped: false,
    reason: "assistant_message_created",
  };
}

async function processTechnicalVisitPostFollowups(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  now: Date;
}) {
  const followups = await loadPendingPostAppointmentFollowups({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
  });

  const appointmentIds = followups
    .map((followup) => cleanText(followup.appointment_id))
    .filter(Boolean) as string[];

  const appointmentMap = await loadAppointmentsByIds({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    appointmentIds,
  });

  const results: Array<Record<string, unknown>> = [];

  for (const followup of followups) {
    const appointment = appointmentMap.get(followup.appointment_id);

    if (!appointment) {
      results.push({
        followupId: followup.id,
        appointmentId: followup.appointment_id,
        skipped: true,
        reason: "appointment_not_found",
      });
      continue;
    }

    if (
      !isTechnicalVisitFollowupEligible({
        appointment,
        followup,
        now: args.now,
      })
    ) {
      results.push({
        followupId: followup.id,
        appointmentId: appointment.id,
        skipped: true,
        reason: "appointment_not_eligible",
        appointmentType: appointment.appointment_type,
        appointmentStatus: appointment.status,
      });
      continue;
    }

    try {
      const quoteCandidates = await loadEligibleQuotesByConversationOrLead({
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: args.storeId,
        conversationId: appointment.conversation_id || followup.conversation_id,
        leadId: appointment.lead_id || followup.lead_id,
      });

      const selectedQuote = pickInequivocalQuoteCandidate(quoteCandidates);

      if (!selectedQuote.candidate) {
        const pushResult = await pushNoQuotePostVisitAssistantMessage({
          supabase: args.supabase,
          organizationId: args.organizationId,
          storeId: args.storeId,
          appointment,
          followup,
          ambiguousQuote: selectedQuote.ambiguous,
        });

        results.push({
          followupId: followup.id,
          appointmentId: appointment.id,
          created: pushResult.created,
          deduped: pushResult.deduped,
          kind: "simple_message",
          reason: selectedQuote.ambiguous ? "quote_ambiguous" : "quote_not_found",
          quoteLookupSource: selectedQuote.source,
        });
        continue;
      }

      const existingContracts = await loadExistingContractsForQuote({
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: args.storeId,
        quoteId: selectedQuote.candidate.id,
      });

      const decision = evaluateContractWorkflowDecision({
        quote: {
          id: selectedQuote.candidate.id,
          status: selectedQuote.candidate.status,
          lead_id: selectedQuote.candidate.lead_id,
          conversation_id: selectedQuote.candidate.conversation_id,
          store_id: selectedQuote.candidate.store_id,
          organization_id: selectedQuote.candidate.organization_id,
          total_cents: selectedQuote.candidate.total_cents,
          current_version_id: selectedQuote.candidate.current_version_id,
        },
        existingContracts,
        trigger: "crm_closing_stage",
        hasHumanConfirmation: false,
        appointments: [appointment],
      });

      if (!decision.needsHumanConfirmation || decision.allowed) {
        results.push({
          followupId: followup.id,
          appointmentId: appointment.id,
          skipped: true,
          kind: "pre_contract_card",
          quoteId: selectedQuote.candidate.id,
          quoteNumber: cleanText(selectedQuote.candidate.quote_number),
          reason: decision.reasonCode,
        });
        continue;
      }

      const pushResult = await pushAssistantContractWorkflowDecisionMessage({
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: args.storeId,
        leadId: selectedQuote.candidate.lead_id || appointment.lead_id || followup.lead_id,
        conversationId:
          selectedQuote.candidate.conversation_id ||
          appointment.conversation_id ||
          followup.conversation_id,
        quoteId: selectedQuote.candidate.id,
        quoteNumber: cleanText(selectedQuote.candidate.quote_number),
        customerName:
          cleanText(selectedQuote.candidate.customer_name) ||
          cleanText(appointment.customer_name),
        trigger: "crm_closing_stage",
        decision,
        summary:
          "A visita tecnica foi concluida e a Assistente precisa confirmar com o responsavel se houve fechamento.",
        sourceOverride: POST_TECHNICAL_VISIT_SOURCE,
      });

      results.push({
        followupId: followup.id,
        appointmentId: appointment.id,
        created: pushResult.created,
        deduped: pushResult.deduped,
        kind: "pre_contract_card",
        quoteId: selectedQuote.candidate.id,
        quoteNumber: cleanText(selectedQuote.candidate.quote_number),
        reason: pushResult.deduped
          ? "assistant_card_deduped"
          : "assistant_card_created",
        quoteLookupSource: selectedQuote.source,
      });
    } catch (error: any) {
      results.push({
        followupId: followup.id,
        appointmentId: appointment.id,
        ok: false,
        error: error?.message || String(error),
      });
    }
  }

  return {
    scanned: followups.length,
    eligible: results.filter((item) => item.reason !== "appointment_not_eligible").length,
    results,
  };
}

function isInternalRequestAuthorized(req: Request) {
  const secretFromEnv = process.env.AI_INTERNAL_ROUTE_SECRET;
  const secretFromHeader =
    req.headers.get("x-zion-internal-secret") ||
    req.headers.get("x-internal-secret") ||
    "";

  if (!secretFromEnv) {
    return {
      ok: false,
      mode: "missing_env_secret" as const,
    };
  }

  if (secretFromHeader !== secretFromEnv) {
    return {
      ok: false,
      mode: "invalid_header_secret" as const,
    };
  }

  return {
    ok: true,
    mode: "authorized_by_secret" as const,
  };
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "internal/schedule-post-appointment-followup",
    method: "GET",
    message: "rota publicada e funcionando",
  });
}

export async function POST(req: Request) {
  try {
    const auth = isInternalRequestAuthorized(req);

    if (!auth.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "UNAUTHORIZED_INTERNAL_ROUTE",
          message:
            "Acesso interno não autorizado. Verifique AI_INTERNAL_ROUTE_SECRET e o header x-zion-internal-secret.",
        },
        { status: 401 }
      );
    }

    const body = (await req.json()) as RequestBody;

    const organizationId = String(body.organizationId || "").trim();
    const storeId = String(body.storeId || "").trim();
    const nowIso = String(body.nowIso || "").trim();

    if (!organizationId || !storeId) {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_FIELDS",
          message: "Envie organizationId e storeId.",
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

    const effectiveNow = nowIso ? new Date(nowIso) : new Date();

    if (Number.isNaN(effectiveNow.getTime())) {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_NOW_ISO",
          message: "nowIso inválido.",
        },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc(
      "enqueue_post_appointment_followups",
      {
        p_organization_id: organizationId,
        p_store_id: storeId,
        p_now: effectiveNow.toISOString(),
      }
    );

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: "ENQUEUE_POST_APPOINTMENT_FOLLOWUPS_FAILED",
          message: error.message,
        },
        { status: 500 }
      );
    }

    const row = Array.isArray(data) ? data[0] : null;
    const insertedCount = Number(row?.inserted_count || 0);
    const technicalVisitProcessing = await processTechnicalVisitPostFollowups({
      supabase,
      organizationId,
      storeId,
      now: effectiveNow,
    });

    return NextResponse.json({
      ok: true,
      message: "Varredura de pós-compromisso executada com sucesso.",
      bridge: {
        route: "internal/schedule-post-appointment-followup",
        authMode: auth.mode,
      },
      organizationId,
      storeId,
      nowIso: effectiveNow.toISOString(),
      insertedCount,
      technicalVisitProcessing,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "INTERNAL_SCHEDULE_POST_APPOINTMENT_FOLLOWUP_ROUTE_FAILED",
        message:
          error?.message ||
          "Erro interno ao enfileirar acompanhamentos pós-compromisso.",
      },
      { status: 500 }
    );
  }
}
