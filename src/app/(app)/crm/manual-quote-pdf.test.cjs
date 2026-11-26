const fs=require("node:fs");
const path=require("node:path");
const ts=require("typescript");
const assert=require("node:assert/strict");

function load(file,resolver) {
  const source=fs.readFileSync(file,"utf8");

  const js=ts.transpileModule(source,{
    compilerOptions:{
      target:ts.ScriptTarget.ES2022,
      module:ts.ModuleKind.CommonJS
    }
  }).outputText;

  const m={exports:{}};

  new Function("require","module","exports",js)(
    resolver,m,m.exports
  );

  return m.exports;
}

const operation=load(
  path.join(__dirname,"lead/[id]/quote-create-operation.ts"),
  require
);

const model=load(
  path.join(__dirname,"quote-editor-model.ts"),
  require
);

const pdf=load(
  path.join(__dirname,"manual-quote-pdf.ts"),
  name=>{
    if(name.endsWith("/quote-create-operation"))
      return operation;

    if(name==="./quote-editor-model")return model;

    throw Error("Unexpected import: "+name);
  }
);

const quoteId="11111111-1111-4111-8111-111111111111";
const versionId="22222222-2222-4222-8222-222222222222";

function storage() {
  const entries=new Map();

  return {
    entries,
    getItem:key=>entries.get(key)??null,
    setItem:(key,value)=>entries.set(key,value),
    removeItem:key=>entries.delete(key)
  };
}

function setup(overrides={}) {
  const store=storage();
  const calls=[];
  let next=0;

  const payload={
    organizationId:"org-a",
    storeId:"store-a",
    leadId:null,
    conversationId:null,
    commercialOpportunityId:null,
    title:"Orcamento",
    customer_name:null,
    customer_phone:null,
    customer_notes:null,
    internal_notes:null,
    warranty_terms:null,
    validity_days:null,
    items:pdf.normalizeManualQuoteItems([{
      ...model.createEmptyQuoteFormItem(),
      name:"Piscina",
      quantity:"2",
      unitPriceReais:"150,50",
      discountReais:"10,00"
    }]),
    ...overrides
  };

  const args={
    payload,
    pendingOperationStorageKey:
      operation.buildManualQuoteCreationStorageKey(payload),
    requestSnapshot:
      operation.buildManualQuoteCreationSnapshot({
        ...payload,
        discount_cents:0
      }),
    storage:store,
    createUuid:()=>
      "00000000-0000-4000-8000-"+
      String(++next).padStart(12,"0")
  };

  function fetcher(mode="success") {
    return async(url,init)=>{

      calls.push({url,init});

      if(url==="/api/sales-quotes/create") {
        if(mode==="create-error")
          return Response.json(
            {ok:false,message:"create failure"},
            {status:400}
          );

        if(mode==="invalid-create")
          return Response.json({ok:true});

        return Response.json({ok:true,quoteId});
      }

      assert.equal(
        url,
        "/api/sales-quotes/"+quoteId+"/generate-pdf"
      );

      if(mode==="network-error")
        throw Error("network failure");

      if(mode==="pdf-error")
        return Response.json(
          {ok:false,message:"pdf failure"},
          {status:503}
        );

      if(mode==="missing-version")
        return Response.json({ok:true,quoteId});

      if(mode==="invalid-version")
        return Response.json({ok:true,quoteId,versionId:"invalid"});

      if(mode==="foreign-quote")
        return Response.json({ok:true,quoteId:versionId,versionId});

      return Response.json({ok:true,quoteId,versionId});
    };
  }

  return {
    args,store,calls,
    run:mode=>pdf.submitManualQuotePdf({
      ...args,
      fetcher:fetcher(mode)
    })
  };
}

(async()=>{

  let count=0;

  async function test(name,fn) {
    await fn();
    count++;
    console.log("ok - "+name);
  }

  await test("original item normalization is preserved",()=>{
    const r=setup();

    assert.deepEqual(r.args.payload.items,[{
      item_type:"custom",
      name:"Piscina",
      description:null,
      quantity:2,
      unit_price_cents:15050,
      discount_cents:1000
    }]);

    const items=pdf.normalizeManualQuoteItems([{
      ...model.createEmptyQuoteFormItem(),
      itemType:"service",
      name:" Instalacao ",
      description:" Detalhes ",
      quantity:"1",
      unitPriceReais:"20"
    }]);

    assert.equal(items[0].item_type,"service");
    assert.equal(items[0].name,"Instalacao");
    assert.equal(items[0].description,"Detalhes");
  });

  await test("unlinked creation calls only create and PDF",async()=>{
    const r=setup();

    assert.deepEqual(await r.run(),{quoteId,quoteVersionId:versionId});
    assert.equal(r.calls.length,2);

    const body=JSON.parse(r.calls[0].init.body);

    assert.equal(body.leadId,null);
    assert.equal(body.conversationId,null);
    assert.equal(body.commercialOpportunityId,null);
    assert.equal(body.customer_name,null);
    assert.equal(body.customer_phone,null);

    assert.equal(r.calls[0].init.method,"POST");
    assert.equal(r.calls[1].init.method,"POST");

    assert.ok(
      r.calls[1].init.headers["x-zion-quote-operation-id"]
    );

    assert.equal(r.store.entries.size,0);
  });

  await test("explicit lead context is preserved",async()=>{
    const r=setup({
      leadId:"lead-a",
      conversationId:"conversation-a",
      commercialOpportunityId:"opportunity-a",
      customer_name:"Cliente"
    });

    await r.run();

    const body=JSON.parse(r.calls[0].init.body);

    assert.equal(body.leadId,"lead-a");
    assert.equal(body.conversationId,"conversation-a");
    assert.equal(body.commercialOpportunityId,"opportunity-a");
    assert.equal(body.customer_name,"Cliente");
  });

  await test("PDF failure preserves both retry identities",async()=>{
    const r=setup();

    await assert.rejects(r.run("pdf-error"),/pdf failure/);

    assert.equal(r.store.entries.size,2);

    const firstCreate=r.calls[0].init.body;
    const firstPdf=r.calls[1].init.headers[
      "x-zion-quote-operation-id"
    ];

    await r.run();

    assert.equal(r.calls.length,4);
    assert.equal(r.calls[2].init.body,firstCreate);
    assert.equal(
      r.calls[3].init.headers["x-zion-quote-operation-id"],
      firstPdf
    );

    assert.equal(r.store.entries.size,0);
  });

  await test("network uncertainty keeps retry identities",async()=>{
    const r=setup();

    await assert.rejects(
      r.run("network-error"),
      /network failure/
    );

    assert.equal(r.store.entries.size,2);

    await r.run();

    assert.equal(
      r.calls[0].init.body,
      r.calls[2].init.body
    );

    assert.equal(
      r.calls[1].init.headers["x-zion-quote-operation-id"],
      r.calls[3].init.headers["x-zion-quote-operation-id"]
    );

    assert.equal(r.store.entries.size,0);
  });

  await test("create failure never starts PDF generation",async()=>{
    for(const mode of ["create-error","invalid-create"]) {
      const r=setup();

      await assert.rejects(r.run(mode));

      assert.equal(r.calls.length,1);
      assert.equal(r.store.entries.size,1);
    }
  });

  await test("invalid tenant scope fails before network",async()=>{
    const r=setup({storeId:""});

    await assert.rejects(r.run(),/Escopo/);

    assert.equal(r.calls.length,0);
    assert.equal(r.store.entries.size,0);
  });

  await test("changed snapshot fails before network",async()=>{
    const r=setup();

    r.args.payload.title="Alterado";

    await assert.rejects(r.run(),/divergente/);

    assert.equal(r.calls.length,0);
    assert.equal(r.store.entries.size,0);
  });

  await test("different stores have independent creation keys",()=>{
    const a=setup();
    const b=setup({storeId:"store-b"});

    assert.notEqual(
      a.args.pendingOperationStorageKey,
      b.args.pendingOperationStorageKey
    );
  });

  await test("PDF operation helpers preserve retry identity",()=>{
    const s=storage();
    const create=()=>quoteId;

    assert.equal(
      pdf.getQuotePdfOperationId("q-a",s,create),
      quoteId
    );

    assert.equal(
      pdf.getQuotePdfOperationId("q-a",s,()=>{
        throw Error("unexpected regeneration");
      }),
      quoteId
    );

    pdf.clearQuotePdfOperationId("q-a",s);

    assert.equal(s.entries.size,0);
  });

  for(const mode of [
    "missing-version","invalid-version","foreign-quote"
  ]){
    await test("invalid PDF identity preserves retries: "+mode,async()=>{
      const r=setup();

      await assert.rejects(r.run(mode));
      assert.equal(r.store.entries.size,2);

      const firstCreate=r.calls[0].init.body;
      const firstPdf=r.calls[1].init.headers[
        "x-zion-quote-operation-id"
      ];

      assert.deepEqual(await r.run(),{
        quoteId,quoteVersionId:versionId
      });

      assert.equal(r.calls[2].init.body,firstCreate);
      assert.equal(
        r.calls[3].init.headers["x-zion-quote-operation-id"],
        firstPdf
      );

      assert.equal(r.store.entries.size,0);
    });
  }

  assert.equal(count,13);

  console.log("MANUAL_QUOTE_PDF: "+count+"/13 PASS");

})().catch(error=>{
  console.error(error.stack);
  process.exitCode=1;
});
