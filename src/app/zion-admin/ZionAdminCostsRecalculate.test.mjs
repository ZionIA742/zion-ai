import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const child = readFileSync(
  new URL("./ZionAdminCostsRecalculate.tsx", import.meta.url),
  "utf8",
);

const parent = readFileSync(
  new URL("./ZionAdminCostsSection.tsx", import.meta.url),
  "utf8",
);

test("recalculo consulta os quatro periodos", () => {
  for (const period of ["day", "week", "month", "year"]) {
    assert.match(child, new RegExp(`"${period}"`));
  }

  assert.match(child, /Promise\.all\(/);
  assert.match(child, /\/api\/zion-admin\/costs\?/);
  assert.match(child, /\/api\/zion-admin\/costs\/openai-official\?/);
});

test("recalculo e somente leitura", () => {
  assert.match(child, /method:\s*"GET"/);
  assert.doesNotMatch(child, /method:\s*"POST"/);
  assert.doesNotMatch(child, /\/api\/cron\//);
  assert.doesNotMatch(child, /action:\s*"close"/);
});

test("valores incompletos nao viram gastos definitivos", () => {
  assert.match(child, /officialComplete/);
  assert.match(child, /subtotalCents/);
  assert.doesNotMatch(child, /officialBrlCents\s*\?\?\s*0/);
  assert.match(child, /Meta: cobrança ainda não comprovada/);
  assert.match(child, /Não é o total efetivamente cobrado/);
});

test("botao conectado e consolidado legado identificado", () => {
  assert.match(parent, /ZionAdminCostsRecalculate/);
  assert.match(parent, /onRecalculated/);
  assert.match(parent, /Total operacional estimado/);
  assert.doesNotMatch(parent, /label="Total consolidado"/);
});
test("OpenAI considera somente dias UTC encerrados", () => {
  assert.match(child, /lastClosedUtcDay/);
  assert.match(child, /previousUtcDate\(todayUtc\)/);
  assert.match(child, /\[end, anchor, lastClosedUtcDay\]\.sort\(\)\[0\]/);
});

test("subtotal registrado permite zero sem presumir custo OpenAI", () => {
  assert.match(child, /knownBrlSources\.length > 0/);
  assert.match(child, /sumMinor\(knownBrlSources\)/);
  assert.doesNotMatch(child, /officialBrlCents\s*\?\?\s*0/);
  assert.match(child, /Subtotal registrado em BRL/);
  assert.match(child, /Não é o total efetivamente cobrado/);
});