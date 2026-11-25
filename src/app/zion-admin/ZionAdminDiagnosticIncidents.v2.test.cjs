const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const file = "src/app/zion-admin/ZionAdminDiagnosticIncidents.tsx";
const source = fs.readFileSync(file, "utf8");

assert(source.includes("function parseEvidenceV2("));
assert(source.includes("function buildTechnicalText("));

const compiled = ts.transpileModule(
  source + "\nexport { parseDiagnostic, buildTechnicalText };\n",
  {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }
);

assert.equal(
  (compiled.diagnostics || []).filter(
    d => d.category === ts.DiagnosticCategory.Error
  ).length,
  0
);

const mod = { exports: {} };

vm.runInNewContext(compiled.outputText, {
  module: mod,
  exports: mod.exports,
  require(name) {
    if (name === "react") {
      return {
        useEffect() {},
        useMemo() {},
        useState() {},
      };
    }

    if (name === "react/jsx-runtime") {
      return {
        jsx() {},
        jsxs() {},
        Fragment: Symbol("Fragment"),
      };
    }

    throw new Error("UNEXPECTED_MODULE");
  },
  console,
  Date,
  Intl,
  Map,
  Set,
  URLSearchParams,
  AbortController,
}, { filename: file, timeout: 10000 });

const { parseDiagnostic, buildTechnicalText } = mod.exports;

assert.equal(typeof parseDiagnostic, "function");
assert.equal(typeof buildTechnicalText, "function");

const base = {
  incident_id: "44444444-4444-4444-8444-444444444444",
  occurrence_id: "55555555-5555-4555-8555-555555555555",
  organization_id: "11111111-1111-4111-8111-111111111111",
  store_id: "22222222-2222-4222-8222-222222222222",
  incident_status: "open",
  severity: "error",
  cause_confidence: "unknown",
  title_simple: "Falha registrada",
  explanation_simple: "Causa ainda desconhecida.",
  impact_simple: "Impacto nao comprovado.",
  next_action_simple: "Investigar a execucao.",
  first_seen_at: "2026-03-10T15:00:00Z",
  last_seen_at: "2026-03-10T15:00:00Z",
  occurred_at: "2026-03-10T15:00:00Z",
  captured_at: "2026-11-14T15:00:00Z",
  technical_error_code: "AI_RUN_ERROR_RECORDED",
  source_record_id: "33333333-3333-4333-8333-333333333333",
  occurrence_count: 1,
  last_failure_older_than_30_days: true,
};

const assistant = {
  ...base,
  registered_component: "assistant_ai",
  evidence_origin: "assistant_ai",
  evidence_execution_type: "assistant_chat",
  evidence_provider: "openai",
  evidence_model: "gpt-4o-mini",
  evidence_run_status: "failed",
  evidence_latency_ms: 1234,
};

function parse(value) {
  const result = parseDiagnostic(value);
  assert(result, "DIAGNOSTICO_REJEITADO");
  return result;
}

function report(value) {
  return buildTechnicalText(parse(value), "Loja ficticia");
}

test("V1 permanece compativel sem evidencias V2", () => {
  const item = parse(base);
  assert.equal(item.v2Evidence, null);
  assert.equal(item.historical, true);
});

test("V1 informa indisponibilidade e nao inventa origem", () => {
  const text = report(base);
  assert.match(text, /V2: indispon\u00edveis nesta consulta/);
  assert.match(text, /n\u00e3o verificada por este diagn\u00f3stico/);
  assert.doesNotMatch(text, /Modelo registrado:/);
});

test("Assistente comprovada apresenta os metadados", () => {
  const item = parse(assistant);
  assert.equal(item.v2Evidence.provenOrigin, "assistant_ai");
  assert.equal(item.v2Evidence.executionType, "assistant_chat");

  const text = report(assistant);
  assert.match(text, /Origem comprovada: IA Assistente/);
  assert.match(text, /Modelo registrado: gpt-4o-mini/);
  assert.match(text, /Provedor registrado: openai/);
  assert.match(text, /Estado registrado da execu\u00e7\u00e3o: failed/);
  assert.match(text, /Lat\u00eancia registrada: 1234 ms/);
});

test("Sales historico nao vira prova de IA Vendedora", () => {
  const value = {
    ...base,
    registered_component: "sales_ai",
    evidence_origin: "unknown",
  };

  assert.equal(parse(value).v2Evidence.provenOrigin, "unknown");
  const text = report(value);

  assert.match(text, /sales_ai \(classifica\u00e7\u00e3o hist\u00f3rica/);
  assert.match(text, /n\u00e3o comprova IA Vendedora/);
  assert.match(text, /Origem comprovada: N\u00e3o identificada/);
});

test("Origem desconhecida permanece desconhecida", () => {
  const value = {
    ...base,
    registered_component: "ai_origin_unknown",
    evidence_origin: "unknown",
  };

  assert.equal(parse(value).v2Evidence.provenOrigin, "unknown");
  assert.match(report(value), /Origem n\u00e3o identificada/);
});

test("Origem forjada sem tipo correto e rejeitada", () => {
  const value = {
    ...assistant,
    evidence_execution_type: "assistant_chat_FAKE",
  };

  const item = parse(value);
  assert.equal(item.v2Evidence.provenOrigin, "unknown");
  assert.equal(item.v2Evidence.executionType, null);
  assert.doesNotMatch(report(value), /Origem comprovada: IA Assistente/);
});

test("Provedor modelo e status invalidos sao descartados", () => {
  const value = {
    ...assistant,
    evidence_provider: "PRIVATE_PROVIDER",
    evidence_model: "PRIVATE_MODEL",
    evidence_run_status: "PRIVATE_STATUS",
  };

  const evidence = parse(value).v2Evidence;
  assert.equal(evidence.provider, null);
  assert.equal(evidence.model, null);
  assert.equal(evidence.runStatus, null);

  const wrongModel = parse({
    ...assistant,
    evidence_model: "gpt-private-model",
  });

  assert.equal(wrongModel.v2Evidence.model, null);
});

test("Dados privados e campos extras nao entram na copia", () => {
  const value = {
    ...assistant,
    customer_message: "PRIVATE_CUSTOMER_MESSAGE",
    raw_error: "PRIVATE_ERROR",
    token: "PRIVATE_TOKEN",
    sanitized_evidence: {
      input: "PRIVATE_INPUT",
      output: "PRIVATE_OUTPUT",
    },
  };

  const output = JSON.stringify(parse(value)) + report(value);
  assert.equal(output.includes("PRIVATE_"), false);
  assert.equal(
    "sanitized_evidence" in parse(value),
    false
  );
});

test("Latencia respeita limites e tipo numerico", () => {
  for (const valid of [0, 86400000]) {
    assert.equal(
      parse({
        ...assistant,
        evidence_latency_ms: valid,
      }).v2Evidence.latencyMs,
      valid
    );
  }

  for (const invalid of [-1, 1.5, 86400001, "123"]) {
    assert.equal(
      parse({
        ...assistant,
        evidence_latency_ms: invalid,
      }).v2Evidence.latencyMs,
      null
    );
  }
});

test("Diagnosticos base invalidos sao recusados", () => {
  assert.equal(parseDiagnostic(null), null);
  assert.equal(parseDiagnostic([]), null);
  assert.equal(
    parseDiagnostic({ ...base, store_id: "INVALID" }),
    null
  );
  assert.equal(
    parseDiagnostic({
      ...base,
      last_failure_older_than_30_days: "true",
    }),
    null
  );
});

test("Registro recente nao comprova falha ativa", () => {
  const text = report({
    ...assistant,
    last_failure_older_than_30_days: false,
  });

  assert.match(text, /n\u00e3o verificada por este diagn\u00f3stico/);
  assert.match(text, /estado aberto n\u00e3o comprova falha ativa/);
});

test("Botao continua ligado ao montador tecnico", () => {
  assert(source.includes("Copiar detalhes"));
  assert(source.includes("navigator.clipboard.writeText"));
  assert(source.includes("buildTechnicalText(item,"));
  assert(source.includes("...buildEvidenceV2Lines(item.v2Evidence)"));
});

const backend = { ...base, scope: "system", organization_id: null, store_id: null, source_family: "backend_api", source_system: "backend_api", component: "backend", backend_route: "/api/crm/leads/manual", backend_method: "POST", backend_http_status: 503, backend_source_file: "src/app/api/crm/leads/manual/route-handler.ts", backend_source_line: 12 };
test("unified system incident shows technical location without fabricated recovery", () => {
  const item = parse(backend); assert.equal(item.storeId, null); assert.equal(item.scope, "system"); const text = report(backend); assert.match(text, /Sistema de origem: backend_api/); assert.match(text, /Rota: \/api\/crm\/leads\/manual/); assert.match(text, /Linha: 12/); assert.match(text, /Status HTTP: 503/); assert.doesNotMatch(text, /Origem comprovada: IA/); assert.match(text, /Recupera.*o operacional: n.*o comprovada/);
});
test("unified organization scope and malformed scopes", () => {
  assert.equal(parse({ ...backend, scope: "organization", organization_id: base.organization_id }).scope, "organization"); assert.equal(parseDiagnostic({ ...backend, store_id: base.store_id }), null); assert.equal(parseDiagnostic({ ...backend, source_family: "operational" }), null);
});
test("operational report uses real origin and attempt count", () => {
  const r = report({ ...base, scope: "store", source_family: "operational", source_system: "ai_run_queue", operational_attempt_count: 4 }); assert.match(r, /Sistema de origem: ai_run_queue/); assert.match(r, /Tentativas registradas: 4/); assert.doesNotMatch(r, /Modelo registrado:/);
});
test("invalid path not copied", () => {
  const text = report({ ...backend, backend_route: "/api/x?token=PRIVATE", backend_source_file: "../PRIVATE" }); assert.doesNotMatch(text, /PRIVATE/); assert.match(text, /Linha: Indispon/);
});
const browserRow = { ...base, scope: "store", source_family: "client_browser", source_system: "client_browser", component: "browser", category: "client_browser_failure", technical_error_code: "BROWSER_UNCAUGHT_ERROR", browser_page: "/crm/lead/[id]", browser_kind: "uncaught_error", browser_error_name: "TypeError", browser_asset: "/_next/static/chunks/abcdef123456.js", browser_line: 20, browser_column: 3 };
test("browser report describes compiled position without invented cause",()=>{const text=report(browserRow);assert.match(text,/relato do navegador, causa não comprovada/);assert.match(text,/Página: \/crm\/lead\/\[id\]/);assert.match(text,/Linha compilada: 20/);assert.match(text,/Arquivo compilado: \/_next\/static\/chunks\/abcdef123456.js/);assert.match(text,/Recuperação operacional: não comprovada/);});
test("browser scope and invalid evidence fail closed",()=>{assert.equal(parseDiagnostic({...browserRow,scope:"organization",store_id:null}),null);assert.equal(parseDiagnostic({...browserRow,technical_error_code:"PRIVATE"}),null);const text=report({...browserRow,browser_page:"/crm/lead/PRIVATE",browser_asset:"/_next/static/chunks/abcdef123456.js?PRIVATE",browser_error_name:"PRIVATE",browser_kind:"unhandled_rejection"});assert.doesNotMatch(text,/PRIVATE/);assert.match(text,/Linha compilada: Indisponível/);});
test("browser filter only advertised by V2 response",()=>{assert(source.includes('result?.source === "unified_v2" || sourceFilter === "client_browser"'));assert(source.includes('payload.source !== "unified_v2" && parsed.sourceFamily === "client_browser"'));});
