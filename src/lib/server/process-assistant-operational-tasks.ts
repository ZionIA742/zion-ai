import { createClient } from "@supabase/supabase-js";
import { projectTechnicalVisitStageBySystem } from "../commercial-opportunity-visit-stage-projection";

type QueueRow = {
  id: string;
  organization_id: string;
  store_id: string;
  task_id: string;
  conversation_id: string;
  message_id: string;
  status: string;
  attempts: number | null;
  locked_at?: string | null;
  payload: Record<string, any> | null;
};

const MAX_SAFE_QUEUE_ATTEMPTS = 3;
const QUEUE_RETRY_DELAY_MS = 60_000;
const QUEUE_STALE_LOCK_MS = 15 * 60_000;

type OrganizationSubscriptionRow = {
  id: string;
  organization_id: string;
  status: string | null;
};

type OperationalTaskRow = {
  id: string;
  organization_id: string;
  store_id: string;
  thread_id: string | null;
  task_type: string;
  status: string;
  title: string;
  description: string | null;
  related_lead_id: string | null;
  related_conversation_id: string | null;
  related_appointment_id: string | null;
  commercial_opportunity_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  target_date: string | null;
  target_time: string | null;
  target_start_at: string | null;
  target_end_at: string | null;
  timezone_name: string | null;
  task_payload: Record<string, any> | null;
};

type AppointmentRow = {
  id: string;
  organization_id: string;
  store_id: string;
  lead_id: string | null;
  conversation_id: string | null;
  commercial_opportunity_id: string | null;
  title: string;
  appointment_type: string;
  status: string;
  scheduled_start: string;
  scheduled_end: string;
  customer_name: string | null;
  customer_phone: string | null;
  address_text: string | null;
  notes: string | null;
};

type StoreScheduleSettingsRow = {
  operating_days: string[] | null;
  operating_hours: Record<string, { start?: string; end?: string }> | null;
  timezone_name: string | null;
};

type CustomerReplyDecision =
  | { type: "confirmed"; reason: string }
  | { type: "rejected"; reason: string }
  | { type: "suggested_other_time"; reason: string; rawText: string }
  | { type: "ambiguous"; reason: string };

export type ProcessAssistantOperationalTasksParams = {
  organizationId?: string;
  storeId?: string;
  limit?: number;
  workerName?: string;
};

export type ProcessAssistantOperationalTasksResult = {
  ok: true;
  processed: number;
  failed: number;
  total: number;
  results: Array<{
    queueId: string;
    ok: boolean;
    result?: any;
    error?: string;
    skipped?: boolean;
    reason?: string;
  }>;
};

export type RouteIncomingCustomerReplyToOperationalTaskResult =
  | {
      handled: false;
      reason: "no_matching_operational_task";
    }
  | {
      handled: true;
      taskId: string;
      queueId: string;
      ok: boolean;
      skipped?: boolean;
      reason?: string;
      result?: any;
      error?: string;
    };

async function loadCanonicalOrganizationSubscription(
  supabase: any,
  organizationId: string,
) {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("id, organization_id, status")
    .eq("organization_id", organizationId)
    .limit(2);

  if (error) {
    throw new Error(`Falha ao carregar subscription canonica: ${error.message}`);
  }

  const rows = (data ?? []) as OrganizationSubscriptionRow[];

  if (rows.length !== 1) {
    return null;
  }

  return rows[0];
}

function normalizeText(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function classifyCustomerReply(content: string): CustomerReplyDecision {
  const text = normalizeText(content);

  const hasRejection =
    /(?:^|\s)(nao|não|nao posso|não posso|nao consigo|não consigo|nesse horario nao|nesse horário não|outro dia|outro horario|outro horário|melhor nao|melhor não)(?:\s|$|[.!?,])/i.test(
      text
    );

  const hasConfirmation =
    /(?:^|\s)(sim|confirmado|confirmo|fechado|combinado|ok|blz|beleza|esta bom|ta bom|serve|da certo|dá certo|pode marcar|marca|marcar nesse horario|esse horario serve)(?:\s|$|[.!?,])/i.test(
      text
    ) || /(?:^|\s)pode ser(?:\s|$|[.!?,])/i.test(text)
    || /(?:^|\s)(claro|pode remarcar|podemos remarcar)(?:\s|$|[.!?,])/i.test(text);

  const hasPossibleAlternativeTime = hasCustomerSuggestedExplicitDateOrTime(content);

  if (hasRejection) {
    return { type: "rejected", reason: "customer_rejected_target_time" };
  }

  if (hasPossibleAlternativeTime && /(?:pode ser|seria|prefiro|melhor|às|as|a partir|depois|antes|dia)/i.test(text)) {
    return {
      type: "suggested_other_time",
      reason: "customer_suggested_possible_alternative_time",
      rawText: content,
    };
  }

  if (hasConfirmation) {
    return { type: "confirmed", reason: "customer_confirmed_target_time" };
  }

  return { type: "ambiguous", reason: "customer_reply_not_clear_enough" };
}

function formatLocalDateTime(value: string | null | undefined, timezoneName = "America/Sao_Paulo") {
  if (!value) return "horário não definido";

  try {
    const date = new Date(value);
    const formatted = new Intl.DateTimeFormat("pt-BR", {
      timeZone: timezoneName || "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);

    return formatted.replace(",", " às");
  } catch {
    return value;
  }
}

type LocalDateTimeParts = {
  day: number;
  month: number;
  year: number;
  hour: number;
  minute: number;
};

type CustomerSuggestedDateTimeParts = {
  day: number | null;
  month: number | null;
  year: number | null;
  hour: number;
  minute: number;
  hasExplicitDate: boolean;
};

function getLocalDateTimeParts(
  value: string | null | undefined,
  timezoneName = "America/Sao_Paulo"
): LocalDateTimeParts | null {
  if (!value) return null;

  try {
    const parts = new Intl.DateTimeFormat("pt-BR", {
      timeZone: timezoneName || "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(value));

    const read = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value || "0");

    return {
      day: read("day"),
      month: read("month"),
      year: read("year"),
      hour: read("hour"),
      minute: read("minute"),
    };
  } catch {
    return null;
  }
}

function hasCustomerSuggestedExplicitDateOrTime(content: string) {
  const text = normalizeText(content);

  return (
    /(?:^|\s)dia\s+\d{1,2}(?:\s|$|[.!?,])/i.test(text) ||
    /(?:^|\s)\d{1,2}\s*[\/\-]\s*\d{1,2}(?:\s*[\/\-]\s*\d{2,4})?(?:\s|$|[.!?,])/i.test(text) ||
    /(?:^|\s)(?:as|a|para|pra|por volta de|depois das|antes das)\s+\d{1,2}(?:\s*[:h]\s*\d{1,2})?\s*h?(?:\s|$|[.!?,])/i.test(text) ||
    /(?:^|\s)\d{1,2}\s*h\s*\d{0,2}(?:\s|$|[.!?,])/i.test(text)
  );
}

function extractCustomerSuggestedDateTimeParts(
  content: string,
  target: LocalDateTimeParts
): CustomerSuggestedDateTimeParts | null {
  const text = normalizeText(content);

  const explicitDateMatch = text.match(
    /(?:^|\s)(\d{1,2})\s*[\/\-]\s*(\d{1,2})(?:\s*[\/\-]\s*(\d{2,4}))?(?:\s|$|[.!?,])/i
  );
  const dayOnlyMatch = text.match(/(?:^|\s)dia\s+(\d{1,2})(?:\s|$|[.!?,])/i);

  let day: number | null = null;
  let month: number | null = null;
  let year: number | null = null;

  if (explicitDateMatch) {
    day = Number(explicitDateMatch[1]);
    month = Number(explicitDateMatch[2]);
    year = explicitDateMatch[3] ? Number(explicitDateMatch[3]) : target.year;
    if (year < 100) year += 2000;
  } else if (dayOnlyMatch) {
    day = Number(dayOnlyMatch[1]);
    month = target.month;
    year = target.year;
  }

  const preferredHourMatch =
    text.match(
      /(?:^|\s)(?:as|a|para|pra|por volta de|depois das|antes das)\s+(\d{1,2})(?:\s*[:h]\s*(\d{1,2}))?\s*h?(?:\s|$|[.!?,])/i
    ) || text.match(/(?:^|\s)(\d{1,2})\s*h\s*(\d{1,2})?(?:\s|$|[.!?,])/i);

  if (!preferredHourMatch) {
    return null;
  }

  const hour = Number(preferredHourMatch[1]);
  const minute = preferredHourMatch[2] ? Number(preferredHourMatch[2]) : 0;

  if (
    !Number.isFinite(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isFinite(minute) ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return {
    day,
    month,
    year,
    hour,
    minute,
    hasExplicitDate: day !== null && month !== null && year !== null,
  };
}

function customerSuggestedDifferentTimeFromTarget(args: {
  content: string;
  targetStartAt: string | null | undefined;
  timezoneName?: string | null;
}) {
  const target = getLocalDateTimeParts(args.targetStartAt, args.timezoneName || "America/Sao_Paulo");
  if (!target) return false;

  const suggestion = extractCustomerSuggestedDateTimeParts(args.content, target);
  if (!suggestion) return false;

  const dateDiffers =
    suggestion.hasExplicitDate &&
    (suggestion.day !== target.day || suggestion.month !== target.month || suggestion.year !== target.year);

  const timeDiffers = suggestion.hour !== target.hour || suggestion.minute !== target.minute;

  return dateDiffers || timeDiffers;
}

function getTimeZoneOffsetMinutes(timeZone: string, date: Date) {
  const safeTimeZone = timeZone || "America/Sao_Paulo";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }

  const localAsUtc = Date.UTC(
    values.year || date.getUTCFullYear(),
    (values.month || 1) - 1,
    values.day || 1,
    values.hour || 0,
    values.minute || 0,
    values.second || 0
  );

  return Math.round((localAsUtc - date.getTime()) / 60000);
}

function localDateTimePartsToUtcIso(args: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timezoneName?: string | null;
}) {
  const timezoneName = args.timezoneName || "America/Sao_Paulo";
  const approximateUtc = new Date(Date.UTC(args.year, args.month - 1, args.day, args.hour, args.minute, 0));
  const offsetMinutes = getTimeZoneOffsetMinutes(timezoneName, approximateUtc);
  return new Date(approximateUtc.getTime() - offsetMinutes * 60000).toISOString();
}

function formatLocalDateOnly(value: string, timezoneName = "America/Sao_Paulo") {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: timezoneName || "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatLocalTimeOnly(value: string, timezoneName = "America/Sao_Paulo") {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: timezoneName || "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function buildSuggestedRescheduleWindow(args: {
  content: string;
  targetStartAt: string | null | undefined;
  targetEndAt: string | null | undefined;
  timezoneName?: string | null;
}) {
  const timezoneName = args.timezoneName || "America/Sao_Paulo";
  const target = getLocalDateTimeParts(args.targetStartAt, timezoneName);
  if (!target) return null;

  const suggestion = extractCustomerSuggestedDateTimeParts(args.content, target);
  if (!suggestion) return null;

  const startIso = localDateTimePartsToUtcIso({
    year: suggestion.year || target.year,
    month: suggestion.month || target.month,
    day: suggestion.day || target.day,
    hour: suggestion.hour,
    minute: suggestion.minute,
    timezoneName,
  });

  const targetStartMs = args.targetStartAt ? new Date(args.targetStartAt).getTime() : Number.NaN;
  const targetEndMs = args.targetEndAt ? new Date(args.targetEndAt).getTime() : Number.NaN;
  const durationMinutes =
    Number.isFinite(targetStartMs) && Number.isFinite(targetEndMs) && targetEndMs > targetStartMs
      ? Math.round((targetEndMs - targetStartMs) / 60000)
      : 60;

  const endIso = new Date(new Date(startIso).getTime() + durationMinutes * 60000).toISOString();

  return {
    startIso,
    endIso,
    suggestedDate: formatLocalDateOnly(startIso, timezoneName),
    suggestedTime: formatLocalTimeOnly(startIso, timezoneName),
    suggestedLabel: formatLocalDateTime(startIso, timezoneName),
    durationMinutes,
  };
}

async function checkSuggestedRescheduleAvailability(args: {
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
    return { available: false, reason: `Erro ao verificar disponibilidade: ${error.message}`, blocks: [], appointments: [] };
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
    return {
      available: false,
      reason: reasonByCode[reasonCode] || "Nao consegui confirmar a disponibilidade desse horario com seguranca.",
      blocks: [],
      appointments: [],
    };
  }

  return { available: true, reason: null as string | null, blocks: [], appointments: [] };
}

async function readCustomerRescheduleAutonomy(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
}) {
  const { data, error } = await args.supabase.rpc("read_store_customer_reschedule_autonomy_by_system", {
    p_organization_id: args.organizationId,
    p_store_id: args.storeId,
  });

  if (error) {
    return {
      configured: false,
      aiCanAcceptWithoutApproval: false,
      error: error.message,
    };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const configured = row?.configured === true;

  return {
    configured,
    aiCanAcceptWithoutApproval:
      configured && row?.ai_can_accept_without_approval === true,
    error: null as string | null,
  };
}

function appendTaskPayload(existing: Record<string, any> | null | undefined, patch: Record<string, any>) {
  return {
    ...(existing && typeof existing === "object" ? existing : {}),
    ...patch,
    updated_by_operational_worker_at: new Date().toISOString(),
  };
}

async function pushAssistantSystemMessage(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  content: string;
  relatedLeadId?: string | null;
  relatedConversationId?: string | null;
  relatedAppointmentId?: string | null;
  metadata?: Record<string, any>;
}) {
  const { error } = await args.supabase.rpc("assistant_push_system_message", {
    p_organization_id: args.organizationId,
    p_store_id: args.storeId,
    p_content: args.content,
    p_message_type: "text",
    p_related_lead_id: args.relatedLeadId || null,
    p_related_conversation_id: args.relatedConversationId || null,
    p_related_appointment_id: args.relatedAppointmentId || null,
    p_metadata: args.metadata || {},
  });

  if (error) {
    throw new Error(`Falha ao avisar responsável: ${error.message}`);
  }
}

async function pushAssistantInternalNotification(args: {
  supabase: {
    rpc: (fn: string, params: Record<string, unknown>) => Promise<{ error?: { message?: string } | null }>;
  };
  organizationId: string;
  storeId: string;
  notificationType: string;
  title: string;
  body: string;
  priority: "low" | "normal" | "high" | "urgent";
  context: Record<string, unknown>;
  relatedLeadId?: string | null;
  relatedConversationId?: string | null;
  relatedAppointmentId?: string | null;
  eventKey: string;
}) {
  try {
    const { error } = await args.supabase.rpc("assistant_enqueue_internal_notification", {
      p_organization_id: args.organizationId,
      p_store_id: args.storeId,
      p_notification_type: args.notificationType,
      p_title: args.title,
      p_body: args.body,
      p_priority: args.priority,
      p_context: args.context || {},
      p_related_lead_id: args.relatedLeadId || null,
      p_related_conversation_id: args.relatedConversationId || null,
      p_related_appointment_id: args.relatedAppointmentId || null,
      p_event_key: args.eventKey,
    });

    if (error) {
      console.warn("[assistant_operational_task_worker] assistant_enqueue_internal_notification error:", error);
      return { ok: false as const, error: error.message || "assistant_enqueue_internal_notification failed" };
    }

    return { ok: true as const };
  } catch (error) {
    console.warn("[assistant_operational_task_worker] assistant_enqueue_internal_notification exception:", error);
    return { ok: false as const, error: error instanceof Error ? error.message : "assistant_enqueue_internal_notification exception" };
  }
}


function formatAppointmentTypeForCustomer(value: string | null | undefined) {
  const normalized = normalizeText(value);

  if (normalized === "technical_visit") return "visita técnica";
  if (normalized === "installation") return "instalação";
  if (normalized === "maintenance") return "manutenção";

  return "compromisso";
}

function formatDateOnlyInTimeZone(value: string | null | undefined, timezoneName = "America/Sao_Paulo") {
  if (!value) return "data não definida";

  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: timezoneName || "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatTimeOnlyInTimeZone(value: string | null | undefined, timezoneName = "America/Sao_Paulo") {
  if (!value) return "horário não definido";

  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: timezoneName || "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function buildCustomerRescheduleConfirmationMessage(args: {
  appointment: AppointmentRow;
  startIso: string;
  timezoneName: string;
}) {
  const customerName = args.appointment.customer_name || "tudo bem";
  const appointmentTypeLabel = formatAppointmentTypeForCustomer(args.appointment.appointment_type).toLowerCase();
  const dateLabel = formatDateOnlyInTimeZone(args.startIso, args.timezoneName);
  const timeLabel = formatTimeOnlyInTimeZone(args.startIso, args.timezoneName);

  return `Oi, ${customerName}. Confirmado então: sua ${appointmentTypeLabel} ficou para ${dateLabel} às ${timeLabel}. Qualquer coisa, é só me avisar.`;
}

async function revalidateOperationalExecution(args: {
  supabase: any;
  queueId: string;
  taskId: string;
  organizationId: string;
  storeId: string;
  appointmentId: string;
}) {
  const { data: currentTask, error: taskError } = await args.supabase
    .from("store_assistant_operational_tasks")
    .select("id,status,task_type,related_appointment_id")
    .eq("id", args.taskId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();

  if (taskError) throw new Error(`Nao consegui revalidar a task antes do efeito externo: ${taskError.message}`);
  if (!currentTask || currentTask.status !== "waiting_customer_response") {
    throw new Error("A task deixou de estar aguardando resposta do cliente; efeito externo abortado.");
  }
  if (currentTask.related_appointment_id !== args.appointmentId) {
    throw new Error("O compromisso da task mudou antes do efeito externo; efeito abortado.");
  }

  const { data: currentQueue, error: queueError } = await args.supabase
    .from("store_assistant_operational_task_queue")
    .select("id,status,task_id")
    .eq("id", args.queueId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();

  if (queueError) throw new Error(`Nao consegui revalidar a fila antes do efeito externo: ${queueError.message}`);
  if (!currentQueue || currentQueue.task_id !== args.taskId || currentQueue.status !== "processing") {
    throw new Error("A fila deixou de estar em processamento; efeito externo abortado.");
  }
}

async function sendCustomerRescheduleConfirmationMessage(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  task: OperationalTaskRow;
  appointment: AppointmentRow;
  startIso: string;
  timezoneName: string;
  queueId: string;
}) {
  const alreadySent = Boolean(args.task.task_payload?.customer_confirmation_message_sent);
  const existingMessageId = String(args.task.task_payload?.customer_confirmation_message_id || "").trim();

  if (alreadySent && existingMessageId) {
    return { sent: false, messageId: existingMessageId };
  }

  await revalidateOperationalExecution({
    supabase: args.supabase,
    queueId: args.queueId,
    taskId: args.task.id,
    organizationId: args.organizationId,
    storeId: args.storeId,
    appointmentId: args.appointment.id,
  });

  const conversationId = args.task.related_conversation_id || args.appointment.conversation_id;

  if (!conversationId) {
    throw new Error("Agenda atualizada, mas não encontrei conversa do cliente para enviar confirmação.");
  }

  const content = buildCustomerRescheduleConfirmationMessage({
    appointment: args.appointment,
    startIso: args.startIso,
    timezoneName: args.timezoneName,
  });

  const metadata = {
    source: "panel",
    channel: "panel",
    generated_by: "assistant_operational_task_worker",
    queue_id: args.queueId,
    task_id: args.task.id,
    appointment_id: args.appointment.id,
    confirmation_type: "reschedule_confirmed_after_customer_reply",
  };

  const { data, error } = await args.supabase.rpc("insert_message", {
    p_conversation_id: conversationId,
    p_sender: "ai",
    p_direction: "outgoing",
    p_message_type: "text",
    p_content: content,
    p_media_url: null,
    p_external_message_id: null,
    p_metadata: metadata,
  });

  if (error) {
    throw new Error(`Agenda atualizada, mas falhou ao avisar o cliente via insert_message(): ${error.message}`);
  }

  const insertedMessage = Array.isArray(data) ? data[0] : data;
  return { sent: true, messageId: insertedMessage?.id || null };
}

async function loadLiveCreateTask(args: {
  supabase: any;
  taskId: string;
  organizationId: string;
  storeId: string;
}) {
  const { data, error } = await args.supabase
    .from("store_assistant_operational_tasks")
    .select("*")
    .eq("id", args.taskId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();

  if (error) throw new Error(`Falha ao revalidar task de criacao: ${error.message}`);
  return (data || null) as OperationalTaskRow | null;
}

async function patchCreateTaskPayloadLive(args: {
  supabase: any;
  taskId: string;
  organizationId: string;
  storeId: string;
  patch: Record<string, any>;
  update?: Record<string, any>;
}) {
  const { data: liveTask, error: liveError } = await args.supabase
    .from("store_assistant_operational_tasks")
    .select("id,task_payload")
    .eq("id", args.taskId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();

  if (liveError) throw new Error(`Falha ao recarregar payload vivo da task: ${liveError.message}`);
  if (!liveTask) throw new Error("Task de criacao nao encontrada para patch cumulativo.");

  const taskPayload = appendTaskPayload(liveTask.task_payload || {}, args.patch);
  const { error: updateError } = await args.supabase
    .from("store_assistant_operational_tasks")
    .update({
      ...(args.update || {}),
      task_payload: taskPayload,
      last_action_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.taskId)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId);

  if (updateError) throw new Error(updateError.message);
  return taskPayload;
}

async function validateCreateServiceSettings(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  appointmentType: string;
}) {
  const { data: serviceSettings, error: serviceSettingsError } = await args.supabase
    .from("store_operation_settings")
    .select("offers_installation,offers_technical_visit")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();

  const serviceEnabled = args.appointmentType === "technical_visit"
    ? serviceSettings?.offers_technical_visit === true
    : args.appointmentType === "installation" && serviceSettings?.offers_installation === true;

  if (serviceSettingsError || !serviceEnabled) {
    throw new Error("O servico deixou de estar habilitado nas Settings; efeito externo abortado.");
  }
}

async function validateCreateOpportunity(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  task: OperationalTaskRow;
}) {
  if (!args.task.commercial_opportunity_id) {
    throw new Error("Visita tecnica sem oportunidade canonica; efeito externo abortado.");
  }

  const { data: opportunity, error: opportunityError } = await args.supabase
    .from("commercial_opportunities")
    .select("id,organization_id,store_id,origin_lead_id,primary_conversation_id")
    .eq("id", args.task.commercial_opportunity_id)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();

  if (
    opportunityError ||
    !opportunity ||
    opportunity.origin_lead_id !== args.task.related_lead_id ||
    opportunity.primary_conversation_id !== args.task.related_conversation_id
  ) {
    throw new Error("A oportunidade canonica deixou de ser coerente com lead/conversa; efeito externo abortado.");
  }
}

async function checkCreateAppointmentAvailability(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  appointmentType: string;
  startAt: string;
  endAt: string;
}) {
  const { data, error } = await args.supabase.rpc("check_store_appointment_availability_by_system", {
    p_organization_id: args.organizationId,
    p_store_id: args.storeId,
    p_appointment_type: args.appointmentType,
    p_start_at: args.startAt,
    p_end_at: args.endAt,
    p_ignore_appointment_id: null,
  });

  const availability = Array.isArray(data) ? data[0] : data;
  return {
    available: !error && availability?.available === true,
    error: error?.message || null,
    reason: availability?.reason_code || null,
  };
}

function sameInstant(a: string | null | undefined, b: string | null | undefined) {
  const leftRaw = String(a || "").trim();
  const rightRaw = String(b || "").trim();
  if (!leftRaw || !rightRaw) return false;

  const left = new Date(leftRaw).getTime();
  const right = new Date(rightRaw).getTime();
  return Number.isFinite(left) && Number.isFinite(right) && left === right;
}

function validatePersistedCreateAppointment(args: {
  appointment: AppointmentRow;
  task: OperationalTaskRow;
  appointmentType: string;
  targetStartAt: string;
  targetEndAt: string;
}) {
  if (
    args.appointment.lead_id !== args.task.related_lead_id ||
    args.appointment.conversation_id !== args.task.related_conversation_id ||
    (args.appointment.commercial_opportunity_id || null) !== (args.task.commercial_opportunity_id || null) ||
    args.appointment.appointment_type !== args.appointmentType ||
    !sameInstant(args.appointment.scheduled_start, args.targetStartAt) ||
    !sameInstant(args.appointment.scheduled_end, args.targetEndAt)
  ) {
    throw new Error("Appointment marcado na task diverge da identidade ou janela canonica; reconciliacao manual necessaria.");
  }
}

function validateAtomicCreateCheckpoint(args: {
  task: OperationalTaskRow | null;
  appointment: AppointmentRow;
}) {
  const payload = args.task?.task_payload || {};
  if (
    !args.task ||
    args.task.related_appointment_id !== args.appointment.id ||
    payload.appointment_id !== args.appointment.id ||
    payload.appointment_write_succeeded !== true ||
    payload.agenda_updated !== true ||
    payload.atomic_appointment_write_completed !== true
  ) {
    throw new Error("Checkpoint atomico de criacao diverge do appointment retornado; reconciliacao manual necessaria.");
  }
}

function validateDurableCreateWriteEvidence(args: {
  task: OperationalTaskRow;
  queue: QueueRow;
  decision: CustomerReplyDecision;
}) {
  const payload = args.task.task_payload || {};
  const decisionType = String(payload.last_customer_reply_decision_type || "").trim();
  const replyMessageId = String(payload.last_customer_reply_message_id || "").trim();
  const processedQueueId = String(payload.last_processed_queue_id || "").trim();
  const processedConversationId = String(payload.last_processed_conversation_id || "").trim();

  if (
    replyMessageId !== args.queue.message_id ||
    processedQueueId !== args.queue.id ||
    processedConversationId !== args.queue.conversation_id ||
    processedConversationId !== args.task.related_conversation_id
  ) {
    throw new Error("Prova duravel da resposta do cliente diverge da fila/conversa canonica; writer atomico abortado.");
  }

  if (args.decision.type === "confirmed") {
    if (decisionType !== "confirmed") {
      throw new Error("Confirmacao do cliente nao ficou persistida de forma duravel; writer atomico abortado.");
    }
    return;
  }

  if (args.decision.type === "suggested_other_time") {
    if (
      decisionType !== "suggested_other_time" ||
      payload.suggested_time_available !== true ||
      String(payload.suggested_start_at || "") !== String(args.task.target_start_at || "") ||
      String(payload.suggested_end_at || "") !== String(args.task.target_end_at || "")
    ) {
      throw new Error("Contraproposta do cliente nao ficou persistida/autorizada para a janela canonica; writer atomico abortado.");
    }
    return;
  }

  throw new Error("Decisao do cliente nao autoriza criacao de appointment; writer atomico abortado.");
}

async function processCreateAppointmentTask(args: {
  supabase: any;
  queue: QueueRow;
  task: OperationalTaskRow;
  decision: CustomerReplyDecision;
  customerMessage: string;
}): Promise<any> {
  const { supabase, queue, task, decision, customerMessage } = args;
  const initialPayload = task.task_payload || {};
  const normalizedCustomerReply = normalizeText(customerMessage).replace(/\s+/g, " ").trim();
  const commonPatch = {
    last_customer_reply: customerMessage,
    last_customer_reply_normalized: normalizedCustomerReply,
    last_customer_reply_message_id: queue.message_id,
    last_customer_reply_decision: decision,
    last_customer_reply_decision_type: decision.type,
    last_processed_queue_id: queue.id,
    last_processed_conversation_id: queue.conversation_id,
  };

  let currentTask = await loadLiveCreateTask({
    supabase,
    taskId: task.id,
    organizationId: queue.organization_id,
    storeId: queue.store_id,
  });

  if (!currentTask || currentTask.status !== "waiting_customer_response" || currentTask.task_type !== "appointment_create_with_customer") {
    throw new Error("Task de criacao deixou de estar aguardando confirmacao; efeito externo abortado.");
  }

  if (!currentTask.related_lead_id || !currentTask.related_conversation_id) {
    throw new Error("Task de criacao sem identidade canonica ou janela de horario.");
  }

  const livePayload = currentTask.task_payload || {};
  let appointmentType = String(livePayload.appointment_type || initialPayload.appointment_type || "").trim();
  let targetStartAt = currentTask.target_start_at;
  let targetEndAt = currentTask.target_end_at;

  const { data: currentQueue, error: queueError } = await supabase.from("store_assistant_operational_task_queue")
    .select("id,status,task_id").eq("id", queue.id).eq("organization_id", queue.organization_id).eq("store_id", queue.store_id).maybeSingle();
  if (queueError) throw new Error(`Falha ao revalidar fila de criacao: ${queueError.message}`);
  if (!currentQueue || currentQueue.status !== "processing" || currentQueue.task_id !== task.id) {
    throw new Error("Fila de criacao deixou de estar em processamento; efeito externo abortado.");
  }

  let createdAppointment: any = null;
  const hasPostWriteMarker =
    Boolean(currentTask.related_appointment_id) &&
    livePayload.appointment_write_succeeded === true;

  if (!hasPostWriteMarker) {
    if (!targetStartAt || !targetEndAt) {
      throw new Error("Task de criacao sem identidade canonica ou janela de horario.");
    }

    if (decision.type === "ambiguous") {
      await patchCreateTaskPayloadLive({
        supabase,
        taskId: task.id,
        organizationId: queue.organization_id,
        storeId: queue.store_id,
        patch: {
          ...commonPatch,
          agenda_updated: false,
          appointment_write_succeeded: false,
          needs_new_time_negotiation: true,
          decision_requires_clarification: true,
        },
        update: {
          status: "waiting_customer_response",
          description: "Resposta recebida sem confirmacao segura. A agenda permanece inalterada.",
        },
      });
      return { ok: true, action: "appointment_creation_ambiguous", taskId: task.id, queueId: queue.id };
    }

    if (decision.type === "rejected") {
      await patchCreateTaskPayloadLive({
        supabase,
        taskId: task.id,
        organizationId: queue.organization_id,
        storeId: queue.store_id,
        patch: {
          ...commonPatch,
          agenda_updated: false,
          appointment_write_succeeded: false,
          needs_new_time_negotiation: true,
          safe_alternative_finder_available: false,
          reconciliation_reason: "customer_rejected_target_time_without_canonical_alternative_finder",
        },
        update: {
          status: "waiting_customer_response",
          description: "Cliente recusou o horario sugerido. A agenda permanece inalterada e precisa de novo horario seguro.",
        },
      });
      return { ok: true, action: "appointment_creation_rejected", taskId: task.id, queueId: queue.id };
    }

    if (decision.type === "suggested_other_time") {
      const suggestedWindow = buildSuggestedRescheduleWindow({
        content: customerMessage,
        targetStartAt,
        targetEndAt,
        timezoneName: currentTask.timezone_name,
      });

      if (!suggestedWindow) {
        await patchCreateTaskPayloadLive({
          supabase,
          taskId: task.id,
          organizationId: queue.organization_id,
          storeId: queue.store_id,
          patch: {
            ...commonPatch,
            agenda_updated: false,
            appointment_write_succeeded: false,
            needs_new_time_negotiation: true,
            decision_requires_clarification: true,
            suggested_time_parse_failed: true,
          },
          update: {
            status: "waiting_customer_response",
            description: "Cliente sugeriu outro horario, mas a sugestao esta incompleta ou ambigua. A agenda permanece inalterada.",
          },
        });
        return { ok: true, action: "appointment_creation_suggestion_ambiguous", taskId: task.id, queueId: queue.id };
      }

      await validateCreateServiceSettings({
        supabase,
        organizationId: queue.organization_id,
        storeId: queue.store_id,
        appointmentType,
      });
      if (appointmentType === "technical_visit") {
        await validateCreateOpportunity({
          supabase,
          organizationId: queue.organization_id,
          storeId: queue.store_id,
          task: currentTask,
        });
      }

      const suggestedAvailability = await checkCreateAppointmentAvailability({
        supabase,
        organizationId: queue.organization_id,
        storeId: queue.store_id,
        appointmentType,
        startAt: suggestedWindow.startIso,
        endAt: suggestedWindow.endIso,
      });

      if (!suggestedAvailability.available) {
        await patchCreateTaskPayloadLive({
          supabase,
          taskId: task.id,
          organizationId: queue.organization_id,
          storeId: queue.store_id,
          patch: {
            ...commonPatch,
            agenda_updated: false,
            appointment_write_succeeded: false,
            needs_new_time_negotiation: true,
            suggested_start_at: suggestedWindow.startIso,
            suggested_end_at: suggestedWindow.endIso,
            suggested_date: suggestedWindow.suggestedDate,
            suggested_time: suggestedWindow.suggestedTime,
            suggested_label: suggestedWindow.suggestedLabel,
            suggested_duration_minutes: suggestedWindow.durationMinutes,
            suggested_time_available: false,
            suggested_time_unavailable_reason: suggestedAvailability.error || suggestedAvailability.reason || "unavailable",
            suggested_time_checked_at: new Date().toISOString(),
          },
          update: {
            status: "waiting_customer_response",
            description: "Cliente sugeriu outro horario, mas ele nao esta disponivel. A agenda permanece inalterada.",
          },
        });
        return { ok: true, action: "appointment_creation_suggestion_unavailable", taskId: task.id, queueId: queue.id };
      }

      await patchCreateTaskPayloadLive({
        supabase,
        taskId: task.id,
        organizationId: queue.organization_id,
        storeId: queue.store_id,
        patch: {
          ...commonPatch,
          suggested_start_at: suggestedWindow.startIso,
          suggested_end_at: suggestedWindow.endIso,
          suggested_date: suggestedWindow.suggestedDate,
          suggested_time: suggestedWindow.suggestedTime,
          suggested_label: suggestedWindow.suggestedLabel,
          suggested_duration_minutes: suggestedWindow.durationMinutes,
          suggested_time_available: true,
          suggested_time_checked_at: new Date().toISOString(),
          appointment_write_authorized_at: new Date().toISOString(),
          appointment_write_authorization_type: "customer_suggested_available_time",
        },
        update: {
          status: "waiting_customer_response",
          target_start_at: suggestedWindow.startIso,
          target_end_at: suggestedWindow.endIso,
          description: "Cliente sugeriu outro horario disponivel. A task foi atualizada para criar o compromisso nesse horario validado.",
        },
      });

      targetStartAt = suggestedWindow.startIso;
      targetEndAt = suggestedWindow.endIso;
    }
  }

  if (!targetStartAt || !targetEndAt || !currentTask.related_lead_id || !currentTask.related_conversation_id) {
    throw new Error("Task de criacao sem identidade canonica ou janela de horario.");
  }

  if (!hasPostWriteMarker) {
    if (decision.type === "confirmed") {
      await patchCreateTaskPayloadLive({
        supabase,
        taskId: task.id,
        organizationId: queue.organization_id,
        storeId: queue.store_id,
        patch: {
          ...commonPatch,
          agenda_updated: false,
          appointment_write_succeeded: false,
          appointment_write_authorized_at: new Date().toISOString(),
          appointment_write_authorization_type: "customer_confirmed_target_time",
        },
        update: {
          status: "waiting_customer_response",
          description: "Cliente confirmou o horario. A prova foi persistida; a agenda ainda nao foi alterada.",
        },
      });
    }

    const authorizationTask = await loadLiveCreateTask({
      supabase,
      taskId: task.id,
      organizationId: queue.organization_id,
      storeId: queue.store_id,
    });

    if (
      !authorizationTask ||
      authorizationTask.status !== "waiting_customer_response" ||
      authorizationTask.task_type !== "appointment_create_with_customer"
    ) {
      throw new Error("Task de criacao mudou antes da autorizacao atomica; efeito externo abortado.");
    }

    currentTask = authorizationTask;
    appointmentType = String((currentTask.task_payload || {}).appointment_type || "").trim();
    targetStartAt = currentTask.target_start_at;
    targetEndAt = currentTask.target_end_at;

    if (!appointmentType || !targetStartAt || !targetEndAt || !currentTask.related_lead_id || !currentTask.related_conversation_id) {
      throw new Error("Task de criacao ficou incompleta apos persistir a autorizacao; writer atomico abortado.");
    }

    validateDurableCreateWriteEvidence({
      task: currentTask,
      queue,
      decision,
    });
  }

  if (hasPostWriteMarker) {
    const { data: existingAppointment, error: existingAppointmentError } = await supabase.from("store_appointments")
      .select("*").eq("id", currentTask.related_appointment_id).eq("organization_id", queue.organization_id).eq("store_id", queue.store_id).maybeSingle();
    if (existingAppointmentError || !existingAppointment) throw new Error(existingAppointmentError?.message || "Appointment marcado na task nao foi encontrado.");
    validatePersistedCreateAppointment({
      appointment: existingAppointment,
      task: currentTask,
      appointmentType,
      targetStartAt,
      targetEndAt,
    });
    createdAppointment = existingAppointment;
  } else {
    await validateCreateServiceSettings({
      supabase,
      organizationId: queue.organization_id,
      storeId: queue.store_id,
      appointmentType,
    });
    if (appointmentType === "technical_visit") {
      await validateCreateOpportunity({
        supabase,
        organizationId: queue.organization_id,
        storeId: queue.store_id,
        task: currentTask,
      });
    }
    const availability = await checkCreateAppointmentAvailability({
      supabase,
      organizationId: queue.organization_id,
      storeId: queue.store_id,
      appointmentType,
      startAt: targetStartAt,
      endAt: targetEndAt,
    });
    if (!availability.available) {
      await patchCreateTaskPayloadLive({
        supabase,
        taskId: task.id,
        organizationId: queue.organization_id,
        storeId: queue.store_id,
        patch: {
          ...commonPatch,
          agenda_updated: false,
          appointment_write_succeeded: false,
          availability_error: availability.error || availability.reason || "unavailable",
        },
        update: {
          status: "waiting_customer_response",
          description: "O horario confirmado nao esta disponivel. A agenda permanece inalterada.",
        },
      });
      return { ok: true, action: "appointment_creation_unavailable", taskId: task.id, queueId: queue.id };
    }

    const operationKey = String((currentTask.task_payload || {}).operation_key || "").trim();
    if (!operationKey) {
      throw new Error("Task de criacao sem operation_key canonico; writer atomico abortado.");
    }

    const { data: writtenAppointment, error: createError } = await supabase.rpc("create_assistant_appointment_by_task_atomic", {
      p_task_id: currentTask.id,
      p_organization_id: queue.organization_id,
      p_store_id: queue.store_id,
      p_expected_operation_key: operationKey,
      p_expected_lead_id: currentTask.related_lead_id,
      p_expected_conversation_id: currentTask.related_conversation_id,
      p_expected_commercial_opportunity_id: currentTask.commercial_opportunity_id,
      p_expected_appointment_type: appointmentType,
      p_expected_start_at: targetStartAt,
      p_expected_end_at: targetEndAt,
    });
    if (createError || !writtenAppointment?.id) throw new Error(createError?.message || "Nao consegui criar o compromisso.");
    createdAppointment = writtenAppointment;
    const postAtomicTask = await loadLiveCreateTask({
      supabase,
      taskId: task.id,
      organizationId: queue.organization_id,
      storeId: queue.store_id,
    });
    if (!postAtomicTask) {
      throw new Error("Task de criacao nao encontrada apos writer atomico; reconciliacao manual necessaria.");
    }
    validateAtomicCreateCheckpoint({ task: postAtomicTask, appointment: createdAppointment });
    validatePersistedCreateAppointment({
      appointment: createdAppointment,
      task: postAtomicTask,
      appointmentType,
      targetStartAt,
      targetEndAt,
    });
    currentTask = postAtomicTask;
  }

  let latestPayload = (await loadLiveCreateTask({
    supabase,
    taskId: task.id,
    organizationId: queue.organization_id,
    storeId: queue.store_id,
  }))?.task_payload || {};

  if (appointmentType === "technical_visit" && currentTask.commercial_opportunity_id) {
    if (latestPayload.commercial_projection_completed !== true) {
      await projectTechnicalVisitStageBySystem({
        supabase,
        organizationId: queue.organization_id,
        storeId: queue.store_id,
        commercialOpportunityId: currentTask.commercial_opportunity_id,
        appointmentId: createdAppointment.id,
        source: "assistant_operational_task_worker",
      });
      latestPayload = await patchCreateTaskPayloadLive({
        supabase,
        taskId: task.id,
        organizationId: queue.organization_id,
        storeId: queue.store_id,
        patch: { commercial_projection_completed: true },
      });
    }
  } else if (!latestPayload.commercial_projection_completed) {
    latestPayload = await patchCreateTaskPayloadLive({
      supabase,
      taskId: task.id,
      organizationId: queue.organization_id,
      storeId: queue.store_id,
      patch: { commercial_projection_completed: "not_applicable" },
    });
  }

  const timezone = currentTask.timezone_name || "America/Sao_Paulo";
  let messageId = String(latestPayload.customer_confirmation_message_id || "").trim() || null;
  if (latestPayload.customer_confirmation_message_sent !== true) {
    const content = `Oi, ${currentTask.customer_name || "tudo bem"}. Confirmado: sua ${appointmentType === "installation" ? "instalacao" : "visita tecnica"} ficou para ${formatDateOnlyInTimeZone(targetStartAt, timezone)} as ${formatTimeOnlyInTimeZone(targetStartAt, timezone)}.`;
    const { data: messageData, error: messageError } = await supabase.rpc("insert_message", {
      p_conversation_id: currentTask.related_conversation_id, p_sender: "ai", p_direction: "outgoing", p_message_type: "text", p_content: content,
      p_media_url: null, p_external_message_id: null, p_metadata: { source: "assistant_operational_task_worker", task_id: task.id, appointment_id: createdAppointment.id, confirmation_type: "create_confirmed" },
    });
    if (messageError) throw new Error(`Compromisso criado, mas falhou a confirmacao ao cliente: ${messageError.message}`);
    messageId = (Array.isArray(messageData) ? messageData[0] : messageData)?.id || null;
    latestPayload = await patchCreateTaskPayloadLive({
      supabase,
      taskId: task.id,
      organizationId: queue.organization_id,
      storeId: queue.store_id,
      patch: {
        customer_confirmation_message_sent: true,
        customer_confirmation_message_id: messageId,
      },
    });
  }

  if (latestPayload.responsible_notification_sent !== true) {
    const notification = await pushAssistantInternalNotification({
      supabase, organizationId: queue.organization_id, storeId: queue.store_id,
      notificationType: "important_alert", title: "Novo compromisso confirmado",
      body: `${currentTask.customer_name || "Cliente"}: ${formatAppointmentTypeForCustomer(appointmentType)} em ${formatDateOnlyInTimeZone(targetStartAt, timezone)} as ${formatTimeOnlyInTimeZone(targetStartAt, timezone)}.`,
      priority: "high", context: { source: "assistant_operational_task_worker", task_id: task.id, appointment_id: createdAppointment.id },
      relatedLeadId: currentTask.related_lead_id, relatedConversationId: currentTask.related_conversation_id, relatedAppointmentId: createdAppointment.id,
      eventKey: `assistant-operational-task:${task.id}:appointment-confirmed:${createdAppointment.id}`,
    });
    if (!notification.ok) throw new Error(`Compromisso criado, mas falhou a notificacao ao responsavel: ${notification.error}`);
    latestPayload = await patchCreateTaskPayloadLive({
      supabase,
      taskId: task.id,
      organizationId: queue.organization_id,
      storeId: queue.store_id,
      patch: { responsible_notification_sent: true },
    });
  }

  if (latestPayload.commercial_visit_request_resolved !== true) {
    if (appointmentType === "technical_visit" && currentTask.commercial_opportunity_id) {
      const { data: handoffRows, error: handoffError } = await supabase.from("store_assistant_operational_tasks")
        .select("id,status,task_payload")
        .eq("organization_id", queue.organization_id).eq("store_id", queue.store_id)
        .eq("task_type", "commercial_visit_request")
        .eq("related_lead_id", currentTask.related_lead_id)
        .eq("related_conversation_id", currentTask.related_conversation_id)
        .eq("commercial_opportunity_id", currentTask.commercial_opportunity_id)
        .in("status", ["open", "waiting_customer_response", "ready_to_execute", "in_progress"])
        .limit(3);
      if (handoffError) throw new Error(`Appointment criado, mas falhou ao localizar commercial_visit_request: ${handoffError.message}`);
      if ((handoffRows || []).length === 1) {
        const handoff = handoffRows[0];
        const handoffPayload = appendTaskPayload(handoff.task_payload || {}, {
          appointment_id: createdAppointment.id,
          resolved_reason: "appointment_created_after_customer_confirmation",
        });
        const { error: handoffUpdateError } = await supabase.from("store_assistant_operational_tasks").update({
          status: "resolved", resolved_at: new Date().toISOString(), related_appointment_id: createdAppointment.id,
          task_payload: handoffPayload,
          updated_at: new Date().toISOString(),
        }).eq("id", handoff.id).eq("organization_id", queue.organization_id).eq("store_id", queue.store_id);
        if (handoffUpdateError) throw new Error(`Appointment criado, mas commercial_visit_request nao foi resolvido: ${handoffUpdateError.message}`);
        latestPayload = await patchCreateTaskPayloadLive({
          supabase,
          taskId: task.id,
          organizationId: queue.organization_id,
          storeId: queue.store_id,
          patch: { commercial_visit_request_resolved: true },
        });
      } else if ((handoffRows || []).length > 1) {
        const reconciliationAlert = await pushAssistantInternalNotification({
          supabase, organizationId: queue.organization_id, storeId: queue.store_id,
          notificationType: "important_alert", title: "Reconciliação necessária: solicitações duplicadas",
          body: "O compromisso foi criado, mas existem multiplas commercial_visit_request para o mesmo contexto canonico.", priority: "urgent",
          context: { source: "assistant_operational_task_worker", task_id: task.id, appointment_id: createdAppointment.id, reason: "multiple_commercial_visit_requests" },
          relatedLeadId: currentTask.related_lead_id, relatedConversationId: currentTask.related_conversation_id, relatedAppointmentId: createdAppointment.id,
          eventKey: `assistant-operational-task:${task.id}:multiple-commercial-visit-requests:${createdAppointment.id}`,
        });
        if (!reconciliationAlert.ok) throw new Error(`Appointment criado, mas falhou o alerta de reconciliacao: ${reconciliationAlert.error}`);
        latestPayload = await patchCreateTaskPayloadLive({
          supabase,
          taskId: task.id,
          organizationId: queue.organization_id,
          storeId: queue.store_id,
          patch: {
            commercial_visit_request_resolved: false,
            commercial_visit_request_reconciliation_required: true,
          },
        });
      } else {
        latestPayload = await patchCreateTaskPayloadLive({
          supabase,
          taskId: task.id,
          organizationId: queue.organization_id,
          storeId: queue.store_id,
          patch: { commercial_visit_request_resolved: false },
        });
      }
    } else {
      latestPayload = await patchCreateTaskPayloadLive({
        supabase,
        taskId: task.id,
        organizationId: queue.organization_id,
        storeId: queue.store_id,
        patch: { commercial_visit_request_resolved: "not_applicable" },
      });
    }
  }

  if (latestPayload.context_resolved !== true) {
    if (currentTask.thread_id) {
      const { error: contextError } = await supabase.from("store_assistant_context_state").update({
        active_status: "resolved", active_topic: "appointment_create_with_customer", active_appointment_id: createdAppointment.id,
        updated_at: new Date().toISOString(), context_payload: { resolved_reason: "appointment_created_after_customer_confirmation", task_id: task.id, appointment_id: createdAppointment.id },
      }).eq("thread_id", currentTask.thread_id).eq("organization_id", queue.organization_id).eq("store_id", queue.store_id);
      if (contextError) throw new Error(`Compromisso criado, mas falhou ao resolver contexto: ${contextError.message}`);
    }
    latestPayload = await patchCreateTaskPayloadLive({
      supabase,
      taskId: task.id,
      organizationId: queue.organization_id,
      storeId: queue.store_id,
      patch: { context_resolved: true },
    });
  }

  await patchCreateTaskPayloadLive({
    supabase,
    taskId: task.id,
    organizationId: queue.organization_id,
    storeId: queue.store_id,
    patch: {
      ...commonPatch,
      agenda_updated: true,
      appointment_write_succeeded: true,
      appointment_id: createdAppointment.id,
      customer_confirmation_message_sent: true,
      customer_confirmation_message_id: messageId,
      responsible_notification_sent: true,
      finalization_completed: true,
    },
    update: {
      status: "resolved",
      related_appointment_id: createdAppointment.id,
      resolved_at: new Date().toISOString(),
      description: "Cliente confirmou e o compromisso foi criado.",
    },
  });

  return { ok: true, action: "appointment_created", appointmentId: createdAppointment.id, taskId: task.id, queueId: queue.id };
}

async function processQueueItem(args: {
  supabase: any;
  queue: QueueRow;
  workerId: string;
}) {
  const { supabase, queue } = args;

  const customerMessage = String(queue.payload?.customer_message || "").trim();
  const normalizedCustomerReply = normalizeText(customerMessage).replace(/\s+/g, " ").trim();

  const { data: taskRow, error: taskError } = await supabase
    .from("store_assistant_operational_tasks")
    .select("*")
    .eq("id", queue.task_id)
    .eq("organization_id", queue.organization_id)
    .eq("store_id", queue.store_id)
    .maybeSingle();

  const task = taskRow as OperationalTaskRow | null;

  if (taskError || !task) {
    throw new Error(taskError?.message || "Tarefa operacional não encontrada.");
  }

  if (task.organization_id !== queue.organization_id || task.store_id !== queue.store_id || task.id !== queue.task_id) {
    throw new Error("A fila nao corresponde exatamente ao tenant ou task carregado; efeito abortado.");
  }

  if (task.task_type !== "appointment_reschedule_with_customer" && task.task_type !== "appointment_create_with_customer") {
    const { error: queueLifecycleError } = await supabase
      .from("store_assistant_operational_task_queue")
      .update({
        status: "cancelled",
        processed_at: new Date().toISOString(),
        result_payload: {
          reason: "unsupported_task_type",
          taskType: task.task_type,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", queue.id);
    if (queueLifecycleError) throw new Error(`Falha ao finalizar fila de task nao suportada: ${queueLifecycleError.message}`);

    return {
      ok: true,
      skipped: true,
      reason: "unsupported_task_type",
      taskId: task.id,
      queueId: queue.id,
    };
  }

  if (task.related_conversation_id !== queue.conversation_id) {
    const { error: queueLifecycleError } = await supabase
      .from("store_assistant_operational_task_queue")
      .update({
        status: "cancelled",
        processed_at: new Date().toISOString(),
        result_payload: {
          reason: "task_queue_conversation_mismatch",
          taskConversationId: task.related_conversation_id,
          queueConversationId: queue.conversation_id,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", queue.id);
    if (queueLifecycleError) throw new Error(`Falha ao finalizar fila com conversa divergente: ${queueLifecycleError.message}`);

    return {
      ok: true,
      skipped: true,
      reason: "task_queue_conversation_mismatch",
      taskId: task.id,
      queueId: queue.id,
    };
  }

  if (task.status !== "waiting_customer_response") {
    const { error: queueLifecycleError } = await supabase
      .from("store_assistant_operational_task_queue")
      .update({
        status: "cancelled",
        processed_at: new Date().toISOString(),
        result_payload: {
          reason: "task_no_longer_waiting_customer_response",
          taskStatus: task.status,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", queue.id);
    if (queueLifecycleError) throw new Error(`Falha ao cancelar fila de task nao aguardando cliente: ${queueLifecycleError.message}`);

    return {
      ok: true,
      skipped: true,
      reason: "task_no_longer_waiting_customer_response",
    };
  }

  if (task.task_type === "appointment_create_with_customer") {
    const decision = classifyCustomerReply(customerMessage);
    return processCreateAppointmentTask({ supabase, queue, task, decision, customerMessage });
  }

  if (!task.related_appointment_id) {
    throw new Error("Tarefa sem compromisso vinculado.");
  }

  const { data: appointmentRow, error: appointmentError } = await supabase
    .from("store_appointments")
    .select("*")
    .eq("id", task.related_appointment_id)
    .eq("organization_id", queue.organization_id)
    .eq("store_id", queue.store_id)
    .maybeSingle();

  const appointment = appointmentRow as AppointmentRow | null;

  if (appointmentError || !appointment) {
    throw new Error(appointmentError?.message || "Compromisso vinculado não encontrado.");
  }

  const taskOpportunityId = String(task.commercial_opportunity_id || "").trim();
  const appointmentOpportunityId = String(appointment.commercial_opportunity_id || "").trim();
  if (taskOpportunityId && appointmentOpportunityId && taskOpportunityId !== appointmentOpportunityId) {
    throw new Error("Divergencia de oportunidade comercial entre task e compromisso.");
  }

  const timezoneName = task.timezone_name || "America/Sao_Paulo";
  const taskPayload = task.task_payload || {};
  const lastConversationId = String(taskPayload.last_processed_conversation_id || "");
  const currentConversationId = String(task.related_conversation_id || queue.conversation_id || "");
  let decision = classifyCustomerReply(customerMessage);

  const suggestedDifferentTimeFromTarget = customerSuggestedDifferentTimeFromTarget({
    content: customerMessage,
    targetStartAt: task.target_start_at,
    timezoneName,
  });

  if (suggestedDifferentTimeFromTarget) {
    decision = {
      type: "suggested_other_time",
      reason: "customer_suggested_different_time_from_target",
      rawText: customerMessage,
    };
  }

  const lastDecisionType = String(taskPayload.last_customer_reply_decision_type || taskPayload.last_customer_reply_decision?.type || "");
  const isSameCustomerReply =
    String(taskPayload.last_customer_reply_normalized || "") === normalizedCustomerReply &&
    lastDecisionType === decision.type &&
    (!lastConversationId || lastConversationId === currentConversationId);

  if (decision.type === "confirmed") {
    if (
      isSameCustomerReply &&
      (Boolean(taskPayload.appointment_update_succeeded) || Boolean(taskPayload.customer_confirmation_message_sent))
    ) {
      return {
        ok: true,
        skipped: true,
        reason: "duplicate_customer_reply_already_processed",
        action: "duplicate_skipped",
        taskId: task.id,
        queueId: queue.id,
      };
    }

    if (!task.target_start_at || !task.target_end_at) {
      throw new Error("Cliente confirmou, mas a tarefa não tem target_start_at/target_end_at.");
    }

    await revalidateOperationalExecution({
      supabase,
      queueId: queue.id,
      taskId: task.id,
      organizationId: queue.organization_id,
      storeId: queue.store_id,
      appointmentId: appointment.id,
    });

    const { data: updatedAppointment, error: updateError } = await supabase.rpc(
      "update_store_appointment",
      {
        p_appointment_id: appointment.id,
        p_organization_id: queue.organization_id,
        p_store_id: queue.store_id,
        p_title: appointment.title,
        p_appointment_type: appointment.appointment_type,
        p_status: "rescheduled",
        p_scheduled_start: task.target_start_at,
        p_scheduled_end: task.target_end_at,
        p_customer_name: appointment.customer_name,
        p_customer_phone: appointment.customer_phone,
        p_address_text: appointment.address_text,
        p_notes: appointment.notes,
      }
    );

    if (updateError) {
      const failedPayload = appendTaskPayload(task.task_payload, {
        last_customer_reply: customerMessage,
        last_customer_reply_normalized: normalizedCustomerReply,
        last_customer_reply_message_id: queue.message_id,
        last_customer_reply_decision: decision,
        last_customer_reply_decision_type: decision.type,
        last_processed_queue_id: queue.id,
        last_processed_conversation_id: currentConversationId,
        last_execution_error: updateError.message,
        appointment_update_attempted: true,
        appointment_update_succeeded: false,
      });

      const { error: taskLifecycleError } = await supabase
        .from("store_assistant_operational_tasks")
        .update({
          status: "failed",
          error_text: updateError.message,
          task_payload: failedPayload,
          last_action_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", task.id);
      if (taskLifecycleError) throw new Error(`Falha ao registrar falha da atualizacao da agenda: ${taskLifecycleError.message}`);

      await pushAssistantSystemMessage({
        supabase,
        organizationId: queue.organization_id,
        storeId: queue.store_id,
        content: `${task.customer_name || "O cliente"} confirmou a remarcação, mas eu não consegui atualizar a agenda: ${updateError.message}`,
        relatedLeadId: task.related_lead_id,
        relatedConversationId: task.related_conversation_id,
        relatedAppointmentId: task.related_appointment_id,
        metadata: {
          source: "assistant_operational_task_worker",
          queue_id: queue.id,
          task_id: task.id,
          error: updateError.message,
        },
      });

      throw new Error(updateError.message);
    }

    let customerConfirmation: { sent: boolean; messageId: string | null };
    try {
      customerConfirmation = await sendCustomerRescheduleConfirmationMessage({
        supabase,
        organizationId: queue.organization_id,
        storeId: queue.store_id,
        task,
        appointment,
        startIso: task.target_start_at,
        timezoneName,
        queueId: queue.id,
      });
    } catch (error: any) {
      const message = error?.message || "Agenda atualizada, mas falhou ao avisar o cliente.";
      const failedAfterUpdatePayload = appendTaskPayload(task.task_payload, {
        last_customer_reply: customerMessage,
        last_customer_reply_normalized: normalizedCustomerReply,
        last_customer_reply_message_id: queue.message_id,
        last_customer_reply_decision: decision,
        last_customer_reply_decision_type: decision.type,
        last_processed_queue_id: queue.id,
        last_processed_conversation_id: currentConversationId,
        appointment_update_attempted: true,
        appointment_update_succeeded: true,
        updated_appointment: updatedAppointment,
        customer_confirmation_message_sent: false,
        customer_confirmation_message_id: null,
        last_execution_error: message,
        failed_after_appointment_update_at: new Date().toISOString(),
      });

      const { error: taskLifecycleError } = await supabase
        .from("store_assistant_operational_tasks")
        .update({
          status: "failed",
          error_text: message,
          task_payload: failedAfterUpdatePayload,
          last_action_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", task.id)
        .eq("organization_id", queue.organization_id)
        .eq("store_id", queue.store_id);
      if (taskLifecycleError) throw new Error(`Falha ao registrar falha parcial apos atualizar agenda: ${taskLifecycleError.message}`);

      await pushAssistantSystemMessage({
        supabase,
        organizationId: queue.organization_id,
        storeId: queue.store_id,
        content: `${task.customer_name || "O cliente"} confirmou a remarcacao e a agenda foi atualizada para ${formatLocalDateTime(task.target_start_at, timezoneName)}, mas eu nao consegui enviar a confirmacao automatica ao cliente: ${message}`,
        relatedLeadId: task.related_lead_id,
        relatedConversationId: task.related_conversation_id,
        relatedAppointmentId: task.related_appointment_id,
        metadata: {
          source: "assistant_operational_task_worker",
          queue_id: queue.id,
          task_id: task.id,
          appointment_id: appointment.id,
          error: message,
          partial_success: "appointment_updated_customer_confirmation_failed",
        },
      });

      await pushAssistantInternalNotification({
        supabase,
        organizationId: queue.organization_id,
        storeId: queue.store_id,
        notificationType: "important_alert",
        title: "Confirmacao ao cliente falhou",
        body: `A agenda foi atualizada para ${formatLocalDateTime(task.target_start_at, timezoneName)}, mas nao foi possivel enviar a confirmacao automatica ao cliente. Confira a conversa e avise o cliente manualmente.`,
        priority: "urgent",
        context: {
          source: "assistant_operational_task_worker",
          reason: "confirmed_reschedule_customer_confirmation_failed",
          classification: "confirmed_partial_failure",
          task_id: task.id,
          appointment_id: appointment.id,
          target_start_at: task.target_start_at,
          error: message,
        },
        relatedLeadId: task.related_lead_id,
        relatedConversationId: task.related_conversation_id,
        relatedAppointmentId: task.related_appointment_id,
        eventKey: `operational_task:${task.id}:confirmed_partial_failure:${appointment.id}:customer_confirmation_failed`,
      });

      throw new Error(message);
    }

    const resolvedPayload = appendTaskPayload(task.task_payload, {
      last_customer_reply: customerMessage,
      last_customer_reply_normalized: normalizedCustomerReply,
      last_customer_reply_message_id: queue.message_id,
      last_customer_reply_decision: decision,
      last_customer_reply_decision_type: decision.type,
      last_processed_queue_id: queue.id,
      last_processed_conversation_id: currentConversationId,
      appointment_update_attempted: true,
      appointment_update_succeeded: true,
      updated_appointment: updatedAppointment,
      customer_confirmation_message_sent: Boolean(customerConfirmation.messageId),
      customer_confirmation_message_id: customerConfirmation.messageId || null,
    });

    const { error: taskUpdateError } = await supabase
      .from("store_assistant_operational_tasks")
      .update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        last_action_at: new Date().toISOString(),
        task_payload: resolvedPayload,
        description: "Cliente confirmou a remarcação e a agenda foi atualizada.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id)
      .eq("organization_id", queue.organization_id)
      .eq("store_id", queue.store_id);

    if (taskUpdateError) {
      throw new Error(`Agenda atualizada, mas falhou ao resolver tarefa: ${taskUpdateError.message}`);
    }

    await pushAssistantSystemMessage({
      supabase,
      organizationId: queue.organization_id,
      storeId: queue.store_id,
      content: `${task.customer_name || "O cliente"} confirmou. Atualizei ${appointment.title} para ${formatLocalDateTime(task.target_start_at, timezoneName)}.`,
      relatedLeadId: task.related_lead_id,
      relatedConversationId: task.related_conversation_id,
      relatedAppointmentId: task.related_appointment_id,
      metadata: {
        source: "assistant_operational_task_worker",
        queue_id: queue.id,
        task_id: task.id,
        appointment_id: appointment.id,
        decision,
      },
    });

    return {
      ok: true,
      decision,
      action: "appointment_rescheduled",
      appointmentId: appointment.id,
      taskId: task.id,
    };
  }

  if (decision.type === "rejected" || decision.type === "suggested_other_time") {
    const suggestedWindow =
      decision.type === "suggested_other_time"
        ? buildSuggestedRescheduleWindow({
            content: customerMessage,
            targetStartAt: task.target_start_at,
            targetEndAt: task.target_end_at,
            timezoneName,
          })
        : null;

    if (decision.type === "suggested_other_time" && isSameCustomerReply) {
      const sameSuggestedStart = Boolean(suggestedWindow?.startIso && taskPayload.suggested_start_at === suggestedWindow.startIso);
      const sameSuggestedLabel = Boolean(suggestedWindow?.suggestedLabel && taskPayload.suggested_label === suggestedWindow.suggestedLabel);
      const alreadyWaitingApproval = Boolean(taskPayload.needs_responsible_approval) || Boolean(taskPayload.suggested_label);

      if ((sameSuggestedStart || sameSuggestedLabel) && alreadyWaitingApproval) {
        return {
          ok: true,
          skipped: true,
          reason: "duplicate_customer_reply_already_processed",
          action: "duplicate_skipped",
          taskId: task.id,
          queueId: queue.id,
        };
      }
    }

    if (
      decision.type === "rejected" &&
      lastDecisionType === "rejected" &&
      String(taskPayload.last_customer_reply_normalized || "") === normalizedCustomerReply &&
      (!lastConversationId || lastConversationId === currentConversationId) &&
      Boolean(taskPayload.needs_new_time_negotiation)
    ) {
      return {
        ok: true,
        skipped: true,
        reason: "duplicate_customer_reply_already_processed",
        action: "duplicate_skipped",
        taskId: task.id,
        queueId: queue.id,
      };
    }

    const suggestedAvailability = suggestedWindow
      ? await checkSuggestedRescheduleAvailability({
          supabase,
          organizationId: queue.organization_id,
          storeId: queue.store_id,
          appointmentId: appointment.id,
          appointmentType: appointment.appointment_type || "other",
          startIso: suggestedWindow.startIso,
          endIso: suggestedWindow.endIso,
        })
      : null;

    const rescheduleAutonomy =
      decision.type === "suggested_other_time" && suggestedWindow && suggestedAvailability?.available
        ? await readCustomerRescheduleAutonomy({
            supabase,
            organizationId: queue.organization_id,
            storeId: queue.store_id,
          })
        : { configured: false, aiCanAcceptWithoutApproval: false, error: null as string | null };

    const canAutonomouslyAcceptSuggestedTime =
      decision.type === "suggested_other_time" &&
      Boolean(suggestedWindow) &&
      suggestedAvailability?.available === true &&
      rescheduleAutonomy.aiCanAcceptWithoutApproval === true;

    if (canAutonomouslyAcceptSuggestedTime && suggestedWindow) {
      await revalidateOperationalExecution({
        supabase,
        queueId: queue.id,
        taskId: task.id,
        organizationId: queue.organization_id,
        storeId: queue.store_id,
        appointmentId: appointment.id,
      });

      const { data: autonomouslyUpdatedAppointment, error: autonomousUpdateError } = await supabase.rpc(
        "update_store_appointment",
        {
          p_appointment_id: appointment.id,
          p_organization_id: queue.organization_id,
          p_store_id: queue.store_id,
          p_title: appointment.title,
          p_appointment_type: appointment.appointment_type,
          p_status: "rescheduled",
          p_scheduled_start: suggestedWindow.startIso,
          p_scheduled_end: suggestedWindow.endIso,
          p_customer_name: appointment.customer_name,
          p_customer_phone: appointment.customer_phone,
          p_address_text: appointment.address_text,
          p_notes: appointment.notes,
        },
      );

      if (autonomousUpdateError) {
        const failedPayload = appendTaskPayload(task.task_payload, {
          last_customer_reply: customerMessage,
          last_customer_reply_normalized: normalizedCustomerReply,
          last_customer_reply_message_id: queue.message_id,
          last_customer_reply_decision: decision,
          last_customer_reply_decision_type: decision.type,
          last_processed_queue_id: queue.id,
          last_processed_conversation_id: currentConversationId,
          appointment_update_attempted: true,
          appointment_update_succeeded: false,
          needs_new_time_negotiation: true,
          needs_responsible_approval: true,
          customer_reschedule_autonomy_configured: rescheduleAutonomy.configured,
          customer_reschedule_autonomy_allowed: true,
          autonomous_reschedule_error: autonomousUpdateError.message,
          suggested_start_at: suggestedWindow.startIso,
          suggested_end_at: suggestedWindow.endIso,
          suggested_label: suggestedWindow.suggestedLabel,
        });

        const { error: taskLifecycleError } = await supabase
          .from("store_assistant_operational_tasks")
          .update({
            status: "failed",
            error_text: autonomousUpdateError.message,
            task_payload: failedPayload,
            last_action_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", task.id)
          .eq("organization_id", queue.organization_id)
          .eq("store_id", queue.store_id);
        if (taskLifecycleError) throw new Error(`Falha ao registrar falha da remarcacao autonoma: ${taskLifecycleError.message}`);

        await pushAssistantInternalNotification({
          supabase,
          organizationId: queue.organization_id,
          storeId: queue.store_id,
          notificationType: "important_alert",
          title: "Remarcação automática não concluída",
          body: `O cliente sugeriu ${suggestedWindow.suggestedLabel}, mas não foi possível atualizar a agenda automaticamente. Revise a remarcação na Assistente.`,
          priority: "urgent",
          context: {
            source: "assistant_operational_task_worker",
            reason: "autonomous_customer_reschedule_update_failed",
            task_id: task.id,
            appointment_id: appointment.id,
            suggested_start_at: suggestedWindow.startIso,
            error: autonomousUpdateError.message,
          },
          relatedLeadId: task.related_lead_id,
          relatedConversationId: task.related_conversation_id,
          relatedAppointmentId: task.related_appointment_id,
          eventKey: `operational_task:${task.id}:autonomous_reschedule:${suggestedWindow.startIso}:update_failed`,
        });

        throw new Error(autonomousUpdateError.message);
      }

      let autonomousCustomerConfirmation: { sent: boolean; messageId: string | null };
      try {
        autonomousCustomerConfirmation = await sendCustomerRescheduleConfirmationMessage({
          supabase,
          organizationId: queue.organization_id,
          storeId: queue.store_id,
          task,
          appointment,
          startIso: suggestedWindow.startIso,
          timezoneName,
          queueId: queue.id,
        });
      } catch (error: any) {
        const message = error?.message || "Agenda atualizada, mas falhou ao avisar o cliente.";
        const partialFailurePayload = appendTaskPayload(task.task_payload, {
          last_customer_reply: customerMessage,
          last_customer_reply_normalized: normalizedCustomerReply,
          last_customer_reply_message_id: queue.message_id,
          last_customer_reply_decision: decision,
          last_customer_reply_decision_type: decision.type,
          last_processed_queue_id: queue.id,
          last_processed_conversation_id: currentConversationId,
          appointment_update_attempted: true,
          appointment_update_succeeded: true,
          updated_appointment: autonomouslyUpdatedAppointment,
          customer_confirmation_message_sent: false,
          customer_confirmation_message_id: null,
          needs_responsible_approval: true,
          customer_reschedule_autonomy_configured: rescheduleAutonomy.configured,
          customer_reschedule_autonomy_allowed: true,
          autonomous_reschedule_error: message,
          suggested_start_at: suggestedWindow.startIso,
          suggested_end_at: suggestedWindow.endIso,
          suggested_label: suggestedWindow.suggestedLabel,
        });

        const { error: taskLifecycleError } = await supabase
          .from("store_assistant_operational_tasks")
          .update({
            status: "failed",
            error_text: message,
            task_payload: partialFailurePayload,
            target_start_at: suggestedWindow.startIso,
            target_end_at: suggestedWindow.endIso,
            last_action_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", task.id)
          .eq("organization_id", queue.organization_id)
          .eq("store_id", queue.store_id);
        if (taskLifecycleError) throw new Error(`Falha ao registrar falha parcial da confirmacao autonoma: ${taskLifecycleError.message}`);

        await pushAssistantInternalNotification({
          supabase,
          organizationId: queue.organization_id,
          storeId: queue.store_id,
          notificationType: "important_alert",
          title: "Confirmação automática ao cliente falhou",
          body: `A agenda foi remarcada para ${suggestedWindow.suggestedLabel}, mas não foi possível confirmar automaticamente com o cliente. Confira a conversa e avise o cliente manualmente.`,
          priority: "urgent",
          context: {
            source: "assistant_operational_task_worker",
            reason: "autonomous_customer_reschedule_confirmation_failed",
            task_id: task.id,
            appointment_id: appointment.id,
            suggested_start_at: suggestedWindow.startIso,
            error: message,
          },
          relatedLeadId: task.related_lead_id,
          relatedConversationId: task.related_conversation_id,
          relatedAppointmentId: task.related_appointment_id,
          eventKey: `operational_task:${task.id}:autonomous_reschedule:${suggestedWindow.startIso}:customer_confirmation_failed`,
        });

        throw new Error(message);
      }

      const autonomousResolvedPayload = appendTaskPayload(task.task_payload, {
        last_customer_reply: customerMessage,
        last_customer_reply_normalized: normalizedCustomerReply,
        last_customer_reply_message_id: queue.message_id,
        last_customer_reply_decision: decision,
        last_customer_reply_decision_type: decision.type,
        last_processed_queue_id: queue.id,
        last_processed_conversation_id: currentConversationId,
        appointment_update_attempted: true,
        appointment_update_succeeded: true,
        updated_appointment: autonomouslyUpdatedAppointment,
        customer_confirmation_message_sent: Boolean(autonomousCustomerConfirmation.messageId),
        customer_confirmation_message_id: autonomousCustomerConfirmation.messageId || null,
        needs_new_time_negotiation: false,
        needs_responsible_approval: false,
        customer_reschedule_autonomy_configured: rescheduleAutonomy.configured,
        customer_reschedule_autonomy_allowed: true,
        autonomous_reschedule_completed: true,
        suggested_start_at: suggestedWindow.startIso,
        suggested_end_at: suggestedWindow.endIso,
        suggested_date: suggestedWindow.suggestedDate,
        suggested_time: suggestedWindow.suggestedTime,
        suggested_label: suggestedWindow.suggestedLabel,
        suggested_duration_minutes: suggestedWindow.durationMinutes,
        suggested_time_available: true,
        suggested_time_checked_at: new Date().toISOString(),
      });

      const { error: autonomousTaskUpdateError } = await supabase
        .from("store_assistant_operational_tasks")
        .update({
          status: "resolved",
          resolved_at: new Date().toISOString(),
          target_start_at: suggestedWindow.startIso,
          target_end_at: suggestedWindow.endIso,
          task_payload: autonomousResolvedPayload,
          description: "Cliente sugeriu outro horário disponível e a IA confirmou a remarcação automaticamente.",
          last_action_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", task.id)
        .eq("organization_id", queue.organization_id)
        .eq("store_id", queue.store_id);

      if (autonomousTaskUpdateError) {
        throw new Error(`Agenda atualizada, mas falhou ao resolver tarefa: ${autonomousTaskUpdateError.message}`);
      }

      await pushAssistantSystemMessage({
        supabase,
        organizationId: queue.organization_id,
        storeId: queue.store_id,
        content: `${task.customer_name || "O cliente"} sugeriu ${suggestedWindow.suggestedLabel}. A autonomia de remarcações está habilitada, então atualizei a agenda e confirmei o novo horário com o cliente.`,
        relatedLeadId: task.related_lead_id,
        relatedConversationId: task.related_conversation_id,
        relatedAppointmentId: task.related_appointment_id,
        metadata: {
          source: "assistant_operational_task_worker",
          queue_id: queue.id,
          task_id: task.id,
          appointment_id: appointment.id,
          decision,
          customer_reschedule_autonomy: true,
          suggested_window: suggestedWindow,
        },
      });

      return {
        ok: true,
        decision,
        action: "appointment_rescheduled_autonomously",
        appointmentId: appointment.id,
        taskId: task.id,
        suggestedWindow,
        suggestedAvailability,
      };
    }

    const updatedPayload = appendTaskPayload(task.task_payload, {
      last_customer_reply: customerMessage,
      last_customer_reply_normalized: normalizedCustomerReply,
      last_customer_reply_message_id: queue.message_id,
      last_customer_reply_decision: decision,
      last_customer_reply_decision_type: decision.type,
      last_processed_queue_id: queue.id,
      last_processed_conversation_id: currentConversationId,
      appointment_update_attempted: false,
      appointment_update_succeeded: false,
      needs_new_time_negotiation: true,
      needs_responsible_approval: decision.type === "suggested_other_time" && Boolean(suggestedWindow),
      suggested_start_at: suggestedWindow?.startIso || null,
      suggested_end_at: suggestedWindow?.endIso || null,
      suggested_date: suggestedWindow?.suggestedDate || null,
      suggested_time: suggestedWindow?.suggestedTime || null,
      suggested_label: suggestedWindow?.suggestedLabel || null,
      suggested_duration_minutes: suggestedWindow?.durationMinutes || null,
      suggested_time_available: suggestedAvailability?.available ?? null,
      suggested_time_unavailable_reason: suggestedAvailability?.available === false ? suggestedAvailability.reason : null,
      suggested_time_checked_at: suggestedWindow ? new Date().toISOString() : null,
    });

    const { error: taskUpdateError } = await supabase
      .from("store_assistant_operational_tasks")
      .update({
        status: "waiting_customer_response",
        task_payload: updatedPayload,
        last_action_at: new Date().toISOString(),
        description:
          decision.type === "suggested_other_time"
            ? "Cliente sugeriu outro horário. A agenda ainda não foi alterada."
            : "Cliente não confirmou o horário sugerido. A agenda ainda não foi alterada.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id)
      .eq("organization_id", queue.organization_id)
      .eq("store_id", queue.store_id);

    if (taskUpdateError) {
      throw new Error(taskUpdateError.message);
    }

    const suggestedApprovalText = (() => {
      if (decision.type !== "suggested_other_time") return null;
      if (!suggestedWindow) {
        return `${task.customer_name || "O cliente"} sugeriu outro horário: “${customerMessage}”. Não consegui transformar essa sugestão em data e hora com segurança. A agenda ainda não foi alterada.`;
      }
      if (suggestedAvailability?.available) {
        return `${task.customer_name || "O cliente"} sugeriu ${suggestedWindow.suggestedLabel}. Esse horário está livre na agenda. Quer que eu confirme com o cliente e atualize a agenda?`;
      }
      return `${task.customer_name || "O cliente"} sugeriu ${suggestedWindow.suggestedLabel}, mas esse horário não está livre: ${suggestedAvailability?.reason || "encontrei conflito na agenda"}. A agenda ainda não foi alterada.`;
    })();

    await pushAssistantSystemMessage({
      supabase,
      organizationId: queue.organization_id,
      storeId: queue.store_id,
      content:
        decision.type === "suggested_other_time"
          ? suggestedApprovalText || `${task.customer_name || "O cliente"} sugeriu outro horário: “${customerMessage}”. A agenda ainda não foi alterada.`
          : `${task.customer_name || "O cliente"} não confirmou o horário sugerido. A agenda continua como estava.`,
      relatedLeadId: task.related_lead_id,
      relatedConversationId: task.related_conversation_id,
      relatedAppointmentId: task.related_appointment_id,
      metadata: {
        source: "assistant_operational_task_worker",
        queue_id: queue.id,
        task_id: task.id,
        appointment_id: appointment.id,
        decision,
        suggested_window: suggestedWindow,
        suggested_availability: suggestedAvailability,
      },
    });

    if (decision.type === "suggested_other_time" && suggestedWindow && suggestedAvailability?.available) {
      const body = suggestedWindow.suggestedLabel
        ? `O cliente sugeriu ${suggestedWindow.suggestedLabel} para a visita. Esse horário parece estar livre, mas a agenda ainda não foi alterada. Entre na Assistente para aprovar ou recusar a remarcação.`
        : "O cliente sugeriu um novo horário para a visita. Esse horário parece estar livre, mas a agenda ainda não foi alterada. Entre na Assistente para aprovar ou recusar a remarcação.";

      await pushAssistantInternalNotification({
        supabase,
        organizationId: queue.organization_id,
        storeId: queue.store_id,
        notificationType: "important_alert",
        title: "Aprovação necessária para novo horário",
        body,
        priority: "urgent",
        context: {
          source: "assistant_operational_task_worker",
          reason: "customer_suggested_available_time_requires_approval",
          queue_id: queue.id,
          task_id: task.id,
          classification: "suggested_other_time",
          suggested_label: suggestedWindow.suggestedLabel ?? null,
          suggested_date: suggestedWindow.suggestedDate ?? null,
          suggested_time: suggestedWindow.suggestedTime ?? null,
          suggested_available: true,
        },
        relatedLeadId: task.related_lead_id,
        relatedConversationId: task.related_conversation_id,
        relatedAppointmentId: task.related_appointment_id,
        eventKey: `operational_task:${task.id}:suggested_other_time:${suggestedWindow.startIso}:${suggestedWindow.endIso}:approval_required`,
      });
    }

    return {
      ok: true,
      decision,
      action: decision.type === "suggested_other_time" ? "customer_suggested_other_time" : "customer_did_not_confirm_target_time",
      appointmentId: appointment.id,
      taskId: task.id,
      suggestedWindow,
      suggestedAvailability,
    };
  }

  const ambiguousPayload = appendTaskPayload(task.task_payload, {
    last_customer_reply: customerMessage,
    last_customer_reply_normalized: normalizedCustomerReply,
    last_customer_reply_message_id: queue.message_id,
    last_customer_reply_decision: decision,
    last_customer_reply_decision_type: decision.type,
    last_processed_queue_id: queue.id,
    last_processed_conversation_id: currentConversationId,
    appointment_update_attempted: false,
    appointment_update_succeeded: false,
  });

  const { error: taskLifecycleError } = await supabase
    .from("store_assistant_operational_tasks")
    .update({
      status: "waiting_customer_response",
      task_payload: ambiguousPayload,
      last_action_at: new Date().toISOString(),
      description: "Cliente respondeu, mas a confirmação ainda não ficou clara.",
      updated_at: new Date().toISOString(),
    })
    .eq("id", task.id)
    .eq("organization_id", queue.organization_id)
    .eq("store_id", queue.store_id);
  if (taskLifecycleError) throw new Error(`Falha ao registrar resposta ambigua da remarcacao: ${taskLifecycleError.message}`);

  await pushAssistantSystemMessage({
    supabase,
    organizationId: queue.organization_id,
    storeId: queue.store_id,
    content: `${task.customer_name || "O cliente"} respondeu, mas não ficou claro se confirmou a remarcação: “${customerMessage}”. A agenda ainda não foi alterada.`,
    relatedLeadId: task.related_lead_id,
    relatedConversationId: task.related_conversation_id,
    relatedAppointmentId: task.related_appointment_id,
    metadata: {
      source: "assistant_operational_task_worker",
      queue_id: queue.id,
      task_id: task.id,
      appointment_id: appointment.id,
      decision,
    },
  });

  return {
    ok: true,
    decision,
    action: "ambiguous_customer_reply",
    appointmentId: appointment.id,
    taskId: task.id,
  };
}

async function lockPendingQueueRow(args: {
  supabase: any;
  queueId: string;
  attempts: number | null | undefined;
  workerId: string;
}) {
  const now = new Date().toISOString();

  const { data: lockedRows, error: lockError } = await args.supabase
    .from("store_assistant_operational_task_queue")
    .update({
      status: "processing",
      attempts: (args.attempts || 0) + 1,
      locked_at: now,
      locked_by: args.workerId,
      updated_at: now,
    })
    .eq("id", args.queueId)
    .eq("status", "pending")
    .select("*");

  if (lockError) {
    throw new Error(lockError.message);
  }

  return ((lockedRows || [])[0] as QueueRow | undefined) || null;
}

export async function recoverStaleProcessingQueueRows(args: {
  supabase: any;
  organizationId?: string | null;
  storeId?: string | null;
  now?: Date;
}) {
  const now = args.now || new Date();
  const staleBefore = new Date(now.getTime() - QUEUE_STALE_LOCK_MS).toISOString();
  let query = args.supabase
    .from("store_assistant_operational_task_queue")
    .select("id,organization_id,store_id,task_id,locked_at")
    .eq("status", "processing")
    .lt("locked_at", staleBefore)
    .limit(50);

  if (args.organizationId) query = query.eq("organization_id", args.organizationId);
  if (args.storeId) query = query.eq("store_id", args.storeId);

  const { data: staleRows, error: loadError } = await query;
  if (loadError) throw new Error(`Falha ao localizar filas processing stale: ${loadError.message}`);

  const results: Array<{ queueId: string; ok: boolean; reason: string; error?: string }> = [];
  for (const row of (staleRows || []) as QueueRow[]) {
    const { error } = await args.supabase
      .from("store_assistant_operational_task_queue")
      .update({
        status: "failed",
        error_text: "Lock processing expirado; side effect incerto. Reconciliação manual obrigatória.",
        result_payload: {
          ok: false,
          reason: "stale_processing_manual_reconciliation",
          locked_at: row.locked_at || null,
          stale_before: staleBefore,
        },
        locked_at: null,
        locked_by: null,
        updated_at: now.toISOString(),
      })
      .eq("id", row.id)
      .eq("status", "processing");

    results.push(error
      ? { queueId: row.id, ok: false, reason: "stale_processing_write_failed", error: error.message }
      : { queueId: row.id, ok: true, reason: "stale_processing_manual_reconciliation" });
  }

  return results;
}

async function scheduleSafeQueueRetry(args: {
  supabase: any;
  queue: QueueRow;
  errorMessage: string;
}) {
  const attempts = Number(args.queue.attempts || 0);
  if (attempts >= MAX_SAFE_QUEUE_ATTEMPTS) return null;

  const { data: task, error: taskError } = await args.supabase
    .from("store_assistant_operational_tasks")
    .select("status,task_payload")
    .eq("id", args.queue.task_id)
    .eq("organization_id", args.queue.organization_id)
    .eq("store_id", args.queue.store_id)
    .maybeSingle();

  if (taskError || !task) return null;
  const payload = task.task_payload && typeof task.task_payload === "object" ? task.task_payload : {};
  const appointmentCreatePostWrite = payload.appointment_write_succeeded === true && Boolean(payload.appointment_id);
  const sideEffectAttempted = Boolean(
    payload.appointment_update_attempted ||
    payload.appointment_update_succeeded ||
    payload.customer_confirmation_message_sent ||
    payload.customer_confirmation_message_id,
  );

  if ((sideEffectAttempted && !appointmentCreatePostWrite) || task.status === "failed") return null;

  const availableAt = new Date(Date.now() + QUEUE_RETRY_DELAY_MS).toISOString();
  const { error } = await args.supabase
    .from("store_assistant_operational_task_queue")
    .update({
      status: "pending",
      available_at: availableAt,
      locked_at: null,
      locked_by: null,
      error_text: args.errorMessage,
      result_payload: {
        ok: false,
        reason: "safe_retry_scheduled",
        attempts,
        max_attempts: MAX_SAFE_QUEUE_ATTEMPTS,
        error: args.errorMessage,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.queue.id)
    .eq("status", "processing");

  if (error) return { ok: false as const, reason: "queue_retry_write_failed", error: error.message };
  return { ok: true as const, reason: "safe_retry_scheduled", attempts, maxAttempts: MAX_SAFE_QUEUE_ATTEMPTS };
}

async function processLockedQueueRowWithSubscriptionGuard(args: {
  supabase: any;
  queue: QueueRow;
  workerId: string;
}) {
  const subscription = await loadCanonicalOrganizationSubscription(
    args.supabase,
    args.queue.organization_id,
  );
  const subscriptionStatus = normalizeText(subscription?.status);

  if (subscriptionStatus === "suspended") {
    const message =
      "Organizacao suspensa. Tarefa operacional nao processada.";

    const { error: terminalQueueError } = await args.supabase
      .from("store_assistant_operational_task_queue")
      .update({
        status: "failed",
        error_text: message,
        result_payload: {
          ok: false,
          skipped: true,
          reason: "organization_subscription_suspended",
          subscriptionId: subscription?.id ?? null,
          subscriptionStatus: subscription?.status ?? null,
          workerId: args.workerId,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", args.queue.id);

    if (terminalQueueError) {
      return {
        ok: false,
        skipped: true,
        reason: "queue_terminal_write_failed",
        error: terminalQueueError.message,
      };
    }

    return {
      ok: false,
      skipped: true,
      reason: "organization_subscription_suspended",
      error: message,
    };
  }

  try {
    const result = await processQueueItem({
      supabase: args.supabase,
      queue: args.queue,
      workerId: args.workerId,
    });

    const { error: processedQueueError } = await args.supabase
      .from("store_assistant_operational_task_queue")
      .update({
        status: "processed",
        processed_at: new Date().toISOString(),
        result_payload: result,
        error_text: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", args.queue.id);

    if (processedQueueError) {
      return {
        ok: false,
        reason: "queue_processed_write_failed",
        error: processedQueueError.message,
        result,
      };
    }

    return {
      ok: true,
      skipped: Boolean(result?.skipped),
      reason: result?.reason,
      result,
    };
  } catch (error: any) {
    const message =
      error?.message || "Erro desconhecido ao processar fila operacional.";

    const retryResult = await scheduleSafeQueueRetry({
      supabase: args.supabase,
      queue: args.queue,
      errorMessage: message,
    });

    if (retryResult?.ok) {
      return {
        ok: false,
        skipped: true,
        reason: retryResult.reason,
        error: message,
      };
    }

    const { error: failedQueueError } = await args.supabase
      .from("store_assistant_operational_task_queue")
      .update({
        status: "failed",
        error_text: message,
        result_payload: {
          ok: false,
          error: message,
          workerId: args.workerId,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", args.queue.id);

    if (failedQueueError) {
      return {
        ok: false,
        error: `${message}; queue terminal write failed: ${failedQueueError.message}`,
        reason: "queue_failed_write_failed",
      };
    }

    return {
      ok: false,
      error: message,
    };
  }
}

export async function routeIncomingCustomerReplyToOperationalTask(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  conversationId: string;
  messageId: string;
  customerMessage: string;
  workerName?: string;
}) : Promise<RouteIncomingCustomerReplyToOperationalTaskResult> {
  const organizationId = String(args.organizationId || "").trim();
  const storeId = String(args.storeId || "").trim();
  const conversationId = String(args.conversationId || "").trim();
  const messageId = String(args.messageId || "").trim();
  const customerMessage = String(args.customerMessage || "").trim();

  if (!organizationId || !storeId || !conversationId || !messageId || !customerMessage) {
    return {
      handled: false,
      reason: "no_matching_operational_task",
    };
  }

  const { data: taskRow, error: taskError } = await args.supabase
    .from("store_assistant_operational_tasks")
    .select("id, status, task_type, related_conversation_id")
    .eq("organization_id", organizationId)
    .eq("store_id", storeId)
    .eq("related_conversation_id", conversationId)
    .in("task_type", ["appointment_reschedule_with_customer", "appointment_create_with_customer"])
    .eq("status", "waiting_customer_response")
    .limit(20);

  if (taskError) {
    throw new Error(taskError.message);
  }

  const matchingTaskRows = Array.isArray(taskRow) ? taskRow : taskRow ? [taskRow] : [];
  if (matchingTaskRows.length > 1) {
    return {
      handled: true,
      taskId: "",
      queueId: "",
      ok: false,
      skipped: true,
      reason: "multiple_waiting_operational_tasks",
      error: "Mais de uma task de remarcação aguarda a mesma resposta do cliente.",
    };
  }

  const taskId = String((matchingTaskRows[0] as { id?: string | null } | undefined)?.id || "").trim();
  if (!taskId) {
    return {
      handled: false,
      reason: "no_matching_operational_task",
    };
  }

  const { data: existingQueueRow, error: existingQueueError } = await args.supabase
    .from("store_assistant_operational_task_queue")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("store_id", storeId)
    .eq("task_id", taskId)
    .eq("conversation_id", conversationId)
    .eq("message_id", messageId)
    .limit(20);

  if (existingQueueError) {
    throw new Error(existingQueueError.message);
  }

  const existingQueueRows = Array.isArray(existingQueueRow) ? existingQueueRow : existingQueueRow ? [existingQueueRow] : [];
  if (existingQueueRows.length > 1) {
    return {
      handled: true,
      taskId,
      queueId: "",
      ok: false,
      skipped: true,
      reason: "duplicate_queue_rows_for_message",
      error: "Mais de uma fila existe para a mesma mensagem do cliente.",
    };
  }

  const existingQueue = (existingQueueRows[0] || null) as QueueRow | null;
  if (existingQueue?.id) {
    if (existingQueue.status === "processed") {
      return {
        handled: true,
        taskId,
        queueId: existingQueue.id,
        ok: true,
        skipped: true,
        reason: "duplicate_customer_reply_already_processed",
        result: (existingQueue as QueueRow & { result_payload?: any }).result_payload || null,
      };
    }

    if (existingQueue.status === "processing" || existingQueue.status === "pending") {
      return {
        handled: true,
        taskId,
        queueId: existingQueue.id,
        ok: true,
        skipped: true,
        reason: "duplicate_customer_reply_already_enqueued",
      };
    }

    if (existingQueue.status === "failed") {
      return {
        handled: true,
        taskId,
        queueId: existingQueue.id,
        ok: false,
        skipped: true,
        reason: "failed_customer_reply_requires_reconciliation",
        error: "A fila anterior falhou; não criei uma segunda fila para a mesma mensagem.",
      };
    }
  }

  const now = new Date().toISOString();
  const { data: insertedQueueRows, error: insertQueueError } = await args.supabase
    .from("store_assistant_operational_task_queue")
    .insert({
      organization_id: organizationId,
      store_id: storeId,
      task_id: taskId,
      conversation_id: conversationId,
      message_id: messageId,
      status: "pending",
      attempts: 0,
      available_at: now,
      payload: {
        source: "customer_reply_router",
        customer_message: customerMessage,
      },
      created_at: now,
      updated_at: now,
    })
    .select("*");

  if (insertQueueError) {
    throw new Error(insertQueueError.message);
  }

  const insertedQueue = ((insertedQueueRows || [])[0] as QueueRow | undefined) || null;
  if (!insertedQueue?.id) {
    throw new Error("Nao consegui confirmar a fila operacional criada para a resposta do cliente.");
  }

  const workerId = `${args.workerName || "assistant-operational-inline-router"}-${Date.now()}`;
  const lockedQueue = await lockPendingQueueRow({
    supabase: args.supabase,
    queueId: insertedQueue.id,
    attempts: insertedQueue.attempts,
    workerId,
  });

  if (!lockedQueue) {
    return {
      handled: true,
      taskId,
      queueId: insertedQueue.id,
      ok: true,
      skipped: true,
      reason: "queue_row_not_locked",
    };
  }

  const processed = await processLockedQueueRowWithSubscriptionGuard({
    supabase: args.supabase,
    queue: lockedQueue,
    workerId,
  });

  return {
    handled: true,
    taskId,
    queueId: lockedQueue.id,
    ok: processed.ok,
    skipped: processed.skipped,
    reason: processed.reason,
    result: processed.result,
    error: processed.error,
  };
}

export async function processAssistantOperationalTasks(
  params: ProcessAssistantOperationalTasksParams
): Promise<ProcessAssistantOperationalTasksResult> {
  const organizationId = String(params.organizationId || "").trim();
  const storeId = String(params.storeId || "").trim();
  const limit = Math.min(Math.max(Number(params.limit || 10), 1), 50);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Verifique NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const workerId = `${params.workerName || "assistant-operational-worker"}-${Date.now()}`;

  await recoverStaleProcessingQueueRows({
    supabase,
    organizationId: organizationId || null,
    storeId: storeId || null,
  });

  let query = supabase
    .from("store_assistant_operational_task_queue")
    .select("*")
    .eq("status", "pending")
    .lte("available_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(limit);

  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }

  if (storeId) {
    query = query.eq("store_id", storeId);
  }

  const { data: pendingRows, error: pendingError } = await query;

  if (pendingError) {
    throw new Error(`Falha ao carregar fila operacional pendente: ${pendingError.message}`);
  }

  const selected = (pendingRows || []) as QueueRow[];
  const results: ProcessAssistantOperationalTasksResult["results"] = [];

  for (const row of selected) {
    const now = new Date().toISOString();

    const { data: lockedRows, error: lockError } = await supabase
      .from("store_assistant_operational_task_queue")
      .update({
        status: "processing",
        attempts: (row.attempts || 0) + 1,
        locked_at: now,
        locked_by: workerId,
        updated_at: now,
      })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("*");

    if (lockError) {
      results.push({ queueId: row.id, ok: false, error: lockError.message });
      continue;
    }

    const locked = (lockedRows || [])[0] as QueueRow | undefined;

    if (!locked) {
      results.push({ queueId: row.id, ok: false, skipped: true, reason: "not_locked" });
      continue;
    }

    const processed = await processLockedQueueRowWithSubscriptionGuard({
      supabase,
      queue: locked,
      workerId,
    });

    if (processed.ok) {
      results.push({
        queueId: locked.id,
        ok: true,
        skipped: processed.skipped,
        reason: processed.reason,
        result: processed.result,
      });
      continue;
    }

    results.push({
      queueId: locked.id,
      ok: false,
      skipped: processed.skipped,
      reason: processed.reason,
      error: processed.error,
    });
  }

  return {
    ok: true,
    processed: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    total: results.length,
    results,
  };
}
