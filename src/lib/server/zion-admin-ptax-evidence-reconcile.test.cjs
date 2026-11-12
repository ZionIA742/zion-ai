const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = __dirname;
const source = fs.readFileSync(path.join(root, 'zion-admin-ptax-evidence-reconcile.ts'), 'utf8');
const runner = fs.readFileSync(path.join(root, 'zion-admin-monthly-preclosure-execution.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const id = '12345678-1234-4234-8234-123456789abc';
const key = `bcb_ptax_venda:v1:${'a'.repeat(64)}`;
const url = 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo?test=1';
const payload = { value: [{ cotacaoVenda: 5.1, dataHoraCotacao: '2026-11-06 13:00:00' }] };
const report = { source: 'bcb_ptax_venda', daily: [{ date: '2026-11-06', quotationDate: '2026-11-06', rate: '5.1', status: 'same_day' }] };
function row() { return {
  id, collection_key:key, source:'bcb_ptax_venda',
  requested_from:'2026-11-06', requested_to:'2026-11-06',
  request_started_at:'2026-11-06T19:00:00.000+00:00',
  request_finished_at:'2026-11-06T19:00:01.000+00:00',
  endpoint_url:url, response_payload:payload, result_count:1,
}; }
function harness(options = {}) {
  let readCount = 0;
  let parseCount = 0;
  let gotKey = null;
  const module = { exports: {} };
  const mocks = {
    './zion-account-provisioning': {
      createServiceSupabaseClient: () => ({ from: (table) => {
        assert.equal(table, 'zion_admin_ptax_collection_evidence');
        return { select: () => ({ eq: (field, value) => {
          assert.equal(field, 'collection_key');
          gotKey = value;
          return { maybeSingle: async () => {
            readCount++;
            return {data: options.row ?? row(), error: options.error ?? null};
          } };
        } }) };
      } }),
    },
    './zion-admin-ptax-evidence-persist': {
      buildPtaxEvidenceEnvelope: (e) => ({ collectionKey:
        e.responsePayload?.value?.[0]?.cotacaoVenda === 5.1 &&
        e.requestStartedAt === '2026-11-06T19:00:00.000Z' &&
        e.requestFinishedAt === '2026-11-06T19:00:01.000Z'
          ? key : 'wrong-key',
      }),
    },
    './zion-admin-ptax-daily': {
      loadDailyPtaxRates: async (from, to, fetcher) => {
        parseCount++;
        assert.equal(from, '2026-11-06');
        assert.equal(to, '2026-11-06');
        const response = await fetcher(options.url ?? url, {});
        const body = await response.json();
        if (!response.ok || !Array.isArray(body.value) || body.value.some(x => !(x.cotacaoVenda > 0))) {
          throw new Error('INVALID_PTX_PAYLOAD');
        }
        return options.parsed ?? report;
      },
    },
  };
  vm.runInNewContext(compiled, {
    module, exports: module.exports,
    require: (name) => {
      if (!(name in mocks)) throw new Error(`Unexpected module: ${name}`);
      return mocks[name];
    }, Date, Error, JSON, Number, Object, Array, String,
  });
  return {
    api: module.exports,
    get reads() {return readCount},
    get parses() {return parseCount},
    get key() {return gotKey},
  };
}
const captured = { collectionId:id, collectionKey:key, report };
const reconcile = h => h.api.reconcilePersistedPtaxCollection('2026-11-06', '2026-11-06', captured);

test('identidade e cotacoes reproduzidas da evidencia persistida', async () => {
  const h = harness();
  const value = await reconcile(h);
  assert.equal(value.collectionKey, key);
  assert.deepEqual(JSON.parse(JSON.stringify(value.report)), report);
  assert.equal(h.reads, 1);
  assert.equal(h.parses, 1);
  assert.equal(h.key, key);
});
test('linha de outra coleta e rejeitada', async () => {
  const h = harness({row: {...row(), id:'ffffffff-ffff-4fff-8fff-ffffffffffff'}});
  await assert.rejects(reconcile(h), /PTAX_EVIDENCE_RECONCILIATION_FAILED/);
  assert.equal(h.parses, 0);
});
test('periodo divergente e rejeitado', async () => {
  const h = harness({row: {...row(), requested_to:'2026-11-07'}});
  await assert.rejects(reconcile(h), /PTAX_EVIDENCE_RECONCILIATION_FAILED/);
});
test('payload alterado falha na identidade canonica', async () => {
  const h = harness({row: {...row(), response_payload:{value:[{cotacaoVenda:6.8,dataHoraCotacao:'2026-11-06 13:00:00'}]}}});
  await assert.rejects(reconcile(h), /PTAX_EVIDENCE_RECONCILIATION_FAILED/);
  assert.equal(h.parses, 0);
});
test('consulta SQL indisponivel interrompe reconciliacao', async () => {
  const h = harness({error:{message:'simulado'}});
  await assert.rejects(reconcile(h), /PTAX_EVIDENCE_RECONCILIATION_FAILED/);
  assert.equal(h.parses, 0);
});
test('URL nao canonica ou cotacoes divergentes interrompem reconciliacao', async () => {
  const h = harness({url:'https://not-bcb.example/invalid'});
  await assert.rejects(reconcile(h), /PTAX_EVIDENCE_RECONCILIATION_FAILED/);
  const h2 = harness({parsed: {source:'bcb_ptax_venda', daily:[{...report.daily[0],rate:'8.0'}]}});
  await assert.rejects(reconcile(h2), /PTAX_EVIDENCE_RECONCILIATION_FAILED/);
});
test('D10 vincula referencia apenas no snapshot preliminar sem liberar fechamento', () => {
  assert.match(runner, /reconcilePersistedPtaxCollection\(from, to, persisted\)/);
  assert.match(runner, /ptaxEvidence:\s*\{/);
  assert.match(runner, /collectionId:\s*sources\.ptaxEvidence\.collectionId/);
  assert.match(runner, /collectionKey:\s*sources\.ptaxEvidence\.collectionKey/);
  assert.match(runner, /pendingSources\.includes\("meta_financial_authority"\)/);
  assert.doesNotMatch(runner, /zion_admin_register_monthly_final_closure/);
});
