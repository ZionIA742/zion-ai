const fs=require("node:fs");
const assert=require("node:assert/strict");
const test=require("node:test");
const ts=require("typescript");

const js=ts.transpileModule(
  fs.readFileSync(require("node:path").join(__dirname,"manual-quote-send.ts"),"utf8"),
  {compilerOptions:{
    module:ts.ModuleKind.CommonJS,
    target:ts.ScriptTarget.ES2022
  }}
).outputText;

const mod={exports:{}};
new Function("module","exports",js)(mod,mod.exports);

const {submitManualQuoteSend}=mod.exports;

const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");

function setup(options={}){

  const records=new Map();
  const calls=[];
  let counter=10;

  const args={
    scope:{organizationId:id(1),storeId:id(2),userId:id(3)},
    quoteId:id(4),
    quoteVersionId:id(5),
    recipient:{kind:"lead",leadId:id(6)},
    storage:{
      getItem:key=>records.get(key)??null,
      setItem:(key,value)=>records.set(key,value)
    },
    createUuid:()=>id(counter++),
    assertScope:async()=>true,
    withLock:async(_key,work)=>work(),
    fetcher:async(url,request)=>{

      const body=JSON.parse(request.body);

      calls.push({url,body});

      if(options.networkError) throw new Error("NETWORK");

      const status=options.status??"accepted";

      return Response.json({
        ok:status==="accepted",
        operationId:body.operationId,
        quoteId:id(4),
        quoteVersionId:body.quoteVersionId,
        status,
        providerAccepted:status==="accepted",
        ...options.result
      },{
        status:status==="accepted"?200:
          ["registered","attempt_started"].includes(status)?202:409
      });
    }
  };

  return {args,calls,records,run:overrides=>
    submitManualQuoteSend({...args,...overrides})};
}

for(const recipient of [
  {kind:"lead",leadId:id(6)},
  {kind:"phone",phone:"(11) 99999-9999"},
  {kind:"responsible"}
]){
  test("recipient "+recipient.kind,async()=>{

    const h=setup();
    const result=await h.run({recipient});

    assert.equal(result.status,"accepted");
    assert.equal(h.calls.length,1);
    assert.equal(h.calls[0].body.recipient.kind,recipient.kind);
    assert.equal(h.calls[0].body.quoteVersionId,id(5));

    if(recipient.kind==="phone"){
      assert.equal(h.calls[0].body.recipient.phone,"+5511999999999");
    }
  });
}

test("network failure preserves operation identity",async()=>{

  const options={networkError:true};
  const h=setup(options);

  const first=await h.run();
  assert.equal(first.status,"unconfirmed");

  options.networkError=false;

  const second=await h.run();
  assert.equal(second.operationId,first.operationId);
  assert.equal(second.status,"accepted");
  assert.equal(h.calls.length,2);
});

test("foreign response never confirms acceptance",async()=>{
  const h=setup({result:{quoteId:id(99)}});
  assert.equal((await h.run()).status,"unconfirmed");
});

test("storage failure prevents send",async()=>{
  const h=setup();
  await assert.rejects(h.run({
    storage:{getItem:()=>null,setItem:()=>{throw Error("STORAGE");}}
  }));
  assert.equal(h.calls.length,0);
});

test("invalid session prevents send",async()=>{
  const h=setup();
  await assert.rejects(h.run({assertScope:async()=>false}));
  assert.equal(h.calls.length,0);
});

test("explicit new intent requires terminal operation",async()=>{
  const h=setup();
  const first=await h.run();

  const replay=await h.run();
  assert.equal(replay.operationId,first.operationId);

  const next=await h.run({replaceOperationId:first.operationId});
  assert.notEqual(next.operationId,first.operationId);

  await assert.rejects(h.run({replaceOperationId:first.operationId}));
  assert.equal(h.calls.length,3);
});

test("uncertain operation cannot be replaced",async()=>{
  const h=setup({status:"uncertain"});
  const first=await h.run();

  await assert.rejects(h.run({replaceOperationId:first.operationId}));
  assert.equal(h.calls.length,1);
});

test("unavailable lock prevents request",async()=>{
  const h=setup();
  await assert.rejects(h.run({
    withLock:async()=>{throw Error("BUSY");}
  }));
  assert.equal(h.calls.length,0);
});

test("invalid phone prevents request",async()=>{
  const h=setup();
  await assert.rejects(h.run({recipient:{kind:"phone",phone:"123"}}));
  assert.equal(h.calls.length,0);
});

test("processing is not acceptance",async()=>{
  const h=setup({status:"attempt_started"});
  const first=await h.run();

  assert.equal(first.providerAccepted,false);
  assert.equal(first.status,"attempt_started");
  assert.equal((await h.run()).operationId,first.operationId);
});

test("scope identities isolate local operation keys",async()=>{
  const h=setup();

  const first=await h.run();
  const second=await h.run({
    scope:{...h.args.scope,userId:id(9)}
  });

  assert.notEqual(first.operationId,second.operationId);
  assert.equal(h.records.size,2);
});
