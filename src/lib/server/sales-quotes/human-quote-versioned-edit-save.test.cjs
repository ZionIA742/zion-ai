const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const ts = require("typescript");
const previousLoader = require.extensions[".ts"];
const originalLoad = Module._load;
class QuoteAccessError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
// Stub only the already-tested adapters to check ordering and effects of orchestration.
const calls = [];
const fault = {};
const adapters = {
  "./quote-auth": { QuoteAccessError },
  "./human-quote-versioned-edit-snapshot": { prepareHumanQuoteVersionedSnapshot(a) {
    calls.push("prepare"); if (fault.prepare) throw Error("prepare failure");
    return { quote: a.quote, rpc: { p_operation_id: a.operationId, p_total_cents: 123 }, snapshot: { quote: { totalCents: 123 } } };
  } },
  "./human-quote-versioned-edit-pdf-render": { async renderHumanQuoteRevisionPdf(a) {
    calls.push("render"); if (fault.render) throw Error("render failure");
    return { rpc: a.prepared.rpc, snapshot: { ...a.prepared.snapshot, pdfRendering: {} }, pdfBytes: Buffer.from("%PDF-test") };
  } },
  "./human-quote-versioned-edit-pdf-storage": { async storeHumanQuoteRevisionPdf(a) {
    calls.push("store"); assert.equal(Buffer.from(a.pdfBytes).toString(), "%PDF-test");
    if (fault.store) throw Error("store failure"); return { storeFileId: ids.file };
  } },
};
Module._load = function(request, parent, isMain) {
  if (Object.hasOwn(adapters, request)) return adapters[request];
  return originalLoad.call(this, request, parent, isMain);
};
require.extensions[".ts"] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
  });
  module._compile(result.outputText, filename);
};
let save;
try { save = require("./human-quote-versioned-edit-save.ts").saveHumanQuoteVersionedEdit; }
finally {
  Module._load = originalLoad;
  if (previousLoader) require.extensions[".ts"] = previousLoader;
  else delete require.extensions[".ts"];
}
const ids = Object.fromEntries(["quote", "org", "store", "previous", "actor", "operation", "file", "later"].map((k, i) => [k, `00000000-0000-4000-8000-${String(i+1).padStart(12,"0")}`]));
function fixture() {
  calls.length = 0; for (const k of Object.keys(fault)) delete fault[k];
  const stamp = "2026-11-24T12:00:00.123456+00:00";
  const quote = { id: ids.quote, organization_id: ids.org, store_id: ids.store, status: "sent", current_version_id: ids.previous, updated_at: stamp, metadata: { created_via: "api_sales_quotes_create", creation_actor_kind: "user", creation_actor_user_id: ids.actor } };
  const previous = { id: ids.previous, quote_id: ids.quote, organization_id: ids.org, store_id: ids.store, version_number: 1 };
  const versions = [previous], writes = [], reads = [];
  let current = { id: quote.id, current_version_id: ids.previous, updated_at: stamp, status: "sent" };
  const state = { rpcError: null, commitThenError: false, badResult: false };
  const supabase = {
    from(table) {
      const filters = {};
      const builder = { select() { return builder; }, eq(k,v) { filters[k]=v; return builder; },
        async maybeSingle() {
          reads.push({table, filters: {...filters}});
          assert.equal(filters.organization_id, ids.org); assert.equal(filters.store_id, ids.store);
          if (table === "sales_quote_versions") { assert.equal(filters.quote_id, ids.quote); return {data: versions.find(v=>v.id===filters.id) || null,error:null}; }
          assert.equal(table,"sales_quotes"); assert.equal(filters.id,ids.quote); return {data:current,error:null};
        },
        async order() { assert.equal(table,"sales_quote_items"); assert.equal(filters.organization_id,ids.org); assert.equal(filters.store_id,ids.store); assert.equal(filters.quote_id,ids.quote); return {data:[],error:null}; }
      }; return builder;
    },
    async rpc(name, payload) {
      calls.push("rpc"); writes.push(payload); assert.equal(name,"apply_human_sales_quote_versioned_edit_by_system");
      assert.equal(payload.p_store_file_id, ids.file); assert.equal(payload.p_quote_snapshot.quote.totalCents,123);
      assert.match(payload.p_quote_snapshot.humanEditRequest.sha256,/^[0-9a-f]{64}$/);
      if (state.rpcError && !state.commitThenError) return {error:state.rpcError};
      versions.push({...previous,id:ids.operation,version_number:2,generated_by:"human_revision",store_file_id:ids.file,quote_snapshot:payload.p_quote_snapshot});
      current={...current,current_version_id:ids.operation,updated_at:"2026-11-24T12:01:00Z",status:"draft"};
      if (state.commitThenError) return {error:{code:"NETWORK"}};
      return {data:[{quote_id:state.badResult?ids.later:ids.quote,version_id:ids.operation,version_number:2,current_version_id:ids.operation,updated_at:current.updated_at,quote_status:"draft",replayed:false}],error:null};
    },
  };
  const args={scope:{quote,supabase,organizationId:ids.org,store:{id:ids.store},lead:null,user:{id:ids.actor}},operationId:ids.operation,body:{expected_updated_at:stamp,expected_current_version_id:ids.previous,title:"Novo"},loadPresentation:async()=>{calls.push("visual");return {settings:{},storeLogo:null,brandVisual:null};}};
  return {args,state,versions,writes,reads,advance(){current={...current,current_version_id:ids.later};}};
}
test("salva com render e storage antes de uma unica RPC",async()=>{const f=fixture();const r=await save(f.args);assert.deepEqual(calls,["visual","prepare","render","store","rpc"]);assert.equal(r.version_id,ids.operation);assert.equal(r.replayed,false);assert.equal(f.writes.length,1);});
test("replay HTTP apos mudanca da versao nao renderiza nem grava",async()=>{const f=fixture();await save(f.args);calls.length=0;f.args.scope.quote.current_version_id=ids.operation;f.args.body={title:"Novo",expected_current_version_id:ids.previous,expected_updated_at:f.args.body.expected_updated_at};const r=await save(f.args);assert.equal(r.replayed,true);assert.deepEqual(calls,[]);assert.equal(f.writes.length,1);});
test("replay antigo nao confunde a versao atual",async()=>{const f=fixture();await save(f.args);f.advance();const r=await save(f.args);assert.equal(r.current_version_id,ids.later);assert.equal(r.version_id,ids.operation);});
test("mesma operacao com pedido diferente retorna conflito",async()=>{const f=fixture();await save(f.args);f.args.body.title="Outro";await assert.rejects(save(f.args),e=>e.status===409);assert.equal(f.writes.length,1);});
test("outro ator nao pode repetir a identidade da operacao",async()=>{const f=fixture();await save(f.args);f.args.scope.user.id=ids.later;await assert.rejects(save(f.args),e=>e.status===409);assert.equal(f.writes.length,1);});
test("resposta perdida apos commit recupera versao registrada",async()=>{const f=fixture();f.state.commitThenError=true;const r=await save(f.args);assert.equal(r.replayed,true);assert.equal(f.writes.length,1);});
test("edicao obsoleta nao renderiza nem grava",async()=>{const f=fixture();f.args.body.expected_updated_at="old";await assert.rejects(save(f.args),e=>e.status===409);assert.deepEqual(calls,[]);});
test("proveniencia ausente impede qualquer leitura ou escrita",async()=>{const f=fixture();f.args.scope.quote.metadata={};await assert.rejects(save(f.args));assert.deepEqual(f.reads,[]);assert.deepEqual(calls,[]);});
test("falha de render nao chama storage ou writer",async()=>{const f=fixture();fault.render=true;await assert.rejects(save(f.args),/render failure/);assert.deepEqual(calls,["visual","prepare","render"]);});
test("falha de storage nao chama writer",async()=>{const f=fixture();fault.store=true;await assert.rejects(save(f.args),/store failure/);assert.equal(f.writes.length,0);});
test("conflito SQL sem replay nao e tratado como sucesso",async()=>{const f=fixture();f.state.rpcError={code:"40001"};await assert.rejects(save(f.args),e=>e.status===409);assert.equal(f.writes.length,1);});
test("retorno divergente do writer nao e tratado como sucesso",async()=>{const f=fixture();f.state.badResult=true;await assert.rejects(save(f.args),/SAVE_RESULT_INVALID/);});

test("salva revisao de legado reconhecido sem autor inventado",async()=>{
  const f=fixture(); const m={created_via:"api_sales_quotes_create",legacy_human_edit_eligible:true};
  f.args.scope.quote.metadata=m; const r=await save(f.args);
  assert.equal(r.version_id,ids.operation); assert.equal(f.writes.length,1); assert.deepEqual(f.args.scope.quote.metadata,m);
});
test("legado sem reconhecimento nao acessa storage ou SQL",async()=>{
  const f=fixture(); f.args.scope.quote.metadata={created_via:"api_sales_quotes_create"};
  await assert.rejects(save(f.args)); assert.deepEqual(f.reads,[]); assert.deepEqual(calls,[]);
});
