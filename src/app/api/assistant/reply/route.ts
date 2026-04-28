
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type StoreRow = {
  id: string;
  organization_id: string;
  name: string | null;
};

type StoreAnswerRow = {
  question_key: string;
  answer: unknown;
};

type AssistantMessageRow = {
  sender: string | null;
  sender_role: string | null;
  direction: string | null;
  message_type: string | null;
  content: string | null;
  created_at: string | null;
};

type AppointmentRow = {
  id: string;
  title: string | null;
  appointment_type: string | null;
  status: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  address_text: string | null;
  notes: string | null;
  lead_id: string | null;
  conversation_id: string | null;
};

type StoreScheduleSettingsRow = {
  operating_days: string[] | null;
  operating_hours: Record<string, { start?: string; end?: string }> | null;
  timezone_name: string | null;
};

type PendingNotificationRow = {
  id: string;
  notification_type: string | null;
  priority: string | null;
  title: string | null;
  body: string | null;
  created_at: string | null;
  related_lead_id: string | null;
  related_conversation_id: string | null;
  related_appointment_id: string | null;
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
  preferred_channel: string | null;
  prompt_count: number | null;
  last_prompted_at: string | null;
  confirmed_at: string | null;
  resolved_at: string | null;
  resolution: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type StoreAssistantContextStateRow = {
  id: string;
  organization_id: string;
  store_id: string;
  thread_id: string;
  active_topic: string | null;
  active_intent: string | null;
  active_status: string;
  active_customer_name: string | null;
  active_customer_phone: string | null;
  active_lead_id: string | null;
  active_conversation_id: string | null;
  active_appointment_id: string | null;
  target_date: string | null;
  target_time: string | null;
  target_start_at: string | null;
  target_end_at: string | null;
  timezone_name: string;
  candidate_options: unknown;
  context_payload: unknown;
  last_user_message: string | null;
  last_assistant_message: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

type StoreAssistantOperationalTaskRow = {
  id: string;
  organization_id: string;
  store_id: string;
  thread_id: string | null;
  task_type: string;
  status: string;
  priority: string;
  title: string;
  description: string | null;
  related_lead_id: string | null;
  related_conversation_id: string | null;
  related_appointment_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  target_date: string | null;
  target_time: string | null;
  target_start_at: string | null;
  target_end_at: string | null;
  timezone_name: string | null;
  task_payload: unknown;
  last_action_at: string | null;
  resolved_at: string | null;
  cancelled_at: string | null;
  error_text: string | null;
  created_at: string;
  updated_at: string;
};

type AssistantCandidateOption = {
  option_number: number;
  source_index: number;
  appointment_id: string;
  title: string | null;
  appointment_type: string | null;
  status: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  lead_id: string | null;
  conversation_id: string | null;
};

type AssistantReplyResult =
  | {
      ok: true;
      aiText: string;
    }
  | {
      ok: false;
      error: string;
      message: string;
    };

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

function normalizeText(value: string | null | undefined): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatDateTime(value: string | null) {
  if (!value) return "sem data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "sem data";
  return date.toLocaleString("pt-BR");
}

function formatDateOnly(value: string | null) {
  if (!value) return "sem data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "sem data";
  return date.toLocaleDateString("pt-BR");
}

function formatTimeOnly(value: string | null) {
  if (!value) return "sem hora";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "sem hora";
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function getScheduleTimezone(settings?: StoreScheduleSettingsRow | null) {
  const configuredTimezone = String(settings?.timezone_name || "").trim();
  return configuredTimezone || "America/Sao_Paulo";
}

function padTwoDigits(value: number) {
  return String(value).padStart(2, "0");
}

function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function safeScheduleTimezone(timeZone: string) {
  return isValidTimeZone(timeZone) ? timeZone : "America/Sao_Paulo";
}

function formatDateOnlyInTimeZone(value: string | null, timeZone: string) {
  if (!value) return "sem data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "sem data";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: safeScheduleTimezone(timeZone),
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatTimeOnlyInTimeZone(value: string | null, timeZone: string) {
  if (!value) return "sem hora";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "sem hora";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: safeScheduleTimezone(timeZone),
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
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

function getTimeZoneOffsetMinutes(timeZone: string, date: Date) {
  const safeTimeZone = safeScheduleTimezone(timeZone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const values: Record<string, number> = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = Number(part.value);
    }
  }

  const asUtc = Date.UTC(
    values.year,
    (values.month || 1) - 1,
    values.day || 1,
    values.hour === 24 ? 0 : values.hour || 0,
    values.minute || 0,
    values.second || 0,
    0
  );

  return Math.round((asUtc - date.getTime()) / 60000);
}

function localScheduleDateTimeToUtcIso(args: {
  dateParts: { day: number; month: number; year: number };
  hour: number;
  minute: number;
  timeZone: string;
}) {
  const safeTimeZone = safeScheduleTimezone(args.timeZone);
  const localUtcMs = Date.UTC(
    args.dateParts.year,
    args.dateParts.month,
    args.dateParts.day,
    args.hour,
    args.minute,
    0,
    0
  );

  let utcMs = localUtcMs;

  for (let i = 0; i < 3; i += 1) {
    const offsetMinutes = getTimeZoneOffsetMinutes(safeTimeZone, new Date(utcMs));
    const nextUtcMs = localUtcMs - offsetMinutes * 60 * 1000;
    if (Math.abs(nextUtcMs - utcMs) < 1000) {
      utcMs = nextUtcMs;
      break;
    }
    utcMs = nextUtcMs;
  }

  return new Date(utcMs).toISOString();
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
}): Promise<SendAiMessageToCustomerConversationResult> {
  const conversationId = String(args.conversationId || '').trim();
  const text = String(args.text || '').trim();

  if (!conversationId) {
    return { ok: false, error: 'CONVERSATION_ID_MISSING' };
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

    return buildPostAppointmentActionSuccessReply({
      action,
      itemNumber,
      appointment: selectedAppointment,
    });
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

function getLocalDateKeyFromIso(iso: string | null | undefined, settings?: StoreScheduleSettingsRow | null) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const timeZone = safeScheduleTimezone(getScheduleTimezone(settings || null));
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = part.value;
  }

  if (!values.year || !values.month || !values.day) return null;
  return `${values.year}-${values.month}-${values.day}`;
}

function getDateKeyFromParts(dateParts: { day: number; month: number; year: number } | null | undefined) {
  if (!dateParts) return null;
  return `${dateParts.year}-${padTwoDigits(dateParts.month + 1)}-${padTwoDigits(dateParts.day)}`;
}

function formatDatePartsForHuman(dateParts: { day: number; month: number; year: number } | null | undefined) {
  if (!dateParts) return "essa data";
  return `${padTwoDigits(dateParts.day)}/${padTwoDigits(dateParts.month + 1)}/${dateParts.year}`;
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

function buildAppointmentCandidateOptions(args: {
  candidateIndexes: number[];
  openAppointments: AppointmentRow[];
}) {
  return args.candidateIndexes.slice(0, 8).map((candidateIndex, visibleIndex) => {
    const appointment = args.openAppointments[candidateIndex];
    return {
      option_number: visibleIndex + 1,
      source_index: candidateIndex,
      appointment_id: appointment?.id || "",
      title: appointment?.title || null,
      appointment_type: appointment?.appointment_type || null,
      status: appointment?.status || null,
      scheduled_start: appointment?.scheduled_start || null,
      scheduled_end: appointment?.scheduled_end || null,
      customer_name: appointment?.customer_name || null,
      customer_phone: appointment?.customer_phone || null,
      lead_id: appointment?.lead_id || null,
      conversation_id: appointment?.conversation_id || null,
    } satisfies AssistantCandidateOption;
  }).filter((item) => item.appointment_id);
}

function readAssistantCandidateOptions(contextState?: StoreAssistantContextStateRow | null) {
  const raw = contextState?.candidate_options;
  return Array.isArray(raw) ? (raw as AssistantCandidateOption[]) : [];
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
    .select("id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("id", appointmentId)
    .maybeSingle();

  if (error || !data) return null as AppointmentRow | null;
  return data as AppointmentRow;
}

function getSelectedAssistantCandidateOption(args: {
  text: string;
  contextState?: StoreAssistantContextStateRow | null;
}) {
  const contextStatus = normalizeText(args.contextState?.active_status || "");
  const contextTopic = normalizeText(args.contextState?.active_topic || "");
  if (contextTopic !== "appointment_management" || contextStatus !== "waiting_user_choice") return null;

  const options = readAssistantCandidateOptions(args.contextState);
  if (!options.length) return null;

  const selectedIndex = resolveExplicitAppointmentItemIndex(args.text, options.length);
  if (selectedIndex === null) return null;

  const optionNumber = selectedIndex + 1;
  return options.find((option) => Number(option.option_number) === optionNumber) || null;
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
    .select("id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id")
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
  const { error: cancelError } = await args.supabase.rpc("cancel_store_appointment", { p_appointment_id: appointment.id, p_organization_id: args.organizationId, p_store_id: args.storeId, p_cancel_reason: "Cancelado pelo responsável na assistente operacional." });
  if (cancelError) return `Tentei cancelar esse compromisso, mas encontrei um erro: ${cancelError.message}`;

  let customerMessageSent = false, customerMessageError: string | null = null;
  if (appointment.conversation_id) {
    const sendResult = await sendAiMessageToCustomerConversation({ supabase: args.supabase, conversationId: appointment.conversation_id, text: buildCustomerCancellationMessage({ appointment, scheduleSettings: args.scheduleSettings || null, reasonText: args.reasonText || null }) });
    customerMessageSent = sendResult.ok;
    customerMessageError = sendResult.ok ? null : sendResult.error;
  }

  const referenceLabel = buildScheduleAppointmentReferenceLabel(appointment);
  const customerName = appointment.customer_name || "cliente não identificado";
  const timeLabel = formatAppointmentStartInTimeZone({ value: appointment.scheduled_start || appointment.scheduled_end || null, scheduleSettings: args.scheduleSettings || null, timezoneName: args.assistantContextState?.timezone_name || null });
  const responsibleReply = appointment.conversation_id
    ? (customerMessageSent ? `Pronto. Cancelei ${referenceLabel} de ${customerName}, agendada para ${timeLabel}, e avisei o cliente.` : `Cancelei ${referenceLabel} de ${customerName}, agendada para ${timeLabel}, mas não consegui avisar o cliente automaticamente. Erro: ${customerMessageError || "canal indisponível"}.`)
    : `Pronto. Cancelei ${referenceLabel} de ${customerName}, agendada para ${timeLabel}. Não encontrei conversa vinculada para avisar o cliente automaticamente.`;

  if (args.threadId) await resolveAssistantContextState({ supabase: args.supabase, organizationId: args.organizationId, storeId: args.storeId, threadId: args.threadId, currentContextState: args.assistantContextState || null, lastUserMessage: args.lastHumanMessage, lastAssistantMessage: responsibleReply });
  return responsibleReply;
}

async function handlePendingCustomerCancelDecision(args: { supabase: any; organizationId: string; storeId: string; threadId?: string | null; assistantContextState?: StoreAssistantContextStateRow | null; lastHumanMessage: string; scheduleSettings?: StoreScheduleSettingsRow | null; }) {
  const contextState = args.assistantContextState || null;
  if (!isWaitingForCustomerCancelDecision(contextState)) return null;

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
    if (args.threadId) await upsertAssistantContextState({
      supabase: args.supabase, organizationId: args.organizationId, storeId: args.storeId, threadId: args.threadId, currentContextState: contextState,
      patch: { active_topic: "appointment_reschedule", active_intent: "reschedule", active_status: "active", active_customer_name: appointment.customer_name || null, active_customer_phone: appointment.customer_phone || null, active_lead_id: appointment.lead_id || null, active_conversation_id: appointment.conversation_id || null, active_appointment_id: appointment.id, target_date: null, target_time: null, target_start_at: null, target_end_at: null, timezone_name: getScheduleTimezone(args.scheduleSettings || null), candidate_options: [], context_payload: { reason: "customer_cancel_prompt_chose_reschedule", appointment_id: appointment.id }, last_user_message: args.lastHumanMessage },
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
    .select("id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id")
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
    .select("id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id")
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
        .select("id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id")
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
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false as const, error: error.message, contextState: null as StoreAssistantContextStateRow | null };
  return { ok: true as const, contextState: (data || null) as StoreAssistantContextStateRow | null };
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

async function resolveAssistantContextState(args: { supabase: any; organizationId: string; storeId: string; threadId: string; currentContextState?: StoreAssistantContextStateRow | null; lastUserMessage: string; lastAssistantMessage?: string | null; }) {
  return upsertAssistantContextState({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    threadId: args.threadId,
    currentContextState: args.currentContextState,
    patch: { active_status: "resolved", last_user_message: args.lastUserMessage, last_assistant_message: args.lastAssistantMessage || args.currentContextState?.last_assistant_message || null, candidate_options: [], context_payload: { resolved_reason: "action_completed_or_context_closed" } },
  });
}

function isoDateToLocalDateForDb(iso: string | null | undefined, timeZone: string) {
  if (!iso) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: safeScheduleTimezone(timeZone), year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const values: Record<string, string> = {};
  for (const part of parts) if (part.type !== "literal") values[part.type] = part.value;
  return values.year && values.month && values.day ? `${values.year}-${values.month}-${values.day}` : null;
}

function getLocalDatePartsForSchedule(settings?: StoreScheduleSettingsRow | null, date = new Date()) {
  const timeZone = safeScheduleTimezone(getScheduleTimezone(settings || null));
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year || date.getFullYear(),
    month: values.month || date.getMonth() + 1,
    day: values.day || date.getDate(),
  };
}

function buildStoreLocalDayRangeIso(settings?: StoreScheduleSettingsRow | null, date = new Date()) {
  const dateParts = getLocalDatePartsForSchedule(settings || null, date);
  return {
    startIso: buildIsoFromDateAndTime(dateParts, "00:00", settings || null),
    endIso: buildIsoFromDateAndTime(dateParts, "23:59", settings || null),
    dateKey: `${dateParts.year}-${padTwoDigits(dateParts.month)}-${padTwoDigits(dateParts.day)}`,
  };
}

async function createAssistantOperationalTask(args: { supabase: any; organizationId: string; storeId: string; threadId: string | null; taskType: string; status: string; priority?: string; title: string; description?: string | null; appointment?: AppointmentRow | null; targetStartIso?: string | null; targetEndIso?: string | null; timezoneName: string; taskPayload?: Record<string, unknown>; }) {
  const appointment = args.appointment || null;
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
      related_lead_id: appointment?.lead_id || null,
      related_conversation_id: appointment?.conversation_id || null,
      related_appointment_id: appointment?.id || null,
      customer_name: appointment?.customer_name || null,
      customer_phone: appointment?.customer_phone || null,
      target_date: isoDateToLocalDateForDb(args.targetStartIso, args.timezoneName),
      target_time: args.targetStartIso ? formatTimeOnlyInTimeZone(args.targetStartIso, args.timezoneName) : null,
      target_start_at: args.targetStartIso || null,
      target_end_at: args.targetEndIso || null,
      timezone_name: args.timezoneName,
      task_payload: args.taskPayload || {},
      last_action_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  const taskId = typeof data?.id === "string" ? data.id : null;
  return {
    ok: !error && Boolean(taskId),
    error: error?.message || (!taskId ? "TASK_INSERT_NOT_CONFIRMED" : null),
    taskId,
  };
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

function findSuggestedTimeApprovalTask(tasks: StoreAssistantOperationalTaskRow[]) {
  return (tasks || []).find((task) => {
    const payload = getOperationalTaskPayload(task);
    return task.task_type === "appointment_reschedule_with_customer" &&
      task.status === "waiting_customer_response" &&
      Boolean(payload.needs_responsible_approval) &&
      typeof payload.suggested_start_at === "string" &&
      typeof payload.suggested_end_at === "string" &&
      Boolean(task.related_appointment_id);
  }) || null;
}

async function checkSuggestedTimeApprovalAvailability(args: { supabase: any; organizationId: string; storeId: string; appointmentId: string; startIso: string; endIso: string; scheduleSettings?: StoreScheduleSettingsRow | null; timezoneName: string; }) {
  const operatingWindow = checkOperatingWindowForSuggestedTime({ settings: args.scheduleSettings || null, startIso: args.startIso, endIso: args.endIso, timezoneName: args.timezoneName });
  if (!operatingWindow.available) return { available: false, reason: operatingWindow.reason };

  const { data: blocks, error: blocksError } = await args.supabase
    .from("store_schedule_blocks")
    .select("id, title, start_at, end_at")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .lt("start_at", args.endIso)
    .gt("end_at", args.startIso)
    .limit(5);
  if (blocksError) return { available: false, reason: `Erro ao verificar bloqueios: ${blocksError.message}` };
  const blockRows = Array.isArray(blocks) ? blocks : [];
  if (blockRows.length > 0) return { available: false, reason: `Existe bloqueio de agenda nesse horário: ${(blockRows[0] as any)?.title || "bloqueio sem título"}` };

  const { data: appointments, error: appointmentsError } = await args.supabase
    .from("store_appointments")
    .select("id, title, customer_name, scheduled_start, scheduled_end, status")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .in("status", ["scheduled", "rescheduled"])
    .neq("id", args.appointmentId)
    .lt("scheduled_start", args.endIso)
    .gt("scheduled_end", args.startIso)
    .limit(5);
  if (appointmentsError) return { available: false, reason: `Erro ao verificar compromissos: ${appointmentsError.message}` };
  const appointmentRows = Array.isArray(appointments) ? appointments : [];
  if (appointmentRows.length > 0) {
    const first = appointmentRows[0] as any;
    return { available: false, reason: `Já existe compromisso nesse horário: ${first?.title || first?.customer_name || "compromisso sem título"}` };
  }
  return { available: true, reason: null as string | null };
}

function formatSuggestedDateTimeForResponsible(value: string, timezoneName: string) {
  return `${formatDateOnlyInTimeZone(value, timezoneName)} às ${formatTimeOnlyInTimeZone(value, timezoneName)}`;
}


function getScheduleLocalPartsFromIso(value: string, timezoneName: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeScheduleTimezone(timezoneName),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const values: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  const hour = values.hour === 24 ? 0 : values.hour || 0;
  return {
    year: values.year || date.getFullYear(),
    month: values.month || date.getMonth() + 1,
    day: values.day || date.getDate(),
    hour,
    minute: values.minute || 0,
  };
}

function parseScheduleHourMinute(value: string | null | undefined) {
  const match = String(value || "").trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function checkOperatingWindowForSuggestedTime(args: { settings?: StoreScheduleSettingsRow | null; startIso: string; endIso: string; timezoneName: string; }) {
  const startParts = getScheduleLocalPartsFromIso(args.startIso, args.timezoneName);
  const endParts = getScheduleLocalPartsFromIso(args.endIso, args.timezoneName);
  if (!startParts || !endParts) return { available: false, reason: "Não consegui interpretar o horário sugerido com segurança." };
  if (startParts.year !== endParts.year || startParts.month !== endParts.month || startParts.day !== endParts.day) {
    return { available: false, reason: "O horário sugerido atravessa mais de um dia. Preciso de um horário dentro de uma única janela de atendimento." };
  }

  const dayKey = getDayKeyFromDate(new Date(startParts.year, startParts.month - 1, startParts.day, 12, 0, 0, 0));
  const configuredDays = Array.isArray(args.settings?.operating_days) ? args.settings?.operating_days || [] : [];
  const normalizedDays = configuredDays.map((day) => normalizeText(day));
  if (normalizedDays.length > 0 && !normalizedDays.includes(normalizeText(dayKey))) {
    return { available: false, reason: `A loja não atende nesse dia da semana (${dayKey}).` };
  }

  const hours = args.settings?.operating_hours?.[dayKey];
  const openingMinutes = parseScheduleHourMinute(hours?.start);
  const closingMinutes = parseScheduleHourMinute(hours?.end);
  if (openingMinutes === null || closingMinutes === null) {
    return { available: false, reason: `Não encontrei uma janela de atendimento configurada para ${dayKey}.` };
  }

  const startMinutes = startParts.hour * 60 + startParts.minute;
  const endMinutes = endParts.hour * 60 + endParts.minute;
  if (startMinutes < openingMinutes || endMinutes > closingMinutes) {
    return { available: false, reason: `Esse compromisso está fora da janela operacional configurada da loja (${hours?.start} às ${hours?.end}).` };
  }

  return { available: true, reason: null as string | null };
}

function buildCustomerConfirmationTextForSuggestedTime(args: { appointment: AppointmentRow; suggestedStartIso: string; timezoneName: string; }) {
  const customerName = args.appointment.customer_name || "tudo bem";
  const appointmentTypeLabel = formatAppointmentType(args.appointment.appointment_type || "compromisso").toLowerCase();
  const suggestedDate = formatDateOnlyInTimeZone(args.suggestedStartIso, args.timezoneName);
  const suggestedTime = formatTimeOnlyInTimeZone(args.suggestedStartIso, args.timezoneName);
  return `Oi, ${customerName}. Confirmado então: sua ${appointmentTypeLabel} ficou para ${suggestedDate} às ${suggestedTime}. Qualquer coisa, é só me avisar.`;
}

async function resolveSuggestedTimeApprovalReply(args: { supabase: any; organizationId: string; storeId: string; threadId: string; assistantContextState?: StoreAssistantContextStateRow | null; openOperationalTasks: StoreAssistantOperationalTaskRow[]; lastHumanMessage: string; scheduleSettings?: StoreScheduleSettingsRow | null; }) {
  const task = findSuggestedTimeApprovalTask(args.openOperationalTasks || []);
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

  const availability = await checkSuggestedTimeApprovalAvailability({ supabase: args.supabase, organizationId: args.organizationId, storeId: args.storeId, appointmentId: appointment.id, startIso: suggestedStartIso, endIso: suggestedEndIso, scheduleSettings: args.scheduleSettings || null, timezoneName });
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

  const customerMessageResult = appointment.conversation_id
    ? await sendAiMessageToCustomerConversation({ supabase: args.supabase, conversationId: appointment.conversation_id, text: buildCustomerConfirmationTextForSuggestedTime({ appointment, suggestedStartIso, timezoneName }) })
    : null;
  if (!customerMessageResult?.ok) {
    await args.supabase.from("store_assistant_operational_tasks").update({
      status: "failed", error_text: customerMessageResult?.error || "Conversa do cliente não encontrada.",
      task_payload: { ...payload, last_responsible_reply: args.lastHumanMessage, responsible_approved_suggested_time: true, customer_confirmation_message_sent: false, appointment_update_attempted: true, appointment_update_succeeded: true, updated_appointment: updatedAppointment, last_execution_error: customerMessageResult?.error || "Conversa do cliente não encontrada.", updated_by_assistant_route_at: new Date().toISOString() },
      last_action_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", task.id).eq("organization_id", args.organizationId).eq("store_id", args.storeId);
    return `Atualizei a agenda para ${formatSuggestedDateTimeForResponsible(suggestedStartIso, timezoneName)}, mas não consegui avisar ${customerName}. ${customerMessageResult?.error ? `Erro: ${customerMessageResult.error}` : "Conversa do cliente não encontrada."}`;
  }

  const resolvedPayload = { ...payload, needs_responsible_approval: false, responsible_approved_suggested_time: true, responsible_approved_suggested_time_at: new Date().toISOString(), last_responsible_reply: args.lastHumanMessage, customer_confirmation_message_sent: true, customer_confirmation_message_id: customerMessageResult.messageId || null, appointment_update_attempted: true, appointment_update_succeeded: true, updated_appointment: updatedAppointment, updated_by_assistant_route_at: new Date().toISOString() };
  const { error: taskUpdateError } = await args.supabase.from("store_assistant_operational_tasks").update({
    status: "resolved", resolved_at: new Date().toISOString(), task_payload: resolvedPayload,
    last_action_at: new Date().toISOString(), description: "Responsável aprovou o horário sugerido pelo cliente. Cliente avisado e agenda atualizada.", updated_at: new Date().toISOString(),
  }).eq("id", task.id).eq("organization_id", args.organizationId).eq("store_id", args.storeId);
  if (taskUpdateError) return `Atualizei a agenda e avisei ${customerName}, mas não consegui finalizar a tarefa operacional: ${taskUpdateError.message}`;

  await resolveAssistantContextState({ supabase: args.supabase, organizationId: args.organizationId, storeId: args.storeId, threadId: args.threadId, currentContextState: args.assistantContextState || null, lastUserMessage: args.lastHumanMessage, lastAssistantMessage: `${customerName} confirmado em ${formatSuggestedDateTimeForResponsible(suggestedStartIso, timezoneName)}.` });
  return `Pronto. Confirmei com ${customerName} e atualizei ${appointment.title} para ${formatSuggestedDateTimeForResponsible(suggestedStartIso, timezoneName)}.`;
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

function resolveExplicitAppointmentItemIndex(text: string, totalItems: number) {
  const t = normalizeText(text);
  if (totalItems <= 0) return null;

  const plainNumberMatch = String(text || "").trim().match(/^\s*(\d{1,2})\s*[.)]?\s*$/);
  if (plainNumberMatch) {
    const numericIndex = Number(plainNumberMatch[1]);
    if (Number.isInteger(numericIndex) && numericIndex >= 1 && numericIndex <= totalItems) {
      return numericIndex - 1;
    }
  }

  const patterns = [
    /\b(?:item|opcao|opção|numero|número|n|compromisso|visita|agenda)\s*(?:de\s*)?(?:numero|número|n)?\s*(\d{1,2})\b/,
    /\b(?:item|opcao|opção|compromisso|visita)\s*#?\s*(\d{1,2})\b/,
    /\b(?:o|a)?\s*(\d{1,2})\s*(?:da lista|da opcao|da opção|da agenda)\b/,
  ];

  const ordinalMap: Record<string, number> = {
    primeiro: 1,
    primeira: 1,
    segundo: 2,
    segunda: 2,
    terceiro: 3,
    terceira: 3,
    quarto: 4,
    quarta: 4,
    quinto: 5,
    quinta: 5,
    sexto: 6,
    sexta: 6,
    setimo: 7,
    sétimo: 7,
    setima: 7,
    sétima: 7,
    oitavo: 8,
    oitava: 8,
    nono: 9,
    nona: 9,
    decimo: 10,
    décimo: 10,
    decima: 10,
    décima: 10,
  };

  for (const [word, number] of Object.entries(ordinalMap)) {
    if (t.includes(word) && number >= 1 && number <= totalItems) {
      return number - 1;
    }
  }

  for (const pattern of patterns) {
    const match = t.match(pattern);
    if (!match) continue;
    const numericIndex = Number(match[1]);
    if (Number.isInteger(numericIndex) && numericIndex >= 1 && numericIndex <= totalItems) {
      return numericIndex - 1;
    }
  }

  return null;
}

function resolveTargetAppointmentIndex(args: {
  text: string;
  openAppointments: AppointmentRow[];
  recentMessages?: AssistantMessageRow[];
  assistantContextState?: StoreAssistantContextStateRow | null;
  now?: Date;
  scheduleSettings?: StoreScheduleSettingsRow | null;
}) {
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

function resolveScheduleAction(text: string): ScheduleAction | null {
  const t = normalizeText(text);

  if (
    hasAnyTerm(t, [
      "agendar",
      "criar compromisso",
      "novo compromisso",
      "adicionar compromisso",
      "adiciona um compromisso",
      "adicione um compromisso",
      "marcar visita para",
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

function extractCustomerNameFromText(text: string): string | null {
  const patterns = [
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

function parseDateReferenceFromText(text: string, now: Date) {
  return parseScheduleDateFromText(text, now);
}

function normalizeScheduleTimeText(hourText: string, minuteText?: string | null) {
  const hour = Number(hourText);
  const minute = minuteText ? Number(minuteText) : 0;
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null;
  return `${padTwoDigits(hour)}:${padTwoDigits(minute)}`;
}

function parseTimeRangeFromText(text: string) {
  const rangeMatch = text.match(/\b(?:das?|de|do)?\s*(\d{1,2})(?::(\d{2}))?\s*h?\s*(?:ate|até|as|às|a|-)\s*(?:as?\s*)?(\d{1,2})(?::(\d{2}))?\s*h?\b/i);
  if (rangeMatch) {
    const startTime = normalizeScheduleTimeText(rangeMatch[1], rangeMatch[2]);
    const endTime = normalizeScheduleTimeText(rangeMatch[3], rangeMatch[4]);
    if (startTime && endTime) return { startTime, endTime };
  }

  const singleMatch = text.match(/\b(?:as|às|para|pra)?\s*(\d{1,2})(?::(\d{2}))?\s*h\b/i) ||
    text.match(/\b(?:as|às|para|pra)\s+(\d{1,2})(?::(\d{2}))?\b/i) ||
    text.match(/\b(\d{1,2}:\d{2})\b/);
  if (singleMatch) {
    if (singleMatch[1]?.includes(":")) {
      const [hour, minute] = singleMatch[1].split(":");
      const startTime = normalizeScheduleTimeText(hour, minute);
      if (startTime) return { startTime, endTime: null as string | null };
    }
    const startTime = normalizeScheduleTimeText(singleMatch[1], singleMatch[2]);
    if (startTime) return { startTime, endTime: null as string | null };
  }

  return null;
}

function buildIsoFromDateAndTime(
  dateParts: { day: number; month: number; year: number },
  time: string,
  settings?: StoreScheduleSettingsRow | null
) {
  const [hour, minute] = time.split(":").map(Number);
  return localScheduleDateTimeToUtcIso({
    dateParts,
    hour: Number.isFinite(hour) ? hour : 0,
    minute: Number.isFinite(minute) ? minute : 0,
    timeZone: getScheduleTimezone(settings || null),
  });
}

function addMinutesToIso(iso: string, minutes: number) {
  const date = new Date(iso);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

function getScheduleParsingNow(settings?: StoreScheduleSettingsRow | null) {
  const timeZone = safeScheduleTimezone(getScheduleTimezone(settings || null));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const values: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = Number(part.value);
    }
  }

  return new Date(
    values.year || new Date().getFullYear(),
    (values.month || 1) - 1,
    values.day || 1,
    values.hour === 24 ? 0 : values.hour || 0,
    values.minute || 0,
    values.second || 0,
    0
  );
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
  if (appointment.conversation_id) {
    const customerMessage = buildCustomerAvailabilityQuestion({
      appointment,
      scheduleSettings: args.scheduleSettings || null,
    });
    const sendResult = await sendAiMessageToCustomerConversation({
      supabase: args.supabase,
      conversationId: appointment.conversation_id,
      text: customerMessage,
    });
    customerMessageSent = sendResult.ok;
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

function extractReschedulePayload(text: string, now: Date, settings?: StoreScheduleSettingsRow | null) {
  const targetText = getRescheduleTargetTextSegment(text);
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
  };
}


function parseDbDateKeyToScheduleParts(dateKey: string | null | undefined) {
  const raw = String(dateKey || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return { year, month, day };
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

function isRescheduleChoiceWithDateTime(text: string) {
  const normalized = normalizeText(text);
  const hasRescheduleCue = hasAnyTerm(normalized, [
    "remarcar",
    "remarca",
    "remarque",
    "reagendar",
    "reagenda",
    "reagende",
    "mudar horario",
    "mudar horário",
    "trocar horario",
    "trocar horário",
    "melhor remarcar",
    "melhor reagendar",
  ]);

  if (!hasRescheduleCue) return false;

  const hasDateCue =
    /\b\d{1,2}\s*\/\s*\d{1,2}(?:\s*\/\s*\d{2,4})?\b/.test(text) ||
    /\b(?:hoje|amanha|amanhã|depois de amanha|depois de amanhã|segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo)\b/i.test(text) ||
    /\b(?:dia|data)\s+\d{1,2}\b/i.test(text);
  const hasTimeCue =
    /\b\d{1,2}(?::\d{2})?\s*h\b/i.test(text) ||
    /\b(?:as|às)\s+\d{1,2}(?::\d{2})?\b/i.test(text) ||
    /\b\d{1,2}:\d{2}\b/.test(text);

  return hasDateCue && hasTimeCue;
}

async function resolveRescheduleChoiceWithTargetFromContext(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  threadId?: string | null;
  assistantContextState?: StoreAssistantContextStateRow | null;
  lastHumanMessage: string;
  openAppointments: AppointmentRow[];
  scheduleSettings?: StoreScheduleSettingsRow | null;
}) {
  const contextState = args.assistantContextState || null;
  const contextTopic = normalizeText(contextState?.active_topic || "");
  const contextIntent = normalizeText(contextState?.active_intent || "");
  const contextStatus = normalizeText(contextState?.active_status || "");
  const appointmentId = String(contextState?.active_appointment_id || "").trim();

  const isRelevantContext =
    Boolean(appointmentId) &&
    (
      (contextTopic === "appointment_management" && ["cancel", "reschedule"].includes(contextIntent) && ["waiting_user_choice", "active"].includes(contextStatus)) ||
      (contextTopic === "appointment_reschedule" && contextIntent === "reschedule" && ["active", "waiting_user_choice"].includes(contextStatus))
    );

  if (!isRelevantContext) return null;
  if (!isRescheduleChoiceWithDateTime(args.lastHumanMessage)) return null;

  const now = getScheduleParsingNow(args.scheduleSettings || null);
  const scheduleTimezone = getScheduleTimezone(args.scheduleSettings || null);
  const reschedulePayload = extractContextAwareReschedulePayload({
    text: args.lastHumanMessage,
    now,
    settings: args.scheduleSettings || null,
    contextState,
  });

  if (!reschedulePayload.ok) return null;

  let appointment = (args.openAppointments || []).find((item) => item.id === appointmentId) || null;
  if (!appointment) {
    const { data, error } = await args.supabase
      .from("store_appointments")
      .select("id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id")
      .eq("id", appointmentId)
      .eq("organization_id", args.organizationId)
      .eq("store_id", args.storeId)
      .maybeSingle();

    if (error || !data?.id) {
      return "Entendi que você quer remarcar, mas não consegui encontrar o compromisso ativo com segurança. A agenda não foi alterada.";
    }
    appointment = data as AppointmentRow;
  }

  const targetStartIso = reschedulePayload.payload.scheduled_start;
  const targetEndIso = reschedulePayload.payload.scheduled_end;
  const availability = await checkSuggestedTimeApprovalAvailability({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    appointmentId: appointment.id,
    startIso: targetStartIso,
    endIso: targetEndIso,
    scheduleSettings: args.scheduleSettings || null,
    timezoneName: scheduleTimezone,
  });

  if (!availability.available) {
    if (args.threadId) {
      await upsertAssistantContextState({
        supabase: args.supabase,
        organizationId: args.organizationId,
        storeId: args.storeId,
        threadId: args.threadId,
        currentContextState: contextState,
        patch: {
          active_topic: "appointment_reschedule",
          active_intent: "reschedule",
          active_status: "active",
          active_customer_name: appointment.customer_name || null,
          active_customer_phone: appointment.customer_phone || null,
          active_lead_id: appointment.lead_id || null,
          active_conversation_id: appointment.conversation_id || null,
          active_appointment_id: appointment.id,
          target_date: isoDateToLocalDateForDb(targetStartIso, scheduleTimezone),
          target_time: formatTimeOnlyInTimeZone(targetStartIso, scheduleTimezone),
          target_start_at: targetStartIso,
          target_end_at: targetEndIso,
          timezone_name: scheduleTimezone,
          candidate_options: [],
          context_payload: {
            reason: "reschedule_choice_target_unavailable",
            availability_reason: availability.reason,
            agenda_updated: false,
          },
          last_user_message: args.lastHumanMessage,
          last_assistant_message: `Verifiquei ${formatDateOnlyInTimeZone(targetStartIso, scheduleTimezone)} às ${formatTimeOnlyInTimeZone(targetStartIso, scheduleTimezone)}, mas esse horário não está livre.`,
        },
      });
    }

    return `Entendi que você prefere remarcar ${buildScheduleAppointmentReferenceLabel(appointment)} de ${appointment.customer_name || "cliente não identificado"} para ${formatDateOnlyInTimeZone(targetStartIso, scheduleTimezone)} às ${formatTimeOnlyInTimeZone(targetStartIso, scheduleTimezone)}, mas esse horário não está livre: ${availability.reason || "encontrei conflito"}. A agenda não foi alterada.`;
  }

  let customerMessageSent = false;
  if (appointment.conversation_id) {
    const customerMessage = buildCustomerRescheduleMessage({
      appointment,
      proposedStartIso: targetStartIso,
      scheduleSettings: args.scheduleSettings || null,
    });
    const sendResult = await sendAiMessageToCustomerConversation({
      supabase: args.supabase,
      conversationId: appointment.conversation_id,
      text: customerMessage,
    });
    customerMessageSent = sendResult.ok;
  }

  if (!args.threadId) {
    return "Encontrei o compromisso e o horário sugerido, mas não consegui registrar a tratativa porque a conversa da assistente não foi identificada. A agenda ainda não foi alterada.";
  }

  const taskResult = await createAssistantOperationalTask({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    threadId: args.threadId,
    taskType: "appointment_reschedule_with_customer",
    status: customerMessageSent ? "waiting_customer_response" : "open",
    priority: "normal",
    title: `Remarcação de ${buildScheduleAppointmentReferenceLabel(appointment)}${appointment.customer_name ? ` - ${appointment.customer_name}` : ""}`,
    description: customerMessageSent
      ? "A assistente iniciou contato com o cliente para confirmar o novo horário. A agenda ainda não foi alterada."
      : "A assistente identificou a remarcação, mas não conseguiu iniciar contato automático com o cliente.",
    appointment,
    targetStartIso,
    targetEndIso,
    timezoneName: scheduleTimezone,
    taskPayload: {
      customer_message_sent: customerMessageSent,
      source: "assistant.reply.route",
      original_user_message: args.lastHumanMessage,
      source_context_id: contextState?.id || null,
      source_context_reason: "cancel_prompt_reschedule_choice_with_target",
    },
  });

  await upsertAssistantContextState({
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
      target_date: isoDateToLocalDateForDb(targetStartIso, scheduleTimezone),
      target_time: formatTimeOnlyInTimeZone(targetStartIso, scheduleTimezone),
      target_start_at: targetStartIso,
      target_end_at: targetEndIso,
      timezone_name: scheduleTimezone,
      candidate_options: [],
      context_payload: {
        customer_message_sent: customerMessageSent,
        agenda_updated: false,
        reason: "waiting_customer_confirmation_before_reschedule",
        task_created: taskResult.ok,
        task_id: taskResult.taskId,
        source_context_reason: "cancel_prompt_reschedule_choice_with_target",
      },
      last_user_message: args.lastHumanMessage,
      last_assistant_message: buildResponsibleRescheduleContactReply({
        appointment,
        targetStartIso,
        customerMessageSent,
        scheduleSettings: args.scheduleSettings || null,
      }),
    },
  });

  if (!taskResult.ok) {
    return `Encontrei o compromisso e o horário sugerido, mas não consegui registrar a tratativa operacional: ${taskResult.error}. A agenda ainda não foi alterada.`;
  }

  return buildResponsibleRescheduleContactReply({
    appointment,
    targetStartIso,
    customerMessageSent,
    scheduleSettings: args.scheduleSettings || null,
  });
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

async function resolveAppointmentActionReply(args: {
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
    if (contextAction && contextTopic === "appointment_management" && contextStatus === "waiting_user_choice") {
      action = contextAction;
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
            active_topic: "appointment_management",
            active_intent: action,
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
            timezone_name: scheduleTimezone,
            candidate_options: candidateOptions,
            context_payload: { reason: "explicit_title_ambiguity", action, explicit_title: explicitAppointmentTitleCandidate },
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

    const insertBody = {
      organization_id: args.organizationId,
      store_id: args.storeId,
      title: createPayload.payload.title,
      appointment_type: createPayload.payload.appointment_type,
      status: "scheduled",
      scheduled_start: createPayload.payload.scheduled_start,
      scheduled_end: createPayload.payload.scheduled_end,
      customer_name: createPayload.payload.customer_name,
      customer_phone: createPayload.payload.customer_phone,
      address_text: createPayload.payload.address_text,
      notes: "Criado pela assistente operacional.",
    };

    const { error } = await args.supabase
      .from("store_appointments")
      .insert(insertBody);

    if (error) {
      return `Tentei criar o compromisso, mas encontrei um erro: ${error.message}`;
    }

    return buildAppointmentActionSuccessReply({
      action,
      scheduleSettings: args.scheduleSettings || null,
      createdPayload: {
        title: createPayload.payload.title,
        appointment_type: createPayload.payload.appointment_type,
        customer_name: createPayload.payload.customer_name,
        scheduled_start: createPayload.payload.scheduled_start,
      },
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
        "Ainda estamos falando dos compromissos que listei antes, mas não consegui ligar sua última mensagem a um item específico.",
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

  if (action === "reschedule") {
    const reschedulePayload = extractContextAwareReschedulePayload({
      text: args.lastHumanMessage,
      now,
      settings: args.scheduleSettings || null,
      contextState: args.assistantContextState || null,
    });
    if (!reschedulePayload.ok) {
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
            target_date: args.assistantContextState?.target_date || null,
            target_time: args.assistantContextState?.target_time || null,
            target_start_at: args.assistantContextState?.target_start_at || null,
            target_end_at: args.assistantContextState?.target_end_at || null,
            timezone_name: scheduleTimezone,
            candidate_options: [],
            context_payload: { reason: "selected_appointment_waiting_for_reschedule_time", selected_appointment_title: selectedAppointment.title || null, target_preserved_from_context: Boolean(args.assistantContextState?.target_date || args.assistantContextState?.target_time) },
            last_user_message: args.lastHumanMessage,
          },
        });
      }

      if (asksAssistantToFindCustomerAvailability(args.lastHumanMessage)) {
        let customerMessageSent = false;

        if (selectedAppointment.conversation_id) {
          const customerMessage = buildCustomerAvailabilityQuestion({
            appointment: selectedAppointment,
            scheduleSettings: args.scheduleSettings || null,
          });
          const sendResult = await sendAiMessageToCustomerConversation({
            supabase: args.supabase,
            conversationId: selectedAppointment.conversation_id,
            text: customerMessage,
          });
          customerMessageSent = sendResult.ok;
        }

        let taskResult = { ok: true, error: null as string | null };
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

      return `${reschedulePayload.message}

Eu já deixei este compromisso como assunto ativo: ${buildScheduleAppointmentReferenceLabel(selectedAppointment)}${selectedAppointment.customer_name ? ` de ${selectedAppointment.customer_name}` : ""}.`;
    }

    if (shouldCoordinateRescheduleWithCustomer(args.lastHumanMessage, selectedAppointment)) {
      let customerMessageSent = false;

      if (selectedAppointment.conversation_id) {
        const customerMessage = buildCustomerRescheduleMessage({
          appointment: selectedAppointment,
          proposedStartIso: reschedulePayload.payload.scheduled_start,
          scheduleSettings: args.scheduleSettings || null,
        });
        const sendResult = await sendAiMessageToCustomerConversation({
          supabase: args.supabase,
          conversationId: selectedAppointment.conversation_id,
          text: customerMessage,
        });

        customerMessageSent = sendResult.ok;
      }

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
      .select("id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id")
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

function buildStoreBlock(onboardingMap: Record<string, string>, store: StoreRow) {
  const entries: Array<[string, string | null | undefined]> = [
    ["nome da loja", onboardingMap.store_display_name || store.name],
    ["descrição", onboardingMap.store_description],
    ["serviços", onboardingMap.store_services],
    ["cidade", onboardingMap.city],
    ["estado", onboardingMap.state],
    ["regiões", onboardingMap.service_regions],
    ["oferece instalação", onboardingMap.offers_installation],
    ["oferece visita técnica", onboardingMap.offers_technical_visit],
    ["regras de visita técnica", onboardingMap.technical_visit_rules],
    ["regras selecionadas de visita técnica", onboardingMap.technical_visit_rules_selected],
    ["processo de instalação", onboardingMap.installation_process],
    ["pagamentos aceitos", onboardingMap.accepted_payment_methods],
    ["limitações importantes", onboardingMap.important_limitations],
    ["nome do responsável", onboardingMap.responsible_name],
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
  "- Se envolver cliente: resposta ideal é 'Vou alinhar com o cliente antes de alterar a agenda. Assim que ele confirmar, eu atualizo e te aviso.'",
  "",
  "4) AGENDA: CANCELAR COMPROMISSO",
  "- Pedido: 'cancele', 'cancelar visita', 'cliente cancelou', 'não vai mais'.",
  "- Se o responsável afirma que o cliente cancelou: pode cancelar direto se o item estiver claro.",
  "- Se não está claro qual item: liste opções reais e peça escolha objetiva.",
  "- Se cancelar no banco: confirme 'Pronto. Cancelei...' com cliente, tipo e data.",
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
  "- Remarcação com cliente: 'Vou alinhar com o cliente antes de alterar a agenda. Assim que ele confirmar, eu atualizo e te aviso.'",
  "- Sem canal do cliente: 'Encontrei o compromisso, mas não achei conversa vinculada para falar automaticamente com o cliente. A agenda ainda não foi alterada.'",
  "- Ação executada: 'Pronto. Ajustei/cancelei/marquei como concluído...'",
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
  onboardingMap: Record<string, string>;
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
  const storeName = args.onboardingMap.store_display_name || args.store.name || "a loja";
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
    "",
    "COMPORTAMENTO PROFISSIONAL DA ASSISTENTE",
    "- pense como uma assistente operacional da loja: entenda o objetivo, organize as opções e indique o próximo passo útil",
    "- quando o pedido estiver ambíguo, não responda genérico; mostre as opções reais encontradas e peça a escolha pelo número, cliente, título ou horário",
    "- quando houver uma ação sensível de agenda envolvendo cliente, explique que vai alinhar com o cliente antes de alterar a agenda",
    "- quando houver uma ação normal já executada com sucesso, confirme de forma direta: Pronto, ajustei / criei / cancelei / marquei",
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
    buildStoreBlock(args.onboardingMap, args.store),
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
        "id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id"
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

    const { data: nextAppointmentsData, error: nextAppointmentsError } = await supabase
      .from("store_appointments")
      .select(
        "id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id"
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
        "id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id"
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
          "id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id"
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
        "id, organization_id, store_id, thread_id, task_type, status, priority, title, description, related_lead_id, related_conversation_id, related_appointment_id, customer_name, customer_phone, target_date, target_time, target_start_at, target_end_at, timezone_name, task_payload, last_action_at, resolved_at, cancelled_at, error_text, created_at, updated_at"
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
    const generalTodayOverviewMode = isGeneralTodayOverviewRequest(lastHumanMessage);
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

    const suggestedTimeApprovalReply = await resolveSuggestedTimeApprovalReply({
      supabase,
      organizationId,
      storeId,
      threadId: assistantThreadId,
      assistantContextState,
      openOperationalTasks,
      lastHumanMessage,
      scheduleSettings,
    });

    const pendingCancellationTargetReply = !suggestedTimeApprovalReply
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

    const blockAdjustmentReply = !suggestedTimeApprovalReply && !pendingCancellationTargetReply && !appointmentManagementRequest
      ? await resolveScheduleBlockAdjustmentReply({
          supabase,
          organizationId,
          storeId,
          lastHumanMessage,
          recentMessages,
          scheduleSettings,
        })
      : null;

    const blockDayReply = !suggestedTimeApprovalReply && !pendingCancellationTargetReply && !appointmentManagementRequest && !blockAdjustmentReply
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

    const postAppointmentActionReply = !suggestedTimeApprovalReply && !pendingCancellationTargetReply && !blockAdjustmentReply && !blockDayReply && postAppointmentMode && !appointmentManagementRequest
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

    const rescheduleChoiceWithTargetReply = !suggestedTimeApprovalReply && !pendingCancellationTargetReply && !blockAdjustmentReply && !blockDayReply && !postAppointmentActionReply
      ? await resolveRescheduleChoiceWithTargetFromContext({
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

    const customerAvailabilityContextReply = !suggestedTimeApprovalReply && !pendingCancellationTargetReply && !rescheduleChoiceWithTargetReply && !blockAdjustmentReply && !blockDayReply && !postAppointmentActionReply
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

    const scheduleActionReply = !suggestedTimeApprovalReply && !pendingCancellationTargetReply && !rescheduleChoiceWithTargetReply && !blockAdjustmentReply && !blockDayReply && !customerAvailabilityContextReply && (!postAppointmentMode || appointmentManagementRequest)
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
        })
      : null;

    const systemPrompt = buildSystemPrompt({
      store,
      onboardingMap,
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

    if (suggestedTimeApprovalReply) {
      aiText = suggestedTimeApprovalReply;
    } else if (pendingCancellationTargetReply) {
      aiText = pendingCancellationTargetReply;
    } else if (blockAdjustmentReply) {
      aiText = blockAdjustmentReply;
    } else if (blockDayReply) {
      aiText = blockDayReply;
    } else if (postAppointmentActionReply) {
      aiText = postAppointmentActionReply;
    } else if (customerAvailabilityContextReply) {
      aiText = customerAvailabilityContextReply;
    } else if (scheduleActionReply) {
      aiText = scheduleActionReply;
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
      const response = await openai.responses.create({
        model,
        input,
        max_output_tokens: asksAboutMaterialsOrDocuments(lastHumanMessage) ? 140 : 240,
      });

      aiText = cleanupAiText(String(response.output_text || "").trim(), {
        genericMaterialMode: asksAboutMaterialsOrDocuments(lastHumanMessage) || nextVisitMode,
        morningReportMode,
        eveningReportMode,
      });
    }

    if (!aiText) {
      return {
        ok: false,
        error: "EMPTY_AI_RESPONSE",
        message: "A OpenAI não retornou texto utilizável.",
      };
    }

    const isContextMessage =
      asksAboutToday(lastHumanMessage) ||
      postAppointmentMode ||
      scheduleManagementMode ||
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
        pendingCancellationTargetMode: Boolean(pendingCancellationTargetReply),
        blockAdjustmentMode: Boolean(blockAdjustmentReply),
        blockDayMode: Boolean(blockDayReply),
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


function parseScheduleDateFromText(text: string, now: Date) {
  const normalized = normalizeText(text);

  const numeric = normalized.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (numeric) {
    let year = numeric[3] ? Number(numeric[3]) : now.getFullYear();
    if (year < 100) year += 2000;
    return {
      day: Number(numeric[1]),
      month: Number(numeric[2]) - 1,
      year,
    };
  }

  const monthMap: Record<string, number> = {
    janeiro: 0,
    fevereiro: 1,
    marco: 2,
    "março": 2,
    abril: 3,
    maio: 4,
    junho: 5,
    julho: 6,
    agosto: 7,
    setembro: 8,
    outubro: 9,
    novembro: 10,
    dezembro: 11,
  };

  const written = normalized.match(
    /\b(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+(\d{4}))?\b/
  );
  if (written) {
    let year = written[3] ? Number(written[3]) : now.getFullYear();
    const month = monthMap[written[2]];
    const day = Number(written[1]);
    let candidate = new Date(year, month, day);
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    if (!written[3] && candidate.getTime() < today.getTime()) {
      year += 1;
      candidate = new Date(year, month, day);
    }
    return { day, month, year };
  }

  const bareDay = normalized.match(/\bdia\s+(\d{1,2})(?!\d)/);
  if (bareDay) {
    const day = Number(bareDay[1]);
    let month = now.getMonth();
    let year = now.getFullYear();
    let candidate = new Date(year, month, day);
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    if (candidate.getTime() < today.getTime()) {
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
      candidate = new Date(year, month, day);
    }
    return { day: candidate.getDate(), month: candidate.getMonth(), year: candidate.getFullYear() };
  }

  const base = new Date(now);
  base.setHours(0, 0, 0, 0);

  if (normalized.includes("amanha") || normalized.includes("amanhã")) {
    base.setDate(base.getDate() + 1);
    return { day: base.getDate(), month: base.getMonth(), year: base.getFullYear() };
  }

  if (normalized.includes("hoje")) {
    return { day: base.getDate(), month: base.getMonth(), year: base.getFullYear() };
  }

  return null;
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

    lines.push("Assim que as respostas chegarem, eu atualizo a agenda e te aviso por aqui.");
    return lines.join("\n").trim();
  }

  return alreadyBlocked || createdBlockId
    ? `Certo. Bloqueei ${blockLabel} para não entrar nenhum compromisso novo.`
    : `Ainda não consegui bloquear ${blockLabel}.`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      organizationId?: string;
      storeId?: string;
    };

    const result = await generateAssistantReply({
      organizationId: String(body.organizationId || ""),
      storeId: String(body.storeId || ""),
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
}
