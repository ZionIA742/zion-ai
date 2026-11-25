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
  unified,
  browser,
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

  if (unified === undefined) delete env.ZION_ADMIN_DIAGNOSTIC_UNIFIED_READER_ENABLED;
  else env.ZION_ADMIN_DIAGNOSTIC_UNIFIED_READER_ENABLED = unified;

  if (browser === undefined) delete env.ZION_ADMIN_DIAGNOSTIC_UNIFIED_READER_V2_ENABLED;
  else env.ZION_ADMIN_DIAGNOSTIC_UNIFIED_READER_V2_ENABLED = browser;

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

const unifiedAI = { ...validV2, scope: "store", source_family: "ai_runs", source_system: "ai_runs", component: "assistant_ai", category: "ai_run_error" };
const unifiedBackend = { ...base, scope: "system", organization_id: null, store_id: null, source_family: "backend_api", source_system: "backend_api", component: "backend", category: "backend_api_failure", technical_error_code: "BACKEND_HTTP_5XX", backend_route: "/api/crm/leads/manual", backend_method: "POST", backend_kind: "http_response", backend_http_status: 503, backend_error_name: "TypeError", backend_reported_error_code: "ETIMEDOUT", backend_source_file: "src/app/api/crm/leads/manual/route-handler.ts", backend_source_line: 12, backend_source_column: 3, raw_error: "PRIVATE_RAW", sanitized_evidence: { private: "PRIVATE_JSON" } };
const unifiedOperational = { ...base, scope: "store", source_family: "operational", source_system: "channel_whatsapp_inbox", component: "whatsapp_inbox", category: "operational_queue_failure", technical_error_code: "WHATSAPP_STATUS_FAILED_FINAL", operational_attempt_count: 3 };
test("unified flag strict and legacy filter denied", async () => {
  const legacy = await request({ unified: "TRUE" }); assert.equal(legacy.calls[0].name, v1Name);
  const denied = await request({ query: "?source=backend_api" }); assert.equal(denied.status, 400); assert.equal(denied.calls.length, 0);
});
test("unified AI preserves provenance and sends exact filters", async () => {
  const r = await request({ unified: "true", data: [unifiedAI], query: "?source=ai_runs&limit=5&offset=0&store_id=" + base.store_id });
  assert.equal(r.status, 200); assert.equal(r.body.source, "unified"); assert.equal(r.calls[0].name, "list_zion_admin_diagnostics_unified_by_system"); assert.equal(r.calls[0].args.p_source, "ai_runs"); assert.equal(r.calls[0].args.p_store_id, base.store_id); assert.equal(r.body.items[0].evidence_origin, "assistant_ai");
});
test("unified system and organization accept nullable scopes", async () => {
  const r = await request({ unified: "true", data: [unifiedBackend, { ...unifiedBackend, incident_id: base.source_record_id, scope: "organization", organization_id: base.organization_id }] });
  assert.equal(r.status, 200); assert.equal(r.body.items[0].store_id, null); assert.equal(r.body.items[0].backend_source_line, 12); assert.equal(r.body.items[0].backend_http_status, 503); assert.equal(r.body.items[1].organization_id, base.organization_id); assert.equal(JSON.stringify(r.body).includes("PRIVATE_"), false);
});
test("unified operational codes and attempts", async () => {
  for (const [origin, component, code] of [["channel_whatsapp_inbox", "whatsapp_inbox", "WHATSAPP_STATUS_FAILED_FINAL"], ["ai_run_queue", "sales_ai_queue", "AI_RUN_QUEUE_FAILED_FINAL"], ["ai_sales_action_queue", "sales_action_queue", "SALES_ACTION_PROCESSING_FAILED"]]) {
    const r = await request({ unified: "true", data: [{ ...unifiedOperational, source_system: origin, component, technical_error_code: code, backend_route: "/api/private" }] }); assert.equal(r.status, 200); assert.equal(r.body.items[0].operational_attempt_count, 3); assert.equal(r.body.items[0].backend_route, null); assert.equal("evidence_model" in r.body.items[0], false);
  }
});
test("unified rejects invalid scope, duplicate incident, source and store mismatch", async () => {
  for (const [data, query] of [[[ { ...unifiedBackend, store_id: base.store_id }], ""], [[unifiedBackend, unifiedBackend], ""], [[unifiedAI], "?source=operational"], [[unifiedBackend], "?store_id=" + base.store_id], [[{ ...unifiedOperational, technical_error_code: "FAKE" }], ""]]) {
    const r = await request({ unified: "true", data, query }); assert.equal(r.status, 503);
  }
});
test("unified sanitizes malformed backend fields and denies invalid filters", async () => {
  const r = await request({ unified: "true", data: [{ ...unifiedBackend, backend_route: "/api/x?token=PRIVATE", backend_source_file: "../PRIVATE", backend_error_name: "PRIVATE", backend_reported_error_code: "PRIVATE", backend_http_status: 200 }] });
  assert.equal(r.status, 200); assert.equal(r.body.items[0].backend_route, null); assert.equal(r.body.items[0].backend_source_line, null); assert.equal(JSON.stringify(r.body).includes("PRIVATE"), false);
  for (const query of ["?source=bad", "?source=ai_runs&source=backend_api"]) { const x = await request({ unified: "true", query }); assert.equal(x.status, 400); assert.equal(x.calls.length, 0); }
});
test("unified failure and denial do not fall back or leak", async () => {
  const r = await request({ unified: "true", error: { message: "PRIVATE_DB" } }); assert.equal(r.status, 503); assert.equal(r.calls.length, 1); assert.equal(JSON.stringify(r.body).includes("PRIVATE_DB"), false);
  const denied = await request({ unified: "true", allowed: false }); assert.equal(denied.status, 403); assert.equal(denied.calls.length, 0);
});
const browserRow = { ...base, scope: "store", source_family: "client_browser", source_system: "client_browser", component: "browser", category: "client_browser_failure", technical_error_code: "BROWSER_UNCAUGHT_ERROR", browser_page: "/crm/lead/[id]", browser_kind: "uncaught_error", browser_error_name: "TypeError", browser_asset: "/_next/static/chunks/abcdef123456.js", browser_line: 20, browser_column: 3 };
test("browser gate requires both exact true flags", async () => {
  for (const flags of [{browser:"true"}, {unified:"true",browser:"TRUE"}, {unified:"true"}]) { const r=await request({...flags,query:"?source=client_browser"}); assert.equal(r.status,400); assert.equal(r.calls.length,0); }
  const r=await request({unified:"true",data:[browserRow]}); assert.equal(r.status,503);
});
test("V2 selects exact RPC and returns browser projection", async () => {
  const r=await request({unified:"true",browser:"true",data:[browserRow],query:"?source=client_browser"}); assert.equal(r.status,200); assert.equal(r.body.source,"unified_v2"); assert.equal(r.calls[0].name,"list_zion_admin_diagnostics_unified_v2_by_system"); assert.equal(r.calls[0].args.p_source,"client_browser"); assert.equal(r.body.items[0].browser_page,"/crm/lead/[id]"); assert.equal(r.body.items[0].browser_line,20);
});
test("V2 system scope and malformed browser identity", async () => {
  const system={...browserRow,scope:"system",organization_id:null,store_id:null,browser_page:"/zion-admin"}; const r=await request({unified:"true",browser:"true",data:[system]}); assert.equal(r.status,200); assert.equal(r.body.items[0].browser_page,"/zion-admin");
  for(const bad of [{...system,scope:"organization",organization_id:base.organization_id},{...browserRow,component:"backend"},{...browserRow,technical_error_code:"PRIVATE"}]) {const x=await request({unified:"true",browser:"true",data:[bad]}); assert.equal(x.status,503);}
});
test("V2 suppresses private and malformed fields", async () => {
  const r=await request({unified:"true",browser:"true",data:[{...browserRow,browser_page:"/crm/lead/PRIVATE",browser_asset:"/_next/static/chunks/abcdef123456.js?PRIVATE",browser_kind:"unhandled_rejection",browser_error_name:"PRIVATE",raw_error:"PRIVATE"}]}); assert.equal(r.status,200); for(const k of ["browser_page","browser_asset","browser_line","browser_column","browser_kind","browser_error_name"]) assert.equal(r.body.items[0][k],null); assert.equal(JSON.stringify(r.body).includes("PRIVATE"),false);
});
test("V2 legacy evidence unaffected and RPC failure has no fallback", async () => {
  const old=await request({unified:"true",data:[unifiedAI]}); const next=await request({unified:"true",browser:"true",data:[{...unifiedAI,browser_asset:browserRow.browser_asset}]}); assert.deepEqual(next.body.items,old.body.items); const bad=await request({unified:"true",browser:"true",error:{message:"PRIVATE"}}); assert.equal(bad.status,503); assert.equal(bad.calls.length,1); assert.equal(JSON.stringify(bad.body).includes("PRIVATE"),false);
});
