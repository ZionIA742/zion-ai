const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const paths = {
  api: "src/app/api/zion-admin/diagnostics/route.ts",
  projector:
    "src/lib/server/zion-admin-diagnostic-reader-v2-projection.ts",
  contract: "src/lib/server/zion-admin-ai-run-evidence.ts",
};

function load(file, dependencies, extra = {}) {
  const source = fs.readFileSync(file, "utf8");

  const compiled = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  });

  assert.equal(
    (compiled.diagnostics || []).filter(
      item => item.category === ts.DiagnosticCategory.Error
    ).length,
    0
  );

  const module = { exports: {} };

  vm.runInNewContext(compiled.outputText, {
    module,
    exports: module.exports,
    require(name) {
      if (Object.prototype.hasOwnProperty.call(dependencies, name)) {
        return dependencies[name];
      }
      throw new Error("UNEXPECTED_IMPORT");
    },
    console,
    Request,
    Response,
    URL,
    process: extra.process,
  }, { filename: file, timeout: 10000 });

  return module.exports;
}

const contract = load(paths.contract, {});

const projector = load(paths.projector, {
  "./zion-admin-ai-run-evidence": contract,
});

const env = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid",
  SUPABASE_URL: "https://example.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "FAKE_TEST_KEY",
};

const authorized = {
  ok: true,
  allowed: true,
  authorized: true,
  isAuthorized: true,
  success: true,
  kind: "authorized",
  status: "authorized",
  state: "authorized",
  outcome: "authorized",
  type: "authorized",
};

let accessState = authorized;
let rpcResult = null;
let calls = [];

const api = load(paths.api, {
  "@supabase/supabase-js": {
    createClient() {
      return {
        async rpc(name, args) {
          calls.push({ name, args });
          return rpcResult;
        },
      };
    },
  },
  "@/lib/server/zion-admin-api-access": {
    async resolveZionAdminApiAccess() {
      return accessState;
    },
  },
  "@/lib/server/zion-admin-api-response": {
    createZionAdminApiDeniedResponse() {
      return new Response(
        JSON.stringify({ ok: false, message: "Acesso negado." }),
        { status: 403 }
      );
    },
    createZionAdminApiJsonResponse(body, status) {
      return new Response(JSON.stringify(body), {
        status,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      });
    },
  },
  "@/lib/server/zion-admin-diagnostic-reader-v2-projection":
    projector,
}, { process: { env } });

assert.equal(typeof api.GET, "function");

const base = {
  incident_id: "44444444-4444-4444-8444-444444444444",
  occurrence_id: "55555555-5555-4555-8555-555555555555",
  organization_id: "11111111-1111-4111-8111-111111111111",
  store_id: "22222222-2222-4222-8222-222222222222",
  incident_status: "open",
  severity: "error",
  cause_confidence: "unknown",
  title_simple: "Erro de IA",
  explanation_simple: "Falha registrada.",
  impact_simple: "Impacto ainda nao verificado.",
  next_action_simple: "Verificar execucao.",
  first_seen_at: "2026-03-10T17:12:59Z",
  last_seen_at: "2026-03-10T17:12:59Z",
  occurred_at: "2026-03-10T17:12:59Z",
  captured_at: "2026-11-13T13:53:00Z",
  technical_error_code: "AI_RUN_ERROR_RECORDED",
  source_record_id: "33333333-3333-4333-8333-333333333333",
  occurrence_count: 1,
  last_failure_older_than_30_days: true,
};

const validV2 = {
  ...base,
  registered_component: "assistant_ai",
  evidence_origin: "assistant_ai",
  evidence_execution_type: "assistant_chat",
  evidence_provider: "openai",
  evidence_model: "gpt-4o-mini",
  evidence_run_status: "failed",
  evidence_latency_ms: 1234,
  extra_private_field: "PRIVATE_TEST_DATA",
};

async function request({
  flag,
  data = [base],
  error = null,
  query = "",
  allowed = true,
} = {}) {
  calls = [];
  rpcResult = { data, error };

  if (flag === undefined) {
    delete env.ZION_ADMIN_DIAGNOSTIC_READER_V2_ENABLED;
  } else {
    env.ZION_ADMIN_DIAGNOSTIC_READER_V2_ENABLED = flag;
  }

  accessState = allowed ? authorized : {
    ...authorized,
    ok: false,
    allowed: false,
    authorized: false,
    isAuthorized: false,
    success: false,
    kind: "denied",
    status: "denied",
    state: "denied",
    outcome: "denied",
    type: "denied",
  };

  const response = await api.GET(
    new Request("http://localhost/api/zion-admin/diagnostics" + query)
  );

  return {
    status: response.status,
    body: await response.json(),
    calls: [...calls],
  };
}

const v1Name =
  "list_zion_admin_ai_run_diagnostics_by_system";

const v2Name =
  "list_zion_admin_ai_run_diagnostics_v2_by_system";

test("V1 por padrao retorna somente 19 campos", async () => {
  const result = await request({ data: [validV2] });
  assert.equal(result.status, 200);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].name, v1Name);
  assert.equal(Object.keys(result.body.items[0]).length, 19);
  assert.equal("evidence_model" in result.body.items[0], false);
  assert.equal(JSON.stringify(result.body).includes("PRIVATE_"), false);
});

test("flag false mantem V1", async () => {
  const result = await request({ flag: "false" });
  assert.equal(result.status, 200);
  assert.equal(result.calls[0].name, v1Name);
});

test("flag TRUE maiusculo nao habilita V2", async () => {
  const result = await request({ flag: "TRUE" });
  assert.equal(result.status, 200);
  assert.equal(result.calls[0].name, v1Name);
});

test("flag true seleciona V2 e 26 campos", async () => {
  const result = await request({
    flag: "true",
    data: [validV2],
    query: "?limit=10&offset=0",
  });

  assert.equal(result.status, 200);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].name, v2Name);
  assert.equal(result.calls[0].args.p_limit, 10);
  assert.equal(result.calls[0].args.p_offset, 0);

  const item = result.body.items[0];
  assert.equal(Object.keys(item).length, 26);
  assert.equal(item.evidence_origin, "assistant_ai");
  assert.equal(item.evidence_model, "gpt-4o-mini");
  assert.equal(item.evidence_latency_ms, 1234);
  assert.equal(JSON.stringify(result.body).includes("PRIVATE_"), false);
});

test("V2 descarta metadados maliciosos", async () => {
  const result = await request({
    flag: "true",
    data: [{
      ...validV2,
      registered_component: "PRIVATE_COMPONENT",
      evidence_origin: "PRIVATE_ORIGIN",
      evidence_execution_type: "PRIVATE_TYPE",
      evidence_provider: "PRIVATE_PROVIDER",
      evidence_model: "PRIVATE_MODEL",
      evidence_run_status: "PRIVATE_STATUS",
      evidence_latency_ms: "PRIVATE_LATENCY",
    }],
  });

  assert.equal(result.status, 200);

  const item = result.body.items[0];
  assert.equal(item.registered_component, "unknown");
  assert.equal(item.evidence_origin, "unknown");
  assert.equal(item.evidence_provider, null);
  assert.equal(item.evidence_model, null);
  assert.equal(item.evidence_run_status, null);
  assert.equal(item.evidence_latency_ms, null);
  assert.equal(JSON.stringify(result.body).includes("PRIVATE_"), false);
});

test("historico sales_ai nao prova origem comercial", async () => {
  const result = await request({
    flag: "true",
    data: [{
      ...base,
      registered_component: "sales_ai",
      evidence_origin: "unknown",
      evidence_execution_type: null,
    }],
  });

  assert.equal(result.status, 200);
  assert.equal(
    result.body.items[0].registered_component,
    "sales_ai"
  );
  assert.equal(
    result.body.items[0].evidence_origin,
    "unknown"
  );
});

test("falha RPC V2 retorna 503 sem fallback", async () => {
  const result = await request({
    flag: "true",
    data: null,
    error: { message: "PRIVATE_DATABASE_ERROR" },
  });

  assert.equal(result.status, 503);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].name, v2Name);
  assert.equal(JSON.stringify(result.body).includes("PRIVATE_"), false);
});

test("falha RPC V1 retorna 503", async () => {
  const result = await request({
    data: null,
    error: { message: "PRIVATE_DATABASE_ERROR" },
  });

  assert.equal(result.status, 503);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].name, v1Name);
});

test("registro base invalido retorna 503", async () => {
  const result = await request({
    flag: "true",
    data: [{ ...validV2, incident_id: "INVALID_ID" }],
  });

  assert.equal(result.status, 503);
  assert.equal(result.body.ok, false);
  assert.equal(result.calls.length, 1);
});

test("filtro invalido nao chama RPC", async () => {
  const result = await request({
    query: "?limit=99999",
  });

  assert.equal(result.status, 400);
  assert.equal(result.calls.length, 0);
});

test("acesso negado nao chama RPC", async () => {
  const result = await request({ allowed: false });

  assert.equal(result.status, 403);
  assert.equal(result.calls.length, 0);
});