const fs=require("node:fs");
const assert=require("node:assert/strict");
const ts=require("typescript");

const root="src/lib/server/sales-quotes";

function load(source,resolver=require) {
  const result=ts.transpileModule(source,{
    compilerOptions:{
      module:ts.ModuleKind.CommonJS,
      target:ts.ScriptTarget.ES2022,
      strict:true,
    }
  });

  const m={exports:{}};

  new Function(
    "require","module","exports",result.outputText
  )(resolver,m,m.exports);

  return m.exports;
}

async function run(source) {

  const pdf=load(
    fs.readFileSync(root+"/human-quote-send-pdf.ts","utf8")
  );

  const contract=load(
    fs.readFileSync(root+"/human-quote-send-contract.ts","utf8")
  );

  const id=n=>"10000000-0000-4000-8000-"+
    String(n).padStart(12,"0");

  const org=id(1),store=id(2),quoteId=id(3);
  const versionId=id(4),fileId=id(5);

  const path=org+"/"+store+"/sales-quotes/"+quoteId+"/document.pdf";
  const url="https://example.invalid/signed/document.pdf";

  let count=0;

  function fixture() {

    const calls=[];

    const state={
      integration:{
        data:[{
          access_token:"synthetic-token",
          phone_number_id:"123456789",
        }],
        error:null,
      },
      signed:{
        data:{signedUrl:url},
        error:null,
      },
      providerId:"synthetic-provider-id",
      providerError:null,
    };

    const common={
      organization_id:org,
      store_id:store,
      storage_bucket:"zion-store-files",
      storage_path:path,
      original_filename:"orc-000001-v0001.pdf",
      mime_type:"application/pdf",
      size_bytes:1000,
    };

    const args={
      destinationPhone:"+5511999991234",
      pdfInput:{
        organizationId:org,
        storeId:store,
        quoteId,
        quoteVersionId:versionId,
        quote:{
          id:quoteId,
          organization_id:org,
          store_id:store,
          current_version_id:versionId,
        },
        version:{
          ...common,
          id:versionId,
          quote_id:quoteId,
          store_file_id:fileId,
          status:"approved",
        },
        storeFile:{
          ...common,
          id:fileId,
          file_kind:"sales_quote_pdf",
        },
      },
      supabase:{
        async rpc(name,params) {
          calls.push(["rpc",name,params]);
          return state.integration;
        },
        storage:{
          from(bucket) {
            return {
              async createSignedUrl(path,ttl) {
                calls.push(["sign",bucket,path,ttl]);
                return state.signed;
              },
            };
          },
        },
      },
    };

    const transport=load(source,name=>{

      if(name==="./human-quote-send-pdf")return pdf;
      if(name==="./human-quote-send-contract")return contract;

      if(name==="../whatsapp-external-sender")return {
        async sendSinglePendingMessage(integration,message) {
          calls.push(["send",integration,message]);
          if(state.providerError)throw state.providerError;
          return state.providerId;
        },
      };

      throw new Error("UNEXPECTED_IMPORT: "+name);
    });

    return {
      args,state,calls,
      prepare:()=>transport.prepareHumanQuoteCustomerTransport(args),
    };
  }

  async function check(name,fn) {
    await fn();
    count++;
    console.log("ok - "+name);
  }

  async function denied(change) {
    const x=fixture();
    change(x);
    await assert.rejects(x.prepare);
    assert.equal(x.calls.some(c=>c[0]==="send"),false);
  }

  await check("prepare scoped document without sending",async()=>{
    const x=fixture();
    const prepared=await x.prepare();

    assert.equal(typeof prepared.send,"function");

    assert.deepEqual(x.calls,[
      [
        "rpc",
        "get_active_whatsapp_integration_for_external_send_by_system",
        {p_organization_id:org,p_store_id:store},
      ],
      ["sign","zion-store-files",path,900],
    ]);
  });

  await check("reuse existing document transport",async()=>{
    const x=fixture();
    const prepared=await x.prepare();

    assert.deepEqual(await prepared.send(),{
      outcome:"accepted",
      externalMessageId:"synthetic-provider-id",
    });

    assert.deepEqual(x.calls[2],[
      "send",
      {
        accessToken:"synthetic-token",
        phoneNumberId:"123456789",
      },
      {
        mode:"document",
        to:"5511999991234",
        documentUrl:url,
        filename:"orc-000001-v0001.pdf",
        caption:"Segue o or?amento.",
      },
    ]);
  });

  await check("same prepared transport cannot send twice",async()=>{
    const x=fixture();
    const prepared=await x.prepare();

    await prepared.send();
    await prepared.send();

    assert.equal(x.calls.filter(c=>c[0]==="send").length,1);
  });

  await check("invalid PDF is denied",async()=>{
    await denied(x=>{
      x.args.pdfInput.storeFile.store_id=id(99);
    });
  });

  await check("noncanonical phone is denied",async()=>{
    await denied(x=>{
      x.args.destinationPhone="11999991234";
    });
  });

  await check("missing integration is denied",async()=>{
    await denied(x=>{x.state.integration.data=[];});
  });

  await check("multiple integrations are denied",async()=>{
    await denied(x=>{
      x.state.integration.data.push(x.state.integration.data[0]);
    });
  });

  await check("integration lookup failure is denied",async()=>{
    await denied(x=>{
      x.state.integration.error={message:"private detail"};
    });
  });

  await check("missing store token is denied",async()=>{
    await denied(x=>{
      x.state.integration.data[0].access_token="";
    });
  });

  await check("invalid provider number identity is denied",async()=>{
    await denied(x=>{
      x.state.integration.data[0].phone_number_id="invalid";
    });
  });

  await check("missing PDF signed URL is denied",async()=>{
    await denied(x=>{
      x.state.signed={data:null,error:{message:"missing"}};
    });
  });

  await check("insecure document URL is denied",async()=>{
    await denied(x=>{
      x.state.signed.data.signedUrl="http://example.invalid/a.pdf";
    });
  });

  await check("definitive provider rejection is preserved",async()=>{
    const x=fixture();

    x.state.providerError=Object.assign(
      new Error("rejected"),
      {
        name:"KnownWhatsappSendFailure",
        httpStatus:400,
        retryable:false,
      }
    );

    assert.deepEqual(
      await (await x.prepare()).send(),
      {outcome:"failed"}
    );
  });

  await check("provider server failure is uncertain",async()=>{
    const x=fixture();

    x.state.providerError=Object.assign(
      new Error("provider unavailable"),
      {
        name:"KnownWhatsappSendFailure",
        httpStatus:503,
        retryable:true,
      }
    );

    assert.deepEqual(
      await (await x.prepare()).send(),
      {outcome:"uncertain"}
    );
  });

  await check("network failure is uncertain",async()=>{
    const x=fixture();
    x.state.providerError=new Error("connection lost");

    assert.deepEqual(
      await (await x.prepare()).send(),
      {outcome:"uncertain"}
    );
  });

  await check("missing acceptance identity is uncertain",async()=>{
    const x=fixture();
    x.state.providerId="";

    assert.deepEqual(
      await (await x.prepare()).send(),
      {outcome:"uncertain"}
    );
  });

  assert.equal(count,16);

  console.log("HUMAN_QUOTE_CUSTOMER_TRANSPORT: 16/16 PASS");
}

module.exports=run;

if(require.main===module) {
  run(
    fs.readFileSync(
      root+"/human-quote-customer-transport.ts","utf8"
    )
  ).catch(error=>{
    console.error(error);
    process.exitCode=1;
  });
}
