const fs=require("node:fs");
const path=require("node:path");
const assert=require("node:assert/strict");
const test=require("node:test");
const ts=require("typescript");

const source=fs.readFileSync(
  path.join(__dirname,"route-handler.ts"),
  "utf8"
);

const ast=ts.createSourceFile(
  "route-handler.ts",
  source,
  ts.ScriptTarget.Latest,
  true
);

const names=[
  "buildStoredPayload",
  "insertExternalWebhookAudit",
  "processVerifiedHumanQuoteStatusIngress",
  "zionBackendOriginalPOST",
  "isDuplicateInsertError"
];

const functions=names.map(name=>{

  const found=ast.statements.filter(n=>
    ts.isFunctionDeclaration(n) &&
    n.name?.text===name
  );

  assert.equal(found.length,1,name);

  return found[0].getText(ast);
});

const compiled=ts.transpileModule(
  functions.join("\n")+
  "\nreturn {zionBackendOriginalPOST,buildStoredPayload};",
  {
    compilerOptions:{
      target:ts.ScriptTarget.ES2022,
      module:ts.ModuleKind.CommonJS
    }
  }
).outputText;

const id=n=>
  "00000000-0000-4000-8000-"+
  String(n).padStart(12,"0");

const original={
  organization_id:id(1),
  store_id:id(2),
  actor_user_id:id(3),
  operation_id:id(4)
};

const active={
  id:id(10),
  organization_id:id(11),
  store_id:id(12),
  phone_number_id:"123456789",
  whatsapp_business_account_id:"987654321"
};

const event={
  eventKind:"status",
  externalEventId:"status:synthetic-wamid:delivered:1795608030",
  phoneNumberId:"123456789",
  entryId:"987654321",
  changeField:"messages",
  whatsappBusinessAccountId:null,
  message:null,
  status:{
    id:"synthetic-wamid",
    status:"delivered",
    timestamp:"1795608030",
    recipient_id:"5511999990000"
  },
  change:{synthetic:true}
};

const resolver="resolve_human_quote_status_ingress_by_system";
const recoverer="recover_human_quote_status_ingress_by_system";

const matched={
  outcome:"matched",
  reason:"ORIGINAL_ACCEPTED_OPERATION_PROVEN",
  ...original
};

const unmatched={
  outcome:"unmatched",
  reason:"ACCEPTED_OPERATION_NOT_FOUND"
};

const rejected={
  outcome:"rejected",
  reason:"ORIGINAL_OPERATION_EVIDENCE_INVALID"
};

function fixture(options={}){

  const calls=[];

  const currentEvent=options.event || event;

  const integration=options.integration===undefined
    ? active
    : options.integration;

  const resolution=options.resolution || matched;

  let stored=options.before || null;

  const expectedRow={
    id:id(90),
    store_id:original.store_id,
    provider:"meta",
    payload:{
      source:"meta_whatsapp_webhook",
      event_kind:"status",
      phone_number_id:event.phoneNumberId,
      status:event.status
    }
  };

  const supabase={

    async rpc(name,args){

      calls.push([name,args]);

      if(name===resolver){

        const auditPersisted=calls.some(c=>
          c[0]==="insert" &&
          c[1]==="external_webhooks"
        );

        return {
          error:(
            auditPersisted
              ? options.afterAuditResolveError
              : options.resolveError
          ) || null,

          data:auditPersisted
            ? options.afterAuditResolution || resolution
            : resolution
        };
      }

      assert.equal(name,recoverer);

      if(!options.recoverError &&
         !options.noRecoveredRow &&
         !options.recovery){

        stored=stored || expectedRow;
      }

      return {
        error:options.recoverError || null,
        data:options.recovery || {
          outcome:options.before?"unchanged":"recovered",
          reason:"SCOPED_STATUS_INGRESS_RECOVERY",
          recovered_count:options.before?0:1,
          existing_count:options.before?1:0,
          conflict_count:0
        }
      };
    },

    from(table){

      return {

        async insert(row){

          calls.push(["insert",table,row]);

          return {
            error:table==="external_webhooks"
              ? options.auditError || null
              : null
          };
        },

        select(columns){

          assert.equal(table,"channel_whatsapp_inbox");
          assert.equal(columns,"id,store_id,provider,payload");

          const filters={};

          const query={

            eq(column,value){

              filters[column]=value;

              return query;
            },

            async maybeSingle(){

              calls.push(["lookup",filters]);

              assert.deepEqual(filters,{
                organization_id:original.organization_id,
                external_event_id:event.externalEventId
              });

              return {data:stored,error:null};
            }
          };

          return query;
        }
      };
    }
  };

  const bindings={

    isRecord:value=>
      value!==null &&
      typeof value==="object" &&
      !Array.isArray(value),

    toJson:value=>value,

    process:{
      env:{
        META_APP_SECRET:
          options.secret===false?"":"synthetic-secret"
      }
    },

    verifyMetaSignature:()=>
      options.validSignature!==false,

    isProductionEnvironment:()=>
      options.production!==false,

    getSupabaseAdmin:()=>supabase,

    findWhatsappIntegrationByPhoneNumberId:
      async()=>integration,

    extractEventsFromPayload:
      ()=>[currentEvent],

    safeWebhookError:(error,status)=>({
      ok:false,error,status
    }),

    buildJsonResponse:(data,status=200)=>({
      ...data,status
    }),

    console:{error(){}}
  };

  const loaded=new Function(
    ...Object.keys(bindings),
    compiled
  )(...Object.values(bindings));

  const run=()=>loaded.zionBackendOriginalPOST({

    headers:{
      get:()=>options.missingSignature
        ? ""
        : "synthetic-signature"
    },

    text:async()=>JSON.stringify({
      synthetic_private_content:"must_not_copy"
    })
  });

  const inserts=table=>calls.filter(
    c=>c[0]==="insert" && c[1]===table
  );

  return {run,calls,inserts,loaded,expectedRow};
}

test("old channel without integration resolves original operation",async()=>{

  const h=fixture({integration:null});

  const result=await h.run();

  assert.equal(result.saved,1);
  assert.equal(result.unresolved,0);

  assert.deepEqual(
    h.calls.find(c=>c[0]===recoverer)[1],
    {
      p_organization_id:original.organization_id,
      p_store_id:original.store_id,
      p_actor_user_id:original.actor_user_id,
      p_operation_id:original.operation_id
    }
  );

  assert.equal(
    h.inserts("channel_whatsapp_inbox").length,
    0
  );
});

test("reassigned number never uses new tenant scope",async()=>{

  const h=fixture();

  assert.equal((await h.run()).saved,1);

  const audit=h.inserts("external_webhooks")[0][2];

  assert.equal(audit.organization_id,null);
  assert.equal(audit.store_id,null);

  assert.equal(
    audit.payload.human_quote_signature_verified_v1,
    true
  );

  assert.equal(
    h.inserts("channel_whatsapp_inbox").length,
    0
  );
});

test("same tenant retains normal audit scope",async()=>{

  const h=fixture({
    integration:{
      ...active,
      organization_id:original.organization_id,
      store_id:original.store_id
    }
  });

  assert.equal((await h.run()).saved,1);

  const audit=h.inserts("external_webhooks")[0][2];

  assert.equal(
    audit.organization_id,
    original.organization_id
  );

  assert.equal(audit.store_id,original.store_id);
});

test("raw audit is persisted before recovery",async()=>{

  const h=fixture();

  await h.run();

  const auditIndex=h.calls.findIndex(c=>
    c[0]==="insert" && c[1]==="external_webhooks"
  );

  const recoveryIndex=h.calls.findIndex(c=>
    c[0]===recoverer
  );

  assert.ok(auditIndex>=0);
  assert.ok(recoveryIndex>auditIndex);
});

test("failed audit cannot proceed to recovery",async()=>{

  const h=fixture({
    auditError:{message:"synthetic failure"}
  });

  assert.equal((await h.run()).status,500);

  assert.ok(!h.calls.some(c=>c[0]===recoverer));
});

test("known invalid evidence never falls through",async()=>{

  const h=fixture({resolution:rejected});

  const result=await h.run();

  assert.equal(result.unresolved,1);
  assert.equal(result.saved,0);

  assert.ok(!h.calls.some(c=>c[0]===recoverer));

  assert.equal(
    h.inserts("channel_whatsapp_inbox").length,
    0
  );
});

test("unmatched normal status retains existing path",async()=>{

  const h=fixture({resolution:unmatched});

  const result=await h.run();

  assert.equal(result.saved,1);

  const rows=h.inserts("channel_whatsapp_inbox");

  assert.equal(rows.length,1);
  assert.equal(rows[0][2].store_id,active.store_id);

  assert.equal(h.inserts("external_webhooks").length,1);
});

test("unmatched old channel retains raw evidence",async()=>{

  const h=fixture({
    resolution:unmatched,
    integration:null
  });

  const result=await h.run();

  assert.equal(result.unresolved,1);

  assert.equal(h.inserts("external_webhooks").length,1);

  assert.equal(
    h.inserts("channel_whatsapp_inbox").length,
    0
  );
});

test("invalid signature cannot persist evidence",async()=>{

  const h=fixture({validSignature:false});

  assert.equal((await h.run()).status,401);

  assert.deepEqual(h.calls,[]);
});

test("missing signature cannot persist evidence",async()=>{

  const h=fixture({missingSignature:true});

  assert.equal((await h.run()).status,401);

  assert.deepEqual(h.calls,[]);
});

test("missing production secret fails closed",async()=>{

  const h=fixture({secret:false});

  assert.equal((await h.run()).status,500);

  assert.deepEqual(h.calls,[]);
});

test("unsigned development status never gains verified marker",async()=>{

  const h=fixture({
    secret:false,
    production:false
  });

  assert.equal((await h.run()).saved,1);

  const audit=h.inserts("external_webhooks")[0][2];

  assert.ok(
    !Object.hasOwn(
      audit.payload,
      "human_quote_signature_verified_v1"
    )
  );

  assert.ok(!h.calls.some(c=>c[0]===resolver));
});

for(const kind of [
  "message",
  "message_echo",
  "history"
]){

  test(kind+" preserves conventional path",async()=>{

    const h=fixture({
      event:{
        ...event,
        eventKind:kind,
        status:null
      }
    });

    const result=await h.run();

    assert.equal(result.status,200);

    assert.ok(!h.calls.some(c=>c[0]===resolver));
    assert.ok(!h.calls.some(c=>c[0]===recoverer));

    const audit=h.inserts("external_webhooks")[0][2];

    assert.ok(
      !Object.hasOwn(
        audit.payload,
        "human_quote_signature_verified_v1"
      )
    );

    assert.equal(
      h.inserts("channel_whatsapp_inbox").length,
      kind==="history"?0:1
    );
  });
}

test("recovery RPC failure triggers webhook failure",async()=>{

  const h=fixture({
    recoverError:{message:"synthetic failure"}
  });

  assert.equal((await h.run()).status,500);

  assert.equal(
    h.inserts("channel_whatsapp_inbox").length,
    0
  );
});

test("resolution RPC failure triggers webhook failure",async()=>{

  const h=fixture({
    resolveError:{message:"synthetic failure"}
  });

  assert.equal((await h.run()).status,500);
});

test("malformed original scope cannot route",async()=>{

  const h=fixture({
    resolution:{
      ...matched,
      store_id:"invalid"
    }
  });

  assert.equal((await h.run()).status,500);

  assert.ok(!h.calls.some(c=>c[0]===recoverer));
});

test("batch count cannot substitute exact event evidence",async()=>{

  const h=fixture({noRecoveredRow:true});

  assert.equal((await h.run()).status,500);
});

test("exact existing event is an idempotent replay",async()=>{

  const initial=fixture();

  const h=fixture({before:initial.expectedRow});

  const result=await h.run();

  assert.equal(result.duplicates,1);
  assert.equal(result.saved,0);
});

test("foreign-store event collision is preserved",async()=>{

  const initial=fixture();

  const h=fixture({
    before:{
      ...initial.expectedRow,
      store_id:active.store_id
    }
  });

  assert.equal((await h.run()).unresolved,1);

  assert.ok(!h.calls.some(c=>c[0]===recoverer));
});

test("malformed recovery result is rejected",async()=>{

  const h=fixture({
    recovery:{
      outcome:"recovered",
      reason:"SCOPED_STATUS_INGRESS_RECOVERY",
      recovered_count:0,
      existing_count:0,
      conflict_count:0
    }
  });

  assert.equal((await h.run()).status,500);
});

test("diagnostic wrappers remain connected",()=>{

  assert.ok(source.includes(
    'const zionBackendObservedPOST = withBackendDiagnosticRoute('
  ));

  assert.ok(source.includes(
    'return zionBackendObservedPOST(request);'
  ));

  assert.ok(source.includes(
    'return zionBackendObservedGET(request);'
  ));
});



test("acceptance between first lookup and audit persistence",async()=>{

  const h=fixture({
    resolution:unmatched,
    afterAuditResolution:matched
  });

  const result=await h.run();

  assert.equal(result.status,200);
  assert.equal(result.saved,1);
  assert.equal(result.unresolved,0);

  assert.equal(
    h.inserts("channel_whatsapp_inbox").length,0
  );

  const audit=h.inserts("external_webhooks");

  assert.equal(audit.length,1);
  assert.equal(audit[0][2].organization_id,null);
  assert.equal(audit[0][2].store_id,null);

  const rpcNames=h.calls
    .filter(c=>c[0]===resolver || c[0]===recoverer)
    .map(c=>c[0]);

  assert.deepEqual(
    rpcNames,
    [resolver,resolver,recoverer]
  );

  const auditIndex=h.calls.findIndex(c=>
    c[0]==="insert" && c[1]==="external_webhooks"
  );

  const secondLookup=h.calls.findLastIndex(
    c=>c[0]===resolver
  );

  assert.ok(secondLookup>auditIndex);

  assert.deepEqual(
    h.calls.find(c=>c[0]===recoverer)[1],
    {
      p_organization_id:original.organization_id,
      p_store_id:original.store_id,
      p_actor_user_id:original.actor_user_id,
      p_operation_id:original.operation_id
    }
  );
});

test("late rejected evidence never falls through",async()=>{

  const h=fixture({
    resolution:unmatched,
    afterAuditResolution:rejected
  });

  const result=await h.run();

  assert.equal(result.status,200);
  assert.equal(result.unresolved,1);
  assert.equal(result.saved,0);

  assert.ok(!h.calls.some(c=>c[0]===recoverer));

  assert.equal(
    h.inserts("channel_whatsapp_inbox").length,0
  );
});

test("ordinary unmatched status retains conventional inbox route",async()=>{

  const h=fixture({
    resolution:unmatched,
    afterAuditResolution:unmatched
  });

  const result=await h.run();

  assert.equal(result.status,200);
  assert.equal(result.saved,1);

  assert.equal(
    h.calls.filter(c=>c[0]===resolver).length,2
  );

  assert.equal(
    h.inserts("external_webhooks").length,1
  );

  assert.equal(
    h.inserts("channel_whatsapp_inbox")[0][2].store_id,
    active.store_id
  );

  assert.ok(!h.calls.some(c=>c[0]===recoverer));
});

test("failed second lookup retains audit and denies fallback",async()=>{

  const h=fixture({
    resolution:unmatched,
    afterAuditResolveError:{
      message:"synthetic lookup failure"
    }
  });

  assert.equal((await h.run()).status,500);

  assert.equal(
    h.inserts("external_webhooks").length,1
  );

  assert.equal(
    h.inserts("channel_whatsapp_inbox").length,0
  );

  assert.ok(!h.calls.some(c=>c[0]===recoverer));
});
