
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

function asksAboutScheduleManagement(text: string) {
  const t = normalizeText(text);

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
    .filter((message) => isLikelyResponsibleMessage(message))
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

  args.candidateIndexes.slice(0, 5).forEach((candidateIndex, visibleIndex) => {
    const item = args.openItems[candidateIndex];
    const appointment = args.appointmentMap.get(item.appointment_id);
    const itemNumber = visibleIndex + 1;
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

  lines.push('Você pode responder, por exemplo: "quero atualizar o item 1".');
  return lines.join("\n").trim();
}

function resolveTargetPostAppointmentIndex(args: {
  text: string;
  openItems: PostAppointmentFollowupRow[];
  appointmentMap: Map<string, AppointmentRow>;
  recentMessages?: AssistantMessageRow[];
}) {
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
  lastHumanMessage: string;
  recentMessages: AssistantMessageRow[];
  pendingPostFollowups: PostAppointmentFollowupRow[];
  appointmentMap: Map<string, AppointmentRow>;
  openAppointments: AppointmentRow[];
}) {
  const action = resolvePostAppointmentAction(args.lastHumanMessage);
  if (!action) {
    return null;
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

function resolveAppointmentCandidateIndexesFromText(args: {
  text: string;
  openAppointments: AppointmentRow[];
}) {
  const normalizedText = normalizeText(args.text);
  const digitText = normalizeDigits(args.text);

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
      customerName &&
      customerName.length >= 3 &&
      (
        normalizedText.includes(`sobre o cliente ${customerName}`) ||
        normalizedText.includes(`sobre o ${customerName}`) ||
        normalizedText.includes(`do cliente ${customerName}`) ||
        normalizedText.includes(`do ${customerName}`) ||
        normalizedText.includes(`esse do ${customerName}`) ||
        normalizedText.includes(`a instalacao do ${customerName}`) ||
        normalizedText.includes(`a instalação do ${customerName}`) ||
        normalizedText.includes(`a visita do ${customerName}`) ||
        normalizedText.includes(`visita tecnica do ${customerName}`) ||
        normalizedText.includes(`visita técnica do ${customerName}`) ||
        normalizedText.includes(`manutencao ${customerName}`) ||
        normalizedText.includes(`manutenção ${customerName}`)
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

function inferPreviousAppointmentTarget(args: {
  messages: AssistantMessageRow[];
  currentHumanMessage: string;
  openAppointments: AppointmentRow[];
}) {
  const ordered = [...args.messages]
    .filter((message) => getMessageContent(message).length > 0)
    .filter((message) => isLikelyResponsibleMessage(message))
    .map((message) => getMessageContent(message))
    .filter((content) => content !== args.currentHumanMessage);

  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const content = ordered[index];
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
}) {
  const lines: string[] = [];
  lines.push("Encontrei mais de um compromisso em aberto para esse pedido.");
  lines.push("Me diga qual deles você quer atualizar:");
  lines.push("");

  args.candidateIndexes.slice(0, 5).forEach((candidateIndex, visibleIndex) => {
    const appointment = args.openAppointments[candidateIndex];
    const itemNumber = visibleIndex + 1;
    const referenceLabel = buildScheduleAppointmentReferenceLabel(appointment);
    const customer = appointment?.customer_name || "cliente não identificado";
    const timeLabel = appointment?.scheduled_end || appointment?.scheduled_start;

    lines.push(`${itemNumber}. ${referenceLabel.charAt(0).toUpperCase() + referenceLabel.slice(1)}`);
    lines.push(`- cliente: ${customer}`);
    if (timeLabel) {
      lines.push(`- horário: ${formatDateOnly(timeLabel)} às ${formatTimeOnly(timeLabel)}`);
    }
    lines.push(`- situação atual: ${formatScheduleAppointmentCurrentSituation(appointment)}`);
    lines.push("");
  });

  lines.push('Você pode responder, por exemplo: "quero atualizar o item 1".');
  return lines.join("\n").trim();
}

function resolveTargetAppointmentIndex(args: {
  text: string;
  openAppointments: AppointmentRow[];
  recentMessages?: AssistantMessageRow[];
}) {
  const explicitIndex = resolvePostAppointmentDetailIndex(args.text, args.openAppointments.length);
  if (explicitIndex !== null) {
    return { type: "unique" as const, index: explicitIndex };
  }

  const currentCandidates = resolveAppointmentCandidateIndexesFromText({
    text: args.text,
    openAppointments: args.openAppointments,
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
  const t = normalizeText(text);
  const explicit = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);

  if (explicit) {
    let day = Number(explicit[1]);
    let month = Number(explicit[2]) - 1;
    let year = explicit[3] ? Number(explicit[3]) : now.getFullYear();
    if (year < 100) year += 2000;
    return { day, month, year };
  }

  const base = new Date(now);
  base.setHours(0, 0, 0, 0);

  if (t.includes("amanha") || t.includes("amanhã")) {
    base.setDate(base.getDate() + 1);
    return { day: base.getDate(), month: base.getMonth(), year: base.getFullYear() };
  }

  if (t.includes("hoje")) {
    return { day: base.getDate(), month: base.getMonth(), year: base.getFullYear() };
  }

  return null;
}

function parseTimeRangeFromText(text: string) {
  const rangeMatch = text.match(/\b(\d{1,2}:\d{2})\s*(?:ate|até|a|-)\s*(\d{1,2}:\d{2})\b/i);
  if (rangeMatch) {
    return { startTime: rangeMatch[1], endTime: rangeMatch[2] };
  }

  const singleMatch = text.match(/\b(\d{1,2}:\d{2})\b/);
  if (singleMatch) {
    return { startTime: singleMatch[1], endTime: null as string | null };
  }

  return null;
}

function buildIsoFromDateAndTime(dateParts: { day: number; month: number; year: number }, time: string) {
  const [hour, minute] = time.split(":").map(Number);
  const date = new Date(dateParts.year, dateParts.month, dateParts.day, hour || 0, minute || 0, 0, 0);
  return date.toISOString();
}

function addMinutesToIso(iso: string, minutes: number) {
  const date = new Date(iso);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

function extractCreateAppointmentPayload(text: string, now: Date) {
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

  const scheduledStart = buildIsoFromDateAndTime(dateParts, timeRange.startTime);
  const scheduledEnd = timeRange.endTime
    ? buildIsoFromDateAndTime(dateParts, timeRange.endTime)
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

function extractReschedulePayload(text: string, now: Date) {
  const dateParts = parseDateReferenceFromText(text, now);
  const timeRange = parseTimeRangeFromText(text);

  if (!dateParts || !timeRange?.startTime) {
    return {
      ok: false as const,
      message: "Para remarcar, me diga a nova data e a nova hora. Exemplo: remarca para 25/04 às 15:00.",
    };
  }

  const scheduledStart = buildIsoFromDateAndTime(dateParts, timeRange.startTime);
  const scheduledEnd = timeRange.endTime
    ? buildIsoFromDateAndTime(dateParts, timeRange.endTime)
    : addMinutesToIso(scheduledStart, 60);

  return {
    ok: true as const,
    payload: {
      scheduled_start: scheduledStart,
      scheduled_end: scheduledEnd,
    },
  };
}

function buildAppointmentActionSuccessReply(args: {
  action: ScheduleAction;
  appointment?: AppointmentRow;
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
    return `Certo. Agendei ${createdReference} para ${createdCustomer} em ${formatDateOnly(args.createdPayload?.scheduled_start || null)} às ${formatTimeOnly(args.createdPayload?.scheduled_start || null)}.`;
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

  return `Certo. Remarquei ${referenceLabel} de ${customerName} para ${formatDateOnly(args.appointment?.scheduled_start || args.appointment?.scheduled_end || null)} às ${formatTimeOnly(args.appointment?.scheduled_start || args.appointment?.scheduled_end || null)}.`;
}

async function resolveAppointmentActionReply(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  lastHumanMessage: string;
  recentMessages: AssistantMessageRow[];
  openAppointments: AppointmentRow[];
}) {
  const action = resolveScheduleAction(args.lastHumanMessage);
  if (!action) {
    return null;
  }

  const now = new Date();
  const openAppointments = sortOpenScheduleAppointments(args.openAppointments || []);

  if (action === "create") {
    const createPayload = extractCreateAppointmentPayload(args.lastHumanMessage, now);
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
      createdPayload: {
        title: createPayload.payload.title,
        appointment_type: createPayload.payload.appointment_type,
        customer_name: createPayload.payload.customer_name,
        scheduled_start: createPayload.payload.scheduled_start,
      },
    });
  }

  if (!openAppointments.length) {
    return "Hoje eu não encontrei compromisso em aberto para atualizar.";
  }

  const targetResolution = resolveTargetAppointmentIndex({
    text: args.lastHumanMessage,
    openAppointments,
    recentMessages: args.recentMessages,
  });

  if (targetResolution.type === "ambiguous") {
    return buildAppointmentAmbiguityReply({
      candidateIndexes: targetResolution.candidateIndexes,
      openAppointments,
    });
  }

  if (targetResolution.type === "none") {
    return "Não consegui identificar qual compromisso você quer atualizar. Me diga o cliente, o título ou o número da lista.";
  }

  const selectedIndex = Math.min(Math.max(targetResolution.index, 0), openAppointments.length - 1);
  const selectedAppointment = openAppointments[selectedIndex];

  if (action === "reschedule") {
    const reschedulePayload = extractReschedulePayload(args.lastHumanMessage, now);
    if (!reschedulePayload.ok) {
      return reschedulePayload.message;
    }

    const { error } = await args.supabase
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
      .eq("store_id", args.storeId);

    if (error) {
      return `Tentei remarcar, mas encontrei um erro: ${error.message}`;
    }

    const updatedAppointment = {
      ...selectedAppointment,
      status: "rescheduled",
      scheduled_start: reschedulePayload.payload.scheduled_start,
      scheduled_end: reschedulePayload.payload.scheduled_end,
    };

    return buildAppointmentActionSuccessReply({
      action,
      appointment: updatedAppointment,
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

    return buildAppointmentActionSuccessReply({
      action,
      appointment: selectedAppointment,
    });
  }

  if (action === "needs_followup") {
    return buildAppointmentActionSuccessReply({
      action,
      appointment: selectedAppointment,
    });
  }

  if (action === "cancel") {
    const { error: cancelError } = await args.supabase.rpc("cancel_store_appointment", {
      p_appointment_id: selectedAppointment.id,
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_cancel_reason: "Cancelado pelo responsável na assistente operacional.",
    });

    if (cancelError) {
      return `Tentei marcar como cancelado, mas encontrei um erro: ${cancelError.message}`;
    }

    return buildAppointmentActionSuccessReply({
      action,
      appointment: selectedAppointment,
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
      ? `horário ${formatDateOnly(appointment.scheduled_end || appointment.scheduled_start)} às ${formatTimeOnly(appointment.scheduled_end || appointment.scheduled_start)}`
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

    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const { data: todayAppointmentsData, error: todayAppointmentsError } = await supabase
      .from("store_appointments")
      .select(
        "id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id"
      )
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .gte("scheduled_start", startOfDay.toISOString())
      .lte("scheduled_start", endOfDay.toISOString())
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

    const detectedIntent = latestRequest.detectedIntent;
    const morningReportMode = detectedIntent === "morning_report";
    const eveningReportMode = detectedIntent === "evening_report";
    const nextVisitMode = detectedIntent === "next_visit";
    const postAppointmentMode = detectedIntent === "post_appointment";
    const scheduleManagementMode = detectedIntent === "schedule_management";
    const allOpenAppointments = [
      ...((todayAppointmentsData || []) as AppointmentRow[]),
      ...((nextAppointmentsData || []) as AppointmentRow[]),
      ...((overdueAppointmentsData || []) as AppointmentRow[]),
    ];

    const postAppointmentActionReply = postAppointmentMode
      ? await resolvePostAppointmentActionReply({
          supabase,
          organizationId,
          storeId,
          lastHumanMessage,
          recentMessages,
          pendingPostFollowups: (pendingPostFollowupsData || []) as PostAppointmentFollowupRow[],
          appointmentMap,
          openAppointments: allOpenAppointments,
        })
      : null;

    const scheduleActionReply = !postAppointmentMode
      ? await resolveAppointmentActionReply({
          supabase,
          organizationId,
          storeId,
          lastHumanMessage,
          recentMessages,
          openAppointments: allOpenAppointments,
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

    if (postAppointmentActionReply) {
      aiText = postAppointmentActionReply;
    } else if (scheduleActionReply) {
      aiText = scheduleActionReply;
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

function asksToBlockStoreDay(text: string) {
  const t = normalizeText(text);

  const blockCue =
    t.includes("nao vou abrir") ||
    t.includes("não vou abrir") ||
    t.includes("nao marque nada") ||
    t.includes("não marque nada") ||
    t.includes("bloqueia o dia") ||
    t.includes("bloqueie o dia") ||
    t.includes("bloquear o dia") ||
    t.includes("bloquear dia") ||
    t.includes("quero que voce bloqueie") ||
    t.includes("quero que você bloqueie") ||
    t.includes("fecha a loja") ||
    t.includes("fechar a loja") ||
    t.includes("vou fechar a loja") ||
    t.includes("loja fechada") ||
    t.includes("nao vou atender") ||
    t.includes("não vou atender") ||
    t.includes("nao vou trabalhar") ||
    t.includes("não vou trabalhar");

  const hasDateCue =
    t.includes("amanha") ||
    t.includes("amanhã") ||
    t.includes("hoje") ||
    /\b\d{1,2}\/\d{1,2}/.test(t) ||
    /\b\d{1,2}\s+de\s+/.test(t) ||
    /\bdia\s+\d{1,2}\b/.test(t);

  const hasTimeCue =
    /\bate\s+as?\s+\d{1,2}/.test(t) ||
    /\baté\s+as?\s+\d{1,2}/.test(t) ||
    /\bdas\s+\d{1,2}/.test(t) ||
    /\ba partir das?\s+\d{1,2}/.test(t);

  return blockCue && (hasDateCue || hasTimeCue);
}

function isSimplePositiveConfirmation(text: string) {
  const t = normalizeText(text);
  return ["sim", "ok", "pode", "pode sim", "pode fazer", "segue", "faz isso", "confirmo", "confirmado"].includes(t);
}

function isBlockDayFollowupInstruction(text: string) {
  const t = normalizeText(text);
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
  const localDate = new Date(dateParts.year, dateParts.month, dateParts.day, 12, 0, 0, 0);
  const dayKey = getDayKeyFromDate(localDate);
  const hours = settings?.operating_hours?.[dayKey];
  const startText = hours?.start || "00:00";
  const endText = hours?.end || "23:59";

  const startDate = new Date(
    dateParts.year,
    dateParts.month,
    dateParts.day,
    Number(startText.split(":")[0] || 0),
    Number(startText.split(":")[1] || 0),
    0,
    0
  );
  const endDate = new Date(
    dateParts.year,
    dateParts.month,
    dateParts.day,
    Number(endText.split(":")[0] || 23),
    Number(endText.split(":")[1] || 59),
    0,
    0
  );

  return {
    startIso: startDate.toISOString(),
    endIso: endDate.toISOString(),
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
  const baseRange = buildBlockDayRange(dateParts, settings);

  const dayStart = new Date(baseRange.startIso);
  const dayEnd = new Date(baseRange.endIso);

  const between = normalized.match(/\bdas?\s+(\d{1,2})(?::(\d{2}))?\s*(?:h)?\s*(?:as|às)\s+(\d{1,2})(?::(\d{2}))?\s*(?:h)?\b/);
  if (between) {
    const startHour = Number(between[1]);
    const startMinute = between[2] ? Number(between[2]) : 0;
    const endHour = Number(between[3]);
    const endMinute = between[4] ? Number(between[4]) : 0;
    const start = new Date(dateParts.year, dateParts.month, dateParts.day, startHour, startMinute, 0, 0);
    const end = new Date(dateParts.year, dateParts.month, dateParts.day, endHour, endMinute, 0, 0);
    return {
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      label: `das ${formatTimeOnly(start.toISOString())} às ${formatTimeOnly(end.toISOString())}`,
      partial: true,
    };
  }

  const until = normalized.match(/\b(?:ate|até)\s+as?\s+(\d{1,2})(?::(\d{2}))?\s*(?:h)?\b/);
  if (until) {
    const endHour = Number(until[1]);
    const endMinute = until[2] ? Number(until[2]) : 0;
    const end = new Date(dateParts.year, dateParts.month, dateParts.day, endHour, endMinute, 0, 0);
    return {
      startIso: dayStart.toISOString(),
      endIso: end.toISOString(),
      label: `até ${formatTimeOnly(end.toISOString())}`,
      partial: true,
    };
  }

  const from = normalized.match(/\ba\s+partir\s+das?\s+(\d{1,2})(?::(\d{2}))?\s*(?:h)?\b/);
  if (from) {
    const startHour = Number(from[1]);
    const startMinute = from[2] ? Number(from[2]) : 0;
    const start = new Date(dateParts.year, dateParts.month, dateParts.day, startHour, startMinute, 0, 0);
    return {
      startIso: start.toISOString(),
      endIso: dayEnd.toISOString(),
      label: `a partir de ${formatTimeOnly(start.toISOString())}`,
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

function buildBlockRangeNaturalLabel(startIso: string, endIso: string, partial: boolean, partialLabel?: string | null) {
  if (partial) {
    if (partialLabel) {
      return `${formatDateOnly(startIso)} ${partialLabel}`;
    }
    return `${formatDateOnly(startIso)} das ${formatTimeOnly(startIso)} às ${formatTimeOnly(endIso)}`;
  }
  return formatDateOnly(startIso);
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

  const dateParts = parseScheduleDateFromText(sourceMessage, new Date());
  if (!dateParts) {
    return "Para eu bloquear esse período, me diga a data com clareza. Exemplo: dia 21/04 eu não vou abrir a loja.";
  }

  const parsedRange = parseBlockTimeWindow(sourceMessage, dateParts, args.scheduleSettings || null);
  const { startIso, endIso, partial, label: partialLabel } = parsedRange;

  const blockStartMs = new Date(startIso).getTime();
  const blockEndMs = new Date(endIso).getTime();

  if (!Number.isFinite(blockStartMs) || !Number.isFinite(blockEndMs) || blockEndMs <= blockStartMs) {
    return "Eu não consegui entender corretamente o período desse bloqueio. Me fala de novo o dia e o horário.";
  }

  const blockLabel = buildBlockRangeNaturalLabel(startIso, endIso, partial, partialLabel);

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
        p_title: partial
          ? `Loja fechada em ${formatDateOnly(startIso)} (${partialLabel || `${formatTimeOnly(startIso)}-${formatTimeOnly(endIso)}`})`
          : `Loja fechada em ${formatDateOnly(startIso)}`,
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

    const row = Array.isArray(data) ? data[0] : data;
    createdBlockId = row?.id || null;

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
