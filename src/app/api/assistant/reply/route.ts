import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type AssistantMessageRow = {
  id: string;
  sender: string;
  sender_role: string;
  direction: string;
  message_type: string;
  content: string;
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
  customer_name: string | null;
  customer_phone: string | null;
  address_text: string | null;
  notes: string | null;
  lead_id: string | null;
  conversation_id: string | null;
};

type NotificationQueueRow = {
  id: string;
  notification_type: string;
  priority: string;
  status: string;
  title: string | null;
  body: string;
  related_lead_id: string | null;
  related_conversation_id: string | null;
  related_appointment_id: string | null;
  available_at: string;
  created_at: string;
};

type AssistantReplyRequestBody = {
  organizationId?: string;
  storeId?: string;
};

const ONBOARDING_KEYS = [
  "store_display_name",
  "responsible_name",
  "responsible_whatsapp",
  "store_services",
  "city",
  "state",
  "offers_installation",
  "offers_technical_visit",
  "installation_available_days",
  "technical_visit_available_days",
  "important_limitations",
  "responsible_notification_cases",
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
  if (Array.isArray(value)) {
    const items = value.map(asText).filter(Boolean) as string[];
    return items.length ? items.join(", ") : null;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function normalizeText(value: string | null | undefined): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
}

function formatItemType(value: string | null | undefined): string {
  const normalized = normalizeText(value);
  if (normalized === "technical_visit") return "Visita técnica";
  if (normalized === "installation") return "Instalação";
  if (normalized === "follow_up") return "Retorno";
  if (normalized === "meeting") return "Reunião";
  if (normalized === "measurement") return "Medição";
  if (normalized === "maintenance") return "Manutenção";
  if (normalized === "other") return "Outro";
  return value || "-";
}

function formatStatus(value: string | null | undefined): string {
  const normalized = normalizeText(value);
  if (normalized === "scheduled") return "Agendado";
  if (normalized === "rescheduled") return "Remarcado";
  if (normalized === "completed") return "Concluído";
  if (normalized === "cancelled") return "Cancelado";
  if (normalized === "blocked") return "Bloqueado";
  return value || "-";
}

function formatHistory(messages: AssistantMessageRow[]): string {
  if (!messages.length) return "- sem histórico anterior";

  return messages
    .slice(-12)
    .map((message) => {
      const label = message.sender === "assistant" ? "Assistente" : message.sender === "human" ? "Responsável" : "Sistema";
      return `${label}: ${message.content}`;
    })
    .join("\n");
}

function buildAppointmentsSection(title: string, items: AppointmentRow[]): string {
  if (!items.length) return `${title}\n- nenhum`;

  return `${title}\n${items
    .map((item) => {
      const parts = [
        `- ${formatDateTime(item.scheduled_start)}`,
        formatItemType(item.appointment_type),
        formatStatus(item.status),
        item.title || null,
        item.customer_name ? `cliente: ${item.customer_name}` : null,
        item.customer_phone ? `telefone: ${item.customer_phone}` : null,
        item.address_text ? `endereço: ${item.address_text}` : null,
        item.notes ? `notas: ${item.notes}` : null,
      ].filter(Boolean);

      return parts.join(" | ");
    })
    .join("\n")}`;
}

function buildNotificationsSection(items: NotificationQueueRow[]): string {
  if (!items.length) return "PENDÊNCIAS DA ASSISTENTE\n- nenhuma pendência pendente na fila";

  return `PENDÊNCIAS DA ASSISTENTE\n${items
    .map((item) => {
      const parts = [
        `- ${item.notification_type}`,
        `prioridade: ${item.priority}`,
        item.title ? `título: ${item.title}` : null,
        `disponível em: ${formatDateTime(item.available_at)}`,
        item.related_appointment_id ? `appointment: ${item.related_appointment_id.slice(0, 8)}` : null,
        item.related_lead_id ? `lead: ${item.related_lead_id.slice(0, 8)}` : null,
        `texto: ${item.body}`,
      ].filter(Boolean);

      return parts.join(" | ");
    })
    .join("\n")}`;
}

function buildOperationalPrompt(args: {
  responsibleName: string;
  storeDisplayName: string;
  onboardingMap: Record<string, string>;
  historyText: string;
  todayAppointmentsText: string;
  upcomingAppointmentsText: string;
  overdueAppointmentsText: string;
  notificationsText: string;
  latestHumanMessage: string;
}) {
  return `
Você é a assistente operacional interna da loja ${args.storeDisplayName} dentro do ZION.
Você conversa com o responsável da loja, não com cliente final.

MISSÃO
- ajudar a operação da loja no dia a dia
- responder com clareza, contexto e objetividade
- usar o contexto da agenda e das pendências abaixo
- evitar deixar o responsável perdido

COMO VOCÊ DEVE FALAR
- em português do Brasil
- humana, clara e direta
- útil e acionável
- sem parecer robô
- sem falar como vendedora para cliente
- sem inventar dados que não estão no contexto

REGRAS IMPORTANTES
- você é a assistente operacional, não a IA vendedora
- quando houver contexto suficiente, responda já com resumo e próximos passos
- quando faltar dado, diga o que falta de forma simples
- se houver algo urgente, destaque isso primeiro
- quando citar compromisso, inclua contexto útil: horário, tipo, cliente, telefone, endereço e observação, quando houver
- se a pergunta for sobre hoje, priorize agenda do dia, atrasos e pendências
- se houver pendência na fila da assistente, considere isso na resposta
- não invente status, compromissos, clientes ou notificações
- não use markdown pesado
- não use títulos exagerados
- não escreva observações para o sistema

DADOS BÁSICOS DA LOJA
- loja: ${args.storeDisplayName}
- responsável: ${args.responsibleName}
- cidade: ${args.onboardingMap.city || "-"}
- estado: ${args.onboardingMap.state || "-"}
- serviços: ${args.onboardingMap.store_services || "-"}
- oferece instalação: ${args.onboardingMap.offers_installation || "-"}
- oferece visita técnica: ${args.onboardingMap.offers_technical_visit || "-"}
- dias de instalação: ${args.onboardingMap.installation_available_days || "-"}
- dias de visita técnica: ${args.onboardingMap.technical_visit_available_days || "-"}
- limitações importantes: ${args.onboardingMap.important_limitations || "-"}
- casos para avisar responsável: ${args.onboardingMap.responsible_notification_cases || "-"}

HISTÓRICO RECENTE DA CONVERSA INTERNA
${args.historyText}

${args.todayAppointmentsText}

${args.upcomingAppointmentsText}

${args.overdueAppointmentsText}

${args.notificationsText}

ÚLTIMA MENSAGEM DO RESPONSÁVEL
${args.latestHumanMessage}

SAÍDA OBRIGATÓRIA
- responda como mensagem final para o responsável
- seja útil e prática
- se houver algo urgente hoje, comece por isso
- se não houver urgência, responda normalmente e sugira o próximo passo útil quando fizer sentido
`.trim();
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AssistantReplyRequestBody;

    const organizationId = String(body.organizationId || "").trim();
    const storeId = String(body.storeId || "").trim();

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
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const model = process.env.ZION_ASSISTANT_MODEL || "gpt-4.1-mini";

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "SUPABASE_ENV_MISSING",
          message: "Verifique NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.",
        },
        { status: 500 }
      );
    }

    if (!openaiApiKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "OPENAI_ENV_MISSING",
          message: "Verifique OPENAI_API_KEY.",
        },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
    const openai = new OpenAI({ apiKey: openaiApiKey });

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
          message: storeError?.message || "Loja não encontrada.",
        },
        { status: 404 }
      );
    }

    const { data: thread, error: threadError } = await supabase.rpc(
      "assistant_get_or_create_primary_thread",
      {
        p_organization_id: organizationId,
        p_store_id: storeId,
      }
    );

    if (threadError || !thread) {
      return NextResponse.json(
        {
          ok: false,
          error: "ASSISTANT_THREAD_FAILED",
          message: threadError?.message || "Não foi possível obter a thread da assistente.",
        },
        { status: 500 }
      );
    }

    const { data: onboardingAnswers, error: onboardingError } = await supabase
      .from("store_onboarding_answers")
      .select("question_key, answer")
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .in("question_key", [...ONBOARDING_KEYS]);

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
      .select("id, sender, sender_role, direction, message_type, content, created_at")
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .eq("thread_id", thread.id)
      .order("created_at", { ascending: true })
      .limit(30);

    if (messagesError) {
      return NextResponse.json(
        {
          ok: false,
          error: "LOAD_ASSISTANT_MESSAGES_FAILED",
          message: messagesError.message,
        },
        { status: 500 }
      );
    }

    const messages = (messagesData || []) as AssistantMessageRow[];
    const latestHumanMessage = [...messages]
      .reverse()
      .find((message) => message.sender === "human" && String(message.content || "").trim().length > 0)?.content;

    if (!latestHumanMessage) {
      return NextResponse.json(
        {
          ok: false,
          error: "NO_HUMAN_MESSAGE",
          message: "Nenhuma mensagem recente do responsável encontrada.",
        },
        { status: 400 }
      );
    }

    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(now);
    dayEnd.setHours(23, 59, 59, 999);

    const { data: todayAppointmentsData, error: todayAppointmentsError } = await supabase
      .from("store_appointments")
      .select(
        "id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id"
      )
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .gte("scheduled_start", dayStart.toISOString())
      .lte("scheduled_start", dayEnd.toISOString())
      .order("scheduled_start", { ascending: true });

    if (todayAppointmentsError) {
      return NextResponse.json(
        {
          ok: false,
          error: "LOAD_TODAY_APPOINTMENTS_FAILED",
          message: todayAppointmentsError.message,
        },
        { status: 500 }
      );
    }

    const { data: upcomingAppointmentsData, error: upcomingAppointmentsError } = await supabase
      .from("store_appointments")
      .select(
        "id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id"
      )
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .gte("scheduled_start", now.toISOString())
      .in("status", ["scheduled", "rescheduled"])
      .order("scheduled_start", { ascending: true })
      .limit(5);

    if (upcomingAppointmentsError) {
      return NextResponse.json(
        {
          ok: false,
          error: "LOAD_UPCOMING_APPOINTMENTS_FAILED",
          message: upcomingAppointmentsError.message,
        },
        { status: 500 }
      );
    }

    const { data: overdueAppointmentsData, error: overdueAppointmentsError } = await supabase
      .from("store_appointments")
      .select(
        "id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id"
      )
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .lt("scheduled_start", now.toISOString())
      .in("status", ["scheduled", "rescheduled"])
      .order("scheduled_start", { ascending: true })
      .limit(5);

    if (overdueAppointmentsError) {
      return NextResponse.json(
        {
          ok: false,
          error: "LOAD_OVERDUE_APPOINTMENTS_FAILED",
          message: overdueAppointmentsError.message,
        },
        { status: 500 }
      );
    }

    const { data: notificationsData, error: notificationsError } = await supabase
      .from("store_assistant_notification_queue")
      .select(
        "id, notification_type, priority, status, title, body, related_lead_id, related_conversation_id, related_appointment_id, available_at, created_at"
      )
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .eq("status", "pending")
      .order("available_at", { ascending: true })
      .limit(5);

    if (notificationsError) {
      return NextResponse.json(
        {
          ok: false,
          error: "LOAD_ASSISTANT_NOTIFICATIONS_FAILED",
          message: notificationsError.message,
        },
        { status: 500 }
      );
    }

    const todayAppointments = (todayAppointmentsData || []) as AppointmentRow[];
    const upcomingAppointments = (upcomingAppointmentsData || []) as AppointmentRow[];
    const overdueAppointments = (overdueAppointmentsData || []) as AppointmentRow[];
    const notifications = (notificationsData || []) as NotificationQueueRow[];

    const instructions = buildOperationalPrompt({
      responsibleName: onboardingMap.responsible_name || "responsável da loja",
      storeDisplayName: onboardingMap.store_display_name || store.name || "loja",
      onboardingMap,
      historyText: formatHistory(messages),
      todayAppointmentsText: buildAppointmentsSection("AGENDA DE HOJE", todayAppointments),
      upcomingAppointmentsText: buildAppointmentsSection("PRÓXIMOS COMPROMISSOS", upcomingAppointments),
      overdueAppointmentsText: buildAppointmentsSection("COMPROMISSOS EM ATRASO OU AINDA NÃO BAIXADOS", overdueAppointments),
      notificationsText: buildNotificationsSection(notifications),
      latestHumanMessage,
    });

    const response = await openai.responses.create({
      model,
      instructions,
      input: [
        {
          role: "user",
          content: latestHumanMessage,
        },
      ],
      max_output_tokens: 320,
    });

    const aiText = String(response.output_text || "").trim();

    if (!aiText) {
      return NextResponse.json(
        {
          ok: false,
          error: "EMPTY_AI_RESPONSE",
          message: "A assistente não retornou texto utilizável.",
        },
        { status: 500 }
      );
    }

    const metadata = {
      source: "assistant_reply_route",
      todayAppointmentsCount: todayAppointments.length,
      upcomingAppointmentsCount: upcomingAppointments.length,
      overdueAppointmentsCount: overdueAppointments.length,
      pendingNotificationsCount: notifications.length,
      generatedAt: new Date().toISOString(),
    };

    const { data: savedMessage, error: saveMessageError } = await supabase.rpc(
      "assistant_push_system_message",
      {
        p_organization_id: organizationId,
        p_store_id: storeId,
        p_content: aiText,
        p_message_type: "context",
        p_related_lead_id: null,
        p_related_conversation_id: null,
        p_related_appointment_id: overdueAppointments[0]?.id || upcomingAppointments[0]?.id || null,
        p_metadata: metadata,
      }
    );

    if (saveMessageError || !savedMessage) {
      return NextResponse.json(
        {
          ok: false,
          error: "SAVE_ASSISTANT_MESSAGE_FAILED",
          message: saveMessageError?.message || "Não foi possível salvar a resposta da assistente.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      aiText,
      context: {
        todayAppointmentsCount: todayAppointments.length,
        upcomingAppointmentsCount: upcomingAppointments.length,
        overdueAppointmentsCount: overdueAppointments.length,
        pendingNotificationsCount: notifications.length,
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
