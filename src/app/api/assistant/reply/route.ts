
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

  if (normalized === "prompt_sent") return "aguardando confirmação pós-compromisso";
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
    asksAboutMaterialsOrDocuments(content)
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

function asksAboutPostAppointment(text: string) {
  const t = normalizeText(text);

  if (asksForMorningReport(t) || asksForEveningReport(t) || asksAboutNextVisit(t)) {
    return false;
  }

  return hasAnyTerm(t, [
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
  ]);
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
  | "general";

function resolveAssistantIntent(text: string): AssistantIntent {
  if (asksForMorningReport(text)) return "morning_report";
  if (asksForEveningReport(text)) return "evening_report";
  if (asksAboutNextVisit(text)) return "next_visit";
  if (asksAboutPostAppointment(text)) return "post_appointment";
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
    return "- nenhum pós-compromisso pendente";
  }

  return items.map((item) => buildFollowupLine(item, appointmentMap)).join("\n");
}

function buildResolvedPostAppointmentBlock(
  items: PostAppointmentFollowupRow[],
  appointmentMap: Map<string, AppointmentRow>
) {
  if (!items.length) {
    return "- nenhum pós-compromisso resolvido recentemente";
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
    `- pós-compromissos pendentes: ${data.pendingPostCount}`,
    `- pendências internas da assistente: ${data.notificationCount}`,
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
    `- pós-compromissos ainda pendentes: ${data.pendingPostCount}`,
    `- pendências internas da assistente: ${data.notificationCount}`,
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
  lines.push(`- pós-compromissos pendentes: ${data.pendingPostCount}`);
  lines.push(`- pendências internas: ${data.notificationCount}`);

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
  lines.push(`- pós-compromissos pendentes: ${data.pendingPostCount}`);
  lines.push(`- pendências internas: ${data.notificationCount}`);

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
    "- materiais, documentos e checklist específicos só podem ser tratados como confirmados se estiverem descritos no sistema; sem isso, considere apenas uma revisão rápida do básico antes de sair."
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
    const aUpdated = a.updated_at ? new Date(a.updated_at).getTime() : 0;
    const bUpdated = b.updated_at ? new Date(b.updated_at).getTime() : 0;
    if (aUpdated !== bUpdated) return bUpdated - aUpdated;

    const aScheduled = a.scheduled_end ? new Date(a.scheduled_end).getTime() : 0;
    const bScheduled = b.scheduled_end ? new Date(b.scheduled_end).getTime() : 0;
    return bScheduled - aScheduled;
  });
}

function buildFriendlyPostFollowupObservation(note?: string | null) {
  const normalized = normalizeText(note);
  if (!normalized) return null;

  if (normalized.includes("apos a conclusao ainda falta retorno")) {
    return "esse atendimento foi concluído, mas ainda falta retorno com o cliente.";
  }

  if (normalized.includes("fechamento do atendimento")) {
    return "esse atendimento já foi encerrado por completo.";
  }

  const cleaned = (note || "")
    .replace(/\[[^\]]+\]\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || null;
}

function buildDeterministicPostAppointmentReply(args: {
  pendingPostFollowups: PostAppointmentFollowupRow[];
  recentResolvedPostFollowups: PostAppointmentFollowupRow[];
  appointmentMap: Map<string, AppointmentRow>;
}) {
  const openItems = sortOpenPostFollowups(
    (args.pendingPostFollowups || []).filter((item) => isOpenPostFollowup(item))
  );

  if (!openItems.length) {
    return "Não há retorno pendente no momento.";
  }

  const current = openItems[0];
  const appointment = args.appointmentMap.get(current.appointment_id);
  const lines: string[] = [];

  lines.push(
    openItems.length === 1
      ? "Sim, ainda falta 1 retorno desse atendimento."
      : `Sim, ainda faltam ${openItems.length} retornos de atendimento.`
  );

  if (appointment) {
    const timeLabel = appointment.scheduled_end || appointment.scheduled_start || current.scheduled_end;
    const appointmentTypeLabel = formatAppointmentType(appointment.appointment_type);
    lines.push(
      `- mais urgente agora: ${appointmentTypeLabel}${appointment.title ? ` "${appointment.title}"` : ""} em ${formatDateOnly(
        timeLabel
      )} às ${formatTimeOnly(timeLabel)}`
    );

    if (appointment.customer_name) {
      lines.push(`- cliente: ${appointment.customer_name}`);
    }

    if (appointment.customer_phone) {
      lines.push(`- contato: ${appointment.customer_phone}`);
    }
  } else if (current.scheduled_end) {
    lines.push(`- o retorno pendente está ligado a um atendimento encerrado em ${formatDateTime(current.scheduled_end)}`);
  } else {
    lines.push("- existe um retorno pendente ligado a um atendimento sem detalhes completos no sistema.");
  }

  const friendlyObservation = buildFriendlyPostFollowupObservation(current.notes);
  if (friendlyObservation) {
    lines.push(`- observação: ${friendlyObservation}`);
  }

  if (openItems.length > 1) {
    lines.push(`- além disso, existem mais ${openItems.length - 1} retorno(s) pendente(s).`);
  }

  const lastResolved = (args.recentResolvedPostFollowups || []).find(
    (item) => !isOpenPostFollowup(item) && item.resolved_at
  );
  if (lastResolved) {
    const resolvedAppointment = args.appointmentMap.get(lastResolved.appointment_id);
    if (resolvedAppointment?.title) {
      lines.push(`- último atendimento resolvido: ${resolvedAppointment.title}.`);
    }
  }

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
    `- pedido ligado a pós-compromisso, retorno ou acompanhamento: ${postAppointmentRequest ? "sim" : "não"}`,
    `- pedido de relatório da manhã: ${morningReportRequest ? "sim" : "não"}`,
    `- pedido de relatório do fim do dia: ${eveningReportRequest ? "sim" : "não"}`,
    `- pedido ligado à próxima visita ou ao que levar: ${nextVisitRequest ? "sim" : "não"}`,
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
    "- usar também a base de pós-compromisso quando ela existir",
    "- gerar relatório da manhã e relatório do fim do dia quando isso for pedido",
    "- ser honesta sobre o que sabe e o que não sabe",
    "",
    "REGRAS FIXAS",
    "- nunca invente fatos operacionais",
    "- nunca prometa ação automática que não existe",
    "- nunca diga que organizou, confirmou, enviou, separou ou preparou algo se isso não aconteceu de verdade",
    "- se algo não estiver confirmado no sistema, deixe isso explícito",
    "- quando houver pós-compromisso pendente, isso deve entrar como pendência operacional real",
    "- se a pergunta for sobre materiais, documentos ou checklist e não houver base oficial da loja, trate como sugestão genérica curta",
    "- não entregue textão quando bastar uma resposta curta",
    "- quando estiver em terreno genérico, use no máximo 3 a 5 itens",
    "- prefira respostas curtas e úteis",
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
    "COMO RESPONDER SOBRE PÓS-COMPROMISSO",
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
    "- se houver pós-compromisso pendente, isso deve entrar",
    "- mantenha curto, organizado e acionável",
    "",
    "COMO RESPONDER RELATÓRIO DO FIM DO DIA",
    "- quando pedirem relatório do fim do dia, faça um fechamento operacional",
    "- diga o que estava previsto para hoje",
    "- diga o que foi concluído, cancelado e o que ainda está em aberto",
    "- traga pendências que devem entrar no radar de amanhã",
    "- se houver pós-compromisso pendente, isso deve entrar",
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
    "PÓS-COMPROMISSO PENDENTE",
    buildPendingPostAppointmentBlock(args.pendingPostFollowups, args.appointmentMap),
    "",
    "PÓS-COMPROMISSO RESOLVIDO RECENTEMENTE",
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

    const detectedIntent = latestRequest.detectedIntent;
    const morningReportMode = detectedIntent === "morning_report";
    const eveningReportMode = detectedIntent === "evening_report";
    const nextVisitMode = detectedIntent === "next_visit";
    const postAppointmentMode = detectedIntent === "post_appointment";

    let aiText = "";

    if (morningReportMode) {
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