export type SalesAiAppointmentContextRow = {
  id: string;
  appointment_type: string | null;
  status: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  commercial_opportunity_id: string | null;
  conversation_id: string | null;
  lead_id: string | null;
};

export type SalesAiAppointmentContext = {
  requestedAppointmentConfirmation: boolean;
  hasMatchingScheduledAppointment: boolean;
  matchingAppointments: SalesAiAppointmentContextRow[];
  scopedCommercialOpportunityId: string | null;
};

const VALID_APPOINTMENT_STATUSES = new Set(["scheduled", "rescheduled"]);

function normalizeText(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function looksLikeAppointmentConfirmationQuestion(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  const asksConfirmation =
    normalized.includes("garant") ||
    normalized.includes("confirm") ||
    normalized.includes("esta marcado") ||
    normalized.includes("ta marcado") ||
    normalized.includes("esta agendado") ||
    normalized.includes("ta agendado") ||
    normalized.includes("vao estar") ||
    normalized.includes("vocês vem") ||
    normalized.includes("voces vem");
  const appointmentSignal =
    normalized.includes("instal") ||
    normalized.includes("visita") ||
    normalized.includes("agenda") ||
    normalized.includes("horario") ||
    normalized.includes("compromisso");

  return asksConfirmation && appointmentSignal;
}

export async function loadSalesAiAppointmentContext(args: {
  supabase: any;
  organizationId: string;
  storeId: string;
  conversationId: string;
  leadId: string | null;
  commercialOpportunityId: string | null;
  lastCustomerMessage: string;
}): Promise<SalesAiAppointmentContext> {
  const requestedAppointmentConfirmation =
    looksLikeAppointmentConfirmationQuestion(args.lastCustomerMessage);

  if (!requestedAppointmentConfirmation) {
    return {
      requestedAppointmentConfirmation: false,
      hasMatchingScheduledAppointment: false,
      matchingAppointments: [],
      scopedCommercialOpportunityId: args.commercialOpportunityId || null,
    };
  }

  const query = args.supabase
    .from("store_appointments")
    .select(
      "id, appointment_type, status, scheduled_start, scheduled_end, commercial_opportunity_id, conversation_id, lead_id",
    )
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("conversation_id", args.conversationId);

  const scopedQuery = args.commercialOpportunityId
    ? query.eq("commercial_opportunity_id", args.commercialOpportunityId)
    : query.eq("lead_id", args.leadId || "");

  const { data, error } = await scopedQuery
    .in("status", Array.from(VALID_APPOINTMENT_STATUSES))
    .limit(10);

  if (error) {
    throw new Error(
      `Falha ao carregar appointments canonicos da conversa comercial: ${error.message}`,
    );
  }

  const rows = Array.isArray(data)
    ? (data as SalesAiAppointmentContextRow[]).filter((row) => {
        if (!VALID_APPOINTMENT_STATUSES.has(normalizeText(row.status))) return false;
        if (row.conversation_id !== args.conversationId) return false;
        if (args.commercialOpportunityId) {
          return row.commercial_opportunity_id === args.commercialOpportunityId;
        }
        return row.lead_id === args.leadId;
      })
    : [];

  return {
    requestedAppointmentConfirmation: true,
    hasMatchingScheduledAppointment: rows.length > 0,
    matchingAppointments: rows,
    scopedCommercialOpportunityId: args.commercialOpportunityId || null,
  };
}

export function buildSalesAiAppointmentPromptBlock(
  context: SalesAiAppointmentContext | null | undefined,
): string {
  if (!context?.requestedAppointmentConfirmation) return "";

  if (!context.hasMatchingScheduledAppointment) {
    return `
VERDADE CANONICA DE AGENDA
- o cliente perguntou sobre compromisso/instalacao/visita ja marcado
- nao existe appointment scheduled/rescheduled correspondente no escopo atual da conversa/opportunity
- nao confirme que a equipe ira comparecer nem que o horario esta marcado
- responda que ainda nao consta como agendado e siga pelas capacidades normais de agenda, sem escalar humano automaticamente
`.trim();
  }

  const rows = context.matchingAppointments
    .slice(0, 3)
    .map(
      (row) =>
        `- ${row.appointment_type || "appointment"} ${row.status || "sem status"} de ${row.scheduled_start || "sem inicio"} ate ${row.scheduled_end || "sem fim"} (id ${row.id})`,
    )
    .join("\n");

  return `
VERDADE CANONICA DE AGENDA
- o cliente perguntou sobre compromisso/instalacao/visita ja marcado
- existem appointments scheduled/rescheduled correspondentes no escopo atual
${rows}
- responda somente com base nesses appointments reais; nao invente outro horario
`.trim();
}
