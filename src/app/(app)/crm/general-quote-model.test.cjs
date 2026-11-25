const fs=require("node:fs");
const path=require("node:path");
const ts=require("typescript");
const assert=require("node:assert/strict");

function load(file,resolver) {
  const js=ts.transpileModule(
    fs.readFileSync(file,"utf8"),
    {
      compilerOptions:{
        target:ts.ScriptTarget.ES2022,
        module:ts.ModuleKind.CommonJS
      }
    }
  ).outputText;

  const m={exports:{}};

  new Function("require","module","exports",js)(
    resolver,m,m.exports
  );

  return m.exports;
}

const quoteModel=load(
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

    if(name==="./quote-editor-model")
      return quoteModel;

    throw Error("Unexpected import: "+name);
  }
);

const general=load(
  path.join(__dirname,"general-quote-model.ts"),
  name=>{
    if(name.endsWith("/quote-create-operation"))
      return operation;

    if(name==="./quote-editor-model")
      return quoteModel;

    if(name==="./manual-quote-pdf")
      return pdf;

    throw Error("Unexpected import: "+name);
  }
);

const scope={
  organizationId:"org-a",
  storeId:"store-a",
  userId:"user-a"
};

function validDraft() {
  const draft=general.createGeneralQuoteDraft();

  draft.quoteTitle="Piscina";

  draft.quoteItems[0]={
    ...draft.quoteItems[0],
    name:"Piscina",
    quantity:"2",
    unitPriceReais:"150,50",
    discountReais:"10,00"
  };

  return draft;
}

let count=0;

function test(name,fn) {
  fn();
  count++;
  console.log("ok - "+name);
}

test("general editor starts without a lead",()=>{
  const draft=general.createGeneralQuoteDraft();

  assert.equal(draft.customerName,"");
  assert.equal(draft.customerPhone,"");
  assert.equal(draft.quoteItems.length,1);

  assert.equal(
    general.calculateGeneralQuoteValidation(draft,false)
      .canGenerateQuotePdf,
    false
  );
});

test("canonical money calculation and validation",()=>{
  const result=
    general.calculateGeneralQuoteValidation(validDraft(),false);

  assert.equal(result.quoteSubtotalReais,301);
  assert.equal(result.quoteDiscountTotalReais,10);
  assert.equal(result.quoteGlobalDiscountReais,0);
  assert.equal(result.quoteTotalReais,291);
  assert.equal(result.canGenerateQuotePdf,true);
});

test("unavailable services fail closed",()=>{
  const draft=validDraft();

  draft.quoteItems[0].itemType="service";

  assert.equal(
    general.calculateGeneralQuoteValidation(draft,false)
      .canGenerateQuotePdf,
    false
  );

  assert.equal(
    general.calculateGeneralQuoteValidation(draft,true)
      .canGenerateQuotePdf,
    true
  );
});

test("invalid titles and missing items remain blocked",()=>{
  const a=validDraft();
  a.quoteTitle="";

  const b=validDraft();
  b.quoteItems=[];

  const c=validDraft();
  c.quoteItems[0].name="";

  for(const draft of [a,b,c]) {
    assert.equal(
      general.calculateGeneralQuoteValidation(draft,true)
        .canGenerateQuotePdf,
      false
    );
  }
});

test("unlinked submission contains no invented context",()=>{
  const draft=validDraft();

  const result=
    general.buildGeneralQuoteSubmission(scope,draft);

  assert.equal(result.payload.organizationId,"org-a");
  assert.equal(result.payload.storeId,"store-a");
  assert.equal(result.payload.leadId,null);
  assert.equal(result.payload.conversationId,null);
  assert.equal(result.payload.commercialOpportunityId,null);
  assert.equal(result.payload.customer_name,null);
  assert.equal(result.payload.customer_phone,null);

  draft.customerName=" Cliente ";
  draft.customerPhone=" 123 ";

  const manual=
    general.buildGeneralQuoteSubmission(scope,draft);

  assert.equal(manual.payload.customer_name,"Cliente");
  assert.equal(manual.payload.customer_phone,"123");
  assert.equal(manual.payload.leadId,null);
});

test("draft and operation keys isolate user and store",()=>{
  const draft=validDraft();

  const scopes=[
    scope,
    {...scope,storeId:"store-b"},
    {...scope,userId:"user-b"},
    {...scope,organizationId:"org-b"}
  ];

  assert.equal(
    new Set(scopes.map(general.buildGeneralQuoteDraftKey)).size,
    4
  );

  assert.equal(
    new Set(scopes.map(s=>
      general.buildGeneralQuoteSubmission(s,draft)
        .pendingOperationStorageKey
    )).size,
    4
  );

  assert.throws(
    ()=>general.buildGeneralQuoteSubmission(
      {...scope,storeId:""},
      draft
    ),
    /Escopo/
  );
});

test("draft restoration keeps only expected fields",()=>{
  const draft=validDraft();

  assert.deepEqual(
    general.restoreGeneralQuoteDraft(
      JSON.stringify({...draft,leadId:"unexpected"})
    ),
    draft
  );

  const corrupted=general.restoreGeneralQuoteDraft(
    "{invalid"
  );

  assert.equal(corrupted.quoteTitle,"");
  assert.equal(corrupted.quoteItems.length,1);

  assert.equal(
    general.restoreGeneralQuoteDraft(
      JSON.stringify({...draft,quoteItems:[]})
    ).quoteTitle,
    ""
  );
});

test("main CRM mounts the same editor in selected store",()=>{
  const main=fs.readFileSync(
    path.join(__dirname,"page.tsx"),"utf8"
  );

  const component=fs.readFileSync(
    path.join(__dirname,"GeneralQuoteEditor.tsx"),"utf8"
  );

  const reload=main.indexOf('title="Recarregar CRM"');
  const quote=main.indexOf(
    "onClick={() => setQuoteEditorScope(crmScopeKey)}"
  );
  const lead=main.indexOf("onClick={openManualLeadModal}");

  assert.ok(reload>=0 && reload<quote && quote<lead);

  assert.match(main,/quoteEditorScope === crmScopeKey/);
  assert.match(main,/<GeneralQuoteEditor/);
  assert.match(main,/storeId=\{activeStoreId\}/);

  assert.match(component,/<QuoteEditorModal/);
  assert.match(component,/submitManualQuotePdf\(/);

  assert.match(
    component,
    /read_store_operation_execution_policies_scoped/
  );

  assert.ok(!component.includes("/api/crm/leads/manual"));
  assert.ok(!component.includes("/send"));
  assert.ok(!component.includes("/approve"));
});

const selectedLead={
  id:"11111111-1111-4111-8111-111111111111",
  name:"Cliente Teste",
  phone:"11900000000",
  organizationId:scope.organizationId,
  storeId:scope.storeId
};

test("explicit link fills only the selected lead context",()=>{
  const draft=validDraft();

  draft.customerName="Manual";
  draft.customerPhone="123";

  const linked=general.setGeneralQuoteLead(
    scope,draft,selectedLead
  );

  const submission=general.buildGeneralQuoteSubmission(
    scope,linked
  );

  assert.equal(submission.payload.leadId,selectedLead.id);
  assert.equal(submission.payload.customer_name,selectedLead.name);
  assert.equal(submission.payload.customer_phone,selectedLead.phone);
  assert.equal(submission.payload.conversationId,null);
  assert.equal(submission.payload.commercialOpportunityId,null);

  assert.equal(linked.customerName,"");
  assert.equal(linked.customerPhone,"");
});

test("unlink clears customer details and all commercial IDs",()=>{
  const linked=general.setGeneralQuoteLead(
    scope,validDraft(),selectedLead
  );

  const unlinked=general.setGeneralQuoteLead(
    scope,linked,null
  );

  const payload=general.buildGeneralQuoteSubmission(
    scope,unlinked
  ).payload;

  for(const field of [
    "leadId","conversationId","commercialOpportunityId",
    "customer_name","customer_phone"
  ]) {
    assert.equal(payload[field],null);
  }

  assert.deepEqual(unlinked.quoteItems,linked.quoteItems);
  assert.equal(unlinked.quoteTitle,linked.quoteTitle);
});

test("foreign store and organization links fail closed",()=>{
  for(const invalid of [
    {...selectedLead,storeId:"store-b"},
    {...selectedLead,organizationId:"org-b"}
  ]) {
    assert.throws(
      ()=>general.setGeneralQuoteLead(
        scope,validDraft(),invalid
      ),
      /escopo/
    );

    assert.throws(
      ()=>general.buildGeneralQuoteSubmission(
        scope,{...validDraft(),linkedLead:invalid}
      ),
      /escopo/
    );
  }
});

test("linked draft restores without invented commercial context",()=>{
  const linked=general.setGeneralQuoteLead(
    scope,validDraft(),selectedLead
  );

  const restored=general.restoreGeneralQuoteDraft(
    JSON.stringify(linked)
  );

  assert.deepEqual(restored,linked);

  const legacy={...validDraft()};

  delete legacy.linkedLead;

  assert.equal(
    general.restoreGeneralQuoteDraft(
      JSON.stringify(legacy)
    ).linkedLead,
    null
  );
});

assert.equal(count,12);

console.log("GENERAL_QUOTE_EDITOR: "+count+"/12 PASS");

(async()=>{

  let asyncCount=0;

  async function checkAsync(name,fn) {
    await fn();
    asyncCount++;
    console.log("ok - "+name);
  }

  function response(overrides={}) {
    return Response.json({
      ok:true,
      organizationId:scope.organizationId,
      storeId:scope.storeId,
      leads:[{
        id:selectedLead.id,
        name:selectedLead.name,
        phone:selectedLead.phone
      }],
      hasMore:false,
      nextOffset:null,
      ...overrides
    });
  }

  globalThis.fetch=()=>{
    throw Error("REAL_NETWORK_FORBIDDEN");
  };

  await checkAsync("lead search uses only scoped POST",async()=>{
    let called=0;

    const page=await general.loadGeneralQuoteLeadPage(
      scope,
      {search:"Cliente",offset:0},
      async(url,init)=>{
        called++;

        assert.equal(url,"/api/sales-quotes/lead-picker");
        assert.equal(init.method,"POST");
        assert.equal(init.cache,"no-store");

        assert.deepEqual(JSON.parse(init.body),{
          organizationId:scope.organizationId,
          storeId:scope.storeId,
          search:"Cliente",
          offset:0
        });

        return response();
      }
    );

    assert.equal(called,1);
    assert.deepEqual(page.leads,[selectedLead]);
  });

  await checkAsync("foreign response scope is rejected",async()=>{
    await assert.rejects(
      general.loadGeneralQuoteLeadPage(
        scope,{},
        async()=>response({storeId:"store-b"})
      )
    );
  });

  await checkAsync("selected lead is revalidated by exact ID",async()=>{
    const current=await general.revalidateGeneralQuoteLead(
      scope,selectedLead,
      async(_url,init)=>{
        assert.equal(
          JSON.parse(init.body).leadId,
          selectedLead.id
        );

        return response();
      }
    );

    assert.deepEqual(current,selectedLead);
  });

  await checkAsync("deleted or changed lead requires reselection",async()=>{
    for(const leads of [
      [],
      [{
        id:selectedLead.id,
        name:"Outro nome",
        phone:selectedLead.phone
      }]
    ]) {
      await assert.rejects(
        general.revalidateGeneralQuoteLead(
          scope,selectedLead,
          async()=>response({leads})
        ),
        /Selecione-o novamente/
      );
    }
  });

  await checkAsync("main editor retains shared modal and catalog",async()=>{
    const editor=fs.readFileSync(
      path.join(__dirname,"GeneralQuoteEditor.tsx"),"utf8"
    );

    const modal=fs.readFileSync(
      path.join(__dirname,"QuoteEditorModal.tsx"),"utf8"
    );

    const picker=fs.readFileSync(
      path.join(__dirname,"GeneralQuoteLeadPicker.tsx"),"utf8"
    );

    assert.match(editor,/<QuoteEditorModal/);
    assert.match(editor,/<GeneralQuoteLeadPicker/);
    assert.match(editor,/revalidateGeneralQuoteLead\(/);
    assert.match(editor,/changeLinkedLead\(null\)/);
    assert.match(modal,/<QuoteCatalogPrefillPicker/);
    assert.match(picker,/controller\.abort\(\)/);
    assert.match(picker,/result\?\.request === request/);

    assert.ok(!editor.includes("/send"));
    assert.ok(!editor.includes("/approve"));
  });

  assert.equal(asyncCount,5);

  console.log(
    "GENERAL_QUOTE_LEAD_READER: "+asyncCount+"/5 PASS"
  );

})().catch(error=>{
  console.error(error.stack);
  process.exitCode=1;
});
