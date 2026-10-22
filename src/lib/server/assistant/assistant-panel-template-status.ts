import type { SupabaseClient } from "@supabase/supabase-js";

const TEMPLATE_NAME = "zion_assistente_pendencia_operacional";
const TEMPLATE_LANGUAGE = "pt_BR";
const TEMPLATE_CATEGORY = "UTILITY";
const GRAPH_API_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || "v23.0";
const STATUS_TIMEOUT_MS = 5000;
const EXPECTED_BODY =
  "Temos trabalho a fazer!\n\nHá uma pendência operacional na sua loja que precisa da sua atenção.\n\nResponda CONTINUAR para receber os detalhes.";

type TemplateComponent = {
  type?: unknown;
  text?: unknown;
  buttons?: unknown;
};

type GraphResponse = {
  data?: unknown;
  error?: unknown;
};

type TemplateStatusSupabase = Pick<SupabaseClient, "from">;

export type AssistantPanelTemplateStatusResult =
  | { ok: true; status: "APPROVED"; wabaId: string; phoneNumberId: string }
  | { ok: false; reason: string };

export type AssistantPanelTemplateStatusDependencies = {
  fetch?: typeof fetch;
  now?: () => number;
};

function cleanText(value: unknown): string {
  return String(value || "").trim();
}

function normalizedText(value: unknown): string {
  return cleanText(value).replace(/\s+/g, " ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function getGraphJson(args: {
  url: string;
  token: string;
  fetchImpl: typeof fetch;
}): Promise<{ ok: boolean; status: number; body: GraphResponse | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
  try {
    const response = await args.fetchImpl(args.url, {
      method: "GET",
      headers: { Authorization: `Bearer ${args.token}`, Accept: "application/json" },
      signal: controller.signal,
    });
    let body: GraphResponse | null = null;
    try {
      const parsed: unknown = await response.json();
      body = isRecord(parsed) ? parsed as GraphResponse : null;
    } catch {
      body = null;
    }
    return { ok: response.ok, status: response.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  } finally {
    clearTimeout(timeout);
  }
}

function graphRows(body: GraphResponse | null): Record<string, unknown>[] {
  return Array.isArray(body?.data) ? body.data.filter(isRecord) : [];
}

function hasExpectedComponents(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const body = value.find((component): component is TemplateComponent =>
    isRecord(component) && cleanText(component.type).toUpperCase() === "BODY",
  );
  const buttons = value.find((component): component is TemplateComponent =>
    isRecord(component) && cleanText(component.type).toUpperCase() === "BUTTONS",
  );
  if (!body || normalizedText(body.text) !== normalizedText(EXPECTED_BODY)) return false;
  if (!buttons || !Array.isArray(buttons.buttons) || buttons.buttons.length !== 1) return false;
  const button = buttons.buttons[0];
  return isRecord(button) &&
    cleanText(button.type).toUpperCase() === "QUICK_REPLY" &&
    normalizedText(button.text).toUpperCase() === "CONTINUAR";
}

export async function readAssistantPanelTemplateStatus(
  args: {
    supabase: TemplateStatusSupabase;
    organizationId: string;
    storeId: string;
  },
  dependencies: AssistantPanelTemplateStatusDependencies = {},
): Promise<AssistantPanelTemplateStatusResult> {
  const { data, error } = await args.supabase
    .from("external_integrations")
    .select("phone_number_id, whatsapp_business_account_id, access_token")
    .eq("organization_id", args.organizationId)
    .eq("store_id", args.storeId)
    .eq("provider", "whatsapp")
    .eq("is_active", true)
    .eq("status", "active");

  if (error || !Array.isArray(data) || data.length !== 1) {
    return { ok: false, reason: "integration_unavailable" };
  }

  const integration: Record<string, unknown> = isRecord(data[0]) ? data[0] : {};
  const wabaId = cleanText(integration.whatsapp_business_account_id);
  const phoneNumberId = cleanText(integration.phone_number_id);
  const token = cleanText(integration.access_token) || cleanText(process.env.META_WHATSAPP_ACCESS_TOKEN);
  if (!wabaId || !phoneNumberId || !token) {
    return { ok: false, reason: "integration_identity_incomplete" };
  }

  const fetchImpl = dependencies.fetch || fetch;
  const baseUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
  const phoneNumbers = await getGraphJson({
    url: `${baseUrl}/${encodeURIComponent(wabaId)}/phone_numbers?fields=id&limit=100`,
    token,
    fetchImpl,
  });
  if (!phoneNumbers.ok) return { ok: false, reason: "phone_numbers_unavailable" };
  const matchingPhones = graphRows(phoneNumbers.body).filter((row) => cleanText(row.id) === phoneNumberId);
  if (matchingPhones.length !== 1) return { ok: false, reason: "phone_number_waba_mismatch" };

  const templates = await getGraphJson({
    url: `${baseUrl}/${encodeURIComponent(wabaId)}/message_templates?fields=name,status,category,language,components&name=${encodeURIComponent(TEMPLATE_NAME)}&limit=100`,
    token,
    fetchImpl,
  });
  if (!templates.ok) return { ok: false, reason: "message_templates_unavailable" };

  const matches = graphRows(templates.body).filter((row) =>
    cleanText(row.name) === TEMPLATE_NAME &&
    cleanText(row.language) === TEMPLATE_LANGUAGE,
  );
  if (matches.length !== 1) return { ok: false, reason: "template_identity_unavailable" };
  const template = matches[0];
  if (cleanText(template.status).toUpperCase() !== "APPROVED") {
    return { ok: false, reason: "template_not_approved" };
  }
  if (cleanText(template.category).toUpperCase() !== TEMPLATE_CATEGORY) {
    return { ok: false, reason: "template_category_mismatch" };
  }
  if (!hasExpectedComponents(template.components)) {
    return { ok: false, reason: "template_components_mismatch" };
  }

  return { ok: true, status: "APPROVED", wabaId, phoneNumberId };
}
