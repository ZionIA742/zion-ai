import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sql = await readFile(new URL("../../../supabase/diagnostics/20261123170000_p9_10_7_a0_migration_preflight.sql", import.meta.url), "utf8");
const localP0 = await readFile(new URL("../../../supabase/migrations/20261117010000_p9_10_3_p0_human_sovereignty.sql", import.meta.url), "utf8");

test("preflight e uma unica consulta read-only com veredito unico", () => {
  assert.match(sql, /select r\.verdict/);
  assert.match(sql, /READ_ONLY_P9_10_7_A0_MIGRATION_PREFLIGHT/);
  assert.doesNotMatch(sql, /^\s*(insert|update|delete|alter|create|drop|truncate|grant|revoke)\b/im);
});

test("preflight verifica definicoes reais, grants e P0 soberano", () => {
  assert.match(sql, /pg_get_constraintdef/);
  assert.match(sql, /pg_get_indexdef/);
  assert.match(sql, /has_function_privilege/);
  assert.match(sql, /explicit_confirmation_required/);
  assert.match(sql, /return\[\[:space:\]\]\+0/);
  assert.match(sql, /not like '%human_release_conversation_to_ai%'/);
  assert.match(sql, /not like '%update public\.conversation_human_takeover_leases%'/);
  assert.match(sql, /left join pg_proc p on p\.oid = target\.oid/);
  assert.match(sql, /left join pg_proc p on p\.oid = to_regprocedure\(x\.object_identity\)/);
  assert.match(sql, /has_table_privilege\('service_role', target\.oid/);
  assert.doesNotMatch(sql, /has_table_privilege\('service_role', 'public\.conversation_human_response_commitments'/);
});

test("RED: baseline sem objetos novos fica pendente e nao exige objetos criados pela migration", () => {
  assert.match(sql, /present_count = 0 and s\.base_ok then 'PENDING_10_7_A0_COMPATIBLE_BASELINE'/);
  assert.match(sql, /when object_kind = 'table' then to_regclass\(object_identity\) is not null/);
  assert.match(sql, /when object_kind = 'function' then to_regprocedure\(object_identity\) is not null/);
  assert.match(sql, /function_catalog as \(/);
  assert.match(sql, /left join pg_proc p on p\.oid = to_regprocedure\(x\.object_identity\)/);
});

test("GREEN: installed exige contratos, seguranca e todos os objetos; parcial bloqueia", () => {
  assert.match(sql, /present_count = s\.target_count and s\.base_ok and s\.installed_ok then 'INSTALLED_10_7_A0'/);
  assert.match(sql, /else 'BLOQUEADO' end as verdict/);
  assert.match(sql, /r\.present_count > 0 and r\.present_count < r\.target_count/);
  assert.match(sql, /foreign key \\\(conversation_id, organization_id\\\)/);
  assert.match(sql, /status\.\*\(active\|fulfilled\|cancelled\|expired\)/);
  assert.match(sql, /= any\.\*array/);
  assert.match(sql, /regexp_replace\(pg_get_constraintdef/);
  assert.match(sql, /conversation_human_response_commitments_one_active_uidx/);
  assert.match(sql, /service_role SELECT only; authenticated denied/);
});

function classifyFixture({ baseOk, presentCount, targetCount, installedOk }) {
  if (presentCount === 0 && baseOk) return "PENDING_10_7_A0_COMPATIBLE_BASELINE";
  if (presentCount === targetCount && baseOk && installedOk) return "INSTALLED_10_7_A0";
  return "BLOQUEADO";
}

test("fixture RED: ausencia completa produz baseline pendente", () => {
  assert.equal(classifyFixture({ baseOk: true, presentCount: 0, targetCount: 4, installedOk: false }), "PENDING_10_7_A0_COMPATIBLE_BASELINE");
});

test("fixture GREEN: instalação completa produz instalado", () => {
  assert.equal(classifyFixture({ baseOk: true, presentCount: 4, targetCount: 4, installedOk: true }), "INSTALLED_10_7_A0");
});

test("fixture RED: instalação parcial permanece bloqueada", () => {
  assert.equal(classifyFixture({ baseOk: true, presentCount: 1, targetCount: 4, installedOk: true }), "BLOQUEADO");
  assert.equal(classifyFixture({ baseOk: false, presentCount: 0, targetCount: 4, installedOk: false }), "BLOQUEADO");
});

test("auditoria local preserva a evidencia do reparo P0 sem altera-la", () => {
  assert.match(localP0, /update public\.conversation_human_takeover_leases/);
  assert.doesNotMatch(localP0, /return 0;/i);
  assert.match(sql, /P0 protection/);
});
