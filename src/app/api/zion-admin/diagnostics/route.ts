import { safeOperationalRecovery } from "@/lib/zion-admin-diagnostic-recovery";
import { withBackendDiagnosticRoute } from "../../../../lib/server/zion-admin-diagnostic-backend-next";
import { projectSafeDiagnosticReaderV2Evidence } from "@/lib/server/zion-admin-diagnostic-reader-v2-projection";
import { createClient } from "@supabase/supabase-js";
import {
  resolveZionAdminApiAccess,
} from "@/lib/server/zion-admin-api-access";
import {
  createZionAdminApiDeniedResponse,
  createZionAdminApiJsonResponse,
} from "@/lib/server/zion-admin-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;
const MAX_OFFSET = 5000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const INTEGER_PATTERN = /^(0|[1-9][0-9]*)$/;

const READER_FIELDS = [
  "incident_id",
  "occurrence_id",
  "organization_id",
  "store_id",
  "incident_status",
  "severity",
  "cause_confidence",
  "title_simple",
  "explanation_simple",
  "impact_simple",
  "next_action_simple",
  "first_seen_at",
  "last_seen_at",
  "occurred_at",
  "captured_at",
  "technical_error_code",
  "source_record_id",
  "occurrence_count",
  "last_failure_older_than_30_days",
] as const;

const SOURCE_FAMILIES = ["ai_runs", "operational", "backend_api", "client_browser"] as const;
type SourceFamily = (typeof SOURCE_FAMILIES)[number];
function isSourceFamily(value: unknown): value is SourceFamily {
  return SOURCE_FAMILIES.some((family) => family === value);
}

type DiagnosticQuery = {
  limit: number;
  offset: number;
  storeId: string | null;
  source: SourceFamily | null;
};

function parseBoundedInteger(
  value: string,
  minimum: number,
  maximum: number,
): number | null {
  if (!INTEGER_PATTERN.test(value)) return null;

  const number = Number(value);

  if (
    !Number.isSafeInteger(number) ||
    number < minimum ||
    number > maximum
  ) {
    return null;
  }

  return number;
}

function parseDiagnosticQuery(
  request: Request,
  unified: boolean,
  browserEnabled: boolean,
): DiagnosticQuery | null {
  const params = new URL(request.url).searchParams;
  const allowedKeys = new Set([
    "limit",
    "offset",
    "store_id",
  ]);

  if (unified) allowedKeys.add("source");
  const source = params.get("source");
  if (source !== null && (!isSourceFamily(source) || source === "client_browser" && !browserEnabled)) return null;

  for (const key of params.keys()) {
    if (!allowedKeys.has(key)) return null;
    if (params.getAll(key).length !== 1) return null;
  }

  const rawLimit = params.get("limit");
  const rawOffset = params.get("offset");
  const rawStoreId = params.get("store_id");

  const limit =
    rawLimit === null
      ? DEFAULT_LIMIT
      : parseBoundedInteger(rawLimit, 1, MAX_LIMIT);

  const offset =
    rawOffset === null
      ? 0
      : parseBoundedInteger(rawOffset, 0, MAX_OFFSET);

  if (limit === null || offset === null) {
    return null;
  }

  if (
    rawStoreId !== null &&
    !UUID_PATTERN.test(rawStoreId)
  ) {
    return null;
  }

  return {
    limit,
    offset,
    source,
    storeId:
      rawStoreId === null
        ? null
        : rawStoreId.toLowerCase(),
  };
}

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "ZION_DIAGNOSTIC_SERVICE_CONFIGURATION_UNAVAILABLE",
    );
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function projectSafeRows(
  value: unknown,
  maxRows: number,
  includeV2: boolean,
): Record<string, unknown>[] | null {
  if (
    !Array.isArray(value) ||
    value.length > maxRows
  ) {
    return null;
  }

  const items: Record<string, unknown>[] = [];

  for (const source of value) {
    if (
      source === null ||
      typeof source !== "object" ||
      Array.isArray(source)
    ) {
      return null;
    }

    const record = source as Record<string, unknown>;
    const safe: Record<string, unknown> = {};

    for (const field of READER_FIELDS) {
      safe[field] = record[field] ?? null;
    }

    if (
      typeof safe.incident_id !== "string" ||
      !UUID_PATTERN.test(safe.incident_id) ||
      typeof safe.store_id !== "string" ||
      !UUID_PATTERN.test(safe.store_id) ||
      typeof safe.organization_id !== "string" ||
      !UUID_PATTERN.test(safe.organization_id) ||
      typeof safe.last_failure_older_than_30_days !==
        "boolean"
    ) {
      return null;
    }

    if (includeV2) {
      Object.assign(
        safe,
        projectSafeDiagnosticReaderV2Evidence(record),
      );
    }

    items.push(safe);
  }

  return items;
}

function safeEnum(value: unknown, values: readonly string[]): string | null {
  return typeof value === "string" && values.includes(value) ? value : null;
}
function safeUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
function safeInt(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}
function safePath(value: unknown, prefix: string, max: number): string | null {
  return typeof value === "string" && value.startsWith(prefix) && value.length <= max && /^[a-zA-Z0-9_./\[\]()-]+$/.test(value) && !value.includes("..") ? value : null;
}
function safeDate(value: unknown): string | null {
  return typeof value === "string" && value.length <= 64 && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
}
const OPERATIONAL_CODES: Record<string, readonly string[]> = {
  channel_whatsapp_inbox: ["WHATSAPP_SALES_AI_FAILED_FINAL", "WHATSAPP_STATUS_FAILED_FINAL"],
  ai_run_queue: ["AI_RUN_QUEUE_FAILED_FINAL"],
  ai_sales_action_queue: ["SALES_ACTION_PROCESSING_FAILED"],
};
// Browser evidence is reported by the client, not proof of root cause.
function safeBrowserEvidence(r: Record<string, unknown>) {
  const pages = r.scope === "system" ? ["/zion-admin", "/zion-admin/login"] : r.scope === "store" ? ["/assistant", "/configuracoes", "/configuracoes/catalogo/[categoria]", "/configuracoes/piscinas", "/crm", "/crm/lead/[id]", "/crm/opportunity/[id]", "/dashboard", "/help", "/inbox", "/schedule"] : [];
  const pick = (v: unknown, allowed: readonly string[]) => typeof v === "string" && allowed.includes(v) ? v : null;
  const asset = typeof r.browser_asset === "string" && /^\/_next\/static\/chunks\/([0-9]{1,8}-)?[a-f0-9]{8,64}\.js$/.test(r.browser_asset) ? r.browser_asset : null;
  const pos = (v: unknown) => asset && typeof v === "number" && Number.isSafeInteger(v) && v >= 1 && v <= 1000000 ? v : null;
  return {
    browser_page: pick(r.browser_page, pages),
    browser_kind: pick(r.browser_kind, r.technical_error_code === "BROWSER_UNCAUGHT_ERROR" ? ["uncaught_error"] : r.technical_error_code === "BROWSER_UNHANDLED_REJECTION" ? ["unhandled_rejection"] : []),
    browser_error_name: pick(r.browser_error_name, ["Error", "TypeError", "ReferenceError", "RangeError", "SyntaxError", "URIError", "EvalError", "AggregateError"]),
    browser_asset: asset,
    browser_line: pos(r.browser_line),
    browser_column: pos(r.browser_column),
  };
}

function projectUnifiedRows(value: unknown, query: DiagnosticQuery, browserEnabled: boolean): Record<string, unknown>[] | null {
  if (!Array.isArray(value) || value.length > query.limit) return null;
  const result: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const r = row as Record<string, unknown>;
    const family = r.source_family;
    const scope = r.scope;
    if (!isSourceFamily(family) || (query.source !== null && family !== query.source) ||
        !safeUuid(r.incident_id) || !safeUuid(r.occurrence_id) || seen.has(r.incident_id.toLowerCase()) ||
        typeof r.last_failure_older_than_30_days !== "boolean" ||
        !(scope === "system" && r.organization_id === null && r.store_id === null ||
          scope === "organization" && safeUuid(r.organization_id) && r.store_id === null ||
          scope === "store" && safeUuid(r.organization_id) && safeUuid(r.store_id)) ||
        (query.storeId !== null && (typeof r.store_id !== "string" || r.store_id.toLowerCase() !== query.storeId))) return null;
    seen.add(r.incident_id.toLowerCase());
    const operational = family === "operational";
    const ai = family === "ai_runs";
    const backend = family === "backend_api";
    const browser = family === "client_browser";
    const origin = r.source_system;
    const component = r.component;
    const code = r.technical_error_code;
    if (ai && (scope !== "store" || origin !== "ai_runs" || r.category !== "ai_run_error" || !safeEnum(code, ["AI_RUN_ERROR_RECORDED", "DIAGNOSTIC_CODE_UNAVAILABLE"]) || !safeEnum(component, ["sales_ai", "assistant_ai", "ai_origin_unknown", "unknown"]))) return null;
    if (operational && (scope !== "store" || r.category !== "operational_queue_failure" ||
        !(origin === "channel_whatsapp_inbox" && component === "whatsapp_inbox" || origin === "ai_run_queue" && component === "sales_ai_queue" || origin === "ai_sales_action_queue" && component === "sales_action_queue") ||
        typeof origin !== "string" || !safeEnum(code, OPERATIONAL_CODES[origin] ?? []))) return null;
    if (backend && (origin !== "backend_api" || component !== "backend" || r.category !== "backend_api_failure" || !safeEnum(code, ["BACKEND_HTTP_5XX", "BACKEND_UNHANDLED_EXCEPTION"]))) return null;
    if (browser && (!browserEnabled || (scope !== "store" && scope !== "system") || origin !== "client_browser" || component !== "browser" || r.category !== "client_browser_failure" || !safeEnum(code, ["BROWSER_UNCAUGHT_ERROR", "BROWSER_UNHANDLED_REJECTION"]))) return null;
    const safe: Record<string, unknown> = {};
    for (const field of READER_FIELDS) safe[field] = r[field] ?? null;
    for (const field of ["title_simple", "explanation_simple", "impact_simple", "next_action_simple"] as const) {
      const text = r[field];
      safe[field] = typeof text === "string" && text.length <= 4000 ? text : null;
    }
    for (const field of ["first_seen_at", "last_seen_at", "occurred_at", "captured_at"] as const) safe[field] = safeDate(r[field]);
    safe.incident_status = safeEnum(r.incident_status, ["open", "investigating", "resolved"]);
    safe.severity = safeEnum(r.severity, ["info", "warning", "error", "critical"]);
    safe.cause_confidence = safeEnum(r.cause_confidence, ["unknown", "hypothesis", "confirmed"]);
    safe.source_record_id = safeUuid(r.source_record_id) ? r.source_record_id : null;
    safe.occurrence_count = safeInt(r.occurrence_count, 1, Number.MAX_SAFE_INTEGER);
    if (!safe.incident_status || !safe.severity || !safe.cause_confidence || !safe.last_seen_at || !safe.occurrence_count) return null;
    const file = backend ? safePath(r.backend_source_file, "src/", 300) : null;
    Object.assign(safe, {
      scope, source_system: origin, source_family: family, component, category: r.category,
      resolved_at: safeDate(r.resolved_at),
      operational_recovery: operational
        ? safeOperationalRecovery(
            r.operational_recovery,
            r.incident_status,
            r.resolved_at,
          )
        : null,
      backend_route: backend ? safePath(r.backend_route, "/api/", 200) : null,
      backend_method: backend ? safeEnum(r.backend_method, ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) : null,
      backend_kind: backend ? safeEnum(r.backend_kind, ["unhandled_exception", "http_response"]) : null,
      backend_http_status: backend && code === "BACKEND_HTTP_5XX" ? safeInt(r.backend_http_status, 500, 599) : null,
      backend_error_name: backend ? safeEnum(r.backend_error_name, ["Error", "TypeError", "ReferenceError", "RangeError", "SyntaxError", "URIError", "EvalError", "AggregateError", "AbortError", "TimeoutError"]) : null,
      backend_reported_error_code: backend ? safeEnum(r.backend_reported_error_code, ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EPIPE", "ERR_NETWORK", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET", "08006", "22023", "23502", "23503", "23505", "23514", "40001", "40P01", "42501", "42703", "42883", "42P01", "55P03", "57014", "PGRST202", "PGRST204", "PGRST301"]) : null,
      backend_source_file: file,
      backend_source_line: file ? safeInt(r.backend_source_line, 1, 1000000) : null,
      backend_source_column: file ? safeInt(r.backend_source_column, 1, 1000000) : null,
      operational_attempt_count: operational ? safeInt(r.operational_attempt_count, 0, 2147483647) : null,
    });
    if (browser) Object.assign(safe, safeBrowserEvidence(r));
    if (ai) Object.assign(safe, projectSafeDiagnosticReaderV2Evidence(r));
    result.push(safe);
  }
  return result;
}

async function zionBackendOriginalGET(request: Request) {
  try {
    const access = await resolveZionAdminApiAccess({
      requiredCapability: "manage_accounts",
    });

    if (!access.ok) {
      return createZionAdminApiDeniedResponse(access);
    }

    const unified = process.env.ZION_ADMIN_DIAGNOSTIC_UNIFIED_READER_ENABLED === "true";
    const browserEnabled = unified && process.env.ZION_ADMIN_DIAGNOSTIC_UNIFIED_READER_V2_ENABLED === "true";
    const query = parseDiagnosticQuery(request, unified, browserEnabled);

    if (!query) {
      return createZionAdminApiJsonResponse(
        {
          ok: false,
          message: "Filtros de diagnóstico inválidos.",
        },
        400,
      );
    }

    // A RPC V1 permanece ativa por padrao.
    // Habilitar V2 somente depois da homologacao no Supabase.
    const useReaderV2 =
      process.env.ZION_ADMIN_DIAGNOSTIC_READER_V2_ENABLED === "true";

    const serviceSupabase = createServiceClient();

    const { data, error } = await serviceSupabase.rpc(
      browserEnabled ? "list_zion_admin_diagnostics_recovery_by_system" : unified ? "list_zion_admin_diagnostics_unified_by_system" : useReaderV2
        ? "list_zion_admin_ai_run_diagnostics_v2_by_system"
        : "list_zion_admin_ai_run_diagnostics_by_system",
      {
        p_limit: query.limit,
        p_offset: query.offset,
        p_store_id: query.storeId,
        ...(unified ? { p_source: query.source } : {}),
      },
    );

    if (error) {
      return createZionAdminApiJsonResponse(
        {
          ok: false,
          message: "Diagnósticos temporariamente indisponíveis.",
        },
        503,
      );
    }

    const items = unified ? projectUnifiedRows(data, query, browserEnabled) : projectSafeRows(
      data,
      query.limit,
      useReaderV2,
    );

    if (items === null) {
      return createZionAdminApiJsonResponse(
        {
          ok: false,
          message: "Resposta de diagnóstico inválida.",
        },
        503,
      );
    }

    return createZionAdminApiJsonResponse(
      {
        ok: true,
        source: browserEnabled ? "unified_v2" : unified ? "unified" : "ai_runs",
        items,
        pagination: {
          limit: query.limit,
          offset: query.offset,
          returned: items.length,
        },
      },
      200,
    );
  } catch {
    return createZionAdminApiJsonResponse(
      {
        ok: false,
        message: "Não foi possível consultar os diagnósticos.",
      },
      503,
    );
  }
}


const zionBackendObservedGET = withBackendDiagnosticRoute(
  "/api/zion-admin/diagnostics",
  "GET",
  zionBackendOriginalGET,
);

export async function GET(request: Request) {
  return zionBackendObservedGET(request);
}
