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

      projection:{
        outcome:"moved",
        reason:"HUMAN_QUOTE_SEND_ACCEPTED",
        previous_stage:"novo_lead",
        stage:"orcamento"
      },

      projectionError:null,
      projectionThrows:false,

      binding:{
        outcome:"bound",
        reason:"PROVEN_WHATSAPP_CONVERSATION",
        phone_number_id:"123456789",
        conversation_id:id(10),
        inbound_message_id:id(11)
      },

      bindingError:null,
      bindingThrows:false,

      history:{
        outcome:"recorded",
        reason:"ACCEPTED_DOCUMENT_RECORDED",
        message_id:id(12),
        conversation_id:id(10)
      },

      historyError:null,
      historyThrows:false,

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

        if(name==="bind_human_quote_send_history_by_system"){

          calls.push(["binding",p]);

          assert.equal(kind,"lead");
          assert.equal(state.status,"registered");

          assert.deepEqual(p,{
            p_organization_id:scope.organizationId,
            p_store_id:scope.storeId,
            p_actor_user_id:scope.actorUserId,
            p_operation_id:request.operationId,
            p_phone_number_id:"123456789"
          });

          if(state.bindingThrows){
            throw new Error("synthetic binding exception");
          }

          return {
            data:state.binding,
            error:state.bindingError
          };
        }

        if(name==="project_human_quote_send_history_by_system"){

          calls.push(["history",p]);

          assert.equal(kind,"lead");
          assert.equal(state.status,"accepted");

          assert.deepEqual(p,{
            p_organization_id:scope.organizationId,
            p_store_id:scope.storeId,
            p_actor_user_id:scope.actorUserId,
            p_operation_id:request.operationId
          });

          if(state.historyThrows){
            throw new Error("synthetic history exception");
          }

          return {
            data:state.history,
            error:state.historyError
          };
        }

        if(name==="project_human_quote_send_crm_by_system"){

          calls.push(["projection",p]);

          assert.equal(state.status,"accepted");

          assert.deepEqual(p,{
            p_organization_id:scope.organizationId,
            p_store_id:scope.storeId,
            p_actor_user_id:scope.actorUserId,
            p_operation_id:request.operationId
          });

          if(state.projectionThrows){
            throw new Error("synthetic CRM exception");
          }

          return {
            data:state.projection,
            error:state.projectionError
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

          if(state.status!=="registered"){

            return {
              replayOnly:true,
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
              supabase
            };
          }

          return {
            replayOnly:false,
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
          "policy",
          ...(kind==="lead"?["binding"]:[]),
          "transition","send","transition",
          ...(kind==="lead"?["projection","history"]:[])
        ]
      );

      const policy=x.calls[3][1];

      assert.equal(policy.p_destination_phone,phone);
      assert.equal(policy.p_phone_number_id,"123456789");

      assert.equal(
        policy.p_lead_id,
        kind==="lead"?id(8):null
      );

      const transitions=x.calls.filter(
        c=>c[0]==="transition"
      );

      assert.equal(transitions.length,2);
      assert.equal(transitions[0][1].p_action,"start");
      assert.equal(transitions[1][1].p_action,"accept");

      assert.equal(
        result.historyProjection,
        kind==="lead"?"recorded":"not_applicable"
      );

      assert.equal(
        result.crmProjection,
        kind==="lead"?"moved":"not_applicable"
      );

      assert.deepEqual(
        Object.keys(result).sort(),
        [
          "operationId",
          "quoteId",
          "quoteVersionId",
          "status",
          "reason",
          "providerRequestAttempted",
          "crmProjection",
          "historyProjection"
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

  await check("accepted lead replay recovers CRM without resend",async()=>{

    const x=fixture("lead");

    x.state.projectionError={
      message:"synthetic database failure"
    };

    const first=await x.execute();

    assert.equal(first.status,"accepted");
    assert.equal(first.crmProjection,"pending");

    x.state.projectionError=null;

    const second=await x.execute();

    assert.equal(second.status,"accepted");
    assert.equal(second.crmProjection,"moved");
    assert.equal(second.providerRequestAttempted,false);

    assert.equal(
      x.calls.filter(c=>c[0]==="send").length,1
    );

    assert.equal(
      x.calls.filter(c=>c[0]==="projection").length,2
    );

  });

  await check("CRM exception preserves accepted delivery",async()=>{

    const x=fixture("lead");

    x.state.projectionThrows=true;

    const result=await x.execute();

    assert.equal(result.status,"accepted");
    assert.equal(result.crmProjection,"pending");

    assert.equal(
      x.calls.filter(c=>c[0]==="send").length,1
    );

  });

  await check("invalid CRM response remains pending",async()=>{

    const x=fixture("lead");

    x.state.projection={
      outcome:"moved",
      reason:"synthetic",
      previous_stage:"negociacao",
      stage:"orcamento"
    };

    const result=await x.execute();

    assert.equal(result.status,"accepted");
    assert.equal(result.crmProjection,"pending");

  });

  await check("advanced opportunity remains unchanged",async()=>{

    const x=fixture("lead");

    x.state.projection={
      outcome:"unchanged",
      reason:"STAGE_PRESERVED",
      stage:"negociacao"
    };

    const result=await x.execute();

    assert.equal(result.status,"accepted");
    assert.equal(result.crmProjection,"unchanged");

  });

  await check("ambiguous opportunity does not invalidate delivery",async()=>{

    const x=fixture("lead");

    x.state.projection={
      outcome:"skipped",
      reason:"AMBIGUOUS_OPPORTUNITY"
    };

    const result=await x.execute();

    assert.equal(result.status,"accepted");
    assert.equal(result.crmProjection,"skipped");

  });

  await check("blocked or uncertain lead never projects CRM",async()=>{

    const blocked=fixture("lead");

    blocked.state.decision={
      allowed:false,
      reason:"CUSTOMER_TEMPLATE_REQUIRED"
    };

    const blockedResult=await blocked.execute();

    assert.equal(blockedResult.status,"blocked");

    assert.equal(
      blockedResult.crmProjection,"not_applicable"
    );

    assert.equal(
      blocked.calls.some(c=>c[0]==="projection"),
      false
    );

    const uncertain=fixture("lead");

    uncertain.state.sendOutcome={
      outcome:"uncertain"
    };

    const uncertainResult=await uncertain.execute();

    assert.equal(uncertainResult.status,"uncertain");

    assert.equal(
      uncertainResult.crmProjection,"not_applicable"
    );

    assert.equal(
      uncertain.calls.some(c=>c[0]==="projection"),
      false
    );

  });

  await check("no proven conversation does not block send",async()=>{

    const x=fixture("lead");

    x.state.binding={
      outcome:"skipped",
      reason:"NO_PROVEN_CONVERSATION",
      phone_number_id:"123456789"
    };

    x.state.history={
      outcome:"skipped",
      reason:"NO_PROVEN_CONVERSATION"
    };

    const result=await x.execute();

    assert.equal(result.status,"accepted");
    assert.equal(result.historyProjection,"skipped");
    assert.equal(result.crmProjection,"moved");
    assert.equal(x.calls.filter(c=>c[0]==="send").length,1);

  });

  await check("ambiguous conversation is not guessed",async()=>{

    const x=fixture("lead");

    x.state.binding={
      outcome:"skipped",
      reason:"AMBIGUOUS_CONVERSATION",
      phone_number_id:"123456789"
    };

    x.state.history={
      outcome:"skipped",
      reason:"AMBIGUOUS_CONVERSATION"
    };

    const result=await x.execute();

    assert.equal(result.status,"accepted");
    assert.equal(result.historyProjection,"skipped");
    assert.equal(x.calls.filter(c=>c[0]==="send").length,1);

  });

  await check("binding failure cannot authorize transport",async()=>{

    for(const failure of ["rpc","exception"]){

      const x=fixture("lead");

      if(failure==="rpc"){
        x.state.bindingError={message:"synthetic failure"};
      }else{
        x.state.bindingThrows=true;
      }

      const result=await x.execute();

      assert.equal(result.status,"unconfirmed");
      assert.equal(result.providerRequestAttempted,false);
      assert.equal(result.historyProjection,"not_applicable");

      assert.equal(
        x.calls.some(c=>["transition","send","history"].includes(c[0])),
        false
      );
    }

  });

  await check("invalid binding cannot authorize transport",async()=>{

    const invalid=[
      null,
      [],
      {outcome:"not_applicable"},
      {
        outcome:"bound",
        reason:"PROVEN_WHATSAPP_CONVERSATION",
        phone_number_id:"999",
        conversation_id:id(10),
        inbound_message_id:id(11)
      },
      {
        outcome:"bound",
        reason:"PROVEN_WHATSAPP_CONVERSATION",
        phone_number_id:"123456789",
        conversation_id:"invalid",
        inbound_message_id:id(11)
      },
      {
        outcome:"skipped",
        reason:"AMBIGUOUS_CONVERSATION",
        phone_number_id:"123456789",
        conversation_id:id(10)
      }
    ];

    for(const binding of invalid){

      const x=fixture("lead");

      x.state.binding=binding;

      const result=await x.execute();

      assert.equal(result.status,"unconfirmed");
      assert.equal(result.providerRequestAttempted,false);

      assert.equal(
        x.calls.some(c=>["transition","send"].includes(c[0])),
        false
      );
    }

  });

  await check("history RPC failure recovers without resending",async()=>{

    const x=fixture("lead");

    x.state.historyError={message:"synthetic error"};

    const first=await x.execute();

    assert.equal(first.status,"accepted");
    assert.equal(first.crmProjection,"moved");
    assert.equal(first.historyProjection,"pending");

    x.state.historyError=null;

    const second=await x.execute();

    assert.equal(second.status,"accepted");
    assert.equal(second.historyProjection,"recorded");
    assert.equal(second.providerRequestAttempted,false);

    assert.equal(x.calls.filter(c=>c[0]==="send").length,1);
    assert.equal(x.calls.filter(c=>c[0]==="binding").length,1);
    assert.equal(x.calls.filter(c=>c[0]==="history").length,2);

  });

  await check("malformed history response remains pending",async()=>{

    const invalid=[
      null,
      [],
      {
        outcome:"recorded",
        reason:"ACCEPTED_DOCUMENT_RECORDED",
        message_id:"invalid",
        conversation_id:id(10)
      },
      {
        outcome:"skipped",
        reason:"UNKNOWN_REASON"
      },
      {
        outcome:"not_eligible",
        reason:"PROVIDER_ACCEPTANCE_REQUIRED"
      }
    ];

    for(const history of invalid){

      const x=fixture("lead");

      x.state.history=history;

      const result=await x.execute();

      assert.equal(result.status,"accepted");
      assert.equal(result.historyProjection,"pending");
      assert.equal(x.calls.filter(c=>c[0]==="send").length,1);

    }

  });

  await check("CRM failure does not suppress history",async()=>{

    const x=fixture("lead");

    x.state.projectionThrows=true;

    const result=await x.execute();

    assert.equal(result.status,"accepted");
    assert.equal(result.crmProjection,"pending");
    assert.equal(result.historyProjection,"recorded");
    assert.equal(x.calls.filter(c=>c[0]==="send").length,1);

  });

  await check("history exception does not invalidate acceptance",async()=>{

    const x=fixture("lead");

    x.state.historyThrows=true;

    const result=await x.execute();

    assert.equal(result.status,"accepted");
    assert.equal(result.crmProjection,"moved");
    assert.equal(result.historyProjection,"pending");
    assert.equal(x.calls.filter(c=>c[0]==="send").length,1);

  });

  await check("nonaccepted sends never project history",async()=>{

    for(const outcome of ["failed","uncertain"]){

      const x=fixture("lead");

      x.state.sendOutcome={outcome};

      const result=await x.execute();

      assert.equal(result.status,outcome);
      assert.equal(result.historyProjection,"not_applicable");
      assert.equal(x.calls.some(c=>c[0]==="history"),false);

    }

    const blocked=fixture("lead");

    blocked.state.decision={
      allowed:false,
      reason:"CUSTOMER_TEMPLATE_REQUIRED"
    };

    const result=await blocked.execute();

    assert.equal(result.status,"blocked");
    assert.equal(result.historyProjection,"not_applicable");

    assert.equal(
      blocked.calls.some(c=>["binding","history","send"].includes(c[0])),
      false
    );

  });

  await check("minimal replay context never authorizes transport",async()=>{

    for(const kind of ["lead","phone"]){

      for(const status of [
        "accepted",
        "attempt_started",
        "blocked",
        "failed",
        "uncertain"
      ]){

        const x=fixture(kind);

        x.state.status=status;
        x.state.expires=true;
        x.state.quoteStatus="cancelled";
        x.state.mismatch=true;

        const result=await x.execute();

        assert.equal(result.status,status);
        assert.equal(result.providerRequestAttempted,false);

        assert.equal(
          result.quoteVersionId,
          x.request.quoteVersionId
        );

        const project=kind==="lead" && status==="accepted";

        assert.equal(
          result.crmProjection,
          project?"moved":"not_applicable"
        );

        assert.equal(
          result.historyProjection,
          project?"recorded":"not_applicable"
        );

        assert.deepEqual(
          x.calls.map(c=>c[0]),
          project
            ? ["register","projection","history"]
            : ["register"]
        );
      }
    }

  });

  assert.equal(count,31);

  console.log("HUMAN_QUOTE_CUSTOMER_SEND: 31/31 PASS");
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
