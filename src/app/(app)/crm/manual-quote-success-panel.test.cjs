const fs=require("node:fs");
const path=require("node:path");
const assert=require("node:assert/strict");
const test=require("node:test");
const ts=require("typescript");
const React=require("react");
const {renderToStaticMarkup}=require("react-dom/server");

const source=fs.readFileSync(
  path.join(__dirname,"ManualQuoteSuccessPanel.tsx"),"utf8"
);

const js=ts.transpileModule(source,{
  compilerOptions:{
    module:ts.ModuleKind.CommonJS,
    target:ts.ScriptTarget.ES2022,
    jsx:ts.JsxEmit.ReactJSX
  }
}).outputText;

const mod={exports:{}};
let unexpectedCalls=0;

new Function("require","module","exports",js)(
  name=>{
    if(name==="@/lib/supabaseBrowser"){
      return {supabase:{auth:{getUser:async()=>{
        unexpectedCalls++;
        throw Error("UNEXPECTED_AUTH");
      }}}};
    }

    if(name==="./GeneralQuoteLeadPicker"){
      return {__esModule:true,default:()=>null};
    }

    if(name==="./manual-quote-send"){
      return {submitManualQuoteSend:async()=>{
        unexpectedCalls++;
        throw Error("UNEXPECTED_SEND");
      }};
    }

    return require(name);
  },mod,mod.exports
);

const {loadManualQuotePdfLink}=mod.exports;

const quoteId="11111111-1111-4111-8111-111111111111";
const versionId="22222222-2222-4222-8222-222222222222";

function response(overrides={},status=200){
  return Response.json({
    ok:true,
    quoteId,
    quoteVersionId:versionId,
    signedUrl:"https://storage.invalid/quote.pdf",
    mimeType:"application/pdf",
    originalFilename:"quote.pdf",
    ...overrides
  },{status});
}

test("requests the exact PDF version",async()=>{
  const link=await loadManualQuotePdfLink(
    quoteId,versionId,
    async(url,init)=>{
      assert.equal(url,
        "/api/sales-quotes/"+quoteId+
        "/signed-pdf-url?expectedQuoteVersionId="+versionId
      );
      assert.equal(init.cache,"no-store");
      assert.equal(init.method,"GET");
      return response();
    }
  );

  assert.equal(link.filename,"quote.pdf");
  assert.equal(link.signedUrl,"https://storage.invalid/quote.pdf");
});

for(const [name,overrides,status] of [
  ["stale",{ok:false},409],
  ["foreign quote",{quoteId:"foreign"},200],
  ["foreign version",{quoteVersionId:"foreign"},200],
  ["missing version",{quoteVersionId:undefined},200],
  ["insecure URL",{signedUrl:"http://storage.invalid/file"},200],
  ["URL credentials",{signedUrl:"https://user:pass@storage.invalid/file"},200],
  ["wrong MIME",{mimeType:"text/html"},200]
]){
  test(name+" is rejected",async()=>{
    await assert.rejects(loadManualQuotePdfLink(
      quoteId,versionId,
      async()=>response(overrides,status)
    ));
  });
}

test("initial panel exposes actions without sending",()=>{
  const html=renderToStaticMarkup(
    React.createElement(mod.exports.default,{
      scope:{
        organizationId:quoteId,
        storeId:quoteId,
        userId:quoteId
      },
      quoteId,
      quoteVersionId:versionId,
      onClose:()=>{}
    })
  );

  for(const label of [
    "Visualizar PDF","Baixar PDF","Enviar para um lead",
    "Enviar para outro","WhatsApp do respons",
    "Enviar orcamento","Deixar salvo"
  ]){
    assert.ok(html.includes(label),label);
  }

  assert.equal(unexpectedCalls,0);
});
