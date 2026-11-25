import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sql = await readFile(
  new URL("../../../supabase/diagnostics/20261123100000_p10_7_a1_1_alert_infrastructure_preflight.sql", import.meta.url),
  "utf8",
);

test("preflight permanece somente leitura e nao aplica a extensao A1", () => {
  assert.match(sql, /P10_7_A1_1_ALERT_INFRASTRUCTURE_PREFLIGHT/);
  assert.match(sql, /identidade individual de destinatarios foi cancelada/);
  assert.doesNotMatch(sql, /^\s*(insert|update|delete|alter|create|drop|truncate|grant|revoke)\b/im);
});

test("preflight verifica dependencias por catalogo sem referencias diretas inseguras", () => {
  const outsideDynamicSql = sql.replace(/\$sql\$[\s\S]*?\$sql\$/gi, "");
  assert.match(sql, /to_regclass\('cron\.job'\)/);
  assert.match(sql, /to_regclass\('cron\.job_run_details'\)/);
  assert.match(sql, /execute \$sql\$/i);
  assert.match(sql, /pg_catalog\.pg_attribute/);
  assert.match(sql, /pg_catalog\.pg_constraint/);
  assert.match(sql, /pg_get_constraintdef/);
  assert.match(sql, /pg_catalog\.pg_class/);
  assert.doesNotMatch(outsideDynamicSql, /from\s+cron\.job\b/i);
  assert.doesNotMatch(outsideDynamicSql, /from\s+cron\.job_run_details\b/i);
});

test("preflight nao presume identidade individual de message_echo nem cron Vercel", () => {
  assert.match(sql, /cron catalog available; job rows emitted as NOTICE/);
  assert.doesNotMatch(sql, /message_echo.*responsible/i);
  assert.doesNotMatch(sql, /vercel/i);
});

test("veredito depende das bases e do scheduler, sem extensao de destinatario individual", () => {
  assert.match(sql, /s\.blocking_count = 0 and s\.scheduler_ok/);
  assert.match(sql, /bool_and\(ok\) as base_ok/);
  assert.doesNotMatch(sql, /PENDING_A1_EXTENSION|future A1 extension/);
});
