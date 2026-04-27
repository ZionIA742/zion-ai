import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProcessBody = {
  organizationId?: string;
  storeId?: string;
  limit?: number;
};

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

function isInternalRequestAuthorized(req: Request) {
  const secretFromEnv = process.env.AI_INTERNAL_ROUTE_SECRET;
  const secretFromHeader =
    req.headers.get("x-zion-internal-secret") ||
    req.headers.get("x-internal-secret") ||
    "";

  if (!secretFromEnv) {
    return { ok: false, mode: "missing_env_secret" as const };
  }

  if (secretFromHeader !== secretFromEnv) {
    return { ok: false, mode: "invalid_header_secret" as const };
  }

  return { ok: true, mode: "authorized_by_secret" as const };
}

function normalizeText(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function classifyCustomerReply(content: string): CustomerReplyDecision {
  const text = normalizeText(content);

  const hasConfirmation =
    /\b(sim|pode|pode ser|confirmado|confirmo|fechado|combinado|ok|blz|beleza|esta bom|ta bom|serve|da certo|dá certo|pode marcar|marca|marcar nesse horario|esse horario serve)\b/i.test(
      text
    );

  const hasRejection =
    /\b(nao|não|nao posso|não posso|nao consigo|não consigo|nesse horario nao|nesse horário não|outro dia|outro horario|outro horário|melhor nao|melhor não)\b/i.test(
      text
    );

  const suggestsOtherTime =
    /\b(amanha|amanhã|hoje|segunda|terca|terça|quarta|quinta|sexta|sabado|sábado|domingo|\d{1,2}[h:]\d{0,2})\b/i.test(
      text
    ) &&
    /\b(pode ser|seria|prefiro|melhor|as|às|a partir|depois|antes)\b/i.test(text) &&
    !hasConfirmation;

  if (hasConfirmation && !hasRejection) {
    return { type: "confirmed", reason: "customer_confirmed_target_time" };
  }

  if (suggestsOtherTime) {
    return { type: "suggested_other_time", reason: "customer_suggested_another_time", rawText: content };
  }

  if (hasRejection) {
    return { type: "rejected", reason: "customer_rejected_target_time" };
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
  const { supabase, queue, workerId } = args;

  const customerMessage = String(queue.payload?.customer_message || "").trim();
  const decision = classifyCustomerReply(customerMessage);

  const { data: task, error: taskError } = await supabase
    .from("store_assistant_operational_tasks")
    .select("*")
    .eq("id", queue.task_id)
    .eq("organization_id", queue.organization_id)
    .eq("store_id", queue.store_id)
    .maybeSingle();

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

  const { data: appointment, error: appointmentError } = await supabase
    .from("store_appointments")
    .select("*")
    .eq("id", task.related_appointment_id)
    .eq("organization_id", queue.organization_id)
    .eq("store_id", queue.store_id)
    .maybeSingle();

  if (appointmentError || !appointment) {
    throw new Error(appointmentError?.message || "Compromisso vinculado não encontrado.");
  }

  const timezoneName = task.timezone_name || "America/Sao_Paulo";

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
      action: "customer_did_not_confirm_target_time",
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

export async function POST(req: Request) {
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

  try {
    const body = (await req.json().catch(() => ({}))) as ProcessBody;
    const organizationId = String(body.organizationId || "").trim();
    const storeId = String(body.storeId || "").trim();
    const limit = Math.min(Math.max(Number(body.limit || 5), 1), 20);

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
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "SUPABASE_ENV_MISSING",
          message: "Verifique NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.",
        },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const workerId = `assistant-operational-worker-${Date.now()}`;

    const { data: pendingRows, error: pendingError } = await supabase
      .from("store_assistant_operational_task_queue")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .eq("status", "pending")
      .lte("available_at", new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(limit);

    if (pendingError) {
      return NextResponse.json(
        {
          ok: false,
          error: "LOAD_PENDING_QUEUE_FAILED",
          message: pendingError.message,
        },
        { status: 500 }
      );
    }

    const selected = (pendingRows || []) as QueueRow[];
    const results: any[] = [];

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

    return NextResponse.json({
      ok: true,
      processed: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
      total: results.length,
      results,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "ASSISTANT_OPERATIONAL_TASK_PROCESS_FAILED",
        message:
          error?.message || "Erro interno ao processar tarefas operacionais da assistente.",
      },
      { status: 500 }
    );
  }
}
