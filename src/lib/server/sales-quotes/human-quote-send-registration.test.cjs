const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

const root = "src/lib/server/sales-quotes";

function load(source, resolver = require) {
  const compiled = ts.transpileModule(source,{
    compilerOptions:{
      module:ts.ModuleKind.CommonJS,
      target:ts.ScriptTarget.ES2022,
      strict:true,
    },
    reportDiagnostics:true,
  });

  assert.equal(
    (compiled.diagnostics || []).filter(
      d=>d.category===ts.DiagnosticCategory.Error
    ).length,0
  );

  const m={exports:{}};

  new Function(
    "require","module","exports",
    compiled.outputText
  )(resolver,m,m.exports);

  return m.exports;
}

async function run(source) {

  const contract=load(
    fs.readFileSync(root+"/human-quote-send-contract.ts","utf8")
  );

  const pdf=load(
    fs.readFileSync(root+"/human-quote-send-pdf.ts","utf8")
  );

  const provenance=load(
    fs.readFileSync(root+"/human-quote-edit-provenance.ts","utf8")
  );

  const id=n=>
    "10000000-0000-4000-8000-"+
    String(n).padStart(12,"0");

  const org=id(1);
  const store=id(2);
  const actor=id(3);
  const quoteId=id(4);
  const operationId=id(5);
  const versionId=id(6);
  const fileId=id(7);
  const leadId=id(8);
  const responsibleId=id(9);

  const phone="+5511999991234";

  let count=0;

  function fixture() {

    const calls=[];

    const body={
      operationId,
      quoteVersionId:versionId,
      recipient:{kind:"phone",phone},
    };

    const quote={
      id:quoteId,
      organization_id:org,
      store_id:store,
      current_version_id:versionId,
      metadata:{
        created_via:"api_sales_quotes_create",
        creation_actor_kind:"user",
        creation_actor_user_id:actor,
      },
    };

    const common={
      organization_id:org,
      store_id:store,
      storage_bucket:"zion-store-files",
      storage_path:
        org+"/"+store+"/sales-quotes/"+quoteId+"/document.pdf",
      original_filename:"orc-000001-v0001.pdf",
      mime_type:"application/pdf",
      size_bytes:1000,
    };

    const state={
      quote,
      visible:{id:quoteId,organization_id:org,store_id:store},
      version:{
        ...common,
        id:versionId,
        quote_id:quoteId,
        store_file_id:fileId,
        status:"approved",
      },
      file:{
        ...common,
        id:fileId,
        file_kind:"sales_quote_pdf",
      },
      rpcError:null,
      rpcPatch:{},
      recipientPatch:{},
      access:{
        ok:true,
        sessionUserId:actor,
        organizationId:org,
        storeId:store,
        resolution:{
          status:"store_ready_active",
        },
      },
    };

    function client(session) {

      return {
        from(table) {
          calls.push(["from",session,table]);

          const query={
            select() { return query; },
            eq(key,value) {
              calls.push(["eq",session,table,key,value]);
              return query;
            },
            async maybeSingle() {
              const data=session
                ? state.visible
                : table==="sales_quote_versions"
                  ? state.version
                  : state.file;

              return {data,error:null};
            }
          };

          return query;
        },

        async rpc(name,params) {
          assert.equal(session,false);
          calls.push(["rpc",name,params]);

          if(state.rpcError) {
            return {data:null,error:state.rpcError};
          }

          return {
            error:null,
            data:{
              outcome:"registered",
              operation_id:params.p_operation_id,
              operation_key:params.p_operation_key,
              quote_id:params.p_quote_id,
              quote_version_id:params.p_quote_version_id,
              recipient_kind:params.p_recipient_kind,
              status:"registered",
              status_reason:null,
              created_at:"2026-11-25T12:00:00Z",
              ...state.rpcPatch,
            }
          };
        }
      };
    }

    const scope={
      user:{id:actor},
      organizationIds:[org],
      organizationId:org,
      store:{id:store,organization_id:org},
      quote,
      supabase:client(false),
      sessionSupabase:client(true),
    };

    const module=load(source,name=>{
      if(name==="./human-quote-send-contract")return contract;
      if(name==="./human-quote-send-pdf")return pdf;
      if(name==="./human-quote-edit-provenance")return provenance;

      if(name==="../store-api-access")return {
        async resolveStoreApiAccess(args) {
          calls.push(["store_access",args.requirement]);
          assert.equal(args.requirement,"active");
          return state.access;
        }
      };

      if(name==="./quote-auth")return {
        async resolveAuthorizedExistingQuote(value) {
          calls.push(["auth",value]);
          assert.equal(value,quoteId);
          if(state.authError)throw state.authError;
          return scope;
        }
      };

      if(name==="./human-quote-send-recipient")return {
        async resolveHumanQuoteSendRecipient(args) {
          calls.push(["recipient",args.recipient.kind]);
          assert.equal(args.organizationId,org);
          assert.equal(args.storeId,store);

          return {
            kind:args.recipient.kind,
            leadId:args.recipient.kind==="lead"?leadId:null,
            responsibleId:
              args.recipient.kind==="responsible"
                ?responsibleId:null,
            candidatePhone:phone,
            ...state.recipientPatch,
          };
        }
      };

      throw new Error("UNEXPECTED_IMPORT: "+name);
    });

    return {
      body,state,scope,calls,
      execute:()=>module.registerHumanQuoteSend({quoteId,body}),
      rpcCalls:()=>calls.filter(c=>c[0]==="rpc"),
    };
  }

  async function check(name,fn) {
    await fn();
    count++;
    console.log("ok - "+name);
  }

  async function denied(change,code) {
    const x=fixture();

    change(x);

    await assert.rejects(
      x.execute,
      code?e=>e.code===code:undefined
    );

    assert.equal(x.rpcCalls().length,0);
  }

  for(const kind of ["phone","lead","responsible"]) {

    await check("registration uses authoritative scope: "+kind,async()=>{
      const x=fixture();

      x.body.recipient =
        kind==="lead"?{kind,leadId}:
        kind==="responsible"?{kind}:{kind,phone};

      const result=await x.execute();

      assert.equal(result.status,"registered");
      assert.equal(result.recipientKind,kind);
      assert.equal(x.rpcCalls().length,1);

      const [,name,p]=x.rpcCalls()[0];

      assert.equal(
        name,"register_human_quote_send_operation_by_system"
      );

      assert.equal(p.p_organization_id,org);
      assert.equal(p.p_store_id,store);
      assert.equal(p.p_actor_user_id,actor);
      assert.equal(p.p_quote_id,quoteId);
      assert.equal(p.p_quote_version_id,versionId);
      assert.equal(p.p_operation_id,operationId);
      assert.equal(p.p_destination_phone,phone);

      assert.equal(
        p.p_recipient_lead_id,
        kind==="lead"?leadId:null
      );

      assert.equal(
        p.p_recipient_responsible_id,
        kind==="responsible"?responsibleId:null
      );

      const identity=contract.buildHumanQuoteSendIdentity(
        {
          organizationId:org,
          storeId:store,
          actorUserId:actor,
          quoteId,
        },
        x.body
      );

      assert.equal(p.p_operation_key,identity.operationKey);
      assert.equal(
        p.p_request_fingerprint,identity.requestFingerprint
      );

      for(const field of [
        "destinationPhone","storagePath",
        "attemptToken","operationKey"
      ]) {
        assert.equal(Object.hasOwn(result,field),false);
      }

    });
  }

  await check("caller cannot override actor",async()=>{
    await denied(x=>{x.body.actorUserId=id(99);});
  });

  await check("authentication failure prevents registration",async()=>{
    await denied(x=>{
      x.state.authError=new Error("UNAUTHENTICATED");
    });
  });

  await check("scope mismatch prevents registration",async()=>{
    await denied(
      x=>{x.scope.store.organization_id=id(99);},
      "HUMAN_QUOTE_SEND_AUTHORIZED_SCOPE_MISMATCH"
    );
  });

  await check("session visibility is required",async()=>{
    await denied(
      x=>{x.state.visible=null;},
      "HUMAN_QUOTE_SEND_SESSION_SCOPE_DENIED"
    );
  });

  await check("foreign session row is rejected",async()=>{
    await denied(
      x=>{x.state.visible.store_id=id(99);},
      "HUMAN_QUOTE_SEND_SESSION_SCOPE_DENIED"
    );
  });

  await check("legacy edit marker does not grant registration",async()=>{
    await denied(x=>{
      x.state.quote.metadata={
        legacy_human_edit_eligible:true
      };
    });
  });

  await check("stale version prevents registration",async()=>{
    await denied(
      x=>{x.state.quote.current_version_id=id(99);},
      "HUMAN_QUOTE_SEND_VERSION_STALE"
    );
  });

  await check("failed version prevents registration",async()=>{
    await denied(
      x=>{x.state.version.status="failed";},
      "HUMAN_QUOTE_SEND_VERSION_UNAVAILABLE"
    );
  });

  await check("foreign version prevents registration",async()=>{
    await denied(
      x=>{x.state.version.quote_id=id(99);},
      "HUMAN_QUOTE_SEND_VERSION_SCOPE_MISMATCH"
    );
  });

  await check("wrong file identity prevents registration",async()=>{
    await denied(
      x=>{x.state.file.storage_path="https://example.invalid/a.pdf";},
      "HUMAN_QUOTE_SEND_PDF_PATH_MISMATCH"
    );
  });

  await check("recipient substitution is rejected",async()=>{
    await denied(
      x=>{x.state.recipientPatch.candidatePhone="+5511999991235";},
      "HUMAN_QUOTE_SEND_RECIPIENT_MISMATCH"
    );
  });

  await check("existing accepted operation remains accepted",async()=>{
    const x=fixture();

    x.state.rpcPatch={
      outcome:"existing_operation",
      status:"accepted",
      attempt_token:id(99),
    };

    const result=await x.execute();

    assert.equal(result.status,"accepted");
    assert.equal(result.outcome,"existing_operation");
    assert.equal(Object.hasOwn(result,"attempt_token"),false);
    assert.equal(x.rpcCalls().length,1);
  });

  await check("RPC business conflict is preserved",async()=>{
    const x=fixture();

    x.state.rpcError={
      code:"P0001",
      message:"HUMAN_QUOTE_SEND_OPERATION_CONFLICT",
    };

    await assert.rejects(
      x.execute,
      e=>e.code==="HUMAN_QUOTE_SEND_OPERATION_CONFLICT"
    );

    assert.equal(x.rpcCalls().length,1);
  });

  await check("private database errors are sanitized",async()=>{
    const x=fixture();

    x.state.rpcError={
      code:"42501",
      message:"private database detail",
    };

    await assert.rejects(
      x.execute,
      e=>e.code==="HUMAN_QUOTE_SEND_REGISTRATION_FAILED"
    );
  });

  await check("foreign RPC response is rejected",async()=>{
    const x=fixture();

    x.state.rpcPatch={quote_id:id(99)};

    await assert.rejects(
      x.execute,
      e=>e.code==="HUMAN_QUOTE_SEND_REGISTRATION_RESPONSE_INVALID"
    );
  });

  await check("invalid operation status is rejected",async()=>{
    const x=fixture();

    x.state.rpcPatch={status:"delivered"};

    await assert.rejects(
      x.execute,
      e=>e.code==="HUMAN_QUOTE_SEND_REGISTRATION_RESPONSE_INVALID"
    );
  });

  await check("commercial access denial blocks privileged lookup",async()=>{
    const x=fixture();

    x.state.access={
      ok:false,
      httpStatus:403,
    };

    await assert.rejects(
      x.execute,
      e=>e.code==="HUMAN_QUOTE_SEND_STORE_ACCESS_DENIED"
        && e.status===403
    );

    assert.equal(x.rpcCalls().length,0);

    assert.equal(
      x.calls.some(c=>c[0]==="auth"),
      false
    );

    assert.equal(
      x.calls.some(c=>c[0]==="from"),
      false
    );
  });

  await check("onboarding is not active commercial access",async()=>{
    await denied(
      x=>{
        x.state.access.resolution.status=
          "store_ready_onboarding_required";
      },
      "HUMAN_QUOTE_SEND_STORE_ACCESS_DENIED"
    );
  });

  await check("different authenticated actor is blocked",async()=>{
    await denied(
      x=>{x.state.access.sessionUserId=id(99);},
      "HUMAN_QUOTE_SEND_STORE_ACCESS_SCOPE_MISMATCH"
    );
  });

  await check("different authorized organization is blocked",async()=>{
    await denied(
      x=>{x.state.access.organizationId=id(99);},
      "HUMAN_QUOTE_SEND_STORE_ACCESS_SCOPE_MISMATCH"
    );
  });

  await check("different authorized store is blocked",async()=>{
    await denied(
      x=>{x.state.access.storeId=id(99);},
      "HUMAN_QUOTE_SEND_STORE_ACCESS_SCOPE_MISMATCH"
    );
  });

  assert.equal(count,24);

  console.log("HUMAN_QUOTE_SEND_REGISTRATION: 24/24 PASS");
}

module.exports=run;

if(require.main===module) {
  run(
    fs.readFileSync(
      root+"/human-quote-send-registration.ts","utf8"
    )
  ).catch(error=>{
    console.error(error);
    process.exitCode=1;
  });
}
