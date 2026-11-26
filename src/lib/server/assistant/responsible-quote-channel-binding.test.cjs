const fs=require("node:fs");
const path=require("node:path");
const assert=require("node:assert/strict");
const ts=require("typescript");

async function run(source){

  const ast=ts.createSourceFile(
    "sender.ts",source,
    ts.ScriptTarget.Latest,true,
    ts.ScriptKind.TS
  );

  const matches=ast.statements.filter(
    n=>ts.isFunctionDeclaration(n) &&
    n.name?.text==="sendResponsibleWhatsappPayload"
  );

  assert.equal(matches.length,1);

  const actual=matches[0].getText(ast)
    .replace(/^export\s+/,"");

  const compiled=ts.transpileModule(actual,{
    compilerOptions:{
      target:ts.ScriptTarget.ES2022,
      module:ts.ModuleKind.CommonJS
    }
  }).outputText;

  const create=new Function(
    "deps",
    "const {cleanText,getSupabaseAdmin,"+
    "loadCanonicalActivePrimaryStoreResponsible,"+
    "getResponsibleSendWhatsappIntegration,"+
    "sendWhatsappPayload,sendWhatsappTextMessage,"+
    "sendWhatsappTemplateMessage,"+
    "sendWhatsappInteractiveDocumentMessage}=deps;\n"+
    compiled+
    "\nreturn sendResponsibleWhatsappPayload;"
  );

  function fixture(){

    const calls=[];

    const state={
      rows:[{
        phone_number_id:"123456",
        access_token:"synthetic-test-only"
      }],
      error:null,
      responsibleId:"responsible-test",
      destination:"5511999990000"
    };

    const supabase={
      async rpc(name,params){

        calls.push(["rpc",name,params]);

        assert.equal(
          name,
          "get_active_whatsapp_integration_for_external_send_by_system"
        );

        assert.deepEqual(params,{
          p_organization_id:"organization-test",
          p_store_id:"store-test"
        });

        return {
          data:state.rows,
          error:state.error
        };
      }
    };

    const transmit=async input=>{

      calls.push(["provider_mock",input]);

      return "synthetic-external-id";
    };

    const execute=create({

      cleanText:value=>String(value||"").trim(),

      getSupabaseAdmin:()=>supabase,

      async loadCanonicalActivePrimaryStoreResponsible(args){

        calls.push(["responsible",args.storeId]);

        return {
          ok:true,
          responsible:{
            id:state.responsibleId,
            whatsappNumber:state.destination
          }
        };
      },

      async getResponsibleSendWhatsappIntegration(){

        calls.push(["legacy_integration"]);

        return {
          phoneNumberId:"654321",
          accessToken:"legacy-synthetic-token"
        };
      },

      sendWhatsappPayload:transmit,
      sendWhatsappTextMessage:transmit,
      sendWhatsappTemplateMessage:transmit,
      sendWhatsappInteractiveDocumentMessage:transmit
    });

    const args={
      organizationId:"organization-test",
      storeId:"store-test",
      responsibleId:"responsible-test",
      destination:"5511999990000",
      expectedPhoneNumberId:"123456",
      payload:{
        type:"document",
        link:"https://example.invalid/document.pdf",
        filename:"quote.pdf",
        caption:"Orcamento"
      }
    };

    return {calls,state,args,execute};
  }

  let count=0;

  async function check(name,fn){

    await fn();

    count++;
    console.log("PASS | "+name);
  }

  await check("bound document uses exact authorized channel",async()=>{

    const x=fixture();
    const result=await x.execute(x.args);

    assert.deepEqual(result,{
      ok:true,
      externalMessageId:"synthetic-external-id"
    });

    assert.deepEqual(
      x.calls.map(c=>c[0]),
      ["responsible","rpc","provider_mock"]
    );

    const request=x.calls[2][1];

    assert.equal(request.phoneNumberId,"123456");
    assert.equal(request.accessToken,"synthetic-test-only");
    assert.equal(request.to,x.args.destination);
    assert.equal(request.payload.type,"document");
    assert.equal(request.payload.document.filename,"quote.pdf");
  });

  await check("legacy sender remains unchanged",async()=>{

    const x=fixture();

    delete x.args.expectedPhoneNumberId;

    x.args.payload={type:"text",body:"Legacy report"};

    const result=await x.execute(x.args);

    assert.equal(result.ok,true);

    assert.deepEqual(
      x.calls.map(c=>c[0]),
      ["responsible","legacy_integration","provider_mock"]
    );

    assert.equal(
      x.calls[2][1].phoneNumberId,
      "654321"
    );
  });

  async function denied(name,change,reason){

    await check(name,async()=>{

      const x=fixture();
      change(x);

      const result=await x.execute(x.args);

      assert.deepEqual(result,{ok:false,reason});

      assert.equal(
        x.calls.some(c=>
          c[0]==="provider_mock" ||
          c[0]==="legacy_integration"
        ),
        false
      );
    });
  }

  await denied(
    "changed provider channel cannot send",
    x=>{x.state.rows[0].phone_number_id="999999";},
    "RESPONSIBLE_WHATSAPP_CHANNEL_MISMATCH"
  );

  await denied(
    "missing token never uses legacy fallback",
    x=>{x.state.rows[0].access_token=null;},
    "RESPONSIBLE_WHATSAPP_CHANNEL_UNAVAILABLE"
  );

  await denied(
    "blank token never uses legacy fallback",
    x=>{x.state.rows[0].access_token="  ";},
    "RESPONSIBLE_WHATSAPP_CHANNEL_UNAVAILABLE"
  );

  await denied(
    "ambiguous integrations cannot send",
    x=>{x.state.rows.push({...x.state.rows[0]});},
    "RESPONSIBLE_WHATSAPP_CHANNEL_UNAVAILABLE"
  );

  await denied(
    "missing integration cannot send",
    x=>{x.state.rows=[];},
    "RESPONSIBLE_WHATSAPP_CHANNEL_UNAVAILABLE"
  );

  await denied(
    "RPC failure cannot send",
    x=>{x.state.error={message:"synthetic failure"};},
    "RESPONSIBLE_WHATSAPP_CHANNEL_UNAVAILABLE"
  );

  await denied(
    "malformed expected channel cannot send",
    x=>{x.args.expectedPhoneNumberId="invalid";},
    "RESPONSIBLE_WHATSAPP_CHANNEL_INVALID"
  );

  await denied(
    "changed responsible cannot send",
    x=>{x.state.responsibleId="other-responsible";},
    "RESPONSIBLE_WHATSAPP_DESTINATION_SCOPE_MISMATCH"
  );

  await denied(
    "changed destination cannot send",
    x=>{x.state.destination="5511999990001";},
    "RESPONSIBLE_WHATSAPP_DESTINATION_CHANGED"
  );

  assert.equal(count,11);

  console.log("RESPONSIBLE_CHANNEL_TESTS: 11/11 PASS");
}

module.exports=run;

if(require.main===module){

  globalThis.fetch=async()=>{
    throw new Error("REAL_NETWORK_FORBIDDEN");
  };

  require("node:net").Socket.prototype.connect=function(){
    throw new Error("REAL_NETWORK_FORBIDDEN");
  };

  run(fs.readFileSync(
    path.join(
      __dirname,
      "responsible-external-notifications-sender.ts"
    ),
    "utf8"
  )).catch(error=>{
    console.error(error);
    process.exitCode=1;
  });
}
