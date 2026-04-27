import { createClient } from "@supabase/supabase-js";

type QueueRow = {
  id: string;
  organization_id: string;
  store_id: string;
  task_id: string;
  conversation_id: string;
  message_id: string;
  status: string;
  attempts: number | null;
  payload: Record<string, any> | null;
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

function normalizeText(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function classifyCustomerReply(content: string): CustomerReplyDecision {
  const text = normalizeText(content);

  const hasRejection =
    /(?:^|\s)(nao|não|nao posso|não posso|nao consigo|não consigo|nesse horario nao|nesse horário não|outro dia|outro horario|outro horário|melhor nao|melhor não)(?:\s|$|[.!?,])/i.test(
      text
    );

  const hasConfirmation =
    /(?:^|\s)(sim|confirmado|confirmo|fechado|combinado|ok|blz|beleza|esta bom|ta bom|serve|da certo|dá certo|pode marcar|marca|marcar nesse horario|esse horario serve)(?:\s|$|[.!?,])/i.test(
      text
    ) || /(?:^|\s)pode ser(?:\s|$|[.!?,])/i.test(text);

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

async function processQueueItem(args: {
  supabase: any;
  queue: QueueRow;
  workerId: string;
}) {
  const { supabase, queue } = args;

  const customerMessage = String(queue.payload?.customer_message || "").trim();
  let decision = classifyCustomerReply(customerMessage);

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

  if (task.status !== "waiting_customer_response") {
    await supabase
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

    return {
      ok: true,
      skipped: true,
      reason: "task_no_longer_waiting_customer_response",
    };
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

  const timezoneName = task.timezone_name || "America/Sao_Paulo";

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

  if (decision.type === "confirmed") {
    if (!task.target_start_at || !task.target_end_at) {
      throw new Error("Cliente confirmou, mas a tarefa não tem target_start_at/target_end_at.");
    }

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
        last_customer_reply_message_id: queue.message_id,
        last_customer_reply_decision: decision,
        last_execution_error: updateError.message,
        appointment_update_attempted: true,
        appointment_update_succeeded: false,
      });

      await supabase
        .from("store_assistant_operational_tasks")
        .update({
          status: "failed",
          error_text: updateError.message,
          task_payload: failedPayload,
          last_action_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", task.id);

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

    const resolvedPayload = appendTaskPayload(task.task_payload, {
      last_customer_reply: customerMessage,
      last_customer_reply_message_id: queue.message_id,
      last_customer_reply_decision: decision,
      appointment_update_attempted: true,
      appointment_update_succeeded: true,
      updated_appointment: updatedAppointment,
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
    const updatedPayload = appendTaskPayload(task.task_payload, {
      last_customer_reply: customerMessage,
      last_customer_reply_message_id: queue.message_id,
      last_customer_reply_decision: decision,
      appointment_update_attempted: false,
      appointment_update_succeeded: false,
      needs_new_time_negotiation: true,
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

    await pushAssistantSystemMessage({
      supabase,
      organizationId: queue.organization_id,
      storeId: queue.store_id,
      content:
        decision.type === "suggested_other_time"
          ? `${task.customer_name || "O cliente"} sugeriu outro horário: “${customerMessage}”. A agenda ainda não foi alterada.`
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
      },
    });

    return {
      ok: true,
      decision,
      action: decision.type === "suggested_other_time" ? "customer_suggested_other_time" : "customer_did_not_confirm_target_time",
      appointmentId: appointment.id,
      taskId: task.id,
    };
  }

  const ambiguousPayload = appendTaskPayload(task.task_payload, {
    last_customer_reply: customerMessage,
    last_customer_reply_message_id: queue.message_id,
    last_customer_reply_decision: decision,
    appointment_update_attempted: false,
    appointment_update_succeeded: false,
  });

  await supabase
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

    try {
      const result = await processQueueItem({ supabase, queue: locked, workerId });

      await supabase
        .from("store_assistant_operational_task_queue")
        .update({
          status: "processed",
          processed_at: new Date().toISOString(),
          result_payload: result,
          error_text: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", locked.id);

      results.push({ queueId: locked.id, ok: true, result });
    } catch (error: any) {
      const message = error?.message || "Erro desconhecido ao processar fila operacional.";

      await supabase
        .from("store_assistant_operational_task_queue")
        .update({
          status: "failed",
          error_text: message,
          result_payload: {
            ok: false,
            error: message,
            workerId,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", locked.id);

      results.push({ queueId: locked.id, ok: false, error: message });
    }
  }

  return {
    ok: true,
    processed: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    total: results.length,
    results,
  };
}
