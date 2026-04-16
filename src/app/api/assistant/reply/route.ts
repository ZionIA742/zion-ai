import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type AssistantThreadRow = {
  id: string;
  organization_id: string;
  store_id: string;
  thread_type: string;
  status: string;
  title: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
};

type AssistantMessageRow = {
  id: string;
  thread_id: string;
  sender: string;
  sender_role: string;
  direction: string;
  message_type: string;
  content: string;
  related_lead_id: string | null;
  related_conversation_id: string | null;
  related_appointment_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type StoreRow = {
  id: string;
  organization_id: string;
  name: string | null;
};

type StoreAnswerRow = {
  question_key: string;
  answer: unknown;
};

type AppointmentRow = {
  id: string;
  title: string | null;
  appointment_type: string | null;
  status: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  lead_id: string | null;
  conversation_id: string | null;
  address_text: string | null;
  notes: string | null;
};

type NotificationRow = {
  id: string;
  notification_type: string;
  priority: string;
  status: string;
  title: string | null;
  body: string;
  related_lead_id: string | null;
  related_conversation_id: string | null;
  related_appointment_id: string | null;
  created_at: string;
  available_at: string;
};

function asText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const parts = value.map(asText).filter(Boolean) as string[];
    return parts.length ? parts.join(", ") : null;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function normalizeText(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
}

function startAndEndOfToday() {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

function buildRecentMessagesBlock(messages: AssistantMessageRow[]): string {
  if (!messages.length) return "Sem mensagens anteriores na thread.";

  return messages
    .slice(-12)
    .map((message) => {
      const role = message.sender_role === "assistant_operational" ? "Assistente" : "Responsável";
      return `${role}: ${message.content}`;
    })
    .join("\n");
}

function buildAgendaBlock(appointments: AppointmentRow[]): string {
  if (!appointments.length) return "Nenhum compromisso encontrado para hoje.";

  return appointments
    .slice(0, 8)
    .map((appointment) => {
      return [
        `- ${appointment.title || "Compromisso"}`,
        appointment.appointment_type ? `tipo: ${appointment.appointment_type}` : null,
        appointment.status ? `status: ${appointment.status}` : null,
        appointment.scheduled_start ? `início: ${formatDateTime(appointment.scheduled_start)}` : null,
        appointment.address_text ? `endereço: ${appointment.address_text}` : null,
        appointment.notes ? `obs: ${appointment.notes}` : null,
      ]
        .filter(Boolean)
        .join(" | ");
    })
    .join("\n");
}

function buildNotificationsBlock(rows: NotificationRow[]): string {
  if (!rows.length) return "Nenhuma pendência pendente na fila da assistente.";

  return rows
    .slice(0, 6)
    .map((row) => {
      return [
        `- ${row.title || row.notification_type}`,
        `prioridade: ${row.priority}`,
        `status: ${row.status}`,
        `disponível em: ${formatDateTime(row.available_at)}`,
        `texto: ${row.body}`,
      ]
        .filter(Boolean)
        .join(" | ");
    })
    .join("\n");
}

function mapMessagesToInput(messages: AssistantMessageRow[]) {
  return messages
    .filter((message) => String(message.content || "").trim().length > 0)
    .slice(-12)
    .map((message) => ({
      role: message.sender_role === "assistant_operational" ? ("assistant" as const) : ("user" as const),
      content: message.content,
    }));
}

function buildInstructions(args: {
  storeName: string | null;
  onboardingMap: Record<string, string>;
  recentMessagesBlock: string;
  agendaBlock: string;
  notificationsBlock: string;
  totalAppointmentsToday: number;
  pendingNotifications: number;
}) {
  const storeLabel = args.onboardingMap.store_display_name || args.storeName || "a loja";
  const responsibleName = args.onboardingMap.responsible_name || "responsável da loja";

  return `
Você é a IA assistente operacional do projeto ZION atendendo internamente a loja ${storeLabel}.
Você fala com o responsável da loja, não com o cliente final.

MISSÃO
- ajudar o responsável a entender a operação do dia
- responder dúvidas operacionais com contexto e clareza
- resumir o que importa
- indicar próximos passos práticos
- nunca deixar o humano perdido

REGRAS FIXAS
- responda sempre em português do Brasil
- seja humana, clara, direta e útil
- não aja como IA comercial de cliente final
- não tente vender
- não invente fatos operacionais
- se faltar base, diga isso claramente
- quando houver risco, urgência ou dependência humana, destaque isso
- prefira respostas curtas ou médias, bem organizadas e acionáveis
- quando o responsável pedir um resumo, entregue resumo de verdade
- quando houver pendência, deixe claro o que precisa ser feito agora

CONTEXTO DA LOJA
- nome da loja: ${storeLabel}
- responsável: ${responsibleName}
- cidade: ${args.onboardingMap.city || "não informado"}
- estado: ${args.onboardingMap.state || "não informado"}
- regras para notificar responsável: ${args.onboardingMap.responsible_notification_cases || "não informado"}
- limitações importantes: ${args.onboardingMap.important_limitations || "não informado"}

AGENDA DE HOJE
- total de compromissos hoje: ${args.totalAppointmentsToday}
${args.agendaBlock}

PENDÊNCIAS DA ASSISTENTE
- pendências pendentes: ${args.pendingNotifications}
${args.notificationsBlock}

HISTÓRICO RECENTE DA THREAD
${args.recentMessagesBlock}

COMO RESPONDER
- comece respondendo exatamente o pedido do responsável
- se ele pedir resumo, entregue um resumo prático em blocos curtos
- se ele fizer pergunta objetiva, responda primeiro e depois acrescente o que importa
- quando existir ação recomendada, termine com o próximo passo mais útil
- se não houver dados suficientes para responder tudo, deixe claro o que está faltando

SAÍDA OBRIGATÓRIA
- gere apenas a mensagem final da assistente
- não explique seu raciocínio
- não use markdown pesado
- não use títulos em excesso
- não escreva observações para o sistema
`.trim();
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const organizationId = String(body?.organizationId || "").trim();
    const storeId = String(body?.storeId || "").trim();

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
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const model = process.env.ZION_AI_ASSISTANT_MODEL || "gpt-4.1-mini";

    if (!supabaseUrl || !supabaseServiceKey) {
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

    if (!openaiApiKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "OPENAI_ENV_MISSING",
          message: "Verifique OPENAI_API_KEY nas variáveis de ambiente.",
        },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const openai = new OpenAI({ apiKey: openaiApiKey });

    const { data: threadData, error: threadError } = await supabase.rpc(
      "assistant_get_or_create_primary_thread",
      {
        p_organization_id: organizationId,
        p_store_id: storeId,
      }
    );

    if (threadError || !threadData) {
      return NextResponse.json(
        {
          ok: false,
          error: "THREAD_LOAD_FAILED",
          message: threadError?.message || "Não foi possível carregar a thread da assistente.",
        },
        { status: 500 }
      );
    }

    const thread = threadData as AssistantThreadRow;

    const { data: store, error: storeError } = await supabase
      .from("stores")
      .select("id, organization_id, name")
      .eq("id", storeId)
      .eq("organization_id", organizationId)
      .maybeSingle<StoreRow>();

    if (storeError || !store) {
      return NextResponse.json(
        {
          ok: false,
          error: "STORE_NOT_FOUND",
          message: storeError?.message || "Loja não encontrada para os dados informados.",
        },
        { status: 404 }
      );
    }

    const { data: onboardingAnswers, error: onboardingError } = await supabase
      .from("store_onboarding_answers")
      .select("question_key, answer")
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .in("question_key", [
        "store_display_name",
        "responsible_name",
        "city",
        "state",
        "important_limitations",
        "responsible_notification_cases",
      ]);

    if (onboardingError) {
      return NextResponse.json(
        {
          ok: false,
          error: "LOAD_ONBOARDING_FAILED",
          message: onboardingError.message,
        },
        { status: 500 }
      );
    }

    const onboardingMap: Record<string, string> = {};
    for (const row of (onboardingAnswers || []) as StoreAnswerRow[]) {
      const text = asText(row.answer);
      if (text) onboardingMap[row.question_key] = text;
    }

    const { data: messagesData, error: messagesError } = await supabase
      .from("store_assistant_messages")
      .select(
        "id, thread_id, sender, sender_role, direction, message_type, content, related_lead_id, related_conversation_id, related_appointment_id, metadata, created_at"
      )
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .eq("thread_id", thread.id)
      .order("created_at", { ascending: true })
      .limit(20);

    if (messagesError) {
      return NextResponse.json(
        {
          ok: false,
          error: "LOAD_MESSAGES_FAILED",
          message: messagesError.message,
        },
        { status: 500 }
      );
    }

    const messages = (messagesData || []) as AssistantMessageRow[];
    const lastHumanMessage = [...messages]
      .reverse()
      .find(
        (message) =>
          normalizeText(message.sender_role) === "store_responsible" &&
          normalizeText(message.direction) === "incoming" &&
          String(message.content || "").trim().length > 0
      );

    if (!lastHumanMessage) {
      return NextResponse.json(
        {
          ok: false,
          error: "NO_HUMAN_MESSAGE",
          message: "Não encontrei uma mensagem recente do responsável para responder.",
        },
        { status: 400 }
      );
    }

    const { startIso, endIso } = startAndEndOfToday();

    const { data: appointmentsData, error: appointmentsError } = await supabase
      .from("store_appointments")
      .select(
        "id, title, appointment_type, status, scheduled_start, scheduled_end, lead_id, conversation_id, address_text, notes"
      )
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .gte("scheduled_start", startIso)
      .lte("scheduled_start", endIso)
      .order("scheduled_start", { ascending: true })
      .limit(12);

    if (appointmentsError) {
      return NextResponse.json(
        {
          ok: false,
          error: "LOAD_APPOINTMENTS_FAILED",
          message: appointmentsError.message,
        },
        { status: 500 }
      );
    }

    const appointments = (appointmentsData || []) as AppointmentRow[];

    const { data: notificationRowsData, error: notificationsError } = await supabase
      .from("store_assistant_notification_queue")
      .select(
        "id, notification_type, priority, status, title, body, related_lead_id, related_conversation_id, related_appointment_id, created_at, available_at"
      )
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .eq("status", "pending")
      .order("available_at", { ascending: true })
      .limit(10);

    if (notificationsError) {
      return NextResponse.json(
        {
          ok: false,
          error: "LOAD_NOTIFICATIONS_FAILED",
          message: notificationsError.message,
        },
        { status: 500 }
      );
    }

    const notificationRows = (notificationRowsData || []) as NotificationRow[];

    const instructions = buildInstructions({
      storeName: store.name,
      onboardingMap,
      recentMessagesBlock: buildRecentMessagesBlock(messages),
      agendaBlock: buildAgendaBlock(appointments),
      notificationsBlock: buildNotificationsBlock(notificationRows),
      totalAppointmentsToday: appointments.length,
      pendingNotifications: notificationRows.length,
    });

    const input = [
      ...mapMessagesToInput(messages),
      {
        role: "user" as const,
        content: lastHumanMessage.content,
      },
    ];

    const response = await openai.responses.create({
      model,
      instructions,
      input,
      max_output_tokens: 260,
    });

    const aiText = String(response.output_text || "").trim();

    if (!aiText) {
      return NextResponse.json(
        {
          ok: false,
          error: "EMPTY_AI_RESPONSE",
          message: "A OpenAI não retornou texto utilizável para a assistente.",
        },
        { status: 500 }
      );
    }

    const { data: savedMessage, error: saveError } = await supabase.rpc(
      "assistant_push_system_message",
      {
        p_organization_id: organizationId,
        p_store_id: storeId,
        p_content: aiText,
        p_message_type: "text",
        p_related_lead_id: null,
        p_related_conversation_id: null,
        p_related_appointment_id: null,
        p_metadata: {
          source: "assistant_reply_route",
          responded_to_message_id: lastHumanMessage.id,
          pending_notifications: notificationRows.length,
          appointments_today: appointments.length,
        },
      }
    );

    if (saveError) {
      return NextResponse.json(
        {
          ok: false,
          error: "SAVE_ASSISTANT_MESSAGE_FAILED",
          message: saveError.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      threadId: thread.id,
      aiText,
      savedMessage,
      context: {
        storeName: onboardingMap.store_display_name || store.name,
        pendingNotifications: notificationRows.length,
        appointmentsToday: appointments.length,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "ASSISTANT_REPLY_ROUTE_FAILED",
        message: error?.message || "Erro interno ao gerar resposta da assistente.",
      },
      { status: 500 }
    );
  }
}
