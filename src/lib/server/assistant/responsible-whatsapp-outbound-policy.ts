import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadCanonicalActivePrimaryStoreResponsible,
  normalizeResponsibleWhatsappDestination,
  type CanonicalStoreResponsible,
} from "@/lib/server/store-responsibles";

export const RESPONSIBLE_WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;
const RESPONSIBLE_WHATSAPP_TEMPLATE_LANGUAGE = "pt_BR";

export type ResponsibleWhatsappTemplateKind =
  | "operational_approval"
  | "human_help"
  | "responsible_action"
  | "commitment_decision";

export type ResponsibleWhatsappTemplateContext = {
  templateKind?: string | null;
  notificationType?: string | null;
  body?: string | null;
  title?: string | null;
  context?: Record<string, unknown> | null;
  relatedLeadId?: string | null;
  relatedConversationId?: string | null;
  relatedAppointmentId?: string | null;
};

type InboundMessageRow = {
  id?: string | null;
  created_at?: string | null;
  metadata?: Record<string, unknown> | null;
};

type PolicySupabase = SupabaseClient;

type TemplatePayload = {
  name: string;
  language: { code: string };
  components: Array<{
    type: "body";
    parameters: Array<{ type: "text"; text: string }>;
  }>;
};

export type ResponsibleWhatsappOutboundPolicy =
  | {
      ok: true;
      mode: "free_form";
      responsible: CanonicalStoreResponsible;
      template: null;
      lastInboundMessageId: string | null;
    }
  | {
      ok: true;
      mode: "template_required";
      responsible: CanonicalStoreResponsible;
      template: TemplatePayload;
      lastInboundMessageId: string | null;
    }
  | {
      ok: false;
      reason: string;
    };

type PolicyDependencies = {
  loadResponsible?: typeof loadCanonicalActivePrimaryStoreResponsible;
  loadCustomerName?: (args: {
    supabase: PolicySupabase;
    organizationId: string;
    storeId: string;
    context: ResponsibleWhatsappTemplateContext;
  }) => Promise<string | null>;
  now?: () => Date;
};

function cleanText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeKey(value: unknown): string {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function contextValue(context: Record<string, unknown> | null | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = cleanText(context?.[key]);
    if (value) return value;
  }
  return "";
}

function isConcrete(value: string): boolean {
  const normalized = normalizeKey(value);
  if (!normalized || normalized.length < 4) return false;
  return ![
    "ha_uma_pendencia",
    "precisa_de_uma_decisao",
    "ha_algo_para_verificar",
    "verificar_situacao",
    "situacao_pendente",
  ].includes(normalized);
}

function resolveTemplateKind(
  context: ResponsibleWhatsappTemplateContext,
): ResponsibleWhatsappTemplateKind | null {
  const explicit = normalizeKey(
    context.templateKind || contextValue(context.context, "template_kind", "responsible_template_kind"),
  );
  const explicitMap: Record<string, ResponsibleWhatsappTemplateKind> = {
    operational_approval: "operational_approval",
    zion_aprovacao_operacional: "operational_approval",
    human_help: "human_help",
    zion_ajuda_humana: "human_help",
    responsible_action: "responsible_action",
    zion_acao_do_responsavel: "responsible_action",
    commitment_decision: "commitment_decision",
    zion_decisao_sobre_compromisso: "commitment_decision",
  };
  if (explicitMap[explicit]) return explicitMap[explicit];

  const notificationType = normalizeKey(context.notificationType);
  const reason = normalizeKey(contextValue(context.context, "reason", "reason_code", "notification_type"));
  const notificationKeys = [notificationType, reason].filter(Boolean);
  if (notificationKeys.includes("customer_suggested_available_time_requires_approval")) {
    return "operational_approval";
  }
  if (notificationKeys.some((key) => key.includes("commitment") || key.includes("appointment_decision"))) {
    return "commitment_decision";
  }
  if (notificationKeys.some((key) => key.includes("human") || key.includes("pending_review"))) {
    return "human_help";
  }
  if (notificationKeys.some((key) => key.includes("action") || key.includes("signed"))) {
    return "responsible_action";
  }
  return null;
}

function buildTemplate(args: {
  kind: ResponsibleWhatsappTemplateKind;
  responsibleName: string;
  customerName: string;
  context: ResponsibleWhatsappTemplateContext;
}): TemplatePayload | null {
  const rawContext = args.context.context;
  const situation = contextValue(rawContext, "situation", "current_situation", "objective_situation") ||
    cleanText(args.context.body);
  const decision = contextValue(rawContext, "decision", "exact_decision", "requested_decision");
  const action = contextValue(rawContext, "action", "concrete_action", "required_action", "requested_action");
  const dateTime = contextValue(rawContext, "date_time", "datetime", "commitment_date_time", "suggested_label");

  if (!isConcrete(args.responsibleName) || !isConcrete(args.customerName) || !isConcrete(situation)) {
    return null;
  }

  switch (args.kind) {
    case "operational_approval": {
      const exactDecision = decision || (dateTime ? `aprovar ou recusar o horario sugerido: ${dateTime}` : "");
      if (!isConcrete(exactDecision)) return null;
      return {
        name: "zion_aprovacao_operacional",
        language: { code: RESPONSIBLE_WHATSAPP_TEMPLATE_LANGUAGE },
        components: [{
          type: "body",
          parameters: [
            { type: "text", text: args.responsibleName },
            { type: "text", text: args.customerName },
            { type: "text", text: situation },
            { type: "text", text: exactDecision },
          ],
        }],
      };
    }
    case "human_help": {
      const reason = contextValue(rawContext, "reason", "concrete_reason", "help_reason") || action || decision;
      if (!isConcrete(reason)) return null;
      return {
        name: "zion_ajuda_humana",
        language: { code: RESPONSIBLE_WHATSAPP_TEMPLATE_LANGUAGE },
        components: [{
          type: "body",
          parameters: [
            { type: "text", text: args.responsibleName },
            { type: "text", text: args.customerName },
            { type: "text", text: situation },
            { type: "text", text: reason },
          ],
        }],
      };
    }
    case "responsible_action":
      if (!isConcrete(action)) return null;
      return {
        name: "zion_acao_do_responsavel",
        language: { code: RESPONSIBLE_WHATSAPP_TEMPLATE_LANGUAGE },
        components: [{
          type: "body",
          parameters: [
            { type: "text", text: args.responsibleName },
            { type: "text", text: args.customerName },
            { type: "text", text: situation },
            { type: "text", text: action },
          ],
        }],
      };
    case "commitment_decision":
      if (!isConcrete(dateTime) || !isConcrete(decision)) return null;
      return {
        name: "zion_decisao_sobre_compromisso",
        language: { code: RESPONSIBLE_WHATSAPP_TEMPLATE_LANGUAGE },
        components: [{
          type: "body",
          parameters: [
            { type: "text", text: args.responsibleName },
            { type: "text", text: args.customerName },
            { type: "text", text: situation },
            { type: "text", text: dateTime },
            { type: "text", text: decision },
          ],
        }],
      };
  }
}

async function hasRecentValidInbound(args: {
  supabase: PolicySupabase;
  organizationId: string;
  storeId: string;
  responsible: CanonicalStoreResponsible;
  now: Date;
}): Promise<{ allowed: boolean; messageId: string | null }> {
  const { data, error } = await args.supabase
    .from("store_assistant_messages")
    .select("id, created_at, metadata")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("sender_role", "store_responsible")
    .eq("direction", "incoming")
    .contains("metadata", { origin: "whatsapp", responsible_id: args.responsible.id })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);

  if (error) throw new Error(`Falha ao verificar janela WhatsApp do responsavel: ${error.message}`);

  const message = ((data || []) as InboundMessageRow[])[0];
  if (!message) return { allowed: false, messageId: null };
  const metadata = message.metadata || {};
  const sourcePhone = normalizeResponsibleWhatsappDestination(cleanText(metadata.from_phone));
  const createdAt = Date.parse(cleanText(message.created_at));
  const age = args.now.getTime() - createdAt;
  return {
    allowed: Boolean(
      sourcePhone &&
        sourcePhone === args.responsible.whatsappNumber &&
        cleanText(metadata.external_message_id) &&
        Number.isFinite(createdAt) &&
        age >= 0 &&
        age <= RESPONSIBLE_WHATSAPP_WINDOW_MS,
    ),
    messageId: message.id || null,
  };
}

async function defaultLoadCustomerName(args: {
  supabase: PolicySupabase;
  organizationId: string;
  storeId: string;
  context: ResponsibleWhatsappTemplateContext;
}): Promise<string | null> {
  const relation = args.context.relatedConversationId
    ? await args.supabase
        .from("conversations")
        .select("lead_id")
        .eq("id", args.context.relatedConversationId)
        .eq("organization_id", args.organizationId)
        .eq("store_id", args.storeId)
        .maybeSingle()
    : { data: { lead_id: args.context.relatedLeadId }, error: null };
  if (relation.error || !relation.data?.lead_id) return null;

  const lead = await args.supabase
    .from("leads")
    .select("customer_id")
    .eq("id", relation.data.lead_id)
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .maybeSingle();
  if (lead.error || !lead.data?.customer_id) return null;

  const customer = await args.supabase
    .from("customers")
    .select("display_name")
    .eq("id", lead.data.customer_id)
    .eq("organization_id", args.organizationId)
    .maybeSingle();
  if (customer.error) return null;
  return cleanText(customer.data?.display_name) || null;
}

export async function resolveResponsibleWhatsappOutboundPolicy(args: {
  supabase: PolicySupabase;
  organizationId: string;
  storeId: string;
  responsibleId: string;
  destination: string;
  templateContext?: ResponsibleWhatsappTemplateContext;
}, dependencies: PolicyDependencies = {}): Promise<ResponsibleWhatsappOutboundPolicy> {
  const loadResponsible = dependencies.loadResponsible || loadCanonicalActivePrimaryStoreResponsible;
  const responsibleResult = await loadResponsible({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
  });
  if (!responsibleResult.ok || responsibleResult.responsible.id !== args.responsibleId) {
    return { ok: false, reason: "RESPONSIBLE_WHATSAPP_AUTHORITY_INVALID" };
  }
  const destination = normalizeResponsibleWhatsappDestination(args.destination);
  if (!destination || destination !== responsibleResult.responsible.whatsappNumber) {
    return { ok: false, reason: "RESPONSIBLE_WHATSAPP_DESTINATION_INVALID" };
  }

  const recentInbound = await hasRecentValidInbound({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    responsible: responsibleResult.responsible,
    now: dependencies.now ? dependencies.now() : new Date(),
  });
  if (recentInbound.allowed) {
    return { ok: true, mode: "free_form", responsible: responsibleResult.responsible, template: null, lastInboundMessageId: recentInbound.messageId };
  }

  const templateContext = args.templateContext;
  if (!templateContext) {
    return { ok: false, reason: "RESPONSIBLE_WHATSAPP_TEMPLATE_REQUIRED" };
  }
  const kind = resolveTemplateKind(templateContext);
  if (!kind) return { ok: false, reason: "RESPONSIBLE_WHATSAPP_TEMPLATE_KIND_REQUIRED" };

  const loadCustomerName = dependencies.loadCustomerName || defaultLoadCustomerName;
  const customerName = await loadCustomerName({
    supabase: args.supabase,
    organizationId: args.organizationId,
    storeId: args.storeId,
    context: templateContext,
  });
  const template = buildTemplate({
    kind,
    responsibleName: responsibleResult.responsible.name || "",
    customerName: customerName || "",
    context: templateContext,
  });
  if (!template) return { ok: false, reason: "RESPONSIBLE_WHATSAPP_TEMPLATE_CONTEXT_INVALID" };

  return { ok: true, mode: "template_required", responsible: responsibleResult.responsible, template, lastInboundMessageId: recentInbound.messageId };
}
