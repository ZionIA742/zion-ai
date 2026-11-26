const fs=require("node:fs");
const assert=require("node:assert/strict");
const test=require("node:test");
const ts=require("typescript");

const quoteId="11111111-1111-4111-8111-111111111111";
const versionId="22222222-2222-4222-8222-222222222222";
const otherVersion="33333333-3333-4333-8333-333333333333";

class QuoteAccessError extends Error{
  constructor(){
    super("Forbidden");
    this.status=403;
    this.code="QUOTE_FORBIDDEN";
  }
}

function setup(options={}){

  const calls={queries:0,signs:0,filters:[]};

  const query={
    select(){return this;},
    eq(key,value){
      calls.filters.push([key,value]);
      return this;
    },
    async maybeSingle(){
      return {
        error:null,
        data:options.missingVersion?null:{
          id:versionId,
          storage_bucket:"zion-store-files",
          storage_path:"org/store/quote.pdf",
          original_filename:"quote.pdf",
          mime_type:"application/pdf"
        }
      };
    }
  };

  const scope={
    quote:{
      id:quoteId,
      current_version_id:options.noCurrent?null:versionId
    },
    organizationId:"org",
    store:{id:"store"},
    supabase:{
      from(table){
        assert.equal(table,"sales_quote_versions");
        calls.queries++;
        return query;
      },
      storage:{
        from(bucket){
          assert.equal(bucket,"zion-store-files");
          return {
            async createSignedUrl(path,ttl){
              assert.equal(path,"org/store/quote.pdf");
              assert.equal(ttl,900);
              calls.signs++;
              return {
                data:{signedUrl:"https://storage.invalid/private.pdf"},
                error:null
              };
            }
          };
        }
      }
    }
  };

  const source=fs.readFileSync(
    require("node:path").join(__dirname,"route.ts"),"utf8"
  );

  const js=ts.transpileModule(source,{
    compilerOptions:{
      module:ts.ModuleKind.CommonJS,
      target:ts.ScriptTarget.ES2022
    }
  }).outputText;

  const module={exports:{}};

  new Function("require","module","exports",js)(
    name=>{
      if(name==="next/server"){
        return {NextResponse:Response};
      }

      if(name.endsWith("/zion-admin-diagnostic-backend-next")){
        return {withBackendDiagnosticRoute:(_p,_m,h)=>h};
      }

      if(name.endsWith("/quote-auth")){
        return {
          QuoteAccessError,
          resolveAuthorizedExistingQuote:async id=>{
            assert.equal(id,quoteId);
            if(options.forbidden)throw new QuoteAccessError();
            return scope;
          }
        };
      }

      throw Error("UNEXPECTED_IMPORT: "+name);
    },module,module.exports
  );

  return {
    calls,
    async run(query=""){
      const response=await module.exports.GET(
        new Request("https://zion.invalid/pdf"+query),
        {params:Promise.resolve({quoteId})}
      );

      return {
        http:response.status,
        body:await response.json(),
        cache:response.headers.get("Cache-Control")
      };
    }
  };
}

test("legacy caller remains compatible",async()=>{
  const h=setup();
  const r=await h.run();

  assert.equal(r.http,200);
  assert.equal(r.body.quoteId,quoteId);
  assert.equal(r.body.quoteVersionId,versionId);
  assert.equal(r.cache,"no-store");
  assert.equal(h.calls.signs,1);
});

test("exact expected version is scoped and signed",async()=>{
  const h=setup();
  const r=await h.run("?expectedQuoteVersionId="+versionId);

  assert.equal(r.http,200);
  assert.equal(r.body.quoteVersionId,versionId);

  assert.deepEqual(h.calls.filters,[
    ["id",versionId],
    ["quote_id",quoteId],
    ["organization_id","org"],
    ["store_id","store"]
  ]);

  assert.equal(h.calls.signs,1);
});

for(const [name,query,http] of [
  ["stale version","?expectedQuoteVersionId="+otherVersion,409],
  ["invalid version","?expectedQuoteVersionId=invalid",400],
  ["duplicate parameter",
    "?expectedQuoteVersionId="+versionId+
    "&expectedQuoteVersionId="+otherVersion,400]
]){
  test(name+" never signs PDF",async()=>{
    const h=setup();
    const r=await h.run(query);

    assert.equal(r.http,http);
    assert.equal(h.calls.queries,0);
    assert.equal(h.calls.signs,0);
    assert.equal(r.body.signedUrl,undefined);
  });
}

test("unauthorized scope never signs",async()=>{
  const h=setup({forbidden:true});
  assert.equal((await h.run()).http,403);
  assert.equal(h.calls.signs,0);
});

test("missing version never signs",async()=>{
  const h=setup({missingVersion:true});
  assert.equal((await h.run()).http,404);
  assert.equal(h.calls.signs,0);
});

test("legacy quote without current version stays unavailable",async()=>{
  const h=setup({noCurrent:true});
  assert.equal((await h.run()).http,404);
  assert.equal(h.calls.signs,0);
});
