const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(
  path.join(__dirname, "zion-admin-ptax-evidence-persist.ts"), "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const id = "123e4567-e89b-42d3-a456-426614174000";
const evidence = {
  source: "bcb_ptax_venda",
  requestedFrom: "2026-10-27",
  requestedTo: "2026-10-27",
  requestStartedAt: "2026-11-06T15:00:00.000Z",
  requestFinishedAt: "2026-11-06T15:00:01.000Z",
  endpointUrl: "https://olinda.bcb.gov.br/test",
  responsePayload: { value: [{ cotacaoVenda: 5.25, dataHoraCotacao: "2026-10-27 13:10:00" }] },
  resultCount: 1,
};
const capture = { report: { source: "bcb_ptax_venda", daily: [] }, evidence };

function load(mock = {}) {
  const exports = {};
  const module = { exports };
  const calls = [];
  const requireMock = (spec) => {
    if (spec === "node:crypto") return require(spec);
    if (spec === "./zion-account-provisioning") {
      return { createServiceSupabaseClient: () => ({
        rpc: async (name, args) => {
          calls.push({ name, args });
          return {
            data: {
              outcome: "inserted", collection_id: id,
              collection_key: args.p_evidence.collectionKey,
              result_count: args.p_evidence.resultCount,
            }, error: null,
          };
        },
      }) };
    }
    if (spec === "./zion-admin-ptax-evidence-capture") {
      return { captureValidatedPtaxCollection: async (...args) => {
        calls.push({ captureArgs: args });
        return mock.capture ?? capture;
      } };
    }
    throw new Error(`Unexpected runtime import: ${spec}`);
  };
  vm.runInNewContext(compiled, { require: requireMock, exports, module }, {
    filename: "zion-admin-ptax-evidence-persist.js",
  });
  return { api: module.exports, calls };
}

function response(envelope, outcome = "inserted") {
  return { data: {
    outcome, collection_id: id,
    collection_key: envelope.collectionKey,
    result_count: envelope.resultCount,
  }, error: null };
}

test("9 campos exatos e chave SHA-256 dentro do contrato RPC", () => {
  const { api } = load();
  const envelope = api.buildPtaxEvidenceEnvelope(evidence);
  assert.match(envelope.collectionKey, /^bcb_ptax_venda:v1:[a-f0-9]{64}$/);
  assert.equal(Object.keys(envelope).length, 9);
});

test("replay de mesma evidencia tem chave estavel, independente da ordem JSON", () => {
  const { api } = load();
  const reordered = {
    ...evidence,
    responsePayload: { value: [{ dataHoraCotacao: "2026-10-27 13:10:00", cotacaoVenda: 5.25 }] },
  };
  assert.equal(
    api.buildPtaxEvidenceEnvelope(evidence).collectionKey,
    api.buildPtaxEvidenceEnvelope(reordered).collectionKey,
  );
});

test("nova coleta com outro horario recebe identidade distinta", () => {
  const { api } = load();
  assert.notEqual(
    api.buildPtaxEvidenceEnvelope(evidence).collectionKey,
    api.buildPtaxEvidenceEnvelope({ ...evidence, requestFinishedAt: "2026-11-06T15:00:02.000Z" }).collectionKey,
  );
});

test("persistencia aceita inserted e replayed sem inserir duas vezes no cliente", async () => {
  const { api } = load();
  const writer = async (envelope) => response(envelope);
  const persisted = await api.persistValidatedPtaxCapture(capture, writer);
  assert.equal(persisted.outcome, "inserted");
  assert.equal(persisted.collectionId, id);
  const replay = await api.persistValidatedPtaxCapture(capture, async (envelope) => response(envelope, "replayed"));
  assert.equal(replay.collectionKey, persisted.collectionKey);
});

test("RPC falha ou retorna identidade divergente: fail closed", async () => {
  const { api } = load();
  await assert.rejects(api.persistValidatedPtaxCapture(capture, async () => ({data:null,error:{message:"fail"}})), /PTAX_EVIDENCE_RPC_FAILED/);
  await assert.rejects(api.persistValidatedPtaxCapture(capture, async (envelope) => ({
    data: { ...response(envelope).data, collection_key: "forge" }, error:null,
  })), /PTAX_EVIDENCE_INVALID_RPC_RESULT/);
});

test("adaptador real usa somente RPC service_role, sem fetch automatico", async () => {
  const { api, calls } = load();
  const result = await api.persistValidatedPtaxCapture(capture);
  assert.equal(result.outcome, "inserted");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "zion_admin_register_ptax_collection_evidence_by_system");
  assert.equal(Object.keys(calls[0].args).join(), "p_evidence");
});

test("coleta explicita chama capturador uma vez e injeta writer", async () => {
  const { api, calls } = load();
  const received = await api.collectAndPersistValidatedPtax("2026-10-27", "2026-10-27", {
    writer: async (envelope) => response(envelope),
  });
  assert.equal(calls.length, 1);
  assert.equal(received.collectionId, id);
});
