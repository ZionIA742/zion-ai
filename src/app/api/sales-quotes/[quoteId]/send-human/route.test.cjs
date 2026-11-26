const fs=require("node:fs");
const path=require("node:path");
const assert=require("node:assert/strict");
const test=require("node:test");
const ts=require("typescript");

function load(file,dependency){
  const source=fs.readFileSync(file,"utf8");
  const js=ts.transpileModule(source,{
    compilerOptions:{
      module:ts.ModuleKind.CommonJS,
      target:ts.ScriptTarget.ES2022
    }
  }).outputText;

  const module={exports:{}};

  new Function("require","module","exports",js)(
    dependency,module,module.exports
  );

  return module.exports;
}

const contract=load(
  path.resolve("src/lib/server/sales-quotes/human-quote-send-contract.ts"),
  name=>{
    assert.equal(name,"node:crypto");
    return require(name);
  }
);

class QuoteAccessError extends Error{
  constructor(status,code){
    super("PRIVATE_ERROR_DETAIL");
    this.status=status;
    this.code=code;
  }
}

class RegistrationError extends Error{
  constructor(status,code){
    super("PRIVATE_REGISTRATION_DETAIL");
    this.status=status;
    this.code=code;
  }
}

class PdfError extends Error{}
class RecipientError extends Error{}
class ProvenanceError extends Error{}

const forbidden=async()=>{
  throw new Error("UNEXPECTED_REAL_SERVICE");
};

const route=load(
  path.join(__dirname,"route-handler.ts"),
  name=>{
    if(name==="next/server"){
      return {NextResponse:Response};
    }

    if(name.endsWith("/zion-admin-diagnostic-backend-next")){
      return {withBackendDiagnosticRoute:(_p,_m,h)=>h};
    }

    if(name.endsWith("/human-quote-send-registration")){
      return {HumanQuoteSendRegistrationError:RegistrationError};
    }

    if(name.endsWith("/human-quote-send-pdf")){
      return {HumanQuoteSendPdfError:PdfError};
    }

    if(name.endsWith("/human-quote-send-recipient")){
      return {HumanQuoteSendRecipientError:RecipientError};
    }

    if(name.endsWith("/human-quote-edit-provenance")){
      return {HumanQuoteEditProvenanceError:ProvenanceError};
    }

    if(name.endsWith("/quote-auth")){
      return {QuoteAccessError};
    }

    if(name.endsWith("/human-quote-send-contract")){
      return contract;
    }

    if(name.endsWith("/human-quote-customer-send")){
      return {executeHumanQuoteCustomerSend:forbidden};
    }

    if(name.endsWith("/human-quote-responsible-send")){
      return {executeHumanQuoteResponsibleSend:forbidden};
    }

    throw new Error("UNEXPECTED_IMPORT: "+name);
  }
);

const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const quoteId=id(1);
const versionId=id(2);
const operationId=id(3);

const recipients=[
  {kind:"lead",leadId:id(4)},
  {kind:"phone",phone:"11999999999"},
  {kind:"responsible"}
];

function setup(options={}){

  const calls=[];

  function service(kind){
    return async args=>{

      calls.push([kind,args]);

      if(options.error) throw options.error;

      return {
        quoteId:args.quoteId,
        quoteVersionId:args.body.quoteVersionId,
        operationId:args.body.operationId,
        status:"accepted",
        providerRequestAttempted:true,
        inboxReconciliation:"unchanged",
        ...(kind==="customer"
          ? {crmProjection:"not_applicable",historyProjection:"not_applicable"}
          : {}),
        ...options.result
      };
    };
  }

  const handler=route.createHumanQuoteSendPostHandler({
    customer:service("customer"),
    responsible:service("responsible")
  });

  async function run(recipient,overrides={},routeId=quoteId,raw){

    const response=await handler(
      new Request("https://zion.invalid/send-human",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:raw ?? JSON.stringify({
          operationId,
          quoteVersionId:versionId,
          recipient,
          ...overrides
        })
      }),
      {params:Promise.resolve({quoteId:routeId})}
    );

    return {
      http:response.status,
      body:await response.json(),
      cache:response.headers.get("Cache-Control")
    };
  }

  return {calls,run};
}

for(const recipient of recipients){

  test("routes "+recipient.kind+" to correct service",async()=>{

    const h=setup();
    const result=await h.run(recipient);

    assert.equal(result.http,200);
    assert.equal(result.body.ok,true);
    assert.equal(result.body.providerAccepted,true);
    assert.equal(result.cache,"no-store");

    assert.equal(h.calls.length,1);

    assert.equal(
      h.calls[0][0],
      recipient.kind==="responsible"?"responsible":"customer"
    );

    assert.deepEqual(
      h.calls[0][1].body,
      contract.parseHumanQuoteSendRequest({
        operationId,quoteVersionId:versionId,recipient
      })
    );
  });
}

for(const status of [
  "registered","attempt_started","blocked",
  "failed","uncertain","unconfirmed"
]){

  test(status+" is never reported as accepted",async()=>{

    const h=setup({result:{status}});
    const result=await h.run(recipients[0]);

    assert.equal(result.body.ok,false);
    assert.equal(result.body.providerAccepted,false);
    assert.equal(result.body.status,status);

    assert.equal(
      result.http,
      ["registered","attempt_started"].includes(status)?202:409
    );

    assert.equal(h.calls.length,1);
  });
}

test("accepted replay does not invent provider request",async()=>{

  const h=setup({result:{providerRequestAttempted:false}});
  const result=await h.run(recipients[0]);

  assert.equal(result.body.providerRequestAttempted,false);
  assert.equal(result.body.operationId,operationId);
});

test("invalid quote id never reaches service",async()=>{

  const h=setup();
  assert.equal((await h.run(recipients[0],{},"invalid")).http,400);
  assert.equal(h.calls.length,0);
});

test("invalid JSON never reaches service",async()=>{

  const h=setup();
  assert.equal((await h.run(recipients[0],{},quoteId,"{")).http,400);
  assert.equal(h.calls.length,0);
});

test("caller cannot supply tenant authority",async()=>{

  const h=setup();

  assert.equal(
    (await h.run(recipients[0],{organizationId:id(5)})).http,
    400
  );

  assert.equal(h.calls.length,0);
});

test("responsible destination cannot be overridden",async()=>{

  const h=setup();

  assert.equal(
    (await h.run({kind:"responsible",phone:"11999999999"})).http,
    400
  );

  assert.equal(h.calls.length,0);
});

test("foreign returned operation is rejected",async()=>{

  const h=setup({result:{operationId:id(9)}});
  const result=await h.run(recipients[0]);

  assert.equal(result.http,500);
  assert.equal(result.body.ok,false);
  assert.equal(result.body.operationId,operationId);
});

test("authorization errors are sanitized",async()=>{

  const h=setup({
    error:new QuoteAccessError(403,"QUOTE_FORBIDDEN")
  });

  const result=await h.run(recipients[0]);

  assert.equal(result.http,403);
  assert.ok(!JSON.stringify(result.body).includes("PRIVATE_ERROR_DETAIL"));
});

test("unexpected error never retries or leaks details",async()=>{

  const h=setup({error:new Error("PRIVATE_PROVIDER_TOKEN")});
  const result=await h.run(recipients[0]);

  assert.equal(result.http,500);
  assert.equal(result.body.operationId,operationId);
  assert.ok(!JSON.stringify(result.body).includes("PRIVATE_PROVIDER_TOKEN"));
  assert.equal(h.calls.length,1);
});

test("pending recovery does not invalidate acceptance",async()=>{

  const h=setup({
    result:{
      crmProjection:"pending",
      historyProjection:"pending",
      inboxReconciliation:"pending"
    }
  });

  const result=await h.run(recipients[0]);

  assert.equal(result.http,200);
  assert.equal(result.body.providerAccepted,true);
  assert.equal(result.body.historyProjection,"pending");
  assert.equal(result.body.inboxReconciliation,"pending");
});

test("responsible response does not create commercial projection",async()=>{

  const h=setup();
  const result=await h.run(recipients[2]);

  assert.equal(Object.hasOwn(result.body,"crmProjection"),false);
  assert.equal(Object.hasOwn(result.body,"historyProjection"),false);
});

for(const [error,http,code] of [
  [
    new RegistrationError(409,"HUMAN_QUOTE_SEND_VERSION_STALE"),
    409,"HUMAN_QUOTE_SEND_VERSION_STALE"
  ],
  [
    new PdfError("PRIVATE_STORAGE_PATH"),
    409,"HUMAN_QUOTE_SEND_PDF_INVALID"
  ],
  [
    new RecipientError("PRIVATE_RECIPIENT"),
    409,"HUMAN_QUOTE_SEND_RECIPIENT_INVALID"
  ],
  [
    new ProvenanceError("PRIVATE_PROVENANCE"),
    403,"HUMAN_QUOTE_EDIT_PROVENANCE_REQUIRED"
  ],
  [
    new RegistrationError(503,"PRIVATE_REGISTRATION_CODE"),
    503,"HUMAN_QUOTE_SEND_REGISTRATION_UNAVAILABLE"
  ]
]){

  test("safe typed error: "+code,async()=>{

    const h=setup({error});
    const result=await h.run(recipients[0]);

    assert.equal(result.http,http);
    assert.equal(result.body.error,code);
    assert.equal(result.body.operationId,operationId);
    assert.equal(result.body.ok,false);
    assert.ok(!JSON.stringify(result.body).includes("PRIVATE_"));
    assert.equal(h.calls.length,1);
  });
}

for(const reason of [
  "CUSTOMER_TEMPLATE_REQUIRED",
  "CUSTOMER_OPTED_OUT",
  "CUSTOMER_DESTINATION_CHANGED",
  "CUSTOMER_INTEGRATION_INVALID"
]){

  test("public blocked reason: "+reason,async()=>{

    const h=setup({result:{
      status:"blocked",reason,
      providerRequestAttempted:false
    }});

    const result=await h.run(recipients[0]);

    assert.equal(result.http,409);
    assert.equal(result.body.reason,reason);
    assert.equal(result.body.providerAccepted,false);
    assert.ok(result.body.message.length>0);
  });
}

test("unknown blocked reason is sanitized",async()=>{

  const h=setup({result:{
    status:"blocked",
    reason:"PRIVATE_PROVIDER_RESPONSE"
  }});

  const result=await h.run(recipients[2]);

  assert.equal(result.body.reason,"HUMAN_QUOTE_SEND_BLOCKED");
  assert.ok(!JSON.stringify(result.body).includes("PRIVATE_"));
});

test("uncertain result does not expose raw provider reason",async()=>{

  const h=setup({result:{
    status:"uncertain",
    reason:"PRIVATE_PROVIDER_RESPONSE"
  }});

  const result=await h.run(recipients[0]);

  assert.equal(result.http,409);
  assert.equal(result.body.reason,null);
  assert.equal(result.body.providerAccepted,false);
  assert.equal(result.body.operationId,operationId);
  assert.ok(!JSON.stringify(result.body).includes("PRIVATE_"));
});
