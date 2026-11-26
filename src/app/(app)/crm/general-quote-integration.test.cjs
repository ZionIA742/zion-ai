const fs=require("node:fs");
const path=require("node:path");
const assert=require("node:assert/strict");
const ts=require("typescript");
const crypto=require("node:crypto");

function load(file,resolver) {
  const js=ts.transpileModule(
    fs.readFileSync(file,"utf8"),
    {
      compilerOptions:{
        module:ts.ModuleKind.CommonJS,
        target:ts.ScriptTarget.ES2022
      }
    }
  ).outputText;

  const m={exports:{}};

  new Function("require","module","exports",js)(
    resolver,m,m.exports
  );

  return m.exports;
}

const model=load(
  path.join(__dirname,"quote-editor-model.ts"),
  require
);

const operation=load(
  path.join(__dirname,"lead/[id]/quote-create-operation.ts"),
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

const general=load(
  path.join(__dirname,"general-quote-model.ts"),
  name=>{
    if(name.endsWith("/quote-create-operation"))
      return operation;
    if(name==="./quote-editor-model")return model;
    if(name==="./manual-quote-pdf")return pdf;
    throw Error("Unexpected import: "+name);
  }
);

const editorFile=path.join(
  __dirname,"GeneralQuoteEditor.tsx"
);

const leadFile=path.join(
  __dirname,"lead/[id]/page.tsx"
);

function extract(file,name,env) {
  const ast=ts.createSourceFile(
    file,fs.readFileSync(file,"utf8"),
    ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX
  );

  const matches=[];

  function visit(node) {
    if(
      ts.isFunctionDeclaration(node) &&
      node.name?.text===name
    )matches.push(node.getText(ast));

    ts.forEachChild(node,visit);
  }

  visit(ast);
  assert.equal(matches.length,1,name);

  const js=ts.transpileModule(
    matches[0],
    {
      compilerOptions:{
        target:ts.ScriptTarget.ES2022,
        module:ts.ModuleKind.None
      }
    }
  ).outputText;

  return new Function(
    ...Object.keys(env),
    js+"\nreturn "+name+";"
  )(...Object.values(env));
}

const scope={
  organizationId:"org-test",
  storeId:"store-test",
  userId:"user-test"
};

const quoteId=
  "11111111-1111-4111-8111-111111111111";

const selectedLead={
  id:"22222222-2222-4222-8222-222222222222",
  name:"Cliente Teste",
  phone:"11900000000",
  organizationId:scope.organizationId,
  storeId:scope.storeId
};

function makeDraft() {
  const draft=general.createGeneralQuoteDraft();

  draft.quoteTitle="Orcamento piscina";
  draft.quoteItems[0]={
    ...draft.quoteItems[0],
    name:"Piscina",
    quantity:"2",
    unitPriceReais:"100,00",
    discountReais:"10,00"
  };

  return draft;
}

function makeStorage() {
  const entries=new Map();

  return {
    getItem:key=>entries.get(key)??null,
    setItem:(key,value)=>entries.set(key,value),
    removeItem:key=>entries.delete(key),
    entries
  };
}

function setup(options={}) {
  const draft=options.draft??makeDraft();
  const storage=options.storage??makeStorage();

  const guard=options.guard??new Set();

  const draftKey=general.buildGeneralQuoteDraftKey(scope);

  if(!options.storage)
    storage.setItem(draftKey,JSON.stringify(draft));

  const mounted={current:true};
  const userRef={current:scope.userId};
  const inFlight={current:false};

  const calls=[];
  const errors=[];
  const successes=[];
  const busy=[];

  const state={
    authUser:scope.userId,
    pdfFailure:false,
    changedLead:false,
    onPdf:null,
    ...options.state
  };

  async function fetcher(url,init) {
    calls.push({url,init});

    if(url==="/api/sales-quotes/lead-picker") {
      return Response.json({
        ok:true,
        organizationId:scope.organizationId,
        storeId:scope.storeId,
        leads:[{
          id:selectedLead.id,
          name:state.changedLead
            ? "Nome alterado"
            : selectedLead.name,
          phone:selectedLead.phone
        }],
        hasMore:false,
        nextOffset:null
      });
    }

    if(url==="/api/sales-quotes/create") {
      return Response.json({ok:true,quoteId});
    }

    assert.equal(
      url,
      "/api/sales-quotes/"+quoteId+"/generate-pdf"
    );

    if(state.onPdf)await state.onPdf();

    return state.pdfFailure
      ? Response.json(
          {ok:false,message:"PDF_TEST_FAILURE"},
          {status:503}
        )
      : Response.json({ok:true,quoteId,versionId:"33333333-3333-4333-8333-333333333333"});
  }

  const generate=extract(editorFile,"generate",{
    ...scope,
    draft,
    success:null,
    storageFailed:false,
    validation:
      general.calculateGeneralQuoteValidation(draft,true),
    inFlight,mounted,userRef,
    activeGeneralQuoteSubmissions:guard,
    setBusy:value=>busy.push(value),
    setError:value=>errors.push(value),
    setSuccess:value=>successes.push(value),
    window:{
      sessionStorage:storage,
      crypto:{randomUUID:crypto.randomUUID}
    },
    supabase:{
      auth:{
        getUser:async()=>({
          data:{user:{id:state.authUser}},
          error:null
        })
      }
    },
    buildGeneralQuoteDraftKey:
      general.buildGeneralQuoteDraftKey,
    buildGeneralQuoteSubmission:
      general.buildGeneralQuoteSubmission,
    revalidateGeneralQuoteLead:(s,l)=>
      general.revalidateGeneralQuoteLead(s,l,fetcher),
    setGeneratedQuote:value=>{
      assert.deepEqual(value,{
        quoteId,
        quoteVersionId:"33333333-3333-4333-8333-333333333333"
      });
      state.generatedQuote=value;
    },
    submitManualQuotePdf:args=>
      pdf.submitManualQuotePdf({...args,fetcher})
  });

  return {
    draft,storage,draftKey,guard,
    mounted,userRef,inFlight,state,
    calls,errors,successes,busy,
    generate
  };
}

module.exports=(async()=>{

  let count=0;

  async function test(name,fn) {
    await fn();
    count++;
    console.log("ok - "+name);
  }

  await test("both catalog adapters have identical behavior",()=>{
    for(const itemType of [
      "pool_installation","custom","service"
    ]) {
      const original=[
        {
          ...model.createEmptyQuoteFormItem(),
          id:"item-a",
          itemType,
          quantity:"3",
          discountReais:"15"
        },
        {
          ...model.createEmptyQuoteFormItem(),
          id:"item-b"
        }
      ];

      let leadItems=structuredClone(original);

      let draft={
        ...makeDraft(),
        quoteItems:structuredClone(original)
      };

      const values={
        name:"Produto do catalogo",
        description:"Descricao cadastrada",
        unitPriceReais:"150,50"
      };

      const originalApply=extract(
        leadFile,
        "applyCatalogPrefillToQuoteItem",
        {
          setQuoteItems:fn=>{
            leadItems=fn(leadItems);
          }
        }
      );

      const generalApply=extract(
        editorFile,
        "applyCatalog",
        {
          updateDraft:fn=>{draft=fn(draft);}
        }
      );

      originalApply("item-a",values);
      generalApply("item-a",values);

      assert.deepEqual(draft.quoteItems,leadItems);
      assert.equal(draft.quoteItems[0].itemType,itemType);
      assert.equal(draft.quoteItems[0].name,values.name);
      assert.equal(draft.quoteItems[0].description,values.description);
      assert.equal(draft.quoteItems[0].unitPriceReais,values.unitPriceReais);
      assert.equal(draft.quoteItems[0].quantity,"3");
      assert.equal(draft.quoteItems[0].discountReais,"15");
      assert.deepEqual(draft.quoteItems[1],original[1]);
    }
  });

  await test("successful generation without lead clears draft",async()=>{
    const r=setup();

    await r.generate();

    assert.equal(r.calls.length,2);
    assert.equal(r.successes.length,1);
    assert.equal(r.storage.getItem(r.draftKey),null);
    assert.equal(r.storage.entries.size,0);
    assert.equal(r.guard.size,0);
  });

  await test("success after unmount retires original draft",async()=>{
    const r=setup();

    r.state.onPdf=()=>{
      r.mounted.current=false;
    };

    await r.generate();

    assert.equal(r.calls.length,2);
    assert.equal(r.successes.length,0);

    assert.equal(
      r.storage.getItem(r.draftKey),
      null,
      "DRAFT_REMAINED_AFTER_SUCCESS_UNMOUNT"
    );

    assert.equal(r.guard.size,0);
  });

  await test("PDF failure preserves draft and retry identities",async()=>{
    const r=setup();

    r.state.pdfFailure=true;

    await r.generate();

    assert.equal(r.errors.at(-1),"PDF_TEST_FAILURE");
    assert.equal(r.storage.entries.size,3);
    assert.equal(r.guard.size,0);

    const initialCreate=r.calls[0].init.body;
    const initialPdf=r.calls[1].init.headers[
      "x-zion-quote-operation-id"
    ];

    r.state.pdfFailure=false;

    await r.generate();

    assert.equal(r.calls[2].init.body,initialCreate);

    assert.equal(
      r.calls[3].init.headers["x-zion-quote-operation-id"],
      initialPdf
    );

    assert.equal(r.storage.entries.size,0);
  });

  await test("newer draft is not deleted by older completion",async()=>{
    const r=setup();

    const newer=JSON.stringify({
      ...r.draft,
      quoteTitle:"Novo rascunho"
    });

    r.state.onPdf=()=>{
      r.mounted.current=false;
      r.storage.setItem(r.draftKey,newer);
    };

    await r.generate();

    assert.equal(
      r.storage.getItem(r.draftKey),
      newer
    );
  });

  await test("linked generation revalidates before creation",async()=>{
    const draft=general.setGeneralQuoteLead(
      scope,makeDraft(),selectedLead
    );

    const r=setup({draft});

    await r.generate();

    assert.equal(r.calls.length,3);

    assert.deepEqual(
      r.calls.map(call=>call.url),
      [
        "/api/sales-quotes/lead-picker",
        "/api/sales-quotes/create",
        "/api/sales-quotes/"+quoteId+"/generate-pdf"
      ]
    );

    const body=JSON.parse(r.calls[1].init.body);

    assert.equal(body.leadId,selectedLead.id);
    assert.equal(body.customer_name,selectedLead.name);
    assert.equal(body.customer_phone,selectedLead.phone);
    assert.equal(body.conversationId,null);
    assert.equal(body.commercialOpportunityId,null);
  });

  await test("changed lead blocks creation",async()=>{
    const r=setup({
      draft:general.setGeneralQuoteLead(
        scope,makeDraft(),selectedLead
      ),
      state:{changedLead:true}
    });

    await r.generate();

    assert.equal(r.calls.length,1);
    assert.match(r.errors.at(-1),/Selecione-o novamente/);
    assert.equal(r.successes.length,0);
  });

  await test("changed session blocks all quote requests",async()=>{
    const r=setup({
      state:{authUser:"other-user"}
    });

    await r.generate();

    assert.equal(r.calls.length,0);
    assert.match(r.errors.at(-1),/sessao mudou/);
    assert.equal(r.guard.size,0);
  });

  await test("remounted editor cannot overlap or reuse completed draft",async()=>{
    const r=setup();

    let release;
    let reached;

    const waiting=new Promise(resolve=>{
      release=resolve;
    });

    const pdfReached=new Promise(resolve=>{
      reached=resolve;
    });

    r.state.onPdf=async()=>{
      reached();
      await waiting;
    };

    const pending=r.generate();

    await pdfReached;

    r.mounted.current=false;

    const reopened=setup({
      draft:r.draft,
      storage:r.storage,
      guard:r.guard
    });

    try {
      await reopened.generate();

      assert.equal(reopened.calls.length,0);
      assert.match(reopened.errors.at(-1),/em andamento/);
    } finally {
      release();
      await pending;
    }

    await reopened.generate();

    assert.equal(reopened.calls.length,0);
    assert.match(reopened.errors.at(-1),/ja foi concluido/);
    assert.equal(r.guard.size,0);
  });

  assert.equal(count,9);

  console.log(
    "GENERAL_QUOTE_INTEGRATION: "+count+"/9 PASS"
  );

})();
