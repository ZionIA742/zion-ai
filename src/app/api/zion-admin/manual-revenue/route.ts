import { createClient } from "@supabase/supabase-js";
import { resolveZionAdminApiAccess } from "@/lib/server/zion-admin-api-access";
import {
  createZionAdminApiDeniedResponse,
  createZionAdminApiJsonResponse,
} from "@/lib/server/zion-admin-api-response";

export const dynamic = "force-dynamic";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SERVICE_UNAVAILABLE");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function currentMonth() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const find = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${find("year")}-${find("month")}-01`;
}

function validMonth(value: unknown): value is string {
  return typeof value === "string" &&
    /^20\d{2}-(0[1-9]|1[0-2])-01$/.test(value) &&
    value <= currentMonth();
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(request: Request) {
  const access = await resolveZionAdminApiAccess();
  if (!access.ok) return createZionAdminApiDeniedResponse(access);

  if (!access.resolution.capabilities.includes("manage_accounts")) {
    return createZionAdminApiJsonResponse(
      { error: "Consulta financeira nao autorizada." }, 403,
    );
  }

  const month = new URL(request.url).searchParams.get("month");
  if (!validMonth(month)) {
    return createZionAdminApiJsonResponse(
      { error: "Competencia mensal invalida." }, 400,
    );
  }

  try {
    const db = serviceClient();
    const [recordResult, auditResult] = await Promise.all([
      db.from("zion_admin_monthly_manual_revenue")
        .select("month,amount_brl_cents,revision,updated_at")
        .eq("month", month)
        .maybeSingle(),
      db.from("zion_admin_monthly_manual_revenue_audit")
        .select("revision,amount_brl_cents,recorded_at")
        .eq("month", month)
        .order("revision", { ascending: false })
        .limit(10),
    ]);

    if (recordResult.error || auditResult.error) {
      throw new Error("REVENUE_READ_FAILED");
    }

    const row = recordResult.data;
    const history = auditResult.data ?? [];

    return createZionAdminApiJsonResponse({
      ok: true,
      month,
      confirmed: row !== null,
      revenue: row ? {
        amountBrlCents: Number(row.amount_brl_cents),
        revision: row.revision,
        updatedAt: row.updated_at,
      } : null,
      history: history.map((item) => ({
        revision: item.revision,
        amountBrlCents: Number(item.amount_brl_cents),
        recordedAt: item.recorded_at,
      })),
    }, 200);
  } catch {
    return createZionAdminApiJsonResponse(
      { error: "Receita mensal indisponivel. Nenhum valor foi presumido." },
      503,
    );
  }
}

export async function POST(request: Request) {
  const access = await resolveZionAdminApiAccess();
  if (!access.ok) return createZionAdminApiDeniedResponse(access);

  if (!access.resolution.capabilities.includes("manage_accounts") ||
      !validUuid(access.sessionUserId)) {
    return createZionAdminApiJsonResponse(
      { error: "Edicao financeira nao autorizada." }, 403,
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("INVALID_BODY");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return createZionAdminApiJsonResponse(
      { error: "Solicitacao invalida." }, 400,
    );
  }

  const month = body.month;
  const amount = body.amountBrlCents;
  const revision = body.expectedRevision;
  const operationKey = body.operationKey;

  if (!validMonth(month) ||
      typeof amount !== "number" ||
      !Number.isSafeInteger(amount) ||
      amount < 0 || amount > 100000000000 ||
      typeof revision !== "number" ||
      !Number.isSafeInteger(revision) || revision < 0 ||
      !validUuid(operationKey)) {
    return createZionAdminApiJsonResponse(
      { error: "Dados da receita mensal invalidos." }, 400,
    );
  }

  try {
    const db = serviceClient();
    const { data, error } = await db.rpc(
      "zion_admin_set_manual_monthly_revenue_by_system",
      {
        p_month: month,
        p_amount_brl_cents: amount,
        p_expected_revision: revision,
        p_operation_key: operationKey,
        p_actor_id: access.sessionUserId,
      },
    );

    if (error) {
      if (/STALE_REVISION|MONTH_FINALIZED|OPERATION_REUSED/i.test(error.message)) {
        return createZionAdminApiJsonResponse(
          { error: "A competencia mudou ou esta fechada. Atualize os dados." },
          409,
        );
      }
      return createZionAdminApiJsonResponse(
        { error: "Nao foi possivel salvar a receita mensal." }, 503,
      );
    }

    if (!data || typeof data !== "object" ||
        data.ok !== true ||
        data.month !== month ||
        data.amountBrlCents !== amount ||
        !Number.isSafeInteger(data.revision) ||
        !["created", "revised", "unchanged", "replayed"].includes(data.outcome)) {
      return createZionAdminApiJsonResponse(
        { error: "Resposta financeira nao confirmada." }, 503,
      );
    }

    return createZionAdminApiJsonResponse({
      ok: true,
      month,
      amountBrlCents: data.amountBrlCents,
      revision: data.revision,
      outcome: data.outcome,
    }, 200);
  } catch {
    return createZionAdminApiJsonResponse(
      { error: "Servico de receitas indisponivel." }, 503,
    );
  }
}