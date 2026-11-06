const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = __dirname;
const runnerSource = fs.readFileSync(path.join(root, 'zion-admin-monthly-preclosure-execution.ts'), 'utf8');
const readerSource = fs.readFileSync(path.join(root, 'zion-admin-monthly-preclosure-source-reader.ts'), 'utf8');
const compiled = ts.transpileModule(runnerSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const due = new Date('2026-11-30T23:15:00.000Z'); // 20h15 Sao Paulo, ultimo dia
const beforeDue = new Date('2026-11-29T23:15:00.000Z');
const prepared = {
  readyForFinalClose: false,
  pendingSources: ['meta_financial_authority'],
  sourceSnapshot: { openai: { availability: 'partial' } },
};
function harness(overrides = {}) {
  const calls = [];
  const exports = {};
  const module = { exports };
  const mocks = {
    '@/lib/server/zion-account-provisioning': {
      createServiceSupabaseClient: () => ({ rpc: async () => { throw new Error('unexpected DB RPC'); } }),
    },
    '@/lib/server/zion-admin-monthly-preclosure-source-reader': {
      readMonthlyPreclosureSources: async (month, options) => {
        calls.push(['readSources', month]);
        assert.equal(typeof options.loadPtax, 'function');
        const report = await options.loadPtax(month, '2026-11-30');
        assert.equal(report.source, 'bcb_ptax_venda');
        return { fixed: {}, manual: {}, openAi: {} };
      },
    },
    '@/lib/server/zion-admin-monthly-preclosure-preparation': {
      prepareMonthlyPreclosureSnapshot: () => prepared,
    },
    '@/lib/server/zion-admin-ptax-evidence-persist': {
      collectAndPersistValidatedPtax: async (from, to) => {
        calls.push(['ptax', from, to]);
        if (overrides.rejectPtax) throw new Error('SIMULATED_PERSISTENCE_FAILURE');
        return { report: { source: 'bcb_ptax_venda', daily: [] } };
      },
    },
  };
  vm.runInNewContext(compiled, {
    module, exports, require: (spec) => {
      if (!(spec in mocks)) throw new Error(`unexpected import: ${spec}`);
      return mocks[spec];
    },
    Date, Intl, Error,
  });
  const register = async (input) => {
    calls.push(['register', input.month]);
    return { data: { ok: true, status: 'created', month: input.month, revision: 1 }, error: null };
  };
  return { api: module.exports, calls, register };
}

test('janela valida: usa captura persistida ANTES do snapshot', async () => {
  const h = harness();
  const result = await h.api.createMonthlyPreclosureExecutionRunner({ now: () => due, register: h.register })();
  assert.equal(result.status, 'created');
  assert.deepEqual(h.calls.map(x => x[0]), ['readSources', 'ptax', 'register']);
  assert.equal(h.calls[1][1], '2026-11-01');
  assert.equal(h.calls[1][2], '2026-11-30');
});

test('fora da janela: nenhuma leitura, PTAX ou escrita', async () => {
  const h = harness();
  const result = await h.api.createMonthlyPreclosureExecutionRunner({ now: () => beforeDue, register: h.register })();
  assert.equal(result.status, 'skipped');
  assert.equal(h.calls.length, 0);
});

test('injeÃ§Ã£o do leitor para testes preservada: nao forÃ§a persistencia', async () => {
  const h = harness();
  const result = await h.api.createMonthlyPreclosureExecutionRunner({
    now: () => due,
    readSources: async () => ({ fixed: {}, manual: {}, openAi: {} }),
    register: h.register,
  })();
  assert.equal(result.status, 'created');
  assert.deepEqual(h.calls.map(x => x[0]), ['register']);
});

test('falha integral do leitor: executor nao registra snapshot', async () => {
  const h = harness({ rejectPtax: true });
  const result = await h.api.createMonthlyPreclosureExecutionRunner({ now: () => due, register: h.register })();
  assert.equal(result.status, 'needs_review');
  assert.equal(result.reason, 'source_failure');
  assert.deepEqual(h.calls.map(x => x[0]), ['readSources', 'ptax']);
});

test('leitor padrao conserva consulta sem writer e fallback quando cotacao falha', () => {
  assert.match(readerSource, /options:\s*\{ loadPtax\?: typeof loadDailyPtaxRates \} = \{\}/);
  assert.match(readerSource, /options\.loadPtax \?\? loadDailyPtaxRates/);
  assert.match(readerSource, /if \(hasPositiveOfficialUsd\)\s*\{[\s\S]*?await loadPtax\(month, monthEnd\)/);
  assert.match(readerSource, /Fonte cambial indisponivel nao apaga os custos USD/);
});

test('a autorizacao mensal protege a captura: sem novo cron, sem fechamento final', () => {
  assert.match(runnerSource, /if \(!clock\.isDue\)/);
  assert.match(runnerSource, /collectAndPersistValidatedPtax\(from, to\)/);
  assert.match(runnerSource, /readyForFinalClose !== false/);
  assert.match(runnerSource, /pendingSources\.includes\("meta_financial_authority"\)/);
  assert.doesNotMatch(runnerSource, /zion_admin_register_monthly_final_closure/);
});
