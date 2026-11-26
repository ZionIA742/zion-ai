const fs=require("node:fs");
const path=require("node:path");
const assert=require("node:assert/strict");
const ts=require("typescript");

async function run(source){

  const compiled=ts.transpileModule(source,{
    compilerOptions:{
      target:ts.ScriptTarget.ES2022,
      module:ts.ModuleKind.CommonJS
    }
  }).outputText;

  const m={exports:{}};

  new Function(
    "require","module","exports",compiled
  )(
    name=>{

      if(name==="@/lib/server/store-responsibles"){
        return {

          normalizeResponsibleWhatsappDestination(value){
            return String(value||"").replace(/\D/g,"");
          },

          async loadCanonicalActivePrimaryStoreResponsible(){
            throw new Error("UNEXPECTED_REAL_AUTHORITY");
          }
        };
      }

      if(name==="@/lib/server/assistant/assistant-panel-template-status"){
        return {
          async readAssistantPanelTemplateStatus(){
            throw new Error("UNEXPECTED_TEMPLATE_LOOKUP");
          }
        };
      }

      throw new Error("UNEXPECTED_IMPORT: "+name);
    },
    m,m.exports
  );

  const resolve=m.exports.resolveResponsibleWhatsappOutboundPolicy;

  const now="2026-11-25T12:00:00.000Z";

  const responsible={
    id:"responsible-test",
    name:"Synthetic responsible",
    role:"primary",
    whatsappNumber:"5511999999999"
  };

  const channel="123456789";
  const previousChannel="987654321";

  function inbound(options={}){

    return {
      id:"synthetic-inbound-id",

      created_at:
        options.at || "2026-11-25T11:00:00.000Z",

      metadata:{
        origin:"whatsapp",
        channel:"whatsapp",
        responsible_id:responsible.id,
        external_message_id:"synthetic-wamid",
        from_phone:responsible.whatsappNumber,
        phone_number_id:channel,
        ...(options.metadata||{})
      }
    };
  }

  function fixture(rows,options={}){

    const calls=[];
    let filters={};

    const query={

      select(value){
        calls.push(["select",value]);
        return this;
      },

      eq(key,value){
        calls.push(["eq",key,value]);
        return this;
      },

      contains(key,value){

        assert.equal(key,"metadata");

        filters=value;
        calls.push(["contains",value]);

        return this;
      },

      order(){
        return this;
      },

      async limit(value){

        assert.equal(value,1);

        const selected=options.ignoreFilter
          ? rows
          : rows.filter(row=>
              Object.entries(filters).every(
                ([k,v])=>row.metadata?.[k]===v
              )
            );

        return {
          error:null,
          data:[...selected]
            .sort((a,b)=>
              Date.parse(b.created_at)-Date.parse(a.created_at)
            ).slice(0,1)
        };
      }
    };

    const supabase={
      from(table){
        assert.equal(table,"store_assistant_messages");
        calls.push(["from",table]);
        return query;
      }
    };

    const args={
      supabase,
      organizationId:"organization-test",
      storeId:"store-test",
      responsibleId:responsible.id,
      destination:responsible.whatsappNumber,
      expectedPhoneNumberId:channel
    };

    if(options.legacy){
      delete args.expectedPhoneNumberId;
    }

    if(options.invalid){
      args.expectedPhoneNumberId="invalid-channel";
    }

    return {
      calls,
      execute:()=>resolve(args,{

        loadResponsible:async()=>({
          ok:true,responsible
        }),

        now:()=>new Date(now)
      })
    };
  }

  let count=0;

  async function check(name,fn){
    await fn();
    count++;
    console.log("PASS | "+name);
  }

  async function allowed(rows,options={}){

    const x=fixture(rows,options);
    const result=await x.execute();

    assert.equal(result.ok,true);
    assert.equal(result.mode,"free_form");

    return x;
  }

  async function denied(rows,options={}){

    const x=fixture(rows,options);
    const result=await x.execute();

    assert.deepEqual(result,{
      ok:false,
      reason:"RESPONSIBLE_WHATSAPP_TEMPLATE_REQUIRED"
    });
  }

  await check("current channel opens window",async()=>{

    const x=await allowed([inbound()]);

    const contains=x.calls.find(c=>c[0]==="contains");

    assert.deepEqual(contains[1],{
      origin:"whatsapp",
      responsible_id:responsible.id,
      channel:"whatsapp",
      phone_number_id:channel
    });

    for(const [key,value] of [
      ["organization_id","organization-test"],
      ["store_id","store-test"],
      ["sender_role","store_responsible"],
      ["direction","incoming"]
    ]){
      assert.ok(x.calls.some(c=>
        c[0]==="eq" && c[1]===key && c[2]===value
      ));
    }
  });

  await check("previous commercial channel is denied",async()=>{
    await denied([inbound({
      metadata:{phone_number_id:previousChannel}
    })]);
  });

  await check("missing channel is denied",async()=>{

    const row=inbound();

    delete row.metadata.phone_number_id;

    await denied([row]);
  });

  await check("newer previous channel does not hide valid current evidence",async()=>{

    await allowed([
      inbound({
        at:"2026-11-25T11:59:00.000Z",
        metadata:{phone_number_id:previousChannel}
      }),
      inbound({
        at:"2026-11-25T10:00:00.000Z"
      })
    ]);
  });

  await check("expired window is denied",async()=>{
    await denied([inbound({
      at:"2026-11-24T11:59:59.000Z"
    })]);
  });

  await check("future inbound is denied",async()=>{
    await denied([inbound({
      at:"2026-11-25T12:00:01.000Z"
    })]);
  });

  await check("exact 24h boundary preserves existing policy",async()=>{
    await allowed([inbound({
      at:"2026-11-24T12:00:00.000Z"
    })]);
  });

  await check("different responsible destination is denied",async()=>{
    await denied([inbound({
      metadata:{from_phone:"5511888888888"}
    })]);
  });

  await check("missing external message identity is denied",async()=>{
    await denied([inbound({
      metadata:{external_message_id:""}
    })]);
  });

  await check("foreign channel returned by query is denied defensively",async()=>{

    await denied(
      [inbound({
        metadata:{phone_number_id:previousChannel}
      })],
      {ignoreFilter:true}
    );
  });

  await check("non WhatsApp evidence is denied",async()=>{

    await denied(
      [inbound({
        metadata:{channel:"panel"}
      })],
      {ignoreFilter:true}
    );
  });

  await check("invalid expected channel never queries inbound",async()=>{

    const x=fixture([inbound()],{invalid:true});

    assert.deepEqual(await x.execute(),{
      ok:false,
      reason:"RESPONSIBLE_WHATSAPP_CHANNEL_INVALID"
    });

    assert.equal(x.calls.length,0);
  });

  await check("legacy assistant caller remains compatible",async()=>{

    const row=inbound();

    delete row.metadata.phone_number_id;
    delete row.metadata.channel;

    const x=await allowed([row],{legacy:true});

    const contains=x.calls.find(c=>c[0]==="contains");

    assert.deepEqual(contains[1],{
      origin:"whatsapp",
      responsible_id:responsible.id
    });
  });

  assert.equal(count,13);

  console.log("RESPONSIBLE_QUOTE_WINDOW: 13/13 PASS");
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
      "responsible-whatsapp-outbound-policy.ts"
    ),
    "utf8"
  )).catch(error=>{
    console.error(error);
    process.exitCode=1;
  });
}
