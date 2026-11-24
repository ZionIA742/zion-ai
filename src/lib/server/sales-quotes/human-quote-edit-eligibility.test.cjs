const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const oldLoader = require.extensions[".ts"];
let api, boundary;
require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename,"utf8"), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:filename
  }).outputText,filename);
};
try {
  api = require("./human-quote-edit-provenance.ts");
  boundary = require("./human-quote-edit-boundary.ts");
} finally {
  if (oldLoader) require.extensions[".ts"] = oldLoader;
  else delete require.extensions[".ts"];
}
const actor = "11111111-1111-4111-8111-111111111111";
const version = "22222222-2222-4222-8222-222222222222";
const legacy = {created_via:"api_sales_quotes_create",legacy_human_edit_eligible:true};
const current = {created_via:"api_sales_quotes_create",creation_actor_kind:"user",creation_actor_user_id:actor};
const stamp = "2026-11-24T12:00:00.123456+00:00";
function quote(metadata,status="draft",current_version_id=null) {
  return {id:actor,organization_id:actor,store_id:actor,status,current_version_id,updated_at:stamp,metadata};
}
function rejected(metadata) {
  assert.equal(api.isLegacyHumanQuoteEditEligible(quote(metadata)),false);
  assert.throws(()=>api.assertHumanQuoteEditEligibility(quote(metadata)),api.HumanQuoteEditProvenanceError);
}
test("legado reconhecido permite editar sem inventar autor",()=>{
  assert.equal(api.isLegacyHumanQuoteEditEligible(quote(legacy)),true);
  assert.deepEqual(api.assertHumanQuoteEditEligibility(quote(legacy)),{creationActorUserId:null});
  assert.throws(()=>api.assertHumanQuoteEditProvenance(quote(legacy)),api.HumanQuoteEditProvenanceError);
});
test("autor atual permanece comprovado",()=>{
  assert.deepEqual(api.assertHumanQuoteEditEligibility(quote(current)),api.assertHumanQuoteEditProvenance(quote(current)));
  assert.equal(api.isLegacyHumanQuoteEditEligible(quote(current)),false);
});
test("origem antiga sem reconhecimento nao e elegivel",()=>rejected({created_via:legacy.created_via}));
test("marcador exige booleano verdadeiro",()=>{for(const v of [false,"true",1,null]) rejected({...legacy,legacy_human_edit_eligible:v});});
test("IA e concessao nao herdam elegibilidade",()=>{for(const v of ["p19a_quote_preparation","p9_8_5_negotiation_concession_materialization"]) rejected({...legacy,created_via:v});});
test("campos de autoria conflitantes inclusive null impedem legado",()=>{for(const m of [{creation_actor_kind:null},{creation_actor_user_id:null},{creation_actor_kind:"system"},{creation_actor_user_id:actor}]) rejected({...legacy,...m});});
test("boundary aceita rascunho legado e preserva metadata",()=>{
  const q=quote({...legacy}); const before=JSON.stringify(q);
  const result=boundary.prepareHumanQuoteEditBoundary({quote:q,expectedUpdatedAt:stamp,expectedCurrentVersionId:null});
  assert.deepEqual(result.preservedMetadata,legacy); assert.equal(result.preservedStatus,"draft"); assert.equal(JSON.stringify(q),before);
});
test("boundary aceita legado enviado e continua exigindo timestamp",()=>{
  const q=quote({...legacy},"sent",version);
  const result=boundary.prepareHumanQuoteEditBoundary({quote:q,expectedUpdatedAt:stamp,expectedCurrentVersionId:version});
  assert.equal(result.expectedCurrentVersionId,version); assert.equal(result.preservedStatus,"sent");
  assert.throws(()=>boundary.prepareHumanQuoteEditBoundary({quote:q,expectedUpdatedAt:"2026-11-23T12:00:00Z",expectedCurrentVersionId:version}));
});
