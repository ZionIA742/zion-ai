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

type DiagnosticQuery = {
  limit: number;
  offset: number;
  storeId: string | null;
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
): DiagnosticQuery | null {
  const params = new URL(request.url).searchParams;
  const allowedKeys = new Set([
    "limit",
    "offset",
    "store_id",
  ]);

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

export async function GET(request: Request) {
  try {
    const access = await resolveZionAdminApiAccess({
      requiredCapability: "manage_accounts",
    });

    if (!access.ok) {
      return createZionAdminApiDeniedResponse(access);
    }

    const query = parseDiagnosticQuery(request);

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
      useReaderV2
        ? "list_zion_admin_ai_run_diagnostics_v2_by_system"
        : "list_zion_admin_ai_run_diagnostics_by_system",
      {
        p_limit: query.limit,
        p_offset: query.offset,
        p_store_id: query.storeId,
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

    const items = projectSafeRows(
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
        source: "ai_runs",
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
