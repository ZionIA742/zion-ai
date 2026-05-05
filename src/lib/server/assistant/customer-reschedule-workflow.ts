import type {
  AppointmentRow,
  AssistantMessageRow,
  CustomerRescheduleWorkflowResult,
  StoreAssistantContextStateRow,
  StoreScheduleSettingsRow,
} from "./types";
import {
  addMinutesToIso,
  buildIsoFromDateAndTime,
  formatDateOnlyInTimeZone,
  formatDatePartsForHuman,
  formatTimeOnlyInTimeZone,
  getScheduleTimezone,
  hasAmbiguousBareDayDateReference,
  isoDateToLocalDateForDb,
  parseCompleteScheduleDateFromText,
  parseDbDateKeyToScheduleParts,
  parseTimeRangeFromText,
} from "./datetime";

function normalizeWorkflowText(value: string | null | undefined): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function readAssistantContextPayload(contextState?: StoreAssistantContextStateRow | null) {
  const raw = contextState?.context_payload;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

type TargetAppointmentResolution =
  | { type: "unique"; index: number }
  | { type: "ambiguous"; candidateIndexes: number[] }
  | { type: "none" };

export type CustomerRescheduleWorkflowDeps = {
  sendAiMessageToCustomerConversation: (args: {
    supabase: any;
    conversationId: string;
    text: string;
  }) => Promise<{ ok: true; messageId: string | null } | { ok: false; error: string }>;
  createAssistantOperationalTask: (args: {
    supabase: any;
    organizationId: string;
    storeId: string;
    threadId: string | null;
    taskType: string;
    status: string;
    priority?: string;
    title: string;
    description?: string | null;
    appointment?: AppointmentRow | null;
    targetStartIso?: string | null;
    targetEndIso?: string | null;
    timezoneName: string;
    taskPayload?: Record<string, unknown>;
  }) => Promise<{ ok: true; taskId: string | null } | { ok: false; error: string }>;
  upsertAssistantContextState: (args: {
    supabase: any;
    organizationId: string;
    storeId: string;
    threadId: string;
    currentContextState?: StoreAssistantContextStateRow | null;
    patch: Record<string, unknown>;
  }) => Promise<unknown>;
  resolveScheduleAction: (text: string) => string | null;
  sortOpenScheduleAppointments: (items: AppointmentRow[]) => AppointmentRow[];
  resolveTargetAppointmentIndex: (args: {
    text: string;
    openAppointments: AppointmentRow[];
    recentMessages?: AssistantMessageRow[];
    assistantContextState?: StoreAssistantContextStateRow | null;
    now?: Date;
    scheduleSettings?: StoreScheduleSettingsRow | null;
  }) => TargetAppointmentResolution;
  buildAppointmentAmbiguityReply: (args: {
    candidateIndexes: number[];
    openAppointments: AppointmentRow[];
    scheduleSettings?: StoreScheduleSettingsRow | null;
  }) => string;
  formatAppointmentType: (value: string | null) => string;
  buildScheduleAppointmentReferenceLabel: (appointment?: AppointmentRow) => string;
  buildCustomerRescheduleMessage: (args: {
    appointment: AppointmentRow;
    proposedStartIso?: string | null;
    scheduleSettings?: StoreScheduleSettingsRow | null;
  }) => string;
};

export async function resolveCustomerRescheduleWorkflow(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  threadId?: string | null;
  lastHumanMessage: string;
  assistantContextState?: StoreAssistantContextStateRow | null;
  openAppointments: AppointmentRow[];
  scheduleSettings?: StoreScheduleSettingsRow | null;
  recentMessages: AssistantMessageRow[];
  now: Date;
  deps: CustomerRescheduleWorkflowDeps;
}): Promise<CustomerRescheduleWorkflowResult> {
  const deps = args.deps;
  const contextState = args.assistantContextState || null;
  const contextPayload = readAssistantContextPayload(contextState);
  const contextTopic = normalizeWorkflowText(contextState?.active_topic || "");
  const contextIntent = normalizeWorkflowText(contextState?.active_intent || "");
  const contextStatus = normalizeWorkflowText(contextState?.active_status || "");
  const action = deps.resolveScheduleAction(args.lastHumanMessage);
  const currentTimeRange = parseTimeRangeFromText(args.lastHumanMessage);

  if (contextTopic === "appointment_reschedule" && contextStatus === "waiting_customer_response") {
    return { type: "not_applicable" };
  }

  const hasRescheduleSignal =
    action === "reschedule" ||
    contextTopic === "appointment_reschedule" ||
    contextIntent === "reschedule" ||
    Boolean((contextPayload.requested_date || contextState?.target_date) && currentTimeRange?.startTime);

  if (!hasRescheduleSignal) return { type: "not_applicable" };

  const openAppointments = deps.sortOpenScheduleAppointments(args.openAppointments || []);
  if (!openAppointments.length) {
    return { type: "needs_target", reply: "NÃ£o encontrei compromisso em aberto para remarcar agora. Me diga o cliente, o tÃ­tulo ou a data do compromisso." };
  }

  const targetResolution = deps.resolveTargetAppointmentIndex({
    text: args.lastHumanMessage,
    openAppointments,
    recentMessages: args.recentMessages || [],
    assistantContextState: contextState,
    now: args.now,
    scheduleSettings: args.scheduleSettings || null,
  });

  if (targetResolution.type === "ambiguous") {
    if (contextTopic !== "appointment_reschedule" && contextIntent !== "reschedule") {
      return { type: "not_applicable" };
    }
    return {
      type: "needs_target",
      reply: deps.buildAppointmentAmbiguityReply({
        candidateIndexes: targetResolution.candidateIndexes,
        openAppointments,
        scheduleSettings: args.scheduleSettings || null,
      }),
    };
  }

  if (targetResolution.type === "none") {
    if (contextTopic === "appointment_reschedule" || contextIntent === "reschedule") {
      return { type: "needs_target", reply: "Entendi a remarcaÃ§Ã£o, mas nÃ£o consegui identificar com seguranÃ§a qual compromisso Ã©. Me diga o cliente ou escolha um item da lista." };
    }
    return { type: "not_applicable" };
  }

  const selectedAppointment = openAppointments[Math.min(Math.max(targetResolution.index, 0), openAppointments.length - 1)];
  if (!selectedAppointment?.id) {
    return { type: "needs_target", reply: "Entendi a remarcaÃ§Ã£o, mas nÃ£o consegui confirmar o compromisso alvo. Me diga o cliente ou escolha um item da lista." };
  }

  if (hasAmbiguousBareDayDateReference(args.lastHumanMessage)) {
    const bareDay = String(args.lastHumanMessage).match(/\b(?:dia|data)\s+(\d{1,2})\b/i)?.[1] || "";
    const timeLabel = currentTimeRange?.startTime ? " o horÃ¡rio" : "";
    return {
      type: "needs_date",
      reply: `Entendi${timeLabel}, mas preciso confirmar a data antes de falar com ${selectedAppointment.customer_name || "o cliente"}. Quando vocÃª diz dia ${bareDay}, Ã© dia de qual mÃªs?`,
    };
  }

  const explicitDateParts = parseCompleteScheduleDateFromText(args.lastHumanMessage, args.now);
  const dateParts =
    explicitDateParts ||
    parseDbDateKeyToScheduleParts(String(contextPayload.requested_date || contextState?.target_date || "")) ||
    (contextState?.target_start_at
      ? parseDbDateKeyToScheduleParts(isoDateToLocalDateForDb(contextState.target_start_at, getScheduleTimezone(args.scheduleSettings || null)))
      : null);

  if (!dateParts) {
    const targetLabel = selectedAppointment.customer_name
      ? `a ${deps.formatAppointmentType(selectedAppointment.appointment_type)} de ${selectedAppointment.customer_name}`
      : deps.buildScheduleAppointmentReferenceLabel(selectedAppointment);
    return { type: "needs_date", reply: `Certo, Ã© ${targetLabel}. Para qual data vocÃª quer tentar remarcar?` };
  }

  const contextTime = typeof contextState?.target_time === "string" ? contextState.target_time.slice(0, 5) : null;
  const startTime = currentTimeRange?.startTime || (!explicitDateParts ? contextTime : null);
  const endTime = currentTimeRange?.endTime || null;

  if (!startTime) {
    const targetLabel = selectedAppointment.customer_name
      ? `a ${deps.formatAppointmentType(selectedAppointment.appointment_type)} de ${selectedAppointment.customer_name}`
      : deps.buildScheduleAppointmentReferenceLabel(selectedAppointment);
    return { type: "needs_time", reply: `Certo, Ã© ${targetLabel}. Para qual horÃ¡rio do dia ${formatDatePartsForHuman(dateParts)} vocÃª quer tentar remarcar?` };
  }

  const scheduleTimezone = getScheduleTimezone(args.scheduleSettings || null);
  const targetStartIso = buildIsoFromDateAndTime(dateParts, startTime, args.scheduleSettings || null);
  const targetEndIso = endTime
    ? buildIsoFromDateAndTime(dateParts, endTime, args.scheduleSettings || null)
    : addMinutesToIso(targetStartIso, 60);
  const appointmentTypeLabel = deps.formatAppointmentType(selectedAppointment.appointment_type);
  const customerName = selectedAppointment.customer_name || "cliente";
  const targetDateLabel = formatDateOnlyInTimeZone(targetStartIso, scheduleTimezone);
  const targetTimeLabel = formatTimeOnlyInTimeZone(targetStartIso, scheduleTimezone);

  if (!selectedAppointment.conversation_id) {
    return {
      type: "missing_conversation",
      reply: `Encontrei a ${appointmentTypeLabel} de ${customerName}, mas nÃ£o achei uma conversa vinculada para enviar mensagem automaticamente. A agenda nÃ£o foi alterada.`,
    };
  }

  const customerMessage = deps.buildCustomerRescheduleMessage({
    appointment: selectedAppointment,
    proposedStartIso: targetStartIso,
    scheduleSettings: args.scheduleSettings || null,
  });
  const sendResult = await deps.sendAiMessageToCustomerConversation({
    supabase: args.supabase,
    conversationId: selectedAppointment.conversation_id,
    text: customerMessage,
  });

  if (!sendResult.ok) {
    return {
      type: "send_failed",
      error: sendResult.error,
      reply: `Encontrei a ${appointmentTypeLabel} de ${customerName} e o horÃ¡rio ${targetDateLabel} Ã s ${targetTimeLabel}, mas nÃ£o consegui enviar a mensagem para ela agora. A agenda nÃ£o foi alterada.`,
    };
  }

  const taskResult = await deps.createAssistantOperationalTask({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    threadId: args.threadId || null,
    taskType: "appointment_reschedule_with_customer",
    status: "waiting_customer_response",
    priority: "normal",
    title: `RemarcaÃ§Ã£o de ${deps.buildScheduleAppointmentReferenceLabel(selectedAppointment)}${selectedAppointment.customer_name ? ` - ${selectedAppointment.customer_name}` : ""}`,
    description: "A assistente jÃ¡ iniciou contato com o cliente. A agenda ainda nÃ£o foi alterada.",
    appointment: selectedAppointment,
    targetStartIso,
    targetEndIso,
    timezoneName: scheduleTimezone,
    taskPayload: { customer_message_sent: true, customer_message_id: sendResult.messageId, source: "assistant.reply.route", original_user_message: args.lastHumanMessage },
  });

  if (!taskResult.ok) {
    return {
      type: "send_failed",
      error: taskResult.error || undefined,
      reply: `Enviei a mensagem para ${customerName}, mas nÃ£o consegui registrar a tratativa interna corretamente: ${taskResult.error}. A agenda nÃ£o foi alterada.`,
    };
  }

  if (args.threadId) {
    await deps.upsertAssistantContextState({
      supabase: args.supabase,
      organizationId: args.organizationId,
      storeId: args.storeId,
      threadId: args.threadId,
      currentContextState: contextState,
      patch: {
        active_topic: "appointment_reschedule",
        active_intent: "reschedule",
        active_status: "waiting_customer_response",
        active_customer_name: selectedAppointment.customer_name || null,
        active_customer_phone: selectedAppointment.customer_phone || null,
        active_lead_id: selectedAppointment.lead_id || null,
        active_conversation_id: selectedAppointment.conversation_id || null,
        active_appointment_id: selectedAppointment.id,
        target_date: isoDateToLocalDateForDb(targetStartIso, scheduleTimezone),
        target_time: formatTimeOnlyInTimeZone(targetStartIso, scheduleTimezone),
        target_start_at: targetStartIso,
        target_end_at: targetEndIso,
        timezone_name: scheduleTimezone,
        candidate_options: [],
        context_payload: { customer_message_sent: true, customer_message_id: sendResult.messageId, task_id: taskResult.taskId, agenda_updated: false, reason: "waiting_customer_confirmation_before_reschedule" },
        last_user_message: args.lastHumanMessage,
      },
    });
  }

  return {
    type: "message_sent",
    messageId: sendResult.messageId,
    taskId: taskResult.taskId,
    reply: `Certo. Enviei uma mensagem para ${customerName} propondo remarcar a ${appointmentTypeLabel} para ${targetDateLabel} Ã s ${targetTimeLabel}. A agenda ainda nÃ£o foi alterada; assim que ela responder, eu te aviso por aqui.`,
  };
}
