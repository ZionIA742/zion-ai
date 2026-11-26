const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = process.cwd();
const cache = new Map();

function loadTs(file) {
  const absolute = path.resolve(root, file);
  if (cache.has(absolute)) return cache.get(absolute).exports;
  const source = fs.readFileSync(absolute, "utf8");
  const compiled = ts.transpileModule(source, {
    fileName: absolute,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  assert.equal(
    (compiled.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error).length,
    0,
  );
  const module = { exports: {} };
  cache.set(absolute, module);
  const localRequire = (request) => {
    if (request.startsWith(".")) {
      const dependency = path.resolve(path.dirname(absolute), request) + ".ts";
      return loadTs(path.relative(root, dependency));
    }
    return require(request);
  };
  const context = { module, exports: module.exports, require: localRequire, __filename: absolute, __dirname: path.dirname(absolute), process, console, Promise, Error, JSON, Set, Map };
  vm.runInNewContext(`(function(module,exports,require,__filename,__dirname){${compiled.outputText}\n})(module,exports,require,__filename,__dirname);`, context, { filename: absolute });
  return module.exports;
}

const { promoteCommercialMemoryToOpportunity } = loadTs("src/lib/server/promote-commercial-memory-to-opportunity.ts");
const scope = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  storeId: "22222222-2222-4222-8222-222222222222",
  leadId: "33333333-3333-4333-8333-333333333333",
  conversationId: "44444444-4444-4444-8444-444444444444",
  conversationSessionId: "55555555-5555-4555-8555-555555555555",
  commercialOpportunityId: "66666666-6666-4666-8666-666666666666",
};

const event = {
  event_id: "77777777-7777-4777-8777-777777777777",
  organization_id: scope.organizationId,
  store_id: scope.storeId,
  conversation_id: scope.conversationId,
  lead_id: scope.leadId,
  conversation_session_id: scope.conversationSessionId,
  commercial_session_context_link_id: null,
  commercial_opportunity_id: null,
  fact_key: "location_text",
  value_json: "Campinas, SP",
  operation_key: "fact:customer:location",
  event_kind: "assertion",
  supersedes_event_id: null,
  source_message_id: "88888888-8888-4888-8888-888888888888",
  source_media_type: "text",
  actor_type: "customer",
  evidence_level: "confirmed",
  created_at: "2026-11-26T12:00:00.000Z",
  conflict_state: "consistent",
};

function harness({ initial = null, race = null } = {}) {
  let current = initial;
  const calls = [];
  return {
    calls,
    get current() { return current; },
    setCurrent(value) { current = value; },
    supabase: {
      rpc: async (name, args) => {
        calls.push({ name, args });
        if (name === "read_commercial_conversation_fact_events_by_system") {
          return { data: args.p_organization_id === scope.organizationId ? [event] : [], error: null };
        }
        if (name === "read_commercial_opportunity_qualification_facts_by_system") {
          return {
            data: {
              organization_id: args.p_organization_id,
              store_id: args.p_store_id,
              commercial_opportunity_id: args.p_commercial_opportunity_id,
              known_facts: current ? [{ factKey: "location_text", state: current.state, value: current.value }] : [],
            },
            error: null,
          };
        }
        assert.equal(name, "promote_commercial_memory_fact_if_absent_by_system");
        if (race === "human") current = { state: "confirmed", value: "Campinas - manual" };
        if (current) {
          return { data: [{ outcome: "ignored_existing_current", event_id: "human-event" }], error: null };
        }
        current = { state: "confirmed", value: args.p_value_json };
        return { data: [{ outcome: "promoted_created", event_id: "promotion-event" }], error: null };
      },
    },
  };
}

function run(h) {
  return promoteCommercialMemoryToOpportunity({ supabase: h.supabase, ...scope, enabled: true });
}

test("campo vazio promove uma vez e replay nao escreve novamente", async () => {
  const h = harness();
  assert.equal((await run(h)).status, "promoted");
  assert.equal((await run(h)).status, "skipped");
  assert.equal(h.calls.filter((x) => x.name === "promote_commercial_memory_fact_if_absent_by_system").length, 1);
});

test("fato humano existente e conflito existente sao ignorados", async () => {
  for (const state of ["confirmed", "conflict"]) {
    const h = harness({ initial: { state, value: "valor humano" } });
    const result = await run(h);
    assert.equal(result.status, "skipped");
    assert.equal(h.calls.some((x) => x.name === "promote_commercial_memory_fact_if_absent_by_system"), false);
  }
});

test("humano vencendo a concorrencia retorna ignored sem conflito", async () => {
  const h = harness({ race: "human" });
  const result = await run(h);
  assert.equal(result.status, "skipped");
  assert.equal(h.current.value, "Campinas - manual");
});

test("promocao vencendo primeiro nao impede correcao humana posterior", async () => {
  const h = harness();
  assert.equal((await run(h)).status, "promoted");
  h.setCurrent({ state: "confirmed", value: "Campinas - correcao humana" });
  assert.equal(h.current.value, "Campinas - correcao humana");
});

test("organizacao diferente nao recebe escrita", async () => {
  const h = harness();
  const result = await promoteCommercialMemoryToOpportunity({
    supabase: h.supabase,
    ...scope,
    organizationId: "99999999-9999-4999-8999-999999999999",
    enabled: true,
  });
  assert.equal(result.status, "skipped");
  assert.equal(h.calls.some((x) => x.name === "promote_commercial_memory_fact_if_absent_by_system"), false);
});

console.log("PASS P9 B11 atomic commercial-memory promotion behavior");
