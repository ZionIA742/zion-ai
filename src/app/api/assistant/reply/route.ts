
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import type {
  AppointmentRow,
  AssistantCandidateOption,
  AssistantMessageRow,
  AssistantReplyResult,
  CustomerRescheduleWorkflowResult,
  PendingNotificationRow,
  PostAppointmentFollowupRow,
  StoreAnswerRow,
  StoreAssistantContextStateRow,
  StoreAssistantOperationalTaskRow,
  StoreRow,
  StoreScheduleBlockRow,
  StoreScheduleSettingsRow,
} from "@/lib/server/assistant/types";
import {
  addMinutesToIso,
  buildIsoFromDateAndTime,
  buildStoreLocalDayRangeIso,
  formatDateOnly,
  formatDateOnlyInTimeZone,
  formatDatePartsForHuman,
  formatDateTime,
  formatTimeOnly,
  formatTimeOnlyInTimeZone,
  getDateKeyFromParts,
  getLocalDateKeyFromIso,
  getLocalDatePartsForSchedule,
  getScheduleParsingNow,
  getScheduleTimezone,
  hasAmbiguousBareDayDateReference,
  isoDateToLocalDateForDb,
  localScheduleDateTimeToUtcIso,
  normalizeScheduleTimeText,
  padTwoDigits,
  parseCompleteScheduleDateFromText,
  parseDateReferenceFromText,
  parseDbDateKeyToScheduleParts,
  parseScheduleDateFromText,
  parseTimeRangeFromText,
  safeScheduleTimezone,
} from "@/lib/server/assistant/datetime";
import {
  TechnicalVisitStageProjectionError,
  projectTechnicalVisitStageBySystem,
  shouldAttemptTechnicalVisitStageProjection,
} from "@/lib/commercial-opportunity-visit-stage-projection";
import {
  buildAppointmentCandidateOptions,
  getSelectedAssistantCandidateOption,
  readAssistantCandidateOptions,
  resolveAppointmentSelectionFromContextFirst,
  resolveExplicitAppointmentItemIndex,
} from "@/lib/server/assistant/appointment-selection";
import {
  resolveCustomerRescheduleWorkflow,
  type CustomerRescheduleWorkflowDeps,
} from "@/lib/server/assistant/customer-reschedule-workflow";
import { parseRescheduleTargetFromText } from "@/lib/server/assistant/reschedule-target";
import { handleAssistantDocumentEditRequest } from "@/lib/server/assistant/document-edit-intent";
import { handleAssistantContractGenerationRequest } from "@/lib/server/assistant/contract-generation-intent";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";
import {
  createStoreOperationSettingsInputFromSources,
  type StoreOperationSettingsRow,
} from "@/lib/store-operation-settings";
import {
  createStorePaymentDisplaySummaryFromSources,
  type StorePaymentSettingsRow,
} from "@/lib/store-payment-settings";
import {
  createStoreStrategySettingsInputFromSources,
  type StoreStrategySettingsRow,
} from "@/lib/store-strategy-settings";
import { loadCanonicalActivePrimaryStoreResponsible } from "@/lib/server/store-responsibles";

export const runtime = "nodejs";

const ONBOARDING_KEYS = [
  "store_display_name",
  "store_description",
  "responsible_name",
  "responsible_whatsapp",
  "offers_installation",
  "offers_technical_visit",
  "accepted_payment_methods",
  "store_services",
  "important_limitations",
  "technical_visit_rules",
  "technical_visit_rules_selected",
  "installation_process",
  "service_regions",
  "city",
  "state",
] as const;

function asText(value: unknown): string | null {
  if (value == null) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    if (Array.isArray(value)) {
      const items = value.map((item) => asText(item)).filter(Boolean) as string[];
      return items.length ? items.join(", ") : null;
    }

    if (typeof value === "object") {
      return JSON.stringify(value);
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeSystemReaderRow(data: unknown): {
  row: any | null;
  errorMessage: string | null;
} {
  const rows = data == null ? [] : Array.isArray(data) ? data : [data];

  if (rows.length > 1) {
    return {
      row: null,
      errorMessage: "Invalid system reader cardinality.",
    };
  }

  return {
    row: rows[0] ?? null,
    errorMessage: null,
  };
}

function normalizeText(value: string | null | undefined): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function truncateForAiRunLog(value: unknown, maxLength = 1200): string | null {
  const text = asText(value);
  return !text ? null : text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

type AssistantReplyRouteDeps = {
  resolveAccess: (params: {
    requirement: "active";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  generateReply: typeof generateAssistantReply;
};

function aiRunNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function estimateAssistantAiCostUsd(modelName: string, inputTokens: number | null, outputTokens: number | null) {
  const modelKey = String(modelName || "").toLowerCase();
  const pricing =
    modelKey.includes("gpt-4.1-mini") || modelKey.includes("gpt-4o-mini")
      ? { input: 0.4, output: 1.6 }
      : modelKey.includes("gpt-4.1")
        ? { input: 2, output: 8 }
        : null;

  if (!pricing || (!inputTokens && !outputTokens)) return null;

  return Number(
    ((((inputTokens || 0) / 1_000_000) * pricing.input) +
      (((outputTokens || 0) / 1_000_000) * pricing.output)).toFixed(6)
  );
}

async function recordAssistantAiRun(params: {
  supabase: any;
  organizationId: string;
  storeId: string;
  model: string;
  status: "succeeded" | "failed";
  startedAt: string;
  finishedAt: string;
  response?: any;
  error?: string | null;
  lastHumanMessage?: string | null;
  outputText?: string | null;
  detectedIntent?: string | null;
}) {
  try {
    const usage = params.response?.usage || {};
    const inputTokens =
      aiRunNumber(usage.input_tokens) ??
      aiRunNumber(usage.prompt_tokens) ??
      aiRunNumber(usage.inputTokens);
    const outputTokens =
      aiRunNumber(usage.output_tokens) ??
      aiRunNumber(usage.completion_tokens) ??
      aiRunNumber(usage.outputTokens);
    const startedMs = new Date(params.startedAt).getTime();
    const finishedMs = new Date(params.finishedAt).getTime();

    const { error } = await params.supabase.from("ai_runs").insert({
      organization_id: params.organizationId,
      store_id: params.storeId,
      conversation_id: null,
      lead_id: null,
      provider: "openai",
      model: params.model,
      input: {
        type: "assistant_chat",
        usage_capture_source: "assistant-reply-route",
        route: "/api/assistant/reply",
        detected_intent: params.detectedIntent || null,
        last_human_message_preview: truncateForAiRunLog(params.lastHumanMessage, 500),
      },
      output: {
        response_id: params.response?.id || null,
        text_preview: truncateForAiRunLog(params.outputText, 1000),
      },
      error: params.error || null,
      status: params.status,
      started_at: params.startedAt,
      finished_at: params.finishedAt,
      latency_ms:
        Number.isFinite(startedMs) && Number.isFinite(finishedMs)
          ? Math.max(0, finishedMs - startedMs)
          : null,
      tokens_prompt: inputTokens,
      tokens_completion: outputTokens,
      cost_usd: estimateAssistantAiCostUsd(params.model, inputTokens, outputTokens),
    });

    if (error) console.error("[assistant-ai-run-capture] insert failed", error);
  } catch (error) {
    console.error("[assistant-ai-run-capture] unexpected failure", error);
  }
}


function formatAppointmentRangeInTimeZone(args: {
  appointment?: Pick<AppointmentRow, "scheduled_start" | "scheduled_end"> | null;
  scheduleSettings?: StoreScheduleSettingsRow | null;
  timezoneName?: string | null;
}) {
  const timeZone = args.timezoneName || getScheduleTimezone(args.scheduleSettings || null);
  const start = args.appointment?.scheduled_start || args.appointment?.scheduled_end || null;
  const end = args.appointment?.scheduled_end || null;

  if (!start) return "sem horário carregado";

  const dateLabel = formatDateOnlyInTimeZone(start, timeZone);
  const startLabel = formatTimeOnlyInTimeZone(start, timeZone);
  const endLabel = end ? formatTimeOnlyInTimeZone(end, timeZone) : null;

  return `${dateLabel} das ${startLabel}${endLabel ? ` às ${endLabel}` : ""}`;
}

function formatAppointmentStartInTimeZone(args: {
  value: string | null | undefined;
  scheduleSettings?: StoreScheduleSettingsRow | null;
  timezoneName?: string | null;
}) {
  const timeZone = args.timezoneName || getScheduleTimezone(args.scheduleSettings || null);
  const value = args.value || null;
  if (!value) return "sem horário carregado";
  return `${formatDateOnlyInTimeZone(value, timeZone)} às ${formatTimeOnlyInTimeZone(value, timeZone)}`;
}

function isPlainAssistantOptionChoice(text: string) {
  return /^\s*(?:op(?:ç|c)(?:a|ã)o\s*)?\d{1,2}\s*[.)]?\s*$/i.test(String(text || ""));
}

function getContextScheduleAction(contextState?: StoreAssistantContextStateRow | null): ScheduleAction | null {
  const activeIntent = normalizeText(contextState?.active_intent || "");
  if (["cancel", "complete", "needs_followup", "reschedule", "create"].includes(activeIntent)) {
    return activeIntent as ScheduleAction;
  }
  return null;
}

function formatAppointmentType(value: string | null) {
  const normalized = normalizeText(value);

  if (normalized === "technical_visit") return "visita técnica";
  if (normalized === "installation") return "instalação";
  if (normalized === "follow_up") return "follow-up";
  if (normalized === "meeting") return "reunião";
  if (normalized === "measurement") return "medição";
  if (normalized === "maintenance") return "manutenção";
  if (normalized === "other") return "outro";
  return value || "compromisso";
}

type SendAiMessageToCustomerConversationResult =
  | { ok: true; messageId: string | null }
  | { ok: false; error: string };

type CommercialTargetForSideEffect = {
  source: string;
  leadId?: string | null;
  conversationId?: string | null;
  commercialOpportunityId?: string | null;
  appointmentId?: string | null;
  taskId?: string | null;
  customerName?: string | null;
};

function buildCustomerRescheduleMessage(args: {
  appointment: AppointmentRow;
  proposedStartIso?: string | null;
  scheduleSettings?: StoreScheduleSettingsRow | null;
}) {
  const appointment = args.appointment;
  const customerName = String(appointment.customer_name || '').trim() || 'tudo bem';
  const appointmentTypeLabel = formatAppointmentType(appointment.appointment_type);
  const timeZone = getScheduleTimezone(args.scheduleSettings || null);
  const scheduledDate = formatDateOnlyInTimeZone(appointment.scheduled_start, timeZone);
  const scheduledTime = formatTimeOnlyInTimeZone(appointment.scheduled_start, timeZone);

  if (args.proposedStartIso) {
    const proposedDate = formatDateOnlyInTimeZone(args.proposedStartIso, timeZone);
    const proposedTime = formatTimeOnlyInTimeZone(args.proposedStartIso, timeZone);
    return `Oi, ${customerName}. Passando aqui porque preciso remarcar a sua ${appointmentTypeLabel}, que estava prevista para ${scheduledDate} às ${scheduledTime}. Podemos ajustar para ${proposedDate} às ${proposedTime}?`;
  }

  return `Oi, ${customerName}. Passando aqui porque preciso remarcar a sua ${appointmentTypeLabel}, que estava prevista para ${scheduledDate} às ${scheduledTime}. Me fala qual dia e horário ficam melhores para você que eu vou organizando por aqui.`;
}

async function sendAiMessageToCustomerConversation(args: {
  supabase: any;
  conversationId: string;
  text: string;
  target: CommercialTargetForSideEffect | null;
}): Promise<SendAiMessageToCustomerConversationResult> {
  const conversationId = String(args.conversationId || '').trim();
  const text = String(args.text || '').trim();
  const targetConversationId = String(args.target?.conversationId || "").trim();

  if (!conversationId) {
    return { ok: false, error: 'CONVERSATION_ID_MISSING' };
  }

  if (!args.target || !targetConversationId) {
    return { ok: false, error: 'COMMERCIAL_TARGET_NOT_CANONICAL' };
  }

  if (targetConversationId !== conversationId) {
    return { ok: false, error: 'COMMERCIAL_TARGET_CONVERSATION_MISMATCH' };
  }

  if (!text) {
    return { ok: false, error: 'TEXT_MISSING' };
  }

  const { data, error } = await args.supabase.rpc('panel_send_message', {
    p_conversation_id: conversationId,
    p_text: text,
    p_sender: 'ai',
    p_external_message_id: null,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  return {
    ok: true,
    messageId: typeof data === 'string' ? data : data?.id ?? null,
  };
}


function formatAppointmentStatus(value: string | null) {
  const normalized = normalizeText(value);

  if (normalized === "scheduled") return "agendado";
  if (normalized === "rescheduled") return "remarcado";
  if (normalized === "completed") return "concluído";
  if (normalized === "cancelled") return "cancelado";
  if (normalized === "blocked") return "bloqueado";
  return value || "sem status";
}

function formatFollowupStatus(value: string | null) {
  const normalized = normalizeText(value);

  if (normalized === "pending_confirmation") return "aguardando confirmação do responsável";
  if (normalized === "prompt_sent") return "aguardando confirmação do retorno";
  if (normalized === "confirmed_completed") return "confirmado como concluído";
  if (normalized === "confirmed_rescheduled") return "confirmado como remarcado";
  if (normalized === "confirmed_cancelled") return "confirmado como cancelado";
  return value || "sem status";
}

function formatResolution(value: string | null) {
  const normalized = normalizeText(value);

  if (normalized === "completed") return "concluído";
  if (normalized === "rescheduled") return "remarcado";
  if (normalized === "cancelled") return "cancelado";
  return value || "sem resolução";
}

function formatPreferredChannel(value: string | null) {
  const normalized = normalizeText(value);
  if (!normalized || normalized === "unknown") return "canal não definido";
  if (normalized === "whatsapp") return "WhatsApp";
  if (normalized === "internal_chat") return "chat interno";
  return value || "canal não definido";
}

function getMessageContent(message: AssistantMessageRow) {
  return String(message.content || "").trim();
}

function isSystemOrContextMessageType(message: AssistantMessageRow) {
  const messageType = normalizeText(message.message_type);

  return (
    messageType === "context" ||
    messageType === "system" ||
    messageType === "report_morning" ||
    messageType === "report_evening" ||
    messageType === "notification"
  );
}

function looksLikeAssistantGeneratedContentText(content: string) {
  const t = normalizeText(content);

  return (
    t.startsWith("junior,") ||
    t.startsWith("relatorio da manha:") ||
    t.startsWith("fechamento do dia:") ||
    t.startsWith("proxima visita:") ||
    t.startsWith("nenhum outro acompanhamento pendente") ||
    t.startsWith("foi resolvido recentemente:") ||
    t.startsWith("resolvidos recentemente:") ||
    t.startsWith("pendencias a resolver:") ||
    t.startsWith("fora isso, nao ha outros acompanhamentos pendentes")
  );
}

function messageLooksLikeDirectResponsibleRequest(content: string) {
  return (
    asksForMorningReport(content) ||
    asksForEveningReport(content) ||
    asksAboutNextVisit(content) ||
    asksAboutPostAppointment(content) ||
    asksAboutToday(content) ||
    asksAboutMaterialsOrDocuments(content) ||
    asksAboutScheduleManagement(content)
  );
}

function isAssistantOperationalMessage(message: AssistantMessageRow) {
  const content = getMessageContent(message);
  const role = normalizeText(message.sender_role);
  const sender = normalizeText(message.sender);
  const direction = normalizeText(message.direction);

  return (
    role === "assistant_operational" ||
    role === "assistant" ||
    sender.includes("assistant") ||
    sender.includes("assistente") ||
    isSystemOrContextMessageType(message) ||
    looksLikeAssistantGeneratedContentText(content) ||
    (direction === "outgoing" && role !== "store_responsible")
  );
}

function getResponsibleMessageScore(message: AssistantMessageRow) {
  const content = getMessageContent(message);
  if (!content) return Number.NEGATIVE_INFINITY;
  if (isAssistantOperationalMessage(message)) return Number.NEGATIVE_INFINITY;

  const role = normalizeText(message.sender_role);
  const sender = normalizeText(message.sender);
  const direction = normalizeText(message.direction);
  const messageType = normalizeText(message.message_type);

  let score = 0;

  if (role === "store_responsible") score += 120;
  if (sender === "user" || sender === "responsavel" || sender === "responsável") score += 110;
  if (sender.includes("respons")) score += 90;
  if (direction === "incoming" || direction === "inbound") score += 100;
  if (messageType === "text" || messageType === "message") score += 60;
  if (messageLooksLikeDirectResponsibleRequest(content)) score += 140;

  if (isSystemOrContextMessageType(message)) score -= 200;
  if (looksLikeAssistantGeneratedContentText(content)) score -= 220;

  return score;
}

function isLikelyResponsibleMessage(message: AssistantMessageRow) {
  return getResponsibleMessageScore(message) >= 100;
}

function hasAnyTerm(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}


function hasLooseReferenceTerm(text: string) {
  return hasAnyTerm(text, [
    "esse",
    "essa",
    "isso",
    "esse caso",
    "essa visita",
    "esse atendimento",
    "esse retorno",
    "esse acompanhamento",
    "esse daqui",
    "isso daqui",
    "isso ai",
    "isso aí",
    "esse aqui",
    "aquele que eu falei",
    "o que eu acabei de citar",
    "o da instalacao",
    "o da instalação",
    "o da visita",
    "o retorno da instalacao",
    "o retorno da instalação",
    "o retorno da visita",
  ]);
}

function containsStandaloneCompleteCue(text: string) {
  return hasAnyTerm(text, [
    "concluido",
    "concluída",
    "concluida",
    "finalizado",
    "finalizada",
    "finalizar",
    "finaliza",
    "finalize",
    "encerrado",
    "encerrada",
    "encerrar",
    "encerra",
    "encerre",
    "terminou",
    "terminado",
    "resolvido",
    "resolvida",
    "resolver isso",
    "fechar isso",
    "fecha isso",
    "baixar isso como concluido",
    "baixar isso como concluída",
    "baixar isso como concluida",
    "considerar concluido",
    "considerar concluída",
    "considerar concluida",
  ]);
}

function containsStandaloneCancelCue(text: string) {
  return hasAnyTerm(text, [
    "cancelado",
    "cancelada",
    "cancelar",
    "cancela",
    "cancele",
    "considerar cancelado",
    "fechar isso como cancelado",
  ]);
}

function containsStandaloneRescheduleCue(text: string) {
  return hasAnyTerm(text, [
    "remarcado",
    "remarcada",
    "remarcar",
    "remarca",
    "remarque",
    "considerar remarcado",
  ]);
}

function containsStandalonePendingCue(text: string) {
  return hasAnyTerm(text, [
    "pendente",
    "aguardando",
    "ainda falta retorno",
    "ainda falta resposta",
    "ainda precisa retorno",
    "ainda precisa resposta",
    "ainda esta pendente",
    "ainda está pendente",
    "ainda nao concluiu",
    "ainda não concluiu",
    "ainda nao terminou",
    "ainda não terminou",
    "manter pendente",
    "mantem pendente",
    "mantém pendente",
    "deixa pendente",
    "deixar pendente",
  ]);
}

function asksAboutToday(text: string) {
  const t = normalizeText(text);
  return (
    t.includes("hoje") ||
    t.includes("agenda") ||
    t.includes("compromissos") ||
    t.includes("urgente") ||
    t.includes("pendente") ||
    t.includes("o que eu tenho")
  );
}

function isGeneralTodayOverviewRequest(text: string) {
  const t = normalizeText(text);

  if (hasExplicitAppointmentManagementCommand(text) || asksToBlockStoreDay(text)) {
    return false;
  }

  return hasAnyTerm(t, [
    "o que tem pra hoje",
    "o que tem para hoje",
    "o que tem hoje",
    "agenda de hoje",
    "como esta hoje",
    "como está hoje",
    "como esta a agenda hoje",
    "como está a agenda hoje",
    "compromissos de hoje",
    "atendimentos de hoje",
    "visitas de hoje",
    "instalacoes de hoje",
    "instalações de hoje",
    "me atualize sobre hoje",
    "resumo de hoje",
  ]);
}

function resolveSpecificScheduleQueryDateParts(text: string, now: Date) {
  const t = normalizeText(text);

  // Consulta pura de agenda deve ser lida pela tabela store_appointments atual.
  // Nunca usar histórico de remarcação, tarefas antigas ou contexto ativo como fonte de verdade.
  if (!t) return null;
  if (hasExplicitAppointmentManagementCommand(text) || asksToBlockStoreDay(text)) return null;
  if (hasAnyTerm(t, ["remarca", "remarque", "remarcar", "reagenda", "reagende", "reagendar", "cancele", "cancelar", "cancela", "conclua", "concluir", "finalize", "finalizar"])) return null;

  const asksSchedule = hasAnyTerm(t, [
    "agenda",
    "compromisso",
    "compromissos",
    "atendimento",
    "atendimentos",
    "visita",
    "visitas",
    "instalacao",
    "instalação",
    "instalacoes",
    "instalações",
    "o que tenho",
    "o que eu tenho",
    "quais tenho",
  ]);

  if (!asksSchedule) return null;

  const dateParts = parseScheduleDateFromText(text, now);
  if (!dateParts) return null;

  return dateParts;
}

function shouldIncludeScheduleBlocksInSpecificDayQuery(text: string) {
  const t = normalizeText(text);

  const explicitlyOnlyAppointments = hasAnyTerm(t, [
    "compromisso",
    "compromissos",
    "atendimento",
    "atendimentos",
    "visita",
    "visitas",
    "instalacao",
    "instalação",
    "instalacoes",
    "instalações",
  ]) && !t.includes("agenda");

  if (explicitlyOnlyAppointments) return false;

  return hasAnyTerm(t, [
    "agenda",
    "o que tenho no dia",
    "o que eu tenho no dia",
    "o que tenho para o dia",
    "o que eu tenho para o dia",
    "como esta meu dia",
    "como está meu dia",
    "como esta o dia",
    "como está o dia",
    "meu dia",
  ]);
}


function asksAboutMaterialsOrDocuments(text: string) {
  const t = normalizeText(text);
  return (
    t.includes("material") ||
    t.includes("materiais") ||
    t.includes("documento") ||
    t.includes("documentos") ||
    t.includes("checklist") ||
    t.includes("levar") ||
    t.includes("usar nessa visita") ||
    t.includes("o que eu preciso levar") ||
    t.includes("o que eu tenho que levar")
  );
}

function hasExplicitAppointmentManagementCommand(text: string) {
  const t = normalizeText(text);

  return hasAnyTerm(t, [
    "remarque",
    "remarca",
    "remarcar",
    "reagende",
    "reagenda",
    "reagendar",
    "mude a visita",
    "muda a visita",
    "mudar a visita",
    "mude o compromisso",
    "muda o compromisso",
    "mudar o compromisso",
    "mude a instalacao",
    "mude a instalação",
    "muda a instalacao",
    "muda a instalação",
    "cancelar compromisso",
    "cancelar visita",
    "cancelar instalacao",
    "cancelar instalação",
    "cancele o compromisso",
    "cancele a visita",
    "cancele a instalacao",
    "cancele a instalação",
    "concluir compromisso",
    "concluir visita",
    "concluir instalacao",
    "concluir instalação",
    "conclua o compromisso",
    "conclua a visita",
    "conclua a instalacao",
    "conclua a instalação",
    "visita do",
    "visita da",
    "compromisso do",
    "compromisso da",
    "instalacao do",
    "instalação do",
    "instalacao da",
    "instalação da",
  ]);
}

function asksAboutScheduleManagement(text: string) {
  const t = normalizeText(text);

  if (asksToBlockStoreDay(text)) return true;

  return hasAnyTerm(t, [
    "agendar",
    "agenda",
    "marcar compromisso",
    "marcar visita",
    "marcar instalacao",
    "marcar instalação",
    "criar compromisso",
    "novo compromisso",
    "nova visita",
    "nova instalacao",
    "nova instalação",
    "cancelar compromisso",
    "cancelar visita",
    "cancelar instalacao",
    "cancelar instalação",
    "remarcar compromisso",
    "remarcar visita",
    "remarcar instalacao",
    "remarcar instalação",
    "concluir compromisso",
    "concluir visita",
    "concluir instalacao",
    "concluir instalação",
    "adicionar compromisso",
    "adiciona um compromisso",
    "adicione um compromisso",
    "adicionar visita",
    "adiciona uma visita",
    "adicione uma visita",
  ]);
}

function asksAboutPostAppointment(text: string) {
  const t = normalizeText(text);

  // Segurança: comandos explícitos de agenda (cancelar, concluir, remarcar ou criar compromisso)
  // não podem cair no fluxo de pós-compromisso. Esse fluxo pode usar contexto anterior
  // e, em ações sensíveis, isso abre risco de alterar o compromisso errado.
  if (hasExplicitAppointmentManagementCommand(text)) {
    return false;
  }

  if (asksForMorningReport(t) || asksForEveningReport(t) || asksAboutNextVisit(t)) {
    return false;
  }

  if (
    hasAnyTerm(t, [
      "pos compromisso",
      "pos-compromisso",
      "acompanhamento",
      "retorno",
      "depois da visita",
      "depois do compromisso",
      "o que ficou pendente",
      "o que ainda preciso resolver",
      "visitas pendentes",
      "confirmacao",
      "confirmar esse pos-compromisso",
      "confirmar esse pos compromisso",
      "confirmar o pos-compromisso",
      "confirmar o pos compromisso",
      "remarcacao",
      "remarcado",
      "cancelamento",
      "cancelado",
      "conclusao da visita",
      "conclusao do compromisso",
      "deixar como concluido",
      "deixar como concluída",
      "deixar como concluida",
      "deixa como concluido",
      "deixa como concluida",
      "deixa como concluída",
      "pode deixar como concluido",
      "pode deixar como concluida",
      "pode deixar como concluída",
      "marque como concluido",
      "marque como concluida",
      "marque como concluída",
      "marca como concluido",
      "marca como concluida",
      "marca como concluída",
      "pode marcar como concluido",
      "pode marcar como concluida",
      "pode marcar como concluída",
      "quero atualizar",
      "quero resolver",
      "quero concluir",
      "quero finalizar",
      "pode finalizar",
      "pode encerrar",
      "pode considerar concluido",
      "pode considerar concluida",
      "pode considerar concluída",
      "pode fechar isso",
      "fecha isso",
      "resolva isso",
      "cancela isso",
      "quero cancelar isso",
      "pode considerar cancelado",
      "fecha isso como cancelado",
      "remarque isso",
      "quero remarcar isso",
      "ainda falta retorno",
      "ainda falta resposta",
      "continua pendente",
      "continua aguardando",
      "manter pendente",
      "mantem pendente",
      "mantém pendente",
      "deixa pendente",
      "deixar pendente",
      "ainda precisa retorno",
      "ainda precisa resposta",
      "esse retorno",
      "esse acompanhamento",
      "retorno apos a instalacao",
      "retorno após a instalação",
      "retorno da instalacao",
      "retorno da instalação",
      "apos a instalacao",
      "após a instalação",
      "esse da instalacao",
      "esse da instalação",
      "esse da visita",
      "sobre o cliente",
    ])
  ) {
    return true;
  }

  const hasActionCue =
    containsStandaloneCompleteCue(t) ||
    containsStandaloneCancelCue(t) ||
    containsStandaloneRescheduleCue(t) ||
    containsStandalonePendingCue(t);

  const hasReferenceCue =
    hasLooseReferenceTerm(t) ||
    hasAnyTerm(t, [
      "cliente ",
      "do cliente ",
      "sobre o ",
      "visita tecnica",
      "visita técnica",
      "instalacao",
      "instalação",
      "manutencao",
      "manutenção",
      "titulo",
      "título",
    ]);

  return hasActionCue && hasReferenceCue;
}

function asksToListAllPostAppointments(text: string) {
  const t = normalizeText(text);

  if (!asksAboutPostAppointment(t)) {
    return false;
  }

  return hasAnyTerm(t, [
    "me mostra os proximos",
    "me mostra os próximos",
    "listar os proximos",
    "listar os próximos",
    "liste os proximos",
    "liste os próximos",
    "liste todos",
    "listar todos",
    "me mostra todos",
    "me mostre todos",
    "quais sao os outros",
    "quais são os outros",
    "quero ver todos",
    "todos os pendentes",
    "todos os pos-compromissos",
    "todos os pos compromissos",
    "por ordem de urgencia",
    "por ordem de urgência",
    "os proximos",
    "os próximos",
  ]);
}

function resolvePostAppointmentDetailIndex(text: string, totalItems: number) {
  const t = normalizeText(text);

  if (!asksAboutPostAppointment(t) || totalItems <= 0) {
    return null;
  }

  if (
    hasAnyTerm(t, [
      "mais urgente",
      "caso mais urgente",
      "esse mais urgente",
      "desse mais urgente",
      "detalhe o mais urgente",
      "me fale mais sobre esse mais urgente",
      "quero mais contexto desse mais urgente",
    ])
  ) {
    return 0;
  }

  const explicitNumberMatch = t.match(/(?:caso|item|pendencia|pendência|pos compromisso|pos-compromisso|atendimento)?\s*(\d{1,2})\b/);
  if (explicitNumberMatch) {
    const numericIndex = Number(explicitNumberMatch[1]);
    if (Number.isInteger(numericIndex) && numericIndex >= 1 && numericIndex <= totalItems) {
      return numericIndex - 1;
    }
  }

  const ordinalMap: Array<[string, number]> = [
    ["primeiro", 0],
    ["segunda", 1],
    ["segundo", 1],
    ["terceira", 2],
    ["terceiro", 2],
    ["quarta", 3],
    ["quarto", 3],
    ["quinta", 4],
    ["quinto", 4],
    ["sexta", 5],
    ["sexto", 5],
    ["setima", 6],
    ["sétima", 6],
    ["setimo", 6],
    ["sétimo", 6],
    ["oitava", 7],
    ["oitavo", 7],
    ["nona", 8],
    ["nono", 8],
    ["decima", 9],
    ["décima", 9],
    ["decimo", 9],
    ["décimo", 9],
  ];

  for (const [term, index] of ordinalMap) {
    if (t.includes(term) && index < totalItems) {
      return index;
    }
  }

  if (
    hasAnyTerm(t, [
      "me fale mais sobre",
      "me explica melhor",
      "me explique melhor",
      "detalhe",
      "detalhar",
      "quero mais contexto",
      "qual é o telefone do",
      "qual o telefone do",
      "esse caso",
      "esse é de visita",
      "esse e de visita",
      "esse é de instalação",
      "esse e de instalacao",
    ])
  ) {
    return 0;
  }

  return null;
}

function asksToDetailSpecificPostAppointment(text: string, totalItems: number) {
  return resolvePostAppointmentDetailIndex(text, totalItems) !== null;
}

type PostAppointmentAction =
  | "complete"
  | "cancel"
  | "reschedule"
  | "needs_followup";

function resolvePostAppointmentAction(text: string): PostAppointmentAction | null {
  const t = normalizeText(text);

  if (!asksAboutPostAppointment(t)) {
    return null;
  }

  if (
    hasAnyTerm(t, [
      "ainda falta retorno",
      "ainda falta resposta",
      "continua pendente",
      "continua aguardando",
      "manter pendente",
      "mantem pendente",
      "mantém pendente",
      "deixa pendente",
      "deixar pendente",
      "pode deixar pendente",
      "ainda nao concluiu",
      "ainda não concluiu",
      "ainda nao terminou",
      "ainda não terminou",
      "ainda precisa retorno",
      "ainda precisa resposta",
      "esse caso ainda esta pendente",
      "esse caso ainda está pendente",
      "esse retorno ainda esta pendente",
      "esse retorno ainda está pendente",
    ])
  ) {
    return "needs_followup";
  }

  if (
    hasAnyTerm(t, [
      "foi concluido",
      "foi concluído",
      "foi concluida",
      "foi concluída",
      "marcar como concluido",
      "marcar como concluído",
      "marcar como concluida",
      "marcar como concluída",
      "marca como concluido",
      "marca como concluído",
      "marca como concluida",
      "marca como concluída",
      "pode concluir",
      "pode marcar como concluido",
      "pode marcar como concluído",
      "pode marcar como concluida",
      "pode marcar como concluída",
      "deixar como concluido",
      "deixar como concluída",
      "deixar como concluida",
      "deixa como concluido",
      "deixa como concluída",
      "deixa como concluida",
      "pode deixar como concluido",
      "pode deixar como concluída",
      "pode deixar como concluida",
      "ja foi concluido",
      "já foi concluído",
      "ja foi concluida",
      "já foi concluída",
      "isso foi concluido",
      "isso foi concluído",
      "esse ja foi concluido",
      "esse já foi concluído",
      "esse retorno ja foi concluido",
      "esse retorno já foi concluído",
      "quero atualizar",
      "quero resolver",
      "quero concluir isso",
      "quero finalizar isso",
      "pode finalizar",
      "pode encerrar",
      "isso ja terminou",
      "isso já terminou",
      "terminou",
      "terminou sim",
      "terminou tudo",
      "pode considerar concluido",
      "pode considerar concluída",
      "pode considerar concluida",
      "pode considerar isso como concluido",
      "pode considerar isso como concluída",
      "pode considerar isso como concluida",
      "pode baixar isso como concluido",
      "pode baixar isso como concluída",
      "pode baixar isso como concluida",
      "pode fechar isso",
      "fecha isso",
      "quero atualizar isso como concluido",
      "quero atualizar isso como concluída",
      "quero atualizar isso como concluida",
      "quero resolver isso",
      "resolva isso como concluido",
      "resolva isso como concluída",
      "resolva isso como concluida",
      "conclui",
      "concluir",
      "finaliza",
      "encerra",
    ])
  ) {
    return "complete";
  }

  if (
    hasAnyTerm(t, [
      "foi cancelado",
      "foi cancelada",
      "marcar como cancelado",
      "marca como cancelado",
      "pode cancelar",
      "pode marcar como cancelado",
      "deixar como cancelado",
      "deixa como cancelado",
      "pode deixar como cancelado",
      "isso foi cancelado",
      "esse foi cancelado",
      "esse caso foi cancelado",
      "ja foi cancelado",
      "já foi cancelado",
      "cancelou",
      "cancelada",
      "cancelado",
      "cancela isso",
      "quero cancelar isso",
      "pode considerar cancelado",
      "fecha isso como cancelado",
      "cancela",
      "cancelar",
    ])
  ) {
    return "cancel";
  }

  if (
    hasAnyTerm(t, [
      "foi remarcado",
      "foi remarcada",
      "marcar como remarcado",
      "marca como remarcado",
      "pode remarcar",
      "pode marcar como remarcado",
      "deixar como remarcado",
      "deixa como remarcado",
      "pode deixar como remarcado",
      "esse foi remarcado",
      "isso foi remarcado",
      "ja foi remarcado",
      "já foi remarcado",
      "remarcou",
      "remarcada",
      "remarcado",
      "remarque isso",
      "quero remarcar isso",
      "esse caso foi remarcado",
      "remarca",
      "remarcar",
    ])
  ) {
    return "reschedule";
  }

  return null;
}

function normalizeDigits(value: string | null | undefined) {
  return String(value || "").replace(/\D+/g, "");
}

function resolvePostAppointmentCandidateIndexesFromText(args: {
  text: string;
  openItems: PostAppointmentFollowupRow[];
  appointmentMap: Map<string, AppointmentRow>;
}) {
  const normalizedText = normalizeText(args.text);
  const digitText = normalizeDigits(args.text);

  if (!normalizedText) return [] as number[];

  const phoneMatches: number[] = [];
  const customerMatches: number[] = [];
  const titleMatches: number[] = [];
  const strongContextMatches: number[] = [];
  const typeMatches: number[] = [];

  args.openItems.forEach((item, index) => {
    const appointment = args.appointmentMap.get(item.appointment_id);
    if (!appointment) return;

    const phoneDigits = normalizeDigits(appointment.customer_phone);
    if (phoneDigits.length >= 8 && digitText && digitText.includes(phoneDigits)) {
      phoneMatches.push(index);
    }

    const customerName = normalizeText(appointment.customer_name);
    if (customerName && customerName.length >= 3 && normalizedText.includes(customerName)) {
      customerMatches.push(index);
    }

    const title = normalizeText(appointment.title);
    if (title && title.length >= 3 && normalizedText.includes(title)) {
      titleMatches.push(index);
    }

    const typeCode = normalizeText(appointment.appointment_type);
    const typeLabel = normalizeText(formatAppointmentType(appointment.appointment_type));

    const mentionsInstallation =
      normalizedText.includes("instalacao") ||
      normalizedText.includes("instalação");
    const mentionsVisit =
      normalizedText.includes("visita tecnica") ||
      normalizedText.includes("visita técnica") ||
      normalizedText.includes("visita");
    const mentionsMaintenance =
      normalizedText.includes("manutencao") ||
      normalizedText.includes("manutenção");
    const mentionsReturn =
      normalizedText.includes("retorno") ||
      normalizedText.includes("acompanhamento") ||
      normalizedText.includes("pos compromisso") ||
      normalizedText.includes("pos-compromisso");

    if (mentionsInstallation && (typeCode === "installation" || typeLabel.includes("instalacao") || typeLabel.includes("instalação"))) {
      typeMatches.push(index);
    }

    if (mentionsVisit && (typeCode === "technical_visit" || typeLabel.includes("visita"))) {
      typeMatches.push(index);
    }

    if (mentionsMaintenance && (typeCode === "maintenance" || typeLabel.includes("manutencao") || typeLabel.includes("manutenção"))) {
      typeMatches.push(index);
    }

    if (
      mentionsReturn &&
      (
        normalizedText.includes("apos a instalacao") ||
        normalizedText.includes("após a instalação") ||
        normalizedText.includes("retorno apos a instalacao") ||
        normalizedText.includes("retorno após a instalação") ||
        normalizedText.includes("retorno da instalacao") ||
        normalizedText.includes("retorno da instalação") ||
        normalizedText.includes("esse da instalacao") ||
        normalizedText.includes("esse da instalação") ||
        normalizedText.includes("o da instalacao") ||
        normalizedText.includes("o da instalação")
      ) &&
      typeCode === "installation"
    ) {
      strongContextMatches.push(index);
    }

    if (
      mentionsReturn &&
      (
        normalizedText.includes("apos a visita") ||
        normalizedText.includes("após a visita") ||
        normalizedText.includes("retorno da visita") ||
        normalizedText.includes("retorno apos a visita") ||
        normalizedText.includes("retorno após a visita") ||
        normalizedText.includes("esse da visita") ||
        normalizedText.includes("o da visita")
      ) &&
      typeCode === "technical_visit"
    ) {
      strongContextMatches.push(index);
    }

    if (
      mentionsReturn &&
      customerName &&
      customerName.length >= 3 &&
      normalizedText.includes(customerName) &&
      (normalizedText.includes("esse retorno") || normalizedText.includes("esse acompanhamento"))
    ) {
      strongContextMatches.push(index);
    }

    if (
      customerName &&
      customerName.length >= 3 &&
      (
        normalizedText.includes(`sobre o cliente ${customerName}`) ||
        normalizedText.includes(`sobre o ${customerName}`) ||
        normalizedText.includes(`do cliente ${customerName}`) ||
        normalizedText.includes(`do ${customerName}`) ||
        normalizedText.includes(`esse do ${customerName}`) ||
        normalizedText.includes(`o retorno do ${customerName}`) ||
        normalizedText.includes(`a instalacao do ${customerName}`) ||
        normalizedText.includes(`a instalação do ${customerName}`) ||
        normalizedText.includes(`a visita do ${customerName}`) ||
        normalizedText.includes(`visita tecnica do ${customerName}`) ||
        normalizedText.includes(`visita técnica do ${customerName}`)
      )
    ) {
      strongContextMatches.push(index);
    }

    if (
      title &&
      title.length >= 3 &&
      (
        normalizedText.includes(`quero atualizar ${title}`) ||
        normalizedText.includes(`conclui ${title}`) ||
        normalizedText.includes(`cancela ${title}`) ||
        normalizedText.includes(`remarca ${title}`) ||
        normalizedText.includes(`marque como concluido ${title}`) ||
        normalizedText.includes(`marque como concluída ${title}`) ||
        normalizedText.includes(`marque como concluida ${title}`) ||
        normalizedText.includes(`marca como concluido ${title}`) ||
        normalizedText.includes(`marca como concluída ${title}`) ||
        normalizedText.includes(`marca como concluida ${title}`) ||
        normalizedText.includes(`deixa como concluido ${title}`) ||
        normalizedText.includes(`deixa como concluída ${title}`) ||
        normalizedText.includes(`deixa como concluida ${title}`) ||
        normalizedText.includes(title)
      )
    ) {
      strongContextMatches.push(index);
    }
  });

  const dedup = (values: number[]) => [...new Set(values)];

  if (phoneMatches.length) return dedup(phoneMatches);
  if (strongContextMatches.length) return dedup(strongContextMatches);
  if (customerMatches.length && typeMatches.length) {
    const intersection = dedup(customerMatches.filter((index) => typeMatches.includes(index)));
    if (intersection.length) return intersection;
  }
  if (customerMatches.length) return dedup(customerMatches);
  if (titleMatches.length) return dedup(titleMatches);
  if (typeMatches.length) return dedup(typeMatches);
  return [] as number[];
}

function inferPreviousPostAppointmentTarget(args: {
  messages: AssistantMessageRow[];
  currentHumanMessage: string;
  openItems: PostAppointmentFollowupRow[];
  appointmentMap: Map<string, AppointmentRow>;
}) {
  const ordered = [...args.messages]
    .filter((message) => getMessageContent(message).length > 0)
    .map((message) => getMessageContent(message))
    .filter((content) => content !== args.currentHumanMessage);

  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const content = ordered[index];
    const explicitIndex = resolvePostAppointmentDetailIndex(content, args.openItems.length);
    if (explicitIndex !== null) {
      return { type: "unique" as const, index: explicitIndex };
    }

    const candidateIndexes = resolvePostAppointmentCandidateIndexesFromText({
      text: content,
      openItems: args.openItems,
      appointmentMap: args.appointmentMap,
    });

    if (candidateIndexes.length === 1) {
      return { type: "unique" as const, index: candidateIndexes[0] };
    }

    if (candidateIndexes.length > 1) {
      return { type: "ambiguous" as const, candidateIndexes };
    }
  }

  return null;
}

function buildPostAppointmentAmbiguityReply(args: {
  candidateIndexes: number[];
  openItems: PostAppointmentFollowupRow[];
  appointmentMap: Map<string, AppointmentRow>;
}) {
  const lines: string[] = [];
  lines.push("Encontrei mais de um item ativo para esse pedido.");
  lines.push("Me diga qual deles você quer atualizar:");
  lines.push("");

  args.candidateIndexes.slice(0, 5).forEach((candidateIndex) => {
    const item = args.openItems[candidateIndex];
    const appointment = args.appointmentMap.get(item.appointment_id);
    const itemNumber = candidateIndex + 1;
    const typeAndTitle = buildPostAppointmentTypeAndTitle(appointment);
    const customer = appointment?.customer_name || "cliente não identificado";
    const timeLabel = appointment?.scheduled_end || appointment?.scheduled_start || item.scheduled_end;

    lines.push(`${itemNumber}. ${typeAndTitle.charAt(0).toUpperCase() + typeAndTitle.slice(1)}`);
    lines.push(`- cliente: ${customer}`);
    if (timeLabel) {
      lines.push(`- horário original: ${formatDateOnly(timeLabel)} às ${formatTimeOnly(timeLabel)}`);
    }
    lines.push(`- situação atual: ${formatPostAppointmentCurrentSituation(item)}`);
    lines.push("");
  });

  lines.push('Você pode responder, por exemplo: "remarque o item 2 para amanhã às 15:00".');
  return lines.join("\n").trim();
}

function resolveTargetPostAppointmentIndex(args: {
  text: string;
  openItems: PostAppointmentFollowupRow[];
  appointmentMap: Map<string, AppointmentRow>;
  recentMessages?: AssistantMessageRow[];
}) {
  // Segurança: se o responsável citou explicitamente um compromisso/visita pelo comando de agenda,
  // não reaproveitar item antigo da fila de retorno. Cancelamento/conclusão/remarcação devem ir
  // para o fluxo de agenda, que valida título, cliente e compromisso antes de alterar o banco.
  if (hasExplicitAppointmentManagementCommand(args.text) || extractExplicitAppointmentTitleCandidateFromCommand(args.text)) {
    return { type: "none" as const };
  }

  const explicitIndex = resolvePostAppointmentDetailIndex(args.text, args.openItems.length);
  if (explicitIndex !== null) {
    return { type: "unique" as const, index: explicitIndex };
  }

  const currentCandidates = resolvePostAppointmentCandidateIndexesFromText({
    text: args.text,
    openItems: args.openItems,
    appointmentMap: args.appointmentMap,
  });

  if (currentCandidates.length === 1) {
    return { type: "unique" as const, index: currentCandidates[0] };
  }

  if (currentCandidates.length > 1) {
    return { type: "ambiguous" as const, candidateIndexes: currentCandidates };
  }

  if (
    hasAnyTerm(normalizeText(args.text), [
      "esse foi",
      "esse caso",
      "esse atendimento",
      "esse item",
      "este item",
      "esse compromisso",
      "este compromisso",
      "esse agendamento",
      "este agendamento",
      "esse daqui",
      "isso daqui",
      "isso ai",
      "isso aí",
      "esse aqui",
      "pode marcar esse",
      "pode cancelar esse",
      "pode concluir esse",
      "pode deixar esse",
      "esse retorno",
      "esse acompanhamento",
      "esse retorno apos a instalacao",
      "esse retorno após a instalação",
      "esse retorno da instalacao",
      "esse retorno da instalação",
      "esse da instalacao",
      "esse da instalação",
      "esse da visita",
      "o da instalacao",
      "o da instalação",
      "o da visita",
      "o retorno da instalacao",
      "o retorno da instalação",
      "o retorno da visita",
      "aquele que eu falei",
      "o que eu acabei de citar",
      "marque como",
      "marca como",
      "marque o caso",
      "cancele",
      "conclua",
      "considerar concluido",
      "considerar concluída",
      "considerar concluida",
    ])
  ) {
    const previousTarget = inferPreviousPostAppointmentTarget({
      messages: args.recentMessages || [],
      currentHumanMessage: args.text,
      openItems: args.openItems,
      appointmentMap: args.appointmentMap,
    });

    if (previousTarget) {
      return previousTarget;
    }
  }

  return { type: "none" as const };
}

function buildPostAppointmentActionSuccessReply(args: {
  action: PostAppointmentAction;
  itemNumber: number;
  appointment?: AppointmentRow;
}) {
  const customerName = args.appointment?.customer_name || "cliente não identificado";
  const typeLabel = args.appointment
    ? formatAppointmentType(args.appointment.appointment_type)
    : "atendimento";
  const titleLabel = String(args.appointment?.title || "").trim();
  const referenceLabel = titleLabel ? `${typeLabel} ${titleLabel}` : typeLabel;

  if (args.action === "complete") {
    return `Certo. Marquei como concluído ${referenceLabel} de ${customerName}.

Esse item saiu da fila de retorno pendente.`;
  }

  if (args.action === "cancel") {
    return `Certo. Marquei como cancelado ${referenceLabel} de ${customerName}.

Esse item saiu da fila de retorno pendente.`;
  }

  if (args.action === "needs_followup") {
    return `Certo. Mantive como pendente de retorno ${referenceLabel} de ${customerName}.

Esse item continua na fila de acompanhamento.`;
  }

  return `Para marcar como remarcado ${referenceLabel} de ${customerName}, eu preciso que você me diga a nova data e o novo horário.`;
}

async function resolvePostAppointmentActionReply(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  threadId?: string | null;
  assistantContextState?: StoreAssistantContextStateRow | null;
  lastHumanMessage: string;
  recentMessages: AssistantMessageRow[];
  pendingPostFollowups: PostAppointmentFollowupRow[];
  appointmentMap: Map<string, AppointmentRow>;
  openAppointments: AppointmentRow[];
  scheduleSettings?: StoreScheduleSettingsRow | null;
}) {
  const action = resolvePostAppointmentAction(args.lastHumanMessage);
  if (!action) {
    return null;
  }

  // Segurança extra: se a frase é comando explícito de agenda, não executar ação usando
  // uma pendência/retorno anterior. Isso evita cancelar ou concluir o compromisso errado.
  if (hasExplicitAppointmentManagementCommand(args.lastHumanMessage) || extractExplicitAppointmentTitleCandidateFromCommand(args.lastHumanMessage)) {
    return await resolveAppointmentActionReply({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      lastHumanMessage: args.lastHumanMessage,
      recentMessages: args.recentMessages,
      openAppointments: args.openAppointments,
      scheduleSettings: args.scheduleSettings || null,
      threadId: args.threadId || null,
      assistantContextState: args.assistantContextState || null,
    });
  }

  const openItems = sortOpenPostFollowups(
    (args.pendingPostFollowups || []).filter((item) => isOpenPostFollowup(item))
  );

  if (!openItems.length) {
    return await resolveAppointmentActionReply({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      lastHumanMessage: args.lastHumanMessage,
      recentMessages: args.recentMessages,
      openAppointments: args.openAppointments,
      scheduleSettings: args.scheduleSettings || null,
      threadId: args.threadId || null,
      assistantContextState: args.assistantContextState || null,
    });
  }

  const targetResolution = resolveTargetPostAppointmentIndex({
    text: args.lastHumanMessage,
    openItems,
    appointmentMap: args.appointmentMap,
    recentMessages: args.recentMessages,
  });

  if (targetResolution.type === "ambiguous") {
    return buildPostAppointmentAmbiguityReply({
      candidateIndexes: targetResolution.candidateIndexes,
      openItems,
      appointmentMap: args.appointmentMap,
    });
  }

  if (targetResolution.type === "none") {
    const appointmentFallback = await resolveAppointmentActionReply({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      lastHumanMessage: args.lastHumanMessage,
      recentMessages: args.recentMessages,
      openAppointments: args.openAppointments,
      scheduleSettings: args.scheduleSettings || null,
      threadId: args.threadId || null,
      assistantContextState: args.assistantContextState || null,
    });

    if (appointmentFallback) {
      return appointmentFallback;
    }

    return "Não consegui identificar qual item você quer atualizar. Se puder, me diga o cliente, o título ou o número da lista.";
  }

  const selectedIndex = Math.min(
    Math.max(targetResolution.index, 0),
    openItems.length - 1
  );

  const selectedFollowup = openItems[selectedIndex];
  const selectedAppointment = args.appointmentMap.get(selectedFollowup.appointment_id);
  const itemNumber = selectedIndex + 1;

  if (!selectedAppointment && (action === "complete" || action === "cancel" || action === "needs_followup")) {
    return `Eu até identifiquei o item ${itemNumber}, mas não achei os dados completos para aplicar essa atualização com segurança.`;
  }

  if (selectedAppointment && (action === "complete" || action === "cancel" || action === "needs_followup")) {
    const targetAssertion = assertCommercialTargetForSideEffect({
      target: buildCommercialTargetFromAppointment(selectedAppointment, "post_appointment_followup"),
      sideEffect: `post_appointment_${action}`,
    });
    if (!targetAssertion.ok) {
      return `Eu até identifiquei o item ${itemNumber}, mas o alvo comercial não está canonicamente resolvido. Não alterei nada.`;
    }
  }

  if (action === "reschedule") {
    return buildPostAppointmentActionSuccessReply({
      action,
      itemNumber,
      appointment: selectedAppointment,
    });
  }

  if (action === "complete") {
    const { error } = await args.supabase.rpc("complete_store_appointment_with_outcome", {
      p_appointment_id: selectedFollowup.appointment_id,
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_completion_outcome: "fully_completed",
      p_completion_note: "Confirmado pelo responsável na assistente operacional.",
    });

    if (error) {
      return `Tentei marcar como concluído, mas encontrei um erro: ${error.message}`;
    }

    return buildPostAppointmentActionSuccessReply({
      action,
      itemNumber,
      appointment: selectedAppointment,
    });
  }

  if (action === "needs_followup") {
    const { error } = await args.supabase.rpc("complete_store_appointment_with_outcome", {
      p_appointment_id: selectedFollowup.appointment_id,
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_completion_outcome: "needs_followup",
      p_completion_note: "Mantido pendente pelo responsável na assistente operacional.",
    });

    if (error) {
      return `Tentei manter como pendente, mas encontrei um erro: ${error.message}`;
    }

    return buildPostAppointmentActionSuccessReply({
      action,
      itemNumber,
      appointment: selectedAppointment,
    });
  }

  if (action === "cancel") {
    const { error: cancelError } = await args.supabase.rpc("cancel_store_appointment", {
      p_appointment_id: selectedFollowup.appointment_id,
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_cancel_reason: "Cancelado pelo responsável na assistente operacional.",
    });

    if (cancelError) {
      return `Tentei marcar como cancelado, mas encontrei um erro: ${cancelError.message}`;
    }

    const nextNotes = (selectedFollowup.notes ? `${selectedFollowup.notes}\n\n` : "") +
      "Confirmado como cancelado pelo responsável na assistente operacional.";

    const { error: updateFollowupError } = await args.supabase
      .from("schedule_post_appointment_followups")
      .update({
        followup_status: "confirmed_cancelled",
        confirmed_at: new Date().toISOString(),
        resolved_at: new Date().toISOString(),
        resolution: "cancelled",
        notes: nextNotes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", selectedFollowup.id)
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId);

    if (updateFollowupError) {
      return `O compromisso foi cancelado, mas eu não consegui encerrar o retorno corretamente: ${updateFollowupError.message}`;
    }

    const cancelledAppointment = selectedAppointment;
    if (!cancelledAppointment) {
      return `O compromisso foi cancelado, mas eu nao achei os dados completos para avisar o cliente automaticamente.`;
    }

    const referenceLabel = buildScheduleAppointmentReferenceLabel(cancelledAppointment);
    const customerName = cancelledAppointment.customer_name || "cliente nao identificado";

    if (cancelledAppointment.conversation_id) {
      const sendResult = await sendAiMessageToCustomerConversation({
        supabase: args.supabase,
        conversationId: cancelledAppointment.conversation_id,
        text: buildCustomerCancellationMessage({
          appointment: cancelledAppointment,
          scheduleSettings: args.scheduleSettings || null,
          reasonText: null,
        }),
        target: buildCommercialTargetFromAppointment(cancelledAppointment, "post_appointment_cancel_followup"),
      });

      if (sendResult.ok) {
        return `Certo. Marquei como cancelado ${referenceLabel} de ${customerName}, avisei o cliente e tirei esse item da fila de retorno pendente.`;
      }

      return `Certo. Marquei como cancelado ${referenceLabel} de ${customerName} e tirei esse item da fila de retorno pendente, mas nao consegui avisar o cliente automaticamente.`;
    }

    return `Certo. Marquei como cancelado ${referenceLabel} de ${customerName} e tirei esse item da fila de retorno pendente, mas nao encontrei conversa vinculada para avisar o cliente automaticamente.`;
  }

  return null;
}

function formatPostAppointmentCurrentSituation(item: PostAppointmentFollowupRow) {
  const status = normalizeText(item.followup_status);

  if (status === "prompt_sent") {
    return "ainda falta retorno após o atendimento";
  }

  return formatFollowupStatus(item.followup_status);
}

function buildPostAppointmentTypeAndTitle(appointment: AppointmentRow | undefined) {
  if (!appointment) return "atendimento";
  const typeLabel = formatAppointmentType(appointment.appointment_type);
  const titleLabel = appointment.title ? ` ${appointment.title}` : "";
  return `${typeLabel}${titleLabel}`.trim();
}


function isOpenScheduleAppointment(item: AppointmentRow | null | undefined) {
  if (!item) return false;
  const status = normalizeText(item.status);
  return status === "scheduled" || status === "rescheduled";
}

function sortOpenScheduleAppointments(items: AppointmentRow[]) {
  const unique = new Map<string, AppointmentRow>();

  for (const item of items || []) {
    if (!item?.id) continue;
    if (!isOpenScheduleAppointment(item)) continue;
    unique.set(item.id, item);
  }

  return [...unique.values()].sort((a, b) => {
    const nowTime = Date.now();
    const aEnd = a.scheduled_end ? new Date(a.scheduled_end).getTime() : Number.MAX_SAFE_INTEGER;
    const bEnd = b.scheduled_end ? new Date(b.scheduled_end).getTime() : Number.MAX_SAFE_INTEGER;
    const aStart = a.scheduled_start ? new Date(a.scheduled_start).getTime() : Number.MAX_SAFE_INTEGER;
    const bStart = b.scheduled_start ? new Date(b.scheduled_start).getTime() : Number.MAX_SAFE_INTEGER;

    const aOverdue = Number.isFinite(aEnd) && aEnd < nowTime;
    const bOverdue = Number.isFinite(bEnd) && bEnd < nowTime;

    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    if (aStart !== bStart) return aStart - bStart;
    return String(a.title || "").localeCompare(String(b.title || ""), "pt-BR");
  });
}

function buildScheduleAppointmentReferenceLabel(appointment?: AppointmentRow) {
  if (!appointment) return "compromisso";
  const typeLabel = formatAppointmentType(appointment.appointment_type);
  const titleLabel = String(appointment.title || "").trim();
  return titleLabel ? `${typeLabel} ${titleLabel}` : typeLabel;
}

function formatScheduleAppointmentCurrentSituation(appointment: AppointmentRow) {
  const statusLabel = formatAppointmentStatus(appointment.status);
  const endTime = appointment.scheduled_end || appointment.scheduled_start;

  if (normalizeText(appointment.status) === "rescheduled") {
    return endTime
      ? `remarcado para ${formatDateOnly(endTime)} às ${formatTimeOnly(endTime)}`
      : "remarcado";
  }

  if (appointment.scheduled_end && new Date(appointment.scheduled_end).getTime() < Date.now()) {
    return "ainda está em aberto e já passou do horário";
  }

  if (endTime) {
    return `em aberto para ${formatDateOnly(endTime)} às ${formatTimeOnly(endTime)}`;
  }

  return statusLabel;
}

function buildAppointmentDateMismatchAlternativesReply(args: {
  requestedDateParts: { day: number; month: number; year: number };
  requestedTimeLabel?: string | null;
  candidateIndexes: number[];
  openAppointments: AppointmentRow[];
  scheduleSettings?: StoreScheduleSettingsRow | null;
}) {
  const lines: string[] = [];
  const requestedDateLabel = formatDatePartsForHuman(args.requestedDateParts);
  const targetTime = args.requestedTimeLabel ? ` às ${args.requestedTimeLabel}` : "";

  lines.push(`Não encontrei uma visita ou compromisso desse cliente marcado para ${requestedDateLabel}.`);
  lines.push("");
  lines.push("Encontrei estes compromissos próximos na agenda:");

  args.candidateIndexes.slice(0, 5).forEach((candidateIndex) => {
    const appointment = args.openAppointments[candidateIndex];
    const referenceLabel = buildScheduleAppointmentReferenceLabel(appointment);
    const customer = appointment?.customer_name || "cliente não identificado";
    const start = appointment?.scheduled_start || appointment?.scheduled_end;
    const end = appointment?.scheduled_end;
    const timeRange = start
      ? `${formatDateOnly(start)} das ${formatTimeOnly(start)}${end ? ` às ${formatTimeOnly(end)}` : ""}`
      : "sem horário carregado";

    lines.push(`${candidateIndex + 1}. ${referenceLabel.charAt(0).toUpperCase() + referenceLabel.slice(1)} — ${customer} — ${timeRange}`);
  });

  lines.push("");
  lines.push(`Me diga o número do item da lista que você quer tentar remarcar para ${requestedDateLabel}${targetTime}.`);
  lines.push("Depois que você escolher, eu falo com o cliente antes de alterar a agenda.");

  return lines.join("\n").trim();
}

function splitNormalizedWords(value: string | null | undefined) {
  return normalizeText(value)
    .split(/[^a-z0-9]+/g)
    .map((word) => word.trim())
    .filter(Boolean);
}

function normalizedWordsContainSequence(textWords: string[], phraseWords: string[]) {
  if (!phraseWords.length || phraseWords.length > textWords.length) return false;
  for (let index = 0; index <= textWords.length - phraseWords.length; index += 1) {
    let matches = true;
    for (let offset = 0; offset < phraseWords.length; offset += 1) {
      if (textWords[index + offset] !== phraseWords[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

function isGenericAppointmentReference(value: string | null | undefined) {
  const words = splitNormalizedWords(value);
  if (!words.length) return true;
  if (words.length > 1) return false;
  const only = words[0];
  return ["teste", "test", "visita", "compromisso", "agendamento", "atendimento"].includes(only) || only.length < 4;
}

function hasExactPhraseByWords(text: string | null | undefined, phrase: string | null | undefined) {
  const textWords = splitNormalizedWords(text);
  const phraseWords = splitNormalizedWords(phrase);
  return normalizedWordsContainSequence(textWords, phraseWords);
}

function isSafeCustomerMentionInText(text: string, customerName: string | null | undefined) {
  const customerWords = splitNormalizedWords(customerName);
  if (!customerWords.length) return false;
  const textWords = splitNormalizedWords(text);

  if (!normalizedWordsContainSequence(textWords, customerWords)) return false;

  // Nome com duas ou mais palavras precisa aparecer exatamente como sequência.
  // Isso permite "Cliente Recusa Teste 2" e impede que o cliente genérico "teste"
  // capture uma mensagem que menciona outro cliente contendo a palavra teste.
  if (customerWords.length >= 2) return true;

  const only = customerWords[0];
  const normalized = normalizeText(text);
  if (isGenericAppointmentReference(only)) {
    return normalized === only || normalized.includes(`cliente ${only}`) || normalized.includes(`do cliente ${only}`);
  }

  return true;
}

function isSafeTitleMentionInText(text: string, title: string | null | undefined) {
  const titleWords = splitNormalizedWords(title);
  if (!titleWords.length) return false;
  const textWords = splitNormalizedWords(text);
  if (!normalizedWordsContainSequence(textWords, titleWords)) return false;

  if (titleWords.length >= 2) return true;

  const only = titleWords[0];
  const normalized = normalizeText(text);
  if (isGenericAppointmentReference(only)) {
    return normalized === only || normalized.includes(`titulo ${only}`) || normalized.includes(`título ${only}`);
  }

  return true;
}

function resolveAppointmentCandidateIndexesFromText(args: {
  text: string;
  openAppointments: AppointmentRow[];
}) {
  const rawText = String(args.text || "").trim();
  const normalizedText = normalizeText(rawText);
  const digitText = normalizeDigits(rawText);

  if (!normalizedText) return [] as number[];

  const phoneMatches: number[] = [];
  const customerMatches: number[] = [];
  const titleMatches: number[] = [];
  const strongContextMatches: number[] = [];
  const typeMatches: number[] = [];

  args.openAppointments.forEach((appointment, index) => {
    const phoneDigits = normalizeDigits(appointment.customer_phone);
    if (phoneDigits.length >= 8 && digitText && digitText.includes(phoneDigits)) {
      phoneMatches.push(index);
    }

    const customerName = appointment.customer_name || "";
    const customerNameNormalized = normalizeText(customerName);
    const safeCustomerMention = isSafeCustomerMentionInText(rawText, customerName);
    if (customerNameNormalized && safeCustomerMention) {
      customerMatches.push(index);
    }

    const title = appointment.title || "";
    const titleNormalized = normalizeText(title);
    const safeTitleMention = isSafeTitleMentionInText(rawText, title);
    if (titleNormalized && safeTitleMention) {
      titleMatches.push(index);
    }

    const typeCode = normalizeText(appointment.appointment_type);
    const typeLabel = normalizeText(formatAppointmentType(appointment.appointment_type));

    const mentionsInstallation =
      normalizedText.includes("instalacao") ||
      normalizedText.includes("instalação");
    const mentionsVisit =
      normalizedText.includes("visita tecnica") ||
      normalizedText.includes("visita técnica") ||
      normalizedText.includes("visita");
    const mentionsMaintenance =
      normalizedText.includes("manutencao") ||
      normalizedText.includes("manutenção");
    const mentionsMeeting =
      normalizedText.includes("reuniao") ||
      normalizedText.includes("reunião");
    const mentionsMeasurement =
      normalizedText.includes("medicao") ||
      normalizedText.includes("medição");

    if (mentionsInstallation && (typeCode === "installation" || typeLabel.includes("instalacao") || typeLabel.includes("instalação"))) {
      typeMatches.push(index);
    }

    if (mentionsVisit && (typeCode === "technical_visit" || typeLabel.includes("visita"))) {
      typeMatches.push(index);
    }

    if (mentionsMaintenance && (typeCode === "maintenance" || typeLabel.includes("manutencao") || typeLabel.includes("manutenção"))) {
      typeMatches.push(index);
    }

    if (mentionsMeeting && (typeCode === "meeting" || typeLabel.includes("reuniao") || typeLabel.includes("reunião"))) {
      typeMatches.push(index);
    }

    if (mentionsMeasurement && (typeCode === "measurement" || typeLabel.includes("medicao") || typeLabel.includes("medição"))) {
      typeMatches.push(index);
    }

    if (
      customerNameNormalized &&
      safeCustomerMention &&
      (
        normalizedText.includes("cliente") ||
        normalizedText.includes("visita") ||
        normalizedText.includes("compromisso") ||
        normalizedText.includes("agendamento") ||
        normalizedText.includes("instalacao") ||
        normalizedText.includes("instalação") ||
        normalizedText.includes("manutencao") ||
        normalizedText.includes("manutenção")
      )
    ) {
      strongContextMatches.push(index);
    }

    if (titleNormalized && safeTitleMention) {
      strongContextMatches.push(index);
    }
  });

  const dedup = (values: number[]) => [...new Set(values)];

  if (phoneMatches.length) return dedup(phoneMatches);
  if (strongContextMatches.length) return dedup(strongContextMatches);
  if (customerMatches.length && typeMatches.length) {
    const intersection = dedup(customerMatches.filter((index) => typeMatches.includes(index)));
    if (intersection.length) return intersection;
  }
  if (customerMatches.length) return dedup(customerMatches);
  if (titleMatches.length) return dedup(titleMatches);
  if (typeMatches.length) return dedup(typeMatches);
  return [] as number[];
}

function inferPreviousAppointmentTarget(args: {
  messages: AssistantMessageRow[];
  currentHumanMessage: string;
  openAppointments: AppointmentRow[];
}) {
  const ordered = [...args.messages]
    .filter((message) => getMessageContent(message).length > 0)
    .map((message) => getMessageContent(message))
    .filter((content) => content !== args.currentHumanMessage);

  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const content = ordered[index];
    const explicitScheduleIndex = resolveExplicitAppointmentItemIndex(content, args.openAppointments.length);
    if (explicitScheduleIndex !== null) {
      return { type: "unique" as const, index: explicitScheduleIndex };
    }

    const explicitIndex = resolvePostAppointmentDetailIndex(content, args.openAppointments.length);
    if (explicitIndex !== null) {
      return { type: "unique" as const, index: explicitIndex };
    }

    const candidateIndexes = resolveAppointmentCandidateIndexesFromText({
      text: content,
      openAppointments: args.openAppointments,
    });

    if (candidateIndexes.length === 1) {
      return { type: "unique" as const, index: candidateIndexes[0] };
    }

    if (candidateIndexes.length > 1) {
      return { type: "ambiguous" as const, candidateIndexes };
    }
  }

  return null;
}

function buildAppointmentAmbiguityReply(args: {
  candidateIndexes: number[];
  openAppointments: AppointmentRow[];
  scheduleSettings?: StoreScheduleSettingsRow | null;
}) {
  const lines: string[] = [];
  lines.push("Encontrei mais de um compromisso em aberto para esse pedido.");
  lines.push("Me diga qual deles você quer atualizar:");
  lines.push("");

  args.candidateIndexes.slice(0, 5).forEach((candidateIndex) => {
    const appointment = args.openAppointments[candidateIndex];
    const itemNumber = candidateIndex + 1;
    const referenceLabel = buildScheduleAppointmentReferenceLabel(appointment);
    const customer = appointment?.customer_name || "cliente não identificado";
    const timeLabel = formatAppointmentRangeInTimeZone({ appointment, scheduleSettings: args.scheduleSettings || null });

    lines.push(`${itemNumber}. ${referenceLabel.charAt(0).toUpperCase() + referenceLabel.slice(1)}`);
    lines.push(`- cliente: ${customer}`);
    lines.push(`- horário: ${timeLabel}`);
    lines.push(`- situação atual: ${formatScheduleAppointmentCurrentSituation(appointment)}`);
    lines.push("");
  });

  lines.push('Você pode responder, por exemplo: "remarque o item 2 para amanhã às 15:00".');
  return lines.join("\n").trim();
}

async function loadAppointmentByIdForAssistantAction(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  appointmentId: string;
}) {
  const appointmentId = String(args.appointmentId || "").trim();
  if (!appointmentId) return null as AppointmentRow | null;

  const { data, error } = await args.supabase
    .from("store_appointments")
    .select("id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id, commercial_opportunity_id")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("id", appointmentId)
    .maybeSingle();

  if (error || !data) return null as AppointmentRow | null;
  return data as AppointmentRow;
}

function readAssistantContextPayload(contextState?: StoreAssistantContextStateRow | null) {
  const raw = contextState?.context_payload;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function appointmentHasCustomerInvolved(appointment?: AppointmentRow | null) {
  return Boolean(appointment && (
    String(appointment.customer_name || "").trim() || String(appointment.customer_phone || "").trim() ||
    String(appointment.lead_id || "").trim() || String(appointment.conversation_id || "").trim()
  ));
}

function buildCommercialTargetFromAppointment(
  appointment: AppointmentRow | null | undefined,
  source: string
): CommercialTargetForSideEffect | null {
  if (!appointment?.id) return null;
  return {
    source,
    appointmentId: appointment.id,
    leadId: appointment.lead_id || null,
    conversationId: appointment.conversation_id || null,
    commercialOpportunityId: appointment.commercial_opportunity_id || null,
    customerName: appointment.customer_name || null,
  };
}

function buildCommercialTargetFromTask(
  task: StoreAssistantOperationalTaskRow | null | undefined,
  source: string
): CommercialTargetForSideEffect | null {
  if (!task?.id) return null;
  return {
    source,
    taskId: task.id,
    appointmentId: task.related_appointment_id || null,
    leadId: task.related_lead_id || null,
    conversationId: task.related_conversation_id || null,
    commercialOpportunityId: task.commercial_opportunity_id || null,
    customerName: task.customer_name || null,
  };
}

function buildCommercialTargetFromIdentityCandidate(
  candidate: AssistantCustomerIdentityCandidate | null | undefined,
  source: string
): CommercialTargetForSideEffect | null {
  if (!candidate?.lead_id && !candidate?.conversation_id && !candidate?.commercial_opportunity_id) return null;
  return {
    source,
    leadId: candidate.lead_id || null,
    conversationId: candidate.conversation_id || null,
    commercialOpportunityId: candidate.commercial_opportunity_id || null,
    customerName: candidate.customer_name || null,
  };
}

function assertCommercialTargetForSideEffect(args: {
  target: CommercialTargetForSideEffect | null;
  sideEffect: string;
  expectedConversationId?: string | null;
  expectedCommercialOpportunityId?: string | null;
}) {
  const target = args.target;
  if (!target) {
    return { ok: false as const, reason: "missing_canonical_target" };
  }

  const hasCanonicalReference = Boolean(
    target.appointmentId ||
    target.taskId ||
    target.leadId ||
    target.conversationId
  );

  if (!hasCanonicalReference) {
    return { ok: false as const, reason: "missing_canonical_reference" };
  }

  const expectedConversationId = String(args.expectedConversationId || "").trim();
  const targetConversationId = String(target.conversationId || "").trim();
  if (expectedConversationId && targetConversationId !== expectedConversationId) {
    return { ok: false as const, reason: "conversation_mismatch" };
  }

  const expectedOpportunityId = String(args.expectedCommercialOpportunityId || "").trim();
  const targetOpportunityId = String(target.commercialOpportunityId || "").trim();
  if (expectedOpportunityId && targetOpportunityId !== expectedOpportunityId) {
    return { ok: false as const, reason: "commercial_opportunity_mismatch" };
  }

  return { ok: true as const, target };
}

const CUSTOMER_IDENTITY_DISAMBIGUATION_TTL_MS = 30 * 60 * 1000;

function isActiveCustomerIdentityDisambiguationContext(contextState?: StoreAssistantContextStateRow | null) {
  return Boolean(
    contextState &&
    normalizeText(contextState.active_topic || "") === "customer_identity_disambiguation" &&
    normalizeText(contextState.active_status || "") === "waiting_user_choice"
  );
}

export function buildCustomerIdentityDisambiguationExpiresAt(now = new Date()) {
  return new Date(now.getTime() + CUSTOMER_IDENTITY_DISAMBIGUATION_TTL_MS).toISOString();
}

export function isAssistantContextExpired(contextState?: StoreAssistantContextStateRow | null, now = new Date()) {
  const expiresAt = String(contextState?.expires_at || "").trim();
  if (!expiresAt) return isActiveCustomerIdentityDisambiguationContext(contextState);
  const expiresMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiresMs)) return isActiveCustomerIdentityDisambiguationContext(contextState);
  return expiresMs <= now.getTime();
}

function isCompatibleIdentityDisambiguationContext(contextState?: StoreAssistantContextStateRow | null) {
  if (!contextState) return true;
  const status = normalizeText(contextState.active_status || "");
  const topic = normalizeText(contextState.active_topic || "");
  if (!status || status === "resolved") return true;
  return topic === "customer_identity_disambiguation";
}

function buildCustomerCancellationMessage(args: { appointment: AppointmentRow; scheduleSettings?: StoreScheduleSettingsRow | null; reasonText?: string | null; }) {
  const appointment = args.appointment;
  const customerName = String(appointment.customer_name || "").trim() || "tudo bem";
  const timeZone = getScheduleTimezone(args.scheduleSettings || null);
  const scheduledDate = formatDateOnlyInTimeZone(appointment.scheduled_start || appointment.scheduled_end, timeZone);
  const scheduledTime = formatTimeOnlyInTimeZone(appointment.scheduled_start || appointment.scheduled_end, timeZone);
  const reasonText = String(args.reasonText || "").trim();
  const reasonSuffix = reasonText ? ` Motivo: ${reasonText}.` : "";
  return `Oi, ${customerName}. Passando para avisar que sua ${formatAppointmentType(appointment.appointment_type)} do dia ${scheduledDate} às ${scheduledTime} foi cancelada.${reasonSuffix} Se precisar, podemos combinar um novo horário.`;
}

function buildCancelOrRescheduleDecisionPrompt(args: { appointment: AppointmentRow; scheduleSettings?: StoreScheduleSettingsRow | null; }) {
  const appointment = args.appointment;
  const referenceLabel = buildScheduleAppointmentReferenceLabel(appointment);
  const timeLabel = formatAppointmentStartInTimeZone({ value: appointment.scheduled_start || appointment.scheduled_end || null, scheduleSettings: args.scheduleSettings || null });
  return `Encontrei este compromisso:\n\n${referenceLabel.charAt(0).toUpperCase() + referenceLabel.slice(1)}\nCliente: ${appointment.customer_name || "cliente não identificado"}\nData e horário: ${timeLabel}\n\nAntes de alterar a agenda, me diga como prefere seguir:\n\n1. Cancelar esse compromisso.\n2. Remarcar para outro dia ou horário.\n\nSe a escolha for cancelar, quer que eu explique algum motivo ao cliente ou envio apenas um aviso simples de cancelamento?`;
}

function isWaitingForCustomerCancelDecision(contextState?: StoreAssistantContextStateRow | null) {
  const contextTopic = normalizeText(contextState?.active_topic || "");
  const contextIntent = normalizeText(contextState?.active_intent || "");
  const contextStatus = normalizeText(contextState?.active_status || "");
  const payload = readAssistantContextPayload(contextState);
  const payloadReason = normalizeText(String(payload.reason || ""));
  const payloadPhase = normalizeText(String(payload.phase || payload.decision_step || ""));

  return contextTopic === "appointment_management" &&
    contextIntent === "cancel" &&
    (contextStatus === "waiting_cancel_decision" || contextStatus === "waiting_user_choice") &&
    (
      payloadReason === "cancel_requires_reschedule_or_customer_notice_decision" ||
      payloadPhase === "cancel_or_reschedule_decision" ||
      Boolean(contextState?.active_appointment_id || payload.appointment_id)
    );
}

function isHumanCancellationAbortOrHold(text: string) {
  const t = normalizeText(String(text || "").trim());
  if (!t) return null as null | "abort" | "hold";

  if (hasAnyTerm(t, [
    "nao cancela",
    "não cancela",
    "nao cancelar",
    "não cancelar",
    "nao cancele",
    "não cancele",
    "nao mexe",
    "não mexe",
    "nao altera",
    "não altera",
    "nao altere",
    "não altere",
    "deixa quieto",
    "deixe quieto",
    "deixa como esta",
    "deixa como está",
    "mantem como esta",
    "mantém como está",
    "mantem na agenda",
    "mantém na agenda",
    "esquece",
    "deixa pra la",
    "deixa pra lá",
  ])) return "abort";

  if (hasAnyTerm(t, [
    "espera",
    "espere",
    "calma",
    "ainda nao",
    "ainda não",
    "por enquanto nao",
    "por enquanto não",
    "depois eu vejo",
    "depois confirmo",
    "vou ver",
    "preciso confirmar",
    "segura",
    "pausa",
    "aguarda",
    "aguarde",
  ])) return "hold";

  return null;
}

function wantsToCancelAfterPrompt(text: string) {
  const raw = String(text || "").trim();
  const t = normalizeText(raw);
  if (!t) return false;
  if (isHumanCancellationAbortOrHold(raw)) return false;
  if (/^1(?:\D|$)/.test(t)) return true;

  const hasCancelIntent = hasAnyTerm(t, [
    "cancelar",
    "cancela",
    "cancele",
    "cancelado",
    "cancelamento",
    "apenas cancelar",
    "so cancelar",
    "só cancelar",
    "cancelar definitivamente",
    "pode cancelar",
    "pode cancelar sim",
    "pode sim cancelar",
    "cancela sim",
    "cancele sim",
    "confirmo o cancelamento",
    "autorizo o cancelamento",
    "faz o cancelamento",
    "fazer o cancelamento",
    "segue com o cancelamento",
    "pode seguir com o cancelamento",
    "cancela e avisa",
    "cancele e avise",
    "cancela e fala",
    "cancele e fale",
    "cancela e explica",
    "cancele e explique",
    "diga que foi cancelado",
    "avisa que foi cancelado",
    "avise que foi cancelado",
    "nao vamos atender",
    "não vamos atender",
    "nao vamos fazer",
    "não vamos fazer",
    "nao vamos mais atender",
    "não vamos mais atender",
    "nao vamos mais fazer negocio",
    "não vamos mais fazer negocio",
    "não vamos mais fazer negócio",
    "deixa pra la esse atendimento",
    "deixa pra lá esse atendimento",
    "encerra esse atendimento",
  ]);

  const hasRescheduleIntent = hasAnyTerm(t, [
    "remarcar",
    "remarque",
    "remarca",
    "reagendar",
    "reagende",
    "reagenda",
    "outro horario",
    "outro horário",
    "novo horario",
    "novo horário",
    "mudar horario",
    "mudar horário",
    "muda pra",
    "mudar para",
  ]);

  return hasCancelIntent && !hasRescheduleIntent;
}

function wantsToRescheduleAfterPrompt(text: string) {
  const raw = String(text || "").trim();
  const t = normalizeText(raw);
  if (!t) return false;
  if (isHumanCancellationAbortOrHold(raw)) return false;
  if (/^2(?:\D|$)/.test(t)) return true;

  const hasRescheduleIntent = hasAnyTerm(t, [
    "remarcar",
    "remarque",
    "remarca",
    "reagendar",
    "reagende",
    "reagenda",
    "outro horario",
    "outro horário",
    "novo horario",
    "novo horário",
    "mudar horario",
    "mudar horário",
    "muda pra",
    "mudar para",
    "trocar horario",
    "trocar horário",
    "tenta outro dia",
    "pergunta outro dia",
    "pergunta se pode",
    "ve se pode",
    "vê se pode",
    "nao cancela remarca",
    "não cancela remarca",
    "melhor remarcar",
  ]);

  const hasCancelOnlyIntent = hasAnyTerm(t, [
    "cancelar definitivamente",
    "apenas cancelar",
    "so cancelar",
    "só cancelar",
    "cancela e avisa",
    "cancele e avise",
    "cancela e fala",
    "cancele e fale",
  ]);

  return hasRescheduleIntent && !hasCancelOnlyIntent;
}



function cancellationCommandHasSpecificAppointmentTarget(args: {
  text: string;
  openAppointments: AppointmentRow[];
  contextState?: StoreAssistantContextStateRow | null;
}) {
  const raw = String(args.text || "").trim();
  const normalized = normalizeText(raw);
  if (!normalized) return false;

  if (isWaitingForCustomerCancelDecision(args.contextState || null)) return true;
  if (isPlainAssistantOptionChoice(raw)) return true;
  if (resolveExplicitAppointmentItemIndex(raw, Math.max(args.openAppointments.length, 1)) !== null) return true;
  if (resolvePostAppointmentDetailIndex(raw, Math.max(args.openAppointments.length, 1)) !== null) return true;
  if (extractExplicitAppointmentTitleCandidateFromCommand(raw)) return true;

  const dateParts = parseDateReferenceFromText(raw, getScheduleParsingNow(null));
  const timeRange = parseTimeRangeFromText(raw);
  if (dateParts || timeRange?.startTime) return true;

  const digitText = normalizeDigits(raw);
  if (digitText.length >= 8) return true;

  const directMatches = resolveAppointmentCandidateIndexesFromText({
    text: raw,
    openAppointments: args.openAppointments || [],
  });
  if (directMatches.length > 0) return true;

  return false;
}

function buildUnsafeCancellationWithoutTargetReply() {
  return "Me diga qual compromisso você quer cancelar, informando o nome do cliente, o título, a data/horário ou escolhendo um item da lista. Assim eu evito alterar o compromisso errado.";
}


function assistantRecentlyAskedForCancellationTarget(args: { recentMessages: AssistantMessageRow[]; currentHumanMessage: string }) {
  const current = String(args.currentHumanMessage || "").trim();
  let skippedCurrent = false;

  for (let index = (args.recentMessages || []).length - 1; index >= 0; index -= 1) {
    const message = args.recentMessages[index];
    const content = getMessageContent(message).trim();
    if (!content) continue;

    const isHuman = isLikelyResponsibleMessage(message);
    if (!skippedCurrent && isHuman && content === current) {
      skippedCurrent = true;
      continue;
    }

    if (isAssistantOperationalMessage(message)) {
      const normalized = normalizeText(content);
      return normalized.includes("qual compromisso voce quer cancelar") ||
        normalized.includes("qual compromisso você quer cancelar") ||
        normalized.includes("evito alterar o compromisso errado");
    }
  }

  return false;
}

function findRecentHumanCancellationRequestBeforeCurrent(args: { recentMessages: AssistantMessageRow[]; currentHumanMessage: string }) {
  const current = String(args.currentHumanMessage || "").trim();
  let skippedCurrent = false;

  for (let index = (args.recentMessages || []).length - 1; index >= 0; index -= 1) {
    const message = args.recentMessages[index];
    const content = getMessageContent(message).trim();
    if (!content || !isLikelyResponsibleMessage(message)) continue;

    if (!skippedCurrent && content === current) {
      skippedCurrent = true;
      continue;
    }

    if (resolveScheduleAction(content) === "cancel" || wantsToCancelAfterPrompt(content)) {
      return content;
    }
  }

  return null as string | null;
}

function scoreAppointmentTargetSelectionFromText(args: { text: string; appointment: AppointmentRow; scheduleSettings?: StoreScheduleSettingsRow | null }) {
  const text = normalizeText(args.text);
  if (!text) return 0;

  const appointment = args.appointment;
  let score = 0;

  const title = normalizeText(appointment.title || "");
  if (title && title.length >= 3 && text.includes(title)) score += 10;

  const customerName = normalizeText(appointment.customer_name || "");
  if (customerName && customerName.length >= 3 && text.includes(customerName)) score += 6;

  const phoneDigits = normalizeDigits(appointment.customer_phone || "");
  const textDigits = normalizeDigits(args.text);
  if (phoneDigits.length >= 8 && textDigits.includes(phoneDigits)) score += 6;

  const start = appointment.scheduled_start || appointment.scheduled_end || null;
  if (start) {
    const timezone = getScheduleTimezone(args.scheduleSettings || null);
    const dateLabel = normalizeText(formatDateOnlyInTimeZone(start, timezone));
    const startTime = normalizeText(formatTimeOnlyInTimeZone(start, timezone));
    if (dateLabel && text.includes(dateLabel)) score += 3;
    if (startTime && text.includes(startTime)) score += 3;
  }

  const typeLabel = normalizeText(formatAppointmentType(appointment.appointment_type));
  if (typeLabel && text.includes(typeLabel)) score += 1;

  return score;
}

function resolveAppointmentTargetFromSelectionText(args: { text: string; openAppointments: AppointmentRow[]; scheduleSettings?: StoreScheduleSettingsRow | null }) {
  const ranked = (args.openAppointments || [])
    .filter((appointment) => appointment && ["scheduled", "rescheduled"].includes(normalizeText(appointment.status || "")))
    .map((appointment) => ({
      appointment,
      score: scoreAppointmentTargetSelectionFromText({ text: args.text, appointment, scheduleSettings: args.scheduleSettings || null }),
    }))
    .filter((item) => item.score >= 10)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) return null as AppointmentRow | null;
  if (ranked.length === 1) return ranked[0].appointment;
  if (ranked[0].score > ranked[1].score) return ranked[0].appointment;
  return null as AppointmentRow | null;
}

async function resolveCancellationTargetSelectionAfterUnsafePrompt(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  threadId?: string | null;
  assistantContextState?: StoreAssistantContextStateRow | null;
  lastHumanMessage: string;
  recentMessages: AssistantMessageRow[];
  openAppointments: AppointmentRow[];
  scheduleSettings?: StoreScheduleSettingsRow | null;
}) {
  const previousCancellationRequest = findRecentHumanCancellationRequestBeforeCurrent({
    recentMessages: args.recentMessages || [],
    currentHumanMessage: args.lastHumanMessage,
  });

  if (!previousCancellationRequest) return null;

  const assistantAskedForTarget = assistantRecentlyAskedForCancellationTarget({
    recentMessages: args.recentMessages || [],
    currentHumanMessage: args.lastHumanMessage,
  });

  if (!assistantAskedForTarget) return null;

  const selectedAppointment = resolveAppointmentTargetFromSelectionText({
    text: args.lastHumanMessage,
    openAppointments: args.openAppointments || [],
    scheduleSettings: args.scheduleSettings || null,
  });

  if (!selectedAppointment) {
    return buildUnsafeCancellationWithoutTargetReply();
  }

  return executeConfirmedCustomerAppointmentCancellation({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    threadId: args.threadId || null,
    assistantContextState: args.assistantContextState || null,
    lastHumanMessage: args.lastHumanMessage,
    appointment: selectedAppointment,
    scheduleSettings: args.scheduleSettings || null,
    reasonText: extractCancellationReasonFromDecision(previousCancellationRequest) || extractCancellationReasonFromDecision(args.lastHumanMessage),
  });
}


function isAwaitingCancellationTargetClarification(contextState?: StoreAssistantContextStateRow | null) {
  const payload = readAssistantContextPayload(contextState || null);
  return normalizeText(contextState?.active_topic || "") === "appointment_management" &&
    normalizeText(contextState?.active_intent || "") === "cancel" &&
    normalizeText(contextState?.active_status || "") === "waiting_user_choice" &&
    normalizeText(String(payload.phase || payload.decision_step || "")) === "awaiting_cancel_target";
}

function isCorrectionAboutWrongAppointment(text: string) {
  const normalized = normalizeText(text);
  return hasAnyTerm(normalized, [
    "nao era esse", "não era esse", "nao e esse", "não é esse", "era o outro", "e o outro", "é o outro",
    "esse nao", "esse não", "o compromisso certo", "o cliente certo", "nao queria esse", "não queria esse",
  ]);
}

async function loadOpenAppointmentsForAssistantTargetLookup(args: { supabase: any; organizationId: string; storeId: string; }) {
  const { data, error } = await args.supabase
    .from("store_appointments")
    .select("id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id, commercial_opportunity_id")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .in("status", ["scheduled", "rescheduled"])
    .order("scheduled_start", { ascending: true })
    .limit(250);

  if (error) return [] as AppointmentRow[];
  return (data || []) as AppointmentRow[];
}

async function resolvePendingCancellationTargetClarificationReply(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  threadId?: string | null;
  assistantContextState?: StoreAssistantContextStateRow | null;
  lastHumanMessage: string;
  scheduleSettings?: StoreScheduleSettingsRow | null;
}) {
  const contextState = args.assistantContextState || null;
  if (!isAwaitingCancellationTargetClarification(contextState)) return null;

  const text = String(args.lastHumanMessage || "").trim();
  const explicitAction = resolveScheduleAction(text);
  if (explicitAction && explicitAction !== "cancel") return null;
  if (!text) return buildUnsafeCancellationWithoutTargetReply();

  if (isCorrectionAboutWrongAppointment(text)) {
    const reply = "Tudo bem, não alterei mais nada. Me diga qual compromisso você quer cancelar, informando o nome completo do cliente, o título, a data/horário ou escolhendo um item da lista.";
    if (args.threadId) await upsertAssistantContextState({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      threadId: args.threadId,
      currentContextState: contextState,
      patch: { last_user_message: args.lastHumanMessage, last_assistant_message: reply },
    });
    return reply;
  }

  const openAppointments = await loadOpenAppointmentsForAssistantTargetLookup({ supabase: args.supabase, organizationId: args.organizationId, storeId: args.storeId });
  const candidateIndexes = resolveAppointmentCandidateIndexesFromText({ text, openAppointments });

  if (candidateIndexes.length === 1) {
    const appointment = openAppointments[candidateIndexes[0]];
    return startCustomerAppointmentCancelDecision({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      threadId: args.threadId || null,
      assistantContextState: contextState,
      lastHumanMessage: args.lastHumanMessage,
      appointment,
      scheduleSettings: args.scheduleSettings || null,
    });
  }

  if (candidateIndexes.length > 1) {
    const candidateOptions = buildAppointmentCandidateOptions({ candidateIndexes, openAppointments });
    if (args.threadId) await upsertAssistantContextState({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      threadId: args.threadId,
      currentContextState: contextState,
      patch: {
        active_topic: "appointment_management",
        active_intent: "cancel",
        active_status: "waiting_user_choice",
        candidate_options: candidateOptions,
        context_payload: {
          ...readAssistantContextPayload(contextState),
          phase: "awaiting_cancel_target",
          reason: "cancel_target_ambiguity",
          original_cancel_request: readAssistantContextPayload(contextState).original_cancel_request || contextState?.last_user_message || null,
        },
        last_user_message: args.lastHumanMessage,
      },
    });
    return buildAppointmentAmbiguityReply({ candidateIndexes, openAppointments, scheduleSettings: args.scheduleSettings || null });
  }

  const reply = "Não encontrei esse compromisso com segurança. Me diga o nome completo do cliente, o título do compromisso ou a data e o horário. Não alterei nada na agenda.";
  if (args.threadId) await upsertAssistantContextState({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    threadId: args.threadId,
    currentContextState: contextState,
    patch: { last_user_message: args.lastHumanMessage, last_assistant_message: reply },
  });
  return reply;
}

function extractCancellationReasonFromDecision(text: string) {
  const raw = String(text || "").trim();
  const normalized = normalizeText(raw);
  if (!raw || hasAnyTerm(normalized, [
    "sem motivo",
    "aviso simples",
    "simples",
    "sem explicar",
    "nao precisa",
    "não precisa",
    "nao precisa explicar",
    "não precisa explicar",
    "sem detalhes",
    "sem dar detalhes",
    "apenas avise",
    "so avise",
    "só avise",
    "avisa simples",
    "avise simples",
  ])) return null;

  const explicit = raw.match(/(?:motivo|porque|pois|explique que|diga que|fale que|fala que|informe que|avise que|explica que)\s*[:\-]?\s*(.+)$/i);
  const value = explicit?.[1]?.trim().replace(/[.\s]+$/, "") || null;
  if (value) return value;

  const normalizedHasCancel = wantsToCancelAfterPrompt(raw);
  if (!normalizedHasCancel) return null;

  const afterComma = raw.split(/[,;:]/).slice(1).join(" ").trim().replace(/[.\s]+$/, "");
  if (afterComma && afterComma.length >= 8 && !hasAnyTerm(normalizeText(afterComma), ["aviso simples", "sem explicar", "sem motivo"])) {
    return afterComma;
  }

  return null;
}

async function startCustomerAppointmentCancelDecision(args: { supabase: any; organizationId: string; storeId: string; threadId?: string | null; assistantContextState?: StoreAssistantContextStateRow | null; lastHumanMessage: string; appointment: AppointmentRow; scheduleSettings?: StoreScheduleSettingsRow | null; }) {
  const scheduleTimezone = getScheduleTimezone(args.scheduleSettings || null);
  const prompt = buildCancelOrRescheduleDecisionPrompt({ appointment: args.appointment, scheduleSettings: args.scheduleSettings || null });
  if (args.threadId) await upsertAssistantContextState({
    supabase: args.supabase, organizationId: args.organizationId, storeId: args.storeId, threadId: args.threadId,
    currentContextState: args.assistantContextState || null,
    patch: {
      active_topic: "appointment_management", active_intent: "cancel", active_status: "waiting_user_choice",
      active_customer_name: args.appointment.customer_name || null, active_customer_phone: args.appointment.customer_phone || null,
      active_lead_id: args.appointment.lead_id || null, active_conversation_id: args.appointment.conversation_id || null,
      active_appointment_id: args.appointment.id,
      target_date: args.appointment.scheduled_start ? isoDateToLocalDateForDb(args.appointment.scheduled_start, scheduleTimezone) : null,
      target_time: args.appointment.scheduled_start ? formatTimeOnlyInTimeZone(args.appointment.scheduled_start, scheduleTimezone) : null,
      target_start_at: args.appointment.scheduled_start || null, target_end_at: args.appointment.scheduled_end || null,
      timezone_name: scheduleTimezone, candidate_options: [],
      context_payload: {
        reason: "cancel_requires_reschedule_or_customer_notice_decision",
        phase: "cancel_or_reschedule_decision",
        appointment_id: args.appointment.id,
        appointment_title: args.appointment.title || null,
        appointment_type: args.appointment.appointment_type || null,
        customer_name: args.appointment.customer_name || null,
        customer_phone: args.appointment.customer_phone || null,
        lead_id: args.appointment.lead_id || null,
        conversation_id: args.appointment.conversation_id || null,
        scheduled_start: args.appointment.scheduled_start || null,
        scheduled_end: args.appointment.scheduled_end || null,
        timezone_name: scheduleTimezone,
      },
      last_user_message: args.lastHumanMessage, last_assistant_message: prompt,
    },
  });
  return prompt;
}

async function executeConfirmedCustomerAppointmentCancellation(args: { supabase: any; organizationId: string; storeId: string; threadId?: string | null; assistantContextState?: StoreAssistantContextStateRow | null; lastHumanMessage: string; appointment: AppointmentRow; scheduleSettings?: StoreScheduleSettingsRow | null; reasonText?: string | null; }) {
  const appointment = args.appointment;
  const targetAssertion = assertCommercialTargetForSideEffect({
    target: buildCommercialTargetFromAppointment(appointment, "confirmed_customer_appointment_cancellation"),
    sideEffect: "cancel_store_appointment",
  });
  if (!targetAssertion.ok) {
    return "Identifiquei o compromisso, mas o alvo comercial não está canonicamente resolvido. Não cancelei nada.";
  }

  const { error: cancelError } = await args.supabase.rpc("cancel_store_appointment", { p_appointment_id: appointment.id, p_organization_id: args.organizationId, p_store_id: args.storeId, p_cancel_reason: "Cancelado pelo responsável na assistente operacional." });
  if (cancelError) return `Tentei cancelar esse compromisso, mas encontrei um erro: ${cancelError.message}`;

  let customerMessageSent = false, customerMessageError: string | null = null;
  if (appointment.conversation_id) {
    const sendResult = await sendAiMessageToCustomerConversation({
      supabase: args.supabase,
      conversationId: appointment.conversation_id,
      text: buildCustomerCancellationMessage({ appointment, scheduleSettings: args.scheduleSettings || null, reasonText: args.reasonText || null }),
      target: buildCommercialTargetFromAppointment(appointment, "confirmed_customer_appointment_cancellation"),
    });
    customerMessageSent = sendResult.ok;
    customerMessageError = sendResult.ok ? null : sendResult.error;
  }

  const referenceLabel = buildScheduleAppointmentReferenceLabel(appointment);
  const customerName = appointment.customer_name || "cliente não identificado";
  const timeLabel = formatAppointmentStartInTimeZone({ value: appointment.scheduled_start || appointment.scheduled_end || null, scheduleSettings: args.scheduleSettings || null, timezoneName: args.assistantContextState?.timezone_name || null });
  const responsibleReply = appointment.conversation_id
    ? (customerMessageSent ? `Pronto. Cancelei ${referenceLabel} de ${customerName}, agendada para ${timeLabel}, e avisei o cliente.` : `Cancelei ${referenceLabel} de ${customerName}, agendada para ${timeLabel}, mas não consegui avisar o cliente automaticamente. Erro: ${customerMessageError || "canal indisponível"}.`)
    : `Pronto. Cancelei ${referenceLabel} de ${customerName}, agendada para ${timeLabel}. Não encontrei conversa vinculada para avisar o cliente automaticamente.`;

  if (args.threadId) {
    const contextResult = await resolveAssistantContextState({ supabase: args.supabase, organizationId: args.organizationId, storeId: args.storeId, threadId: args.threadId, currentContextState: args.assistantContextState || null, lastUserMessage: args.lastHumanMessage, lastAssistantMessage: responsibleReply });
    if (!contextResult.ok) {
      return `${responsibleReply} A operação foi concluída, mas não consegui fechar o contexto da Assistente: ${contextResult.error || "erro desconhecido"}. Reconciliação necessária.`;
    }
  }
  return responsibleReply;
}

async function handlePendingCustomerCancelDecision(args: { supabase: any; organizationId: string; storeId: string; threadId?: string | null; assistantContextState?: StoreAssistantContextStateRow | null; lastHumanMessage: string; scheduleSettings?: StoreScheduleSettingsRow | null; }) {
  const contextState = args.assistantContextState || null;
  if (!isWaitingForCustomerCancelDecision(contextState)) return null;

  const explicitAction = resolveScheduleAction(args.lastHumanMessage);
  if (explicitAction && explicitAction !== "cancel") return null;

  const appointmentId = String(contextState?.active_appointment_id || readAssistantContextPayload(contextState).appointment_id || "").trim();
  if (!appointmentId) return "Eu estava aguardando sua decisão sobre cancelamento, mas perdi a referência do compromisso. Me diga o nome, cliente, data ou horário para eu procurar de novo.";

  const appointment = await loadAppointmentByIdForAssistantAction({ supabase: args.supabase, organizationId: args.organizationId, storeId: args.storeId, appointmentId });
  if (!appointment) return "Não encontrei mais esse compromisso na agenda. Atualize a tela ou me diga o cliente, data e horário para eu procurar de novo.";

  // Proteção forte contra contexto antigo: se a nova mensagem cita explicitamente
  // outro compromisso pelo nome/título, não podemos continuar usando o
  // appointment_id salvo no contexto anterior. Se o título citado for o mesmo
  // compromisso que está no contexto, a resposta continua sendo tratada como
  // continuação segura da decisão pendente.
  const explicitTitleFromCurrentMessage = extractExplicitAppointmentTitleCandidateFromCommand(args.lastHumanMessage);
  if (explicitTitleFromCurrentMessage && !appointmentTitleMatchesCommandTitle(appointment.title, explicitTitleFromCurrentMessage)) return null;

  const abortOrHoldDecision = isHumanCancellationAbortOrHold(args.lastHumanMessage);
  if (abortOrHoldDecision === "abort") {
    const reply = `Certo, não alterei a agenda. Mantive ${buildScheduleAppointmentReferenceLabel(appointment)} de ${appointment.customer_name || "cliente não identificado"} como está.`;
    if (args.threadId) await resolveAssistantContextState({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      threadId: args.threadId,
      currentContextState: contextState,
      lastUserMessage: args.lastHumanMessage,
      lastAssistantMessage: reply,
    });
    return reply;
  }

  if (abortOrHoldDecision === "hold") {
    if (args.threadId) await upsertAssistantContextState({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      threadId: args.threadId,
      currentContextState: contextState,
      patch: {
        last_user_message: args.lastHumanMessage,
        last_assistant_message: "Tudo bem. Não alterei a agenda. Quando quiser seguir, me diga se é para cancelar ou remarcar esse compromisso.",
      },
    });
    return "Tudo bem. Não alterei a agenda. Quando quiser seguir, me diga se é para cancelar ou remarcar esse compromisso.";
  }

  if (wantsToRescheduleAfterPrompt(args.lastHumanMessage)) {
    const now = getScheduleParsingNow(args.scheduleSettings || null);
    const reschedulePayload = extractReschedulePayload(args.lastHumanMessage, now, args.scheduleSettings || null);
    const scheduleTimezone = getScheduleTimezone(args.scheduleSettings || null);

    if (reschedulePayload.ok) {
      let customerMessageSent = false;

      if (!args.threadId) {
        return "Encontrei o compromisso, mas nÃ£o consegui registrar a tratativa porque a conversa da assistente nÃ£o foi identificada. A agenda ainda nÃ£o foi alterada.";
      }

      const operationKey = [
        "assistant_customer_contact",
        "appointment_reschedule_with_customer",
        args.threadId,
        appointment.id,
        reschedulePayload.payload.scheduled_start,
        reschedulePayload.payload.scheduled_end,
        String(args.lastHumanMessage || "").trim().replace(/\s+/g, " "),
      ].join(":");

      const preTaskResult = await createAssistantOperationalTask({
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: args.storeId,
        threadId: args.threadId,
        taskType: "appointment_reschedule_with_customer",
        status: "open",
        priority: "normal",
        title: `RemarcaÃ§Ã£o de ${buildScheduleAppointmentReferenceLabel(appointment)}${appointment.customer_name ? ` - ${appointment.customer_name}` : ""}`,
        description: "A assistente registrou a remarcaÃ§Ã£o antes de tentar contato com o cliente. A agenda ainda nÃ£o foi alterada.",
        appointment,
        targetStartIso: reschedulePayload.payload.scheduled_start,
        targetEndIso: reschedulePayload.payload.scheduled_end,
        timezoneName: scheduleTimezone,
        taskPayload: {
          operation_key: operationKey,
          customer_message_sent: false,
          source: "assistant.reply.route",
          original_user_message: args.lastHumanMessage,
          source_context_reason: "cancel_prompt_reschedule_choice_with_target",
          agenda_updated: false,
        },
      });

      if (!preTaskResult.ok) {
        return `Encontrei o compromisso, mas nÃ£o consegui registrar a tratativa operacional: ${preTaskResult.error}. A agenda ainda nÃ£o foi alterada.`;
      }

      const preTaskLoadResult = await loadAssistantOperationalTaskById({
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: args.storeId,
        taskId: preTaskResult.taskId,
      });
      if (!preTaskLoadResult.ok) {
        return `Registrei a tratativa operacional, mas nÃ£o consegui confirmar a task antes do contato: ${preTaskLoadResult.error}. A agenda ainda nÃ£o foi alterada.`;
      }
      const previousCustomerMessageSent = getOperationalTaskPayload(preTaskLoadResult.task).customer_message_sent === true;

      if (appointment.conversation_id) {
        const customerMessage = buildCustomerRescheduleMessage({
          appointment,
          proposedStartIso: reschedulePayload.payload.scheduled_start,
          scheduleSettings: args.scheduleSettings || null,
        });
        if (previousCustomerMessageSent) {
          customerMessageSent = true;
        } else {
          const sendResult = await sendAiMessageToCustomerConversation({
            supabase: args.supabase,
            conversationId: appointment.conversation_id,
            text: customerMessage,
            target: buildCommercialTargetFromAppointment(appointment, "pending_customer_cancel_decision_reschedule"),
          });
          customerMessageSent = sendResult.ok;
        }
      }

      const taskStatusResult = await updateAssistantOperationalTaskAfterCustomerContact({
          supabase: args.supabase,
          organizationId: args.organizationId,
          storeId: args.storeId,
          taskId: preTaskResult.taskId,
          status: customerMessageSent ? "waiting_customer_response" : "open",
          description: customerMessageSent
            ? "A assistente jÃ¡ iniciou contato com o cliente. A agenda ainda nÃ£o foi alterada."
            : "A assistente identificou a remarcaÃ§Ã£o, mas nÃ£o conseguiu iniciar contato automÃ¡tico com o cliente.",
          taskPayload: {
            ...getOperationalTaskPayload(preTaskLoadResult.task),
            customer_message_sent: customerMessageSent,
            source: "assistant.reply.route",
            original_user_message: args.lastHumanMessage,
            source_context_reason: "cancel_prompt_reschedule_choice_with_target",
            agenda_updated: false,
          },
        });
        if (!taskStatusResult.ok) {
          return `Registrei a tratativa operacional, mas nÃ£o consegui confirmar o estado atualizado da task: ${taskStatusResult.error}. A agenda ainda nÃ£o foi alterada.`;
        }

        const contextResult = await upsertAssistantContextState({
          supabase: args.supabase,
          organizationId: args.organizationId,
          storeId: args.storeId,
          threadId: args.threadId,
          currentContextState: contextState,
          patch: {
            active_topic: "appointment_reschedule",
            active_intent: "reschedule",
            active_status: customerMessageSent ? "waiting_customer_response" : "active",
            active_customer_name: appointment.customer_name || null,
            active_customer_phone: appointment.customer_phone || null,
            active_lead_id: appointment.lead_id || null,
            active_conversation_id: appointment.conversation_id || null,
            active_appointment_id: appointment.id,
            target_start_at: reschedulePayload.payload.scheduled_start,
            target_end_at: reschedulePayload.payload.scheduled_end,
            target_date: isoDateToLocalDateForDb(reschedulePayload.payload.scheduled_start, scheduleTimezone),
            target_time: formatTimeOnlyInTimeZone(reschedulePayload.payload.scheduled_start, scheduleTimezone),
            timezone_name: scheduleTimezone,
            candidate_options: [],
            context_payload: {
              reason: "waiting_customer_confirmation_before_reschedule",
              task_id: preTaskResult.taskId || null,
              task_created: preTaskResult.ok,
              agenda_updated: false,
              customer_message_sent: customerMessageSent,
              source_context_reason: "cancel_prompt_reschedule_choice_with_target",
            },
            last_user_message: args.lastHumanMessage,
          },
        });

        if (!contextResult.ok) {
          return `Enviei a mensagem e finalizei a task, mas nÃ£o consegui atualizar o contexto da Assistente: ${contextResult.error || "erro desconhecido"}. ReconciliaÃ§Ã£o necessÃ¡ria; a agenda ainda nÃ£o foi alterada.`;
      }

      return buildResponsibleRescheduleContactReply({
        appointment,
        targetStartIso: reschedulePayload.payload.scheduled_start,
        customerMessageSent,
        scheduleSettings: args.scheduleSettings || null,
      });
    }

    if (args.threadId) await upsertAssistantContextState({
      supabase: args.supabase, organizationId: args.organizationId, storeId: args.storeId, threadId: args.threadId, currentContextState: contextState,
      patch: { active_topic: "appointment_reschedule", active_intent: "reschedule", active_status: "active", active_customer_name: appointment.customer_name || null, active_customer_phone: appointment.customer_phone || null, active_lead_id: appointment.lead_id || null, active_conversation_id: appointment.conversation_id || null, active_appointment_id: appointment.id, target_date: null, target_time: null, target_start_at: null, target_end_at: null, timezone_name: scheduleTimezone, candidate_options: [], context_payload: { reason: "customer_cancel_prompt_chose_reschedule", appointment_id: appointment.id }, last_user_message: args.lastHumanMessage },
    });
    return `Certo. Vamos remarcar ${buildScheduleAppointmentReferenceLabel(appointment)} de ${appointment.customer_name || "cliente não identificado"}. Me diga o novo dia e horário.`;
  }

  if (wantsToCancelAfterPrompt(args.lastHumanMessage)) return executeConfirmedCustomerAppointmentCancellation({ supabase: args.supabase, organizationId: args.organizationId, storeId: args.storeId, threadId: args.threadId || null, assistantContextState: contextState, lastHumanMessage: args.lastHumanMessage, appointment, scheduleSettings: args.scheduleSettings || null, reasonText: extractCancellationReasonFromDecision(args.lastHumanMessage) });

  return "Antes de eu alterar a agenda, preciso que você escolha uma opção:\n\n1. Cancelar esse compromisso.\n2. Remarcar para outro dia ou horário.\n\nSe for cancelar, você pode responder só ‘1’, ‘cancelar com aviso simples’ ou ‘cancele e explique que...’.";
}

async function executeSelectedAppointmentOptionAction(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  threadId?: string | null;
  assistantContextState?: StoreAssistantContextStateRow | null;
  lastHumanMessage: string;
  action: ScheduleAction;
  option: AssistantCandidateOption;
  scheduleSettings?: StoreScheduleSettingsRow | null;
}) {
  if (!args.option?.appointment_id) {
    return "Não consegui identificar qual compromisso você escolheu. Me diga o número novamente ou informe cliente, data e horário.";
  }

  const selectedAppointment = await loadAppointmentByIdForAssistantAction({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    appointmentId: args.option.appointment_id,
  });

  if (!selectedAppointment) {
    return "Não encontrei mais esse compromisso na agenda. Atualize a tela ou me diga o cliente, data e horário para eu procurar de novo.";
  }

  if (["cancelled", "completed"].includes(normalizeText(selectedAppointment.status || ""))) {
    return `Esse compromisso já está como ${formatScheduleAppointmentCurrentSituation(selectedAppointment)}. Não alterei nada na agenda.`;
  }

  const selectedTarget = buildCommercialTargetFromAppointment(
    selectedAppointment,
    "selected_appointment_option",
  );
  const selectedTargetAssertion = assertCommercialTargetForSideEffect({
    target: selectedTarget,
    sideEffect: `selected_appointment_${args.action}`,
  });
  if (!selectedTargetAssertion.ok) {
    return "Identifiquei o compromisso escolhido, mas o alvo comercial não está canonicamente resolvido. Não alterei nada.";
  }

  if (args.action === "cancel") {
    if (appointmentHasCustomerInvolved(selectedAppointment)) {
      return startCustomerAppointmentCancelDecision({ supabase: args.supabase, organizationId: args.organizationId, storeId: args.storeId, threadId: args.threadId || null, assistantContextState: args.assistantContextState || null, lastHumanMessage: args.lastHumanMessage, appointment: selectedAppointment, scheduleSettings: args.scheduleSettings || null });
    }

    const { error: cancelError } = await args.supabase.rpc("cancel_store_appointment", {
      p_appointment_id: selectedAppointment.id,
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_cancel_reason: "Cancelado pelo responsável na assistente operacional.",
    });

    if (cancelError) {
      return `Tentei cancelar esse compromisso, mas encontrei um erro: ${cancelError.message}`;
    }

    if (args.threadId) {
      await resolveAssistantContextState({
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: args.storeId,
        threadId: args.threadId,
        currentContextState: args.assistantContextState || null,
        lastUserMessage: args.lastHumanMessage,
        lastAssistantMessage: `${buildScheduleAppointmentReferenceLabel(selectedAppointment)} de ${selectedAppointment.customer_name || "cliente não identificado"} cancelado.`,
      });
    }

    return `Pronto. Cancelei ${buildScheduleAppointmentReferenceLabel(selectedAppointment)} de ${selectedAppointment.customer_name || "cliente não identificado"} agendada para ${formatAppointmentStartInTimeZone({ value: selectedAppointment.scheduled_start || selectedAppointment.scheduled_end || null, scheduleSettings: args.scheduleSettings || null, timezoneName: args.assistantContextState?.timezone_name || null })}.`;
  }

  if (args.action === "complete") {
    const { error } = await args.supabase.rpc("complete_store_appointment_with_outcome", {
      p_appointment_id: selectedAppointment.id,
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_completion_outcome: "fully_completed",
      p_completion_note: "Confirmado pelo responsável na assistente operacional.",
    });

    if (error) {
      return `Tentei marcar esse compromisso como concluído, mas encontrei um erro: ${error.message}`;
    }

    if (args.threadId) {
      await resolveAssistantContextState({
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: args.storeId,
        threadId: args.threadId,
        currentContextState: args.assistantContextState || null,
        lastUserMessage: args.lastHumanMessage,
        lastAssistantMessage: `${buildScheduleAppointmentReferenceLabel(selectedAppointment)} de ${selectedAppointment.customer_name || "cliente não identificado"} concluído.`,
      });
    }

    return `Pronto. Marquei como concluído ${buildScheduleAppointmentReferenceLabel(selectedAppointment)} de ${selectedAppointment.customer_name || "cliente não identificado"}.`;
  }

  if (args.action === "needs_followup") {
    if (args.threadId) {
      await resolveAssistantContextState({
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: args.storeId,
        threadId: args.threadId,
        currentContextState: args.assistantContextState || null,
        lastUserMessage: args.lastHumanMessage,
        lastAssistantMessage: `${buildScheduleAppointmentReferenceLabel(selectedAppointment)} mantido em aberto.`,
      });
    }

    return `Certo. Mantive ${buildScheduleAppointmentReferenceLabel(selectedAppointment)} de ${selectedAppointment.customer_name || "cliente não identificado"} em aberto.`;
  }

  return null;
}

function getRescheduleTargetTextSegment(text: string) {
  const raw = String(text || "");
  const normalized = normalizeText(raw);

  if (!(normalized.includes("remarca") || normalized.includes("remarque") || normalized.includes("remarcar") || normalized.includes("reagenda") || normalized.includes("reagende") || normalized.includes("reagendar"))) {
    return raw;
  }

  const matches = Array.from(raw.matchAll(/\b(?:para|pra)\b/gi));
  if (!matches.length) return raw;

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    const markerIndex = typeof match.index === "number" ? match.index : -1;
    if (markerIndex < 0) continue;

    const afterMarker = raw.slice(markerIndex + match[0].length).trim();
    if (!afterMarker) continue;

    const hasDateCue =
      /\b\d{1,2}\s*\/\s*\d{1,2}(?:\s*\/\s*\d{2,4})?\b/.test(afterMarker) ||
      /\b(?:hoje|amanha|amanhã|depois de amanha|depois de amanhã|segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo)\b/i.test(afterMarker) ||
      /\b(?:dia|data)\s+\d{1,2}\b/i.test(afterMarker);
    const hasTimeCue =
      /\b\d{1,2}(?::\d{2})?\s*h\b/i.test(afterMarker) ||
      /\b(?:as|às)\s+\d{1,2}(?::\d{2})?\b/i.test(afterMarker) ||
      /\b\d{1,2}:\d{2}\b/.test(afterMarker);

    if (hasDateCue || hasTimeCue) return afterMarker;
  }

  return raw;
}

function extractOriginalScheduleReferenceFromRescheduleText(args: {
  text: string;
  now: Date;
  settings?: StoreScheduleSettingsRow | null;
}) {
  const raw = String(args.text || "");
  const normalized = normalizeText(raw);

  if (!(normalized.includes("remarca") || normalized.includes("remarque") || normalized.includes("remarcar") || normalized.includes("reagenda") || normalized.includes("reagende") || normalized.includes("reagendar"))) {
    return null;
  }

  const matches = Array.from(raw.matchAll(/\b(?:para|pra)\b/gi));
  if (!matches.length) return null;

  const lastMarker = matches[matches.length - 1];
  const markerIndex = typeof lastMarker.index === "number" ? lastMarker.index : -1;
  if (markerIndex <= 0) return null;

  const beforeTarget = raw.slice(0, markerIndex).trim();
  if (!beforeTarget) return null;

  const dateParts = parseDateReferenceFromText(beforeTarget, args.now);
  const dateKey = getDateKeyFromParts(dateParts);
  const timeRange = parseTimeRangeFromText(beforeTarget);
  const startTime = timeRange?.startTime || null;

  if (!dateKey && !startTime) return null;

  return {
    dateKey,
    startTime,
  };
}

function refineAppointmentCandidateIndexesByOriginalSchedule(args: {
  text: string;
  openAppointments: AppointmentRow[];
  candidateIndexes: number[];
  now: Date;
  settings?: StoreScheduleSettingsRow | null;
}) {
  const originalReference = extractOriginalScheduleReferenceFromRescheduleText({
    text: args.text,
    now: args.now,
    settings: args.settings || null,
  });

  if (!originalReference) return args.candidateIndexes;

  const refined = args.candidateIndexes.filter((candidateIndex) => {
    const appointment = args.openAppointments[candidateIndex];
    if (!appointment) return false;

    const appointmentStart = appointment.scheduled_start || appointment.scheduled_end;
    if (!appointmentStart) return false;

    if (originalReference.dateKey) {
      const appointmentDateKey = getLocalDateKeyFromIso(appointmentStart, args.settings || null);
      if (appointmentDateKey !== originalReference.dateKey) return false;
    }

    if (originalReference.startTime) {
      const appointmentTime = formatTimeOnlyInTimeZone(appointmentStart, getScheduleTimezone(args.settings || null));
      if (appointmentTime !== originalReference.startTime) return false;
    }

    return true;
  });

  return refined.length ? refined : args.candidateIndexes;
}


function parseDateKeyToScheduleDateParts(dateKey: string | null | undefined) {
  const parts = String(dateKey || "").split("-").map((part) => Number(part));
  if (parts.length !== 3) return null;
  const [year, month, day] = parts;
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 2000 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month: month - 1, day };
}


function cleanExplicitAppointmentTitleCandidate(value: string | null | undefined) {
  const cleaned = String(value || "")
    .replace(/[?.!,;:]+$/g, "")
    .replace(/^['"“”‘’]+|['"“”‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || cleaned.length < 3) return null;

  const normalized = normalizeText(cleaned);
  const unsafeGeneric = new Set([
    "o compromisso",
    "a visita",
    "a instalacao",
    "a instalação",
    "a manutencao",
    "a manutenção",
    "esse compromisso",
    "essa visita",
    "isso",
    "esse",
    "essa",
  ]);
  if (unsafeGeneric.has(normalized)) return null;

  return cleaned;
}

function extractExplicitAppointmentTitleCandidateFromCommand(text: string) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const patterns = [
    // Comandos com data/horário, usados principalmente em remarcações.
    /\bcompromisso\s+(.+?)\s+(?:do|da|de)\s+dia\b/i,
    /\bcompromisso\s+(.+?)\s+(?:marcado|agendado|previsto)\b/i,
    /\bvisita\s+(.+?)\s+(?:do|da|de)\s+dia\b/i,
    /\binstala(?:c|ç)(?:a|ã)o\s+(.+?)\s+(?:do|da|de)\s+dia\b/i,
    /\bmanuten(?:c|ç)(?:a|ã)o\s+(.+?)\s+(?:do|da|de)\s+dia\b/i,

    // Comandos diretos e sensíveis, como: "Cancele o compromisso TESTE RECUSA PILAR 6.".
    /\b(?:cancele|cancelar|cancela|conclua|concluir|conclui|finalize|finalizar|encerre|encerrar|remarque|remarcar|remarca|reagende|reagendar|reagenda)\s+(?:o\s+|a\s+)?(?:compromisso|agendamento|visita|visita\s+t[eé]cnica|instala(?:c|ç)(?:a|ã)o|manuten(?:c|ç)(?:a|ã)o)\s+(.+?)(?:\s+(?:do|da|de)\s+dia\b|\s+(?:marcado|agendado|previsto)\b|[?.!,;:]?$)/i,
    /\b(?:compromisso|agendamento|visita|visita\s+t[eé]cnica|instala(?:c|ç)(?:a|ã)o|manuten(?:c|ç)(?:a|ã)o)\s+(.+?)\s+(?:deve|pode|precisa)\s+(?:ser\s+)?(?:cancelado|cancelada|conclu[ií]do|conclu[ií]da|remarcado|remarcada)\b/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const candidate = cleanExplicitAppointmentTitleCandidate(match?.[1]);
    if (candidate) return candidate;
  }

  return null;
}

function appointmentTitleMatchesCommandTitle(appointmentTitle: string | null | undefined, commandTitle: string | null | undefined) {
  const appointment = normalizeText(appointmentTitle || "");
  const command = normalizeText(commandTitle || "");
  if (!appointment || !command || appointment.length < 3 || command.length < 3) return false;
  return appointment === command || appointment.includes(command) || command.includes(appointment);
}


function buildExplicitAppointmentMatchAmbiguityReply(matches: AppointmentRow[], scheduleSettings?: StoreScheduleSettingsRow | null) {
  const lines = [
    "Encontrei mais de um compromisso com esse nome.",
    "Para eu não alterar o compromisso errado, me diga qual deles você quer atualizar:",
    "",
  ];

  matches.slice(0, 8).forEach((appointment, index) => {
    const referenceLabel = buildScheduleAppointmentReferenceLabel(appointment);
    const customer = appointment.customer_name || "cliente não identificado";
    const timeRange = formatAppointmentRangeInTimeZone({ appointment, scheduleSettings: scheduleSettings || null });
    lines.push(`${index + 1}. ${referenceLabel.charAt(0).toUpperCase() + referenceLabel.slice(1)} — ${customer} — ${timeRange}`);
  });

  return lines.join("\n").trim();
}

async function loadExplicitAppointmentTitleOnlyMatchesFromCommand(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  text: string;
}) {
  const explicitTitleCandidate = extractExplicitAppointmentTitleCandidateFromCommand(args.text);
  if (!explicitTitleCandidate) return [] as AppointmentRow[];

  const { data, error } = await args.supabase
    .from("store_appointments")
    .select("id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id, commercial_opportunity_id")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .in("status", ["scheduled", "rescheduled"])
    .order("scheduled_start", { ascending: true })
    .limit(200);

  if (error) return [] as AppointmentRow[];

  return ((data || []) as AppointmentRow[]).filter((appointment) =>
    appointmentTitleMatchesCommandTitle(appointment.title, explicitTitleCandidate)
  );
}

function hasExplicitAppointmentTitleAndOriginalScheduleReference(args: {
  text: string;
  now: Date;
  scheduleSettings?: StoreScheduleSettingsRow | null;
}) {
  const titleCandidate = extractExplicitAppointmentTitleCandidateFromCommand(args.text);
  if (!titleCandidate) return false;

  const originalReference = extractOriginalScheduleReferenceFromRescheduleText({
    text: args.text,
    now: args.now,
    settings: args.scheduleSettings || null,
  });

  return Boolean(originalReference?.dateKey || originalReference?.startTime);
}

async function loadExplicitAppointmentMatchesFromCommand(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  text: string;
  now: Date;
  scheduleSettings?: StoreScheduleSettingsRow | null;
}) {
  const normalizedText = normalizeText(args.text);
  if (!normalizedText) return [] as AppointmentRow[];

  const isAppointmentCommand = hasExplicitAppointmentManagementCommand(args.text);
  if (!isAppointmentCommand) return [] as AppointmentRow[];

  const originalReference = extractOriginalScheduleReferenceFromRescheduleText({
    text: args.text,
    now: args.now,
    settings: args.scheduleSettings || null,
  });

  if (!originalReference?.dateKey && !originalReference?.startTime) return [] as AppointmentRow[];

  const query = args.supabase
    .from("store_appointments")
    .select("id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id, commercial_opportunity_id")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .in("status", ["scheduled", "rescheduled"]);

  const dateParts = parseDateKeyToScheduleDateParts(originalReference?.dateKey || null);
  if (dateParts) {
    const dayStartIso = buildIsoFromDateAndTime(dateParts, "00:00", args.scheduleSettings || null);
    const dayEndIso = buildIsoFromDateAndTime(dateParts, "23:59", args.scheduleSettings || null);
    query.gte("scheduled_start", dayStartIso).lte("scheduled_start", dayEndIso);
  } else {
    query.gte("scheduled_start", args.now.toISOString()).limit(50);
  }

  const { data, error } = await query.order("scheduled_start", { ascending: true }).limit(50);
  if (error) return [] as AppointmentRow[];

  const explicitTitleCandidate = extractExplicitAppointmentTitleCandidateFromCommand(args.text);

  const candidates = ((data || []) as AppointmentRow[]).filter((appointment) => {
    const appointmentStart = appointment.scheduled_start || appointment.scheduled_end;
    if (!appointmentStart) return false;

    if (originalReference?.dateKey) {
      const appointmentDateKey = getLocalDateKeyFromIso(appointmentStart, args.scheduleSettings || null);
      if (appointmentDateKey !== originalReference.dateKey) return false;
    }

    if (originalReference?.startTime) {
      const appointmentTime = formatTimeOnlyInTimeZone(appointmentStart, getScheduleTimezone(args.scheduleSettings || null));
      if (appointmentTime !== originalReference.startTime) return false;
    }

    const title = normalizeText(appointment.title);
    const customerName = normalizeText(appointment.customer_name);
    const phoneDigits = normalizeDigits(appointment.customer_phone);
    const textDigits = normalizeDigits(args.text);

    const hasExplicitTitle = Boolean(
      (title && title.length >= 3 && normalizedText.includes(title)) ||
      appointmentTitleMatchesCommandTitle(appointment.title, explicitTitleCandidate)
    );
    const hasExplicitCustomer = Boolean(customerName && customerName.length >= 3 && normalizedText.includes(customerName));
    const hasExplicitPhone = Boolean(phoneDigits.length >= 8 && textDigits.includes(phoneDigits));

    return hasExplicitTitle || hasExplicitCustomer || hasExplicitPhone;
  });

  if (candidates.length) return candidates;

  // Blindagem extra: quando o comando menciona título exato + horário original,
  // buscamos pelo dia/horário e pelo título extraído, sem depender do contexto ativo anterior.
  if (explicitTitleCandidate && originalReference?.dateKey) {
    const datePartsForFallback = parseDateKeyToScheduleDateParts(originalReference.dateKey);
    if (datePartsForFallback) {
      const dayStartIso = buildIsoFromDateAndTime(datePartsForFallback, "00:00", args.scheduleSettings || null);
      const dayEndIso = buildIsoFromDateAndTime(datePartsForFallback, "23:59", args.scheduleSettings || null);

      const fallbackResponse = await args.supabase
        .from("store_appointments")
        .select("id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id, commercial_opportunity_id")
        .eq("organization_id", args.organizationId)
        .eq("store_id", args.storeId)
        .in("status", ["scheduled", "rescheduled"])
        .gte("scheduled_start", dayStartIso)
        .lte("scheduled_start", dayEndIso)
        .order("scheduled_start", { ascending: true })
        .limit(100);

      if (!fallbackResponse.error) {
        const fallbackCandidates = ((fallbackResponse.data || []) as AppointmentRow[]).filter((appointment) => {
          const appointmentStart = appointment.scheduled_start || appointment.scheduled_end;
          if (!appointmentStart) return false;

          if (originalReference?.startTime) {
            const appointmentTime = formatTimeOnlyInTimeZone(appointmentStart, getScheduleTimezone(args.scheduleSettings || null));
            if (appointmentTime !== originalReference.startTime) return false;
          }

          return appointmentTitleMatchesCommandTitle(appointment.title, explicitTitleCandidate);
        });

        if (fallbackCandidates.length) return fallbackCandidates;
      }
    }
  }

  return [] as AppointmentRow[];
}

function resolveAppointmentIndexFromAssistantContext(args: {
  text: string;
  openAppointments: AppointmentRow[];
  contextState?: StoreAssistantContextStateRow | null;
}) {
  const options = readAssistantCandidateOptions(args.contextState);
  const explicitIndex = resolvePostAppointmentDetailIndex(args.text, Math.max(options.length, args.openAppointments.length, 1));

  if (explicitIndex !== null && options.length > 0) {
    const optionNumber = explicitIndex + 1;
    const matchedOption = options.find((option) => Number(option.option_number) === optionNumber);
    const matchedIndex = matchedOption?.appointment_id
      ? args.openAppointments.findIndex((appointment) => appointment.id === matchedOption.appointment_id)
      : -1;
    if (matchedIndex >= 0) return matchedIndex;
  }

  const normalizedText = normalizeText(args.text);
  const activeAppointmentId = args.contextState?.active_appointment_id || null;
  const contextTopic = normalizeText(args.contextState?.active_topic || "");
  const contextStatus = normalizeText(args.contextState?.active_status || "");
  const contextPayload = readAssistantContextPayload(args.contextState || null);
  const action = resolveScheduleAction(args.text) ||
    (
      contextTopic === "appointment_reschedule" &&
      Boolean(contextPayload.requested_date || args.contextState?.target_date) &&
      parseTimeRangeFromText(args.text)?.startTime
        ? "reschedule"
        : null
    );
  const canReuseActiveAppointment =
    Boolean(activeAppointmentId) &&
    ["reschedule", "cancel", "complete", "needs_followup"].includes(action || "") &&
    ["appointment_management", "appointment_reschedule"].includes(contextTopic) &&
    ["active", "waiting_user_choice", "waiting_customer_response"].includes(contextStatus);

  if (canReuseActiveAppointment && activeAppointmentId) {
    const activeIndex = args.openAppointments.findIndex((appointment) => appointment.id === activeAppointmentId);
    if (activeIndex >= 0) {
      const directMatches = resolveAppointmentCandidateIndexesFromText({
        text: args.text,
        openAppointments: args.openAppointments,
      });
      const mentionsActiveAppointment = directMatches.some((index) => args.openAppointments[index]?.id === activeAppointmentId);
      const mentionsAnotherAppointment = directMatches.some((index) => {
        const appointmentId = args.openAppointments[index]?.id;
        return Boolean(appointmentId && appointmentId !== activeAppointmentId);
      });
      const hasExplicitTarget = Boolean(
        extractExplicitAppointmentTitleCandidateFromCommand(args.text) ||
        extractCustomerNameFromText(args.text) ||
        extractPhoneFromText(args.text)
      );

      if (!mentionsAnotherAppointment && (!hasExplicitTarget || mentionsActiveAppointment)) {
        return activeIndex;
      }
    }
  }

  const keepsCurrentContext = hasAnyTerm(normalizedText, [
    "esse item", "esse compromisso", "essa visita", "essa instalacao", "essa instalação",
    "esse caso", "esse atendimento", "ele", "ela", "esse", "essa", "isso",
    "o mesmo", "a mesma", "remarque esse", "remarque essa", "cancele esse",
    "conclua esse", "pode fazer", "pode seguir",
  ]);

  if (keepsCurrentContext && args.contextState?.active_appointment_id) {
    const activeIndex = args.openAppointments.findIndex((appointment) => appointment.id === args.contextState?.active_appointment_id);
    if (activeIndex >= 0) return activeIndex;
  }

  if (keepsCurrentContext && options.length === 1) {
    const onlyIndex = args.openAppointments.findIndex((appointment) => appointment.id === options[0].appointment_id);
    if (onlyIndex >= 0) return onlyIndex;
  }

  return null;
}

function buildAssistantContextBlock(contextState?: StoreAssistantContextStateRow | null) {
  if (!contextState || normalizeText(contextState.active_status) === "resolved") {
    return "- nenhum assunto ativo salvo";
  }

  const lines = [
    contextState.active_topic ? `- assunto ativo: ${contextState.active_topic}` : null,
    contextState.active_intent ? `- intenção ativa: ${contextState.active_intent}` : null,
    contextState.active_status ? `- estado: ${contextState.active_status}` : null,
    contextState.active_customer_name ? `- cliente em foco: ${contextState.active_customer_name}` : null,
    contextState.active_customer_phone ? `- telefone em foco: ${contextState.active_customer_phone}` : null,
    contextState.target_date ? `- data alvo: ${contextState.target_date}` : null,
    contextState.target_time ? `- horário alvo: ${contextState.target_time}` : null,
    contextState.active_appointment_id ? `- compromisso em foco: ${contextState.active_appointment_id}` : null,
  ].filter(Boolean) as string[];

  const options = readAssistantCandidateOptions(contextState);
  if (options.length) {
    lines.push("- opções recentes listadas:");
    options.slice(0, 8).forEach((option) => {
      const label = [
        `${option.option_number}.`,
        option.appointment_type ? formatAppointmentType(option.appointment_type) : "compromisso",
        option.title || null,
        option.customer_name ? `de ${option.customer_name}` : null,
        option.scheduled_start ? formatAppointmentStartInTimeZone({ value: option.scheduled_start, scheduleSettings: null, timezoneName: contextState?.timezone_name || null }) : null,
      ].filter(Boolean).join(" ");
      lines.push(`  ${label}`);
    });
  }

  return lines.length ? lines.join("\n") : "- nenhum assunto ativo salvo";
}

async function getOrCreateAssistantThread(args: { supabase: any; organizationId: string; storeId: string; }) {
  const { data: existingThread, error: findError } = await args.supabase
    .from("store_assistant_threads")
    .select("id")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findError) return { ok: false as const, error: findError.message, threadId: null as string | null };
  const existingThreadId = typeof existingThread?.id === "string" ? existingThread.id.trim() : "";
  if (existingThreadId) return { ok: true as const, threadId: existingThreadId };

  const { data: createdThread, error: createError } = await args.supabase
    .from("store_assistant_threads")
    .insert({ organization_id: args.organizationId, store_id: args.storeId, thread_type: "primary", status: "active", title: "Assistente operacional", created_by: "system" })
    .select("id")
    .maybeSingle();

  if (createError || !createdThread?.id) {
    return { ok: false as const, error: createError?.message || "Não consegui criar a thread da assistente.", threadId: null as string | null };
  }
  return { ok: true as const, threadId: String(createdThread.id) };
}

async function loadAssistantContextState(args: { supabase: any; organizationId: string; storeId: string; threadId: string; }) {
  const { data, error } = await args.supabase
    .from("store_assistant_context_state")
    .select("*")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("thread_id", args.threadId)
    .in("active_status", ["active", "waiting_user_choice", "waiting_customer_response"])
    .order("updated_at", { ascending: false })
    .limit(10);
  if (error) return { ok: false as const, error: error.message, contextState: null as StoreAssistantContextStateRow | null };
  const rows = ((data || []) as StoreAssistantContextStateRow[]);
  if (rows.length > 1) {
    return { ok: false as const, error: "MULTIPLE_ACTIVE_ASSISTANT_CONTEXT_STATES", contextState: null as StoreAssistantContextStateRow | null };
  }
  return { ok: true as const, contextState: (rows[0] || null) as StoreAssistantContextStateRow | null };
}

async function upsertAssistantContextState(args: { supabase: any; organizationId: string; storeId: string; threadId: string; currentContextState?: StoreAssistantContextStateRow | null; patch: Record<string, unknown>; }) {
  const payload = { organization_id: args.organizationId, store_id: args.storeId, thread_id: args.threadId, updated_at: new Date().toISOString(), ...args.patch };
  if (args.currentContextState?.id) {
    const { data, error } = await args.supabase
      .from("store_assistant_context_state")
      .update(payload)
      .eq("id", args.currentContextState.id)
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .select("*")
      .maybeSingle();
    return { ok: !error, error: error?.message || null, contextState: (data || null) as StoreAssistantContextStateRow | null };
  }
  const { data, error } = await args.supabase
    .from("store_assistant_context_state")
    .insert({ ...payload, active_status: args.patch.active_status || "active", candidate_options: args.patch.candidate_options || [], context_payload: args.patch.context_payload || {} })
    .select("*")
    .maybeSingle();
  return { ok: !error, error: error?.message || null, contextState: (data || null) as StoreAssistantContextStateRow | null };
}

async function resolveAssistantContextState(args: { supabase: any; organizationId: string; storeId: string; threadId: string; currentContextState?: StoreAssistantContextStateRow | null; lastUserMessage: string; lastAssistantMessage?: string | null; resolvedReason?: string; }) {
  return upsertAssistantContextState({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    threadId: args.threadId,
    currentContextState: args.currentContextState,
    patch: { active_status: "resolved", last_user_message: args.lastUserMessage, last_assistant_message: args.lastAssistantMessage || args.currentContextState?.last_assistant_message || null, candidate_options: [], context_payload: { resolved_reason: args.resolvedReason || "action_completed_or_context_closed" } },
  });
}

async function resolveExpiredCustomerIdentityDisambiguationContext(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  threadId?: string | null;
  contextState: StoreAssistantContextStateRow;
  lastHumanMessage: string;
  expirationReply: string;
}) {
  if (!args.threadId) {
    return {
      ok: false as const,
      error: "THREAD_ID_MISSING_FOR_EXPIRED_IDENTITY_CONTEXT_RESOLUTION",
    };
  }

  const result = await resolveAssistantContextState({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    threadId: args.threadId,
    currentContextState: args.contextState,
    lastUserMessage: args.lastHumanMessage,
    lastAssistantMessage: args.expirationReply,
  });

  if (!result.ok) {
    return {
      ok: false as const,
      error: result.error || "EXPIRED_IDENTITY_CONTEXT_RESOLUTION_FAILED",
    };
  }

  return { ok: true as const };
}

async function createAssistantOperationalTask(args: { supabase: any; organizationId: string; storeId: string; threadId: string | null; taskType: string; status: string; priority?: string; title: string; description?: string | null; appointment?: AppointmentRow | null; canonicalTarget?: { leadId: string | null; conversationId: string | null; commercialOpportunityId: string | null; customerName?: string | null; customerPhone?: string | null } | null; targetStartIso?: string | null; targetEndIso?: string | null; timezoneName: string; taskPayload?: Record<string, unknown>; }) {
  const appointment = args.appointment || null;
  const normalizedTaskType = normalizeText(args.taskType);
  const taskPayload = args.taskPayload || {};
  const operationKey = String(
    taskPayload.operation_key ||
    (
      args.threadId &&
      appointment?.id &&
      ["appointment_reschedule_with_customer", "appointment_reschedule_find_customer_availability"].includes(args.taskType)
        ? buildAssistantCustomerContactOperationKey({
            taskType: args.taskType,
            threadId: args.threadId,
            appointmentId: appointment.id,
            targetStartIso: args.targetStartIso || null,
            targetEndIso: args.targetEndIso || null,
            originalUserMessage: String(taskPayload.original_user_message || ""),
          })
        : ""
    )
  ).trim();

  if (operationKey && args.threadId) {
    const existingTaskStatuses = args.taskType === "appointment_create_with_customer"
      ? [...ASSISTANT_OPERATIONAL_TASK_OPEN_STATUSES, "failed"]
      : ASSISTANT_OPERATIONAL_TASK_OPEN_STATUSES;
    const existingTaskResult = appointment?.id
      ? await findAssistantOperationalTaskByOperationKey({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      threadId: args.threadId,
      taskType: args.taskType,
      appointmentId: appointment.id,
      operationKey,
        })
      : await (async () => {
          const { data, error } = await args.supabase
            .from("store_assistant_operational_tasks")
            .select("*")
            .eq("organization_id", args.organizationId)
            .eq("store_id", args.storeId)
            .eq("thread_id", args.threadId)
            .eq("task_type", args.taskType)
            .in("status", existingTaskStatuses)
            .limit(20);
          if (error) return { ok: false as const, error: error.message, task: null as StoreAssistantOperationalTaskRow | null };
          const matches = ((data || []) as StoreAssistantOperationalTaskRow[]).filter((task) => String(getOperationalTaskPayload(task).operation_key || "") === operationKey);
          if (matches.length > 1) return { ok: false as const, error: "DUPLICATE_OPERATIONAL_TASK_OPERATION_KEY", task: null as StoreAssistantOperationalTaskRow | null };
          return { ok: true as const, error: null, task: matches[0] || null };
        })();

    if (!existingTaskResult.ok) {
      return {
        ok: false,
        error: existingTaskResult.error,
        taskId: null as string | null,
        created: false,
      };
    }

    if (existingTaskResult.task?.id) {
      return {
        ok: true,
        error: null as string | null,
        taskId: existingTaskResult.task.id,
        created: false,
      };
    }
  }

  const canonicalTarget = args.canonicalTarget || null;
  const requiresCommercialTarget =
    normalizedTaskType.startsWith("appointment_") ||
    normalizedTaskType.includes("commercial");
  if (requiresCommercialTarget) {
    const targetAssertion = assertCommercialTargetForSideEffect({
      target: appointment
        ? buildCommercialTargetFromAppointment(appointment, `operational_task:${args.taskType}`)
        : canonicalTarget
          ? { source: `operational_task:${args.taskType}`, leadId: canonicalTarget.leadId, conversationId: canonicalTarget.conversationId, commercialOpportunityId: canonicalTarget.commercialOpportunityId, customerName: canonicalTarget.customerName || null }
          : null,
      sideEffect: "store_assistant_operational_tasks.insert",
    });
    if (!targetAssertion.ok) {
      return {
        ok: false,
        error: "COMMERCIAL_TARGET_NOT_CANONICAL_FOR_TASK",
        taskId: null as string | null,
      };
    }
  }

  const { data, error } = await args.supabase
    .from("store_assistant_operational_tasks")
    .insert({
      organization_id: args.organizationId,
      store_id: args.storeId,
      thread_id: args.threadId,
      task_type: args.taskType,
      status: args.status,
      priority: args.priority || "normal",
      title: args.title,
      description: args.description || null,
      related_lead_id: appointment?.lead_id || canonicalTarget?.leadId || null,
      related_conversation_id: appointment?.conversation_id || canonicalTarget?.conversationId || null,
      related_appointment_id: appointment?.id || null,
      commercial_opportunity_id: appointment?.commercial_opportunity_id || canonicalTarget?.commercialOpportunityId || null,
      customer_name: appointment?.customer_name || canonicalTarget?.customerName || null,
      customer_phone: appointment?.customer_phone || canonicalTarget?.customerPhone || null,
      target_date: isoDateToLocalDateForDb(args.targetStartIso, args.timezoneName),
      target_time: args.targetStartIso ? formatTimeOnlyInTimeZone(args.targetStartIso, args.timezoneName) : null,
      target_start_at: args.targetStartIso || null,
      target_end_at: args.targetEndIso || null,
      timezone_name: args.timezoneName,
      task_payload: operationKey ? { ...taskPayload, operation_key: operationKey } : taskPayload,
      last_action_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (error && normalizedTaskType === "appointment_create_with_customer" && operationKey && isUniqueViolation(error)) {
    const refetchResult = await refetchAppointmentCreateTaskByOperationKey({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      operationKey,
    });

    if (!refetchResult.ok || !refetchResult.task) {
      return {
        ok: false,
        error: refetchResult.error || "APPOINTMENT_CREATE_OPERATION_KEY_REFETCH_FAILED",
        taskId: null as string | null,
        created: false,
      };
    }

    const matchesExpected = appointmentCreateTaskMatchesExpected({
      task: refetchResult.task,
      operationKey,
      leadId: appointment?.lead_id || canonicalTarget?.leadId || null,
      conversationId: appointment?.conversation_id || canonicalTarget?.conversationId || null,
      commercialOpportunityId: appointment?.commercial_opportunity_id || canonicalTarget?.commercialOpportunityId || null,
      appointmentType: String(taskPayload.appointment_type || ""),
      targetStartIso: args.targetStartIso || null,
      targetEndIso: args.targetEndIso || null,
    });

    if (!matchesExpected) {
      return {
        ok: false,
        error: "APPOINTMENT_CREATE_OPERATION_KEY_IDENTITY_MISMATCH",
        taskId: null as string | null,
        created: false,
      };
    }

    return {
      ok: true,
      error: null as string | null,
      taskId: refetchResult.task.id,
      created: false,
    };
  }

  const taskId = typeof data?.id === "string" ? data.id : null;
  return {
    ok: !error && Boolean(taskId),
    error: error?.message || (!taskId ? "TASK_INSERT_NOT_CONFIRMED" : null),
    taskId,
    created: !error && Boolean(taskId),
  };
}

function isUniqueViolation(error: { code?: string | null; message?: string | null } | null | undefined) {
  return error?.code === "23505" || String(error?.message || "").includes("23505");
}

function sameInstant(a: string | null | undefined, b: string | null | undefined) {
  const leftRaw = String(a || "").trim();
  const rightRaw = String(b || "").trim();
  if (!leftRaw || !rightRaw) return false;

  const left = new Date(leftRaw).getTime();
  const right = new Date(rightRaw).getTime();
  return Number.isFinite(left) && Number.isFinite(right) && left === right;
}

function appointmentCreateTaskMatchesExpected(args: {
  task: StoreAssistantOperationalTaskRow;
  operationKey: string;
  leadId: string | null;
  conversationId: string | null;
  commercialOpportunityId: string | null;
  appointmentType: string;
  targetStartIso: string | null;
  targetEndIso: string | null;
}) {
  const payload = getOperationalTaskPayload(args.task);
  return (
    String(payload.operation_key || "") === args.operationKey &&
    args.task.related_lead_id === args.leadId &&
    args.task.related_conversation_id === args.conversationId &&
    (args.task.commercial_opportunity_id || null) === (args.commercialOpportunityId || null) &&
    sameInstant(args.task.target_start_at, args.targetStartIso) &&
    sameInstant(args.task.target_end_at, args.targetEndIso) &&
    String(payload.appointment_type || "") === args.appointmentType
  );
}

async function refetchAppointmentCreateTaskByOperationKey(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  operationKey: string;
}) {
  const { data, error } = await args.supabase
    .from("store_assistant_operational_tasks")
    .select("*")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("task_type", "appointment_create_with_customer")
    .limit(20);

  if (error) return { ok: false as const, error: error.message, task: null as StoreAssistantOperationalTaskRow | null };
  const matches = ((data || []) as StoreAssistantOperationalTaskRow[]).filter(
    (task) => String(getOperationalTaskPayload(task).operation_key || "") === args.operationKey,
  );
  if (matches.length !== 1) {
    return { ok: false as const, error: "APPOINTMENT_CREATE_OPERATION_KEY_REFETCH_NOT_UNIQUE", task: null as StoreAssistantOperationalTaskRow | null };
  }
  return { ok: true as const, error: null as string | null, task: matches[0] };
}

async function updateAssistantOperationalTaskAfterCustomerContact(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  taskId: string | null;
  status: string;
  description?: string | null;
  taskPayload?: Record<string, unknown>;
}) {
  if (!args.taskId) return { ok: false as const, error: "TASK_ID_MISSING" };

  const { error } = await args.supabase
    .from("store_assistant_operational_tasks")
    .update({
      status: args.status,
      description: args.description || null,
      task_payload: args.taskPayload || {},
      last_action_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.taskId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId);

  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

const ASSISTANT_OPERATIONAL_TASK_OPEN_STATUSES = ["open", "waiting_user_choice", "waiting_customer_response", "ready_to_execute", "in_progress"];

function buildAssistantCustomerContactOperationKey(args: {
  taskType: string;
  threadId: string;
  appointmentId: string;
  targetStartIso?: string | null;
  targetEndIso?: string | null;
  originalUserMessage: string;
}) {
  return [
    "assistant_customer_contact",
    args.taskType,
    args.threadId,
    args.appointmentId,
    args.targetStartIso || "",
    args.targetEndIso || "",
    normalizeText(args.originalUserMessage).replace(/\s+/g, " ").trim(),
  ].join(":");
}

async function findAssistantOperationalTaskByOperationKey(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  threadId: string;
  taskType: string;
  appointmentId: string;
  operationKey: string;
}) {
  const { data, error } = await args.supabase
    .from("store_assistant_operational_tasks")
    .select("*")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("thread_id", args.threadId)
    .eq("task_type", args.taskType)
    .eq("related_appointment_id", args.appointmentId)
    .in("status", ASSISTANT_OPERATIONAL_TASK_OPEN_STATUSES)
    .limit(20);

  if (error) return { ok: false as const, error: error.message, task: null as StoreAssistantOperationalTaskRow | null };

  const matchingTasks = ((data || []) as StoreAssistantOperationalTaskRow[]).filter((task) => {
    const payload = getOperationalTaskPayload(task);
    return String(payload.operation_key || "") === args.operationKey;
  });

  if (matchingTasks.length > 1) {
    return { ok: false as const, error: "DUPLICATE_OPERATIONAL_TASK_OPERATION_KEY", task: null as StoreAssistantOperationalTaskRow | null };
  }

  return { ok: true as const, error: null as string | null, task: matchingTasks[0] || null };
}

async function loadAssistantOperationalTaskById(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  taskId: string | null;
}) {
  if (!args.taskId) return { ok: false as const, error: "TASK_ID_MISSING", task: null as StoreAssistantOperationalTaskRow | null };
  const { data, error } = await args.supabase
    .from("store_assistant_operational_tasks")
    .select("*")
    .eq("id", args.taskId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();

  if (error) return { ok: false as const, error: error.message, task: null as StoreAssistantOperationalTaskRow | null };
  return { ok: true as const, error: null as string | null, task: (data || null) as StoreAssistantOperationalTaskRow | null };
}

async function getOrCreateAssistantCustomerContactTask(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  threadId: string;
  taskType: string;
  priority?: string;
  title: string;
  description: string;
  appointment: AppointmentRow;
  targetStartIso?: string | null;
  targetEndIso?: string | null;
  timezoneName: string;
  operationKey: string;
  taskPayload: Record<string, unknown>;
}) {
  const existingResult = await findAssistantOperationalTaskByOperationKey({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    threadId: args.threadId,
    taskType: args.taskType,
    appointmentId: args.appointment.id,
    operationKey: args.operationKey,
  });

  if (!existingResult.ok) {
    return { ok: false as const, error: existingResult.error, taskId: null as string | null, task: null as StoreAssistantOperationalTaskRow | null, reused: false as const };
  }

  if (existingResult.task?.id) {
    return { ok: true as const, error: null as string | null, taskId: existingResult.task.id, task: existingResult.task, reused: true as const };
  }

  const taskResult = await createAssistantOperationalTask({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    threadId: args.threadId,
    taskType: args.taskType,
    status: "open",
    priority: args.priority || "normal",
    title: args.title,
    description: args.description,
    appointment: args.appointment,
    targetStartIso: args.targetStartIso || null,
    targetEndIso: args.targetEndIso || null,
    timezoneName: args.timezoneName,
    taskPayload: {
      ...args.taskPayload,
      operation_key: args.operationKey,
      customer_message_sent: false,
      agenda_updated: false,
    },
  });

  return { ...taskResult, task: null as StoreAssistantOperationalTaskRow | null, reused: false as const };
}

async function finalizeAssistantCustomerContactTask(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  taskId: string | null;
  existingTask?: StoreAssistantOperationalTaskRow | null;
  customerMessageSent: boolean;
  customerMessageError?: string | null;
  waitingDescription: string;
  openDescription: string;
  taskPayload: Record<string, unknown>;
}) {
  const existingPayload = getOperationalTaskPayload(args.existingTask || null);
  return updateAssistantOperationalTaskAfterCustomerContact({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    taskId: args.taskId,
    status: args.customerMessageSent ? "waiting_customer_response" : "open",
    description: args.customerMessageSent ? args.waitingDescription : args.openDescription,
    taskPayload: {
      ...existingPayload,
      ...args.taskPayload,
      customer_message_sent: args.customerMessageSent,
      customer_message_error: args.customerMessageError || null,
      agenda_updated: false,
      customer_contact_finalized_at: new Date().toISOString(),
    },
  });
}

function getOperationalTaskPayload(task: StoreAssistantOperationalTaskRow | null | undefined) {
  const payload = task?.task_payload;
  return payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, any>) : {};
}

function isResponsibleApprovalForSuggestedTime(text: string) {
  const normalized = normalizeText(text);
  return /\b(sim|pode|pode sim|confirmo|confirmado|confirma|confirmar|pode confirmar|pode atualizar|atualiza|fechado|combinado|ok|beleza|ta bom|está bom)\b/.test(normalized) &&
    !/\b(nao|não|nao pode|não pode|cancela|cancelar|melhor nao|melhor não)\b/.test(normalized);
}

function isResponsibleRejectingSuggestedTime(text: string) {
  return /\b(nao|não|nao pode|não pode|nao confirma|não confirma|melhor nao|melhor não|nao atualiza|não atualiza)\b/.test(normalizeText(text));
}

function findSuggestedTimeApprovalTask(args: { tasks: StoreAssistantOperationalTaskRow[]; assistantContextState?: StoreAssistantContextStateRow | null }) {
  const contextPayload = readAssistantContextPayload(args.assistantContextState || null);
  const contextTaskId = String(contextPayload.task_id || "").trim();
  const candidates = (args.tasks || []).filter((task) => {
    const payload = getOperationalTaskPayload(task);
    return task.task_type === "appointment_reschedule_with_customer" &&
      task.status === "waiting_customer_response" &&
      Boolean(payload.needs_responsible_approval) &&
      typeof payload.suggested_start_at === "string" &&
      typeof payload.suggested_end_at === "string" &&
      Boolean(task.related_appointment_id);
  });

  if (contextTaskId) {
    return { task: candidates.find((candidate) => candidate.id === contextTaskId) || null, ambiguous: false };
  }

  if (candidates.length === 1) return { task: candidates[0], ambiguous: false };
  if (candidates.length > 1) return { task: null, ambiguous: true };
  return { task: null, ambiguous: false };
}

async function checkSuggestedTimeApprovalAvailability(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  appointmentId: string;
  appointmentType: string;
  startIso: string;
  endIso: string;
}) {
  const { data, error } = await args.supabase.rpc("check_store_appointment_availability_by_system", {
    p_organization_id: args.organizationId,
    p_store_id: args.storeId,
    p_appointment_type: args.appointmentType,
    p_start_at: args.startIso,
    p_end_at: args.endIso,
    p_ignore_appointment_id: args.appointmentId,
  });

  if (error) {
    return { available: false, reason: `Erro ao verificar disponibilidade: ${error.message}` };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.available !== true) {
    const reasonCode = String(row?.reason_code || "availability_check_failed");
    const reasonByCode: Record<string, string> = {
      outside_operating_window: "Esse horario esta fora da janela operacional configurada da loja.",
      schedule_block_conflict: "Existe um bloqueio de agenda nesse horario.",
      global_capacity_exceeded: "A capacidade da agenda para esse horario ja foi atingida.",
      installation_team_capacity_exceeded: "A capacidade da equipe de instalacao para esse horario ja foi atingida.",
      installation_team_capacity_invalid: "A capacidade da equipe de instalacao esta configurada de forma invalida.",
      invalid_appointment_type: "O tipo de compromisso nao pode ser validado com seguranca.",
      invalid_request: "O horario informado nao pode ser validado com seguranca.",
    };
    return { available: false, reason: reasonByCode[reasonCode] || "Nao consegui confirmar a disponibilidade desse horario com seguranca." };
  }

  return { available: true, reason: null as string | null };
}

function formatSuggestedDateTimeForResponsible(value: string, timezoneName: string) {
  return `${formatDateOnlyInTimeZone(value, timezoneName)} às ${formatTimeOnlyInTimeZone(value, timezoneName)}`;
}


function buildCustomerConfirmationTextForSuggestedTime(args: { appointment: AppointmentRow; suggestedStartIso: string; timezoneName: string; }) {
  const customerName = args.appointment.customer_name || "tudo bem";
  const appointmentTypeLabel = formatAppointmentType(args.appointment.appointment_type || "compromisso").toLowerCase();
  const suggestedDate = formatDateOnlyInTimeZone(args.suggestedStartIso, args.timezoneName);
  const suggestedTime = formatTimeOnlyInTimeZone(args.suggestedStartIso, args.timezoneName);
  return `Oi, ${customerName}. Confirmado então: sua ${appointmentTypeLabel} ficou para ${suggestedDate} às ${suggestedTime}. Qualquer coisa, é só me avisar.`;
}

export async function resolveSuggestedTimeApprovalReply(args: { supabase: any; organizationId: string; storeId: string; threadId: string; assistantContextState?: StoreAssistantContextStateRow | null; openOperationalTasks: StoreAssistantOperationalTaskRow[]; lastHumanMessage: string; scheduleSettings?: StoreScheduleSettingsRow | null; }) {
  const taskResolution = findSuggestedTimeApprovalTask({
    tasks: args.openOperationalTasks || [],
    assistantContextState: args.assistantContextState || null,
  });
  if (taskResolution.ambiguous) {
    return "Encontrei mais de uma remarcação aguardando sua aprovação. Para evitar atualizar o compromisso errado, identifique o cliente ou a tarefa antes de responder apenas sim ou não.";
  }
  const task = taskResolution.task;
  if (!task) return null;
  const payload = getOperationalTaskPayload(task);
  const suggestedStartIso = String(payload.suggested_start_at || "").trim();
  const suggestedEndIso = String(payload.suggested_end_at || "").trim();
  const timezoneName = task.timezone_name || "America/Sao_Paulo";
  const customerName = task.customer_name || "O cliente";

  if (isResponsibleRejectingSuggestedTime(args.lastHumanMessage)) {
    await args.supabase.from("store_assistant_operational_tasks").update({
      task_payload: { ...payload, needs_responsible_approval: false, responsible_declined_suggested_time: true, responsible_declined_suggested_time_at: new Date().toISOString(), last_responsible_reply: args.lastHumanMessage },
      last_action_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      description: "Responsável não aprovou o horário sugerido. A agenda ainda não foi alterada.",
    }).eq("id", task.id).eq("organization_id", args.organizationId).eq("store_id", args.storeId);
    return `Certo. Não alterei a agenda. ${customerName} tinha sugerido ${payload.suggested_label || "outro horário"}. Me diga qual horário você quer sugerir para eu continuar a remarcação.`;
  }
  if (!isResponsibleApprovalForSuggestedTime(args.lastHumanMessage)) return null;
  if (!suggestedStartIso || !suggestedEndIso) return `Entendi que você quer confirmar o horário sugerido por ${customerName}, mas não encontrei a data e hora sugeridas com segurança. A agenda não foi alterada.`;

  const { data: appointmentRow, error: appointmentError } = await args.supabase
    .from("store_appointments").select("*").eq("id", task.related_appointment_id).eq("organization_id", args.organizationId).eq("store_id", args.storeId).maybeSingle();
  const appointment = appointmentRow as AppointmentRow | null;
  if (appointmentError || !appointment) return `Entendi a aprovação, mas não consegui encontrar o compromisso ligado a essa remarcação. A agenda não foi alterada.`;

  const taskTarget = buildCommercialTargetFromTask(task, "suggested_time_approval_task");
  const appointmentTarget = buildCommercialTargetFromAppointment(appointment, "suggested_time_approval_appointment");
  const updateTargetAssertion = assertCommercialTargetForSideEffect({
    target: appointmentTarget || taskTarget,
    sideEffect: "update_store_appointment",
    expectedConversationId: appointment.conversation_id || null,
    expectedCommercialOpportunityId: task.commercial_opportunity_id || null,
  });
  if (!updateTargetAssertion.ok) {
    return "Entendi a aprovacao, mas o alvo comercial dessa remarcacao nao esta canonicamente consistente. A agenda nao foi alterada.";
  }

  const availability = await checkSuggestedTimeApprovalAvailability({ supabase: args.supabase, organizationId: args.organizationId, storeId: args.storeId, appointmentId: appointment.id, appointmentType: appointment.appointment_type || "other", startIso: suggestedStartIso, endIso: suggestedEndIso });
  if (!availability.available) {
    await args.supabase.from("store_assistant_operational_tasks").update({
      task_payload: { ...payload, needs_responsible_approval: true, suggested_time_available: false, suggested_time_unavailable_reason: availability.reason, suggested_time_checked_at: new Date().toISOString(), last_responsible_reply: args.lastHumanMessage },
      last_action_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      description: "Horário sugerido pelo cliente não está disponível. A agenda ainda não foi alterada.",
    }).eq("id", task.id).eq("organization_id", args.organizationId).eq("store_id", args.storeId);
    return `Antes de confirmar com ${customerName}, verifiquei de novo a agenda e esse horário não está livre: ${availability.reason || "encontrei conflito"}. A agenda não foi alterada.`;
  }

  const { data: updatedAppointment, error: updateError } = await args.supabase.rpc("update_store_appointment", {
    p_appointment_id: appointment.id,
    p_organization_id: args.organizationId,
    p_store_id: args.storeId,
    p_title: appointment.title,
    p_appointment_type: appointment.appointment_type,
    p_status: "rescheduled",
    p_scheduled_start: suggestedStartIso,
    p_scheduled_end: suggestedEndIso,
    p_customer_name: appointment.customer_name,
    p_customer_phone: appointment.customer_phone,
    p_address_text: appointment.address_text,
    p_notes: appointment.notes,
  });
  if (updateError) {
    await args.supabase.from("store_assistant_operational_tasks").update({
      status: "failed", error_text: updateError.message,
      task_payload: { ...payload, last_responsible_reply: args.lastHumanMessage, responsible_approved_suggested_time: true, customer_confirmation_message_sent: false, appointment_update_attempted: true, appointment_update_succeeded: false, last_execution_error: updateError.message, updated_by_assistant_route_at: new Date().toISOString() },
      last_action_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", task.id).eq("organization_id", args.organizationId).eq("store_id", args.storeId);
    return `Não confirmei com ${customerName}, porque a agenda não aceitou esse horário: ${updateError.message}`;
  }

  const updatedAppointmentWithCommercialContext =
    updatedAppointment as (AppointmentRow & {
      commercial_opportunity_id?: string | null;
    }) | null;
  const appointmentWithCommercialContext =
    appointment as AppointmentRow & {
      commercial_opportunity_id?: string | null;
    };
  const updatedAppointmentCommercialOpportunityId =
    String(
      updatedAppointmentWithCommercialContext?.commercial_opportunity_id ||
        appointmentWithCommercialContext.commercial_opportunity_id ||
        "",
    ).trim() || null;
  const projectionWarning =
    typeof updatedAppointment?.id === "string"
      ? await maybeProjectAppointmentToTechnicalVisitStageBySystem({
          supabase: args.supabase,
          organizationId: args.organizationId,
          storeId: args.storeId,
          appointmentId: updatedAppointment.id,
          appointmentType:
            updatedAppointmentWithCommercialContext?.appointment_type ||
            appointment.appointment_type,
          appointmentStatus:
            updatedAppointmentWithCommercialContext?.status || "rescheduled",
          commercialOpportunityId: updatedAppointmentCommercialOpportunityId,
          source: "assistant_reply_route",
          operationSummary: "atualizado",
        })
      : null;

  const customerMessageResult = appointment.conversation_id
    ? await sendAiMessageToCustomerConversation({
        supabase: args.supabase,
        conversationId: appointment.conversation_id,
        text: buildCustomerConfirmationTextForSuggestedTime({ appointment, suggestedStartIso, timezoneName }),
        target: appointmentTarget || taskTarget,
      })
    : null;
  if (!customerMessageResult?.ok) {
    await args.supabase.from("store_assistant_operational_tasks").update({
      status: "failed", error_text: customerMessageResult?.error || "Conversa do cliente não encontrada.",
      task_payload: { ...payload, last_responsible_reply: args.lastHumanMessage, responsible_approved_suggested_time: true, customer_confirmation_message_sent: false, appointment_update_attempted: true, appointment_update_succeeded: true, updated_appointment: updatedAppointment, commercial_projection_warning: projectionWarning, last_execution_error: customerMessageResult?.error || "Conversa do cliente não encontrada.", updated_by_assistant_route_at: new Date().toISOString() },
      last_action_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", task.id).eq("organization_id", args.organizationId).eq("store_id", args.storeId);
    return `Atualizei a agenda para ${formatSuggestedDateTimeForResponsible(suggestedStartIso, timezoneName)}, mas não consegui avisar ${customerName}. ${customerMessageResult?.error ? `Erro: ${customerMessageResult.error}` : "Conversa do cliente não encontrada."}${projectionWarning ? ` Aviso: ${projectionWarning}` : ""}`;
  }

  const resolvedPayload: Record<string, unknown> = { ...payload, needs_responsible_approval: false, responsible_approved_suggested_time: true, responsible_approved_suggested_time_at: new Date().toISOString(), last_responsible_reply: args.lastHumanMessage, customer_confirmation_message_sent: true, customer_confirmation_message_id: customerMessageResult.messageId || null, appointment_update_attempted: true, appointment_update_succeeded: true, updated_appointment: updatedAppointment, updated_by_assistant_route_at: new Date().toISOString() };
  if (projectionWarning) {
    resolvedPayload.commercial_projection_warning = projectionWarning;
  }
  const { error: taskUpdateError } = await args.supabase.from("store_assistant_operational_tasks").update({
    status: "resolved", resolved_at: new Date().toISOString(), task_payload: resolvedPayload,
    last_action_at: new Date().toISOString(), description: "Responsável aprovou o horário sugerido pelo cliente. Cliente avisado e agenda atualizada.", updated_at: new Date().toISOString(),
  }).eq("id", task.id).eq("organization_id", args.organizationId).eq("store_id", args.storeId);
  if (taskUpdateError) return `Atualizei a agenda e avisei ${customerName}, mas não consegui finalizar a tarefa operacional: ${taskUpdateError.message}${projectionWarning ? ` Aviso: ${projectionWarning}` : ""}`;

  const contextResult = await resolveAssistantContextState({ supabase: args.supabase, organizationId: args.organizationId, storeId: args.storeId, threadId: args.threadId, currentContextState: args.assistantContextState || null, lastUserMessage: args.lastHumanMessage, lastAssistantMessage: `${customerName} confirmado em ${formatSuggestedDateTimeForResponsible(suggestedStartIso, timezoneName)}.` });
  if (!contextResult.ok) {
    return `Atualizei a agenda e avisei ${customerName}, mas não consegui fechar o contexto da Assistente: ${contextResult.error || "erro desconhecido"}. Reconciliação necessária.`;
  }
  return `Pronto. Confirmei com ${customerName} e atualizei ${appointment.title} para ${formatSuggestedDateTimeForResponsible(suggestedStartIso, timezoneName)}.${projectionWarning ? `\n\nAviso: ${projectionWarning}` : ""}`;
}

function buildProfessionalAppointmentClarificationReply(args: {
  action: ScheduleAction;
  text: string;
  openAppointments: AppointmentRow[];
  scheduleSettings?: StoreScheduleSettingsRow | null;
}) {
  const sorted = sortOpenScheduleAppointments(args.openAppointments || []);
  const currentMatches = resolveAppointmentCandidateIndexesFromText({
    text: args.text,
    openAppointments: sorted,
  });

  const candidateIndexes = currentMatches.length
    ? currentMatches
    : sorted.map((_, index) => index).slice(0, 6);

  if (!candidateIndexes.length) {
    return "Não encontrei compromisso em aberto para mexer agora. Me diga o cliente, o título ou a data do compromisso que você quer alterar.";
  }

  const actionLabel = args.action === "cancel"
    ? "cancelar"
    : args.action === "complete"
      ? "marcar como concluído"
      : args.action === "reschedule"
        ? "tentar remarcar"
        : "atualizar";

  const reschedulePayload = args.action === "reschedule"
    ? extractReschedulePayload(args.text, getScheduleParsingNow(args.scheduleSettings || null), args.scheduleSettings || null)
    : null;

  const targetLabel = reschedulePayload?.ok
    ? ` para ${formatDateOnlyInTimeZone(reschedulePayload.payload.scheduled_start, getScheduleTimezone(args.scheduleSettings || null))} às ${formatTimeOnlyInTimeZone(reschedulePayload.payload.scheduled_start, getScheduleTimezone(args.scheduleSettings || null))}`
    : "";

  const lines: string[] = [];
  lines.push(`Entendi que você quer ${actionLabel} um compromisso${targetLabel}, mas preciso saber qual item da agenda é.`);
  lines.push("");
  lines.push("Encontrei estas opções mais prováveis:");

  candidateIndexes.slice(0, 6).forEach((candidateIndex) => {
    const appointment = sorted[candidateIndex];
    const referenceLabel = buildScheduleAppointmentReferenceLabel(appointment);
    const customer = appointment?.customer_name || "cliente não identificado";
    const start = appointment?.scheduled_start || appointment?.scheduled_end;
    const end = appointment?.scheduled_end;
    const timeRange = start
      ? `${formatDateOnlyInTimeZone(start, getScheduleTimezone(args.scheduleSettings || null))} das ${formatTimeOnlyInTimeZone(start, getScheduleTimezone(args.scheduleSettings || null))}${end ? ` às ${formatTimeOnlyInTimeZone(end, getScheduleTimezone(args.scheduleSettings || null))}` : ""}`
      : "sem horário carregado";

    lines.push(`${candidateIndex + 1}. ${referenceLabel.charAt(0).toUpperCase() + referenceLabel.slice(1)} — ${customer} — ${timeRange}`);
  });

  lines.push("");
  if (args.action === "reschedule") {
    lines.push(`Me diga o número do item. Exemplo: "remarque o item ${candidateIndexes[0] + 1}${targetLabel}".`);
    lines.push("Se envolver cliente, eu falo com ele antes de alterar a agenda.");
  } else {
    lines.push(`Me diga o número do item. Exemplo: "${actionLabel} o item ${candidateIndexes[0] + 1}".`);
  }

  return lines.join("\n").trim();
}

function hasCustomerConfirmedRescheduleWithResponsible(text: string) {
  const t = normalizeText(text);
  return hasAnyTerm(t, [
    "cliente confirmou",
    "cliente ja confirmou",
    "cliente já confirmou",
    "ja combinei com o cliente",
    "já combinei com o cliente",
    "ja falei com o cliente",
    "já falei com o cliente",
    "confirmado com o cliente",
    "pode atualizar a agenda",
    "atualize a agenda",
    "altere a agenda",
    "mude na agenda",
  ]);
}

function shouldCoordinateRescheduleWithCustomer(text: string, appointment: AppointmentRow | null | undefined) {
  if (!appointment) return isClientFacingRescheduleRequest(text);
  if (hasCustomerConfirmedRescheduleWithResponsible(text)) return false;

  const hasCustomerContext = Boolean(
    appointment.customer_name ||
    appointment.customer_phone ||
    appointment.conversation_id ||
    appointment.lead_id
  );

  if (!hasCustomerContext) return isClientFacingRescheduleRequest(text);

  return true;
}

function hasUnsupportedCustomerContactSuccessClaim(text: string) {
  const t = normalizeText(text);
  return hasAnyTerm(t, [
    "vou alinhar com",
    "ja estou alinhando com",
    "já estou alinhando com",
    "estou alinhando com",
    "vou enviar mensagem",
    "enviei mensagem",
    "enviei uma mensagem",
    "ja enviei mensagem",
    "já enviei mensagem",
    "vou avisar o cliente",
    "avisei o cliente",
    "vou falar com",
    "falei com",
    "vou combinar com",
    "estou combinando com",
    "assim que ela confirmar",
    "assim que ele confirmar",
    "assim que o cliente confirmar",
  ]);
}

function hasUnsupportedOperationalSuccessClaim(text: string) {
  const t = normalizeText(text);

  if (hasAnyTerm(t, [
    "nao atualizei",
    "nao ajustei",
    "nao cancelei",
    "nao remarquei",
    "nao reagendei",
    "nao confirmei",
    "nao conclui",
    "nao bloqueei",
    "nao consegui atualizar",
    "nao consegui ajustar",
    "nao consegui cancelar",
    "nao consegui remarcar",
    "nao consegui bloquear",
  ])) {
    return false;
  }

  return hasAnyTerm(t, [
    "atualizei a agenda",
    "agenda atualizada",
    "agenda ja atualizada",
    "agenda esta atualizada",
    "ajustei a agenda",
    "agenda ajustada",
    "registrei na agenda",
    "registro na agenda",
    "cancelei o compromisso",
    "compromisso cancelado",
    "ja esta cancelado",
    "remarquei o compromisso",
    "compromisso remarcado",
    "reagendei o compromisso",
    "compromisso reagendado",
    "ja esta remarcado",
    "ja esta atualizado",
    "confirmei o horario",
    "horario confirmado",
    "conclui o compromisso",
    "compromisso concluido",
    "marquei como concluido",
    "bloqueei a agenda",
    "agenda bloqueada",
    "criei o bloqueio",
    "deixei bloqueado",
    "pronto ajustei",
    "pronto, ajustei",
    "pronto cancelei",
    "pronto, cancelei",
    "pronto remarquei",
    "pronto, remarquei",
    "pronto bloqueei",
    "pronto, bloqueei",
    "ja atualizei",
    "ja cancelei",
    "ja remarquei",
    "ja bloqueei",
    "ja confirmei",
    "ja conclui",
  ]);
}

function buildUnsafeOperationalSuccessClaimFallback() {
  return "Para evitar confirmar algo que ainda não foi executado com segurança, não vou tratar essa ação como concluída agora. Me diga exatamente o que você quer fazer na agenda, com o nome do cliente/compromisso e a data/horário, que eu sigo pelo fluxo correto.";
}

function buildUnsafeCustomerContactSuccessClaimFallback(args: {
  contextState?: StoreAssistantContextStateRow | null;
  scheduleSettings?: StoreScheduleSettingsRow | null;
}) {
  const customerName = args.contextState?.active_customer_name || "o cliente";
  const timeZone = getScheduleTimezone(args.scheduleSettings || null);
  const targetDate = args.contextState?.target_start_at
    ? formatDateOnlyInTimeZone(args.contextState.target_start_at, timeZone)
    : args.contextState?.target_date
      ? formatDatePartsForHuman(parseDbDateKeyToScheduleParts(args.contextState.target_date))
      : null;
  const targetTime = args.contextState?.target_start_at
    ? formatTimeOnlyInTimeZone(args.contextState.target_start_at, timeZone)
    : args.contextState?.target_time || null;
  const targetLabel = targetDate && targetTime ? ` e o horário ${targetDate} às ${targetTime}` : "";

  return `Encontrei o contexto de ${customerName}${targetLabel}, mas não consegui confirmar um envio real de mensagem para o cliente agora. A agenda não foi alterada.`;
}

function asksAssistantToFindCustomerAvailability(text: string) {
  const t = normalizeText(text);
  return hasAnyTerm(t, [
    "veja com o cliente",
    "ver com o cliente",
    "fale com o cliente",
    "fala com o cliente",
    "confere com o cliente",
    "confirme com o cliente",
    "alinhe com o cliente",
    "pergunte para o cliente",
    "pergunta para o cliente",
    "ver um horario",
    "ver um horário",
    "horario bom",
    "horário bom",
    "horario que ele consiga",
    "horário que ele consiga",
    "horario disponivel",
    "horário disponível",
    "quando ele pode",
    "quando ela pode",
    "melhor horario para ele",
    "melhor horário para ele",
    "melhor horario para ela",
    "melhor horário para ela",
  ]);
}

function resolveTargetAppointmentIndex(args: {
  text: string;
  openAppointments: AppointmentRow[];
  recentMessages?: AssistantMessageRow[];
  assistantContextState?: StoreAssistantContextStateRow | null;
  now?: Date;
  scheduleSettings?: StoreScheduleSettingsRow | null;
}) {
  const contextSelection = resolveAppointmentSelectionFromContextFirst({
    text: args.text,
    openAppointments: args.openAppointments,
    contextState: args.assistantContextState || null,
  });

  if (contextSelection.type === "unique") {
    return { type: "unique" as const, index: contextSelection.index };
  }

  if (contextSelection.type === "invalid_choice") {
    return { type: "none" as const };
  }

  const explicitScheduleIndex = resolveExplicitAppointmentItemIndex(args.text, args.openAppointments.length);
  if (explicitScheduleIndex !== null) {
    return { type: "unique" as const, index: explicitScheduleIndex };
  }

  const explicitIndex = resolvePostAppointmentDetailIndex(args.text, args.openAppointments.length);
  if (explicitIndex !== null) {
    return { type: "unique" as const, index: explicitIndex };
  }

  const currentCandidates = resolveAppointmentCandidateIndexesFromText({
    text: args.text,
    openAppointments: args.openAppointments,
  });

  const refinedCandidates = currentCandidates.length > 1
    ? refineAppointmentCandidateIndexesByOriginalSchedule({
        text: args.text,
        openAppointments: args.openAppointments,
        candidateIndexes: currentCandidates,
        now: args.now || getScheduleParsingNow(args.scheduleSettings || null),
        settings: args.scheduleSettings || null,
      })
    : currentCandidates;

  if (refinedCandidates.length === 1) {
    return { type: "unique" as const, index: refinedCandidates[0] };
  }

  if (refinedCandidates.length > 1) {
    return { type: "ambiguous" as const, candidateIndexes: refinedCandidates };
  }

  const hasExplicitTitleAndOriginalSchedule = hasExplicitAppointmentTitleAndOriginalScheduleReference({
    text: args.text,
    now: args.now || getScheduleParsingNow(args.scheduleSettings || null),
    scheduleSettings: args.scheduleSettings || null,
  });

  // Se o responsável passou título do compromisso + data/hora original,
  // não podemos cair no contexto anterior. Melhor pedir esclarecimento do que falar com cliente errado.
  if (hasExplicitTitleAndOriginalSchedule) {
    return { type: "none" as const };
  }

  const contextIndex = resolveAppointmentIndexFromAssistantContext({
    text: args.text,
    openAppointments: args.openAppointments,
    contextState: args.assistantContextState || null,
  });

  if (contextIndex !== null) {
    return { type: "unique" as const, index: contextIndex };
  }

  if (
    hasAnyTerm(normalizeText(args.text), [
      "esse foi",
      "esse caso",
      "esse atendimento",
      "esse daqui",
      "isso daqui",
      "isso ai",
      "isso aí",
      "esse aqui",
      "pode marcar esse",
      "pode cancelar esse",
      "pode concluir esse",
      "pode deixar esse",
      "esse da instalacao",
      "esse da instalação",
      "esse da visita",
      "o da instalacao",
      "o da instalação",
      "o da visita",
      "aquele que eu falei",
      "o que eu acabei de citar",
      "marque como",
      "marca como",
      "marque o caso",
      "cancele",
      "conclua",
      "considerar concluido",
      "considerar concluída",
      "considerar concluida",
    ])
  ) {
    const previousTarget = inferPreviousAppointmentTarget({
      messages: args.recentMessages || [],
      currentHumanMessage: args.text,
      openAppointments: args.openAppointments,
    });

    if (previousTarget) {
      return previousTarget;
    }
  }

  return { type: "none" as const };
}

type ScheduleAction = "create" | PostAppointmentAction;

type AssistantCustomerIdentityCandidate = {
  option_number: number;
  customer_id: string | null;
  lead_id: string;
  conversation_id: string | null;
  commercial_opportunity_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  opportunity_stage: string | null;
};

type SafeCustomerIdentityGateResult =
  | { type: "allow"; candidate: AssistantCustomerIdentityCandidate | null }
  | { type: "blocked"; reply: string };

function resolveScheduleAction(text: string): ScheduleAction | null {
  const t = normalizeText(text);

  // Strong reschedule verbs win before CREATE terms such as "marque".
  if (hasAnyTerm(t, [
    "remarque", "remarca", "remarcar", "reagende", "reagenda", "reagendar",
    "mude a visita", "muda a visita", "mudar a visita",
    "mude o compromisso", "muda o compromisso", "mudar o compromisso",
  ])) return "reschedule";

  if (
    hasAnyTerm(t, [
      "agende",
      "agendar",
      "crie compromisso",
      "crie um compromisso",
      "criar compromisso",
      "criar um compromisso",
      "criar compromisso",
      "novo compromisso",
      "adicionar compromisso",
      "adiciona um compromisso",
      "adicione um compromisso",
      "marque visita",
      "marcar visita para",
      "marque instalacao",
      "marque instalação",
      "marcar instalacao para",
      "marcar instalação para",
      "marcar manutencao para",
      "marcar manutenção para",
      "marcar reuniao para",
      "marcar reunião para",
      "nova visita",
      "nova instalacao",
      "nova instalação",
      "nova manutencao",
      "nova manutenção",
      "novo atendimento",
    ])
  ) {
    return "create";
  }

  if (
    hasAnyTerm(t, [
      "remarque",
      "remarca",
      "remarcar",
      "reagende",
      "reagenda",
      "reagendar",
      "mude a visita",
      "muda a visita",
      "mudar a visita",
      "mude o compromisso",
      "muda o compromisso",
      "mudar o compromisso",
      "mude a instalacao",
      "mude a instalação",
      "muda a instalacao",
      "muda a instalação",
    ])
  ) {
    return "reschedule";
  }

  if (
    hasAnyTerm(t, [
      "cancelar compromisso",
      "cancelar visita",
      "cancelar instalacao",
      "cancelar instalação",
      "cancele o compromisso",
      "cancele a visita",
      "cancele a instalacao",
      "cancele a instalação",
    ])
  ) {
    return "cancel";
  }

  if (
    hasAnyTerm(t, [
      "concluir compromisso",
      "concluir visita",
      "concluir instalacao",
      "concluir instalação",
      "conclua o compromisso",
      "conclua a visita",
      "conclua a instalacao",
      "conclua a instalação",
      "foi concluido",
      "foi concluído",
      "foi concluida",
      "foi concluída",
    ])
  ) {
    return "complete";
  }

  return resolvePostAppointmentAction(text);
}

function inferAppointmentTypeFromText(text: string): string {
  const t = normalizeText(text);
  if (t.includes("visita tecnica") || t.includes("visita técnica")) return "technical_visit";
  if (t.includes("instalacao") || t.includes("instalação")) return "installation";
  if (t.includes("manutencao") || t.includes("manutenção")) return "maintenance";
  if (t.includes("medicao") || t.includes("medição")) return "measurement";
  if (t.includes("reuniao") || t.includes("reunião")) return "meeting";
  if (t.includes("follow up") || t.includes("follow-up")) return "follow_up";
  return "other";
}

function inferAppointmentTypeLabelFromCode(typeCode: string): string {
  return formatAppointmentType(typeCode);
}

function safeCapitalize(value: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function extractCustomerNameFromText(text: string): string | null {
  const patterns = [
    /para\s+([a-z\u00c0-\u00ff0-9][a-z\u00c0-\u00ff0-9\s_-]{1,60}?)(?=\s+(?:dia|no dia|na data|as|a\s+partir|no endereco|no endere\u00e7o|endereco|endere\u00e7o|telefone|contato)\b|$)/i,
    /cliente\s+([a-zà-ÿ0-9][a-zà-ÿ0-9\s_-]{1,60}?)(?=\s+(?:dia|no dia|na data|as|às|para|com|endereco|endereço|telefone|contato)\b|$)/i,
    /com\s+([a-zà-ÿ0-9][a-zà-ÿ0-9\s_-]{1,60}?)(?=\s+(?:dia|no dia|na data|as|às|para|endereco|endereço|telefone|contato)\b|$)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return safeCapitalize(match[1].trim());
    }
  }

  return null;
}

function maskPhoneForAssistantIdentity(phone: string | null | undefined) {
  const digits = normalizeDigits(phone);
  if (digits.length < 4) return null;
  return `telefone final ${digits.slice(-4)}`;
}

function formatOpportunityStageForAssistantIdentity(stage: string | null | undefined) {
  const normalized = normalizeText(stage);
  if (!normalized) return null;
  if (normalized === "novo_lead") return "oportunidade em Novo lead";
  if (normalized === "qualificacao") return "oportunidade em Qualificacao";
  if (normalized === "proposta") return "oportunidade em Proposta";
  if (normalized === "negociacao") return "oportunidade em Negociacao";
  if (normalized === "ganho") return "oportunidade ganha";
  if (normalized === "perdido") return "oportunidade perdida";
  return `oportunidade em ${stage}`;
}

function buildCustomerIdentityCandidateLine(candidate: AssistantCustomerIdentityCandidate) {
  const parts = [
    `${candidate.option_number}. ${candidate.customer_name || "Cliente sem nome"}`,
    maskPhoneForAssistantIdentity(candidate.customer_phone),
    formatOpportunityStageForAssistantIdentity(candidate.opportunity_stage),
  ].filter(Boolean);

  return parts.join(" - ");
}

export function buildCustomerIdentityDisambiguationReply(args: {
  candidates: AssistantCustomerIdentityCandidate[];
  requestedName: string;
  operatorName?: string | null;
}) {
  const operatorPrefix = args.operatorName ? `${args.operatorName}, ` : "";
  const lines = [
    `${operatorPrefix}encontrei ${args.candidates.length} clientes chamados ${args.requestedName}. Qual deles voce quer?`,
    "",
    ...args.candidates.slice(0, 8).map(buildCustomerIdentityCandidateLine),
    "",
    "Pode me dizer o numero ou uma caracteristica que diferencie o cliente?",
  ];

  return lines.join("\n").trim();
}

function buildCustomerIdentityNeedsMoreInfoReply(args: { requestedName?: string | null; operatorName?: string | null }) {
  const operatorPrefix = args.operatorName ? `${args.operatorName}, ` : "";
  const suffix = args.requestedName ? ` para ${args.requestedName}` : "";
  return `${operatorPrefix}preciso identificar o cliente com seguranca antes de agir${suffix}. Me envie telefone, sobrenome ou outra informacao do cliente.`;
}

function readAssistantCustomerIdentityCandidates(contextState?: StoreAssistantContextStateRow | null) {
  const raw = contextState?.candidate_options;
  if (!Array.isArray(raw)) return [] as AssistantCustomerIdentityCandidate[];

  return raw
    .map((item) => item as Partial<AssistantCustomerIdentityCandidate>)
    .filter((item) => {
      const optionNumber = Number(item.option_number);
      const leadId = String(item.lead_id || "").trim();
      const name = String(item.customer_name || "").trim();
      return Number.isInteger(optionNumber) && optionNumber >= 1 && Boolean(leadId) && Boolean(name);
    })
    .map((item) => ({
      option_number: Number(item.option_number),
      customer_id: String(item.customer_id || "").trim() || null,
      lead_id: String(item.lead_id || "").trim(),
      conversation_id: String(item.conversation_id || "").trim() || null,
      commercial_opportunity_id: String(item.commercial_opportunity_id || "").trim() || null,
      customer_name: String(item.customer_name || "").trim(),
      customer_phone: String(item.customer_phone || "").trim() || null,
      opportunity_stage: String(item.opportunity_stage || "").trim() || null,
    }));
}

export function resolveCustomerIdentityCandidateFromText(args: {
  text: string;
  candidates: AssistantCustomerIdentityCandidate[];
}) {
  const explicitIndex = resolveExplicitAppointmentItemIndex(args.text, args.candidates.length);
  if (explicitIndex !== null) {
    return args.candidates[explicitIndex] || null;
  }

  const normalizedText = normalizeText(args.text);
  const digitText = normalizeDigits(args.text);
  const matches = args.candidates.filter((candidate) => {
    const phoneDigits = normalizeDigits(candidate.customer_phone);
    if (phoneDigits.length >= 4 && digitText.includes(phoneDigits.slice(-4))) return true;
    const stage = normalizeText(formatOpportunityStageForAssistantIdentity(candidate.opportunity_stage));
    if (stage && normalizedText.includes(stage.replace(/^oportunidade em\s+/, ""))) return true;
    return false;
  });

  return matches.length === 1 ? matches[0] : null;
}

function extractPhoneFromText(text: string): string | null {
  const match = text.match(/(?:\+?\d[\d\s()\-]{7,}\d)/);
  if (!match?.[0]) return null;
  const digits = normalizeDigits(match[0]);
  if (digits.length < 8) return null;
  return match[0].trim();
}

function extractAddressFromText(text: string): string | null {
  const patterns = [
    /(?:endereco|endereço)\s+(.+?)(?=\s+(?:dia|no dia|na data|as|às|telefone|contato)\b|$)/i,
    /(?:na rua|na avenida|na av\.?|na estrada)\s+(.+?)(?=\s+(?:dia|no dia|na data|as|às|telefone|contato)\b|$)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function extractTitleFromText(text: string, typeCode: string, customerName?: string | null): string {
  const quoted = text.match(/["“”']([^"“”']{2,80})["“”']/);
  if (quoted?.[1]) {
    return safeCapitalize(quoted[1].trim());
  }

  const patterns = [
    /(?:titulo|título)\s+(.+?)(?=\s+(?:cliente|com|dia|no dia|na data|as|às|telefone|contato|endereco|endereço)\b|$)/i,
    /(?:visita tecnica|visita técnica|instalacao|instalação|manutencao|manutenção|reuniao|reunião|medicao|medição|compromisso)\s+(.+?)(?=\s+(?:cliente|com|dia|no dia|na data|as|às|telefone|contato|endereco|endereço)\b|$)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const cleaned = match[1]
        .replace(/^(de|do|da)\s+/i, "")
        .replace(/\s+/g, " ")
        .trim();
      if (cleaned) return safeCapitalize(cleaned);
    }
  }

  const base = inferAppointmentTypeLabelFromCode(typeCode);
  if (customerName) return `${safeCapitalize(base)} ${customerName}`;
  return safeCapitalize(base);
}

function isClientFacingRescheduleRequest(text: string) {
  const t = normalizeText(text);

  const rescheduleCue =
    t.includes("remarca") ||
    t.includes("remarque") ||
    t.includes("remarcar") ||
    t.includes("reagenda") ||
    t.includes("reagende") ||
    t.includes("reagendar") ||
    t.includes("muda a visita") ||
    t.includes("mude a visita") ||
    t.includes("mudar a visita") ||
    t.includes("muda a instalacao") ||
    t.includes("mude a instalacao") ||
    t.includes("mudar a instalacao") ||
    t.includes("muda a instalação") ||
    t.includes("mude a instalação") ||
    t.includes("mudar a instalação");

  if (!rescheduleCue) return false;

  return (
    t.includes("cliente") ||
    t.includes("visita") ||
    t.includes("instalacao") ||
    t.includes("instalação") ||
    t.includes("medicao") ||
    t.includes("medição") ||
    t.includes("manutencao") ||
    t.includes("manutenção") ||
    /\bdo\s+[a-z0-9]/.test(t) ||
    /\bda\s+[a-z0-9]/.test(t)
  );
}

function buildResponsibleRescheduleContactReply(args: {
  appointment: AppointmentRow;
  targetStartIso: string;
  customerMessageSent: boolean;
  scheduleSettings?: StoreScheduleSettingsRow | null;
}) {
  const customerName = String(args.appointment.customer_name || "cliente").trim() || "cliente";
  const appointmentTypeLabel = formatAppointmentType(args.appointment.appointment_type);
  const timeZone = getScheduleTimezone(args.scheduleSettings || null);
  const targetDate = formatDateOnlyInTimeZone(args.targetStartIso, timeZone);
  const targetTime = formatTimeOnlyInTimeZone(args.targetStartIso, timeZone);

  if (args.customerMessageSent) {
    return `Certo. Enviei uma mensagem para ${customerName} para alinhar a remarcação da ${appointmentTypeLabel} para ${targetDate} às ${targetTime}. A agenda ainda não foi alterada; assim que o cliente confirmar, eu atualizo e te aviso por aqui.`;
  }

  return `Encontrei a ${appointmentTypeLabel} de ${customerName}, mas não encontrei uma conversa vinculada para falar com o cliente automaticamente. A agenda ainda não foi alterada. Confirme o novo horário com o cliente e, depois disso, eu atualizo a agenda para ${targetDate} às ${targetTime}.`;
}

function buildCustomerAvailabilityQuestion(args: { appointment: AppointmentRow; scheduleSettings?: StoreScheduleSettingsRow | null }) {
  const customerName = String(args.appointment.customer_name || "cliente").trim() || "cliente";
  const appointmentTypeLabel = formatAppointmentType(args.appointment.appointment_type);
  const timeZone = getScheduleTimezone(args.scheduleSettings || null);
  const currentDate = formatDateOnlyInTimeZone(args.appointment.scheduled_start || args.appointment.scheduled_end, timeZone);
  const currentTime = formatTimeOnlyInTimeZone(args.appointment.scheduled_start || args.appointment.scheduled_end, timeZone);
  return `Oi, ${customerName}. Passando aqui para alinhar a remarcação da sua ${appointmentTypeLabel}, que está prevista para ${currentDate} às ${currentTime}. Quais horários ficam bons para você? Assim que você me responder, eu confirmo com a loja e atualizo a agenda.`;
}

function buildResponsibleAvailabilityRequestReply(args: { appointment: AppointmentRow; customerMessageSent: boolean }) {
  const customerName = String(args.appointment.customer_name || "cliente").trim() || "cliente";
  const appointmentTypeLabel = formatAppointmentType(args.appointment.appointment_type);

  if (args.customerMessageSent) {
    return `Certo. Enviei uma mensagem para ${customerName} para verificar um novo horário para a ${appointmentTypeLabel}. A agenda ainda não foi alterada; quando o cliente responder, eu atualizo o caso e te aviso por aqui.`;
  }

  return `Encontrei a ${appointmentTypeLabel} de ${customerName}, mas não consegui enviar mensagem automática para o cliente porque não encontrei conversa vinculada. A agenda ainda não foi alterada.`;
}


async function resolveCustomerAvailabilityRequestFromContext(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  threadId?: string | null;
  assistantContextState?: StoreAssistantContextStateRow | null;
  lastHumanMessage: string;
  openAppointments: AppointmentRow[];
  scheduleSettings?: StoreScheduleSettingsRow | null;
}) {
  if (!asksAssistantToFindCustomerAvailability(args.lastHumanMessage)) return null;

  const scheduleTimezone = getScheduleTimezone(args.scheduleSettings || null);
  const openAppointments = sortOpenScheduleAppointments(args.openAppointments || []);
  const contextAppointmentId = args.assistantContextState?.active_appointment_id || null;
  const appointment = contextAppointmentId
    ? openAppointments.find((item) => item.id === contextAppointmentId) || null
    : null;

  if (!appointment) {
    return "Entendi que você quer falar com o cliente, mas não encontrei um compromisso ativo no contexto. Me diga o cliente ou escolha um item da lista antes de eu registrar essa tratativa.";
  }

  let customerMessageSent = false;
  if (!args.threadId) {
    return "Encontrei o compromisso, mas nÃ£o consegui registrar a tratativa porque a conversa da assistente nÃ£o foi identificada. A agenda ainda nÃ£o foi alterada.";
  }

  const preTaskResult = await createAssistantOperationalTask({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    threadId: args.threadId,
    taskType: "appointment_reschedule_find_customer_availability",
    status: "open",
    priority: "normal",
    title: `Verificar novo horÃ¡rio com ${appointment.customer_name || "cliente"}`,
    description: "A assistente registrou a tratativa para verificar disponibilidade com o cliente. A agenda ainda nÃ£o foi alterada.",
    appointment,
    targetStartIso: args.assistantContextState?.target_start_at || null,
    targetEndIso: args.assistantContextState?.target_end_at || null,
    timezoneName: scheduleTimezone,
    taskPayload: {
      source: "assistant.reply.route",
      original_user_message: args.lastHumanMessage,
      customer_message_sent: false,
      agenda_updated: false,
      active_context_id: args.assistantContextState?.id || null,
      requested_action: "find_customer_availability",
    },
  });
  if (!preTaskResult.ok) {
    return `Encontrei o compromisso, mas nÃ£o consegui registrar a tratativa operacional: ${preTaskResult.error}. A agenda ainda nÃ£o foi alterada.`;
  }
  const preTaskLoadResult = await loadAssistantOperationalTaskById({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    taskId: preTaskResult.taskId,
  });
  if (!preTaskLoadResult.ok) {
    return `Registrei a tratativa operacional, mas nÃ£o consegui confirmar a task antes do contato: ${preTaskLoadResult.error}. A agenda ainda nÃ£o foi alterada.`;
  }
  const previousCustomerMessageSent = getOperationalTaskPayload(preTaskLoadResult.task).customer_message_sent === true;

  if (appointment.conversation_id) {
    const customerMessage = buildCustomerAvailabilityQuestion({
      appointment,
      scheduleSettings: args.scheduleSettings || null,
    });
    if (previousCustomerMessageSent) {
      customerMessageSent = true;
    } else {
      const sendResult = await sendAiMessageToCustomerConversation({
        supabase: args.supabase,
        conversationId: appointment.conversation_id,
        text: customerMessage,
        target: buildCommercialTargetFromAppointment(appointment, "customer_availability_request"),
      });
      customerMessageSent = sendResult.ok;
    }
  }

  if (!args.threadId) {
    return "Encontrei o compromisso, mas não consegui registrar a tratativa porque a conversa da assistente não foi identificada. A agenda ainda não foi alterada.";
  }

  const taskResult = await createAssistantOperationalTask({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    threadId: args.threadId,
    taskType: "appointment_reschedule_find_customer_availability",
    status: customerMessageSent ? "waiting_customer_response" : "open",
    priority: "normal",
    title: `Verificar novo horário com ${appointment.customer_name || "cliente"}`,
    description: customerMessageSent
      ? "A assistente enviou mensagem ao cliente para verificar disponibilidade. A agenda ainda não foi alterada."
      : "A assistente registrou a tratativa para verificar disponibilidade com o cliente. A agenda ainda não foi alterada.",
    appointment,
    targetStartIso: args.assistantContextState?.target_start_at || null,
    targetEndIso: args.assistantContextState?.target_end_at || null,
    timezoneName: scheduleTimezone,
    taskPayload: {
      source: "assistant.reply.route",
      original_user_message: args.lastHumanMessage,
      customer_message_sent: customerMessageSent,
      agenda_updated: false,
      active_context_id: args.assistantContextState?.id || null,
      requested_action: "find_customer_availability",
    },
  });

  if (!taskResult.ok) {
    return `Encontrei o compromisso, mas não consegui registrar a tratativa operacional: ${taskResult.error}. A agenda ainda não foi alterada.`;
  }

  await upsertAssistantContextState({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    threadId: args.threadId,
    currentContextState: args.assistantContextState || null,
    patch: {
      active_topic: "appointment_reschedule",
      active_intent: "find_customer_availability",
      active_status: customerMessageSent ? "waiting_customer_response" : "active",
      active_customer_name: appointment.customer_name || args.assistantContextState?.active_customer_name || null,
      active_customer_phone: appointment.customer_phone || args.assistantContextState?.active_customer_phone || null,
      active_lead_id: appointment.lead_id || args.assistantContextState?.active_lead_id || null,
      active_conversation_id: appointment.conversation_id || args.assistantContextState?.active_conversation_id || null,
      active_appointment_id: appointment.id,
      target_date: args.assistantContextState?.target_date || null,
      target_time: args.assistantContextState?.target_time || null,
      target_start_at: args.assistantContextState?.target_start_at || null,
      target_end_at: args.assistantContextState?.target_end_at || null,
      timezone_name: scheduleTimezone,
      candidate_options: [],
      context_payload: {
        reason: "waiting_customer_availability_before_reschedule",
        customer_message_sent: customerMessageSent,
        task_created: true,
        task_id: taskResult.taskId,
        agenda_updated: false,
      },
      last_user_message: args.lastHumanMessage,
      last_assistant_message: buildTaskRegisteredReply({
        appointment,
        taskId: taskResult.taskId,
        targetStartIso: args.assistantContextState?.target_start_at || null,
        customerMessageSent,
        scheduleSettings: args.scheduleSettings || null,
      }),
    },
  });

  return buildTaskRegisteredReply({
    appointment,
    taskId: taskResult.taskId,
    targetStartIso: args.assistantContextState?.target_start_at || null,
    customerMessageSent,
    scheduleSettings: args.scheduleSettings || null,
  });
}

function extractCreateAppointmentPayload(text: string, now: Date, settings?: StoreScheduleSettingsRow | null) {
  const dateParts = parseDateReferenceFromText(text, now);
  const timeRange = parseTimeRangeFromText(text);
  const appointmentType = inferAppointmentTypeFromText(text);
  const customerName = extractCustomerNameFromText(text);
  const customerPhone = extractPhoneFromText(text);
  const addressText = extractAddressFromText(text);
  const title = extractTitleFromText(text, appointmentType, customerName);

  if (!dateParts || !timeRange?.startTime) {
    return {
      ok: false as const,
      message: "Para eu criar o compromisso, me diga pelo menos o dia e a hora. Exemplo: agendar visita técnica amanhã às 14:00 para o cliente Brian.",
    };
  }

  const scheduledStart = buildIsoFromDateAndTime(dateParts, timeRange.startTime, settings || null);
  const scheduledEnd = timeRange.endTime
    ? buildIsoFromDateAndTime(dateParts, timeRange.endTime, settings || null)
    : addMinutesToIso(scheduledStart, 60);

  return {
    ok: true as const,
    payload: {
      title,
      appointment_type: appointmentType,
      customer_name: customerName,
      customer_phone: customerPhone,
      address_text: addressText,
      scheduled_start: scheduledStart,
      scheduled_end: scheduledEnd,
    },
  };
}

export async function loadAssistantCustomerIdentityCandidates(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  requestedName: string;
}) {
  const requestedName = String(args.requestedName || "").trim();
  if (!requestedName) return { ok: true as const, candidates: [] as AssistantCustomerIdentityCandidate[] };

  const { data: leadsData, error: leadsError } = await args.supabase
    .from("leads")
    .select("id, name, phone, created_at")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .ilike("name", `%${requestedName.replace(/[%_]/g, "")}%`)
    .limit(20);

  if (leadsError) {
    return {
      ok: false as const,
      error: leadsError.message,
      diagnosticCode: "ASSISTANT_CUSTOMER_IDENTITY_LEAD_LOOKUP_FAILED",
      candidates: [] as AssistantCustomerIdentityCandidate[],
    };
  }

  const exactLeads = ((leadsData || []) as Array<Record<string, unknown>>)
    .filter((lead) => normalizeText(String(lead.name || "")) === normalizeText(requestedName));
  const leadIds = exactLeads.map((lead) => String(lead.id || "").trim()).filter(Boolean);
  if (!leadIds.length) return { ok: true as const, candidates: [] as AssistantCustomerIdentityCandidate[] };

  const conversationsResult = await args.supabase
    .from("conversations")
    .select("id, lead_id, created_at")
    .eq("organization_id", args.organizationId)
    .in("lead_id", leadIds)
    .limit(50);

  if (conversationsResult.error) {
    return {
      ok: false as const,
      error: conversationsResult.error.message,
      diagnosticCode: "ASSISTANT_CUSTOMER_IDENTITY_CONVERSATION_LOOKUP_FAILED",
      candidates: [] as AssistantCustomerIdentityCandidate[],
    };
  }

  const opportunitiesResult = await args.supabase
    .from("commercial_opportunities")
    .select("id, customer_id, origin_lead_id, primary_conversation_id, stage, updated_at")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .in("origin_lead_id", leadIds)
    .limit(50);

  if (opportunitiesResult.error) {
    return {
      ok: false as const,
      error: opportunitiesResult.error.message,
      diagnosticCode: "ASSISTANT_CUSTOMER_IDENTITY_OPPORTUNITY_LOOKUP_FAILED",
      candidates: [] as AssistantCustomerIdentityCandidate[],
    };
  }

  const conversationsByLead = new Map<string, Set<string>>();
  for (const conversation of (conversationsResult.data || []) as Array<Record<string, unknown>>) {
    const leadId = String(conversation.lead_id || "").trim();
    const conversationId = String(conversation.id || "").trim();
    if (leadId && conversationId) {
      const existing = conversationsByLead.get(leadId) || new Set<string>();
      existing.add(conversationId);
      conversationsByLead.set(leadId, existing);
    }
  }

  const opportunitiesByLead = new Map<string, Array<Record<string, unknown>>>();
  for (const opportunity of (opportunitiesResult.data || []) as Array<Record<string, unknown>>) {
    const leadId = String(opportunity.origin_lead_id || "").trim();
    const opportunityId = String(opportunity.id || "").trim();
    if (leadId && opportunityId) {
      const existing = opportunitiesByLead.get(leadId) || [];
      existing.push(opportunity);
      opportunitiesByLead.set(leadId, existing);
    }
  }

  const candidates = exactLeads.map((lead, index) => {
    const leadId = String(lead.id || "").trim();
    const leadOpportunities = opportunitiesByLead.get(leadId) || [];
    const candidateOpportunity = leadOpportunities.length === 1 ? leadOpportunities[0] : null;
    const leadConversationIds = conversationsByLead.get(leadId) || new Set<string>();
    const primaryConversationId = String(candidateOpportunity?.primary_conversation_id || "").trim();
    const opportunity =
      candidateOpportunity &&
      primaryConversationId &&
      leadConversationIds.has(primaryConversationId)
        ? candidateOpportunity
        : null;
    const uniqueConversationId = leadConversationIds.size === 1
      ? Array.from(leadConversationIds)[0] || null
      : null;
    const conversationId =
      primaryConversationId && (!leadConversationIds.size || leadConversationIds.has(primaryConversationId))
        ? primaryConversationId
        : uniqueConversationId;
    return {
      option_number: index + 1,
      customer_id: String(opportunity?.customer_id || "").trim() || null,
      lead_id: leadId,
      conversation_id: conversationId || null,
      commercial_opportunity_id: String(opportunity?.id || "").trim() || null,
      customer_name: String(lead.name || requestedName).trim(),
      customer_phone: String(lead.phone || "").trim() || null,
      opportunity_stage: String(opportunity?.stage || "").trim() || null,
    } satisfies AssistantCustomerIdentityCandidate;
  });

  return { ok: true as const, candidates };
}

export async function resolveSafeCustomerIdentityGate(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  threadId?: string | null;
  assistantContextState?: StoreAssistantContextStateRow | null;
  requestedName: string | null;
  originalAction: ScheduleAction;
  originalPayload: Record<string, unknown>;
  lastHumanMessage: string;
  operatorName?: string | null;
  scheduleTimezone: string;
}): Promise<SafeCustomerIdentityGateResult> {
  if (isAssistantContextExpired(args.assistantContextState || null)) {
    const reply = "O contexto pendente anterior expirou. Para seguranca, repita a acao informando o cliente novamente.";
    if (args.assistantContextState && isActiveCustomerIdentityDisambiguationContext(args.assistantContextState)) {
      const closeResult = await resolveExpiredCustomerIdentityDisambiguationContext({
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: args.storeId,
        threadId: args.threadId || null,
        contextState: args.assistantContextState,
        lastHumanMessage: args.lastHumanMessage,
        expirationReply: reply,
      });
      if (!closeResult.ok) {
        return {
          type: "blocked",
          reply: "O contexto pendente anterior expirou, mas nao consegui encerra-lo com seguranca. Nenhuma acao foi executada. Tente novamente.",
        };
      }
    }
    return { type: "blocked", reply };
  }

  if (!isCompatibleIdentityDisambiguationContext(args.assistantContextState || null)) {
    return { type: "blocked", reply: "Existe outro fluxo ativo na Assistente. Para evitar sobrescrever uma acao pendente, conclua ou cancele esse fluxo antes de iniciar uma nova acao para cliente." };
  }

  if (!args.requestedName) {
    return { type: "blocked", reply: buildCustomerIdentityNeedsMoreInfoReply({ operatorName: args.operatorName }) };
  }

  const loaded = await loadAssistantCustomerIdentityCandidates({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    requestedName: args.requestedName,
  });

  if (!loaded.ok) {
    console.warn("[assistant-customer-identity] lookup failed", {
      organizationId: args.organizationId,
      storeId: args.storeId,
      requestedName: args.requestedName,
      diagnosticCode: loaded.diagnosticCode,
    });
    return {
      type: "blocked",
      reply: "Nao consegui consultar os clientes agora. Nenhuma acao foi executada. Tente novamente.",
    };
  }

  if (loaded.candidates.length === 1) {
    return { type: "allow", candidate: loaded.candidates[0] };
  }

  if (!loaded.candidates.length) {
    return { type: "blocked", reply: buildCustomerIdentityNeedsMoreInfoReply({ requestedName: args.requestedName, operatorName: args.operatorName }) };
  }

  if (args.threadId) {
    await upsertAssistantContextState({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      threadId: args.threadId,
      currentContextState: args.assistantContextState || null,
      patch: {
        active_topic: "customer_identity_disambiguation",
        active_intent: args.originalAction,
        active_status: "waiting_user_choice",
        active_customer_name: args.requestedName,
        active_customer_phone: null,
        active_lead_id: null,
        active_conversation_id: null,
        active_appointment_id: null,
        target_date: typeof args.originalPayload.scheduled_start === "string"
          ? isoDateToLocalDateForDb(args.originalPayload.scheduled_start, args.scheduleTimezone)
          : null,
        target_time: typeof args.originalPayload.scheduled_start === "string"
          ? formatTimeOnlyInTimeZone(args.originalPayload.scheduled_start, args.scheduleTimezone)
          : null,
        target_start_at: typeof args.originalPayload.scheduled_start === "string" ? args.originalPayload.scheduled_start : null,
        target_end_at: typeof args.originalPayload.scheduled_end === "string" ? args.originalPayload.scheduled_end : null,
        timezone_name: args.scheduleTimezone,
        expires_at: buildCustomerIdentityDisambiguationExpiresAt(),
        candidate_options: loaded.candidates,
        context_payload: {
          reason: "customer_identity_ambiguity",
          original_action: args.originalAction,
          original_payload: args.originalPayload,
          original_user_message: args.lastHumanMessage,
        },
        last_user_message: args.lastHumanMessage,
      },
    });
  }

  return {
    type: "blocked",
    reply: buildCustomerIdentityDisambiguationReply({
      candidates: loaded.candidates,
      requestedName: args.requestedName,
      operatorName: args.operatorName || null,
    }),
  };
}

export async function executeCreateAppointmentWithSafeIdentity(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  threadId?: string | null;
  assistantContextState?: StoreAssistantContextStateRow | null;
  openOperationalTasks?: StoreAssistantOperationalTaskRow[];
  createPayload: {
    title: string;
    appointment_type: string;
    customer_name: string | null;
    customer_phone: string | null;
    address_text: string | null;
    scheduled_start: string;
    scheduled_end: string;
  };
  identityCandidate: AssistantCustomerIdentityCandidate | null;
  lastHumanMessage: string;
  scheduleSettings?: StoreScheduleSettingsRow | null;
}) {
  const createPayload = args.createPayload;
  const identityCandidate = args.identityCandidate;
  let opportunityResolution:
    | { ok: boolean; commercialOpportunityId: string | null; leadId: string | null; conversationId: string | null; reason?: string }
    | null =
    createPayload.appointment_type === "technical_visit"
      ? await resolveAuthorizedCommercialOpportunityIdForAssistantTechnicalVisit({
          supabase: args.supabase,
          organizationId: args.organizationId,
          storeId: args.storeId,
          openOperationalTasks: args.openOperationalTasks || [],
          explicitCommercialOpportunityId: identityCandidate?.commercial_opportunity_id,
          expectedLeadId: identityCandidate?.lead_id,
          expectedConversationId: identityCandidate?.conversation_id,
        })
      : null;

  if (createPayload.appointment_type === "technical_visit") {
    if (!opportunityResolution?.ok || !opportunityResolution.commercialOpportunityId) {
      return "Para criar uma visita tecnica comercial, preciso identificar a oportunidade correta antes. Abra ou selecione o atendimento comercial especifico e tente novamente.";
    }

    const candidateOpportunityId = String(identityCandidate?.commercial_opportunity_id || "").trim();
    const candidateLeadId = String(identityCandidate?.lead_id || "").trim();
    const candidateConversationId = String(identityCandidate?.conversation_id || "").trim();
    const resolvedOpportunityId = String(opportunityResolution.commercialOpportunityId || "").trim();
    const resolvedLeadId = String(opportunityResolution.leadId || "").trim();
    const resolvedConversationId = String(opportunityResolution.conversationId || "").trim();

    if (
      (candidateOpportunityId && candidateOpportunityId !== resolvedOpportunityId) ||
      (candidateLeadId && candidateLeadId !== resolvedLeadId) ||
      (candidateConversationId && candidateConversationId !== resolvedConversationId)
    ) {
      return "A identificacao do cliente nao corresponde ao atendimento comercial autorizado para esta visita tecnica. Para seguranca, selecione o atendimento correto e tente novamente.";
    }
  }

  const commercialOpportunityId =
    createPayload.appointment_type === "technical_visit"
      ? opportunityResolution?.commercialOpportunityId || null
      : identityCandidate?.commercial_opportunity_id || null;
  const commercialLeadId =
    createPayload.appointment_type === "technical_visit"
      ? opportunityResolution?.leadId || null
      : identityCandidate?.lead_id || null;
  const commercialConversationId =
    createPayload.appointment_type === "technical_visit"
      ? opportunityResolution?.conversationId || null
      : identityCandidate?.conversation_id || null;

  // CREATE de visita/instalacao e uma negociacao com o cliente. A agenda so
  // pode ser escrita pelo worker depois da confirmacao recebida.
  if (createPayload.appointment_type === "technical_visit" || createPayload.appointment_type === "installation") {
    if (!args.threadId || !commercialConversationId || !commercialLeadId) {
      return "Identifiquei o pedido, mas nao consegui registrar uma task canonica para confirmar o horario com o cliente. Nenhuma agenda foi alterada.";
    }
    const { data: serviceSettings, error: serviceSettingsError } = await args.supabase
      .from("store_operation_settings")
      .select("offers_installation,offers_technical_visit")
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .maybeSingle();
    const serviceEnabled = createPayload.appointment_type === "technical_visit"
      ? serviceSettings?.offers_technical_visit === true
      : serviceSettings?.offers_installation === true;
    if (serviceSettingsError || !serviceEnabled) {
      return "Esse servico nao esta configurado como disponivel para esta loja. Nenhuma mensagem foi enviada e nenhuma agenda foi alterada.";
    }

    const operationKey = [
      "assistant_customer_contact",
      "appointment_create_with_customer",
      args.threadId,
      createPayload.appointment_type,
      commercialLeadId,
      commercialConversationId,
      commercialOpportunityId || "",
      createPayload.scheduled_start,
      createPayload.scheduled_end,
      normalizeText(args.lastHumanMessage).replace(/\s+/g, " ").trim(),
    ].join(":");
    const canonicalTarget = {
      source: "appointment_create_with_customer",
      leadId: commercialLeadId,
      conversationId: commercialConversationId,
      commercialOpportunityId,
      customerName: identityCandidate?.customer_name || createPayload.customer_name,
      customerPhone: identityCandidate?.customer_phone || createPayload.customer_phone,
    };
    const taskResult = await createAssistantOperationalTask({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      threadId: args.threadId,
      taskType: "appointment_create_with_customer",
      status: "open",
      priority: "high",
      title: `Confirmar ${formatAppointmentType(createPayload.appointment_type)} com ${canonicalTarget.customerName || "cliente"}`,
      description: "A assistente registrou o pedido. A agenda permanece inalterada ate a confirmacao do cliente.",
      canonicalTarget,
      targetStartIso: createPayload.scheduled_start,
      targetEndIso: createPayload.scheduled_end,
      timezoneName: getScheduleTimezone(args.scheduleSettings || null),
      taskPayload: {
        source: "assistant.reply.route",
        operation_key: operationKey,
        appointment_type: createPayload.appointment_type,
        title: createPayload.title,
        address_text: createPayload.address_text,
        original_user_message: args.lastHumanMessage,
        customer_message_sent: false,
        agenda_updated: false,
        commercial_opportunity_id: commercialOpportunityId,
      },
    });
    if (!taskResult.ok || !taskResult.taskId) {
      return "Registrei o pedido, mas nao consegui confirmar a task operacional com seguranca. Nenhuma agenda foi alterada.";
    }

    const taskSnapshot = await loadAssistantOperationalTaskById({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      taskId: taskResult.taskId,
    });
    if (!taskSnapshot.ok || !taskSnapshot.task) {
      return "Registrei o pedido, mas nao consegui reler a task operacional com seguranca. Nenhuma agenda foi alterada.";
    }
    const existingPayload = getOperationalTaskPayload(taskSnapshot.task);
    const sameCanonicalTarget =
      taskSnapshot.task.related_lead_id === commercialLeadId &&
      taskSnapshot.task.related_conversation_id === commercialConversationId &&
      (taskSnapshot.task.commercial_opportunity_id || null) === (commercialOpportunityId || null) &&
      sameInstant(taskSnapshot.task.target_start_at, createPayload.scheduled_start) &&
      sameInstant(taskSnapshot.task.target_end_at, createPayload.scheduled_end) &&
      String(existingPayload.appointment_type || "") === createPayload.appointment_type;
    if (!sameCanonicalTarget) {
      return "A task operacional encontrada nao corresponde exatamente ao cliente, oportunidade ou horario solicitado. Nenhuma agenda foi alterada.";
    }
    if (existingPayload.customer_message_sent === true && existingPayload.customer_message_id) {
      return `A confirmacao de ${formatAppointmentType(createPayload.appointment_type)} para ${canonicalTarget.customerName || "o cliente"} ja foi enviada e continua aguardando resposta. A agenda ainda nao foi alterada.`;
    }
    if (taskSnapshot.task.status === "waiting_customer_response") {
      return `A confirmacao de ${formatAppointmentType(createPayload.appointment_type)} para ${canonicalTarget.customerName || "o cliente"} continua aguardando resposta. A agenda ainda nao foi alterada.`;
    }

    const customerMessage = `Oi, ${canonicalTarget.customerName || "tudo bem"}. Posso confirmar ${formatAppointmentType(createPayload.appointment_type)} para ${formatDateOnlyInTimeZone(createPayload.scheduled_start, getScheduleTimezone(args.scheduleSettings || null))} as ${formatTimeOnlyInTimeZone(createPayload.scheduled_start, getScheduleTimezone(args.scheduleSettings || null))}? Responda sim para confirmar ou me diga outro horario.`;
    const sendResult = await sendAiMessageToCustomerConversation({
      supabase: args.supabase,
      conversationId: commercialConversationId,
      text: customerMessage,
      target: canonicalTarget,
    });
    const taskUpdate = await updateAssistantOperationalTaskAfterCustomerContact({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      taskId: taskResult.taskId,
      status: sendResult.ok ? "waiting_customer_response" : "open",
      description: sendResult.ok
        ? "Mensagem enviada ao cliente. A agenda permanece inalterada ate a confirmacao."
        : `Nao foi possivel enviar a confirmacao ao cliente: ${sendResult.error}`,
      taskPayload: {
        operation_key: operationKey,
        source: "assistant.reply.route",
        appointment_type: createPayload.appointment_type,
        title: createPayload.title,
        address_text: createPayload.address_text,
        original_user_message: args.lastHumanMessage,
        customer_message_sent: sendResult.ok,
        customer_message_id: sendResult.ok ? sendResult.messageId : null,
        customer_message_error: sendResult.ok ? null : sendResult.error,
        agenda_updated: false,
        commercial_opportunity_id: commercialOpportunityId,
      },
    });
    if (!taskUpdate.ok) {
      return `A task foi criada, mas nao consegui registrar o resultado do contato: ${taskUpdate.error}. Nenhuma agenda foi alterada.`;
    }

    if (args.threadId && sendResult.ok) {
      const contextResult = await upsertAssistantContextState({
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: args.storeId,
        threadId: args.threadId,
        currentContextState: args.assistantContextState || null,
        patch: {
          active_topic: "appointment_create_with_customer",
          active_intent: "create",
          active_status: "waiting_customer_response",
          active_customer_name: canonicalTarget.customerName,
          active_customer_phone: canonicalTarget.customerPhone,
          active_lead_id: commercialLeadId,
          active_conversation_id: commercialConversationId,
          active_appointment_id: null,
          target_start_at: createPayload.scheduled_start,
          target_end_at: createPayload.scheduled_end,
          timezone_name: getScheduleTimezone(args.scheduleSettings || null),
          context_payload: { task_id: taskResult.taskId, operation_key: operationKey, commercial_opportunity_id: commercialOpportunityId },
          last_user_message: args.lastHumanMessage,
        },
      });
      if (!contextResult.ok) {
        return `Enviei a confirmacao ao cliente, mas nao consegui registrar o contexto operacional: ${contextResult.error}. A agenda permanece inalterada e a task aguarda reconciliacao.`;
      }
    }

    return sendResult.ok
      ? `Certo. Enviei a confirmacao de ${formatAppointmentType(createPayload.appointment_type)} para ${canonicalTarget.customerName || "o cliente"}. A agenda ainda nao foi alterada; aguardo a resposta para criar o compromisso.`
      : `Registrei a task de confirmacao, mas nao consegui enviar a mensagem ao cliente: ${sendResult.error}. A agenda ainda nao foi alterada.`;
  }

  const targetAssertion = assertCommercialTargetForSideEffect({
    target:
      createPayload.appointment_type === "technical_visit"
        ? {
            source: "technical_visit_opportunity_resolution",
            leadId: commercialLeadId,
            conversationId: commercialConversationId,
            customerName: identityCandidate?.customer_name || createPayload.customer_name,
          }
        : buildCommercialTargetFromIdentityCandidate(identityCandidate, "identity_disambiguation"),
    sideEffect: "create_store_appointment_with_commercial_context",
  });

  if (!targetAssertion.ok) {
    return "Preciso identificar o cliente de forma inequivoca antes de criar esse compromisso.";
  }

  const { data: createdAppointment, error } = await args.supabase.rpc(
    "create_store_appointment_with_commercial_context",
    {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_lead_id: commercialLeadId,
      p_conversation_id: commercialConversationId,
      p_title: createPayload.title,
      p_appointment_type: createPayload.appointment_type,
      p_status: "scheduled",
      p_scheduled_start: createPayload.scheduled_start,
      p_scheduled_end: createPayload.scheduled_end,
      p_customer_name: identityCandidate?.customer_name || createPayload.customer_name,
      p_customer_phone: identityCandidate?.customer_phone || createPayload.customer_phone,
      p_address_text: createPayload.address_text,
      p_notes: "Criado pela assistente operacional.",
      p_source: "ai_operator",
      p_created_by_user_id: null,
      p_commercial_opportunity_id: commercialOpportunityId,
    },
  );

  if (error) {
    return `Tentei criar o compromisso, mas encontrei um erro: ${error.message}`;
  }

  const projectionWarning =
    typeof createdAppointment?.id === "string"
      ? await maybeProjectAppointmentToTechnicalVisitStageBySystem({
          supabase: args.supabase,
          organizationId: args.organizationId,
          storeId: args.storeId,
          appointmentId: createdAppointment.id,
          appointmentType: createPayload.appointment_type,
          appointmentStatus: "scheduled",
          commercialOpportunityId,
          source: "assistant_reply_route",
        })
      : null;

  if (args.threadId) {
    await resolveAssistantContextState({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      threadId: args.threadId,
      currentContextState: args.assistantContextState || null,
      lastUserMessage: args.lastHumanMessage,
      lastAssistantMessage: `Compromisso criado para ${identityCandidate?.customer_name || createPayload.customer_name || "cliente"}.`,
    });
  }

  const successReply = buildAppointmentActionSuccessReply({
    action: "create",
    scheduleSettings: args.scheduleSettings || null,
    createdPayload: {
      title: createPayload.title,
      appointment_type: createPayload.appointment_type,
      customer_name: identityCandidate?.customer_name || createPayload.customer_name,
      scheduled_start: createPayload.scheduled_start,
    },
  });

  return projectionWarning
    ? `${successReply}\n\nAviso: ${projectionWarning}`
    : successReply;
}

export async function resolvePendingCustomerIdentityDisambiguationReply(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  threadId?: string | null;
  assistantContextState?: StoreAssistantContextStateRow | null;
  openOperationalTasks?: StoreAssistantOperationalTaskRow[];
  lastHumanMessage: string;
  operatorName?: string | null;
  scheduleSettings?: StoreScheduleSettingsRow | null;
}) {
  const contextState = args.assistantContextState || null;
  if (!contextState) return null;

  if (
    normalizeText(contextState.active_topic || "") !== "customer_identity_disambiguation" ||
    normalizeText(contextState.active_status || "") !== "waiting_user_choice"
  ) {
    return null;
  }

  if (isAssistantContextExpired(contextState)) {
    const reply = "O contexto pendente de identificacao do cliente expirou. Para seguranca, repita a acao informando o cliente novamente.";
    const closeResult = await resolveExpiredCustomerIdentityDisambiguationContext({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      threadId: args.threadId || null,
      contextState,
      lastHumanMessage: args.lastHumanMessage,
      expirationReply: reply,
    });
    if (!closeResult.ok) {
      return "O contexto pendente de identificacao do cliente expirou, mas nao consegui encerra-lo com seguranca. Nenhuma acao foi executada. Tente novamente.";
    }
    return reply;
  }

  const candidates = readAssistantCustomerIdentityCandidates(contextState);
  if (!candidates.length) {
    return buildCustomerIdentityNeedsMoreInfoReply({
      requestedName: contextState?.active_customer_name,
      operatorName: args.operatorName || null,
    });
  }

  const selectedCandidate = resolveCustomerIdentityCandidateFromText({
    text: args.lastHumanMessage,
    candidates,
  });

  if (!selectedCandidate) {
    return buildCustomerIdentityDisambiguationReply({
      candidates,
      requestedName: contextState?.active_customer_name || "esse nome",
      operatorName: args.operatorName || null,
    });
  }

  const contextPayload = readAssistantContextPayload(contextState);
  const originalAction = String(contextPayload.original_action || contextState.active_intent || "");
  const originalPayload = contextPayload.original_payload && typeof contextPayload.original_payload === "object" && !Array.isArray(contextPayload.original_payload)
    ? contextPayload.original_payload as Record<string, unknown>
    : null;

  if (originalAction !== "create" || !originalPayload) {
    return "Identifiquei o cliente, mas o contexto da acao pendente esta incompleto. Para seguranca, repita o pedido completo.";
  }

  const createPayload = {
    title: String(originalPayload.title || "").trim(),
    appointment_type: String(originalPayload.appointment_type || "").trim(),
    customer_name: String(originalPayload.customer_name || "").trim() || null,
    customer_phone: String(originalPayload.customer_phone || "").trim() || null,
    address_text: String(originalPayload.address_text || "").trim() || null,
    scheduled_start: String(originalPayload.scheduled_start || "").trim(),
    scheduled_end: String(originalPayload.scheduled_end || "").trim(),
  };

  if (!createPayload.title || !createPayload.appointment_type || !createPayload.scheduled_start || !createPayload.scheduled_end) {
    return "Identifiquei o cliente, mas o contexto da acao pendente esta incompleto. Para seguranca, repita o pedido completo.";
  }

  return executeCreateAppointmentWithSafeIdentity({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    threadId: args.threadId || null,
    assistantContextState: contextState,
    openOperationalTasks: args.openOperationalTasks || [],
    createPayload,
    identityCandidate: selectedCandidate,
    lastHumanMessage: String(contextPayload.original_user_message || args.lastHumanMessage),
    scheduleSettings: args.scheduleSettings || null,
  });
}

function extractReschedulePayload(text: string, now: Date, settings?: StoreScheduleSettingsRow | null) {
  return parseRescheduleTargetFromText({
    text,
    now,
    settings: settings || null,
  });

  /* const targetText = getRescheduleTargetTextSegment(text);
  const dateParts = parseDateReferenceFromText(targetText, now);
  const timeRange = parseTimeRangeFromText(targetText);

  if (!dateParts || !timeRange?.startTime) {
    return {
      ok: false as const,
      message: "Para remarcar, me diga a nova data e a nova hora. Exemplo: remarca para 25/04 às 15:00.",
    };
  }

  const scheduledStart = buildIsoFromDateAndTime(dateParts, timeRange.startTime, settings || null);
  const scheduledEnd = timeRange.endTime
    ? buildIsoFromDateAndTime(dateParts, timeRange.endTime, settings || null)
    : addMinutesToIso(scheduledStart, 60);

  return {
    ok: true as const,
    payload: {
      scheduled_start: scheduledStart,
      scheduled_end: scheduledEnd,
    },
  }; */
}


function extractContextAwareReschedulePayload(args: {
  text: string;
  now: Date;
  settings?: StoreScheduleSettingsRow | null;
  contextState?: StoreAssistantContextStateRow | null;
}) {
  const directPayload = extractReschedulePayload(args.text, args.now, args.settings || null);
  if (directPayload.ok) return directPayload;

  const dateParts =
    parseDateReferenceFromText(args.text, args.now) ||
    parseDbDateKeyToScheduleParts(args.contextState?.target_date) ||
    (args.contextState?.target_start_at
      ? parseDbDateKeyToScheduleParts(isoDateToLocalDateForDb(args.contextState.target_start_at, getScheduleTimezone(args.settings || null)))
      : null);

  const timeRange = parseTimeRangeFromText(args.text);
  const contextTime = typeof args.contextState?.target_time === "string"
    ? args.contextState.target_time.slice(0, 5)
    : null;
  const startTime = timeRange?.startTime || contextTime;
  const endTime = timeRange?.endTime || null;

  if (!dateParts || !startTime) {
    return directPayload;
  }

  const scheduledStart = buildIsoFromDateAndTime(dateParts, startTime, args.settings || null);
  const scheduledEnd = endTime
    ? buildIsoFromDateAndTime(dateParts, endTime, args.settings || null)
    : addMinutesToIso(scheduledStart, 60);

  return {
    ok: true as const,
    payload: {
      scheduled_start: scheduledStart,
      scheduled_end: scheduledEnd,
    },
    source: "context_aware" as const,
  };
}

function buildTaskRegisteredReply(args: {
  appointment: AppointmentRow;
  taskId: string | null;
  targetStartIso?: string | null;
  customerMessageSent: boolean;
  scheduleSettings?: StoreScheduleSettingsRow | null;
}) {
  const customerName = String(args.appointment.customer_name || "cliente").trim() || "cliente";
  const referenceLabel = buildScheduleAppointmentReferenceLabel(args.appointment);
  const timeZone = getScheduleTimezone(args.scheduleSettings || null);
  const targetLabel = args.targetStartIso
    ? ` para ${formatDateOnlyInTimeZone(args.targetStartIso, timeZone)} às ${formatTimeOnlyInTimeZone(args.targetStartIso, timeZone)}`
    : "";
  const contactLabel = args.customerMessageSent
    ? `Enviei uma mensagem para ${customerName}`
    : `Registrei a tratativa para falar com ${customerName}`;

  return `${contactLabel} sobre a remarcação de ${referenceLabel}${targetLabel}. A agenda ainda não foi alterada. Assim que houver confirmação do cliente, eu atualizo o caso e te aviso por aqui.`;
}

function buildAppointmentActionSuccessReply(args: {
  action: ScheduleAction;
  appointment?: AppointmentRow;
  scheduleSettings?: StoreScheduleSettingsRow | null;
  createdPayload?: {
    title: string;
    appointment_type: string;
    customer_name: string | null;
    scheduled_start: string;
  } | null;
}) {
  if (args.action === "create") {
    const createdType = formatAppointmentType(args.createdPayload?.appointment_type || null);
    const createdTitle = String(args.createdPayload?.title || "").trim();
    const createdCustomer = args.createdPayload?.customer_name || "cliente não identificado";
    const createdReference = createdTitle ? `${createdType} ${createdTitle}` : createdType;
    return `Certo. Agendei ${createdReference} para ${createdCustomer} em ${formatAppointmentStartInTimeZone({ value: args.createdPayload?.scheduled_start || null, scheduleSettings: args.scheduleSettings || null })}.`;
  }

  const customerName = args.appointment?.customer_name || "cliente não identificado";
  const referenceLabel = buildScheduleAppointmentReferenceLabel(args.appointment);

  if (args.action === "complete") {
    return `Certo. Marquei como concluído ${referenceLabel} de ${customerName}.`;
  }

  if (args.action === "cancel") {
    return `Certo. Marquei como cancelado ${referenceLabel} de ${customerName}.`;
  }

  if (args.action === "needs_followup") {
    return `Certo. Mantive ${referenceLabel} de ${customerName} em aberto.`;
  }

  return `Certo. Remarquei ${referenceLabel} de ${customerName} para ${formatAppointmentStartInTimeZone({ value: args.appointment?.scheduled_start || args.appointment?.scheduled_end || null, scheduleSettings: args.scheduleSettings || null })}.`;
}

export async function resolveAppointmentActionReply(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  threadId?: string | null;
  openOperationalTasks?: StoreAssistantOperationalTaskRow[];
  assistantContextState?: StoreAssistantContextStateRow | null;
  lastHumanMessage: string;
  recentMessages: AssistantMessageRow[];
  openAppointments: AppointmentRow[];
  scheduleSettings?: StoreScheduleSettingsRow | null;
  operatorName?: string | null;
}) {
  const pendingContext = args.assistantContextState || null;
  const pendingTopic = normalizeText(pendingContext?.active_topic || "");
  const pendingStatus = normalizeText(pendingContext?.active_status || "");
  const explicitAction = resolveScheduleAction(args.lastHumanMessage);
  const pendingIdentity = pendingTopic === "customer_identity_disambiguation" && pendingStatus === "waiting_user_choice";
  const pendingCancellation = pendingTopic === "appointment_management" && ["waiting_user_choice", "waiting_cancel_decision"].includes(pendingStatus);

  if ((pendingIdentity || pendingCancellation) && explicitAction) {
    if (!args.threadId) {
      return "Existe uma ação pendente, mas não consegui encerrá-la antes do novo comando. Nenhuma ação foi executada.";
    }

    const supersedeResult = await resolveAssistantContextState({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      threadId: args.threadId,
      currentContextState: pendingContext,
      lastUserMessage: args.lastHumanMessage,
      lastAssistantMessage: "O contexto pendente foi encerrado porque um novo comando explícito foi recebido.",
      resolvedReason: "superseded_by_new_explicit_command",
    });

    if (!supersedeResult.ok) {
      return `Não consegui encerrar o contexto pendente com segurança. Nenhuma ação foi executada. Erro: ${supersedeResult.error || "falha ao persistir o encerramento"}.`;
    }

    args.assistantContextState = null;
  }

  const pendingCustomerIdentityReply = await resolvePendingCustomerIdentityDisambiguationReply({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    threadId: args.threadId || null,
    assistantContextState: args.assistantContextState || null,
    openOperationalTasks: args.openOperationalTasks || [],
    lastHumanMessage: args.lastHumanMessage,
    operatorName: args.operatorName || null,
    scheduleSettings: args.scheduleSettings || null,
  });
  if (pendingCustomerIdentityReply) return pendingCustomerIdentityReply;

  const pendingCancelDecisionReply = await handlePendingCustomerCancelDecision({ supabase: args.supabase, organizationId: args.organizationId, storeId: args.storeId, threadId: args.threadId || null, assistantContextState: args.assistantContextState || null, lastHumanMessage: args.lastHumanMessage, scheduleSettings: args.scheduleSettings || null });
  if (pendingCancelDecisionReply) return pendingCancelDecisionReply;

  const cancellationTargetSelectionReply = await resolveCancellationTargetSelectionAfterUnsafePrompt({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    threadId: args.threadId || null,
    assistantContextState: args.assistantContextState || null,
    lastHumanMessage: args.lastHumanMessage,
    recentMessages: args.recentMessages || [],
    openAppointments: args.openAppointments || [],
    scheduleSettings: args.scheduleSettings || null,
  });
  if (cancellationTargetSelectionReply) return cancellationTargetSelectionReply;

  let action = resolveScheduleAction(args.lastHumanMessage);
  if (!action && isPlainAssistantOptionChoice(args.lastHumanMessage)) {
    const contextAction = getContextScheduleAction(args.assistantContextState || null);
    const contextStatus = normalizeText(args.assistantContextState?.active_status || "");
    const contextTopic = normalizeText(args.assistantContextState?.active_topic || "");
    const contextPayload = readAssistantContextPayload(args.assistantContextState || null);
    const contextReason = normalizeText(String(contextPayload.reason || ""));
    const contextIndicatesReschedule =
      contextAction === "reschedule" &&
      (
        contextTopic === "appointment_reschedule" ||
        contextReason === "selected_appointment_waiting_for_reschedule_time" ||
        Boolean(contextPayload.requested_date || args.assistantContextState?.target_date)
      );
    if (
      contextAction &&
      (
        (contextTopic === "appointment_management" && contextStatus === "waiting_user_choice") ||
        contextIndicatesReschedule
      )
    ) {
      action = contextAction;
    }
  }
  if (!action) {
    const contextAction = getContextScheduleAction(args.assistantContextState || null);
    const contextTopic = normalizeText(args.assistantContextState?.active_topic || "");
    const contextPayload = readAssistantContextPayload(args.assistantContextState || null);
    const currentRequestTimeRange = parseTimeRangeFromText(args.lastHumanMessage);
    if (
      contextAction === "reschedule" &&
      contextTopic === "appointment_reschedule" &&
      Boolean(contextPayload.requested_date || args.assistantContextState?.target_date) &&
      currentRequestTimeRange?.startTime
    ) {
      action = "reschedule";
    }
  }

  if (!action) {
    return null;
  }

  const selectedContextOption = getSelectedAssistantCandidateOption({
    text: args.lastHumanMessage,
    contextState: args.assistantContextState || null,
  });

  if (selectedContextOption && ["cancel", "complete", "needs_followup"].includes(action)) {
    return executeSelectedAppointmentOptionAction({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      threadId: args.threadId || null,
      assistantContextState: args.assistantContextState || null,
      lastHumanMessage: args.lastHumanMessage,
      action,
      option: selectedContextOption,
      scheduleSettings: args.scheduleSettings || null,
    });
  }

  const now = getScheduleParsingNow(args.scheduleSettings || null);
  const scheduleTimezone = getScheduleTimezone(args.scheduleSettings || null);
  const explicitAppointmentTitleCandidate = extractExplicitAppointmentTitleCandidateFromCommand(args.lastHumanMessage);
  const commandHasExplicitTitleAndOriginalSchedule = hasExplicitAppointmentTitleAndOriginalScheduleReference({
    text: args.lastHumanMessage,
    now,
    scheduleSettings: args.scheduleSettings || null,
  });
  let openAppointments = sortOpenScheduleAppointments(args.openAppointments || []);

  if (
    action === "cancel" &&
    !cancellationCommandHasSpecificAppointmentTarget({
      text: args.lastHumanMessage,
      openAppointments,
      contextState: args.assistantContextState || null,
    })
  ) {
    const reply = buildUnsafeCancellationWithoutTargetReply();
    if (args.threadId) {
      await upsertAssistantContextState({
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: args.storeId,
        threadId: args.threadId,
        currentContextState: args.assistantContextState || null,
        patch: {
          active_topic: "appointment_management",
          active_intent: "cancel",
          active_status: "waiting_user_choice",
          active_customer_name: null,
          active_customer_phone: null,
          active_lead_id: null,
          active_conversation_id: null,
          active_appointment_id: null,
          target_date: null,
          target_time: null,
          target_start_at: null,
          target_end_at: null,
          candidate_options: [],
          context_payload: {
            reason: "cancel_missing_target",
            phase: "awaiting_cancel_target",
            original_cancel_request: args.lastHumanMessage,
            cancellation_reason_text: extractCancellationReasonFromDecision(args.lastHumanMessage),
          },
          last_user_message: args.lastHumanMessage,
          last_assistant_message: reply,
        },
      });
    }
    return reply;
  }

  const commandHasExplicitTitleOnly = Boolean(explicitAppointmentTitleCandidate) && !commandHasExplicitTitleAndOriginalSchedule;
  if (commandHasExplicitTitleOnly && ["cancel", "complete", "needs_followup", "reschedule"].includes(action)) {
    const explicitTitleMatches = await loadExplicitAppointmentTitleOnlyMatchesFromCommand({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      text: args.lastHumanMessage,
    });

    if (explicitTitleMatches.length === 1) {
      const explicitAppointment = explicitTitleMatches[0];
      openAppointments = [
        explicitAppointment,
        ...openAppointments.filter((appointment) => appointment.id !== explicitAppointment.id),
      ];
    } else if (explicitTitleMatches.length > 1) {
      if (args.threadId) {
        const requestedDateParts = parseCompleteScheduleDateFromText(args.lastHumanMessage, now);
        const requestedDateKey = getDateKeyFromParts(requestedDateParts);
        const requestedTimeRange = parseTimeRangeFromText(args.lastHumanMessage);
        const requestedTimeLabel = requestedTimeRange?.startTime || null;
        const requestedTargetStartIso = requestedDateParts && requestedTimeLabel
          ? buildIsoFromDateAndTime(requestedDateParts, requestedTimeLabel, args.scheduleSettings || null)
          : null;
        const requestedTargetEndIso = requestedTargetStartIso
          ? (requestedTimeRange?.endTime
            ? buildIsoFromDateAndTime(requestedDateParts!, requestedTimeRange.endTime, args.scheduleSettings || null)
            : addMinutesToIso(requestedTargetStartIso, 60))
          : null;
        const candidateOptions = explicitTitleMatches.slice(0, 8).map((appointment, index) => ({
          option_number: index + 1,
          source_index: index,
          appointment_id: appointment.id || "",
          title: appointment.title || null,
          appointment_type: appointment.appointment_type || null,
          status: appointment.status || null,
          customer_name: appointment.customer_name || null,
          customer_phone: appointment.customer_phone || null,
          lead_id: appointment.lead_id || null,
          conversation_id: appointment.conversation_id || null,
          scheduled_start: appointment.scheduled_start || null,
          scheduled_end: appointment.scheduled_end || null,
        }));

        await upsertAssistantContextState({
          supabase: args.supabase,
          organizationId: args.organizationId,
          storeId: args.storeId,
          threadId: args.threadId,
          currentContextState: args.assistantContextState || null,
          patch: {
            active_topic: action === "reschedule" ? "appointment_reschedule" : "appointment_management",
            active_intent: action,
            active_status: "waiting_user_choice",
            active_customer_name: null,
            active_customer_phone: null,
            active_lead_id: null,
            active_conversation_id: null,
            active_appointment_id: null,
            target_date: requestedDateKey || null,
            target_time: requestedTimeLabel || null,
            target_start_at: requestedTargetStartIso,
            target_end_at: requestedTargetEndIso,
            timezone_name: scheduleTimezone,
            candidate_options: candidateOptions,
            context_payload: {
              reason: "explicit_title_ambiguity",
              action,
              explicit_title: explicitAppointmentTitleCandidate,
              requested_date: requestedDateKey,
              requested_time: requestedTimeLabel,
            },
            last_user_message: args.lastHumanMessage,
          },
        });
      }

      return buildExplicitAppointmentMatchAmbiguityReply(explicitTitleMatches, args.scheduleSettings || null);
    } else if (action === "cancel" || action === "complete") {
      return `Não encontrei nenhum compromisso em aberto com o nome "${explicitAppointmentTitleCandidate}". Para evitar alterar o compromisso errado, me diga o cliente, a data ou o horário.`;
    }
  }

  if (action === "create") {
    const createPayload = extractCreateAppointmentPayload(args.lastHumanMessage, now, args.scheduleSettings || null);
    if (!createPayload.ok) {
      return createPayload.message;
    }

    const identityGate = await resolveSafeCustomerIdentityGate({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      threadId: args.threadId || null,
      assistantContextState: args.assistantContextState || null,
      requestedName: createPayload.payload.customer_name,
      originalAction: "create",
      originalPayload: createPayload.payload,
      lastHumanMessage: args.lastHumanMessage,
      operatorName: args.operatorName || null,
      scheduleTimezone,
    });

    if (identityGate.type === "blocked") {
      return identityGate.reply;
    }

    return executeCreateAppointmentWithSafeIdentity({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      threadId: args.threadId || null,
      assistantContextState: args.assistantContextState || null,
      openOperationalTasks: args.openOperationalTasks || [],
      createPayload: createPayload.payload,
      identityCandidate: identityGate.candidate,
      lastHumanMessage: args.lastHumanMessage,
      scheduleSettings: args.scheduleSettings || null,
    });
  }

  if (commandHasExplicitTitleAndOriginalSchedule) {
    const explicitMatches = await loadExplicitAppointmentMatchesFromCommand({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      text: args.lastHumanMessage,
      now,
      scheduleSettings: args.scheduleSettings || null,
    });

    if (explicitMatches.length === 1) {
      const explicitAppointment = explicitMatches[0];
      openAppointments = [
        explicitAppointment,
        ...openAppointments.filter((appointment) => appointment.id !== explicitAppointment.id),
      ];
    }

    if (explicitMatches.length > 1) {
      const candidateIndexes = explicitMatches.map((explicitAppointment) => {
        const existingIndex = openAppointments.findIndex((appointment) => appointment.id === explicitAppointment.id);
        return existingIndex >= 0 ? existingIndex : -1;
      }).filter((index) => index >= 0);

      if (candidateIndexes.length > 1) {
        return buildAppointmentAmbiguityReply({
          candidateIndexes,
          openAppointments,
          scheduleSettings: args.scheduleSettings || null,
        });
      }

      return "Encontrei mais de um compromisso parecido com esse título e horário. Me diga o cliente ou o número do item para eu não remarcar a pessoa errada.";
    }
  }

  if (!openAppointments.length) {
    return "Hoje eu não encontrei compromisso em aberto para atualizar.";
  }

  const targetResolution = resolveTargetAppointmentIndex({
    text: args.lastHumanMessage,
    openAppointments,
    recentMessages: args.recentMessages,
    assistantContextState: args.assistantContextState || null,
    now,
    scheduleSettings: args.scheduleSettings || null,
  });

  if (targetResolution.type === "ambiguous") {
    const requestedDateParts = parseDateReferenceFromText(args.lastHumanMessage, now);
    const requestedDateKey = getDateKeyFromParts(requestedDateParts);
    const requestedTimeRange = parseTimeRangeFromText(args.lastHumanMessage);
    const requestedTimeLabel = requestedTimeRange?.startTime || null;
    const requestedTargetStartIso = requestedDateParts && requestedTimeLabel
      ? buildIsoFromDateAndTime(requestedDateParts, requestedTimeLabel, args.scheduleSettings || null)
      : null;
    const requestedTargetEndIso = requestedTargetStartIso
      ? (requestedTimeRange?.endTime
        ? buildIsoFromDateAndTime(requestedDateParts!, requestedTimeRange.endTime, args.scheduleSettings || null)
        : addMinutesToIso(requestedTargetStartIso, 60))
      : null;
    const candidateOptions = buildAppointmentCandidateOptions({ candidateIndexes: targetResolution.candidateIndexes, openAppointments });

    if (args.threadId) {
      await upsertAssistantContextState({
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: args.storeId,
        threadId: args.threadId,
        currentContextState: args.assistantContextState || null,
        patch: {
          active_topic: "appointment_management",
          active_intent: action,
          active_status: "waiting_user_choice",
          active_customer_name: candidateOptions[0]?.customer_name || args.assistantContextState?.active_customer_name || null,
          active_customer_phone: candidateOptions[0]?.customer_phone || args.assistantContextState?.active_customer_phone || null,
          active_lead_id: candidateOptions[0]?.lead_id || args.assistantContextState?.active_lead_id || null,
          active_conversation_id: candidateOptions[0]?.conversation_id || args.assistantContextState?.active_conversation_id || null,
          active_appointment_id: null,
          target_date: requestedTargetStartIso ? isoDateToLocalDateForDb(requestedTargetStartIso, scheduleTimezone) : (requestedDateKey || args.assistantContextState?.target_date || null),
          target_time: requestedTimeLabel || args.assistantContextState?.target_time || null,
          target_start_at: requestedTargetStartIso || args.assistantContextState?.target_start_at || null,
          target_end_at: requestedTargetEndIso || args.assistantContextState?.target_end_at || null,
          candidate_options: candidateOptions,
          context_payload: { reason: "appointment_ambiguity", action, requested_date: requestedDateKey, requested_time: requestedTimeLabel, target_preserved_from_context: !requestedTimeLabel && Boolean(args.assistantContextState?.target_time) },
          last_user_message: args.lastHumanMessage,
          timezone_name: scheduleTimezone,
        },
      });
    }

    const matchedOnRequestedDate = requestedDateKey
      ? targetResolution.candidateIndexes.some((candidateIndex) => {
          const candidate = openAppointments[candidateIndex];
          return getLocalDateKeyFromIso(candidate?.scheduled_start || candidate?.scheduled_end, args.scheduleSettings || null) === requestedDateKey;
        })
      : true;

    if (requestedDateParts && !matchedOnRequestedDate) {
      const requestedTime = parseTimeRangeFromText(args.lastHumanMessage)?.startTime || null;
      return buildAppointmentDateMismatchAlternativesReply({
        requestedDateParts,
        requestedTimeLabel: requestedTime,
        candidateIndexes: targetResolution.candidateIndexes,
        openAppointments,
        scheduleSettings: args.scheduleSettings || null,
      });
    }

    return buildAppointmentAmbiguityReply({
      candidateIndexes: targetResolution.candidateIndexes,
      openAppointments,
      scheduleSettings: args.scheduleSettings || null,
    });
  }

  if (targetResolution.type === "none") {
    const contextOptions = readAssistantCandidateOptions(args.assistantContextState || null);
    if (contextOptions.length) {
      const lines = [
        "Ainda estamos falando dos compromissos que listei antes, mas não consegui associar sua última mensagem a um item específico.",
        "",
        "Me diga o número do item que você quer atualizar:",
      ];
      contextOptions.slice(0, 8).forEach((option) => {
        lines.push(`${option.option_number}. ${formatAppointmentType(option.appointment_type)}${option.title ? ` ${option.title}` : ""}`);
        if (option.customer_name) lines.push(`- cliente: ${option.customer_name}`);
        if (option.scheduled_start) lines.push(`- horário: ${formatAppointmentStartInTimeZone({ value: option.scheduled_start, scheduleSettings: args.scheduleSettings || null, timezoneName: args.assistantContextState?.timezone_name || null })}`);
      });
      return lines.join("\n").trim();
    }

    const clarificationMatches = resolveAppointmentCandidateIndexesFromText({
      text: args.lastHumanMessage,
      openAppointments,
    });
    const clarificationCandidateIndexes = clarificationMatches.length
      ? clarificationMatches
      : openAppointments.map((_, index) => index).slice(0, 6);
    const candidateOptions = buildAppointmentCandidateOptions({
      candidateIndexes: clarificationCandidateIndexes,
      openAppointments,
    });
    const requestedDateParts = parseDateReferenceFromText(args.lastHumanMessage, now);
    const requestedDateKey = getDateKeyFromParts(requestedDateParts);
    const requestedTimeRange = parseTimeRangeFromText(args.lastHumanMessage);
    const requestedTimeLabel = requestedTimeRange?.startTime || null;

    if (args.threadId && candidateOptions.length) {
      await upsertAssistantContextState({
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: args.storeId,
        threadId: args.threadId,
        currentContextState: args.assistantContextState || null,
        patch: {
          active_topic: action === "reschedule" ? "appointment_reschedule" : "appointment_management",
          active_intent: action,
          active_status: "waiting_user_choice",
          active_customer_name: null,
          active_customer_phone: null,
          active_lead_id: null,
          active_conversation_id: null,
          active_appointment_id: null,
          target_date: requestedDateKey || null,
          target_time: requestedTimeLabel || null,
          target_start_at: null,
          target_end_at: null,
          timezone_name: scheduleTimezone,
          candidate_options: candidateOptions,
          context_payload: {
            reason: "appointment_clarification_options",
            action,
            requested_date: requestedDateKey,
            requested_time: requestedTimeLabel,
          },
          last_user_message: args.lastHumanMessage,
        },
      });
    }

    return buildProfessionalAppointmentClarificationReply({
      action,
      text: args.lastHumanMessage,
      openAppointments,
      scheduleSettings: args.scheduleSettings || null,
    });
  }

  let selectedIndex = Math.min(Math.max(targetResolution.index, 0), openAppointments.length - 1);
  let selectedAppointment = openAppointments[selectedIndex];

  if ((commandHasExplicitTitleAndOriginalSchedule || commandHasExplicitTitleOnly) && explicitAppointmentTitleCandidate) {
    const selectedMatchesExplicitTitle = appointmentTitleMatchesCommandTitle(
      selectedAppointment?.title,
      explicitAppointmentTitleCandidate
    );

    if (!selectedMatchesExplicitTitle) {
      const explicitMatches = commandHasExplicitTitleAndOriginalSchedule
        ? await loadExplicitAppointmentMatchesFromCommand({
            supabase: args.supabase,
            organizationId: args.organizationId,
            storeId: args.storeId,
            text: args.lastHumanMessage,
            now,
            scheduleSettings: args.scheduleSettings || null,
          })
        : await loadExplicitAppointmentTitleOnlyMatchesFromCommand({
            supabase: args.supabase,
            organizationId: args.organizationId,
            storeId: args.storeId,
            text: args.lastHumanMessage,
          });

      if (explicitMatches.length === 1) {
        selectedAppointment = explicitMatches[0];
        const existingIndex = openAppointments.findIndex((appointment) => appointment.id === selectedAppointment.id);
        selectedIndex = existingIndex >= 0 ? existingIndex : 0;
        if (existingIndex < 0) {
          openAppointments = [selectedAppointment, ...openAppointments];
        }
      } else {
        return "Encontrei um compromisso no contexto, mas ele não bate com o título informado. Para evitar alterar o compromisso errado, me confirme o cliente ou repita o compromisso com o nome do cliente.";
      }
    }
  }

  const selectedAppointmentTarget = buildCommercialTargetFromAppointment(
    selectedAppointment,
    "resolved_appointment_action",
  );
  const selectedAppointmentTargetAssertion = assertCommercialTargetForSideEffect({
    target: selectedAppointmentTarget,
    sideEffect: `appointment_${action}`,
  });
  if (!selectedAppointmentTargetAssertion.ok) {
    return "Identifiquei o compromisso, mas o alvo comercial não está canonicamente resolvido. Não alterei nada.";
  }

  if (action === "reschedule") {
    const contextPayload = readAssistantContextPayload(args.assistantContextState || null);
    const contextRequestedDateKey = String(contextPayload.requested_date || args.assistantContextState?.target_date || "").trim();
    const contextRequestedDateParts = parseDbDateKeyToScheduleParts(contextRequestedDateKey);
    const contextRequestedTime = String(contextPayload.requested_time || "").trim();
    const currentRequestTimeRange = parseTimeRangeFromText(args.lastHumanMessage);
    const choseItemWithDateButNoTime =
      isPlainAssistantOptionChoice(args.lastHumanMessage) &&
      contextRequestedDateParts &&
      !contextRequestedTime &&
      !currentRequestTimeRange?.startTime;

    if (choseItemWithDateButNoTime) {
      if (args.threadId) {
        await upsertAssistantContextState({
          supabase: args.supabase,
          organizationId: args.organizationId,
          storeId: args.storeId,
          threadId: args.threadId,
          currentContextState: args.assistantContextState || null,
          patch: {
            active_topic: "appointment_reschedule",
            active_intent: "reschedule",
            active_status: "active",
            active_customer_name: selectedAppointment.customer_name || null,
            active_customer_phone: selectedAppointment.customer_phone || null,
            active_lead_id: selectedAppointment.lead_id || null,
            active_conversation_id: selectedAppointment.conversation_id || null,
            active_appointment_id: selectedAppointment.id,
            target_date: contextRequestedDateKey || null,
            target_time: null,
            target_start_at: null,
            target_end_at: null,
            timezone_name: scheduleTimezone,
            candidate_options: [],
            context_payload: { reason: "selected_appointment_waiting_for_reschedule_time", selected_appointment_title: selectedAppointment.title || null, requested_date: contextRequestedDateKey || null },
            last_user_message: args.lastHumanMessage,
          },
        });
      }

      const targetLabel = selectedAppointment.customer_name
        ? `a ${formatAppointmentType(selectedAppointment.appointment_type)} de ${selectedAppointment.customer_name}`
        : buildScheduleAppointmentReferenceLabel(selectedAppointment);
      return `Certo, é ${targetLabel}. Para qual horário do dia ${formatDatePartsForHuman(contextRequestedDateParts)} você quer tentar remarcar?`;
    }

    const reschedulePayload = extractContextAwareReschedulePayload({
      text: args.lastHumanMessage,
      now,
      settings: args.scheduleSettings || null,
      contextState: args.assistantContextState || null,
    });
    if (!reschedulePayload.ok) {
      const requestedDatePartsForContext = parseDateReferenceFromText(args.lastHumanMessage, now);
      const requestedDateKeyForContext = getDateKeyFromParts(requestedDatePartsForContext);
      const requestedTimeRangeForContext = parseTimeRangeFromText(args.lastHumanMessage);
      if (args.threadId) {
        await upsertAssistantContextState({
          supabase: args.supabase,
          organizationId: args.organizationId,
          storeId: args.storeId,
          threadId: args.threadId,
          currentContextState: args.assistantContextState || null,
          patch: {
            active_topic: "appointment_reschedule",
            active_intent: "reschedule",
            active_status: "active",
            active_customer_name: selectedAppointment.customer_name || null,
            active_customer_phone: selectedAppointment.customer_phone || null,
            active_lead_id: selectedAppointment.lead_id || null,
            active_conversation_id: selectedAppointment.conversation_id || null,
            active_appointment_id: selectedAppointment.id,
            target_date: requestedDateKeyForContext || args.assistantContextState?.target_date || null,
            target_time: args.assistantContextState?.target_time || null,
            target_start_at: args.assistantContextState?.target_start_at || null,
            target_end_at: args.assistantContextState?.target_end_at || null,
            timezone_name: scheduleTimezone,
            candidate_options: [],
            context_payload: { reason: "selected_appointment_waiting_for_reschedule_time", selected_appointment_title: selectedAppointment.title || null, requested_date: requestedDateKeyForContext, target_preserved_from_context: Boolean(args.assistantContextState?.target_date || args.assistantContextState?.target_time) },
            last_user_message: args.lastHumanMessage,
          },
        });
      }

      if (asksAssistantToFindCustomerAvailability(args.lastHumanMessage)) {
        let customerMessageSent = false;

        if (!args.threadId) {
          return "Encontrei o compromisso, mas nÃ£o consegui registrar a tratativa porque a conversa da assistente nÃ£o foi identificada. A agenda ainda nÃ£o foi alterada.";
        }

        const preTaskResult = await createAssistantOperationalTask({
          supabase: args.supabase,
          organizationId: args.organizationId,
          storeId: args.storeId,
          threadId: args.threadId,
          taskType: "appointment_reschedule_find_customer_availability",
          status: "open",
          priority: "normal",
          title: `Verificar novo horÃ¡rio com ${selectedAppointment.customer_name || "cliente"}`,
          description: "A assistente registrou a tratativa para verificar disponibilidade com o cliente. A agenda ainda nÃ£o foi alterada.",
          appointment: selectedAppointment,
          timezoneName: scheduleTimezone,
          taskPayload: { customer_message_sent: false, source: "assistant.reply.route", original_user_message: args.lastHumanMessage, agenda_updated: false },
        });
        if (!preTaskResult.ok) {
          return `Encontrei o compromisso, mas nÃ£o consegui registrar a tratativa operacional: ${preTaskResult.error}. A agenda ainda nÃ£o foi alterada.`;
        }
        const preTaskLoadResult = await loadAssistantOperationalTaskById({
          supabase: args.supabase,
          organizationId: args.organizationId,
          storeId: args.storeId,
          taskId: preTaskResult.taskId,
        });
        if (!preTaskLoadResult.ok) {
          return `Registrei a tratativa operacional, mas nÃ£o consegui confirmar a task antes do contato: ${preTaskLoadResult.error}. A agenda ainda nÃ£o foi alterada.`;
        }
        const previousCustomerMessageSent = getOperationalTaskPayload(preTaskLoadResult.task).customer_message_sent === true;

        if (selectedAppointment.conversation_id) {
          const customerMessage = buildCustomerAvailabilityQuestion({
            appointment: selectedAppointment,
            scheduleSettings: args.scheduleSettings || null,
          });
          if (previousCustomerMessageSent) {
            customerMessageSent = true;
          } else {
            const sendResult = await sendAiMessageToCustomerConversation({
              supabase: args.supabase,
              conversationId: selectedAppointment.conversation_id,
              text: customerMessage,
              target: selectedAppointmentTarget,
            });
            customerMessageSent = sendResult.ok;
          }
        }

        let taskResult = { ok: true, error: null as string | null, taskId: null as string | null };
        if (args.threadId) {
          taskResult = await createAssistantOperationalTask({
            supabase: args.supabase,
            organizationId: args.organizationId,
            storeId: args.storeId,
            threadId: args.threadId,
            taskType: "appointment_reschedule_find_customer_availability",
            status: customerMessageSent ? "waiting_customer_response" : "open",
            priority: "normal",
            title: `Verificar novo horário com ${selectedAppointment.customer_name || "cliente"}`,
            description: customerMessageSent
              ? "A assistente enviou mensagem ao cliente para verificar disponibilidade. A agenda ainda não foi alterada."
              : "A assistente identificou o compromisso, mas não conseguiu enviar mensagem automática ao cliente.",
            appointment: selectedAppointment,
            timezoneName: scheduleTimezone,
            taskPayload: { customer_message_sent: customerMessageSent, source: "assistant.reply.route", original_user_message: args.lastHumanMessage, agenda_updated: false },
          });

  if (!taskResult.ok) {
    return `Encontrei o compromisso, mas nÃ£o consegui registrar a tratativa operacional: ${taskResult.error}. A agenda ainda nÃ£o foi alterada.`;
  }

  const taskStatusResult = await updateAssistantOperationalTaskAfterCustomerContact({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    taskId: taskResult.taskId,
    status: customerMessageSent ? "waiting_customer_response" : "open",
    description: customerMessageSent
      ? "A assistente enviou mensagem ao cliente para verificar disponibilidade. A agenda ainda nÃ£o foi alterada."
      : "A assistente registrou a tratativa para verificar disponibilidade com o cliente. A agenda ainda nÃ£o foi alterada.",
    taskPayload: {
      ...getOperationalTaskPayload(preTaskLoadResult.task),
      source: "assistant.reply.route",
      original_user_message: args.lastHumanMessage,
      customer_message_sent: customerMessageSent,
      agenda_updated: false,
      active_context_id: args.assistantContextState?.id || null,
      requested_action: "find_customer_availability",
    },
  });
  if (!taskStatusResult.ok) {
    return `Registrei a tratativa operacional, mas nÃ£o consegui confirmar o estado atualizado da task: ${taskStatusResult.error}. A agenda ainda nÃ£o foi alterada.`;
  }

  await upsertAssistantContextState({
            supabase: args.supabase,
            organizationId: args.organizationId,
            storeId: args.storeId,
            threadId: args.threadId,
            currentContextState: args.assistantContextState || null,
            patch: {
              active_topic: "appointment_reschedule",
              active_intent: "find_customer_availability",
              active_status: customerMessageSent ? "waiting_customer_response" : "active",
              active_customer_name: selectedAppointment.customer_name || null,
              active_customer_phone: selectedAppointment.customer_phone || null,
              active_lead_id: selectedAppointment.lead_id || null,
              active_conversation_id: selectedAppointment.conversation_id || null,
              active_appointment_id: selectedAppointment.id,
              timezone_name: scheduleTimezone,
              candidate_options: [],
              context_payload: { customer_message_sent: customerMessageSent, agenda_updated: false, reason: "waiting_customer_availability_before_reschedule", task_created: taskResult.ok },
              last_user_message: args.lastHumanMessage,
            },
          });
        }

        if (!taskResult.ok) {
          return `Encontrei o compromisso, mas não consegui registrar a tratativa operacional: ${taskResult.error}. A agenda ainda não foi alterada.`;
        }

        return buildResponsibleAvailabilityRequestReply({ appointment: selectedAppointment, customerMessageSent });
      }

      if (requestedDatePartsForContext && !requestedTimeRangeForContext?.startTime) {
        const targetLabel = selectedAppointment.customer_name
          ? `o compromisso de ${selectedAppointment.customer_name}`
          : buildScheduleAppointmentReferenceLabel(selectedAppointment);
        return `Certo, vou considerar ${targetLabel}. Para qual horário do dia ${formatDatePartsForHuman(requestedDatePartsForContext)} você quer tentar remarcar?`;
      }

      return `${reschedulePayload.message}

Eu já deixei este compromisso como assunto ativo: ${buildScheduleAppointmentReferenceLabel(selectedAppointment)}${selectedAppointment.customer_name ? ` de ${selectedAppointment.customer_name}` : ""}.`;
    }

      if (shouldCoordinateRescheduleWithCustomer(args.lastHumanMessage, selectedAppointment)) {
        const targetDateLabel = formatDateOnlyInTimeZone(reschedulePayload.payload.scheduled_start, scheduleTimezone);
        const targetTimeLabel = formatTimeOnlyInTimeZone(reschedulePayload.payload.scheduled_start, scheduleTimezone);

        if (!args.threadId) {
          return "Encontrei o compromisso, mas nÃ£o consegui registrar a tratativa porque a conversa da assistente nÃ£o foi identificada. A agenda nÃ£o foi alterada.";
        }

        if (!selectedAppointment.conversation_id) {
        const appointmentTypeLabel = formatAppointmentType(selectedAppointment.appointment_type);
        const customerName = selectedAppointment.customer_name || "cliente";
        return `Encontrei a ${appointmentTypeLabel} de ${customerName} e o horário ${targetDateLabel} às ${targetTimeLabel}, mas não achei uma conversa vinculada para enviar mensagem automaticamente. A agenda não foi alterada.`;
      }

      const preTaskResult = await createAssistantOperationalTask({
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: args.storeId,
        threadId: args.threadId,
        taskType: "appointment_reschedule_with_customer",
        status: "open",
        priority: "normal",
        title: `RemarcaÃ§Ã£o de ${buildScheduleAppointmentReferenceLabel(selectedAppointment)}${selectedAppointment.customer_name ? ` - ${selectedAppointment.customer_name}` : ""}`,
        description: "A assistente registrou a remarcaÃ§Ã£o antes de tentar contato com o cliente. A agenda ainda nÃ£o foi alterada.",
        appointment: selectedAppointment,
        targetStartIso: reschedulePayload.payload.scheduled_start,
        targetEndIso: reschedulePayload.payload.scheduled_end,
        timezoneName: scheduleTimezone,
        taskPayload: { customer_message_sent: false, source: "assistant.reply.route", original_user_message: args.lastHumanMessage, agenda_updated: false },
      });
      if (!preTaskResult.ok) {
        return `Encontrei o compromisso, mas nÃ£o consegui registrar a tratativa operacional: ${preTaskResult.error}. A agenda ainda nÃ£o foi alterada.`;
      }
      const preTaskLoadResult = await loadAssistantOperationalTaskById({
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: args.storeId,
        taskId: preTaskResult.taskId,
      });
      if (!preTaskLoadResult.ok) {
        return `Registrei a tratativa operacional, mas nÃ£o consegui confirmar a task antes do contato: ${preTaskLoadResult.error}. A agenda ainda nÃ£o foi alterada.`;
      }
      const previousCustomerMessageSent = getOperationalTaskPayload(preTaskLoadResult.task).customer_message_sent === true;

      const customerMessage = buildCustomerRescheduleMessage({
        appointment: selectedAppointment,
        proposedStartIso: reschedulePayload.payload.scheduled_start,
        scheduleSettings: args.scheduleSettings || null,
      });
      const sendResult = previousCustomerMessageSent
        ? { ok: true as const, error: null }
        : await sendAiMessageToCustomerConversation({
            supabase: args.supabase,
            conversationId: selectedAppointment.conversation_id,
            text: customerMessage,
            target: selectedAppointmentTarget,
          });

      if (!sendResult.ok) {
        const appointmentTypeLabel = formatAppointmentType(selectedAppointment.appointment_type);
        const customerName = selectedAppointment.customer_name || "cliente";
        return `Encontrei a ${appointmentTypeLabel} de ${customerName} e o horário ${targetDateLabel} às ${targetTimeLabel}, mas não consegui enviar a mensagem para ela agora. A agenda não foi alterada.`;
      }

      const customerMessageSent = true;
      let taskResult = { ok: true, error: null as string | null };
      if (args.threadId) {
        taskResult = await createAssistantOperationalTask({
          supabase: args.supabase,
          organizationId: args.organizationId,
          storeId: args.storeId,
          threadId: args.threadId,
          taskType: "appointment_reschedule_with_customer",
          status: customerMessageSent ? "waiting_customer_response" : "open",
          priority: "normal",
          title: `Remarcação de ${buildScheduleAppointmentReferenceLabel(selectedAppointment)}${selectedAppointment.customer_name ? ` - ${selectedAppointment.customer_name}` : ""}`,
          description: customerMessageSent
            ? "A assistente já iniciou contato com o cliente. A agenda ainda não foi alterada."
            : "A assistente identificou a remarcação, mas não conseguiu iniciar contato automático com o cliente.",
          appointment: selectedAppointment,
          targetStartIso: reschedulePayload.payload.scheduled_start,
          targetEndIso: reschedulePayload.payload.scheduled_end,
          timezoneName: scheduleTimezone,
          taskPayload: { customer_message_sent: customerMessageSent, source: "assistant.reply.route", original_user_message: args.lastHumanMessage },
        });

        if (!taskResult.ok) {
          return `Encontrei o compromisso, mas nÃ£o consegui registrar a tratativa operacional: ${taskResult.error}. A agenda ainda nÃ£o foi alterada.`;
        }

        await upsertAssistantContextState({
          supabase: args.supabase,
          organizationId: args.organizationId,
          storeId: args.storeId,
          threadId: args.threadId,
          currentContextState: args.assistantContextState || null,
          patch: {
            active_topic: "appointment_reschedule",
            active_intent: "reschedule",
            active_status: customerMessageSent ? "waiting_customer_response" : "active",
            active_customer_name: selectedAppointment.customer_name || null,
            active_customer_phone: selectedAppointment.customer_phone || null,
            active_lead_id: selectedAppointment.lead_id || null,
            active_conversation_id: selectedAppointment.conversation_id || null,
            active_appointment_id: selectedAppointment.id,
            target_start_at: reschedulePayload.payload.scheduled_start,
            target_end_at: reschedulePayload.payload.scheduled_end,
            target_date: isoDateToLocalDateForDb(reschedulePayload.payload.scheduled_start, scheduleTimezone),
            target_time: formatTimeOnlyInTimeZone(reschedulePayload.payload.scheduled_start, scheduleTimezone),
            timezone_name: scheduleTimezone,
            candidate_options: [],
            context_payload: { customer_message_sent: customerMessageSent, agenda_updated: false, reason: "waiting_customer_confirmation_before_reschedule", task_created: taskResult.ok },
            last_user_message: args.lastHumanMessage,
          },
        });
      }

      if (!taskResult.ok) {
        return `Encontrei o compromisso, mas não consegui registrar a tratativa operacional: ${taskResult.error}. A agenda ainda não foi alterada.`;
      }

      return buildResponsibleRescheduleContactReply({
        appointment: selectedAppointment,
        targetStartIso: reschedulePayload.payload.scheduled_start,
        customerMessageSent,
        scheduleSettings: args.scheduleSettings || null,
      });
    }

    const { data: updatedRows, error } = await args.supabase
      .from("store_appointments")
      .update({
        status: "rescheduled",
        scheduled_start: reschedulePayload.payload.scheduled_start,
        scheduled_end: reschedulePayload.payload.scheduled_end,
        notes: ((selectedAppointment.notes ? `${selectedAppointment.notes}\n\n` : "") + "Remarcado pela assistente operacional.").trim(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", selectedAppointment.id)
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .select("id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id, commercial_opportunity_id")
      .maybeSingle();

    if (error) {
      return `Tentei remarcar, mas encontrei um erro: ${error.message}`;
    }

    if (!updatedRows?.id) {
      return "Eu tentei remarcar o compromisso, mas não consegui confirmar a alteração real na agenda.";
    }

    if (args.threadId) {
      await resolveAssistantContextState({
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: args.storeId,
        threadId: args.threadId,
        currentContextState: args.assistantContextState || null,
        lastUserMessage: args.lastHumanMessage,
        lastAssistantMessage: `Compromisso remarcado para ${formatAppointmentStartInTimeZone({ value: (updatedRows as AppointmentRow).scheduled_start, scheduleSettings: args.scheduleSettings || null })}.`,
      });
    }

    return buildAppointmentActionSuccessReply({
      action,
      appointment: updatedRows as AppointmentRow,
      scheduleSettings: args.scheduleSettings || null,
    });
  }
  if (action === "complete") {
    const { error } = await args.supabase.rpc("complete_store_appointment_with_outcome", {
      p_appointment_id: selectedAppointment.id,
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_completion_outcome: "fully_completed",
      p_completion_note: "Confirmado pelo responsável na assistente operacional.",
    });

    if (error) {
      return `Tentei marcar como concluído, mas encontrei um erro: ${error.message}`;
    }

    if (args.threadId) {
      await resolveAssistantContextState({
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: args.storeId,
        threadId: args.threadId,
        currentContextState: args.assistantContextState || null,
        lastUserMessage: args.lastHumanMessage,
        lastAssistantMessage: `${buildScheduleAppointmentReferenceLabel(selectedAppointment)} de ${selectedAppointment.customer_name || "cliente não identificado"} concluído.`,
      });
    }

    return buildAppointmentActionSuccessReply({
      action,
      appointment: selectedAppointment,
      scheduleSettings: args.scheduleSettings || null,
    });
  }

  if (action === "needs_followup") {
    return buildAppointmentActionSuccessReply({
      action,
      appointment: selectedAppointment,
      scheduleSettings: args.scheduleSettings || null,
    });
  }

  if (action === "cancel") {
    if (appointmentHasCustomerInvolved(selectedAppointment)) {
      return startCustomerAppointmentCancelDecision({ supabase: args.supabase, organizationId: args.organizationId, storeId: args.storeId, threadId: args.threadId || null, assistantContextState: args.assistantContextState || null, lastHumanMessage: args.lastHumanMessage, appointment: selectedAppointment, scheduleSettings: args.scheduleSettings || null });
    }

    const { error: cancelError } = await args.supabase.rpc("cancel_store_appointment", {
      p_appointment_id: selectedAppointment.id,
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_cancel_reason: "Cancelado pelo responsável na assistente operacional.",
    });

    if (cancelError) {
      return `Tentei marcar como cancelado, mas encontrei um erro: ${cancelError.message}`;
    }

    if (args.threadId) {
      await resolveAssistantContextState({
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: args.storeId,
        threadId: args.threadId,
        currentContextState: args.assistantContextState || null,
        lastUserMessage: args.lastHumanMessage,
        lastAssistantMessage: `${buildScheduleAppointmentReferenceLabel(selectedAppointment)} de ${selectedAppointment.customer_name || "cliente não identificado"} cancelado.`,
      });
    }

    return buildAppointmentActionSuccessReply({
      action,
      appointment: selectedAppointment,
      scheduleSettings: args.scheduleSettings || null,
    });
  }

  return null;
}

function buildOpenAppointmentLine(appointment: AppointmentRow) {
  const parts = [
    buildScheduleAppointmentReferenceLabel(appointment),
    appointment.customer_name ? `cliente ${appointment.customer_name}` : null,
    appointment.customer_phone ? `contato ${appointment.customer_phone}` : null,
    appointment.scheduled_end || appointment.scheduled_start
      ? `horário ${formatAppointmentStartInTimeZone({ value: appointment.scheduled_start || appointment.scheduled_end || null, scheduleSettings: null })}`
      : null,
    `situação ${formatScheduleAppointmentCurrentSituation(appointment)}`,
  ].filter(Boolean);

  return `- ${parts.join(" • ")}`;
}

function asksForMorningReport(text: string) {
  const t = normalizeText(text);
  return hasAnyTerm(t, [
    "relatorio da manha",
    "resumo da manha",
    "me de o relatorio da manha",
    "inicio do dia",
    "atualizacao da manha",
    "atualizacao da manha",
    "relatorio matinal",
    "resumo matinal",
  ]);
}

function asksForEveningReport(text: string) {
  const t = normalizeText(text);
  return hasAnyTerm(t, [
    "relatorio do fim do dia",
    "relatorio de fim do dia",
    "resumo do fim do dia",
    "fechamento do dia",
    "encerramento do dia",
    "relatorio da noite",
    "fim do dia",
  ]);
}

function asksAboutNextVisit(text: string) {
  const t = normalizeText(text);
  return hasAnyTerm(t, [
    "proxima visita",
    "proximo compromisso",
    "o que eu preciso levar",
    "o que eu tenho que levar",
    "o que levar",
    "usar nessa visita",
    "levar na visita",
    "materiais da proxima visita",
    "checklist da proxima visita",
    "documentos da proxima visita",
  ]);
}

type AssistantIntent =
  | "morning_report"
  | "evening_report"
  | "next_visit"
  | "post_appointment"
  | "schedule_management"
  | "general";

function resolveAssistantIntent(text: string): AssistantIntent {
  if (asksForMorningReport(text)) return "morning_report";
  if (asksForEveningReport(text)) return "evening_report";
  if (asksAboutNextVisit(text)) return "next_visit";
  if (asksAboutPostAppointment(text)) return "post_appointment";
  if (asksAboutScheduleManagement(text)) return "schedule_management";
  return "general";
}

function resolveLatestResponsibleRequest(messages: AssistantMessageRow[]) {
  const ordered = [...messages].filter((message) => getMessageContent(message).length > 0);

  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const message = ordered[index];
    const content = getMessageContent(message);

    if (!content) continue;
    if (isAssistantOperationalMessage(message)) continue;

    const score = getResponsibleMessageScore(message);
    if (score < 100) continue;

    return {
      lastHumanMessage: content,
      detectedIntent: resolveAssistantIntent(content),
    };
  }

  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const message = ordered[index];
    const content = getMessageContent(message);

    if (!content) continue;
    if (isAssistantOperationalMessage(message)) continue;
    if (!messageLooksLikeDirectResponsibleRequest(content)) continue;

    return {
      lastHumanMessage: content,
      detectedIntent: resolveAssistantIntent(content),
    };
  }

  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const message = ordered[index];
    const content = getMessageContent(message);

    if (!content) continue;
    if (isAssistantOperationalMessage(message)) continue;
    if (isSystemOrContextMessageType(message)) continue;
    if (looksLikeAssistantGeneratedContentText(content)) continue;

    return {
      lastHumanMessage: content,
      detectedIntent: resolveAssistantIntent(content),
    };
  }

  return {
    lastHumanMessage: "",
    detectedIntent: "general" as AssistantIntent,
  };
}

type RuntimeStoreContext = {
  storeDisplayName: string;
  storeDescription: string;
  storeServices: string;
  city: string;
  state: string;
  serviceRegions: string;
  offersInstallation: string;
  offersTechnicalVisit: string;
  technicalVisitRules: string;
  installationProcess: string;
  acceptedPaymentMethods: string;
  importantLimitations: string;
  responsibleName: string;
};

function yesNoFromBoolean(value: boolean | null | undefined) {
  if (value === true) return "Sim";
  if (value === false) return "Não";
  return "";
}

function buildRuntimeStoreContext(args: {
  onboardingMap: Record<string, string>;
  store: StoreRow;
  strategySettings: StoreStrategySettingsRow | null;
  operationSettings: StoreOperationSettingsRow | null;
  paymentSettings: StorePaymentSettingsRow | null;
  primaryResponsibleName: string;
}): RuntimeStoreContext {
  const strategyInput = createStoreStrategySettingsInputFromSources({
    settings: args.strategySettings,
  });
  const operationInput = createStoreOperationSettingsInputFromSources({
    settings: args.operationSettings,
  });
  const paymentSummary = createStorePaymentDisplaySummaryFromSources({
    settings: args.paymentSettings,
  });

  return {
    storeDisplayName: args.store.name || "",
    storeDescription: strategyInput.storeDescription,
    storeServices: strategyInput.storeServices.join(", "),
    city: strategyInput.city,
    state: strategyInput.state,
    serviceRegions: strategyInput.serviceRegions,
    offersInstallation: yesNoFromBoolean(operationInput.offersInstallation),
    offersTechnicalVisit: yesNoFromBoolean(operationInput.offersTechnicalVisit),
    technicalVisitRules: [
      ...operationInput.technicalVisitRules,
      operationInput.technicalVisitRulesOther,
    ]
      .filter(Boolean)
      .join(", "),
    installationProcess: operationInput.installationProcessNotes,
    acceptedPaymentMethods: paymentSummary,
    importantLimitations: args.onboardingMap.important_limitations,
    responsibleName: args.primaryResponsibleName,
  };
}

function buildStoreBlock(storeContext: RuntimeStoreContext, store: StoreRow) {
  const entries: Array<[string, string | null | undefined]> = [
    ["nome da loja", storeContext.storeDisplayName || store.name],
    ["descrição", storeContext.storeDescription],
    ["serviços", storeContext.storeServices],
    ["cidade", storeContext.city],
    ["estado", storeContext.state],
    ["regiões", storeContext.serviceRegions],
    ["oferece instalação", storeContext.offersInstallation],
    ["oferece visita técnica", storeContext.offersTechnicalVisit],
    ["regras de visita técnica", storeContext.technicalVisitRules],
    ["processo de instalação", storeContext.installationProcess],
    ["pagamentos aceitos", storeContext.acceptedPaymentMethods],
    ["limitações importantes", storeContext.importantLimitations],
    ["nome do responsável", storeContext.responsibleName],
  ];

  const lines = entries
    .filter(([, value]) => value && String(value).trim().length > 0)
    .map(([label, value]) => `- ${label}: ${value}`);

  return lines.length ? lines.join("\n") : "- sem dados relevantes da loja";
}

function sortAssistantMessagesChronologically(messages: AssistantMessageRow[]) {
  return [...messages].sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return ta - tb;
  });
}

function buildHistoryBlock(messages: AssistantMessageRow[]) {
  const lines = messages
    .filter((msg) => String(msg.content || "").trim().length > 0)
    .slice(-8)
    .map((msg) => {
      const label = isAssistantOperationalMessage(msg)
        ? "Assistente"
        : isLikelyResponsibleMessage(msg)
          ? "Responsável"
          : "Sistema";

      return `${label}: ${String(msg.content || "").trim()}`;
    });

  return lines.length ? lines.join("\n") : "Sem histórico recente.";
}

function buildTodayAppointmentsBlock(items: AppointmentRow[]) {
  if (!items.length) {
    return "- nenhum compromisso para hoje";
  }

  return items
    .map((item) => {
      const parts = [
        `${formatAppointmentType(item.appointment_type)} ${formatAppointmentStatus(item.status)}`,
        item.scheduled_start ? `início ${formatDateTime(item.scheduled_start)}` : null,
        item.customer_name ? `cliente ${item.customer_name}` : null,
        item.customer_phone ? `telefone ${item.customer_phone}` : null,
        item.address_text ? `endereço ${item.address_text}` : null,
        item.title ? `título ${item.title}` : null,
      ].filter(Boolean);

      return `- ${parts.join(" • ")}`;
    })
    .join("\n");
}

function formatAppointmentCompactLine(item: AppointmentRow, scheduleSettings?: StoreScheduleSettingsRow | null) {
  const timeZone = getScheduleTimezone(scheduleSettings || null);
  const start = item.scheduled_start || item.scheduled_end;
  const end = item.scheduled_end;
  const timeLabel = start
    ? `${formatTimeOnlyInTimeZone(start, timeZone)}${end ? ` às ${formatTimeOnlyInTimeZone(end, timeZone)}` : ""}`
    : "sem horário";
  const title = item.title ? ` — ${item.title}` : "";
  const customer = item.customer_name ? ` — ${item.customer_name}` : "";
  return `${timeLabel} — ${formatAppointmentType(item.appointment_type)}${title}${customer} (${formatAppointmentStatus(item.status)})`;
}

function buildAppointmentLineForSpecificDayQuery(appointment: AppointmentRow, scheduleSettings?: StoreScheduleSettingsRow | null) {
  const timeZone = getScheduleTimezone(scheduleSettings || null);
  const start = appointment.scheduled_start || appointment.scheduled_end;
  const end = appointment.scheduled_end;
  const timeLabel = start
    ? `${formatTimeOnlyInTimeZone(start, timeZone)}${end ? ` às ${formatTimeOnlyInTimeZone(end, timeZone)}` : ""}`
    : "sem horário";

  const typeLabel = formatAppointmentType(appointment.appointment_type);
  const titleLabel = String(appointment.title || "").trim();
  const customerLabel = String(appointment.customer_name || "").trim();
  const status = normalizeText(appointment.status);
  const statusSuffix = status === "rescheduled" ? " (remarcado)" : status && status !== "scheduled" ? ` (${formatAppointmentStatus(appointment.status)})` : "";

  const subject = `${typeLabel}${titleLabel ? ` ${titleLabel}` : ""}`.trim();
  const customer = customerLabel ? ` com ${customerLabel}` : "";

  return `${subject}${customer} das ${timeLabel}${statusSuffix}`;
}

function buildScheduleBlockLineForSpecificDayQuery(block: StoreScheduleBlockRow, scheduleSettings?: StoreScheduleSettingsRow | null) {
  const timeZone = getScheduleTimezone(scheduleSettings || null);
  const start = block.start_at || block.end_at;
  const end = block.end_at;
  const timeLabel = start
    ? `${formatTimeOnlyInTimeZone(start, timeZone)}${end ? ` às ${formatTimeOnlyInTimeZone(end, timeZone)}` : ""}`
    : "sem horário";

  const rawTitle = String(block.title || "").trim();
  const blockType = normalizeText(block.block_type || "");
  const label = rawTitle || (blockType.includes("holiday") ? "Feriado/fechamento" : "Bloqueio da agenda");
  const labelHasTimeRange = /\b(?:das?\s*)?\d{1,2}(?::\d{2})?\s*h?\s*(?:as|a|-|ate)\s*(?:as?\s*)?\d{1,2}(?::\d{2})?\s*h?\b/.test(normalizeText(label));

  if (labelHasTimeRange) return label;

  return `${label} das ${timeLabel}`;
}

function sortScheduleBlocksForReply(blocks: StoreScheduleBlockRow[]) {
  return [...(blocks || [])].sort((a, b) => {
    const aTime = new Date(a.start_at || a.end_at || 0).getTime();
    const bTime = new Date(b.start_at || b.end_at || 0).getTime();
    return (Number.isFinite(aTime) ? aTime : 0) - (Number.isFinite(bTime) ? bTime : 0);
  });
}

function buildDeterministicSpecificDayScheduleReply(args: {
  dateParts: { day: number; month: number; year: number };
  appointments: AppointmentRow[];
  blocks?: StoreScheduleBlockRow[];
  includeBlocks?: boolean;
  scheduleSettings?: StoreScheduleSettingsRow | null;
}) {
  const dateLabel = formatDatePartsForHuman(args.dateParts);
  const appointments = sortOpenScheduleAppointments(args.appointments || []);
  const blocks = args.includeBlocks ? sortScheduleBlocksForReply(args.blocks || []) : [];

  if (!appointments.length && !blocks.length) {
    return args.includeBlocks
      ? `No dia ${dateLabel}, não encontrei compromisso ou bloqueio na agenda.`
      : `No dia ${dateLabel}, não encontrei compromisso agendado no sistema.`;
  }

  const lines: string[] = [];
  lines.push(`No dia ${dateLabel} você tem:`);
  lines.push("");

  if (appointments.length) {
    appointments.slice(0, 20).forEach((appointment, index) => {
      lines.push(`${index + 1}. ${buildAppointmentLineForSpecificDayQuery(appointment, args.scheduleSettings || null)}`);
    });
  } else {
    lines.push("- nenhum compromisso agendado no sistema.");
  }

  if (appointments.length > 20) {
    lines.push(`- e mais ${appointments.length - 20} compromisso(s).`);
  }

  if (blocks.length) {
    lines.push("");
    lines.push("Bloqueios/fechamentos:");
    blocks.slice(0, 20).forEach((block, index) => {
      lines.push(`${index + 1}. ${buildScheduleBlockLineForSpecificDayQuery(block, args.scheduleSettings || null)}`);
    });
    if (blocks.length > 20) {
      lines.push(`- e mais ${blocks.length - 20} bloqueio(s)/fechamento(s).`);
    }
  }

  lines.push("");
  lines.push("Quer detalhes de algum?");

  return lines.join("\n");
}


function appointmentMatchesAssistantContext(item: AppointmentRow, contextState?: StoreAssistantContextStateRow | null) {
  if (!contextState) return false;
  const activeLeadId = contextState.active_lead_id;
  const activeConversationId = contextState.active_conversation_id;
  const activeAppointmentId = contextState.active_appointment_id;
  const activeCustomerName = normalizeText(contextState.active_customer_name || "");
  const customerName = normalizeText(item.customer_name || "");

  return Boolean(
    (activeAppointmentId && item.id === activeAppointmentId) ||
    (activeLeadId && item.lead_id === activeLeadId) ||
    (activeConversationId && item.conversation_id === activeConversationId) ||
    (activeCustomerName && customerName && customerName.includes(activeCustomerName))
  );
}

function buildAssistantOperationalTasksBlock(tasks: StoreAssistantOperationalTaskRow[]) {
  const openTasks = (tasks || []).filter((task) =>
    ["open", "waiting_user_choice", "waiting_customer_response", "ready_to_execute", "in_progress"].includes(String(task.status || ""))
  );

  if (!openTasks.length) return "- sem tarefa operacional aberta da assistente";

  return openTasks
    .slice(0, 8)
    .map((task) => {
      const pieces = [
        task.title,
        task.customer_name ? `cliente ${task.customer_name}` : null,
        task.status ? `status ${task.status}` : null,
        task.target_date ? `data alvo ${task.target_date}` : null,
        task.target_time ? `hora alvo ${task.target_time}` : null,
      ].filter(Boolean);
      return `- ${pieces.join(" • ")}`;
    })
    .join("\n");
}

function isOperationalTreatmentAbandonmentIntent(text: string) {
  const normalized = normalizeText(text);
  const mentionsTreatment = /\b(tratativa|remarcacao|remarcação|reagendamento|fluxo|negociacao|negociação)\b/.test(normalized);
  const asksAbort = /\b(cancele|cancelar|cancela|abandone|abandonar|encerre|encerrar|pare|parar|desista|desistir)\b/.test(normalized);
  const mentionsAppointment = /\b(compromisso|agenda|visita tecnica|visita técnica|atendimento)\b/.test(normalized);
  return asksAbort && mentionsTreatment && !mentionsAppointment;
}

function findPendingCustomerContactOperationalTask(args: {
  openOperationalTasks: StoreAssistantOperationalTaskRow[];
  assistantContextState?: StoreAssistantContextStateRow | null;
}) {
  const contextTaskId = String(readAssistantContextPayload(args.assistantContextState || null).task_id || "").trim();
  const activeAppointmentId = String(args.assistantContextState?.active_appointment_id || "").trim();
  const candidates = (args.openOperationalTasks || []).filter((task) => {
    const taskType = String(task.task_type || "");
    const status = String(task.status || "");
    return ["appointment_reschedule_with_customer", "appointment_reschedule_find_customer_availability"].includes(taskType) &&
      ["open", "waiting_customer_response", "waiting_user_choice", "ready_to_execute", "in_progress"].includes(status) &&
      (!activeAppointmentId || task.related_appointment_id === activeAppointmentId);
  });

  if (contextTaskId) {
    const exactTask = candidates.find((task) => task.id === contextTaskId);
    if (exactTask) return { ok: true as const, task: exactTask, ambiguous: false };
  }

  if (candidates.length === 1) return { ok: true as const, task: candidates[0], ambiguous: false };
  if (candidates.length > 1) return { ok: false as const, task: null, ambiguous: true };
  return { ok: false as const, task: null, ambiguous: false };
}

export async function resolveOperationalTreatmentAbandonmentReply(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  threadId: string | null;
  assistantContextState?: StoreAssistantContextStateRow | null;
  openOperationalTasks: StoreAssistantOperationalTaskRow[];
  lastHumanMessage: string;
}) {
  if (!isOperationalTreatmentAbandonmentIntent(args.lastHumanMessage)) return null;
  if (!args.threadId) {
    return "Entendi que vocÃª quer encerrar a tratativa operacional, mas nÃ£o consegui identificar a thread da assistente. NÃ£o alterei agenda nem enviei mensagem ao cliente.";
  }

  const taskResult = findPendingCustomerContactOperationalTask({
    openOperationalTasks: args.openOperationalTasks,
    assistantContextState: args.assistantContextState || null,
  });

  if (taskResult.ambiguous) {
    return "Encontrei mais de uma tratativa operacional aberta. Para evitar encerrar a errada, nÃ£o alterei nada. Escolha a tratativa exata ou atualize a tela.";
  }

  if (!taskResult.task?.id) {
    if (args.assistantContextState) {
      const reply = "NÃ£o encontrei uma tratativa operacional pendente para encerrar. NÃ£o alterei agenda nem enviei mensagem ao cliente.";
      await resolveAssistantContextState({
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: args.storeId,
        threadId: args.threadId,
        currentContextState: args.assistantContextState,
        lastUserMessage: args.lastHumanMessage,
        lastAssistantMessage: reply,
      });
      return reply;
    }
    return "NÃ£o encontrei uma tratativa operacional pendente para encerrar. NÃ£o alterei agenda nem enviei mensagem ao cliente.";
  }

  const task = taskResult.task;
  const payload = getOperationalTaskPayload(task);
  const nowIso = new Date().toISOString();
  const { error: taskUpdateError } = await args.supabase
    .from("store_assistant_operational_tasks")
    .update({
      status: "cancelled",
      cancelled_at: nowIso,
      task_payload: {
        ...payload,
        abandoned_by_operator: true,
        abandoned_at: nowIso,
        abandon_reason: "operator_abandoned_operational_treatment",
        original_user_message: args.lastHumanMessage,
      },
      last_action_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", task.id)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId);

  if (taskUpdateError) {
    return `NÃ£o consegui encerrar a tratativa operacional com seguranÃ§a: ${taskUpdateError.message}. NÃ£o alterei agenda nem enviei mensagem ao cliente.`;
  }

  const { error: queueUpdateError } = await args.supabase
    .from("store_assistant_operational_task_queue")
    .update({
      status: "cancelled",
      processed_at: nowIso,
      result_payload: { reason: "operational_treatment_abandoned_by_operator", taskId: task.id },
      updated_at: nowIso,
    })
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("task_id", task.id)
    .in("status", ["pending", "ready", "processing"]);

  if (queueUpdateError) {
    return `A tratativa foi marcada como encerrada, mas não consegui interromper a fila antiga: ${queueUpdateError.message}. Não alterei a agenda nem enviei nova mensagem.`;
  }

  const reply = "Certo. Encerrei apenas a tratativa operacional de remarcaÃ§Ã£o. NÃ£o cancelei o compromisso na agenda e nÃ£o enviei nova mensagem ao cliente.";
  const contextResult = await resolveAssistantContextState({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    threadId: args.threadId,
    currentContextState: args.assistantContextState || null,
    lastUserMessage: args.lastHumanMessage,
    lastAssistantMessage: reply,
  });
  if (!contextResult.ok) {
    return `Encerrei a tratativa operacional, mas não consegui fechar o contexto da Assistente: ${contextResult.error || "erro desconhecido"}. Não alterei a agenda nem enviei nova mensagem.`;
  }
  return reply;
}

export function resolveExplicitCommercialOpportunityIdForAssistantTechnicalVisit(args: {
  openOperationalTasks: StoreAssistantOperationalTaskRow[];
}) {
  const uniqueOpportunityIds = Array.from(
    new Set(
      (args.openOperationalTasks || [])
        .filter((task) => normalizeText(task.task_type) === "commercial_visit_request")
        .map((task) => String((task as StoreAssistantOperationalTaskRow & { commercial_opportunity_id?: string | null }).commercial_opportunity_id || "").trim())
        .filter(Boolean),
    ),
  );

  return uniqueOpportunityIds.length === 1 ? uniqueOpportunityIds[0]! : null;
}

export async function resolveAuthorizedCommercialOpportunityIdForAssistantTechnicalVisit(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  openOperationalTasks: StoreAssistantOperationalTaskRow[];
  explicitCommercialOpportunityId?: string | null;
  expectedLeadId?: string | null;
  expectedConversationId?: string | null;
}) {
  const candidateOpportunityId =
    String(args.explicitCommercialOpportunityId || "").trim() ||
    resolveExplicitCommercialOpportunityIdForAssistantTechnicalVisit({
      openOperationalTasks: args.openOperationalTasks,
    });

  if (!candidateOpportunityId) {
    return {
      ok: false as const,
      reason: "opportunity_required",
      commercialOpportunityId: null as string | null,
      leadId: null as string | null,
      conversationId: null as string | null,
    };
  }

  const matchingTasks = (args.openOperationalTasks || []).filter((task) => {
    return (
      normalizeText(task.task_type) === "commercial_visit_request" &&
      String((task as StoreAssistantOperationalTaskRow & { commercial_opportunity_id?: string | null }).commercial_opportunity_id || "").trim() === candidateOpportunityId
    );
  });

  const expectedLeadId = String(args.expectedLeadId || "").trim();
  const expectedConversationId = String(args.expectedConversationId || "").trim();

  const { data, error } = await args.supabase
    .from("commercial_opportunities")
    .select("id, organization_id, store_id, origin_lead_id, primary_conversation_id")
    .eq("id", candidateOpportunityId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();

  if (error) {
    return {
      ok: false as const,
      reason: "opportunity_lookup_failed",
      commercialOpportunityId: null as string | null,
      leadId: null as string | null,
      conversationId: null as string | null,
    };
  }

  const opportunity =
    data && typeof data === "object"
      ? (data as {
          id?: string | null;
          origin_lead_id?: string | null;
          primary_conversation_id?: string | null;
        })
      : null;

  if (!opportunity || String(opportunity.id || "").trim() !== candidateOpportunityId) {
    return {
      ok: false as const,
      reason: "opportunity_not_found",
      commercialOpportunityId: null as string | null,
      leadId: null as string | null,
      conversationId: null as string | null,
    };
  }

  const opportunityLeadId = String(opportunity.origin_lead_id || "").trim();
  const opportunityConversationId = String(opportunity.primary_conversation_id || "").trim();
  if (
    (expectedLeadId && opportunityLeadId !== expectedLeadId) ||
    (expectedConversationId && opportunityConversationId !== expectedConversationId)
  ) {
    return {
      ok: false as const,
      reason: "opportunity_identity_mismatch",
      commercialOpportunityId: null as string | null,
      leadId: null as string | null,
      conversationId: null as string | null,
    };
  }
  const hasMismatchedTask = matchingTasks.some((task) => {
    const taskLeadId = String(task.related_lead_id || "").trim();
    const taskConversationId = String(task.related_conversation_id || "").trim();
    return (
      (taskLeadId && opportunityLeadId && taskLeadId !== opportunityLeadId) ||
      (taskConversationId &&
        opportunityConversationId &&
        taskConversationId !== opportunityConversationId)
    );
  });

  if (hasMismatchedTask) {
    return {
      ok: false as const,
      reason: "opportunity_context_mismatch",
      commercialOpportunityId: null as string | null,
      leadId: null as string | null,
      conversationId: null as string | null,
    };
  }

  return {
    ok: true as const,
    reason: "valid",
    commercialOpportunityId: candidateOpportunityId,
    leadId: opportunityLeadId || null,
    conversationId: opportunityConversationId || null,
  };
}

async function maybeProjectAppointmentToTechnicalVisitStageBySystem(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  appointmentId: string;
  appointmentType: string | null | undefined;
  appointmentStatus: string | null | undefined;
  commercialOpportunityId: string | null | undefined;
  source: string;
  operationSummary?: string;
}) {
  if (
    !shouldAttemptTechnicalVisitStageProjection({
      appointmentType: args.appointmentType,
      appointmentStatus: args.appointmentStatus,
      commercialOpportunityId: args.commercialOpportunityId,
    })
  ) {
    return null;
  }

  try {
    await projectTechnicalVisitStageBySystem({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      commercialOpportunityId: String(args.commercialOpportunityId || ""),
      appointmentId: args.appointmentId,
      source: args.source,
    });
    return null;
  } catch (error) {
    if (error instanceof TechnicalVisitStageProjectionError) {
      return error.message;
    }

    return `O compromisso foi ${args.operationSummary || "criado"}, mas nao foi possivel sincronizar a opportunity comercial.`;
  }
}

function buildDeterministicTodayOverviewReply(args: {
  todayAppointments: AppointmentRow[];
  pendingNotifications: PendingNotificationRow[];
  pendingPostFollowups: PostAppointmentFollowupRow[];
  openOperationalTasks: StoreAssistantOperationalTaskRow[];
  assistantContextState?: StoreAssistantContextStateRow | null;
  scheduleSettings?: StoreScheduleSettingsRow | null;
}) {
  const todayAppointments = sortOpenScheduleAppointments(args.todayAppointments || []);
  const activeContextItems = todayAppointments.filter((item) => appointmentMatchesAssistantContext(item, args.assistantContextState || null));
  const lines: string[] = [];

  if (activeContextItems.length && args.assistantContextState?.active_customer_name) {
    lines.push(`No assunto que estava aberto, hoje encontrei ${activeContextItems.length} compromisso(s) ligado(s) a ${args.assistantContextState.active_customer_name}:`);
    activeContextItems.slice(0, 5).forEach((item) => lines.push(`- ${formatAppointmentCompactLine(item, args.scheduleSettings || null)}`));
    lines.push("");
  }

  lines.push(todayAppointments.length === 1 ? "Agenda geral da loja hoje: 1 compromisso." : `Agenda geral da loja hoje: ${todayAppointments.length} compromissos.`);
  if (todayAppointments.length) {
    todayAppointments.slice(0, 8).forEach((item, index) => lines.push(`${index + 1}. ${formatAppointmentCompactLine(item, args.scheduleSettings || null)}`));
    if (todayAppointments.length > 8) lines.push(`- e mais ${todayAppointments.length - 8} compromisso(s).`);
  } else {
    lines.push("- não encontrei compromisso marcado para hoje.");
  }

  const openTasks = (args.openOperationalTasks || []).filter((task) => ["open", "waiting_user_choice", "waiting_customer_response", "ready_to_execute", "in_progress"].includes(String(task.status || "")));
  if (openTasks.length || args.pendingNotifications.length || args.pendingPostFollowups.length) {
    lines.push("");
    lines.push("Pendências operacionais no radar:");
    if (openTasks.length) openTasks.slice(0, 4).forEach((task) => lines.push(`- ${task.title}${task.status ? ` (${task.status})` : ""}`));
    if (args.pendingNotifications.length) lines.push(`- ${args.pendingNotifications.length} aviso(s) interno(s) pendente(s).`);
    if (args.pendingPostFollowups.length) lines.push(`- ${args.pendingPostFollowups.length} acompanhamento(s) pós-compromisso pendente(s).`);
  }

  return lines.join("\n").trim();
}

function buildOverdueAppointmentsBlock(items: AppointmentRow[]) {
  if (!items.length) {
    return "- nenhum compromisso em atraso detectado";
  }

  return items
    .map((item) => {
      const parts = [
        `${formatAppointmentType(item.appointment_type)} ${formatAppointmentStatus(item.status)}`,
        item.scheduled_start ? `previsto para ${formatDateTime(item.scheduled_start)}` : null,
        item.customer_name ? `cliente ${item.customer_name}` : null,
        item.title ? `título ${item.title}` : null,
      ].filter(Boolean);

      return `- ${parts.join(" • ")}`;
    })
    .join("\n");
}

function buildPendingNotificationsBlock(items: PendingNotificationRow[]) {
  if (!items.length) {
    return "- nenhuma pendência da assistente";
  }

  return items
    .map((item) => {
      const parts = [
        item.notification_type ? `tipo ${item.notification_type}` : null,
        item.priority ? `prioridade ${item.priority}` : null,
        item.title ? `título ${item.title}` : null,
        item.body ? `corpo ${item.body}` : null,
      ].filter(Boolean);

      return `- ${parts.join(" • ")}`;
    })
    .join("\n");
}

function buildFollowupLine(
  followup: PostAppointmentFollowupRow,
  appointmentMap: Map<string, AppointmentRow>
) {
  const appointment = appointmentMap.get(followup.appointment_id);

  const parts = [
    appointment
      ? `${formatAppointmentType(appointment.appointment_type)} ${formatAppointmentStatus(appointment.status)}`
      : "compromisso sem detalhes carregados",
    followup.followup_status ? formatFollowupStatus(followup.followup_status) : null,
    appointment?.customer_name ? `cliente ${appointment.customer_name}` : null,
    appointment?.customer_phone ? `telefone ${appointment.customer_phone}` : null,
    followup.scheduled_end ? `fim previsto ${formatDateTime(followup.scheduled_end)}` : null,
    followup.preferred_channel ? `canal ${formatPreferredChannel(followup.preferred_channel)}` : null,
    followup.prompt_count != null ? `tentativas ${followup.prompt_count}` : null,
    followup.resolution ? `resolução ${formatResolution(followup.resolution)}` : null,
    followup.notes ? `observação ${followup.notes}` : null,
  ].filter(Boolean);

  return `- ${parts.join(" • ")}`;
}

function buildPendingPostAppointmentBlock(
  items: PostAppointmentFollowupRow[],
  appointmentMap: Map<string, AppointmentRow>
) {
  if (!items.length) {
    return "- nenhum retorno pendente";
  }

  return items.map((item) => buildFollowupLine(item, appointmentMap)).join("\n");
}

function buildResolvedPostAppointmentBlock(
  items: PostAppointmentFollowupRow[],
  appointmentMap: Map<string, AppointmentRow>
) {
  if (!items.length) {
    return "- nenhum retorno resolvido recentemente";
  }

  return items.map((item) => buildFollowupLine(item, appointmentMap)).join("\n");
}

function countAppointmentsByStatus(items: AppointmentRow[], statuses: string[]) {
  return items.filter((item) => statuses.includes(normalizeText(item.status))).length;
}

function buildMorningReportData(args: {
  todayAppointments: AppointmentRow[];
  overdueAppointments: AppointmentRow[];
  pendingNotifications: PendingNotificationRow[];
  pendingPostFollowups: PostAppointmentFollowupRow[];
}) {
  const todayCount = args.todayAppointments.length;
  const firstImportant =
    args.todayAppointments.find((item) => {
      const type = normalizeText(item.appointment_type);
      return type === "technical_visit" || type === "installation";
    }) || args.todayAppointments[0] || null;

  const pendingToday = countAppointmentsByStatus(args.todayAppointments, ["scheduled", "rescheduled"]);
  const overdueCount = args.overdueAppointments.length;
  const notificationCount = args.pendingNotifications.length;
  const pendingPostCount = args.pendingPostFollowups.length;

  return {
    todayCount,
    firstImportant,
    pendingToday,
    overdueCount,
    notificationCount,
    pendingPostCount,
  };
}

function buildEveningReportData(args: {
  todayAppointments: AppointmentRow[];
  overdueAppointments: AppointmentRow[];
  pendingNotifications: PendingNotificationRow[];
  pendingPostFollowups: PostAppointmentFollowupRow[];
}) {
  const plannedToday = args.todayAppointments.length;
  const completedToday = countAppointmentsByStatus(args.todayAppointments, ["completed"]);
  const cancelledToday = countAppointmentsByStatus(args.todayAppointments, ["cancelled"]);
  const stillOpenToday = countAppointmentsByStatus(args.todayAppointments, ["scheduled", "rescheduled"]);
  const overdueCount = args.overdueAppointments.length;
  const pendingPostCount = args.pendingPostFollowups.length;
  const notificationCount = args.pendingNotifications.length;

  return {
    plannedToday,
    completedToday,
    cancelledToday,
    stillOpenToday,
    overdueCount,
    pendingPostCount,
    notificationCount,
  };
}

function buildMorningReportBlock(args: {
  todayAppointments: AppointmentRow[];
  overdueAppointments: AppointmentRow[];
  pendingNotifications: PendingNotificationRow[];
  pendingPostFollowups: PostAppointmentFollowupRow[];
}) {
  const data = buildMorningReportData(args);

  const firstImportantLine = data.firstImportant
    ? `- primeiro compromisso mais importante: ${formatAppointmentType(
        data.firstImportant.appointment_type
      )} às ${formatTimeOnly(data.firstImportant.scheduled_start)}${
        data.firstImportant.customer_name ? ` com ${data.firstImportant.customer_name}` : ""
      }`
    : "- primeiro compromisso mais importante: nenhum compromisso crítico encontrado";

  return [
    `- compromissos de hoje: ${data.todayCount}`,
    firstImportantLine,
    `- compromissos de hoje ainda em aberto: ${data.pendingToday}`,
    `- compromissos em atraso ou ainda não baixados: ${data.overdueCount}`,
    `- retornos pendentes: ${data.pendingPostCount}`,
    `- avisos internos: ${data.notificationCount}`,
  ].join("\n");
}

function buildEveningReportBlock(args: {
  todayAppointments: AppointmentRow[];
  overdueAppointments: AppointmentRow[];
  pendingNotifications: PendingNotificationRow[];
  pendingPostFollowups: PostAppointmentFollowupRow[];
}) {
  const data = buildEveningReportData(args);

  return [
    `- compromissos previstos para hoje: ${data.plannedToday}`,
    `- concluídos hoje: ${data.completedToday}`,
    `- cancelados hoje: ${data.cancelledToday}`,
    `- ainda em aberto de hoje: ${data.stillOpenToday}`,
    `- compromissos em atraso ou não baixados: ${data.overdueCount}`,
    `- retornos pendentes: ${data.pendingPostCount}`,
    `- avisos internos: ${data.notificationCount}`,
  ].join("\n");
}

function buildDeterministicMorningReport(args: {
  todayAppointments: AppointmentRow[];
  overdueAppointments: AppointmentRow[];
  pendingNotifications: PendingNotificationRow[];
  pendingPostFollowups: PostAppointmentFollowupRow[];
}) {
  const data = buildMorningReportData(args);

  const lines: string[] = [];
  lines.push("Relatório da manhã:");
  lines.push(`- compromissos de hoje: ${data.todayCount}`);

  if (data.firstImportant) {
    lines.push(
      `- destaque do dia: ${formatAppointmentType(
        data.firstImportant.appointment_type
      )} às ${formatTimeOnly(data.firstImportant.scheduled_start)}${
        data.firstImportant.customer_name ? ` com ${data.firstImportant.customer_name}` : ""
      }`
    );
  } else {
    lines.push("- destaque do dia: nenhum compromisso crítico encontrado");
  }

  lines.push(`- em aberto hoje: ${data.pendingToday}`);
  lines.push(`- em atraso: ${data.overdueCount}`);
  lines.push(`- retornos pendentes: ${data.pendingPostCount}`);
  lines.push(`- avisos internos: ${data.notificationCount}`);

  return lines.join("\n");
}

function buildDeterministicEveningReport(args: {
  todayAppointments: AppointmentRow[];
  overdueAppointments: AppointmentRow[];
  pendingNotifications: PendingNotificationRow[];
  pendingPostFollowups: PostAppointmentFollowupRow[];
}) {
  const data = buildEveningReportData(args);

  const lines: string[] = [];
  lines.push("Fechamento do dia:");
  lines.push(`- previstos hoje: ${data.plannedToday}`);
  lines.push(`- concluídos: ${data.completedToday}`);
  lines.push(`- cancelados: ${data.cancelledToday}`);
  lines.push(`- ainda em aberto: ${data.stillOpenToday}`);
  lines.push(`- em atraso: ${data.overdueCount}`);
  lines.push(`- retornos pendentes: ${data.pendingPostCount}`);
  lines.push(`- avisos internos: ${data.notificationCount}`);

  return lines.join("\n");
}


function buildDeterministicNextVisitReply(nextAppointments: AppointmentRow[]) {
  const nextAppointment = (nextAppointments || [])[0];

  if (!nextAppointment) {
    return [
      "Próxima visita:",
      "- não encontrei próximo compromisso agendado no sistema.",
      "- se você quiser, posso te ajudar a revisar a agenda e as pendências abertas.",
    ].join("\n");
  }

  const lines: string[] = [];
  lines.push("Próxima visita:");
  lines.push(
    `- ${formatAppointmentType(nextAppointment.appointment_type)} ${formatAppointmentStatus(
      nextAppointment.status
    )} para ${formatDateOnly(nextAppointment.scheduled_start)} às ${formatTimeOnly(
      nextAppointment.scheduled_start
    )}`
  );

  if (nextAppointment.customer_name) {
    lines.push(`- cliente: ${nextAppointment.customer_name}`);
  }

  if (nextAppointment.customer_phone) {
    lines.push(`- contato: ${nextAppointment.customer_phone}`);
  }

  if (nextAppointment.address_text) {
    lines.push(`- local: ${nextAppointment.address_text}`);
  }

  if (nextAppointment.notes) {
    lines.push(`- observações do sistema: ${nextAppointment.notes}`);
  }

  lines.push(
    "- materiais, documentos e checklist específicos só podem ser tratados como confirmados se estiverem registrados por aqui; sem isso, considere apenas uma revisão rápida do básico antes de sair."
  );

  return lines.join("\n");
}

function isOpenPostFollowup(item: PostAppointmentFollowupRow | null | undefined) {
  if (!item) return false;

  const followupStatus = normalizeText(item.followup_status);
  const resolution = normalizeText(item.resolution);

  if (item.resolved_at) return false;
  if (followupStatus === "confirmed_completed") return false;
  if (followupStatus === "confirmed_rescheduled") return false;
  if (followupStatus === "confirmed_cancelled") return false;
  if (resolution === "completed") return false;
  if (resolution === "rescheduled") return false;
  if (resolution === "cancelled") return false;

  return true;
}

function sortOpenPostFollowups(items: PostAppointmentFollowupRow[]) {
  return [...items].sort((a, b) => {
    const aScheduled = a.scheduled_end ? new Date(a.scheduled_end).getTime() : Number.MAX_SAFE_INTEGER;
    const bScheduled = b.scheduled_end ? new Date(b.scheduled_end).getTime() : Number.MAX_SAFE_INTEGER;
    if (aScheduled !== bScheduled) return aScheduled - bScheduled;

    const aUpdated = a.updated_at ? new Date(a.updated_at).getTime() : 0;
    const bUpdated = b.updated_at ? new Date(b.updated_at).getTime() : 0;
    return bUpdated - aUpdated;
  });
}

function buildFriendlyPostFollowupObservation(note?: string | null) {
  const normalized = normalizeText(note);
  if (!normalized) return null;

  if (normalized.includes("apos a conclusao ainda falta retorno")) {
    return "esse atendimento foi concluído, mas ainda falta retorno com o cliente.";
  }

  if (normalized.includes("reabertura automatica pos-compromisso")) {
    return "esse atendimento já passou do horário e ainda não foi confirmado.";
  }

  if (
    normalized.includes("confirmacao manual de teste: compromisso concluido") ||
    normalized.includes("confirmacao manual de teste: compromisso remarcado") ||
    normalized.includes("confirmacao manual de teste: compromisso cancelado")
  ) {
    return "existe um histórico anterior nesse atendimento, mas ele voltou para a fila de confirmação.";
  }

  if (normalized.includes("fechamento do atendimento")) {
    return "esse atendimento já foi encerrado por completo.";
  }

  const cleaned = (note || "")
    .replace(/\[[^\]]+\]\s*/g, "")
    .replace(/Confirmação manual de teste:[^.]*\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || null;
}

function buildDeterministicPostAppointmentReply(args: {
  pendingPostFollowups: PostAppointmentFollowupRow[];
  recentResolvedPostFollowups: PostAppointmentFollowupRow[];
  appointmentMap: Map<string, AppointmentRow>;
  openAppointments: AppointmentRow[];
  lastHumanMessage: string;
}) {
  const openFollowups = sortOpenPostFollowups(
    (args.pendingPostFollowups || []).filter((item) => isOpenPostFollowup(item))
  );

  const openAppointments = sortOpenScheduleAppointments(args.openAppointments || []);
  const wantsFullList = asksToListAllPostAppointments(args.lastHumanMessage);

  if (!openFollowups.length && !openAppointments.length) {
    return "Hoje não há retorno pendente nem compromisso em aberto.";
  }

  if (!openFollowups.length && openAppointments.length) {
    const detailIndex = resolvePostAppointmentDetailIndex(args.lastHumanMessage, openAppointments.length);
    const wantsSpecificDetail = detailIndex !== null && !wantsFullList;
    const current = openAppointments[Math.min(Math.max(detailIndex ?? 0, 0), openAppointments.length - 1)];

    if (wantsSpecificDetail) {
      const itemNumber = (detailIndex ?? 0) + 1;
      const lines: string[] = [];
      lines.push(`Claro. Sobre o item ${itemNumber}:`);
      lines.push("");
      lines.push(`- tipo: ${formatAppointmentType(current.appointment_type)}`);

      if (current.title) {
        lines.push(`- título: ${current.title}`);
      }

      if (current.customer_name) {
        lines.push(`- cliente: ${current.customer_name}`);
      }

      if (current.customer_phone) {
        lines.push(`- contato: ${current.customer_phone}`);
      }

      if (current.address_text) {
        lines.push(`- endereço: ${current.address_text}`);
      }

      const timeLabel = current.scheduled_end || current.scheduled_start;
      if (timeLabel) {
        lines.push(`- horário: ${formatDateOnly(timeLabel)} às ${formatTimeOnly(timeLabel)}`);
      }

      lines.push(`- situação atual: ${formatScheduleAppointmentCurrentSituation(current)}`);
      lines.push("");
      lines.push("Se quiser, eu posso te ajudar a concluir, cancelar ou remarcar esse item.");

      return lines.join("\n");
    }

    const lines: string[] = [];
    lines.push(
      openAppointments.length === 1
        ? "Hoje você tem 1 compromisso em aberto."
        : `Hoje você tem ${openAppointments.length} compromissos em aberto.`
    );
    lines.push("");

    if (wantsFullList) {
      openAppointments.forEach((item, index) => {
        lines.push(`${index + 1}. ${buildScheduleAppointmentReferenceLabel(item)}`);
        if (item.customer_name) {
          lines.push(`- cliente: ${item.customer_name}`);
        }
        if (item.customer_phone) {
          lines.push(`- contato: ${item.customer_phone}`);
        }
        const timeLabel = item.scheduled_end || item.scheduled_start;
        if (timeLabel) {
          lines.push(`- horário: ${formatDateOnly(timeLabel)} às ${formatTimeOnly(timeLabel)}`);
        }
        lines.push(`- situação atual: ${formatScheduleAppointmentCurrentSituation(item)}`);

        if (index < openAppointments.length - 1) {
          lines.push("");
        }
      });

      lines.push("");
      lines.push("Se quiser, eu posso detalhar qualquer um deles.");
      return lines.join("\n");
    }

    const currentItem = openAppointments[0];
    lines.push(`O item mais urgente agora é ${buildScheduleAppointmentReferenceLabel(currentItem)}.`);

    if (currentItem.customer_name) {
      lines.push(`- cliente: ${currentItem.customer_name}`);
    }

    if (currentItem.customer_phone) {
      lines.push(`- contato: ${currentItem.customer_phone}`);
    }

    const currentTimeLabel = currentItem.scheduled_end || currentItem.scheduled_start;
    if (currentTimeLabel) {
      lines.push(`- horário: ${formatDateOnly(currentTimeLabel)} às ${formatTimeOnly(currentTimeLabel)}`);
    }

    lines.push(`- situação atual: ${formatScheduleAppointmentCurrentSituation(currentItem)}`);

    if (openAppointments.length > 1) {
      lines.push("");
      lines.push(`Além desse item, há mais ${openAppointments.length - 1} compromissos em aberto.`);
    }

    lines.push("");
    lines.push("Se quiser, eu posso listar os próximos.");

    return lines.join("\n");
  }

  const detailIndex = resolvePostAppointmentDetailIndex(args.lastHumanMessage, openFollowups.length);
  const wantsSpecificDetail = detailIndex !== null && !wantsFullList;
  const current = openFollowups[Math.min(Math.max(detailIndex ?? 0, 0), openFollowups.length - 1)];
  const appointment = args.appointmentMap.get(current.appointment_id);
  const lines: string[] = [];

  if (wantsSpecificDetail) {
    const itemNumber = (detailIndex ?? 0) + 1;
    lines.push(`Claro. Sobre o item ${itemNumber}:`);
    lines.push("");

    lines.push(`- tipo: ${appointment ? formatAppointmentType(appointment.appointment_type) : "atendimento"}`);

    if (appointment?.title) {
      lines.push(`- título: ${appointment.title}`);
    }

    if (appointment?.customer_name) {
      lines.push(`- cliente: ${appointment.customer_name}`);
    }

    if (appointment?.customer_phone) {
      lines.push(`- contato: ${appointment.customer_phone}`);
    }

    if (appointment?.address_text) {
      lines.push(`- endereço: ${appointment.address_text}`);
    }

    const timeLabel = appointment?.scheduled_end || appointment?.scheduled_start || current.scheduled_end;
    if (timeLabel) {
      lines.push(`- horário original: ${formatDateOnly(timeLabel)} às ${formatTimeOnly(timeLabel)}`);
    }

    lines.push(`- situação atual: ${formatPostAppointmentCurrentSituation(current)}`);

    const friendlyObservation = buildFriendlyPostFollowupObservation(current.notes);
    if (friendlyObservation) {
      lines.push(`- detalhe rápido: ${friendlyObservation}`);
    }

    lines.push("");
    lines.push(
      "Se quiser, eu também posso te ajudar a marcar esse item como concluído, cancelado, remarcado ou ainda pendente."
    );

    return lines.join("\n");
  }

  lines.push(
    openFollowups.length === 1
      ? "Hoje você tem 1 retorno pendente."
      : `Hoje você tem ${openFollowups.length} retornos pendentes.`
  );

  if (openAppointments.length) {
    lines.push(
      openAppointments.length === 1
        ? "Também há 1 compromisso em aberto."
        : `Também há ${openAppointments.length} compromissos em aberto.`
    );
  }

  lines.push("");

  if (wantsFullList) {
    openFollowups.forEach((item, index) => {
      const itemAppointment = args.appointmentMap.get(item.appointment_id);
      const itemTitle = buildPostAppointmentTypeAndTitle(itemAppointment);
      const itemTimeLabel = itemAppointment?.scheduled_end || itemAppointment?.scheduled_start || item.scheduled_end;
      const itemCustomer = itemAppointment?.customer_name || "cliente não identificado";

      lines.push(`${index + 1}. ${itemTitle.charAt(0).toUpperCase() + itemTitle.slice(1)}`);
      lines.push(`- cliente: ${itemCustomer}`);

      if (itemAppointment?.customer_phone) {
        lines.push(`- contato: ${itemAppointment.customer_phone}`);
      }

      if (itemTimeLabel) {
        lines.push(`- horário original: ${formatDateOnly(itemTimeLabel)} às ${formatTimeOnly(itemTimeLabel)}`);
      }

      lines.push(`- situação atual: ${formatPostAppointmentCurrentSituation(item)}`);

      const itemObservation = buildFriendlyPostFollowupObservation(item.notes);
      if (itemObservation) {
        lines.push(`- detalhe rápido: ${itemObservation}`);
      }

      if (index < openFollowups.length - 1) {
        lines.push("");
      }
    });

    lines.push("");
    lines.push("Se quiser, eu posso detalhar qualquer um deles.");
    return lines.join("\n");
  }

  if (appointment) {
    const timeLabel = appointment.scheduled_end || appointment.scheduled_start || current.scheduled_end;
    const appointmentTypeLabel = formatAppointmentType(appointment.appointment_type);
    lines.push(
      `O retorno mais urgente agora é ${appointmentTypeLabel}${appointment.title ? ` ${appointment.title}` : ""}.`
    );

    if (timeLabel) {
      lines.push(`- horário original: ${formatDateOnly(timeLabel)} às ${formatTimeOnly(timeLabel)}`);
    }

    if (appointment.customer_name) {
      lines.push(`- cliente: ${appointment.customer_name}`);
    }

    if (appointment.customer_phone) {
      lines.push(`- contato: ${appointment.customer_phone}`);
    }

    lines.push(`- situação atual: ${formatPostAppointmentCurrentSituation(current)}`);
  } else if (current.scheduled_end) {
    lines.push(`O retorno mais urgente agora é de um atendimento encerrado em ${formatDateTime(current.scheduled_end)}.`);
    lines.push(`- situação atual: ${formatPostAppointmentCurrentSituation(current)}`);
  } else {
    lines.push("Existe um retorno pendente sem detalhes completos por aqui.");
  }

  const friendlyObservation = buildFriendlyPostFollowupObservation(current.notes);
  if (friendlyObservation) {
    lines.push(`- detalhe rápido: ${friendlyObservation}`);
  }

  if (openFollowups.length > 1) {
    lines.push("");
    lines.push(`Além desse retorno, há mais ${openFollowups.length - 1} pendências de retorno.`);
  }

  if (openAppointments.length) {
    lines.push("");
    lines.push(
      openAppointments.length === 1
        ? "Também há 1 compromisso em aberto na agenda."
        : `Também há ${openAppointments.length} compromissos em aberto na agenda.`
    );
  }

  lines.push("");
  lines.push("Se quiser, eu posso listar os próximos por ordem de urgência.");

  return lines.join("\n");
}

function buildRequestAnalysisBlock(lastHumanMessage: string) {
  const materialRequest = asksAboutMaterialsOrDocuments(lastHumanMessage);
  const todayRequest = asksAboutToday(lastHumanMessage);
  const intent = resolveAssistantIntent(lastHumanMessage);
  const postAppointmentRequest = intent === "post_appointment";
  const morningReportRequest = intent === "morning_report";
  const eveningReportRequest = intent === "evening_report";
  const nextVisitRequest = intent === "next_visit";

  return [
    `- pedido ligado a materiais/documentos/checklist: ${materialRequest ? "sim" : "não"}`,
    materialRequest
      ? "- quando responder isso, trate qualquer orientação de materiais ou documentos como sugestão genérica, nunca como procedimento confirmado da loja, a menos que exista base explícita no sistema"
      : "- não há pedido direto sobre materiais ou documentos nesta mensagem",
    `- pedido ligado a agenda, urgência ou compromissos: ${todayRequest ? "sim" : "não"}`,
    `- pedido ligado a retorno pendente ou acompanhamento: ${postAppointmentRequest ? "sim" : "não"}`,
    `- pedido de relatório da manhã: ${morningReportRequest ? "sim" : "não"}`,
    `- pedido de relatório do fim do dia: ${eveningReportRequest ? "sim" : "não"}`,
    `- pedido ligado à próxima visita ou ao que levar: ${nextVisitRequest ? "sim" : "não"}`,
    `- pedido ligado a criar, cancelar, concluir ou remarcar compromisso: ${intent === "schedule_management" ? "sim" : "não"}`,
  ].join("\n");
}

const ZION_POOL_STORE_ASSISTANT_BEHAVIOR_MAP = [
  "MAPA OPERACIONAL AMPLO DO ASSISTENTE ZION PARA LOJAS DE PISCINA",
  "Regra-mãe: entenda a intenção, use dados reais, escolha o próximo passo seguro e nunca confirme ação sem prova real.",
  "O assistente deve agir como uma gerente operacional da loja: organizado, proativo, simples, confiável e focado em resolver.",
  "",
  "0) DECISÃO PRINCIPAL EM TODA MENSAGEM",
  "- Primeiro classifique a mensagem: consulta, ação de agenda, bloqueio, cliente/CRM, catálogo/produto, rotina da loja, relatório, pendência, dúvida geral ou pedido ambíguo.",
  "- Depois veja se há dados reais suficientes: cliente, compromisso, data, horário, título, status, conversa vinculada, telefone ou lista recente.",
  "- Se há um único caminho seguro: execute ou encaminhe a ação certa.",
  "- Se há mais de uma opção: liste opções reais, numeradas, com cliente, tipo, data e horário, e peça escolha objetiva.",
  "- Se não há dados reais: diga o que faltou, não invente, e sugira a menor próxima pergunta possível.",
  "- Se a ação afeta cliente ou agenda: nunca prometa execução antes de validar banco, conflitos, bloqueios e necessidade de confirmação do cliente.",
  "",
  "1) AGENDA: CONSULTAR, ORGANIZAR E PRIORIZAR",
  "- Pedido: 'o que tem hoje?', 'agenda de hoje', 'próximos compromissos', 'como está a agenda'.",
  "- Resposta correta: listar compromissos em aberto por ordem de urgência, com tipo, título, cliente, horário e situação atual.",
  "- Se houver compromisso vencido em aberto: destaque como atenção, mas não marque como concluído sem ordem do responsável.",
  "- Se houver muitos compromissos: mostre os mais importantes e diga quantos ainda existem.",
  "- Se houver bloqueios no dia: mencione que a agenda tem bloqueio e que isso limita novos horários.",
  "- Se o responsável perguntar 'qual o mais urgente?': escolha o compromisso vencido ou mais próximo e explique em uma frase.",
  "",
  "2) AGENDA: CRIAR COMPROMISSO",
  "- Pedido: 'agende', 'marque visita', 'crie compromisso', 'marque instalação'.",
  "- Dados mínimos: tipo, data, horário, cliente ou título. Telefone/endereço são desejáveis, mas não inventar se faltarem.",
  "- Antes de criar: respeitar bloqueios, janela operacional e conflitos.",
  "- Se faltar data ou hora: pergunte só isso, não faça formulário longo.",
  "- Se criar de verdade: confirme com data, horário, cliente e tipo.",
  "- Se não criar: explique o motivo simples e sugira alternativa quando possível.",
  "",
  "3) AGENDA: REMARCAR COMPROMISSO",
  "- Pedido: 'remarque', 'reagende', 'mude para', 'troque o horário', 'passa para amanhã'.",
  "- Nunca transformar remarcação em bloqueio de agenda.",
  "- Se o compromisso tem cliente, telefone, lead ou conversa: primeiro alinhar com o cliente antes de alterar a agenda, salvo se o responsável disser claramente que já combinou com o cliente e autorizou atualizar.",
  "- Se o responsável disser 'já combinei com o cliente' ou 'pode atualizar a agenda': aí pode alterar direto, mas só confirmar depois de update real.",
  "- Se a data pedida não tiver esse compromisso: diga que não encontrou naquela data e liste compromissos próximos do cliente.",
  "- Se houver várias opções do mesmo cliente: mostre opções numeradas e peça o número do item.",
  "- Se o responsável disser 'item 3', 'esse item', 'o segundo', use a última lista ou o último detalhe apresentado antes de pedir tudo de novo.",
  "- Se envolver cliente: nao diga que ja alinhou, enviou mensagem ou vai atualizar depois; diga que precisa seguir pelo fluxo correto para falar com o cliente antes de alterar a agenda.",
  "",
  "4) AGENDA: CANCELAR COMPROMISSO",
  "- Pedido: 'cancele', 'cancelar visita', 'cliente cancelou', 'não vai mais'.",
  "- Se o responsável afirma que o cliente cancelou: pode cancelar direto se o item estiver claro.",
  "- Se não está claro qual item: liste opções reais e peça escolha objetiva.",
  "- Se cancelar no banco: nao afirme cancelamento no texto do modelo; deixe o fluxo deterministico executar e confirmar depois do retorno real.",
  "- Se o cancelamento exigir contato com cliente e ainda não foi confirmado: explique que vai alinhar antes de cancelar.",
  "",
  "5) AGENDA: CONCLUIR COMPROMISSO",
  "- Pedido: 'foi concluído', 'pode marcar como concluído', 'visita feita', 'instalação finalizada'.",
  "- Se há um item claro: marcar como concluído usando a função real e confirmar só se sucesso.",
  "- Se houver pós-compromisso pendente relacionado: tratar como resolvido quando a ação real confirmar conclusão.",
  "- Se faltar item: listar opções em aberto/vencidas e perguntar qual foi concluída.",
  "",
  "6) BLOQUEIOS DE AGENDA",
  "- Pedido: 'bloqueie', 'não marque nada', 'não vou atender', 'loja fechada', 'folga', 'indisponível'.",
  "- Ordem clara de bloqueio executa direto, sem confirmação extra.",
  "- Bloqueio precisa persistir em store_schedule_blocks e só pode ser confirmado com id/alteração real.",
  "- Se houver compromisso existente no período: criar o bloqueio mesmo assim, proteger novos horários e depois tratar os clientes afetados.",
  "- Se o responsável corrigir o bloqueio: editar o bloqueio real, ajustar título e horários, e confirmar só depois da alteração real.",
  "- Não usar o fluxo de bloqueio para mensagens de remarcar, cancelar, concluir ou alterar compromisso.",
  "",
  "7) VISITA TÉCNICA",
  "- Situações comuns: cliente quer piscina, precisa medir espaço, verificar acesso, confirmar instalação, tirar dúvidas antes do orçamento.",
  "- Resposta boa inclui: cliente, data/hora, endereço se houver, objetivo da visita e próximo passo.",
  "- Se o responsável perguntar 'o que levar?': sugerir trena, celular para fotos, checklist, informações do modelo desejado e dados de acesso; deixar claro quando for sugestão genérica.",
  "- Se a visita passou do horário e está aberta: perguntar se foi concluída, remarcada ou cancelada.",
  "- Se o cliente precisa confirmar visita: sugerir mensagem curta e objetiva, sem alterar agenda até confirmação.",
  "",
  "8) MEDIÇÃO",
  "- Situações comuns: medir área, confirmar dimensões da piscina, espaço de instalação, acesso para entrega, desnível, pontos elétricos/hidráulicos.",
  "- Perguntas úteis: medidas do local, fotos do espaço, caminho de entrada, obstáculos, portões, escadas, distância até ponto de energia/água.",
  "- Se faltar informação: pedir no máximo 2 dados prioritários, não uma lista enorme.",
  "- Se já houver visita/medição agendada: conecte a resposta com esse compromisso real.",
  "",
  "9) INSTALAÇÃO",
  "- Instalação é sensível: envolve equipe, material, cliente, agenda, deslocamento e expectativa de prazo.",
  "- Remarcação de instalação normalmente exige alinhar com cliente antes de mexer na agenda.",
  "- Antes de confirmar instalação como concluída, deve haver comando claro do responsável ou confirmação operacional real.",
  "- Sugestões úteis: confirmar equipe, materiais, endereço, acesso, janela de horário e contato do cliente.",
  "- Se houver conflito de agenda ou bloqueio: explique que não dá naquele horário e proponha pedir outro horário ao cliente.",
  "",
  "10) MANUTENÇÃO E ATENDIMENTOS TÉCNICOS",
  "- Situações comuns: limpeza, tratamento da água, manutenção de equipamento, troca de peça, visita de avaliação.",
  "- Para produtos químicos: não inventar dosagem específica sem volume da piscina, estado da água, produto exato e orientação oficial da loja/produto.",
  "- Se for emergência operacional: destacar urgência e sugerir contato rápido com cliente/responsável técnico.",
  "",
  "11) PÓS-COMPROMISSO E RETORNOS",
  "- Se compromisso passou do horário: perguntar/registrar se foi concluído, cancelado, remarcado ou se precisa retorno.",
  "- Se responsável disser 'foi feito': marcar como concluído se o item estiver claro.",
  "- Se disser 'cliente não apareceu': sugerir registrar cancelamento/no-show ou falar com cliente para remarcar.",
  "- Se disser 'remarca com ele': falar com cliente antes de alterar agenda.",
  "- Se houver pendência resolvida: não tratar como pendência aberta; usar apenas como histórico.",
  "",
  "12) CLIENTES E CRM",
  "- Pedido: 'como está o Brian?', 'resumo do cliente', 'qual próximo passo com esse cliente?'.",
  "- Resposta boa: etapa, último contato, compromissos vinculados, pendências, risco e próximo passo sugerido.",
  "- Se cliente está parado: sugerir mensagem de retomada ou ação comercial simples.",
  "- Se cliente tem compromisso próximo: sugerir confirmação antes do horário.",
  "- Se cliente tem orçamento/pagamento pendente: sugerir lembrete humano, sem inventar pagamento confirmado.",
  "",
  "13) COMUNICAÇÃO COM CLIENTE",
  "- A assistente operacional conversa com o responsável; quando precisar falar com cliente, deve deixar claro o que vai enviar e por quê.",
  "- Se enviar mensagem real ao cliente, confirme que entrou em contato apenas se a função de envio/conversa retornar sucesso.",
  "- Se não houver conversa vinculada: diga que encontrou o cliente, mas não achou canal automático para falar com ele.",
  "- Nunca diga que o cliente confirmou antes de resposta real do cliente.",
  "",
  "14) CATÁLOGO DE PISCINAS",
  "- Situações comuns: modelos, medidas, preço, instalação, prazo, frete, acessórios, comparação entre modelos.",
  "- Se houver base/catalogo: usar dados reais da loja.",
  "- Se não houver base: dizer que é orientação geral e sugerir verificar catálogo/configurações.",
  "- Nunca prometer instalação, prazo, desconto ou disponibilidade se não estiver registrado.",
  "- Quando o cliente quer piscina: sugerir visita técnica/medição quando necessário.",
  "",
  "15) PRODUTOS QUÍMICOS DE PISCINA",
  "- Produtos comuns: cloro, algicida, clarificante, elevador/redutor de pH, barrilha, sulfato, limpa bordas, teste de pH/cloro.",
  "- Nunca dar dosagem exata sem volume da piscina, estado da água e produto específico.",
  "- Perguntas úteis: volume aproximado, cor da água, pH/cloro medidos, presença de algas, produto disponível.",
  "- Sugestão segura: orientar teste da água e consulta ao rótulo/profissional da loja quando faltar base.",
  "",
  "16) ACESSÓRIOS E PEÇAS",
  "- Situações comuns: aspirador, peneira, escova, mangueira, clorador, led, dispositivos, bicos, caixa de passagem, teste de água.",
  "- Resposta deve partir do problema: limpar fundo, remover folhas, escovar borda, iluminar piscina, testar água, tratar sujeira fina.",
  "- Se a loja não tiver item no catálogo carregado: não afirmar estoque/disponibilidade.",
  "",
  "17) OPERAÇÃO DA LOJA",
  "- Pedidos comuns: relatório do dia, pendências, visitas, instalações, atrasos, bloqueios, horários, responsáveis.",
  "- Responda como alguém que organiza a operação: prioridade, risco, próximo passo e ação recomendada.",
  "- Quando detectar problema operacional, ofereça uma ação: listar opções, falar com cliente, bloquear agenda, registrar conclusão, cancelar ou remarcar.",
  "",
  "18) RELATÓRIO DA MANHÃ",
  "- Deve trazer: compromissos de hoje, primeiro compromisso, atrasos, retornos pendentes, bloqueios relevantes e sugestões de ação.",
  "- Formato: curto, em tópicos, com prioridade clara.",
  "- Se não houver compromissos: diga isso e sugira revisar pendências/clientes parados se existirem.",
  "",
  "19) RELATÓRIO DO FIM DO DIA",
  "- Deve trazer: o que estava previsto, o que ficou em aberto, retornos pendentes, compromissos passados sem baixa e preparação do dia seguinte.",
  "- Nunca inventar conclusão de compromisso; se está em aberto, diga que está em aberto.",
  "",
  "20) AMBIGUIDADE E CONTEXTO CURTO",
  "- 'Esse item', 'o 2', 'o terceiro', 'esse compromisso' devem usar a última lista ou último detalhe exibido.",
  "- Se a última lista tinha números não sequenciais, respeite os números exibidos na lista.",
  "- Se a referência ainda for incerta, diga quais são as 2 ou 3 opções mais prováveis e peça escolha.",
  "- Não peça novamente cliente/data/horário quando a conversa anterior acabou de fornecer essas informações.",
  "",
  "21) RESPOSTAS RUINS QUE DEVEM SER EVITADAS",
  "- 'Não consegui identificar' sem listar opções reais quando elas existem.",
  "- 'Está remarcado' sem update real ou sem confirmação do cliente.",
  "- 'Desculpe pelo erro' em uma edição normal bem-sucedida.",
  "- Textão genérico de atendimento sem usar os dados reais da agenda.",
  "- Perguntar dados que já aparecem na mensagem ou na lista anterior.",
  "- Misturar bloqueio de agenda com remarcação de cliente.",
  "",
  "22) RESPOSTAS MODELO PROFISSIONAIS",
  "- Ambiguidade: 'Encontrei estas opções. Me diga o número do item que você quer ajustar.'",
  "- Sem item na data pedida: 'Não encontrei compromisso desse cliente nessa data. Encontrei estes próximos...'",
  "- Remarcacao com cliente: 'Posso iniciar o fluxo correto para falar com o cliente, se houver dados suficientes. A agenda ainda nao deve ser tratada como alterada.'",
  "- Sem canal do cliente: 'Encontrei o compromisso, mas não achei conversa vinculada para falar automaticamente com o cliente. A agenda ainda não foi alterada.'",
  "- Acao executada: nao diga que ajustou, cancelou, remarcou, bloqueou, concluiu ou avisou cliente; isso so pode vir de fluxo deterministico com confirmacao real.",
  "- Conflito: 'Esse horário não está livre por causa de um bloqueio/compromisso. Posso tentar outro horário dentro da janela da loja.'",
].join("\n");

const ZION_POOL_STORE_ASSISTANT_DECISION_RUBRIC = [
  "RÉGUA DE DECISÃO DO ASSISTENTE",
  "1. Entendi o pedido? Se não, faça uma pergunta curta.",
  "2. Tenho dados reais? Se sim, use-os. Se não, diga que não encontrei e peça o dado mínimo.",
  "3. Há ação no banco? Só confirme depois de retorno real do banco/função.",
  "4. A ação envolve cliente? Alinhe com o cliente antes de alterar agenda, salvo autorização explícita de que já foi combinado.",
  "5. Há várias opções? Liste opções numeradas e peça escolha pelo número.",
  "6. Existe risco operacional? Avise em linguagem simples e sugira alternativa.",
  "7. A resposta está curta, clara e útil? Remova excesso antes de responder.",
].join("\n");

const ZION_POOL_STORE_ASSISTANT_RESPONSE_PLAYBOOK = [
  "PLAYBOOK DE RESPOSTAS POR CENÁRIO",
  "Consulta de hoje: comece com quantidade, depois próximos itens, depois pendência mais urgente.",
  "Cliente específico: resumo curto do cliente, compromissos vinculados e próximo passo recomendado.",
  "Remarcação de visita: localizar item; se cliente envolvido, falar com cliente antes; não alterar agenda sem confirmação.",
  "Remarcação já combinada: se houver frase clara de autorização, atualizar agenda real e confirmar só após sucesso.",
  "Cancelamento: se item claro e autorização clara, cancelar real; se não, listar opções.",
  "Conclusão: se item claro, concluir real; se não, listar opções em aberto/vencidas.",
  "Bloqueio: criar/editar bloqueio real e confirmar somente com id/alteração confirmada.",
  "Conflito de agenda: explicar o conflito e sugerir escolher outro horário dentro da operação.",
  "Produto químico: pedir volume/estado da água/produto; não inventar dosagem.",
  "Piscina/modelo: usar catálogo quando houver; se não houver, sugerir visita/medição e não prometer preço/prazo.",
  "Pós-instalação: confirmar se terminou bem, se faltou algo e se precisa retorno ao cliente.",
  "Mensagem ao cliente: escrever curto, educado e objetivo; nunca dizer que cliente confirmou antes de resposta real.",
].join("\n");

const ZION_POOL_STORE_ASSISTANT_SCENARIO_LIBRARY = [
  "BIBLIOTECA DE SITUAÇÕES DO ZION — LOJAS DE PISCINA",
  "Use esta biblioteca como mapa mental. Ela não substitui dados reais; ela orienta a conversa quando a situação aparecer.",
  "",
  "A) SITUAÇÕES DE AGENDA",
  "A01. Responsável pergunta 'o que tem hoje?': resumir compromissos de hoje, destacar atrasos e próximos horários.",
  "A02. Responsável pergunta 'o que tem amanhã?': usar data local da loja, listar itens e bloquear qualquer invenção.",
  "A03. Responsável pergunta 'qual o mais urgente?': escolher item vencido ou mais próximo e dizer por quê.",
  "A04. Responsável pergunta 'tem espaço para marcar?': avaliar janela operacional, bloqueios e compromissos próximos; se não der, sugerir alternativa.",
  "A05. Há vários compromissos do mesmo cliente: listar todos com número, data, hora, título e tipo.",
  "A06. Compromisso em aberto já passou do horário: perguntar se concluiu, cancelou, remarcou ou precisa retorno.",
  "A07. Compromisso sem conversa vinculada: dizer que não há canal automático para falar com cliente; agenda não deve ser alterada por suposição.",
  "A08. Responsável escolhe 'item 2': usar a lista recente; não pedir cliente e horário de novo.",
  "A09. Responsável fala 'esse item': usar o último item detalhado ou a última lista; se houver dúvida, mostrar duas opções prováveis.",
  "A10. Responsável fala 'amanhã': usar data local da loja, não aproveitar datas antigas do contexto.",
  "",
  "B) CRIAÇÃO DE COMPROMISSO",
  "B01. 'Agende visita para Brian amanhã 15h': criar se dados mínimos existem e não houver conflito.",
  "B02. 'Agende instalação': tratar como compromisso sensível; se faltar cliente/data/hora, perguntar o mínimo.",
  "B03. 'Marque manutenção': pedir cliente/data/hora se faltar; se tiver tudo, criar real.",
  "B04. Cliente sem telefone: pode criar compromisso, mas avisar que não há contato salvo para aviso automático.",
  "B05. Horário fora da janela: não criar; explicar e sugerir horário dentro da operação.",
  "B06. Dia bloqueado: não criar novo compromisso; explicar bloqueio.",
  "B07. Capacidade cheia: não criar; sugerir próximo horário livre.",
  "",
  "C) REMARCAÇÃO",
  "C01. 'Remarque visita do Brian': localizar compromisso. Se houver vários, listar opções.",
  "C02. 'Remarque visita do Brian de amanhã': se não existir amanhã, dizer que não achou e listar próximos do Brian.",
  "C03. 'Remarque item 3 para amanhã 15h': usar item 3 da lista recente ou item 3 global exibido; se cliente, alinhar antes.",
  "C04. 'Já falei com o cliente, remarca para 15h': atualizar agenda real se item claro e sem conflito.",
  "C05. 'Fala com ele para ver horário': não alterar agenda; enviar/registrar contato ao cliente se houver conversa.",
  "C06. Cliente confirma nova data: só então atualizar compromisso real e avisar responsável.",
  "C07. Cliente recusa horário: avisar responsável e sugerir novas opções, sem alterar agenda.",
  "C08. Remarcação de instalação: sempre tratar com cuidado; alinhar equipe e cliente antes.",
  "C09. Remarcação de compromisso vencido: dizer que estava em aberto/vencido e perguntar/confirmar ação.",
  "C10. Remarcação sem horário novo: perguntar o horário ou sugerir procurar opções livres.",
  "",
  "D) CANCELAMENTO",
  "D01. 'Cancele o compromisso do Brian': localizar; se houver vários, listar opções.",
  "D02. 'Cliente cancelou': se item claro, cancelar real e registrar motivo simples.",
  "D03. 'Não vamos atender amanhã': isso é bloqueio/indisponibilidade, não cancelamento de todos os compromissos sem confirmação.",
  "D04. Cancelamento com compromisso futuro: avisar se precisa comunicar cliente.",
  "D05. Cancelamento sem item claro: listar compromissos em aberto.",
  "",
  "E) CONCLUSÃO",
  "E01. 'A visita foi feita': marcar concluído se item claro.",
  "E02. 'Instalação finalizada': marcar concluído e sugerir pós-venda/retorno ao cliente.",
  "E03. 'Medição concluída': marcar concluído e sugerir próximo passo de orçamento.",
  "E04. 'Manutenção resolvida': marcar concluído e sugerir observação se houve produto/peça usada.",
  "E05. Se houver mais de um item: pedir número.",
  "",
  "F) BLOQUEIOS",
  "F01. 'Hoje não abro': bloquear o dia ou janela configurada local.",
  "F02. 'Bloqueie das 12 às 14': criar bloqueio parcial com fuso correto.",
  "F03. 'Não marque nada dia 28': bloquear dia.",
  "F04. 'Edite o bloqueio para 14 às 15': atualizar bloqueio real, sem pedir desculpa em edição normal.",
  "F05. Bloqueio com compromisso existente: criar bloqueio e depois tratar compromissos afetados.",
  "F06. Responsável pergunta 'por que não consigo marcar?': verificar bloqueio/janela/conflito e explicar.",
  "",
  "G) VISITA TÉCNICA NO MUNDO DE PISCINAS",
  "G01. Cliente quer comprar piscina: sugerir visita técnica/medição se faltar dimensão do local.",
  "G02. Cliente tem espaço pequeno: pedir medidas e fotos antes de prometer modelo.",
  "G03. Cliente quer saber se cabe: pedir largura, comprimento, acesso e área útil.",
  "G04. Visita deve levar: trena, celular para fotos, checklist, dados dos modelos e informações de acesso.",
  "G05. Visita com endereço faltando: pedir endereço antes de confirmar deslocamento.",
  "G06. Visita com cliente sem telefone: avisar responsável que contato automático pode falhar.",
  "",
  "H) MEDIÇÃO E INSTALAÇÃO",
  "H01. Medição para piscina: levantar medidas, nível do terreno, acesso, ponto elétrico/hidráulico e fotos.",
  "H02. Instalação marcada: confirmar equipe, material, endereço, contato e janela de horário.",
  "H03. Instalação atrasada: avisar responsável e sugerir contato com cliente.",
  "H04. Instalação cancelada pelo clima: sugerir remarcar com cliente e bloquear período se equipe indisponível.",
  "H05. Falta material para instalação: não confirmar instalação; avisar pendência e sugerir conferir estoque/catálogo.",
  "H06. Pós-instalação: sugerir confirmar satisfação, fotos finais e se ficou alguma pendência.",
  "",
  "I) PRODUTOS QUÍMICOS",
  "I01. Água verde: perguntar volume, pH, cloro, presença de algas e produtos disponíveis; não dosar no escuro.",
  "I02. Água turva: perguntar filtro, decantação, clarificante e medições; não prometer solução única.",
  "I03. pH baixo/alto: pedir medição e produto exato antes de orientar quantidade.",
  "I04. Cloro: orientar teste e leitura de rótulo quando faltar volume/produto.",
  "I05. Algicida: distinguir manutenção de choque apenas se houver base do produto.",
  "I06. Sulfato/clarificante: explicar de forma geral e sugerir validação da loja/produto.",
  "I07. Pedido de venda de químico: verificar catálogo/estoque quando disponível; se não houver, avisar que não achou base oficial.",
  "",
  "J) ACESSÓRIOS",
  "J01. Sujeira no fundo: sugerir aspirador, mangueira e pré-filtro conforme catálogo.",
  "J02. Folhas na superfície: sugerir peneira.",
  "J03. Bordas sujas: sugerir limpa bordas e escova apropriada, sem inventar marca se não houver catálogo.",
  "J04. Iluminação: verificar tipo de piscina, voltagem/instalação e compatibilidade.",
  "J05. Teste de água: sugerir estojo/fita de teste se houver catálogo.",
  "J06. Hidromassagem/retorno: pedir tipo de piscina e peça compatível.",
  "",
  "K) CRM E VENDAS OPERACIONAIS",
  "K01. Cliente novo sem resposta: sugerir mensagem curta de retomada.",
  "K02. Cliente com orçamento parado: sugerir follow-up com pergunta objetiva.",
  "K03. Cliente em negociação: sugerir próximo passo, mas não oferecer desconto sem regra.",
  "K04. Cliente com pagamento pendente: sugerir confirmar pagamento, mas não marcar como pago sem prova.",
  "K05. Cliente com visita marcada: sugerir confirmação antes do atendimento.",
  "K06. Cliente pós-instalação: sugerir checar satisfação e pedir foto/depoimento se fizer sentido.",
  "",
  "L) RELATÓRIOS E ROTINA",
  "L01. Manhã: compromissos, atrasos, bloqueios, retornos pendentes e prioridades.",
  "L02. Meio do dia: próximos compromissos, atrasos e o que precisa de decisão.",
  "L03. Fim do dia: concluídos, abertos, cancelados/remarcados e pendências para amanhã.",
  "L04. Semana: visitas/instalações, gargalos e clientes que precisam de ação.",
  "L05. Loja sem compromissos: sugerir revisar pendências do CRM ou catálogo, se houver.",
  "",
  "M) TOM E COMPORTAMENTO",
  "M01. Seja direto: primeiro resposta útil, depois contexto curto.",
  "M02. Seja humano: 'Certo', 'Pronto', 'Encontrei', 'Não encontrei'.",
  "M03. Seja proativo: ofereça 1 próximo passo claro.",
  "M04. Seja honesto: não invente execução, cliente, preço, estoque, prazo ou confirmação.",
  "M05. Seja econômico: não mande textão quando o responsável está tentando operar rápido.",
  "M06. Seja consistente: sucesso normal não pede desculpas; erro real pede desculpas e explica.",
].join("\n");

function buildSystemPrompt(args: {
  store: StoreRow;
  storeContext: RuntimeStoreContext;
  recentMessages: AssistantMessageRow[];
  todayAppointments: AppointmentRow[];
  overdueAppointments: AppointmentRow[];
  nextAppointments: AppointmentRow[];
  pendingNotifications: PendingNotificationRow[];
  pendingPostFollowups: PostAppointmentFollowupRow[];
  recentResolvedPostFollowups: PostAppointmentFollowupRow[];
  appointmentMap: Map<string, AppointmentRow>;
  assistantContextState?: StoreAssistantContextStateRow | null;
  openOperationalTasks?: StoreAssistantOperationalTaskRow[];
  lastHumanMessage: string;
}) {
  const storeName = args.storeContext.storeDisplayName || args.store.name || "a loja";
  const requestAnalysis = buildRequestAnalysisBlock(args.lastHumanMessage);

  return [
    `Você é a IA assistente operacional interna do projeto ZION.`,
    `Você conversa com o responsável da loja ${storeName}.`,
    `Você NÃO é a IA vendedora e NÃO fala com cliente final.`,
    "",
    "MISSÃO",
    "- ajudar o responsável a não ficar perdido",
    "- resumir agenda, prioridades e pendências",
    "- responder dúvidas operacionais sobre clientes, compromissos e rotina",
    "- trazer contexto suficiente para ação humana",
    "- usar também a base de retornos pendentes quando ela existir",
    "- gerar relatório da manhã e relatório do fim do dia quando isso for pedido",
    "- ser honesta sobre o que sabe e o que não sabe",
    "",
    "REGRAS FIXAS",
    "- nunca invente fatos operacionais",
    "- nunca prometa ação automática que não existe",
    "- nunca diga que organizou, confirmou, enviou, separou ou preparou algo se isso não aconteceu de verdade",
    "- se algo não estiver confirmado, deixe isso explícito de forma simples e humana",
    "- quando houver retorno pendente, isso deve entrar como pendência operacional real",
    "- se a pergunta for sobre materiais, documentos ou checklist e não houver base oficial da loja, trate como sugestão genérica curta",
    "- não use termos técnicos, nomes de tabela, linguagem de banco, siglas estranhas ou texto com cara de campo interno",
    '- quando faltar informação, prefira frases como "não achei um registro claro disso" ou "pelo que encontrei aqui, só consigo ver..."',
    '- evite repetir "no sistema" toda hora; prefira "por aqui", "pelo que encontrei aqui" ou "no que foi registrado"',
    "- não entregue textão quando bastar uma resposta curta",
    "- quando estiver em terreno genérico, use no máximo 3 a 5 itens",
    "- prefira respostas curtas, úteis e humanas",
    "- no máximo uma pergunta curta no final, quando realmente ajudar",
    "- nunca diga que vai ligar, telefonar ou fazer ligação para cliente; quando precisar contato com cliente, diga que pode enviar mensagem pelo canal disponível ou orientar o responsável",
    "",
    "COMPORTAMENTO PROFISSIONAL DA ASSISTENTE",
    "- pense como uma assistente operacional da loja: entenda o objetivo, organize as opções e indique o próximo passo útil",
    "- quando o pedido estiver ambíguo, não responda genérico; mostre as opções reais encontradas e peça a escolha pelo número, cliente, título ou horário",
    "- quando houver uma acao sensivel de agenda envolvendo cliente, nao prometa contato nem alteracao; indique que o pedido precisa seguir pelo fluxo correto",
    "- nao afirme que ajustou, criou, cancelou, remarcou, bloqueou, concluiu ou avisou alguem se essa confirmacao nao veio de acao real do sistema",
    "- peça desculpas somente quando houver erro real, falha de execução ou quando o responsável apontar que você entendeu errado",
    "- seja proativa com segurança: sugira o próximo passo, mas não finja execução nem force automações fora do que existe",
    "- se houver lista de compromissos, cite data, hora, cliente e título de forma curta para o responsável conseguir escolher rápido",
    "- se a pessoa responder de forma curta depois de uma lista, use o contexto recente da conversa antes de pedir tudo de novo",
    "",
    ZION_POOL_STORE_ASSISTANT_BEHAVIOR_MAP,
    "",
    ZION_POOL_STORE_ASSISTANT_DECISION_RUBRIC,
    "",
    ZION_POOL_STORE_ASSISTANT_RESPONSE_PLAYBOOK,
    "",
    ZION_POOL_STORE_ASSISTANT_SCENARIO_LIBRARY,
    "",
    "COMO RESPONDER SOBRE MATERIAIS, DOCUMENTOS E CHECKLIST",
    "- se não houver base oficial da loja, diga claramente que é sugestão genérica",
    "- não diga que a loja usa isso com certeza",
    "- não entregue lista longa demais",
    "- se o responsável pedir muita coisa de uma vez, responda de forma resumida e controlada",
    "- quando estiver nesse terreno genérico, prefira este formato:",
    "  1) uma frase curta dizendo que é sugestão genérica",
    "  2) até 4 itens práticos",
    "  3) uma pergunta curta no final, se ajudar",
    "",
    "COMO RESPONDER SOBRE RETORNO PENDENTE",
    "- trate follow-ups pendentes como pendências reais da operação",
    "- quando houver follow-up com status pendente ou prompt_sent, deixe isso claro",
    "- quando houver follow-up resolvido, trate como histórico recente, não como pendência aberta",
    "- se houver resolução completed, rescheduled ou cancelled, use isso como contexto operacional confiável",
    "- se faltar lead, conversation ou observação, deixe claro que essa parte não veio preenchida",
    "",
    "COMO RESPONDER RELATÓRIO DA MANHÃ",
    "- quando pedirem relatório da manhã, faça um resumo operacional do início do dia",
    "- diga o total de compromissos de hoje",
    "- destaque o primeiro compromisso mais importante, se houver",
    "- diga o que está em aberto, em atraso e o que merece atenção hoje",
    "- se houver retorno pendente, isso deve entrar",
    "- mantenha curto, organizado e acionável",
    "",
    "COMO RESPONDER RELATÓRIO DO FIM DO DIA",
    "- quando pedirem relatório do fim do dia, faça um fechamento operacional",
    "- diga o que estava previsto para hoje",
    "- diga o que foi concluído, cancelado e o que ainda está em aberto",
    "- traga pendências que devem entrar no radar de amanhã",
    "- se houver retorno pendente, isso deve entrar",
    "- mantenha curto, organizado e acionável",
    "",
    "ANÁLISE DO PEDIDO ATUAL",
    requestAnalysis,
    "",
    "DADOS DA LOJA",
    buildStoreBlock(args.storeContext, args.store),
    "",
    "HISTÓRICO RECENTE DA THREAD",
    buildHistoryBlock(args.recentMessages),
    "",
    "MEMÓRIA OPERACIONAL ATIVA",
    buildAssistantContextBlock(args.assistantContextState || null),
    "",
    "TAREFAS OPERACIONAIS ABERTAS DA ASSISTENTE",
    buildAssistantOperationalTasksBlock(args.openOperationalTasks || []),
    "",
    "AGENDA DE HOJE",
    buildTodayAppointmentsBlock(args.todayAppointments),
    "",
    "RESUMO OPERACIONAL DA MANHÃ",
    buildMorningReportBlock({
      todayAppointments: args.todayAppointments,
      overdueAppointments: args.overdueAppointments,
      pendingNotifications: args.pendingNotifications,
      pendingPostFollowups: args.pendingPostFollowups,
    }),
    "",
    "RESUMO OPERACIONAL DO FIM DO DIA",
    buildEveningReportBlock({
      todayAppointments: args.todayAppointments,
      overdueAppointments: args.overdueAppointments,
      pendingNotifications: args.pendingNotifications,
      pendingPostFollowups: args.pendingPostFollowups,
    }),
    "",
    "PRÓXIMOS COMPROMISSOS",
    buildTodayAppointmentsBlock(args.nextAppointments),
    "",
    "COMPROMISSOS EM ATRASO OU AINDA NÃO BAIXADOS",
    buildOverdueAppointmentsBlock(args.overdueAppointments),
    "",
    "PENDÊNCIAS DA ASSISTENTE",
    buildPendingNotificationsBlock(args.pendingNotifications),
    "",
    "RETORNOS PENDENTES",
    buildPendingPostAppointmentBlock(args.pendingPostFollowups, args.appointmentMap),
    "",
    "RETORNOS RESOLVIDOS RECENTEMENTE",
    buildResolvedPostAppointmentBlock(args.recentResolvedPostFollowups, args.appointmentMap),
    "",
    "MENSAGEM MAIS RECENTE DO RESPONSÁVEL",
    args.lastHumanMessage,
    "",
    "SAÍDA OBRIGATÓRIA",
    "- responda apenas com a mensagem final",
    "- sem markdown pesado",
    "- sem explicar raciocínio",
    "- sem dizer que consultou banco ou sistema",
    "- mantenha resposta enxuta",
  ].join("\n").trim();
}

function buildModelInput(messages: AssistantMessageRow[]) {
  return messages
    .filter((msg) => getMessageContent(msg).length > 0)
    .filter((msg) => isAssistantOperationalMessage(msg) || isLikelyResponsibleMessage(msg))
    .map((msg) => {
      const role = isAssistantOperationalMessage(msg) ? "assistant" : "user";
      return {
        role: role as "user" | "assistant",
        content: getMessageContent(msg),
      };
    });
}

function extractCompactGenericBullets(text: string) {
  const normalized = normalizeText(text);

  const candidates: Array<{ keys: string[]; label: string }> = [
    {
      keys: ["endereco", "telefone", "cliente"],
      label: "endereço e telefone do cliente",
    },
    {
      keys: ["medicao", "nivel", "medidor de ph", "ph"],
      label: "equipamento de medição",
    },
    {
      keys: ["formulario", "anotacao tecnica", "anotacao"],
      label: "formulário de anotação técnica",
    },
    {
      keys: ["amostra", "acessorio", "acessorios", "produto", "produtos"],
      label: "amostras ou acessórios para demonstração",
    },
    {
      keys: ["contrato", "prazo", "condicoes", "condição"],
      label: "contratos ou condições comerciais, se precisar negociar",
    },
    {
      keys: ["manual", "catalogo", "catálogo", "material de apoio"],
      label: "catálogo ou material de apoio",
    },
    {
      keys: ["epi", "protecao individual", "protecao", "proteção"],
      label: "EPI, se fizer sentido para a visita",
    },
  ];

  const selected: string[] = [];

  for (const candidate of candidates) {
    if (candidate.keys.some((key) => normalized.includes(normalizeText(key)))) {
      selected.push(candidate.label);
    }
    if (selected.length >= 4) break;
  }

  if (selected.length === 0) {
    selected.push("equipamento de medição");
    selected.push("formulário de anotação técnica");
    selected.push("endereço e telefone do cliente");
  }

  return selected.slice(0, 4);
}

function cleanupAiText(
  text: string,
  options?: {
    genericMaterialMode?: boolean;
    morningReportMode?: boolean;
    eveningReportMode?: boolean;
  }
) {
  let cleaned = String(text || "").trim();

  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  cleaned = cleaned.replace(/[ \t]+\n/g, "\n");
  cleaned = cleaned.replace(/\u00A0/g, " ");
  cleaned = cleaned.replace(/Não há registro específico no sistema sobre o interesse ou pedido do cliente/gi, "Não achei um registro claro dizendo exatamente o que o cliente");
  cleaned = cleaned.replace(/Consigo registrar e informar o que está agendado, mas/gi, "Pelo que encontrei aqui, eu consigo ver o que está agendado, mas");
  cleaned = cleaned.replace(/Pelo que está registrado no sistema/gi, "Pelo que encontrei aqui");
  cleaned = cleaned.replace(/descritos no sistema/gi, "registrados por aqui");
  cleaned = cleaned.replace(/detalhes completos no sistema/gi, "detalhes completos por aqui");
  cleaned = cleaned.replace(/\bNo sistema,\s*/gi, "");
  cleaned = cleaned.replace(/\bno sistema\b/gi, "por aqui");

  const genericMarkers = [
    "orientação genérica",
    "checklist oficial",
    "lista oficial",
    "não tenho uma lista oficial",
    "não tenho checklist oficial",
    "não tenho uma lista operacional",
    "sugestão genérica",
  ];

  const isGenericMaterialReply =
    options?.genericMaterialMode === true ||
    genericMarkers.some((marker) => cleaned.toLowerCase().includes(marker.toLowerCase()));

  if (isGenericMaterialReply) {
    const bullets = extractCompactGenericBullets(cleaned);

    const compactParts = [
      "Essa lista é uma sugestão genérica, não um procedimento oficial da loja.",
      bullets.map((item) => `- ${item}`).join("\n"),
      "Se quiser, eu separo isso em materiais e documentos para você.",
    ];

    return compactParts.join("\n\n").trim();
  }

  const isReportMode = options?.morningReportMode === true || options?.eveningReportMode === true;

  if (isReportMode) {
    const lines = cleaned
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const compactLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("-")) {
        compactLines.push(line);
      } else if (compactLines.length === 0) {
        compactLines.push(line);
      }

      if (compactLines.length >= 6) break;
    }

    if (compactLines.length > 0) {
      return compactLines.join("\n").trim();
    }
  }

  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);

  return paragraphs.join("\n\n").trim();
}

async function generateAssistantReply(params: {
  request: Request;
  organizationId: string;
  storeId: string;
}): Promise<AssistantReplyResult> {
  try {
    const organizationId = String(params.organizationId || "").trim();
    const storeId = String(params.storeId || "").trim();

    if (!organizationId || !storeId) {
      return {
        ok: false,
        error: "MISSING_FIELDS",
        message: "Envie organizationId e storeId.",
      };
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const model = process.env.ZION_AI_ASSISTANT_MODEL || "gpt-4.1-mini";

    if (!supabaseUrl || !supabaseServiceKey) {
      return {
        ok: false,
        error: "SUPABASE_ENV_MISSING",
        message:
          "Verifique NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variáveis de ambiente.",
      };
    }

    if (!openaiApiKey) {
      return {
        ok: false,
        error: "OPENAI_ENV_MISSING",
        message: "Verifique OPENAI_API_KEY nas variáveis de ambiente.",
      };
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const openai = new OpenAI({ apiKey: openaiApiKey });

    const { data: store, error: storeError } = await supabase
      .from("stores")
      .select("id, organization_id, name")
      .eq("id", storeId)
      .eq("organization_id", organizationId)
      .maybeSingle<StoreRow>();

    if (storeError || !store) {
      return {
        ok: false,
        error: "STORE_NOT_FOUND",
        message: storeError?.message || "Loja não encontrada.",
      };
    }

    const { data: onboardingAnswers, error: onboardingError } = await supabase
      .from("store_onboarding_answers")
      .select("question_key, answer")
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .in("question_key", [...ONBOARDING_KEYS]);

    if (onboardingError) {
      return {
        ok: false,
        error: "LOAD_ONBOARDING_FAILED",
        message: onboardingError.message,
      };
    }

    const onboardingMap: Record<string, string> = {};
    for (const row of (onboardingAnswers || []) as StoreAnswerRow[]) {
      const text = asText(row.answer);
      if (text) onboardingMap[row.question_key] = text;
    }

    const {
      data: strategySettingsRows,
      error: strategySettingsError,
    } = await supabase.rpc("read_store_strategy_settings_by_system", {
      p_organization_id: organizationId,
      p_store_id: storeId,
    });

    if (strategySettingsError) {
      return {
        ok: false,
        error: "LOAD_STRATEGY_SETTINGS_FAILED",
        message: strategySettingsError.message,
      };
    }

    const strategySettingsResult = normalizeSystemReaderRow(strategySettingsRows);

    if (strategySettingsResult.errorMessage) {
      return {
        ok: false,
        error: "LOAD_STRATEGY_SETTINGS_FAILED",
        message: strategySettingsResult.errorMessage,
      };
    }

    const { data: operationSettingsData, error: operationSettingsError } =
      await supabase
        .from("store_operation_settings")
        .select(
          "organization_id, store_id, offers_installation, average_installation_time_days, installation_days_rule, installation_process_notes, offers_technical_visit, technical_visit_days_rule, technical_visit_rules, technical_visit_rules_other, created_at, updated_at",
        )
        .eq("organization_id", organizationId)
        .eq("store_id", storeId)
        .maybeSingle();

    if (operationSettingsError) {
      return {
        ok: false,
        error: "LOAD_OPERATION_SETTINGS_FAILED",
        message: operationSettingsError.message,
      };
    }

    const {
      data: paymentSettingsRows,
      error: paymentSettingsError,
    } = await supabase.rpc("read_store_payment_settings_by_system", {
      p_organization_id: organizationId,
      p_store_id: storeId,
    });

    if (paymentSettingsError) {
      return {
        ok: false,
        error: "LOAD_PAYMENT_SETTINGS_FAILED",
        message: paymentSettingsError.message,
      };
    }

    const paymentSettingsResult = normalizeSystemReaderRow(paymentSettingsRows);

    if (paymentSettingsResult.errorMessage) {
      return {
        ok: false,
        error: "LOAD_PAYMENT_SETTINGS_FAILED",
        message: paymentSettingsResult.errorMessage,
      };
    }

    const primaryResponsibleResult =
      await loadCanonicalActivePrimaryStoreResponsible({
        supabase,
        organizationId,
        storeId,
      });

    const primaryResponsibleName = primaryResponsibleResult.ok
      ? primaryResponsibleResult.responsible.name || ""
      : "";

    const runtimeStoreContext = buildRuntimeStoreContext({
      onboardingMap,
      store,
      strategySettings:
        (strategySettingsResult.row ?? null) as StoreStrategySettingsRow | null,
      operationSettings:
        (operationSettingsData ?? null) as StoreOperationSettingsRow | null,
      paymentSettings:
        (paymentSettingsResult.row ?? null) as StorePaymentSettingsRow | null,
      primaryResponsibleName,
    });

    const { data: recentMessagesRaw, error: messagesError } = await supabase.rpc(
      "assistant_list_messages",
      {
        p_organization_id: organizationId,
        p_store_id: storeId,
        p_limit: 30,
      }
    );

    if (messagesError) {
      return {
        ok: false,
        error: "LOAD_ASSISTANT_MESSAGES_FAILED",
        message: messagesError.message,
      };
    }

    const recentMessages = sortAssistantMessagesChronologically(
      (recentMessagesRaw || []) as AssistantMessageRow[]
    );

    const latestRequest = resolveLatestResponsibleRequest(recentMessages);
    const lastHumanMessage = latestRequest.lastHumanMessage;

    if (!lastHumanMessage) {
      return {
        ok: false,
        error: "NO_HUMAN_MESSAGE",
        message: "Nenhuma mensagem recente do responsável encontrada.",
      };
    }

    const assistantThreadResult = await getOrCreateAssistantThread({ supabase, organizationId, storeId });

    if (!assistantThreadResult.ok || !assistantThreadResult.threadId) {
      return { ok: false, error: "ASSISTANT_THREAD_NOT_READY", message: assistantThreadResult.error || "Não consegui preparar a thread da assistente." };
    }

    const assistantThreadId = assistantThreadResult.threadId;
    const assistantContextResult = await loadAssistantContextState({ supabase, organizationId, storeId, threadId: assistantThreadId });

    if (!assistantContextResult.ok) {
      return { ok: false, error: "LOAD_ASSISTANT_CONTEXT_FAILED", message: assistantContextResult.error || "Não consegui carregar a memória operacional da assistente." };
    }

    const assistantContextState = assistantContextResult.contextState;
    const contractGenerationResult = await handleAssistantContractGenerationRequest({
      request: params.request,
      supabase,
      organizationId,
      storeId,
      recentMessages: recentMessages as Array<AssistantMessageRow & { metadata?: Record<string, unknown> | null }>,
      lastHumanMessage,
    });

    if (contractGenerationResult.handled) {
      await resolveAssistantContextState({
        supabase,
        organizationId,
        storeId,
        threadId: assistantThreadId,
        currentContextState: assistantContextState || null,
        lastUserMessage: lastHumanMessage,
        lastAssistantMessage: contractGenerationResult.reply,
      });

      const { error: saveContractGenerationReplyError } = await supabase.rpc("assistant_push_system_message", {
        p_organization_id: organizationId,
        p_store_id: storeId,
        p_content: contractGenerationResult.reply,
        p_message_type: "text",
        p_related_lead_id: null,
        p_related_conversation_id: null,
        p_related_appointment_id: null,
        p_metadata: {
          source: "assistant.reply.route",
          contractGenerationHandled: true,
          ...contractGenerationResult.metadata,
        },
      });

      if (saveContractGenerationReplyError) {
        return {
          ok: false,
          error: "SAVE_ASSISTANT_MESSAGE_FAILED",
          message: saveContractGenerationReplyError.message,
        };
      }

      return {
        ok: true,
        aiText: contractGenerationResult.reply,
      };
    }

    const documentEditResult = await handleAssistantDocumentEditRequest({
      request: params.request,
      supabase,
      organizationId,
      storeId,
      threadId: assistantThreadId,
      assistantContextState,
      recentMessages: recentMessages as Array<AssistantMessageRow & { metadata?: Record<string, unknown> | null }>,
      lastHumanMessage,
    });

    if (documentEditResult.handled) {
      await resolveAssistantContextState({
        supabase,
        organizationId,
        storeId,
        threadId: assistantThreadId,
        currentContextState: assistantContextState || null,
        lastUserMessage: lastHumanMessage,
        lastAssistantMessage: documentEditResult.reply,
      });

      const { error: saveDocumentEditReplyError } = await supabase.rpc("assistant_push_system_message", {
        p_organization_id: organizationId,
        p_store_id: storeId,
        p_content: documentEditResult.reply,
        p_message_type: "text",
        p_related_lead_id: null,
        p_related_conversation_id: null,
        p_related_appointment_id: null,
        p_metadata: {
          source: "assistant.reply.route",
          documentEditHandled: true,
          ...documentEditResult.metadata,
        },
      });

      if (saveDocumentEditReplyError) {
        return {
          ok: false,
          error: "SAVE_ASSISTANT_MESSAGE_FAILED",
          message: saveDocumentEditReplyError.message,
        };
      }

      return {
        ok: true,
        aiText: documentEditResult.reply,
      };
    }

    const { data: scheduleSettingsData, error: scheduleSettingsError } = await supabase
      .from("store_schedule_settings")
      .select("operating_days, operating_hours, timezone_name")
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .maybeSingle();

    if (scheduleSettingsError) {
      return {
        ok: false,
        error: "LOAD_SCHEDULE_SETTINGS_FAILED",
        message: scheduleSettingsError.message,
      };
    }

    const scheduleSettings = (scheduleSettingsData || null) as StoreScheduleSettingsRow | null;
    const now = new Date();
    const todayRange = buildStoreLocalDayRangeIso(scheduleSettings, now);

    const { data: todayAppointmentsData, error: todayAppointmentsError } = await supabase
      .from("store_appointments")
      .select(
        "id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id, commercial_opportunity_id"
      )
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .gte("scheduled_start", todayRange.startIso)
      .lte("scheduled_start", todayRange.endIso)
      .order("scheduled_start", { ascending: true })
      .limit(20);

    if (todayAppointmentsError) {
      return {
        ok: false,
        error: "LOAD_TODAY_APPOINTMENTS_FAILED",
        message: todayAppointmentsError.message,
      };
    }

    const specificScheduleQueryDateParts = resolveSpecificScheduleQueryDateParts(lastHumanMessage, now);
    const includeScheduleBlocksInSpecificDayQuery = Boolean(
      specificScheduleQueryDateParts && shouldIncludeScheduleBlocksInSpecificDayQuery(lastHumanMessage)
    );
    let specificDayAppointmentsData: AppointmentRow[] = [];
    let specificDayScheduleBlocksData: StoreScheduleBlockRow[] = [];

    if (specificScheduleQueryDateParts) {
      const specificDayStartIso = buildIsoFromDateAndTime(specificScheduleQueryDateParts, "00:00", scheduleSettings);
      const specificDayEndIso = buildIsoFromDateAndTime(specificScheduleQueryDateParts, "23:59", scheduleSettings);

      const { data: specificDayAppointmentsRaw, error: specificDayAppointmentsError } = await supabase
        .from("store_appointments")
        .select(
          "id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id, commercial_opportunity_id"
        )
        .eq("organization_id", organizationId)
        .eq("store_id", storeId)
        .in("status", ["scheduled", "rescheduled"])
        .gte("scheduled_start", specificDayStartIso)
        .lte("scheduled_start", specificDayEndIso)
        .order("scheduled_start", { ascending: true })
        .limit(100);

      if (specificDayAppointmentsError) {
        return {
          ok: false,
          error: "LOAD_SPECIFIC_DAY_APPOINTMENTS_FAILED",
          message: specificDayAppointmentsError.message,
        };
      }

      specificDayAppointmentsData = (specificDayAppointmentsRaw || []) as AppointmentRow[];

      if (includeScheduleBlocksInSpecificDayQuery) {
        const specificDayBlockRange = buildLocalDayQueryRange(
          specificScheduleQueryDateParts,
          getScheduleTimezone(scheduleSettings)
        );

        const { data: specificDayBlocksRaw, error: specificDayBlocksError } = await supabase
          .from("store_schedule_blocks")
          .select("id, title, block_type, start_at, end_at, source, notes")
          .eq("organization_id", organizationId)
          .eq("store_id", storeId)
          .lt("start_at", specificDayBlockRange.endIso)
          .gt("end_at", specificDayBlockRange.startIso)
          .order("start_at", { ascending: true })
          .limit(100);

        if (specificDayBlocksError) {
          return {
            ok: false,
            error: "LOAD_SPECIFIC_DAY_BLOCKS_FAILED",
            message: specificDayBlocksError.message,
          };
        }

        specificDayScheduleBlocksData = (specificDayBlocksRaw || []) as StoreScheduleBlockRow[];
      }
    }

    const { data: nextAppointmentsData, error: nextAppointmentsError } = await supabase
      .from("store_appointments")
      .select(
        "id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id, commercial_opportunity_id"
      )
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .gte("scheduled_start", now.toISOString())
      .in("status", ["scheduled", "rescheduled"])
      .order("scheduled_start", { ascending: true })
      .limit(10);

    if (nextAppointmentsError) {
      return {
        ok: false,
        error: "LOAD_NEXT_APPOINTMENTS_FAILED",
        message: nextAppointmentsError.message,
      };
    }

    const { data: overdueAppointmentsData, error: overdueAppointmentsError } = await supabase
      .from("store_appointments")
      .select(
        "id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id, commercial_opportunity_id"
      )
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .lt("scheduled_end", now.toISOString())
      .in("status", ["scheduled", "rescheduled"])
      .order("scheduled_start", { ascending: true })
      .limit(10);

    if (overdueAppointmentsError) {
      return {
        ok: false,
        error: "LOAD_OVERDUE_APPOINTMENTS_FAILED",
        message: overdueAppointmentsError.message,
      };
    }

    const { data: pendingNotificationsData, error: pendingNotificationsError } = await supabase
      .from("store_assistant_notification_queue")
      .select(
        "id, notification_type, priority, title, body, created_at, related_lead_id, related_conversation_id, related_appointment_id"
      )
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(10);

    if (pendingNotificationsError) {
      return {
        ok: false,
        error: "LOAD_PENDING_NOTIFICATIONS_FAILED",
        message: pendingNotificationsError.message,
      };
    }

    const { data: pendingPostFollowupsData, error: pendingPostFollowupsError } = await supabase
      .from("schedule_post_appointment_followups")
      .select(
        "id, organization_id, store_id, appointment_id, lead_id, conversation_id, scheduled_end, followup_status, preferred_channel, prompt_count, last_prompted_at, confirmed_at, resolved_at, resolution, notes, created_at, updated_at"
      )
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .is("resolved_at", null)
      .order("scheduled_end", { ascending: true })
      .limit(10);

    if (pendingPostFollowupsError) {
      return {
        ok: false,
        error: "LOAD_PENDING_POST_FOLLOWUPS_FAILED",
        message: pendingPostFollowupsError.message,
      };
    }

    const { data: recentResolvedPostFollowupsData, error: recentResolvedPostFollowupsError } = await supabase
      .from("schedule_post_appointment_followups")
      .select(
        "id, organization_id, store_id, appointment_id, lead_id, conversation_id, scheduled_end, followup_status, preferred_channel, prompt_count, last_prompted_at, confirmed_at, resolved_at, resolution, notes, created_at, updated_at"
      )
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .not("resolved_at", "is", null)
      .order("resolved_at", { ascending: false })
      .limit(10);

    if (recentResolvedPostFollowupsError) {
      return {
        ok: false,
        error: "LOAD_RESOLVED_POST_FOLLOWUPS_FAILED",
        message: recentResolvedPostFollowupsError.message,
      };
    }

    const appointmentIds = Array.from(
      new Set(
        [
          ...((pendingPostFollowupsData || []) as PostAppointmentFollowupRow[]),
          ...((recentResolvedPostFollowupsData || []) as PostAppointmentFollowupRow[]),
        ]
          .map((item) => item.appointment_id)
          .filter(Boolean)
      )
    );

    const appointmentMap = new Map<string, AppointmentRow>();

    if (appointmentIds.length > 0) {
      const { data: followupAppointmentsData, error: followupAppointmentsError } = await supabase
        .from("store_appointments")
        .select(
          "id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id, commercial_opportunity_id"
        )
        .in("id", appointmentIds);

      if (followupAppointmentsError) {
        return {
          ok: false,
          error: "LOAD_POST_FOLLOWUP_APPOINTMENTS_FAILED",
          message: followupAppointmentsError.message,
        };
      }

      for (const item of (followupAppointmentsData || []) as AppointmentRow[]) {
        appointmentMap.set(item.id, item);
      }
    }

    const { data: operationalTasksData, error: operationalTasksError } = await supabase
      .from("store_assistant_operational_tasks")
      .select(
        "id, organization_id, store_id, thread_id, task_type, status, priority, title, description, related_lead_id, related_conversation_id, related_appointment_id, commercial_opportunity_id, customer_name, customer_phone, target_date, target_time, target_start_at, target_end_at, timezone_name, task_payload, last_action_at, resolved_at, cancelled_at, error_text, created_at, updated_at"
      )
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .in("status", ["open", "waiting_user_choice", "waiting_customer_response", "ready_to_execute", "in_progress"])
      .order("updated_at", { ascending: false })
      .limit(12);

    if (operationalTasksError) {
      return {
        ok: false,
        error: "LOAD_ASSISTANT_OPERATIONAL_TASKS_FAILED",
        message: operationalTasksError.message,
      };
    }

    const openOperationalTasks = (operationalTasksData || []) as StoreAssistantOperationalTaskRow[];

    const detectedIntent = latestRequest.detectedIntent;
    const morningReportMode = detectedIntent === "morning_report";
    const eveningReportMode = detectedIntent === "evening_report";
    const nextVisitMode = detectedIntent === "next_visit";
    const postAppointmentMode = detectedIntent === "post_appointment";
    const scheduleManagementMode = detectedIntent === "schedule_management";
    const currentScheduleAction = resolveScheduleAction(lastHumanMessage);
    const generalTodayOverviewMode = isGeneralTodayOverviewRequest(lastHumanMessage);
    const specificDayScheduleMode = Boolean(specificScheduleQueryDateParts);
    const baseOpenAppointments = [
      ...((todayAppointmentsData || []) as AppointmentRow[]),
      ...((nextAppointmentsData || []) as AppointmentRow[]),
      ...((overdueAppointmentsData || []) as AppointmentRow[]),
    ];

    const appointmentManagementRequest = hasExplicitAppointmentManagementCommand(lastHumanMessage);

    const explicitCommandAppointments = appointmentManagementRequest
      ? await loadExplicitAppointmentMatchesFromCommand({
          supabase,
          organizationId,
          storeId,
          text: lastHumanMessage,
          now,
          scheduleSettings,
        })
      : [];

    const allOpenAppointments = [
      ...explicitCommandAppointments,
      ...baseOpenAppointments,
    ];

    const operationalTreatmentAbandonmentReply = await resolveOperationalTreatmentAbandonmentReply({
      supabase,
      organizationId,
      storeId,
      threadId: assistantThreadId,
      assistantContextState,
      openOperationalTasks,
      lastHumanMessage,
    });
    const operationalTreatmentAbandonmentActive = Boolean(operationalTreatmentAbandonmentReply);

    const suggestedTimeApprovalReply = !operationalTreatmentAbandonmentActive
      ? await resolveSuggestedTimeApprovalReply({
      supabase,
      organizationId,
      storeId,
      threadId: assistantThreadId,
      assistantContextState,
      openOperationalTasks,
      lastHumanMessage,
      scheduleSettings,
    })
      : null;

    const pendingCancellationTargetReply = !operationalTreatmentAbandonmentActive && !suggestedTimeApprovalReply
      ? await resolvePendingCancellationTargetClarificationReply({
          supabase,
          organizationId,
          storeId,
          threadId: assistantThreadId,
          assistantContextState,
          lastHumanMessage,
          scheduleSettings,
        })
      : null;

    const blockAdjustmentReply = !operationalTreatmentAbandonmentActive && !suggestedTimeApprovalReply && !pendingCancellationTargetReply && !appointmentManagementRequest
      ? await resolveScheduleBlockAdjustmentReply({
          supabase,
          organizationId,
          storeId,
          lastHumanMessage,
          recentMessages,
          scheduleSettings,
        })
      : null;

    const blockDayReply = !operationalTreatmentAbandonmentActive && !suggestedTimeApprovalReply && !pendingCancellationTargetReply && !appointmentManagementRequest && !blockAdjustmentReply
      ? await resolveBlockDayReply({
          supabase,
          organizationId,
          storeId,
          lastHumanMessage,
          recentMessages,
          openAppointments: allOpenAppointments,
          scheduleSettings,
        })
      : null;

    const postAppointmentActionReply = !operationalTreatmentAbandonmentActive && !suggestedTimeApprovalReply && !pendingCancellationTargetReply && !blockAdjustmentReply && !blockDayReply && postAppointmentMode && !appointmentManagementRequest
      ? await resolvePostAppointmentActionReply({
          supabase,
          organizationId,
          storeId,
          threadId: assistantThreadId,
          assistantContextState,
          lastHumanMessage,
          recentMessages,
          pendingPostFollowups: (pendingPostFollowupsData || []) as PostAppointmentFollowupRow[],
          appointmentMap,
          openAppointments: allOpenAppointments,
          scheduleSettings,
        })
      : null;

    const customerRescheduleWorkflowDeps: CustomerRescheduleWorkflowDeps = {
      sendAiMessageToCustomerConversation,
      createAssistantOperationalTask,
      updateAssistantOperationalTaskAfterCustomerContact,
      upsertAssistantContextState,
      resolveScheduleAction,
      sortOpenScheduleAppointments,
      resolveTargetAppointmentIndex,
      buildAppointmentAmbiguityReply,
      formatAppointmentType,
      buildScheduleAppointmentReferenceLabel,
      buildCustomerRescheduleMessage,
    };

    const canDispatchCustomerReschedule = currentScheduleAction === "reschedule" || currentScheduleAction === null;
    const customerRescheduleWorkflowResult = !operationalTreatmentAbandonmentActive && canDispatchCustomerReschedule && !suggestedTimeApprovalReply && !pendingCancellationTargetReply && !blockAdjustmentReply && !blockDayReply && !postAppointmentActionReply
      ? await resolveCustomerRescheduleWorkflow({
          supabase,
          organizationId,
          storeId,
          threadId: assistantThreadId,
          assistantContextState,
          lastHumanMessage,
          recentMessages,
          openAppointments: allOpenAppointments,
          scheduleSettings,
          now,
          deps: customerRescheduleWorkflowDeps,
        })
      : ({ type: "not_applicable" } as CustomerRescheduleWorkflowResult);

    const customerRescheduleWorkflowReply = customerRescheduleWorkflowResult.type !== "not_applicable"
      ? customerRescheduleWorkflowResult.reply
      : null;

    const customerAvailabilityContextReply = !operationalTreatmentAbandonmentActive && !suggestedTimeApprovalReply && !pendingCancellationTargetReply && !blockAdjustmentReply && !blockDayReply && !postAppointmentActionReply && !customerRescheduleWorkflowReply
      ? await resolveCustomerAvailabilityRequestFromContext({
          supabase,
          organizationId,
          storeId,
          threadId: assistantThreadId,
          assistantContextState,
          lastHumanMessage,
          openAppointments: allOpenAppointments,
          scheduleSettings,
        })
      : null;

    const scheduleActionReply = !operationalTreatmentAbandonmentActive && !suggestedTimeApprovalReply && !pendingCancellationTargetReply && !blockAdjustmentReply && !blockDayReply && !customerRescheduleWorkflowReply && !customerAvailabilityContextReply && (!postAppointmentMode || appointmentManagementRequest)
      ? await resolveAppointmentActionReply({
          supabase,
          organizationId,
          storeId,
          threadId: assistantThreadId,
          assistantContextState,
          lastHumanMessage,
          recentMessages,
          openAppointments: allOpenAppointments,
          scheduleSettings,
          operatorName: primaryResponsibleName,
        })
      : null;

    const systemPrompt = buildSystemPrompt({
      store,
      storeContext: runtimeStoreContext,
      recentMessages,
      todayAppointments: (todayAppointmentsData || []) as AppointmentRow[],
      nextAppointments: (nextAppointmentsData || []) as AppointmentRow[],
      overdueAppointments: (overdueAppointmentsData || []) as AppointmentRow[],
      pendingNotifications: (pendingNotificationsData || []) as PendingNotificationRow[],
      pendingPostFollowups: (pendingPostFollowupsData || []) as PostAppointmentFollowupRow[],
      recentResolvedPostFollowups: (recentResolvedPostFollowupsData || []) as PostAppointmentFollowupRow[],
      appointmentMap,
      assistantContextState,
      openOperationalTasks,
      lastHumanMessage,
    });

    const input = [
      {
        role: "system" as const,
        content: systemPrompt,
      },
      ...buildModelInput(recentMessages),
    ];

    let aiText = "";
    let aiTextFromModel = false;

    if (operationalTreatmentAbandonmentReply) {
      aiText = operationalTreatmentAbandonmentReply;
    } else if (suggestedTimeApprovalReply) {
      aiText = suggestedTimeApprovalReply;
    } else if (pendingCancellationTargetReply) {
      aiText = pendingCancellationTargetReply;
    } else if (blockAdjustmentReply) {
      aiText = blockAdjustmentReply;
    } else if (blockDayReply) {
      aiText = blockDayReply;
    } else if (postAppointmentActionReply) {
      aiText = postAppointmentActionReply;
    } else if (customerRescheduleWorkflowReply) {
      aiText = customerRescheduleWorkflowReply;
    } else if (customerAvailabilityContextReply) {
      aiText = customerAvailabilityContextReply;
    } else if (scheduleActionReply) {
      aiText = scheduleActionReply;
    } else if (specificDayScheduleMode && specificScheduleQueryDateParts) {
      aiText = buildDeterministicSpecificDayScheduleReply({
        dateParts: specificScheduleQueryDateParts,
        appointments: specificDayAppointmentsData,
        blocks: specificDayScheduleBlocksData,
        includeBlocks: includeScheduleBlocksInSpecificDayQuery,
        scheduleSettings,
      });
    } else if (generalTodayOverviewMode) {
      aiText = buildDeterministicTodayOverviewReply({
        todayAppointments: (todayAppointmentsData || []) as AppointmentRow[],
        pendingNotifications: (pendingNotificationsData || []) as PendingNotificationRow[],
        pendingPostFollowups: (pendingPostFollowupsData || []) as PostAppointmentFollowupRow[],
        openOperationalTasks,
        assistantContextState,
        scheduleSettings,
      });
    } else if (morningReportMode) {
      aiText = buildDeterministicMorningReport({
        todayAppointments: (todayAppointmentsData || []) as AppointmentRow[],
        overdueAppointments: (overdueAppointmentsData || []) as AppointmentRow[],
        pendingNotifications: (pendingNotificationsData || []) as PendingNotificationRow[],
        pendingPostFollowups: (pendingPostFollowupsData || []) as PostAppointmentFollowupRow[],
      });
    } else if (eveningReportMode) {
      aiText = buildDeterministicEveningReport({
        todayAppointments: (todayAppointmentsData || []) as AppointmentRow[],
        overdueAppointments: (overdueAppointmentsData || []) as AppointmentRow[],
        pendingNotifications: (pendingNotificationsData || []) as PendingNotificationRow[],
        pendingPostFollowups: (pendingPostFollowupsData || []) as PostAppointmentFollowupRow[],
      });
    } else if (nextVisitMode) {
      aiText = buildDeterministicNextVisitReply((nextAppointmentsData || []) as AppointmentRow[]);
    } else if (postAppointmentMode) {
      aiText = buildDeterministicPostAppointmentReply({
        pendingPostFollowups: (pendingPostFollowupsData || []) as PostAppointmentFollowupRow[],
        recentResolvedPostFollowups: (recentResolvedPostFollowupsData || []) as PostAppointmentFollowupRow[],
        appointmentMap,
        openAppointments: allOpenAppointments,
        lastHumanMessage,
      });
    } else {
      const startedAt = new Date().toISOString();

      try {
        const response = await openai.responses.create({
          model,
          input,
          max_output_tokens: asksAboutMaterialsOrDocuments(lastHumanMessage) ? 140 : 240,
        });
        const finishedAt = new Date().toISOString();
        const rawOutputText = String(response.output_text || "").trim();

        aiTextFromModel = true;
        aiText = cleanupAiText(rawOutputText, {
          genericMaterialMode: asksAboutMaterialsOrDocuments(lastHumanMessage) || nextVisitMode,
          morningReportMode,
          eveningReportMode,
        });

        await recordAssistantAiRun({
          supabase,
          organizationId,
          storeId,
          model,
          status: aiText ? "succeeded" : "failed",
          startedAt,
          finishedAt,
          response,
          error: aiText ? null : "EMPTY_AI_RESPONSE",
          lastHumanMessage,
          outputText: aiText || rawOutputText,
          detectedIntent,
        });
      } catch (openAiError: any) {
        const finishedAt = new Date().toISOString();

        await recordAssistantAiRun({
          supabase,
          organizationId,
          storeId,
          model,
          status: "failed",
          startedAt,
          finishedAt,
          error:
            openAiError?.message ||
            "Erro desconhecido ao chamar a OpenAI pela IA assistente.",
          lastHumanMessage,
          outputText: null,
          detectedIntent,
        });

        throw openAiError;
      }
    }

    if (!aiText) {
      return {
        ok: false,
        error: "EMPTY_AI_RESPONSE",
        message: "A OpenAI não retornou texto utilizável.",
      };
    }

    if (aiTextFromModel && hasUnsupportedCustomerContactSuccessClaim(aiText)) {
      aiText = buildUnsafeCustomerContactSuccessClaimFallback({
        contextState: assistantContextState,
        scheduleSettings,
      });
    } else if (aiTextFromModel && hasUnsupportedOperationalSuccessClaim(aiText)) {
      aiText = buildUnsafeOperationalSuccessClaimFallback();
    }

    const isContextMessage =
      asksAboutToday(lastHumanMessage) ||
      postAppointmentMode ||
      scheduleManagementMode ||
      Boolean(operationalTreatmentAbandonmentReply) ||
      Boolean(suggestedTimeApprovalReply) ||
      nextVisitMode ||
      morningReportMode ||
      eveningReportMode;

    const messageType =
      morningReportMode
        ? "report_morning"
        : eveningReportMode
          ? "report_evening"
          : isContextMessage
            ? "context"
            : "text";

    const { error: saveError } = await supabase.rpc("assistant_push_system_message", {
      p_organization_id: organizationId,
      p_store_id: storeId,
      p_content: aiText,
      p_message_type: messageType,
      p_related_lead_id: null,
      p_related_conversation_id: null,
      p_related_appointment_id: null,
      p_metadata: {
        source: "assistant.reply.route",
        genericMaterialMode: asksAboutMaterialsOrDocuments(lastHumanMessage) || nextVisitMode,
        postAppointmentContextUsed: postAppointmentMode,
        morningReportMode,
        eveningReportMode,
        nextVisitMode,
        scheduleManagementMode,
        generalTodayOverviewMode,
        operationalTreatmentAbandonmentMode: operationalTreatmentAbandonmentActive,
        pendingCancellationTargetMode: Boolean(pendingCancellationTargetReply),
        blockAdjustmentMode: Boolean(blockAdjustmentReply),
        blockDayMode: Boolean(blockDayReply),
        customerRescheduleWorkflowMode: customerRescheduleWorkflowResult.type !== "not_applicable",
        customerRescheduleWorkflowType: customerRescheduleWorkflowResult.type,
        customerAvailabilityContextMode: Boolean(customerAvailabilityContextReply),
        suggestedTimeApprovalMode: Boolean(suggestedTimeApprovalReply),
        activeContextId: assistantContextState?.id || null,
        activeContextStatus: assistantContextState?.active_status || null,
        activeContextTopic: assistantContextState?.active_topic || null,
        detectedIntent,
      },
    });

    if (saveError) {
      return {
        ok: false,
        error: "SAVE_ASSISTANT_MESSAGE_FAILED",
        message: saveError.message,
      };
    }

    return {
      ok: true,
      aiText,
    };
  } catch (error: any) {
    return {
      ok: false,
      error: "ASSISTANT_REPLY_ROUTE_FAILED",
      message: error?.message || "Erro interno na rota da assistente.",
    };
  }
}


function hasBlockDateCueFromNormalized(text: string) {
  return (
    text.includes("amanha") ||
    text.includes("hoje") ||
    /\b\d{1,2}\/\d{1,2}/.test(text) ||
    /\b\d{1,2}\s+de\s+/.test(text) ||
    /\bdia\s+\d{1,2}\b/.test(text)
  );
}

function hasBlockTimeCueFromNormalized(text: string) {
  return (
    /\bate\s+as?\s+\d{1,2}/.test(text) ||
    /\bdas?\s+\d{1,2}/.test(text) ||
    /\ba partir das?\s+\d{1,2}/.test(text)
  );
}

function asksToBlockStoreDay(text: string) {
  const t = normalizeText(text);

  if (hasExplicitAppointmentManagementCommand(text)) {
    return false;
  }

  const blockCue =
    t.includes("nao vou abrir") ||
    t.includes("nao abre") ||
    t.includes("nao marque nada") ||
    t.includes("nao agenda nada") ||
    t.includes("nao agende nada") ||
    t.includes("nao coloque nada") ||
    t.includes("bloqueia o dia") ||
    t.includes("bloqueie o dia") ||
    t.includes("bloquear o dia") ||
    t.includes("bloquear dia") ||
    t.includes("bloqueia a agenda") ||
    t.includes("bloqueie a agenda") ||
    t.includes("bloquear a agenda") ||
    t.includes("bloqueia minha agenda") ||
    t.includes("bloqueie minha agenda") ||
    t.includes("bloquear minha agenda") ||
    t.includes("bloqueia a minha agenda") ||
    t.includes("bloqueie a minha agenda") ||
    t.includes("bloquear a minha agenda") ||
    t.includes("deixa minha agenda bloqueada") ||
    t.includes("deixe minha agenda bloqueada") ||
    t.includes("deixa a minha agenda bloqueada") ||
    t.includes("deixe a minha agenda bloqueada") ||
    t.includes("feche minha agenda") ||
    t.includes("fechar minha agenda") ||
    t.includes("feche a minha agenda") ||
    t.includes("fechar a minha agenda") ||
    t.includes("trava a agenda") ||
    t.includes("trave a agenda") ||
    t.includes("travar a agenda") ||
    t.includes("quero que voce bloqueie") ||
    t.includes("pode bloquear") ||
    t.includes("pode bloquear sim") ||
    t.includes("fecha a loja") ||
    t.includes("fechar a loja") ||
    t.includes("vou fechar a loja") ||
    t.includes("loja fechada") ||
    t.includes("nao vou atender") ||
    t.includes("nao vou trabalhar");

  return blockCue && (hasBlockDateCueFromNormalized(t) || hasBlockTimeCueFromNormalized(t));
}

function isSimplePositiveConfirmation(text: string) {
  const t = normalizeText(text);
  return ["sim", "ok", "pode", "pode sim", "pode fazer", "segue", "faz isso", "confirmo", "confirmado"].includes(t);
}

function isBlockDayFollowupInstruction(text: string) {
  const t = normalizeText(text);
  if (hasExplicitAppointmentManagementCommand(text)) return false;
  return (
    isSimplePositiveConfirmation(t) ||
    t.includes("remarca") ||
    t.includes("remarque") ||
    t.includes("remarcar") ||
    t.includes("cancela") ||
    t.includes("cancele") ||
    t.includes("cancelar") ||
    t.includes("muda para") ||
    t.includes("passa para") ||
    t.includes("joga para") ||
    t.includes("move para")
  );
}

function inferPreviousBlockDayRequest(messages: AssistantMessageRow[], currentHumanMessage: string) {
  const ordered = [...messages]
    .filter((message) => getMessageContent(message).length > 0)
    .filter((message) => isLikelyResponsibleMessage(message))
    .map((message) => getMessageContent(message))
    .filter((content) => content !== currentHumanMessage);

  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    if (asksToBlockStoreDay(ordered[index])) {
      return ordered[index];
    }
  }

  return null;
}

function getDayKeyFromDate(date: Date) {
  const day = date.getDay();
  if (day === 0) return "domingo";
  if (day === 1) return "segunda";
  if (day === 2) return "terca";
  if (day === 3) return "quarta";
  if (day === 4) return "quinta";
  if (day === 5) return "sexta";
  return "sabado";
}

function buildBlockDayRange(
  dateParts: { day: number; month: number; year: number },
  settings?: StoreScheduleSettingsRow | null
) {
  const timeZone = getScheduleTimezone(settings);
  const localDate = new Date(dateParts.year, dateParts.month, dateParts.day, 12, 0, 0, 0);
  const dayKey = getDayKeyFromDate(localDate);
  const hours = settings?.operating_hours?.[dayKey];
  const startText = hours?.start || "00:00";
  const endText = hours?.end || "23:59";
  const startHour = Number(startText.split(":")[0] || 0);
  const startMinute = Number(startText.split(":")[1] || 0);
  const endHour = Number(endText.split(":")[0] || 23);
  const endMinute = Number(endText.split(":")[1] || 59);

  return {
    startIso: localScheduleDateTimeToUtcIso({ dateParts, hour: startHour, minute: startMinute, timeZone }),
    endIso: localScheduleDateTimeToUtcIso({ dateParts, hour: endHour, minute: endMinute, timeZone }),
  };
}

function extractHourMinute(text: string) {
  const direct = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*h?\b/);
  if (!direct) return null;
  const hour = Number(direct[1]);
  const minute = direct[2] ? Number(direct[2]) : 0;
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function parseBlockTimeWindow(
  text: string,
  dateParts: { day: number; month: number; year: number },
  settings?: StoreScheduleSettingsRow | null
) {
  const normalized = normalizeText(text);
  const timeZone = getScheduleTimezone(settings);
  const baseRange = buildBlockDayRange(dateParts, settings);

  const between =
    normalized.match(/\b(?:das?|do|de)\s+(\d{1,2})(?::(\d{2}))?\s*(?:h)?\s*(?:as|às|ate|até)\s*(?:as?\s*)?(\d{1,2})(?::(\d{2}))?\s*(?:h)?\b/) ||
    normalized.match(/\b(\d{1,2})(?::(\d{2}))?\s*(?:h)?\s*(?:as|às|ate|até)\s*(?:as?\s*)?(\d{1,2})(?::(\d{2}))?\s*(?:h)?\b/);
  if (between) {
    const startHour = Number(between[1]);
    const startMinute = between[2] ? Number(between[2]) : 0;
    const endHour = Number(between[3]);
    const endMinute = between[4] ? Number(between[4]) : 0;
    const startIso = localScheduleDateTimeToUtcIso({ dateParts, hour: startHour, minute: startMinute, timeZone });
    const endIso = localScheduleDateTimeToUtcIso({ dateParts, hour: endHour, minute: endMinute, timeZone });
    return {
      startIso,
      endIso,
      label: `das ${padTwoDigits(startHour)}:${padTwoDigits(startMinute)} às ${padTwoDigits(endHour)}:${padTwoDigits(endMinute)}`,
      partial: true,
    };
  }

  const until = normalized.match(/\b(?:ate|até)\s+as?\s+(\d{1,2})(?::(\d{2}))?\s*(?:h)?\b/);
  if (until) {
    const endHour = Number(until[1]);
    const endMinute = until[2] ? Number(until[2]) : 0;
    const endIso = localScheduleDateTimeToUtcIso({ dateParts, hour: endHour, minute: endMinute, timeZone });
    return {
      startIso: baseRange.startIso,
      endIso,
      label: `até ${padTwoDigits(endHour)}:${padTwoDigits(endMinute)}`,
      partial: true,
    };
  }

  const from = normalized.match(/\ba\s+partir\s+das?\s+(\d{1,2})(?::(\d{2}))?\s*(?:h)?\b/);
  if (from) {
    const startHour = Number(from[1]);
    const startMinute = from[2] ? Number(from[2]) : 0;
    const startIso = localScheduleDateTimeToUtcIso({ dateParts, hour: startHour, minute: startMinute, timeZone });
    return {
      startIso,
      endIso: baseRange.endIso,
      label: `a partir de ${padTwoDigits(startHour)}:${padTwoDigits(startMinute)}`,
      partial: true,
    };
  }

  return {
    startIso: baseRange.startIso,
    endIso: baseRange.endIso,
    label: null,
    partial: false,
  };
}

function buildBlockRangeNaturalLabel(
  startIso: string,
  endIso: string,
  partial: boolean,
  timeZone: string,
  partialLabel?: string | null
) {
  if (partial) {
    if (partialLabel) {
      return `${formatDateOnlyInTimeZone(startIso, timeZone)} ${partialLabel}`;
    }
    return `${formatDateOnlyInTimeZone(startIso, timeZone)} das ${formatTimeOnlyInTimeZone(startIso, timeZone)} às ${formatTimeOnlyInTimeZone(endIso, timeZone)}`;
  }
  return formatDateOnlyInTimeZone(startIso, timeZone);
}

function extractCreatedScheduleBlockId(data: unknown): string | null {
  const row = Array.isArray(data) ? data[0] : data;

  if (typeof row === "string") {
    const trimmed = row.trim();
    return trimmed.length ? trimmed : null;
  }

  if (row && typeof row === "object") {
    const directId = (row as { id?: unknown }).id;
    if (typeof directId === "string" && directId.trim()) {
      return directId.trim();
    }
  }

  return null;
}

function hasExplicitBlockRangeCueFromNormalized(text: string) {
  return (
    /\b(?:das?|do|de)\s+\d{1,2}(?::\d{2})?\s*(?:h)?\s*(?:as|às|ate|até)\s*(?:as?\s*)?\d{1,2}(?::\d{2})?\s*(?:h)?\b/.test(text) ||
    /\b\d{1,2}(?::\d{2})?\s*(?:h)?\s*(?:as|às|ate|até)\s*(?:as?\s*)?\d{1,2}(?::\d{2})?\s*(?:h)?\b/.test(text)
  );
}

function asksToAdjustScheduleBlock(text: string) {
  const t = normalizeText(text);
  const adjustmentCue =
    t.includes("ajuste") ||
    t.includes("ajusta") ||
    t.includes("corrija") ||
    t.includes("corrige") ||
    t.includes("corrigir") ||
    t.includes("edite") ||
    t.includes("editar") ||
    t.includes("altere") ||
    t.includes("alterar") ||
    t.includes("mude") ||
    t.includes("mudar") ||
    t.includes("eu pedi") ||
    t.includes("nao era") ||
    t.includes("não era") ||
    t.includes("nao das") ||
    t.includes("não das") ||
    t.includes("ficar das") ||
    t.includes("ficar do");

  const scheduleBlockCue =
    t.includes("bloqueio") ||
    t.includes("bloqueado") ||
    t.includes("bloqueei") ||
    t.includes("bloqueie") ||
    t.includes("bloqueia") ||
    t.includes("agenda") ||
    t.includes("loja fechada") ||
    t.includes("nao marque") ||
    t.includes("não marque");

  return adjustmentCue && (scheduleBlockCue || hasExplicitBlockRangeCueFromNormalized(t)) && (hasBlockDateCueFromNormalized(t) || hasExplicitBlockRangeCueFromNormalized(t));
}

function inferPreviousScheduleBlockDateRequest(messages: AssistantMessageRow[], currentHumanMessage: string) {
  const ordered = [...messages]
    .filter((message) => getMessageContent(message).length > 0)
    .filter((message) => isLikelyResponsibleMessage(message))
    .map((message) => getMessageContent(message))
    .filter((content) => content !== currentHumanMessage);

  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const content = ordered[index];
    if (asksToBlockStoreDay(content) || asksToAdjustScheduleBlock(content)) {
      const parsed = parseScheduleDateFromText(content, new Date());
      if (parsed) return parsed;
    }
  }

  return null;
}

function buildLocalDayQueryRange(
  dateParts: { day: number; month: number; year: number },
  timeZone: string
) {
  const nextDate = new Date(dateParts.year, dateParts.month, dateParts.day, 12, 0, 0, 0);
  nextDate.setDate(nextDate.getDate() + 1);

  return {
    startIso: localScheduleDateTimeToUtcIso({ dateParts, hour: 0, minute: 0, timeZone }),
    endIso: localScheduleDateTimeToUtcIso({
      dateParts: {
        day: nextDate.getDate(),
        month: nextDate.getMonth(),
        year: nextDate.getFullYear(),
      },
      hour: 0,
      minute: 0,
      timeZone,
    }),
  };
}

function buildScheduleBlockTitle(
  startIso: string,
  endIso: string,
  partial: boolean,
  partialLabel: string | null | undefined,
  timeZone: string
) {
  return partial
    ? `Loja fechada em ${formatDateOnlyInTimeZone(startIso, timeZone)} (${partialLabel || `${formatTimeOnlyInTimeZone(startIso, timeZone)}-${formatTimeOnlyInTimeZone(endIso, timeZone)}`})`
    : `Loja fechada em ${formatDateOnlyInTimeZone(startIso, timeZone)}`;
}

async function resolveScheduleBlockAdjustmentReply(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  lastHumanMessage: string;
  recentMessages: AssistantMessageRow[];
  scheduleSettings?: StoreScheduleSettingsRow | null;
}) {
  if (!asksToAdjustScheduleBlock(args.lastHumanMessage)) {
    return null;
  }

  const scheduleTimezone = getScheduleTimezone(args.scheduleSettings || null);
  const dateParts =
    parseScheduleDateFromText(args.lastHumanMessage, new Date()) ||
    inferPreviousScheduleBlockDateRequest(args.recentMessages, args.lastHumanMessage);

  if (!dateParts) {
    return "Eu entendi que você quer ajustar um bloqueio, mas não consegui identificar a data. Me diga o dia e o horário certinho.";
  }

  const parsedRange = parseBlockTimeWindow(args.lastHumanMessage, dateParts, args.scheduleSettings || null);

  if (!parsedRange.partial) {
    return "Eu entendi que você quer ajustar um bloqueio, mas não consegui identificar o novo horário. Exemplo: ajustar para das 12:00 às 14:00.";
  }

  const blockStartMs = new Date(parsedRange.startIso).getTime();
  const blockEndMs = new Date(parsedRange.endIso).getTime();

  if (!Number.isFinite(blockStartMs) || !Number.isFinite(blockEndMs) || blockEndMs <= blockStartMs) {
    return "Eu não consegui entender corretamente o novo período desse bloqueio. Me fala de novo o dia e o horário.";
  }

  const dayRange = buildLocalDayQueryRange(dateParts, scheduleTimezone);
  const existingBlocksResponse = await args.supabase
    .from("store_schedule_blocks")
    .select("id, title, start_at, end_at, notes, created_at")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .lt("start_at", dayRange.endIso)
    .gt("end_at", dayRange.startIso)
    .order("created_at", { ascending: false })
    .limit(10);

  if (existingBlocksResponse.error) {
    return `Tentei procurar o bloqueio desse dia, mas encontrei um erro: ${existingBlocksResponse.error.message}`;
  }

  const existingBlocks = Array.isArray(existingBlocksResponse.data) ? existingBlocksResponse.data : [];

  if (existingBlocks.length === 0) {
    return "Eu procurei esse bloqueio na agenda, mas não encontrei um bloqueio desse dia para ajustar.";
  }

  const targetBlock =
    existingBlocks.find((block: any) => {
      const startMs = new Date(block.start_at).getTime();
      const endMs = new Date(block.end_at).getTime();
      return Number.isFinite(startMs) && Number.isFinite(endMs) && startMs < blockEndMs && endMs > blockStartMs;
    }) || existingBlocks[0];

  const blockLabel = buildBlockRangeNaturalLabel(
    parsedRange.startIso,
    parsedRange.endIso,
    true,
    scheduleTimezone,
    parsedRange.label
  );
  const nextTitle = buildScheduleBlockTitle(
    parsedRange.startIso,
    parsedRange.endIso,
    true,
    parsedRange.label,
    scheduleTimezone
  );
  const previousNotes = String((targetBlock as any).notes || "").trim();
  const nextNotes = previousNotes
    ? `${previousNotes}\nAjustado pela assistente operacional a pedido do responsável da loja.`
    : "Ajustado pela assistente operacional a pedido do responsável da loja.";

  const { data: updatedBlock, error: updateError } = await args.supabase
    .from("store_schedule_blocks")
    .update({
      title: nextTitle,
      start_at: parsedRange.startIso,
      end_at: parsedRange.endIso,
      notes: nextNotes,
    })
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("id", (targetBlock as any).id)
    .select("id, title, start_at, end_at")
    .maybeSingle();

  if (updateError) {
    return `Tentei ajustar o bloqueio, mas encontrei um erro: ${updateError.message}`;
  }

  const confirmedId = typeof updatedBlock?.id === "string" ? updatedBlock.id.trim() : "";
  const confirmedStartMs = new Date(updatedBlock?.start_at || "").getTime();
  const confirmedEndMs = new Date(updatedBlock?.end_at || "").getTime();

  if (
    !confirmedId ||
    !Number.isFinite(confirmedStartMs) ||
    !Number.isFinite(confirmedEndMs) ||
    Math.abs(confirmedStartMs - blockStartMs) > 1000 ||
    Math.abs(confirmedEndMs - blockEndMs) > 1000
  ) {
    return "Eu tentei ajustar o bloqueio, mas não consegui confirmar a alteração real na agenda.";
  }

  return `Pronto. Ajustei o bloqueio para ${blockLabel}.`;
}

async function resolveBlockDayReply(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  lastHumanMessage: string;
  recentMessages: AssistantMessageRow[];
  openAppointments: AppointmentRow[];
  scheduleSettings?: StoreScheduleSettingsRow | null;
}) {
  let sourceMessage = args.lastHumanMessage;
  const currentMessage = args.lastHumanMessage;
  const currentLooksLikeFollowup = isBlockDayFollowupInstruction(currentMessage);

  if (!asksToBlockStoreDay(sourceMessage) && currentLooksLikeFollowup) {
    const previousRequest = inferPreviousBlockDayRequest(args.recentMessages, args.lastHumanMessage);
    if (previousRequest) {
      sourceMessage = previousRequest;
    }
  }

  if (!asksToBlockStoreDay(sourceMessage)) {
    return null;
  }

  const normalizedSourceMessage = normalizeText(sourceMessage);
  let dateParts = parseScheduleDateFromText(sourceMessage, new Date());

  if (!dateParts && hasBlockTimeCueFromNormalized(normalizedSourceMessage)) {
    const today = new Date();
    dateParts = {
      day: today.getDate(),
      month: today.getMonth(),
      year: today.getFullYear(),
    };
  }

  if (!dateParts) {
    return "Para eu bloquear esse período, me diga a data com clareza. Exemplo: dia 21/04 eu não vou abrir a loja.";
  }

  const parsedRange = parseBlockTimeWindow(sourceMessage, dateParts, args.scheduleSettings || null);
  const { startIso, endIso, partial, label: partialLabel } = parsedRange;
  const scheduleTimezone = getScheduleTimezone(args.scheduleSettings || null);

  const blockStartMs = new Date(startIso).getTime();
  const blockEndMs = new Date(endIso).getTime();

  if (!Number.isFinite(blockStartMs) || !Number.isFinite(blockEndMs) || blockEndMs <= blockStartMs) {
    return "Eu não consegui entender corretamente o período desse bloqueio. Me fala de novo o dia e o horário.";
  }

  const blockLabel = buildBlockRangeNaturalLabel(startIso, endIso, partial, scheduleTimezone, partialLabel);

  const appointmentsOnDay = sortOpenScheduleAppointments(
    (args.openAppointments || []).filter((appointment) => {
      const startValue = appointment.scheduled_start;
      const endValue = appointment.scheduled_end || appointment.scheduled_start;
      if (!startValue || !endValue) return false;
      const startMs = new Date(startValue).getTime();
      const endMs = new Date(endValue).getTime();
      return startMs < blockEndMs && endMs > blockStartMs;
    })
  );

  const existingBlocksResponse = await args.supabase
    .from("store_schedule_blocks")
    .select("id, title, start_at, end_at")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .lt("start_at", endIso)
    .gt("end_at", startIso)
    .order("start_at", { ascending: true });

  if (existingBlocksResponse.error) {
    return `Tentei verificar os bloqueios desse período, mas encontrei um erro: ${existingBlocksResponse.error.message}`;
  }

  const existingBlocks = Array.isArray(existingBlocksResponse.data) ? existingBlocksResponse.data : [];

  const alreadyBlocked = existingBlocks.some((block: any) => {
    const startMs = new Date(block.start_at).getTime();
    const endMs = new Date(block.end_at).getTime();
    return Number.isFinite(startMs) && Number.isFinite(endMs) && startMs <= blockStartMs && endMs >= blockEndMs;
  });

  let createdBlockId: string | null = null;

  if (!alreadyBlocked) {
    const { data, error } = await args.supabase.rpc(
      "create_store_schedule_block_allow_existing_appointments",
      {
        p_organization_id: args.organizationId,
        p_store_id: args.storeId,
        p_title: buildScheduleBlockTitle(startIso, endIso, partial, partialLabel, scheduleTimezone),
        p_block_type: "manual_block",
        p_start_at: startIso,
        p_end_at: endIso,
        p_notes: "Bloqueado pela assistente operacional a pedido do responsável da loja.",
        p_source: "ai_operator",
        p_created_by_user_id: null,
      }
    );

    if (error) {
      return `Tentei bloquear ${blockLabel}, mas encontrei um erro: ${error.message}`;
    }

    createdBlockId = extractCreatedScheduleBlockId(data);

    if (!createdBlockId) {
      return `Eu tentei bloquear ${blockLabel}, mas não consegui confirmar o registro desse bloqueio na agenda.`;
    }
  }

  let contactedCustomers = 0;
  let missingConversationCount = 0;

  for (const appointment of appointmentsOnDay) {
    const conversationId = String(appointment.conversation_id || "").trim();
    if (!conversationId) {
      missingConversationCount += 1;
      continue;
    }

    const customerMessage = buildCustomerRescheduleMessage({
      appointment,
    });

    const sendResult = await sendAiMessageToCustomerConversation({
      supabase: args.supabase,
      conversationId,
      text: customerMessage,
      target: buildCommercialTargetFromAppointment(appointment, "block_day_customer_reschedule_notice"),
    });

    if (sendResult.ok) {
      contactedCustomers += 1;
    }
  }

  if (appointmentsOnDay.length > 0) {
    const lines: string[] = [];

    lines.push(
      alreadyBlocked || createdBlockId
        ? `Certo. Já deixei ${blockLabel} bloqueado para não entrarem novos compromissos nesse período.`
        : `Ainda não consegui deixar ${blockLabel} bloqueado para novos compromissos.`
    );

    lines.push("");
    lines.push(
      `Encontrei ${appointmentsOnDay.length === 1 ? "1 compromisso marcado" : `${appointmentsOnDay.length} compromissos marcados`} nesse período.`
    );

    appointmentsOnDay.slice(0, 5).forEach((appointment, index) => {
      lines.push("");
      lines.push(`${index + 1}. ${buildScheduleAppointmentReferenceLabel(appointment)}`);
      if (appointment.customer_name) {
        lines.push(`- cliente: ${appointment.customer_name}`);
      }
      const timeLabel = appointment.scheduled_start || appointment.scheduled_end;
      if (timeLabel) {
        lines.push(`- horário: ${formatDateOnly(timeLabel)} às ${formatTimeOnly(timeLabel)}`);
      }
    });

    lines.push("");

    if (contactedCustomers === 1) {
      lines.push("Já entrei em contato com o cliente desse compromisso para alinhar uma nova data.");
    } else if (contactedCustomers > 1) {
      lines.push(`Já entrei em contato com ${contactedCustomers} clientes para alinhar novas datas.`);
    } else {
      lines.push("Ainda não consegui iniciar o contato automático com os clientes afetados.");
    }

    if (missingConversationCount > 0) {
      lines.push(
        missingConversationCount === 1
          ? "Tem 1 compromisso sem conversa ligada automaticamente, então esse vai precisar de atenção manual."
          : `Tem ${missingConversationCount} compromissos sem conversa ligada automaticamente, então esses vão precisar de atenção manual.`
      );
    }

    if (contactedCustomers > 0) {
      lines.push("Assim que as respostas chegarem, eu atualizo a agenda e te aviso por aqui.");
    }
    return lines.join("\n").trim();
  }

  return alreadyBlocked || createdBlockId
    ? `Certo. Bloqueei ${blockLabel} para não entrar nenhum compromisso novo.`
    : `Ainda não consegui bloquear ${blockLabel}.`;
}

export function createAssistantReplyPostHandler(
  deps: Partial<AssistantReplyRouteDeps> = {},
) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const generateReply = deps.generateReply ?? generateAssistantReply;

  return async function POST(request: Request) {
    try {
      const body = (await request.json()) as {
        organizationId?: string;
        storeId?: string;
      };

      const access = await resolveAccess({
        requirement: "active",
      });

      if (!access.ok) {
        return createStoreApiDeniedResponse(access);
      }

      const authorizedContext = {
        sessionUserId: access.sessionUserId,
        organizationId: access.organizationId,
        storeId: access.storeId,
      };

      void body.organizationId;
      void body.storeId;
      void authorizedContext.sessionUserId;

      const result = await generateReply({
        request,
        organizationId: authorizedContext.organizationId,
        storeId: authorizedContext.storeId,
      });

      if (!result.ok) {
        return NextResponse.json(result, { status: 400 });
      }

      return NextResponse.json(result);
    } catch (error: any) {
      return NextResponse.json(
        {
          ok: false,
          error: "ASSISTANT_REPLY_ROUTE_FAILED",
          message: error?.message || "Erro interno na rota da assistente.",
        },
        { status: 500 }
      );
    }
  };
}

export const POST = createAssistantReplyPostHandler();
