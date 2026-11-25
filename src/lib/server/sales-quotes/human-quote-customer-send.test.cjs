const fs=require("node:fs");
const assert=require("node:assert/strict");
const ts=require("typescript");

const root="src/lib/server/sales-quotes";

function load(source,resolver=require){

  const compiled=ts.transpileModule(source,{
    compilerOptions:{
      module:ts.ModuleKind.CommonJS,
      target:ts.ScriptTarget.ES2022,
      strict:true
    }
  });

  const m={exports:{}};

  new Function(
    "require","module","exports",
    compiled.outputText
  )(resolver,m,m.exports);

  return m.exports;
}

async function run(source){

  function read(name){
    return fs.readFileSync(root+"/"+name+".ts","utf8");
  }

  const contract=load(read("human-quote-send-contract"));

  const transport=load(read("human-quote-send-transport"));

  const attempt=load(
    read("human-quote-send-attempt"),
    name=>{
      if(name==="./human-quote-send-contract")return contract;
      throw new Error("UNEXPECTED_IMPORT: "+name);
    }
  );

  const id=n=>"10000000-0000-4000-8000-"+
    String(n).padStart(12,"0");

  const phone="+5511999991234";
  const token=id(9);

  let count=0;

  function fixture(kind="phone"){

    const calls=[];

    const request={
      operationId:id(5),
      quoteVersionId:id(6),
      recipient:kind==="phone"
        ? {kind,phone}
        : kind==="lead"
          ? {kind,leadId:id(8)}
          : {kind}
    };

    const state={
      status:"registered",
      decision:{
        allowed:true,
        reason:"CUSTOMER_WINDOW_OPEN"
      },
      policyError:null,
      sendOutcome:{
        outcome:"accepted",
        externalMessageId:"synthetic-provider-id"
      },
      expires:false,
      quoteStatus:"pending_review",
      mismatch:false
    };

    const scope={
      organizationId:id(1),
      storeId:id(2),
      actorUserId:id(3),
      quoteId:id(4)
    };

    const supabase={
      async rpc(name,p){

        if(name==="read_human_quote_customer_send_policy_by_system"){

          calls.push(["policy",p]);

          return {
            data:state.decision,
            error:state.policyError
          };
        }

        assert.equal(
          name,"transition_human_quote_send_by_system"
        );

        calls.push(["transition",p]);

        let outcome="transitioned";
        let attemptToken=null;
        let newAttempt=false;

        if(p.p_action==="start"){

          if(state.status==="registered"){
            state.status="attempt_started";
            outcome="attempt_created";
            attemptToken=token;
            newAttempt=true;
          }else{
            outcome="existing_state";
          }

        }else if(p.p_action==="block"){

          state.status="blocked";

        }else{

          assert.equal(p.p_attempt_token,token);

          state.status={
            accept:"accepted",
            fail:"failed",
            uncertain:"uncertain"
          }[p.p_action];
        }

        return {
          error:null,
          data:{
            operation_id:request.operationId,
            status:state.status,
            outcome,
            attempt_token:attemptToken,
            new_attempt:newAttempt
          }
        };
      }
    };

    const module=load(source,name=>{

      if(name==="./human-quote-send-contract")return contract;

      if(name==="./human-quote-send-attempt")return attempt;

      if(name==="./human-quote-send-transport")return transport;

      if(name==="./human-quote-send-registration")return {
        async registerHumanQuoteSendInternal(args){

          calls.push(["register",args]);

          return {
            registration:{
              operationId:request.operationId,
              quoteId:scope.quoteId,
              quoteVersionId:request.quoteVersionId,
              status:state.status,
              statusReason:state.status==="blocked"
                ? "CUSTOMER_TEMPLATE_REQUIRED"
                : null
            },
            scope,
            request,
            recipient:{
              kind,
              leadId:kind==="lead"
                ? state.mismatch?id(99):id(8)
                : null,
              candidatePhone:state.mismatch
                ? "+5511999991235"
                : phone
            },
            quote:{status:state.quoteStatus},
            version:{},
            pdf:{storeFileId:id(7)},
            pdfInput:{},
            supabase
          };
        }
      };

      if(name==="./quote-expiration")return {

        assertSalesQuoteVersionNotExpired(){

          calls.push(["expiry"]);

          if(state.expires){
            throw new Error("QUOTE_VERSION_EXPIRED");
          }
        }
      };

      if(name==="./human-quote-customer-transport")return {

        async prepareHumanQuoteCustomerTransport(args){

          calls.push(["prepare",args.destinationPhone]);

          return {
            phoneNumberId:"123456789",

            async send(){

              calls.push(["send"]);

              return state.sendOutcome;
            }
          };
        }
      };

      throw new Error("UNEXPECTED_IMPORT: "+name);
    });

    return {
      state,calls,request,
      execute:()=>module.executeHumanQuoteCustomerSend({
        quoteId:scope.quoteId,
        body:request
      })
    };
  }

  async function check(name,fn){
    await fn();
    count++;
    console.log("ok - "+name);
  }

  for(const kind of ["lead","phone"]){

    await check("complete customer send: "+kind,async()=>{

      const x=fixture(kind);
      const result=await x.execute();

      assert.equal(result.status,"accepted");

      assert.deepEqual(
        x.calls.map(c=>c[0]),
        [
          "register","expiry","prepare",
          "policy","transition","send","transition"
        ]
      );

      const policy=x.calls[3][1];

      assert.equal(policy.p_destination_phone,phone);
      assert.equal(policy.p_phone_number_id,"123456789");

      assert.equal(
        policy.p_lead_id,
        kind==="lead"?id(8):null
      );

      assert.equal(x.calls[4][1].p_action,"start");
      assert.equal(x.calls[6][1].p_action,"accept");

      assert.deepEqual(
        Object.keys(result).sort(),
        [
          "operationId",
          "quoteId",
          "quoteVersionId",
          "status",
          "reason",
          "providerRequestAttempted"
        ].sort()
      );
    });
  }

  for(const reason of [
    "CUSTOMER_TEMPLATE_REQUIRED",
    "CUSTOMER_OPTED_OUT",
    "CUSTOMER_DESTINATION_CHANGED",
    "CUSTOMER_INTEGRATION_INVALID"
  ]){

    await check("channel policy blocks: "+reason,async()=>{

      const x=fixture();

      x.state.decision={allowed:false,reason};

      const result=await x.execute();

      assert.equal(result.status,"blocked");
      assert.equal(result.reason,reason);
      assert.equal(result.providerRequestAttempted,false);

      assert.equal(
        x.calls.some(c=>c[0]==="send"),false
      );

      assert.equal(
        x.calls.at(-1)[1].p_action,"block"
      );
    });
  }

  await check("policy lookup failure cannot send",async()=>{

    const x=fixture();

    x.state.policyError={message:"synthetic"};

    const result=await x.execute();

    assert.equal(result.status,"unconfirmed");

    assert.equal(
      x.calls.some(c=>c[0]==="send"),false
    );
  });

  await check("malformed policy cannot send",async()=>{

    const x=fixture();

    x.state.decision={allowed:true,reason:"unexpected"};

    assert.equal(
      (await x.execute()).status,"unconfirmed"
    );

    assert.equal(
      x.calls.some(c=>c[0]==="send"),false
    );
  });

  await check("expired version cannot send",async()=>{

    const x=fixture();

    x.state.expires=true;

    await assert.rejects(x.execute);

    assert.equal(
      x.calls.some(c=>c[0]==="prepare"),false
    );
  });

  await check("cancelled quote cannot send",async()=>{

    const x=fixture();

    x.state.quoteStatus="cancelled";

    await assert.rejects(x.execute);

    assert.equal(
      x.calls.some(c=>c[0]==="prepare"),false
    );
  });

  await check("missing quote status cannot send",async()=>{

    const x=fixture();

    x.state.quoteStatus=null;

    await assert.rejects(
      x.execute,
      {message:"HUMAN_QUOTE_CUSTOMER_QUOTE_UNAVAILABLE"}
    );

    assert.equal(
      x.calls.some(c=>c[0]==="prepare"),false
    );

    assert.equal(
      x.calls.some(c=>c[0]==="transition"),false
    );

    assert.equal(
      x.calls.some(c=>c[0]==="send"),false
    );
  });

  await check("responsible is not a customer send",async()=>{

    const x=fixture("responsible");

    await assert.rejects(x.execute);

    assert.deepEqual(x.calls,[]);
  });

  await check("recipient substitution cannot send",async()=>{

    const x=fixture("lead");

    x.state.mismatch=true;

    await assert.rejects(x.execute);

    assert.equal(
      x.calls.some(c=>c[0]==="prepare"),false
    );
  });

  await check("accepted replay does not repeat transport",async()=>{

    const x=fixture();

    await x.execute();

    const result=await x.execute();

    assert.equal(result.status,"accepted");
    assert.equal(result.providerRequestAttempted,false);

    assert.equal(
      x.calls.filter(c=>c[0]==="send").length,1
    );
  });

  await check("uncertain replay does not repeat transport",async()=>{

    const x=fixture();

    x.state.sendOutcome={outcome:"uncertain"};

    assert.equal(
      (await x.execute()).status,"uncertain"
    );

    assert.equal(
      (await x.execute()).status,"uncertain"
    );

    assert.equal(
      x.calls.filter(c=>c[0]==="send").length,1
    );
  });

  assert.equal(count,15);

  console.log("HUMAN_QUOTE_CUSTOMER_SEND: 15/15 PASS");
}

module.exports=run;

if(require.main===module){

  run(fs.readFileSync(
    root+"/human-quote-customer-send.ts","utf8"
  )).catch(error=>{
    console.error(error);
    process.exitCode=1;
  });
}
