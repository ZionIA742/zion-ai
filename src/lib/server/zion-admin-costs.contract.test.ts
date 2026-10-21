import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
const read = (name: string) => readFileSync(`${process.cwd()}/${name}`, "utf8");
const api = read("src/app/api/zion-admin/costs/route.ts");
const ui = read("src/app/zion-admin/ZionAdminCostsSection.tsx");
const dashboard = read("src/app/zion-admin/ZionAdminDashboardClient.tsx");
const sql = read("supabase/migrations/20261020235900_zion_admin_cost_ledger.sql");
for (const expected of [
  "resolveZionAdminApiAccess()", 'access.resolution.capabilities.includes("manage_accounts")',
  'createServiceClient()', 'loadAllRuns(db,range.start,effectiveEnd)',
  '"ai_runs"', '"store_assistant_messages"', '"messages"',
  "loadPtaxMonths", "AI_COST_SOURCE_UNAVAILABLE", 'action === "close"',
  '"zion_admin_close_cost_month"', '"zion_admin_manage_fixed_cost"',
  "fxUnavailable", "historicalClosures", "closeCandidates",
  "monthlyAccrual", "startedOnById", "initialFixedCostsStartDate",
]) assert.equal(api.includes(expected), true, `API missing ${expected}`);
for (const expected of [
  "public.zion_admin_monthly_closures", "zion_admin_refuse_close_mutation",
  "before update or delete", "pg_advisory_xact_lock", "p_month >= v_current",
  "interval '1 month'", "REVOKE",
  "AI_RUNS_WITHOUT_COST_IN_MONTH", "service_role",
  "date '2026-11-01'", "date '2026-11-23'", "starts_on date not null",
]) assert.equal(sql.toLowerCase().includes(expected.toLowerCase()), true, `SQL missing ${expected}`);
for (const expected of [
  "Adicionar custo", "Editar despesa fixa", "Excluir", "nextMonthLabel()",
  "period,setPeriod", "closeCandidates", "Custo", "Fechamentos e histórico",
  "IA vendedora", "IA assistente", "Não apurado",
]) assert.equal(ui.includes(expected), true, `UI missing ${expected}`);
assert.equal(dashboard.includes("Acessos rápidos"), false);
assert.equal(dashboard.includes('activeGlobalSection === "costs"'), true);
assert.equal(dashboard.includes('"costs", "Custos", "costs"'), true);
assert.equal(dashboard.includes('"critical" | "ai" | "whatsapp" | "settings" | "structural"'), true);
assert.equal(dashboard.includes('renderComparisonColumn("right")'), true);
console.log("zion-admin-costs-contract: contracts passed");
