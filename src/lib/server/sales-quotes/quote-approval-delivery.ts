import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  resolveResponsibleWhatsappOutboundPolicy,
  type ResponsibleWhatsappTemplateContext,
} from "@/lib/server/assistant/responsible-whatsapp-outbound-policy";
import {
  sendResponsibleWhatsappPayload,
  type ResponsibleWhatsappPayload,
} from "@/lib/server/assistant/responsible-external-notifications-sender";

export const QUOTE_APPROVAL_DELIVERY_RPC = {
  prepare: "p9_prepare_quote_approval_delivery_by_system",
  claim: "p9_claim_quote_approval_delivery_by_system",
  finish: "p9_finish_quote_approval_delivery_by_system",
} as const;

export type QuoteApprovalDeliveryComponent = "opening_template" | "report" | "pdf";

type RpcError = { message: string } | null;
type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: RpcError }>;
};

type DeliveryScope = {
  request_id: string;
  organization_id: string;
  store_id: string;
  responsible_id: string;
  destination: string;
  quote_id: string;
  quote_version_id: string;
  report_snapshot: Record<string, unknown>;
  pdf_store_file_id: string;
  pdf_storage_bucket: string;
  pdf_storage_path: string;
};

type ClaimResult = DeliveryScope & {
  component: QuoteApprovalDeliveryComponent;
  claim_token: string;
  state: "claimed";
};

type FinishResult = {
  request_id: string;
  component: QuoteApprovalDeliveryComponent;
  state: "accepted" | "failed" | "uncertain";
  idempotent: boolean;
  request_status: string;
};

type StoreFileReader = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => PromiseLike<{ data: unknown; error: RpcError }>;
      };
    };
  };
};

type StorageClient = {
  storage: {
    from: (bucket: string) => {
      createSignedUrl: (path: string, expiresIn: number) => PromiseLike<{
        data: { signedUrl?: string | null } | null;
        error: RpcError;
      }>;
    };
  };
};

type DeliveryLedgerPart = {
  request_id: string;
  organization_id: string;
  store_id: string;
  component: QuoteApprovalDeliveryComponent;
  status: "pending" | "claimed" | "accepted" | "failed" | "uncertain";
  external_message_id: string | null;
  inbound_window_message_id: string | null;
  pdf_store_file_id: string | null;
  pdf_storage_bucket: string | null;
  pdf_storage_path: string | null;
};

type LedgerQuery = PromiseLike<{ data: unknown; error: RpcError }> & {
  eq: (column: string, value: string) => LedgerQuery;
};

type LedgerReader = {
  from: (table: string) => {
    select: (columns: string) => LedgerQuery;
  };
};

type DeliverySupabase = RpcClient & Partial<StoreFileReader & StorageClient>;

export type QuoteApprovalDeliveryTransport = (args: {
  organizationId: string;
  storeId: string;
  responsibleId: string;
  destination: string;
  payload: ResponsibleWhatsappPayload;
}) => Promise<{ ok: true; externalMessageId: string } | { ok: false; reason: string }>;

export type QuoteApprovalDeliveryResult =
  | { ok: true; requestId: string; requestStatus: string; reportMessageId: string; pdfMessageId: string }
  | {
      ok: false;
      requestId: string;
      state: string;
      reason: string;
      requestStatus?: string;
      reportMessageId?: string;
      pdfMessageId?: string;
    };

const SIGNED_PDF_EXPIRATION_SECONDS = 5 * 60;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeScope(data: unknown, requestId: string): DeliveryScope {
  const row = record(Array.isArray(data) ? data[0] : data);
  const snapshot = record(row?.report_snapshot);
  const required = {
    request_id: text(row?.request_id),
    organization_id: text(row?.organization_id),
    store_id: text(row?.store_id),
    responsible_id: text(row?.responsible_id),
    destination: text(row?.destination),
    quote_id: text(row?.quote_id),
    quote_version_id: text(row?.quote_version_id),
    pdf_store_file_id: text(row?.pdf_store_file_id),
    pdf_storage_bucket: text(row?.pdf_storage_bucket),
    pdf_storage_path: text(row?.pdf_storage_path),
  };
  if (
    required.request_id !== requestId || Object.values(required).some((value) => !value) || !snapshot
  ) {
    throw new Error("P9_QUOTE_APPROVAL_DELIVERY_SCOPE_INVALID");
  }
  return { ...required, report_snapshot: snapshot };
}

function normalizeClaim(data: unknown, requestId: string, component: QuoteApprovalDeliveryComponent): ClaimResult {
  const row = record(Array.isArray(data) ? data[0] : data);
  const scope = normalizeScope(row, requestId);
  const claimToken = text(row?.claim_token);
  if (text(row?.component) !== component || !claimToken || text(row?.state) !== "claimed") {
    throw new Error("P9_QUOTE_APPROVAL_DELIVERY_CLAIM_INVALID");
  }
  return { ...scope, component, claim_token: claimToken, state: "claimed" };
}

function normalizeFinish(data: unknown): FinishResult {
  const row = record(Array.isArray(data) ? data[0] : data);
  const state = text(row?.state);
  const component = text(row?.component);
  const requestId = text(row?.request_id);
  const requestStatus = text(row?.request_status);
  if (
    !requestId || !requestStatus || !["opening_template", "report", "pdf"].includes(component) ||
    !["accepted", "failed", "uncertain"].includes(state) || typeof row?.idempotent !== "boolean"
  ) {
    throw new Error("P9_QUOTE_APPROVAL_DELIVERY_FINISH_INVALID");
  }
  return {
    request_id: requestId,
    component: component as QuoteApprovalDeliveryComponent,
    state: state as FinishResult["state"],
    idempotent: row.idempotent,
    request_status: requestStatus,
  };
}

async function callRpc<T>(client: RpcClient, name: string, args: Record<string, unknown>, normalize: (data: unknown) => T) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message || "P9_QUOTE_APPROVAL_DELIVERY_RPC_FAILED");
  return normalize(data);
}

function reportValue(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

const REPORT_TEXT_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ["customer_name", "Cliente"],
  ["payment_terms", "Condicoes de pagamento"],
  ["delivery_terms", "Condicoes de entrega"],
  ["valid_until", "Validade"],
  ["notes", "Observacoes"],
];

const REPORT_MONEY_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ["subtotal_cents", "Subtotal"],
  ["discount_cents", "Desconto"],
  ["total_cents", "Total"],
];

function formatMoneyCents(value: unknown, currency: string): string | null {
  if (!Number.isInteger(value) || !currency) return null;
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(Number(value) / 100);
  } catch {
    return null;
  }
}

function formatSafeReport(snapshot: Record<string, unknown>): string {
  const currency = text(snapshot.currency).toUpperCase();
  const lines = [
    "Aprovacao de orcamento",
    `Orcamento: ${text(snapshot.quote_number)}`,
    `Versao: ${text(snapshot.quote_version_number)}`,
  ];
  for (const [key, label] of REPORT_TEXT_FIELDS) {
    const value = reportValue(snapshot[key]);
    if (value !== null) lines.push(`${label}: ${value}`);
  }
  for (const [key, label] of REPORT_MONEY_FIELDS) {
    const value = formatMoneyCents(snapshot[key], currency);
    if (value !== null) lines.push(`${label}: ${value}`);
  }
  return lines.join("\n");
}

function validateReportSnapshot(scope: DeliveryScope): string | null {
  if (text(scope.report_snapshot.quote_id) !== scope.quote_id) {
    return "P9_DELIVERY_REPORT_QUOTE_BINDING_INVALID";
  }
  if (text(scope.report_snapshot.quote_version_id) !== scope.quote_version_id) {
    return "P9_DELIVERY_REPORT_VERSION_BINDING_INVALID";
  }
  if (text(scope.report_snapshot.quote_pdf_store_file_id) !== scope.pdf_store_file_id) {
    return "P9_DELIVERY_REPORT_PDF_BINDING_INVALID";
  }
  if (!text(scope.report_snapshot.quote_number) || !text(scope.report_snapshot.quote_version_number)) {
    return "P9_DELIVERY_REPORT_DATA_INSUFFICIENT";
  }
  const hasCommercialAmount = REPORT_MONEY_FIELDS.some(([key]) => scope.report_snapshot[key] !== undefined);
  if (!hasCommercialAmount) return "P9_DELIVERY_REPORT_DATA_INSUFFICIENT";
  if (!text(scope.report_snapshot.currency)) return "P9_DELIVERY_REPORT_CURRENCY_MISSING";
  for (const [key] of REPORT_MONEY_FIELDS) {
    if (scope.report_snapshot[key] !== undefined && formatMoneyCents(scope.report_snapshot[key], text(scope.report_snapshot.currency).toUpperCase()) === null) {
      return "P9_DELIVERY_REPORT_MONEY_INVALID";
    }
  }
  return null;
}

function isUncertain(reason: string): boolean {
  return reason === "send_uncertain" || reason === "WHATSAPP_TRANSPORT_UNCERTAIN";
}

function normalizeLedgerPart(value: unknown): DeliveryLedgerPart | null {
  const row = record(value);
  const component = text(row?.component);
  const status = text(row?.status);
  if (!row || !["opening_template", "report", "pdf"].includes(component) ||
      !["pending", "claimed", "accepted", "failed", "uncertain"].includes(status)) return null;
  return {
    request_id: text(row.request_id),
    organization_id: text(row.organization_id),
    store_id: text(row.store_id),
    component: component as QuoteApprovalDeliveryComponent,
    status: status as DeliveryLedgerPart["status"],
    external_message_id: text(row.external_message_id) || null,
    inbound_window_message_id: text(row.inbound_window_message_id) || null,
    pdf_store_file_id: text(row.pdf_store_file_id) || null,
    pdf_storage_bucket: text(row.pdf_storage_bucket) || null,
    pdf_storage_path: text(row.pdf_storage_path) || null,
  };
}

function isDeliveryLedgerPart(
  value: DeliveryLedgerPart | null,
): value is DeliveryLedgerPart {
  return value !== null;
}

async function readDeliveryLedger(client: DeliverySupabase, scope: DeliveryScope): Promise<DeliveryLedgerPart[]> {
  const reader = client as unknown as LedgerReader;
  const { data, error } = await reader
    .from("p9_quote_approval_delivery_parts")
    .select("request_id, organization_id, store_id, component, status, external_message_id, inbound_window_message_id, pdf_store_file_id, pdf_storage_bucket, pdf_storage_path")
    .eq("request_id", scope.request_id)
    .eq("organization_id", scope.organization_id)
    .eq("store_id", scope.store_id);
  if (error) throw new Error("P9_DELIVERY_LEDGER_READ_FAILED");
  const rows = Array.isArray(data) ? data.map(normalizeLedgerPart) : [];
  const validRows = rows.filter(isDeliveryLedgerPart);
  if (validRows.length !== rows.length || rows.length !== 3) throw new Error("P9_DELIVERY_LEDGER_INVALID");
  const components = new Set(validRows.map((part) => part.component));
  if (components.size !== 3 || !["opening_template", "report", "pdf"].every((component) => components.has(component as QuoteApprovalDeliveryComponent))) {
    throw new Error("P9_DELIVERY_LEDGER_INVALID");
  }
  for (const part of validRows) {
    if (part.request_id !== scope.request_id || part.organization_id !== scope.organization_id || part.store_id !== scope.store_id) {
      throw new Error("P9_DELIVERY_LEDGER_SCOPE_INVALID");
    }
    if (part.component === "pdf" && (part.pdf_store_file_id !== scope.pdf_store_file_id || part.pdf_storage_bucket !== scope.pdf_storage_bucket || part.pdf_storage_path !== scope.pdf_storage_path)) {
      throw new Error("P9_DELIVERY_LEDGER_PDF_BINDING_INVALID");
    }
    if (part.component !== "pdf" && (part.pdf_store_file_id || part.pdf_storage_bucket || part.pdf_storage_path)) {
      throw new Error("P9_DELIVERY_LEDGER_PDF_BINDING_INVALID");
    }
    if (part.status === "accepted" && !part.external_message_id) throw new Error("P9_DELIVERY_LEDGER_INVALID");
    if (part.status !== "accepted" && part.external_message_id) throw new Error("P9_DELIVERY_LEDGER_INVALID");
  }
  return validRows;
}

async function finish(
  client: RpcClient,
  requestId: string,
  component: QuoteApprovalDeliveryComponent,
  claimToken: string,
  requestedResult: "accepted" | "failed" | "uncertain",
  externalMessageId: string | null,
  reason: string | null,
) {
  const result = await callRpc(
    client,
    QUOTE_APPROVAL_DELIVERY_RPC.finish,
    {
      p_request_id: requestId,
      p_component: component,
      p_claim_token: claimToken,
      p_result: requestedResult,
      p_external_message_id: externalMessageId,
      p_reason: reason,
    },
    normalizeFinish,
  );
  if (result.request_id !== requestId || result.component !== component || result.state !== requestedResult) {
    throw new Error("P9_QUOTE_APPROVAL_DELIVERY_FINISH_SCOPE_INVALID");
  }
  return result;
}

async function sendClaimed(args: {
  client: RpcClient;
  scope: DeliveryScope;
  claim: ClaimResult;
  payload: ResponsibleWhatsappPayload;
  transport: QuoteApprovalDeliveryTransport;
}): Promise<{ ok: true; finish: FinishResult; externalMessageId: string } | { ok: false; state: string; reason: string; externalMessageId?: string }> {
  let sent:
    | { ok: true; externalMessageId: string }
    | { ok: false; reason: string };
  try {
    sent = await args.transport({
      organizationId: args.scope.organization_id,
      storeId: args.scope.store_id,
      responsibleId: args.scope.responsible_id,
      destination: args.scope.destination,
      payload: args.payload,
    });
  } catch {
    const reason = "P9_DELIVERY_TRANSPORT_EXCEPTION_UNKNOWN_OUTCOME";
    try {
      await finish(
        args.client,
        args.scope.request_id,
        args.claim.component,
        args.claim.claim_token,
        "uncertain",
        null,
        reason,
      );
      return { ok: false, state: "uncertain", reason };
    } catch {
      return {
        ok: false,
        state: "finalization_uncertain",
        reason: "P9_DELIVERY_FINALIZATION_FAILED_AFTER_UNKNOWN_TRANSPORT",
      };
    }
  }
  const result = sent.ok ? "accepted" : isUncertain(sent.reason) ? "uncertain" : "failed";
  let final: FinishResult;
  try {
    final = await finish(
      args.client,
      args.scope.request_id,
      args.claim.component,
      args.claim.claim_token,
      result,
      sent.ok ? sent.externalMessageId : null,
      sent.ok ? null : sent.reason,
    );
  } catch {
    return {
      ok: false,
      state: "finalization_uncertain",
      reason: sent.ok || isUncertain(sent.reason)
        ? "P9_DELIVERY_FINALIZATION_FAILED_AFTER_EXTERNAL_ATTEMPT"
        : "P9_DELIVERY_FINALIZATION_FAILED_BEFORE_EXTERNAL_SEND",
      ...(sent.ok ? { externalMessageId: sent.externalMessageId } : {}),
    };
  }
  if (!sent.ok) return { ok: false, state: final.state, reason: sent.reason };
  return { ok: true, finish: final, externalMessageId: sent.externalMessageId };
}

function defaultClient(): DeliverySupabase {
  const url = text(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = text(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) throw new Error("P9_QUOTE_APPROVAL_DELIVERY_ADMIN_CONFIG_MISSING");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as DeliverySupabase;
}

export async function deliverQuoteApprovalRequest(args: {
  requestId: string;
  supabase?: DeliverySupabase;
  transport?: QuoteApprovalDeliveryTransport;
  openingTemplateContext: ResponsibleWhatsappTemplateContext;
  resolvePolicy?: typeof resolveResponsibleWhatsappOutboundPolicy;
}): Promise<QuoteApprovalDeliveryResult> {
  const requestId = text(args.requestId);
  if (!requestId) return { ok: false, requestId: "", state: "invalid", reason: "P9_QUOTE_APPROVAL_REQUEST_ID_REQUIRED" };
  const client = args.supabase || defaultClient();
  const policyClient = client as unknown as SupabaseClient;
  const transport = args.transport || sendResponsibleWhatsappPayload;
  const resolvePolicy = args.resolvePolicy || resolveResponsibleWhatsappOutboundPolicy;

  let scope: DeliveryScope;
  try {
    scope = await callRpc(
      client,
      QUOTE_APPROVAL_DELIVERY_RPC.prepare,
      { p_request_id: requestId },
      (data) => normalizeScope(data, requestId),
    );
  } catch (error) {
    return { ok: false, requestId, state: "prepare_failed", reason: error instanceof Error ? error.message : "P9_DELIVERY_PREPARE_FAILED" };
  }

  const reportBindingError = validateReportSnapshot(scope);
  if (reportBindingError) {
    return { ok: false, requestId, state: "report_blocked", reason: reportBindingError };
  }

  let ledger: DeliveryLedgerPart[];
  try {
    ledger = await readDeliveryLedger(client, scope);
  } catch (error) {
    return {
      ok: false,
      requestId,
      state: "ledger_unavailable",
      reason: error instanceof Error ? error.message : "P9_DELIVERY_LEDGER_READ_FAILED",
    };
  }
  const openingPart = ledger.find((part) => part.component === "opening_template");
  const reportPart = ledger.find((part) => part.component === "report");
  const pdfPart = ledger.find((part) => part.component === "pdf");
  if (!openingPart || !reportPart || !pdfPart) {
    return { ok: false, requestId, state: "ledger_unavailable", reason: "P9_DELIVERY_LEDGER_INVALID" };
  }
  const nonRetryable = (
    component: QuoteApprovalDeliveryComponent,
    part: DeliveryLedgerPart,
    preservedReportMessageId?: string,
  ) => ({
    ok: false as const,
    requestId,
    state: `${component}_not_retryable`,
    reason: `P9_DELIVERY_${component.toUpperCase()}_${part.status.toUpperCase()}_REQUIRES_RECONCILIATION`,
    ...(preservedReportMessageId ? { reportMessageId: preservedReportMessageId } : {}),
  });

  let policy: Awaited<ReturnType<typeof resolveResponsibleWhatsappOutboundPolicy>>;
  try {
    policy = await resolvePolicy({
      supabase: policyClient,
      organizationId: scope.organization_id,
      storeId: scope.store_id,
      responsibleId: scope.responsible_id,
      destination: scope.destination,
      templateContext: args.openingTemplateContext,
    });
  } catch {
    return { ok: false, requestId, state: "window_unavailable", reason: "P9_DELIVERY_POLICY_READ_FAILED" };
  }
  if (!policy.ok) return { ok: false, requestId, state: "window_unavailable", reason: policy.reason };

  if (policy.mode === "template_required") {
    if (openingPart.status !== "pending") {
      if (openingPart.status === "accepted") {
        return { ok: false, requestId, state: "awaiting_inbound", reason: "P9_DELIVERY_AWAITING_RESPONSIBLE_INBOUND" };
      }
      return nonRetryable("opening_template", openingPart);
    }
    let claim: ClaimResult;
    try {
      claim = await callRpc(
        client,
        QUOTE_APPROVAL_DELIVERY_RPC.claim,
        { p_request_id: requestId, p_component: "opening_template", p_inbound_window_message_id: null },
        (data) => normalizeClaim(data, requestId, "opening_template"),
      );
    } catch (error) {
      return { ok: false, requestId, state: "opening_not_retryable", reason: error instanceof Error ? error.message : "P9_DELIVERY_OPENING_CLAIM_FAILED" };
    }
    let revalidated: Awaited<ReturnType<typeof resolveResponsibleWhatsappOutboundPolicy>>;
    try {
      revalidated = await resolvePolicy({
        supabase: policyClient,
        organizationId: scope.organization_id,
        storeId: scope.store_id,
        responsibleId: scope.responsible_id,
        destination: scope.destination,
        templateContext: args.openingTemplateContext,
      });
    } catch {
      revalidated = { ok: false, reason: "P9_DELIVERY_OPENING_POLICY_READ_FAILED" };
    }
    if (!revalidated.ok || revalidated.mode !== "template_required") {
      const reason = !revalidated.ok ? revalidated.reason : "P9_DELIVERY_OPENING_POLICY_CHANGED";
      try {
        await finish(client, requestId, "opening_template", claim.claim_token, "failed", null, reason);
      } catch {
        return { ok: false, requestId, state: "finalization_uncertain", reason: "P9_DELIVERY_OPENING_FINALIZATION_FAILED" };
      }
      return { ok: false, requestId, state: "opening_blocked", reason };
    }
    const opening = await sendClaimed({
      client,
      scope,
      claim,
      payload: { type: "template", template: revalidated.template },
      transport,
    });
    if (!opening.ok) return { ok: false, requestId, state: opening.state, reason: opening.reason };
    return { ok: false, requestId, state: "awaiting_inbound", reason: "P9_DELIVERY_AWAITING_RESPONSIBLE_INBOUND" };
  }

  const inboundId = policy.lastInboundMessageId;
  if (!inboundId) return { ok: false, requestId, state: "window_unavailable", reason: "P9_DELIVERY_INBOUND_WINDOW_REQUIRED" };
  if (!isUuid(inboundId)) return { ok: false, requestId, state: "window_invalid", reason: "P9_DELIVERY_INBOUND_ID_INVALID" };
  let reportMessageId = reportPart.external_message_id || "";
  if (reportPart.status === "pending") {
    let reportClaim: ClaimResult;
    try {
      reportClaim = await callRpc(
        client,
        QUOTE_APPROVAL_DELIVERY_RPC.claim,
        { p_request_id: requestId, p_component: "report", p_inbound_window_message_id: inboundId },
        (data) => normalizeClaim(data, requestId, "report"),
      );
    } catch (error) {
      return { ok: false, requestId, state: "report_not_retryable", reason: error instanceof Error ? error.message : "P9_DELIVERY_REPORT_CLAIM_FAILED" };
    }
    let reportPolicy: Awaited<ReturnType<typeof resolveResponsibleWhatsappOutboundPolicy>>;
    try {
      reportPolicy = await resolvePolicy({
        supabase: policyClient,
        organizationId: scope.organization_id,
        storeId: scope.store_id,
        responsibleId: scope.responsible_id,
        destination: scope.destination,
      });
    } catch {
      reportPolicy = { ok: false, reason: "P9_DELIVERY_REPORT_POLICY_READ_FAILED" };
    }
    if (!reportPolicy.ok || reportPolicy.mode !== "free_form" || !reportPolicy.lastInboundMessageId) {
      const reason = !reportPolicy.ok ? reportPolicy.reason : "P9_DELIVERY_REPORT_POLICY_CHANGED";
      try {
        await finish(client, requestId, "report", reportClaim.claim_token, "failed", null, reason);
      } catch {
        return { ok: false, requestId, state: "finalization_uncertain", reason: "P9_DELIVERY_REPORT_FINALIZATION_FAILED" };
      }
      return { ok: false, requestId, state: "report_blocked", reason };
    }
    const report = await sendClaimed({
      client,
      scope,
      claim: reportClaim,
      payload: { type: "text", body: formatSafeReport(scope.report_snapshot) },
      transport,
    });
    if (!report.ok) return {
      ok: false,
      requestId,
      state: report.state,
      reason: report.reason,
      ...(report.externalMessageId ? { reportMessageId: report.externalMessageId } : {}),
    };
    reportMessageId = report.externalMessageId;
  } else if (reportPart.status !== "accepted") {
    return nonRetryable("report", reportPart);
  }

  let pdfWindowPolicy: Awaited<ReturnType<typeof resolveResponsibleWhatsappOutboundPolicy>>;
  try {
    pdfWindowPolicy = await resolvePolicy({
      supabase: policyClient,
      organizationId: scope.organization_id,
      storeId: scope.store_id,
      responsibleId: scope.responsible_id,
      destination: scope.destination,
    });
  } catch {
    pdfWindowPolicy = { ok: false, reason: "P9_DELIVERY_PDF_POLICY_READ_FAILED" };
  }
  if (!pdfWindowPolicy.ok || pdfWindowPolicy.mode !== "free_form" || !pdfWindowPolicy.lastInboundMessageId) {
    const reason = !pdfWindowPolicy.ok ? pdfWindowPolicy.reason : "P9_DELIVERY_PDF_WINDOW_REQUIRED";
    return {
      ok: false,
      requestId,
      state: "pdf_window_unavailable",
      reason,
      reportMessageId,
    };
  }
  if (pdfPart.status !== "pending") return nonRetryable("pdf", pdfPart, reportMessageId);
  if (!isUuid(pdfWindowPolicy.lastInboundMessageId)) {
    return {
      ok: false,
      requestId,
      state: "pdf_window_invalid",
      reason: "P9_DELIVERY_INBOUND_ID_INVALID",
      reportMessageId,
    };
  }

  const file = client as DeliverySupabase & StoreFileReader & StorageClient;
  let fileRow: Record<string, unknown> | null = null;
  let signedUrl = "";
  try {
    if (!file.from || !file.storage) throw new Error("P9_DELIVERY_STORAGE_CLIENT_UNAVAILABLE");
    const fileResult = await file
      .from("store_files")
      .select("id, organization_id, store_id, storage_bucket, storage_path, original_filename, mime_type")
      .eq("id", scope.pdf_store_file_id)
      .maybeSingle();
    fileRow = record(fileResult.data);
    if (
      fileResult.error || text(fileRow?.id) !== scope.pdf_store_file_id ||
      text(fileRow?.organization_id) !== scope.organization_id || text(fileRow?.store_id) !== scope.store_id ||
      text(fileRow?.storage_bucket) !== scope.pdf_storage_bucket || text(fileRow?.storage_path) !== scope.pdf_storage_path ||
      text(fileRow?.mime_type).toLowerCase() !== "application/pdf"
    ) throw new Error("P9_DELIVERY_PDF_SNAPSHOT_INVALID");
    const signed = await file.storage.from(scope.pdf_storage_bucket).createSignedUrl(scope.pdf_storage_path, SIGNED_PDF_EXPIRATION_SECONDS);
    if (signed.error || !text(signed.data?.signedUrl)) throw new Error("P9_DELIVERY_PDF_SIGNED_URL_FAILED");
    signedUrl = text(signed.data?.signedUrl);
  } catch (error) {
    return {
      ok: false,
      requestId,
      state: "pdf_prepare_failed",
      reason: error instanceof Error ? error.message : "P9_DELIVERY_PDF_PREPARE_FAILED",
      reportMessageId,
    };
  }

  let pdfClaim: ClaimResult;
  try {
    pdfClaim = await callRpc(
      client,
      QUOTE_APPROVAL_DELIVERY_RPC.claim,
      { p_request_id: requestId, p_component: "pdf", p_inbound_window_message_id: pdfWindowPolicy.lastInboundMessageId },
      (data) => normalizeClaim(data, requestId, "pdf"),
    );
  } catch (error) {
    return {
      ok: false,
      requestId,
      state: "pdf_not_retryable",
      reason: error instanceof Error ? error.message : "P9_DELIVERY_PDF_CLAIM_FAILED",
      reportMessageId,
    };
  }
  let pdfPolicy: Awaited<ReturnType<typeof resolveResponsibleWhatsappOutboundPolicy>>;
  try {
    pdfPolicy = await resolvePolicy({
      supabase: policyClient,
      organizationId: scope.organization_id,
      storeId: scope.store_id,
      responsibleId: scope.responsible_id,
      destination: scope.destination,
    });
  } catch {
    pdfPolicy = { ok: false, reason: "P9_DELIVERY_PDF_POLICY_READ_FAILED" };
  }
  if (!pdfPolicy.ok || pdfPolicy.mode !== "free_form" || !pdfPolicy.lastInboundMessageId) {
    const reason = !pdfPolicy.ok ? pdfPolicy.reason : "P9_DELIVERY_PDF_POLICY_CHANGED";
    try {
      await finish(client, requestId, "pdf", pdfClaim.claim_token, "failed", null, reason);
    } catch {
      return {
        ok: false,
        requestId,
        state: "finalization_uncertain",
        reason: "P9_DELIVERY_PDF_FINALIZATION_FAILED",
        reportMessageId,
      };
    }
    return { ok: false, requestId, state: "pdf_blocked", reason, reportMessageId };
  }
  const pdf = await sendClaimed({
    client,
    scope,
    claim: pdfClaim,
    payload: { type: "document", link: signedUrl, filename: text(fileRow?.original_filename) || "orcamento.pdf" },
    transport,
  });
  if (!pdf.ok) return {
    ok: false,
    requestId,
    state: pdf.state,
    reason: pdf.reason,
    reportMessageId,
    ...(pdf.externalMessageId ? { pdfMessageId: pdf.externalMessageId } : {}),
  };
  if (pdf.finish.request_status !== "awaiting_responsible") {
    return {
      ok: false,
      requestId,
      state: "unexpected_request_status",
      reason: "P9_DELIVERY_FINAL_STATUS_NOT_AWAITING_RESPONSIBLE",
      requestStatus: pdf.finish.request_status,
      reportMessageId,
      pdfMessageId: pdf.externalMessageId,
    };
  }
  return {
    ok: true,
    requestId,
    requestStatus: pdf.finish.request_status,
    reportMessageId,
    pdfMessageId: pdf.externalMessageId,
  };
}
