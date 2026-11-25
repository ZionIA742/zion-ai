const fs=require("node:fs");
const assert=require("node:assert/strict");
const ts=require("typescript");

const root="src/lib/server/sales-quotes";

function load(source,resolver=require){

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

async function run(source){

  function read(name){
    return fs.readFileSync(root+"/"+name+".ts","utf8");
  }

  const contract=load(read("human-quote-send-contract"));

  const controller=load(read("human-quote-send-transport"));

  const attempts=load(
    read("human-quote-send-attempt"),
    name=>{
      if(name==="./human-quote-send-contract")return contract;
      throw new Error("UNEXPECTED_IMPORT: "+name);
    }
  );

  const id=n=>"10000000-0000-4000-8000-"+
    String(n).padStart(12,"0");

  const phone="+5511999991234";
  const destination=phone.slice(1);
  const responsibleId=id(8);
  const token=id(9);

  const url="https://example.invalid/signed/quote.pdf";

  let count=0;

  function fixture(){

    const calls=[];

    const scope={
      organizationId:id(1),
      storeId:id(2),
      actorUserId:id(3),
      quoteId:id(4),
    };

    const request={
      operationId:id(5),
      quoteVersionId:id(6),
      recipient:{kind:"responsible"},
    };

    const path=scope.organizationId+"/"+
      scope.storeId+"/sales-quotes/"+
      scope.quoteId+"/document.pdf";

    const state={
      status:"registered",
      statusReason:null,
      quoteStatus:"pending_review",
      expired:false,
      recipient:{
        kind:"responsible",
        responsibleId,
        candidatePhone:phone,
        leadId:null,
      },
      signed:{
        data:{signedUrl:url},
        error:null,
      },
      policy:{
        ok:true,
        mode:"free_form",
        responsible:{
          id:responsibleId,
          whatsappNumber:destination,
        },
      },
      provider:{
        ok:true,
        externalMessageId:"synthetic-provider-id",
      },
    };

    const supabase={

      storage:{
        from(bucket){
          return {
            async createSignedUrl(path,ttl){
              calls.push(["sign",bucket,path,ttl]);
              return state.signed;
            }
          };
        }
      },

      async rpc(name,p){

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
          state.statusReason=p.p_reason;

        }else{

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
            operation_id:request.operationId,
            status:state.status,
            outcome,
            attempt_token:attemptToken,
            new_attempt:newAttempt,
          },
        };
      },
    };

    const module=load(source,name=>{

      if(name==="./human-quote-send-contract")return contract;

      if(name==="./human-quote-send-attempt")return attempts;

      if(name==="./human-quote-send-transport")return controller;

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
                statusReason:state.statusReason
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
              statusReason:state.statusReason,
            },
            scope,
            request,
            recipient:state.recipient,
            supabase,
            quote:{status:state.quoteStatus},
            version:{},
            pdf:{
              storeFileId:id(7),
              storageBucket:"zion-store-files",
              storagePath:path,
              originalFilename:"orc-000001-v0001.pdf",
            },
          };
        }
      };

      if(name==="./quote-expiration")return {

        assertSalesQuoteVersionNotExpired(){

          calls.push(["expiry"]);

          if(state.expired){
            throw new Error("QUOTE_VERSION_EXPIRED");
          }
        }
      };

      if(
        name==="../assistant/responsible-whatsapp-outbound-policy"
      )return {

        async resolveResponsibleWhatsappOutboundPolicy(args){

          calls.push(["policy",args]);

          return state.policy;
        }
      };

      if(
        name==="../assistant/responsible-external-notifications-sender"
      )return {

        async sendResponsibleWhatsappPayload(args){

          calls.push(["send",args]);

          if(state.providerError){
            throw state.providerError;
          }

          return state.provider;
        }
      };

      throw new Error("UNEXPECTED_IMPORT: "+name);
    });

    return {
      state,calls,request,scope,path,
      execute:()=>module.executeHumanQuoteResponsibleSend({
        quoteId:scope.quoteId,
        body:request,
      }),
    };
  }

  async function check(name,fn){
    await fn();
    count++;
    console.log("ok - "+name);
  }

  function sent(x){
    return x.calls.filter(c=>c[0]==="send").length;
  }

  await check("complete responsible PDF send",async()=>{

    const x=fixture();
    const result=await x.execute();

    assert.equal(result.status,"accepted");

    assert.deepEqual(
      x.calls.map(c=>c[0]),
      [
        "register","expiry","sign","policy",
        "transition","send","transition"
      ]
    );

    const policy=x.calls[3][1];

    assert.equal(policy.responsibleId,responsibleId);
    assert.equal(policy.destination,destination);
    assert.equal(policy.organizationId,x.scope.organizationId);
    assert.equal(policy.storeId,x.scope.storeId);

    assert.equal(
      Object.hasOwn(policy,"templateContext"),false
    );

    assert.deepEqual(x.calls[5][1],{
      organizationId:x.scope.organizationId,
      storeId:x.scope.storeId,
      responsibleId,
      destination,
      payload:{
        type:"document",
        link:url,
        filename:"orc-000001-v0001.pdf",
        caption:"Segue o or?amento solicitado no ZION.",
      },
    });

    assert.deepEqual(
      x.calls[2],
      ["sign","zion-store-files",x.path,900]
    );

    assert.equal(x.calls[4][1].p_action,"start");
    assert.equal(x.calls[6][1].p_action,"accept");

    assert.equal(result.providerRequestAttempted,true);

    assert.deepEqual(
      Object.keys(result).sort(),
      [
        "operationId",
        "quoteId",
        "quoteVersionId",
        "status",
        "reason",
        "providerRequestAttempted",
      ].sort()
    );
  });

  await check("customer recipient cannot use responsible service",async()=>{

    const x=fixture();

    x.request.recipient={kind:"phone",phone};

    await assert.rejects(x.execute);

    assert.deepEqual(x.calls,[]);
  });

  await check("missing responsible cannot send",async()=>{

    const x=fixture();

    x.state.recipient.responsibleId=null;

    await assert.rejects(x.execute);

    assert.equal(sent(x),0);
  });

  await check("invalid responsible destination cannot send",async()=>{

    const x=fixture();

    x.state.recipient.candidatePhone="invalid";

    await assert.rejects(x.execute);

    assert.equal(sent(x),0);
  });

  await check("expired quote cannot send",async()=>{

    const x=fixture();

    x.state.expired=true;

    await assert.rejects(x.execute);

    assert.equal(sent(x),0);
    assert.equal(
      x.calls.some(c=>c[0]==="sign"),false
    );
  });

  await check("cancelled quote cannot send",async()=>{

    const x=fixture();

    x.state.quoteStatus="cancelled";

    await assert.rejects(x.execute);

    assert.equal(sent(x),0);
  });

  await check("missing signed document cannot send",async()=>{

    const x=fixture();

    x.state.signed={
      data:null,
      error:{message:"synthetic"},
    };

    await assert.rejects(x.execute);

    assert.equal(sent(x),0);
  });

  await check("insecure document URL cannot send",async()=>{

    const x=fixture();

    x.state.signed.data.signedUrl=
      "http://example.invalid/document.pdf";

    await assert.rejects(x.execute);

    assert.equal(sent(x),0);
  });

  await check("closed responsible window blocks transport",async()=>{

    const x=fixture();

    x.state.policy={
      ok:false,
      reason:"RESPONSIBLE_WHATSAPP_TEMPLATE_REQUIRED",
    };

    const result=await x.execute();

    assert.equal(result.status,"blocked");

    assert.equal(
      result.reason,
      "RESPONSIBLE_WHATSAPP_TEMPLATE_REQUIRED"
    );

    assert.equal(sent(x),0);
    assert.equal(x.calls.at(-1)[1].p_action,"block");
  });

  await check("template mode cannot send a free document",async()=>{

    const x=fixture();

    x.state.policy.mode="template_required";

    assert.equal(
      (await x.execute()).status,"blocked"
    );

    assert.equal(sent(x),0);
  });

  await check("changed responsible identity blocks transport",async()=>{

    const x=fixture();

    x.state.policy.responsible.id=id(99);

    assert.equal(
      (await x.execute()).status,"blocked"
    );

    assert.equal(sent(x),0);
  });

  await check("changed responsible phone blocks transport",async()=>{

    const x=fixture();

    x.state.policy.responsible.whatsappNumber=
      "5511999991235";

    assert.equal(
      (await x.execute()).status,"blocked"
    );

    assert.equal(sent(x),0);
  });

  await check("definitive destination rejection is recorded",async()=>{

    const x=fixture();

    x.state.provider={
      ok:false,
      reason:"RESPONSIBLE_WHATSAPP_DESTINATION_CHANGED",
    };

    assert.equal(
      (await x.execute()).status,"failed"
    );

    assert.equal(sent(x),1);
  });

  await check("ambiguous transport failure remains uncertain",async()=>{

    const x=fixture();

    x.state.provider={
      ok:false,
      reason:"RESPONSIBLE_WHATSAPP_SEND_FAILED",
    };

    assert.equal(
      (await x.execute()).status,"uncertain"
    );

    assert.equal(sent(x),1);
  });

  await check("accepted operation cannot send twice",async()=>{

    const x=fixture();

    await x.execute();

    const result=await x.execute();

    assert.equal(result.status,"accepted");
    assert.equal(result.providerRequestAttempted,false);
    assert.equal(sent(x),1);
  });

  await check("uncertain operation cannot send twice",async()=>{

    const x=fixture();

    x.state.providerError=
      new Error("synthetic connection loss");

    assert.equal(
      (await x.execute()).status,"uncertain"
    );

    assert.equal(
      (await x.execute()).status,"uncertain"
    );

    assert.equal(sent(x),1);
  });

  await check("minimal responsible replay never authorizes transport",async()=>{

    for(const status of [
      "accepted",
      "attempt_started",
      "blocked",
      "failed",
      "uncertain"
    ]){

      const x=fixture();

      x.state.status=status;
      x.state.expired=true;
      x.state.quoteStatus="cancelled";
      x.state.recipient=null;
      x.state.signed=null;

      const result=await x.execute();

      assert.equal(result.status,status);
      assert.equal(result.providerRequestAttempted,false);

      assert.equal(
        result.quoteVersionId,
        x.request.quoteVersionId
      );

      assert.deepEqual(
        x.calls.map(c=>c[0]),
        ["register"]
      );

      assert.equal(
        Object.hasOwn(result,"crmProjection"),false
      );

      assert.equal(
        Object.hasOwn(result,"historyProjection"),false
      );
    }

  });

  assert.equal(count,17);

  console.log("HUMAN_QUOTE_RESPONSIBLE_SEND: 17/17 PASS");
}

module.exports=run;

if(require.main===module){

  globalThis.fetch=async()=>{
    throw new Error("REAL_NETWORK_FORBIDDEN");
  };

  run(fs.readFileSync(
    root+"/human-quote-responsible-send.ts","utf8"
  )).catch(error=>{
    console.error(error);
    process.exitCode=1;
  });
}
