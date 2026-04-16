
import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type AssistantMessageRow = {
  id: string;
  sender: string | null;
  sender_role: string | null;
  direction: string | null;
  message_type: string | null;
  content: string | null;
  created_at: string | null;
};

type StoreRow = {
  id: string;
  organization_id: string;
  name: string | null;
};

type OnboardingAnswerRow = {
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

type NotificationRow = {
  id: string;
  notification_type: string | null;
  priority: string | null;
  status: string | null;
  title: string | null;
  body: string | null;
  created_at: string | null;
  available_at: string | null;
};

type ReplySuccess = {
  ok: true;
  aiText: string;
  savedMessageId: string | null;
};

type ReplyFailure = {
  ok: false;
  error: string;
  message: string;
};

type ReplyResult = ReplySuccess | ReplyFailure;

const ONBOARDING_KEYS = [
  "store_display_name",
  "store_description",
  "responsible_name",
  "important_limitations",
  "offers_installation",
  "offers_technical_visit",
  "store_services",
  "service_regions",
  "service_region_notes",
  "accepted_payment_methods",
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

function normalizeText(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
}

function formatDateOnly(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("pt-BR");
}

function formatTimeOnly(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAppointmentType(value: string | null) {
  const normalized = normalizeText(value);
  if (normalized === "technical_visit") return "visita técnica";
  if (normalized === "installation") return "instalação";
  if (normalized === "follow_up") return "retorno";
  if (normalized === "meeting") return "reunião";
  if (normalized === "measurement") return "medição";
  if (normalized === "maintenance") return "manutenção";
  if (normalized === "other") return "outro compromisso";
  return value || "compromisso";
}

function formatStatus(value: string | null) {
  const normalized = normalizeText(value);
  if (normalized === "scheduled") return "agendado";
  if (normalized === "rescheduled") return "remarcado";
  if (normalized === "completed") return "concluído";
  if (normalized === "cancelled") return "cancelado";
  if (normalized === "blocked") return "bloqueado";
  return value || "-";
}

function safeLeadName(name: string | null) {
  const trimmed = String(name || "").trim();
  return trimmed || "cliente sem nome";
}

function formatPhone(value: string | null) {
  if (!value) return "-";
  const digits = String(value).replace(/\D/g, "").slice(0, 11);
  if (!digits) return "-";
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function isSameCalendarDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function appointmentSort(a: AppointmentRow, b: AppointmentRow) {
  const ad = new Date(a.scheduled_start || 0).getTime();
  const bd = new Date(b.scheduled_start || 0).getTime();
  return ad - bd;
}

function buildHistoryBlock(messages: AssistantMessageRow[]) {
  const recent = messages
    .filter((msg) => String(msg.content || "").trim().length > 0)
    .slice(-12)
    .map((msg) => {
      const sender = normalizeText(msg.sender);
      const label =
        sender === "assistant"
          ? "Assistente"
          : sender === "human"
          ? "Responsável"
          : "Sistema";
      return `${label}: ${String(msg.content || "").trim()}`;
    });

  return recent.length ? recent.join("\n") : "Sem histórico recente.";
}

function buildStoreBlock(store: StoreRow, onboardingMap: Record<string, string>) {
  const lines = [
    `- loja: ${onboardingMap.store_display_name || store.name || "Loja sem nome"}`,
    onboardingMap.store_description ? `- descrição: ${onboardingMap.store_description}` : null,
    onboardingMap.store_services ? `- serviços: ${onboardingMap.store_services}` : null,
    onboardingMap.offers_installation ? `- oferece instalação: ${onboardingMap.offers_installation}` : null,
    onboardingMap.offers_technical_visit ? `- oferece visita técnica: ${onboardingMap.offers_technical_visit}` : null,
    onboardingMap.service_regions ? `- regiões: ${onboardingMap.service_regions}` : null,
    onboardingMap.service_region_notes ? `- observações de região: ${onboardingMap.service_region_notes}` : null,
    onboardingMap.important_limitations ? `- limitações importantes: ${onboardingMap.important_limitations}` : null,
  ].filter(Boolean);

  return lines.length ? lines.join("\n") : "- sem dados adicionais da loja";
}

function buildTodayAgendaBlock(todayAppointments: AppointmentRow[]) {
  if (!todayAppointments.length) {
    return "Nenhum compromisso hoje.";
  }

  return todayAppointments
    .slice(0, 10)
    .map((item) => {
      return [
        `- ${formatAppointmentType(item.appointment_type)} às ${formatTimeOnly(item.scheduled_start)}`,
        item.status ? `status ${formatStatus(item.status)}` : null,
        item.customer_name ? `cliente ${item.customer_name}` : null,
        item.customer_phone ? `telefone ${formatPhone(item.customer_phone)}` : null,
        item.address_text ? `endereço ${item.address_text}` : null,
        item.notes ? `observações ${item.notes}` : null,
      ]
        .filter(Boolean)
        .join(", ");
    })
    .join("\n");
}

function buildWeekAgendaBlock(nextAppointments: AppointmentRow[]) {
  if (!nextAppointments.length) {
    return "Nenhum próximo compromisso encontrado na janela analisada.";
  }

  return nextAppointments
    .slice(0, 12)
    .map((item) => {
      return [
        `- ${formatDateOnly(item.scheduled_start)} às ${formatTimeOnly(item.scheduled_start)}`,
        formatAppointmentType(item.appointment_type),
        item.status ? `status ${formatStatus(item.status)}` : null,
        item.customer_name ? `cliente ${item.customer_name}` : null,
      ]
        .filter(Boolean)
        .join(", ");
    })
    .join("\n");
}

function buildOverdueBlock(overdueAppointments: AppointmentRow[]) {
  if (!overdueAppointments.length) {
    return "Nenhum compromisso vencido pendente encontrado.";
  }

  return overdueAppointments
    .slice(0, 10)
    .map((item) => {
      return [
        `- ${formatDateOnly(item.scheduled_start)} às ${formatTimeOnly(item.scheduled_start)}`,
        formatAppointmentType(item.appointment_type),
        item.customer_name ? `cliente ${item.customer_name}` : null,
        item.status ? `status ${formatStatus(item.status)}` : null,
      ]
        .filter(Boolean)
        .join(", ");
    })
    .join("\n");
}

function buildNotificationsBlock(notifications: NotificationRow[]) {
  if (!notifications.length) {
    return "Nenhuma notificação pendente.";
  }

  return notifications
    .slice(0, 10)
    .map((item) => {
      return [
        `- tipo ${item.notification_type || "-"}`,
        item.priority ? `prioridade ${item.priority}` : null,
        item.title ? `título ${item.title}` : null,
        item.body ? `texto ${item.body}` : null,
      ]
        .filter(Boolean)
        .join(", ");
    })
    .join("\n");
}

function buildSystemPrompt(args: {
  store: StoreRow;
  onboardingMap: Record<string, string>;
  recentMessages: AssistantMessageRow[];
  todayAppointments: AppointmentRow[];
  nextAppointments: AppointmentRow[];
  overdueAppointments: AppointmentRow[];
  pendingNotifications: NotificationRow[];
  responsibleName: string;
}) {
  const historyBlock = buildHistoryBlock(args.recentMessages);
  const storeBlock = buildStoreBlock(args.store, args.onboardingMap);
  const todayBlock = buildTodayAgendaBlock(args.todayAppointments);
  const weekBlock = buildWeekAgendaBlock(args.nextAppointments);
  const overdueBlock = buildOverdueBlock(args.overdueAppointments);
  const notificationsBlock = buildNotificationsBlock(args.pendingNotifications);

  return `
Você é a assistente operacional interna do projeto ZION.
Você fala com o responsável da loja, nunca com o cliente final.
Seu nome funcional neste canal é Assistente Operacional da Loja.

MISSÃO REAL
- ajudar o responsável a entender o que está acontecendo na operação
- resumir agenda, prioridades, pendências e contexto útil
- lembrar dados objetivos de visitas, instalações, medições, manutenções e retornos
- destacar atrasos, conflitos, pendências e próximos passos
- responder de forma honesta, útil e prática

REGRA MÁXIMA
Você NÃO pode prometer ações que ainda não executa de verdade no sistema.

O QUE VOCÊ PODE FAZER HOJE
- resumir a agenda do dia e da semana
- listar compromissos próximos
- apontar compromissos atrasados ou pendentes
- lembrar horário, cliente, telefone, endereço e observações do compromisso
- organizar prioridades em TEXTO
- sugerir o que o responsável deve conferir
- resumir pendências da fila da assistente
- explicar com clareza o que merece atenção humana

O QUE VOCÊ NÃO PODE DIZER COMO SE JÁ FIZESSE
- "vou organizar os documentos"
- "vou separar os materiais"
- "vou preparar um checklist"
- "vou arrumar isso para você"
- "vou deixar pronto"
- "vou enviar para a equipe"
- "vou confirmar com o cliente"
- qualquer automação operacional que não exista de verdade

SE O RESPONSÁVEL PEDIR ALGO QUE AINDA NÃO EXISTE
- seja honesta
- diga que hoje você ainda não executa isso automaticamente
- ofereça apenas ajuda real em texto
Exemplo bom:
"Hoje eu ainda não organizo documentos de forma automática, mas posso te resumir o que conferir antes da visita."

COMO RESPONDER
- sempre em português do Brasil
- natural, humana, clara e objetiva
- sem parecer robô
- sem frases burocráticas
- sem markdown pesado
- sem títulos desnecessários
- sem inventar fatos

ESTILO
- quando a pergunta for simples, responda simples
- quando houver pendências reais, destaque primeiro o que é mais importante
- se existir compromisso hoje, priorize isso na resposta
- quando ajudar com preparação, fale como sugestão textual, não como automação executada
- pode usar listas curtas quando isso realmente ajudar
- no máximo 1 pergunta final curta, e só se fizer sentido

EXEMPLOS BOAS RESPOSTAS
- "Hoje você tem uma visita técnica às 12:30 com o cliente João. O principal é revisar endereço, observações e confirmar se ficou alguma pendência da visita anterior."
- "Você tem dois compromissos em atraso que ainda precisam de baixa. O mais urgente parece ser o do dia 14/04."
- "Hoje eu ainda não organizo documentos automaticamente, mas posso te dizer o que vale conferir antes da visita."

EXEMPLOS RUINS
- "Quer que eu organize os documentos para você?"
- "Posso preparar um checklist e deixar tudo pronto."
- "Vou arrumar isso para a execução."

DADOS DA LOJA
${storeBlock}

RESPONSÁVEL
- nome: ${args.responsibleName}

HISTÓRICO RECENTE DA THREAD
${historyBlock}

AGENDA DE HOJE
${todayBlock}

PRÓXIMOS COMPROMISSOS
${weekBlock}

COMPROMISSOS VENCIDOS / PENDENTES
${overdueBlock}

NOTIFICAÇÕES PENDENTES DA ASSISTENTE
${notificationsBlock}

SAÍDA OBRIGATÓRIA
- gere apenas a mensagem final da assistente
- não explique seu raciocínio
- não diga que consultou banco, sistema, prompt ou contexto
- não invente capacidades operacionais
- se algo não existir de verdade, deixe isso claro com elegância
`.trim();
}

async function generateAssistantReply(params: {
  organizationId: string;
  storeId: string;
}): Promise<ReplyResult> {
  try {
    const organizationId = String(params.organizationId || "").trim();
    const storeId = String(params.storeId || "").trim();

    if (!organizationId || !storeId) {
      return {
        ok: false,
        error: "MISSING_FIELDS",
        message: "organizationId e storeId são obrigatórios.",
      };
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const model = process.env.ZION_ASSISTANT_MODEL || "gpt-4.1-mini";

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

    const { data: thread, error: threadError } = await supabase.rpc(
      "assistant_get_or_create_primary_thread",
      {
        p_organization_id: organizationId,
        p_store_id: storeId,
      }
    );

    if (threadError || !thread) {
      return {
        ok: false,
        error: "THREAD_NOT_FOUND",
        message: threadError?.message || "Não foi possível localizar a thread da assistente.",
      };
    }

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
    for (const row of (onboardingAnswers || []) as OnboardingAnswerRow[]) {
      const text = asText(row.answer);
      if (text) onboardingMap[row.question_key] = text;
    }

    const { data: messagesData, error: messagesError } = await supabase
      .from("store_assistant_messages")
      .select("id, sender, sender_role, direction, message_type, content, created_at")
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .eq("thread_id", thread.id)
      .order("created_at", { ascending: false })
      .limit(16);

    if (messagesError) {
      return {
        ok: false,
        error: "LOAD_ASSISTANT_MESSAGES_FAILED",
        message: messagesError.message,
      };
    }

    const recentMessages = ([...(messagesData || [])] as AssistantMessageRow[]).reverse();
    const lastHumanMessage =
      [...recentMessages]
        .reverse()
        .find((msg) => normalizeText(msg.sender) === "human" && String(msg.content || "").trim().length > 0)
        ?.content?.trim() || "";

    if (!lastHumanMessage) {
      return {
        ok: false,
        error: "NO_HUMAN_MESSAGE",
        message: "Não encontrei uma mensagem recente do responsável para responder.",
      };
    }

    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);

    const dayEnd = new Date(now);
    dayEnd.setHours(23, 59, 59, 999);

    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + 7);
    weekEnd.setHours(23, 59, 59, 999);

    const { data: todayAppointmentsData, error: todayAppointmentsError } = await supabase
      .from("store_appointments")
      .select("id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id")
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .gte("scheduled_start", dayStart.toISOString())
      .lte("scheduled_start", dayEnd.toISOString())
      .not("status", "in", '("cancelled")')
      .order("scheduled_start", { ascending: true });

    if (todayAppointmentsError) {
      return {
        ok: false,
        error: "LOAD_TODAY_APPOINTMENTS_FAILED",
        message: todayAppointmentsError.message,
      };
    }

    const { data: nextAppointmentsData, error: nextAppointmentsError } = await supabase
      .from("store_appointments")
      .select("id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id")
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .gte("scheduled_start", dayStart.toISOString())
      .lte("scheduled_start", weekEnd.toISOString())
      .not("status", "in", '("cancelled","completed")')
      .order("scheduled_start", { ascending: true });

    if (nextAppointmentsError) {
      return {
        ok: false,
        error: "LOAD_NEXT_APPOINTMENTS_FAILED",
        message: nextAppointmentsError.message,
      };
    }

    const { data: overdueAppointmentsData, error: overdueAppointmentsError } = await supabase
      .from("store_appointments")
      .select("id, title, appointment_type, status, scheduled_start, scheduled_end, customer_name, customer_phone, address_text, notes, lead_id, conversation_id")
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .lt("scheduled_start", dayStart.toISOString())
      .not("status", "in", '("cancelled","completed")')
      .order("scheduled_start", { ascending: true })
      .limit(10);

    if (overdueAppointmentsError) {
      return {
        ok: false,
        error: "LOAD_OVERDUE_APPOINTMENTS_FAILED",
        message: overdueAppointmentsError.message,
      };
    }

    const { data: notificationsData, error: notificationsError } = await supabase
      .from("store_assistant_notification_queue")
      .select("id, notification_type, priority, status, title, body, created_at, available_at")
      .eq("organization_id", organizationId)
      .eq("store_id", storeId)
      .eq("status", "pending")
      .order("available_at", { ascending: true })
      .limit(10);

    if (notificationsError) {
      return {
        ok: false,
        error: "LOAD_PENDING_NOTIFICATIONS_FAILED",
        message: notificationsError.message,
      };
    }

    const todayAppointments = ((todayAppointmentsData || []) as AppointmentRow[]).sort(appointmentSort);
    const nextAppointments = ((nextAppointmentsData || []) as AppointmentRow[]).sort(appointmentSort);
    const overdueAppointments = ((overdueAppointmentsData || []) as AppointmentRow[]).sort(appointmentSort);
    const pendingNotifications = (notificationsData || []) as NotificationRow[];

    const responsibleName =
      onboardingMap.responsible_name ||
      (() => {
        const storeLabel = onboardingMap.store_display_name || store.name || "loja";
        return `responsável da ${storeLabel}`;
      })();

    const systemPrompt = buildSystemPrompt({
      store,
      onboardingMap,
      recentMessages,
      todayAppointments,
      nextAppointments,
      overdueAppointments,
      pendingNotifications,
      responsibleName,
    });

    const modelInput = [
      {
        role: "system" as const,
        content: systemPrompt,
      },
      ...recentMessages
        .filter((msg) => String(msg.content || "").trim().length > 0)
        .map((msg) => {
          const role = normalizeText(msg.sender) === "assistant" ? "assistant" : "user";
          return {
            role: role as "user" | "assistant",
            content: String(msg.content || "").trim(),
          };
        }),
      {
        role: "user" as const,
        content: lastHumanMessage,
      },
    ];

    const response = await openai.responses.create({
      model,
      input: modelInput,
      max_output_tokens: 280,
    });

    const aiText = String(response.output_text || "").trim();

    if (!aiText) {
      return {
        ok: false,
        error: "EMPTY_AI_RESPONSE",
        message: "A OpenAI não retornou texto utilizável.",
      };
    }

    const messageType =
      todayAppointments.length > 0 ||
      overdueAppointments.length > 0 ||
      pendingNotifications.length > 0
        ? "context"
        : "text";

    const { data: savedMessage, error: saveError } = await supabase.rpc(
      "assistant_push_system_message",
      {
        p_organization_id: organizationId,
        p_store_id: storeId,
        p_content: aiText,
        p_message_type: messageType,
        p_related_lead_id: todayAppointments[0]?.lead_id || overdueAppointments[0]?.lead_id || null,
        p_related_conversation_id:
          todayAppointments[0]?.conversation_id || overdueAppointments[0]?.conversation_id || null,
        p_related_appointment_id: todayAppointments[0]?.id || overdueAppointments[0]?.id || null,
        p_metadata: {
          source: "assistant_reply_route",
          context_scope: "operational_internal",
          today_count: todayAppointments.length,
          upcoming_count: nextAppointments.length,
          overdue_count: overdueAppointments.length,
          pending_notification_count: pendingNotifications.length,
        },
      }
    );

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
      savedMessageId: savedMessage?.id ?? null,
    };
  } catch (error: any) {
    return {
      ok: false,
      error: "ASSISTANT_REPLY_FAILED",
      message: error?.message || "Erro interno ao gerar resposta da assistente.",
    };
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const organizationId = String(body?.organizationId || "").trim();
    const storeId = String(body?.storeId || "").trim();

    const result = await generateAssistantReply({
      organizationId,
      storeId,
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
