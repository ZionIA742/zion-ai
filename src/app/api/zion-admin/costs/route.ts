import { createClient } from "@supabase/supabase-js";
import { resolveZionAdminApiAccess } from "@/lib/server/zion-admin-api-access";
import { createZionAdminApiDeniedResponse, createZionAdminApiJsonResponse } from "@/lib/server/zion-admin-api-response";
import {
  applicableFixedCosts,
  classifyCostRun,
  monthlyAccrual,
  parseCostPeriod,
  type CostVersion,
  type AiCostCategory,
  type CostSourceAvailability,
  type CostCompleteness,
  classifyCostCompleteness,
  toKnownCostNumber,
} from "@/lib/server/zion-admin-costs";

export const dynamic = "force-dynamic";
const TIMEZONE = "America/Sao_Paulo";
const TYPES: AiCostCategory[] = ["sales", "assistant", "images", "catalog", "unclassified"];

type AiRun = {
  id: string;
  created_at: string;
  status: string | null;
  cost_usd: unknown;
  tokens_prompt: unknown;
  tokens_completion: unknown;
  input: unknown;
  output: unknown;
  conversation_id: string | null;
  lead_id: string | null;
};

type Closure = {
  month: string;
  fixed_brl_cents: number;
  ai_usd: number | string;
  fx_usd_brl: number | string;
  variable_brl_cents: number;
  total_brl_cents: number;
  fixed_items: Array<{ name: string; amount_cents: number }>;
  ai_runs: number;
  closed_at: string;
};

type VariableExpenseRow = {
  id: string;
  idempotency_key: string;
  name: string;
  category: string;
  description: string | null;
  amount_minor: number | string;
  currency: "BRL" | "USD";
  expense_date: string;
  competence_month: string;
  source: "manual";
  status: "active" | "cancelled";
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
};

const VARIABLE_MUTATION_ACTIONS = ["add_variable", "edit_variable", "cancel_variable"] as const;
type VariableMutationAction = (typeof VARIABLE_MUTATION_ACTIONS)[number];

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function parseMinorAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(minor) && minor > 0 && minor <= 100000000000 ? minor : null;
}

export function parseDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

export function mapVariableExpenseRpcError(message: string) {
  if (/CLOSED|ALREADY_CLOSED|MONTH_ALREADY_CLOSED/i.test(message)) return [409, "A competência financeira já está fechada."] as const;
  if (/STALE_VERSION|VERSION_OR_MONTH|CHANGED_DURING_OPERATION/i.test(message)) return [409, "O lançamento foi alterado; recarregue os dados e tente novamente."] as const;
  if (/OPERATION_KEY_REUSED/i.test(message)) return [409, "A chave de idempotência já foi usada com outros dados."] as const;
  if (/NOT_FOUND/i.test(message)) return [404, "Despesa variável não encontrada."] as const;
  if (/PERMISSION|AUTH|ACTOR/i.test(message)) return [403, "Operação administrativa não autorizada."] as const;
  if (/INVALID|REQUIRED|ACTIVE/i.test(message)) return [400, "Dados da despesa variável inválidos."] as const;
  return [503, "Não foi possível confirmar a operação da despesa variável."] as const;
}

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SERVICE_UNAVAILABLE");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function brazilToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (name: string) => parts.find((entry) => entry.type === name)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function nextMonth(month: string) {
  const date = new Date(`${month}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 7) + "-01";
}
function enumerateMonths(startMonth: string, endExclusive: string, limit = 120) {
  const months: string[] = [];
  for (let m = startMonth; m < endExclusive; m = nextMonth(m)) {
    months.push(m);
    if (months.length > limit) throw new Error("PERIOD_TOO_LARGE");
  }
  return months;
}

/** Banco Central PTAX official sell quotations. Absence means BRL estimate is unavailable, not zero. */
async function loadPtaxMonths(fromMonth: string, throughMonth: string): Promise<Record<string, number>> {
  const first = fromMonth.slice(5, 7) + "-01-" + fromMonth.slice(0, 4);
  const year = Number(throughMonth.slice(0, 4));
  const month = Number(throughMonth.slice(5, 7));
  const lastDate = new Date(Date.UTC(year, month, 0));
  const last = `${String(month).padStart(2, "0")}-${String(lastDate.getUTCDate()).padStart(2, "0")}-${year}`;
  const params = new URLSearchParams({
    "@dataInicial": `'${first}'`,
    "@dataFinalCotacao": `'${last}'`,
    "$top": "1500",
    "$select": "cotacaoVenda,dataHoraCotacao",
    "$orderby": "dataHoraCotacao asc",
    "$format": "json",
  });
  const url = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?${params}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(6000), next: { revalidate: 3600 } });
  if (!response.ok) throw new Error("PTAX_UNAVAILABLE");
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("value" in body) || !Array.isArray(body.value)) throw new Error("PTAX_INVALID");
  const byMonth: Record<string, number> = {};
  for (const row of body.value as Array<{ cotacaoVenda?: unknown; dataHoraCotacao?: unknown }>) {
    const date = String(row.dataHoraCotacao || "");
    const rate = Number(row.cotacaoVenda);
    if (!/^\d{4}-\d{2}-\d{2}/.test(date) || !Number.isFinite(rate) || rate <= 0 || rate >= 1000) continue;
    const key = date.slice(0, 7) + "-01";
    byMonth[key] = rate;
  }
  return byMonth;
}

async function loadAllRuns(supabase: ReturnType<typeof createServiceClient>, start: string, end: string) {
  const result: AiRun[] = [];
  const size = 500;
  for (let offset = 0; offset < 100000; offset += size) {
    const { data, error } = await supabase.from("ai_runs")
      .select("id,created_at,status,cost_usd,tokens_prompt,tokens_completion,input,output,conversation_id,lead_id")
      .gte("created_at", start).lt("created_at", end)
      .order("created_at", { ascending: true }).order("id", { ascending: true })
      .range(offset, offset + size - 1);
    if (error || !data) throw new Error("AI_COST_SOURCE_UNAVAILABLE");
    result.push(...(data as AiRun[]));
    if (data.length < size) return result;
  }
  throw new Error("AI_COST_SOURCE_TOO_LARGE");
}

async function countMessages(supabase: ReturnType<typeof createServiceClient>, table: string, from: string, to: string, sales = false) {
  let query = supabase.from(table).select("id", { count: "exact", head: true }).gte("created_at", from).lt("created_at", to);
  if (sales) query = query.eq("sender", "ai").eq("direction", "outgoing").is("deleted_at", null);
  const { count, error } = await query;
  return error ? null : count;
}

function readMonthOf(timestamp: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit" }).format(new Date(timestamp)) + "-01";
}

export async function GET(request: Request) {
  const access = await resolveZionAdminApiAccess();
  if (!access.ok) return createZionAdminApiDeniedResponse(access);
  const url = new URL(request.url);
  const today = brazilToday();
  const period = url.searchParams.get("period") || "month";
  const anchor = url.searchParams.get("anchor") || today;
  let range: ReturnType<typeof parseCostPeriod>;
  try { range = parseCostPeriod(period, anchor); } catch {
    return createZionAdminApiJsonResponse({ error: "Escolha um período válido." }, 400);
  }
  // No forecasts masquerading as incurred expenses.
  if (range.startDate > today) return createZionAdminApiJsonResponse({ error: "Período futuro não contém gasto realizado." }, 400);
  try {
    const db = createServiceClient();
    const todayMonth = today.slice(0, 7) + "-01";
    const tomorrow = new Date(`${today}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowIso = tomorrow.toISOString().slice(0, 10);
    const effectiveEnd = new Date(`${tomorrowIso}T03:00:00Z`).toISOString() < range.end
      ? new Date(`${tomorrowIso}T03:00:00Z`).toISOString() : range.end;
    const [versionsResult, itemsResult, closureResult, runs, salesMessages, assistantMessages, variableExpensesResult] = await Promise.all([
      db.from("zion_admin_fixed_cost_versions").select("item_id,effective_month,name,amount_cents,frequency,enabled").order("effective_month", { ascending: true }),
      db.from("zion_admin_fixed_cost_items").select("id,starts_on"),
      db.from("zion_admin_monthly_closures").select("month,fixed_brl_cents,ai_usd,fx_usd_brl,variable_brl_cents,total_brl_cents,fixed_items,ai_runs,closed_at").order("month", { ascending: false }),
      loadAllRuns(db,range.start,effectiveEnd),
      countMessages(db,"messages",range.start,effectiveEnd,true),
      countMessages(db,"store_assistant_messages",range.start,effectiveEnd),
      db.from("zion_admin_variable_expenses")
        .select("id,idempotency_key,name,category,description,amount_minor,currency,expense_date,competence_month,source,status,created_at,updated_at,cancelled_at")
        .gte("expense_date", range.startDate)
        .lt("expense_date", range.endDate)
        .order("expense_date", { ascending: false })
        .order("id", { ascending: true }),
    ]);
    if (versionsResult.error || itemsResult.error || closureResult.error) throw new Error("COST_LEDGER_MIGRATION_REQUIRED");
    const startedOnById = new Map<string, string>((itemsResult.data ?? []).map((item) => [String(item.id), String(item.starts_on)] as const));
    const versions: CostVersion[] = (versionsResult.data ?? []).map((r) => ({
      cost_id: r.item_id, effective_month: r.effective_month, name: r.name,
      amount_cents: Number(r.amount_cents), frequency: r.frequency, enabled: r.enabled,
    }));
    const closures = (closureResult.data ?? []) as Closure[];
    const months = enumerateMonths(range.startMonth,range.endMonthExclusive < nextMonth(todayMonth) ? range.endMonthExclusive : nextMonth(todayMonth));
    const byMonth = Object.fromEntries(months.map((month) => [month, {
      costUsd: 0, runs: 0, unpriced: 0, tokens: 0, costValuesKnown: true, tokenValuesKnown: true,
      categories: Object.fromEntries(TYPES.map((type) => [type, { usd: 0, tokens: 0, runs: 0, costValuesKnown: true, tokenValuesKnown: true }])),
    }])) as Record<string, { costUsd: number; runs: number; unpriced: number; tokens: number; costValuesKnown: boolean; tokenValuesKnown: boolean; categories: Record<AiCostCategory, { usd: number; tokens: number; runs: number; costValuesKnown: boolean; tokenValuesKnown: boolean }> }>;
    for (const run of runs) {
      const month = readMonthOf(run.created_at);
      const slot = byMonth[month];
      if (!slot) continue;
      const value = toKnownCostNumber(run.cost_usd);
      const promptTokens = toKnownCostNumber(run.tokens_prompt);
      const completionTokens = toKnownCostNumber(run.tokens_completion);
      const priced = value != null;
      const tokensKnown = promptTokens != null && completionTokens != null;
      const tokens = tokensKnown ? promptTokens + completionTokens : 0;
      const category = classifyCostRun(run);
      slot.runs += 1;
      slot.categories[category].runs += 1;
      if (tokensKnown) slot.categories[category].tokens += tokens;
      if (priced) { slot.costUsd += value; slot.categories[category].usd += value; }
      else { slot.unpriced += 1; slot.costValuesKnown = false; slot.categories[category].costValuesKnown = false; }
      if (tokensKnown) slot.tokens += tokens;
      else { slot.tokenValuesKnown = false; slot.categories[category].tokenValuesKnown = false; }
    }
    const closureByMonth = new Map(closures.map((value) => [value.month, value]));
    let fxRates: Record<string, number> = {};
    let fxUnavailable = false;
    if (months.length > 0) {
      try { fxRates = await loadPtaxMonths(months[0],months[months.length - 1]); }
      catch { fxUnavailable = true; }
    }
    const breakdown = TYPES.reduce((obj,type) => ({ ...obj, [type]: { usd: 0, tokens: 0, runs: 0, costValuesKnown: true, tokenValuesKnown: true } }), {} as Record<AiCostCategory, { usd: number; tokens: number; runs: number; costValuesKnown: boolean; tokenValuesKnown: boolean }>);
    const rows = months.map((month) => {
      const local = byMonth[month];
      const closure = closureByMonth.get(month);
      const wholeMonthFixed = closure ? Number(closure.fixed_brl_cents) : applicableFixedCosts(versions,month)
        .filter((fixed) => (startedOnById.get(fixed.cost_id) ?? month) <= (month === todayMonth ? today : `${month.slice(0,7)}-31`))
        .reduce((sum, fixed) => sum + fixed.monthly_cents, 0);
      // Day/week show fixed expenses ONLY after their real starts_on date.
      // November 2026 still contains the entire agreed monthly amount.
      const fixedCents = period === "day" || period === "week"
        ? applicableFixedCosts(versions, month).reduce((sum, fixed) => sum + monthlyAccrual(
            fixed.monthly_cents,
            month,
            range.startDate,
            range.endDate < tomorrowIso ? range.endDate : tomorrowIso,
            startedOnById.get(fixed.cost_id) ?? month,
          ), 0)
        : wholeMonthFixed;
      const usd = closure && period !== "day" && period !== "week" ? Number(closure.ai_usd) : local.costUsd;
      const fx = closure ? Number(closure.fx_usd_brl) : fxRates[month] ?? null;
      const brlCents = closure && period !== "day" && period !== "week" ? Number(closure.variable_brl_cents) : fx == null || local.unpriced > 0 ? null : Math.round(local.costUsd * fx * 100);
      const cost = closure && period !== "day" && period !== "week" ? Number(closure.total_brl_cents)
        : brlCents == null ? null : fixedCents + brlCents;
      for (const type of TYPES) {
        breakdown[type].usd += local.categories[type].usd;
        breakdown[type].tokens += local.categories[type].tokens;
        breakdown[type].runs += local.categories[type].runs;
        breakdown[type].costValuesKnown = breakdown[type].costValuesKnown && local.categories[type].costValuesKnown;
        breakdown[type].tokenValuesKnown = breakdown[type].tokenValuesKnown && local.categories[type].tokenValuesKnown;
      }
      const closureComplete = Boolean(closure && period !== "day" && period !== "week"
        && toKnownCostNumber(closure.ai_usd) != null
        && toKnownCostNumber(closure.variable_brl_cents) != null
        && toKnownCostNumber(closure.total_brl_cents) != null);
      const costCompleteness = closureComplete ? "complete" : classifyCostCompleteness(local.runs, "available", local.costValuesKnown);
      const tokenCompleteness = classifyCostCompleteness(local.runs, "available", local.tokenValuesKnown);
      return {
        month, closed: Boolean(closure) && period !== "day" && period !== "week", fixedCents,
        aiCostUsd: closureComplete ? toKnownCostNumber(closure?.ai_usd) : costCompleteness === "complete" ? usd : null,
        fxRate: fx, variableCents: costCompleteness === "complete" ? brlCents : null, totalCents: costCompleteness === "complete" ? cost : null,
        executions: closure && period !== "day" && period !== "week" ? Number(closure.ai_runs) : local.runs,
        unpriced: local.unpriced, tokens: tokenCompleteness === "complete" ? local.tokens : null,
        costCompleteness, tokenCompleteness,
      };
    });
    // Previous monthly totals take the frozen values, never a recalculation of modified cost policies.
    const fixedTotal = rows.reduce((n,r) => n + r.fixedCents, 0);
    const totalRuns = runs.length;
    const allCostsKnown = totalRuns > 0 && runs.every((run) => toKnownCostNumber(run.cost_usd) != null);
    const allTokensKnown = totalRuns > 0 && runs.every((run) => toKnownCostNumber(run.tokens_prompt) != null && toKnownCostNumber(run.tokens_completion) != null);
    const hasFrozenCost = rows.some((row) => row.closed && row.costCompleteness === "complete");
    const aiCostCompleteness: CostCompleteness = totalRuns === 0 && hasFrozenCost
      ? "complete"
      : classifyCostCompleteness(totalRuns, "available", allCostsKnown);
    const tokenCompleteness: CostCompleteness = classifyCostCompleteness(totalRuns, "available", allTokensKnown);
    const aiCostUsd = aiCostCompleteness === "complete" ? rows.reduce((n,r) => n + (r.aiCostUsd ?? 0), 0) : null;
    const variableTotal = aiCostCompleteness === "complete" && rows.every((r) => r.variableCents != null) ? rows.reduce((n,r) => n + (r.variableCents ?? 0), 0) : null;
    const grandTotal = variableTotal == null ? null : fixedTotal + variableTotal;
    const ptaxUnavailable = fxUnavailable || rows.some((row) => !row.closed && row.fxRate == null);
    const breakdownPayload = Object.fromEntries(TYPES.map((type) => {
      const item = breakdown[type];
      return [type, {
        usd: item.costValuesKnown && item.runs > 0 ? item.usd : null,
        tokens: item.tokenValuesKnown && item.runs > 0 ? item.tokens : null,
        runs: item.runs,
        costCompleteness: classifyCostCompleteness(item.runs, "available", item.costValuesKnown),
        tokenCompleteness: classifyCostCompleteness(item.runs, "available", item.tokenValuesKnown),
      }];
    }));
    const configured = [...new Set(versions.map((r) => r.cost_id))].map((id) => {
      const history = versions.filter((r) => r.cost_id === id);
      const latest = history[history.length - 1];
      const next = history.findLast((r) => r.effective_month <= nextMonth(todayMonth)) ?? latest;
      return { id, ...next, effective_month: next.effective_month, amount_cents: next.amount_cents };
    });
    const availableSince = versions.reduce((min,r)=>!min||r.effective_month<min?r.effective_month:min, "");
    const candidateMonths = availableSince && availableSince < todayMonth
      ? enumerateMonths(availableSince,todayMonth,36).filter((m)=>!closureByMonth.has(m)) : [];
    const selectedMonth = period === "month" ? rows[0] : null;
    return createZionAdminApiJsonResponse({
      period, anchor, timezone: TIMEZONE, range, initialFixedCostsStartDate: "2026-11-23",
      source: "ai_runs.cost_usd", fxSource: "Banco Central do Brasil — PTAX venda (última cotação disponível de cada mês)",
      fxUnavailable, historicalClosures: closures, closeCandidates: candidateMonths,
      selectedMonth, months: rows, fixedCosts: configured, activeFixedCosts: applicableFixedCosts(versions,todayMonth),
      dataAvailability: {
        aiRuns: "available" as CostSourceAvailability,
        fixedCosts: "available" as CostSourceAvailability,
        ptax: ptaxUnavailable ? "unavailable" as CostSourceAvailability : "available" as CostSourceAvailability,
        messagesSales: salesMessages == null ? "unavailable" as CostSourceAvailability : "available" as CostSourceAvailability,
        messagesAssistant: assistantMessages == null ? "unavailable" as CostSourceAvailability : "available" as CostSourceAvailability,
        variableExpenses: variableExpensesResult.error ? "unavailable" as CostSourceAvailability : "available" as CostSourceAvailability,
      },
      totals: { fixedCents: fixedTotal, variableCents: variableTotal, totalCents: grandTotal, aiCostUsd,
        costCompleteness: aiCostCompleteness, tokenCompleteness,
        executions: runs.length, unpricedExecutions: runs.filter((run)=>toKnownCostNumber(run.cost_usd) == null).length,
        tokens: tokenCompleteness === "complete" ? runs.reduce((n,r)=>n + (toKnownCostNumber(r.tokens_prompt) ?? 0) + (toKnownCostNumber(r.tokens_completion) ?? 0),0) : null,
        messagesSales: salesMessages, messagesAssistant: assistantMessages, breakdown: breakdownPayload,
      },
      variableExpenses: variableExpensesResult.error ? null : (variableExpensesResult.data as VariableExpenseRow[]),
      note: "Valores variáveis em BRL são estimados pela PTAX venda, não pela fatura do cartão. Meses fechados permanecem congelados.",
    }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    const migration = message === "COST_LEDGER_MIGRATION_REQUIRED";
    return createZionAdminApiJsonResponse({ error: migration ? "A estrutura da Central de Custos ainda não foi aplicada no banco." : "Não foi possível verificar os custos com segurança.", code: migration ? "MIGRATION_PENDING" : "COSTS_UNAVAILABLE" }, 503);
  }
}

export async function POST(request: Request) {
  const access = await resolveZionAdminApiAccess();
  if (!access.ok) return createZionAdminApiDeniedResponse(access);
  if (!access.resolution.capabilities.includes("manage_accounts")) {
    return createZionAdminApiJsonResponse({ error: "Acesso de edição não autorizado." }, 403);
  }
  let payload: Record<string, unknown>;
  try { payload = await request.json(); } catch { return createZionAdminApiJsonResponse({error:"Corpo inválido."},400); }
  const action = String(payload.action ?? "");
  if (!["add", "edit", "remove", "close", ...VARIABLE_MUTATION_ACTIONS].includes(action)) return createZionAdminApiJsonResponse({error:"Ação inválida."},400);
  if ((VARIABLE_MUTATION_ACTIONS as readonly string[]).includes(action)) {
    const variableAction = action as VariableMutationAction;
    const operationKey = typeof payload.operationKey === "string" ? payload.operationKey.trim() : "";
    const id = payload.id == null ? null : String(payload.id);
    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    const category = typeof payload.category === "string" ? payload.category.trim() : "";
    const description = payload.description == null ? null : String(payload.description);
    const currency = payload.currency === "BRL" || payload.currency === "USD" ? payload.currency : null;
    const expenseDate = parseDate(payload.expenseDate);
    const competenceMonth = parseDate(payload.competenceMonth);
    const amountMinor = variableAction === "cancel_variable"
      ? null
      : parseMinorAmount(payload.amountMinor !== undefined ? payload.amountMinor : payload.amount);
    const expectedUpdatedAt = payload.expectedUpdatedAt == null ? null : String(payload.expectedUpdatedAt);
    const reason = payload.reason == null ? null : String(payload.reason);
    const validCommon = operationKey.length >= 8 && operationKey.length <= 200;
    const validId = variableAction === "add_variable" ? id === null : isUuid(id);
    const validFields = variableAction === "cancel_variable"
      ? Boolean(reason == null || reason.trim().length <= 2000)
      : name.length >= 1 && name.length <= 100 && category.length >= 1 && category.length <= 80
        && (description === null || description.length <= 2000) && amountMinor !== null && currency !== null
        && expenseDate !== null && competenceMonth !== null
        && competenceMonth === `${expenseDate.slice(0, 7)}-01`
        && (variableAction === "add_variable" || expectedUpdatedAt !== null);
    if (!isUuid(access.sessionUserId)) {
      return createZionAdminApiJsonResponse({ error: "Identidade administrativa inválida." }, 403);
    }
    if (!validCommon || !validId || !validFields) {
      return createZionAdminApiJsonResponse({ error: "Dados da despesa variável inválidos." }, 400);
    }
    try {
      const db = createServiceClient();
      const { data, error } = await db.rpc("zion_admin_mutate_variable_expense", {
        p_action: variableAction === "add_variable" ? "created" : variableAction === "edit_variable" ? "edited" : "cancelled",
        p_operation_key: operationKey,
        p_expense_id: id,
        p_name: variableAction === "cancel_variable" ? null : name,
        p_category: variableAction === "cancel_variable" ? null : category,
        p_description: variableAction === "cancel_variable" ? null : description,
        p_amount_minor: amountMinor,
        p_currency: variableAction === "cancel_variable" ? null : currency,
        p_expense_date: variableAction === "cancel_variable" ? null : expenseDate,
        p_competence_month: variableAction === "cancel_variable" ? null : competenceMonth,
        p_expected_updated_at: expectedUpdatedAt,
        p_reason: reason,
        p_actor_id: access.sessionUserId,
      });
      if (error) {
        const [status, message] = mapVariableExpenseRpcError(error.message || "RPC_FAILED");
        return createZionAdminApiJsonResponse({ error: message }, status);
      }
      return createZionAdminApiJsonResponse({ ok: true, ...(data && typeof data === "object" ? data : { result: data }) }, 200);
    } catch {
      return createZionAdminApiJsonResponse({ error: "Não foi possível confirmar a operação da despesa variável." }, 503);
    }
  }
  if (!["add", "edit", "remove", "close"].includes(action)) return createZionAdminApiJsonResponse({error:"Ação inválida."},400);
  try {
    const db = createServiceClient();
    if (action === "close") {
      const month = String(payload.month || "");
      const todayMonth = brazilToday().slice(0,7) + "-01";
      if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month) || month >= todayMonth || month < "2020-01-01") return createZionAdminApiJsonResponse({error:"Mês ainda não encerrado ou inválido."},400);
      const rates = await loadPtaxMonths(month,month);
      const fx = rates[month];
      if (!fx) return createZionAdminApiJsonResponse({error:"Cotação PTAX verificada não disponível. O mês não foi fechado."},503);
      const {error} = await db.rpc("zion_admin_close_cost_month",{p_month:month,p_fx_usd_brl:fx});
      if (error) return createZionAdminApiJsonResponse({error:"Não foi possível fechar o mês. Confira se existem execuções sem custo identificado."},409);
      return createZionAdminApiJsonResponse({ok:true,month},200);
    }
    const name = String(payload.name ?? "").trim();
    const itemId = payload.id == null ? null : String(payload.id);
    const cents = typeof payload.amountCents === "number" && Number.isSafeInteger(payload.amountCents) ? payload.amountCents : null;
    const frequency = String(payload.frequency || "");
    if ((action !== "remove" && (name.length < 1 || name.length > 100 || cents == null || cents < 0 || cents > 100000000000 || !["monthly", "annual"].includes(frequency))) ||
      (action !== "add" && (!itemId || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(itemId)))) {
      return createZionAdminApiJsonResponse({error:"Dados da despesa inválidos."},400);
    }
    const {error} = await db.rpc("zion_admin_manage_fixed_cost",{
      p_action:action,p_item_id:action === "add" ? null : itemId,
      p_name:action === "remove" ? null : name,
      p_amount_cents:action === "remove" ? null : cents,
      p_frequency:action === "remove" ? null : frequency,
    });
    if (error) return createZionAdminApiJsonResponse({error:"Não foi possível atualizar a despesa; nada foi alterado."},409);
    return createZionAdminApiJsonResponse({ok:true,effective:"next_month"},200);
  } catch {
    return createZionAdminApiJsonResponse({error:"Serviço financeiro indisponível; nenhuma alteração foi confirmada."},503);
  }
}
