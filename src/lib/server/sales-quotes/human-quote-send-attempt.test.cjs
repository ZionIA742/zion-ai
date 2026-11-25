const fs=require("node:fs");
const assert=require("node:assert/strict");
const ts=require("typescript");

const root="src/lib/server/sales-quotes";

function load(source,resolver=require) {

  const compiled=ts.transpileModule(source,{
    compilerOptions:{
      module:ts.ModuleKind.CommonJS,
      target:ts.ScriptTarget.ES2022,
      strict:true,
    }
  });

  const m={exports:{}};

  new Function(
    "require","module","exports",compiled.outputText
  )(resolver,m,m.exports);

  return m.exports;
}

async function run(source) {

  const contract=load(fs.readFileSync(
    root+"/human-quote-send-contract.ts","utf8"
  ));

  const controller=load(fs.readFileSync(
    root+"/human-quote-send-transport.ts","utf8"
  ));

  const adapter=load(source,name=>{

    if(name==="./human-quote-send-contract")return contract;

    throw new Error("UNEXPECTED_IMPORT: "+name);
  });

  const id=n=>"10000000-0000-4000-8000-"+
    String(n).padStart(12,"0");

  const token=id(8);

  let count=0;

  function fixture() {

    const calls=[];

    const state={
      status:"registered",
      authorization:{allowed:true},
      responsePatch:{},
      rpcError:null,
    };

    const args={
      scope:{
        organizationId:id(1),
        storeId:id(2),
        actorUserId:id(3),
        quoteId:id(4),
      },
      request:{
        operationId:id(5),
        quoteVersionId:id(6),
        recipient:{
          kind:"phone",
          phone:"+5511999991234",
        },
      },
      storeFileId:id(7),
      destinationPhone:"+5511999991234",

      async authorizeStart() {
        calls.push(["authorize"]);
        return state.authorization;
      },

      supabase:{

        async rpc(name,p) {

          calls.push(["rpc",name,p]);

          assert.equal(
            name,"transition_human_quote_send_by_system"
          );

          if(state.rpcError) {
            return {data:null,error:state.rpcError};
          }

          let outcome="transitioned";
          let attemptToken=null;
          let newAttempt=false;

          if(p.p_action==="start") {

            if(state.status==="registered") {
              state.status="attempt_started";
              outcome="attempt_created";
              attemptToken=token;
              newAttempt=true;
            } else {
              outcome="existing_state";
            }

          } else if(p.p_action==="block") {

            state.status="blocked";

          } else {

            assert.equal(p.p_attempt_token,token);

            state.status={
              accept:"accepted",
              fail:"failed",
              uncertain:"uncertain",
            }[p.p_action];
          }

          return {
            error:null,
            data:{
              operation_id:id(5),
              outcome,
              status:state.status,
              new_attempt:newAttempt,
              attempt_token:attemptToken,
              ...state.responsePatch,
            },
          };
        },
      },
    };

    return {
      args,state,calls,
      create:()=>adapter.createHumanQuoteSendAttemptCallbacks(args),
    };
  }

  async function check(name,fn) {
    await fn();
    count++;
    console.log("ok - "+name);
  }

  await check("start binds the exact registered identity",async()=>{

    const x=fixture();
    const result=await x.create().begin();

    assert.deepEqual(result,{
      outcome:"attempt_created",
      attemptToken:token,
    });

    const p=x.calls[1][2];

    const identity=contract.buildHumanQuoteSendIdentity(
      x.args.scope,x.args.request
    );

    assert.equal(p.p_organization_id,id(1));
    assert.equal(p.p_store_id,id(2));
    assert.equal(p.p_actor_user_id,id(3));
    assert.equal(p.p_quote_id,id(4));
    assert.equal(p.p_operation_id,id(5));
    assert.equal(p.p_quote_version_id,id(6));
    assert.equal(p.p_store_file_id,id(7));
    assert.equal(p.p_destination_phone,"+5511999991234");
    assert.equal(p.p_operation_key,identity.operationKey);
    assert.equal(p.p_request_fingerprint,identity.requestFingerprint);
    assert.equal(p.p_action,"start");
    assert.equal(p.p_attempt_token,null);
  });

  await check("closed channel policy records block instead of start",async()=>{

    const x=fixture();

    x.state.authorization={
      allowed:false,
      reason:"WHATSAPP_WINDOW_CLOSED",
    };

    assert.deepEqual(await x.create().begin(),{
      outcome:"existing_state",
      status:"blocked",
    });

    assert.equal(x.calls[1][2].p_action,"block");
    assert.equal(
      x.calls[1][2].p_reason,"WHATSAPP_WINDOW_CLOSED"
    );
  });

  await check("invalid authorization cannot start",async()=>{

    const x=fixture();
    x.state.authorization={};

    await assert.rejects(()=>x.create().begin());
    assert.deepEqual(x.calls,[["authorize"]]);
  });

  await check("destination substitution is rejected locally",async()=>{

    const x=fixture();
    x.args.destinationPhone="+5511999991235";

    assert.throws(x.create);
    assert.deepEqual(x.calls,[]);
  });

  await check("invalid file identity cannot call RPC",async()=>{

    const x=fixture();
    x.args.storeFileId="invalid";

    assert.throws(x.create);
    assert.deepEqual(x.calls,[]);
  });

  await check("foreign operation response is rejected",async()=>{

    const x=fixture();

    x.state.responsePatch.operation_id=id(99);

    await assert.rejects(()=>x.create().begin());
  });

  await check("invalid claim token is rejected",async()=>{

    const x=fixture();

    x.state.responsePatch.attempt_token="invalid";

    await assert.rejects(()=>x.create().begin());
  });

  await check("RPC errors do not expose private details",async()=>{

    const x=fixture();

    x.state.rpcError={message:"synthetic private details"};

    await assert.rejects(
      ()=>x.create().begin(),
      {message:"HUMAN_QUOTE_ATTEMPT_RPC_FAILED"}
    );
  });

  await check("accepted provider result is finalized by token",async()=>{

    const x=fixture();
    const callbacks=x.create();

    await callbacks.begin();

    assert.deepEqual(await callbacks.finish({
      action:"accept",
      attemptToken:token,
      externalMessageId:"synthetic-accepted",
    }),{status:"accepted"});

    const p=x.calls.at(-1)[2];

    assert.equal(p.p_action,"accept");
    assert.equal(p.p_attempt_token,token);
    assert.equal(p.p_external_message_id,"synthetic-accepted");
    assert.equal(p.p_reason,null);
  });

  await check("uncertain result uses existing transition authority",async()=>{

    const x=fixture();
    const callbacks=x.create();

    await callbacks.begin();

    assert.deepEqual(await callbacks.finish({
      action:"uncertain",
      attemptToken:token,
      reason:"PROVIDER_RESULT_UNCERTAIN",
    }),{status:"uncertain"});
  });

  await check("invalid finalization input never calls RPC",async()=>{

    const x=fixture();

    await assert.rejects(()=>x.create().finish({
      action:"accept",
      attemptToken:token,
      externalMessageId:"",
    }));

    assert.deepEqual(x.calls,[]);
  });

  await check("controller and bridge prevent duplicate provider calls",async()=>{

    const x=fixture();

    let sends=0;

    const dependencies={
      ...x.create(),

      async send() {
        sends++;
        return {
          outcome:"accepted",
          externalMessageId:"synthetic-provider-id",
        };
      },
    };

    const first=await controller.executeHumanQuoteTransport(
      dependencies
    );

    const second=await controller.executeHumanQuoteTransport(
      dependencies
    );

    assert.equal(first.status,"accepted");
    assert.equal(second.status,"accepted");
    assert.equal(second.providerRequestAttempted,false);
    assert.equal(sends,1);
  });

  await check("blocked policy never invokes provider",async()=>{

    const x=fixture();

    x.state.authorization={
      allowed:false,
      reason:"WHATSAPP_WINDOW_CLOSED",
    };

    let sends=0;

    const result=await controller.executeHumanQuoteTransport({
      ...x.create(),

      async send() {
        sends++;
        return {outcome:"uncertain"};
      },
    });

    assert.equal(result.status,"blocked");
    assert.equal(sends,0);
  });

  await check("uncertain send cannot be repeated by controller",async()=>{

    const x=fixture();
    let sends=0;

    const dependencies={
      ...x.create(),

      async send() {
        sends++;
        throw new Error("synthetic connection loss");
      },
    };

    const first=await controller.executeHumanQuoteTransport(
      dependencies
    );

    const second=await controller.executeHumanQuoteTransport(
      dependencies
    );

    assert.equal(first.status,"uncertain");
    assert.equal(second.status,"uncertain");
    assert.equal(sends,1);
  });

  assert.equal(count,14);

  console.log("HUMAN_QUOTE_SEND_ATTEMPT: 14/14 PASS");
}

module.exports=run;

if(require.main===module) {
  run(fs.readFileSync(
    root+"/human-quote-send-attempt.ts","utf8"
  )).catch(error=>{
    console.error(error);
    process.exitCode=1;
  });
}
