const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

class QuoteAccessError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
class InputError extends Error {}
class BoundaryError extends Error {}
class ProvenanceError extends Error {}
const ids = Object.fromEntries(["quote", "org", "store", "operation", "previous", "later", "actor"].map((k, i) => [k, `00000000-0000-4000-8000-${String(i+1).padStart(12,"0")}`]));
let f;
const mocks = {
  "next/server": { NextResponse: { json: (data, init) => Response.json(data, init) } },
  "@/lib/server/sales-quotes/quote-auth": { QuoteAccessError, async resolveAuthorizedExistingQuote(id) {
    f.calls.push("auth"); assert.equal(id, ids.quote); if (f.authError) throw f.authError; return f.scope;
  } },
  "@/lib/server/sales-quotes/human-quote-draft-edit-input": { HumanQuoteDraftInputError: InputError, buildHumanQuoteDraftEditRpcArgs() { throw Error("draft builder called"); } },
  "@/lib/server/sales-quotes/human-quote-edit-boundary": { HumanQuoteEditBoundaryError: BoundaryError, prepareHumanQuoteEditBoundary() { f.calls.push("legacy-boundary"); return { preservedStatus: "sent", expectedCurrentVersionId: ids.previous }; } },
  "@/lib/server/sales-quotes/human-quote-edit-provenance": { HumanQuoteEditProvenanceError: ProvenanceError },
  "@/lib/server/sales-quotes/human-quote-versioned-edit-save": { async saveHumanQuoteVersionedEdit(args) {
    f.calls.push("save"); f.received = args;
    assert.equal(args.scope, f.scope);
    if (f.saveError) throw f.saveError;
    if (!f.result.replayed) f.presentation = await args.loadPresentation();
    return f.result;
  } },
  "@/lib/server/sales-quotes/quote-settings": { async loadStoreQuoteSettings(args) {
    f.calls.push("settings"); assert.equal(args.supabase, f.scope.supabase); assert.equal(args.organizationId, ids.org); assert.equal(args.storeId, ids.store);
    return { settings: { currency: "BRL" } };
  } },
  "@/lib/server/store-brand-visual-policy": { async loadStoreBrandVisualPolicy(args) {
    f.calls.push("branding"); assert.equal(args.supabase, f.scope.sessionSupabase); assert.equal(args.organizationId, ids.org); assert.equal(args.storeId, ids.store);
    return f.policy;
  } },
  "@/lib/server/sales-quotes/build-quote-pdf": { async loadStoreLogoForPdf(args) {
    f.calls.push("logo"); assert.equal(args.supabase, f.scope.supabase); assert.equal(args.organizationId, ids.org); assert.equal(args.storeId, ids.store);
    return f.logo;
  } },
};
const filename = path.join(__dirname, "route.ts");
const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const route = new Module(filename, module);
route.filename = filename;
route.paths = module.paths;
// Keep the loader local to this compiled route, including dynamic imports.
route.require = (name) => {
  if (Object.hasOwn(mocks, name)) return mocks[name];
  throw Error(`Unexpected dependency: ${name}`);
};
route._compile(compiled, filename);
const { PATCH } = route.exports;

function reset() {
  f = {
    calls: [], scope: { quote: { id: ids.quote, current_version_id: ids.previous }, organizationId: ids.org, store: { id: ids.store }, user: { id: ids.actor }, supabase: {}, sessionSupabase: {} },
    body: { expected_updated_at: "2026-11-24T12:00:00.123456+00:00", expected_current_version_id: ids.previous, title: "Novo" },
    policy: { configured: true, useLogoOnQuotes: true, primaryColor: "#112233", secondaryColor: "#445566", documentFooter: "Rodape" },
    logo: { bytes: new Uint8Array([1,2,3]), mimeType: "image/png" },
    result: { quote_id: ids.quote, version_id: ids.operation, version_number: 2, current_version_id: ids.operation, updated_at: "2026-11-24T12:01:00Z", quote_status: "draft", replayed: false },
  };
}
async function invoke({ operation = ids.operation, id = ids.quote, raw } = {}) {
  const headers = { "content-type": "application/json" };
  if (operation !== null) headers["x-zion-quote-edit-operation-id"] = operation;
  const response = await PATCH(new Request("http://localhost/edit-human", { method: "PATCH", headers, body: raw ?? JSON.stringify(f.body) }), { params: Promise.resolve({ quoteId: id }) });
  return { status: response.status, data: await response.json() };
}
test("PATCH versionado encaminha pedido original e escopo autenticado", async () => { reset(); const r=await invoke(); assert.equal(r.status,200); assert.equal(r.data.ok,true); assert.equal(r.data.version_id,ids.operation); assert.equal(r.data.quote.current_version_id,ids.operation); assert.deepEqual(f.received.body,f.body); assert.equal(f.received.operationId,ids.operation); assert.deepEqual(f.calls,["auth","save","settings","branding","logo"]); });
test("branding respeita politica e usa clientes oficiais", async () => { reset(); f.policy.useLogoOnQuotes=false; await invoke(); assert.equal(f.presentation.storeLogo,null); assert.deepEqual(f.presentation.brandVisual,{primaryColor:"#112233",secondaryColor:"#445566",documentFooter:"Rodape"}); assert.equal(f.calls.includes("logo"),false); });
test("loja sem politica configurada preserva fallback de logo", async () => { reset(); f.policy.configured=false; f.policy.useLogoOnQuotes=false; await invoke(); assert.equal(f.presentation.storeLogo,f.logo); assert.equal(f.presentation.brandVisual,null); });
test("replay retorna versao da operacao sem confundir ponteiro atual", async () => { reset(); f.result.replayed=true; f.result.current_version_id=ids.later; f.scope.quote.current_version_id=ids.later; const r=await invoke(); assert.equal(r.status,200); assert.equal(r.data.replayed,true); assert.equal(r.data.version_id,ids.operation); assert.equal(r.data.quote.current_version_id,ids.later); assert.deepEqual(f.calls,["auth","save"]); });
test("operacao invalida nao chama servico", async () => { reset(); const r=await invoke({operation:"invalid"}); assert.equal(r.status,400); assert.equal(r.data.error,"INVALID_REVISION_OPERATION_ID"); assert.deepEqual(f.calls,["auth"]); });
test("autenticacao negada impede servico e branding", async () => { reset(); f.authError=new QuoteAccessError(403,"FORBIDDEN","Negado"); const r=await invoke(); assert.equal(r.status,403); assert.deepEqual(f.calls,["auth"]); });
test("conflito do servico preserva HTTP 409", async () => { reset(); f.saveError=new QuoteAccessError(409,"HUMAN_REVISION_OPERATION_CONFLICT","Conflito"); const r=await invoke(); assert.equal(r.status,409); assert.equal(r.data.error,"HUMAN_REVISION_OPERATION_CONFLICT"); });
test("erro interno nao expoe detalhes do banco", async () => { reset(); f.saveError=Error("SECRET_DATABASE_DETAIL"); const r=await invoke(); assert.equal(r.status,500); assert.equal(JSON.stringify(r.data).includes("SECRET_DATABASE_DETAIL"),false); });
test("JSON invalido nao chama servico", async () => { reset(); const r=await invoke({raw:"{"}); assert.equal(r.status,400); assert.deepEqual(f.calls,["auth"]); });
test("sem header continua usando fluxo anterior", async () => { reset(); const r=await invoke({operation:null}); assert.equal(r.status,409); assert.equal(r.data.error,"HUMAN_QUOTE_EDIT_VERSIONED_FLOW_REQUIRED"); assert.deepEqual(f.calls,["auth","legacy-boundary"]); });
