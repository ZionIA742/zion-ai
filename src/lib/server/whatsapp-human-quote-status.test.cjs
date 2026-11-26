const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const test = require("node:test");
const ts = require("typescript");

const file = path.join(
  __dirname,
  "whatsapp-inbox-processor.ts"
);

const source = fs.readFileSync(file,"utf8");

const ast = ts.createSourceFile(
  file,
  source,
  ts.ScriptTarget.Latest,
  true
);

const names = [
  "processHumanQuoteStatusEvidence",
  "processStatusInboxRow"
];

const extracted = names.map(name => {

  const node = ast.statements.find(n =>
    ts.isFunctionDeclaration(n) &&
    n.name?.text === name
  );

  assert.ok(node,name);

  return node.getText(ast);

}).join("\n");

const compiled = ts.transpileModule(
  extracted + "\nreturn processStatusInboxRow;",
  {
    compilerOptions:{
      target:ts.ScriptTarget.ES2022,
      module:ts.ModuleKind.CommonJS
    }
  }
).outputText;

const op = "11111111-1111-4111-8111-111111111111";
const actor = "22222222-2222-4222-8222-222222222222";
const messageId = "33333333-3333-4333-8333-333333333333";

const inbox = {
  id:"inbox-test",
  organization_id:"org-test",
  store_id:"store-test",
  external_event_id:"status-test"
};

const unmatched = {
  outcome:"unmatched",
  reason:"NO_ACCEPTED_HUMAN_QUOTE_OPERATION"
};

const match = kind => ({
  outcome:"matched",
  reason:"PROVEN_HUMAN_QUOTE_STATUS_EVENT",
  operation_id:op,
  actor_user_id:actor,
  recipient_kind:kind,
  status_value:"delivered",
  status_at:"2026-11-25T12:00:00Z"
});

const projected = {
  outcome:"projected",
  reason:"DELIVERY_EVIDENCE_RECONCILED",
  message_id:messageId,
  delivery_status:"delivered",
  evidence_count:1
};

function setup(opts={}){

  const calls=[];

  const identities=[
    ...(opts.identities || [unmatched])
  ];

  const supabase={

    from(table){

      assert.equal(table,"channel_whatsapp_inbox");

      calls.push(["persisted_lookup",table]);

      const query={

        select(columns){

          assert.equal(
            columns,
            "processed_at, processing_error"
          );

          return query;
        },

        eq(column,value){

          calls.push(["persisted_filter",column,value]);

          return query;
        },

        async maybeSingle(){

          return {
            error:opts.persistedError || null,
            data:opts.persisted === undefined
              ? {
                  processed_at:"2026-11-25T12:01:00Z",
                  processing_error:null
                }
              : opts.persisted
          };
        }
      };

      return query;
    },

    async rpc(name,args){

      calls.push([name,args]);

      if(name==="identify_human_quote_status_event_by_system"){

        if(opts.identityError){
          return {error:{message:"mock-error"}};
        }

        return {
          data:identities.length>1
            ? identities.shift()
            : identities[0],
          error:null
        };
      }

      if(
        name==="reconcile_human_quote_status_inbox_by_system"
      ){

        if(opts.reconciliationThrows){
          throw new Error("mock reconciliation failure");
        }

        return {
          error:opts.reconciliationError || null,
          data:opts.reconciliation || {
            outcome:"reconciled",
            reason:"SCOPED_STATUS_RECONCILIATION",
            reconciled_count:1
          }
        };
      }

      assert.equal(
        name,
        "project_human_quote_history_delivery_by_system"
      );

      return {
        data:opts.projection || projected,
        error:opts.projectionError
          ? {message:"mock-error"}
          : null
      };
    }
  };

  const dependencies={

    isRecord:x =>
      x!==null &&
      typeof x==="object" &&
      !Array.isArray(x),

    extractIncomingStatus:()=>({
      statusId:"wamid-test",
      statusValue:"delivered",
      statusTimestampIso:"2026-11-25T12:00:00Z"
    }),

    buildStatusProcessingError:x=>x,

    markInboxError:async(...args)=>{
      calls.push(["error",args[2]]);
    },

    markInboxProcessed:async()=>{
      calls.push(["processed"]);
    },

    findMessageByExternalIdForStatus:async()=>{
      calls.push(["legacy_lookup"]);
      return opts.message || null;
    },

    findResponsibleExternalNotificationByExternalIdForStatus:async()=>{
      calls.push(["notification_lookup"]);
      return opts.notification || null;
    },

    updateResponsibleExternalWhatsappStatus:async()=>{
      calls.push(["notification_update"]);
    },

    updateMessageWhatsappStatus:async()=>{
      calls.push(["legacy_update"]);
    }
  };

  const process=new Function(
    ...Object.keys(dependencies),
    compiled
  )(...Object.values(dependencies));

  return {
    calls,
    run:()=>process(supabase,inbox,{}),
    count:name=>calls.filter(c=>c[0]===name).length
  };
}

for(const kind of ["phone","responsible"]){

  test(kind+" recognized without CRM message",async()=>{

    const h=setup({identities:[match(kind)]});

    const r=await h.run();

    assert.equal(r.status,"succeeded");
    assert.equal(h.count("processed"),1);
    assert.equal(h.count("legacy_lookup"),0);

    assert.equal(
      h.count("project_human_quote_history_delivery_by_system"),
      0
    );
  });
}

test("lead projection exact scope",async()=>{

  const h=setup({identities:[match("lead")]});

  const r=await h.run();

  assert.equal(r.message_id,messageId);
  assert.equal(h.count("processed"),1);

  assert.deepEqual(h.calls[0][1],{
    p_organization_id:inbox.organization_id,
    p_store_id:inbox.store_id,
    p_inbox_id:inbox.id
  });

  assert.deepEqual(h.calls[1][1],{
    p_organization_id:inbox.organization_id,
    p_store_id:inbox.store_id,
    p_actor_user_id:actor,
    p_operation_id:op
  });

  assert.equal(h.count("legacy_update"),0);
});

test("duplicate projection accepted",async()=>{

  const h=setup({
    identities:[match("lead")],
    projection:{...projected,outcome:"unchanged"}
  });

  assert.equal((await h.run()).status,"succeeded");
  assert.equal(h.count("processed"),1);
});

test("pending history retains evidence",async()=>{

  const h=setup({
    identities:[match("lead")],
    projection:{
      outcome:"pending",
      reason:"HISTORY_PROJECTION_PENDING"
    }
  });

  assert.equal(
    (await h.run()).detail,
    "human_quote_status_pending"
  );

  assert.equal(h.count("processed"),1);
  assert.equal(h.count("legacy_update"),0);
});

test("skipped history does not create a message",async()=>{

  const h=setup({
    identities:[match("lead")],
    projection:{
      outcome:"not_applicable",
      reason:"HISTORY_PROJECTION_SKIPPED"
    }
  });

  assert.equal((await h.run()).status,"succeeded");
  assert.equal(h.count("legacy_update"),0);
});

test("invalid provider evidence never falls through",async()=>{

  const h=setup({
    identities:[{
      outcome:"rejected",
      reason:"HUMAN_QUOTE_EVENT_EVIDENCE_INVALID"
    }]
  });

  assert.equal((await h.run()).status,"failed");
  assert.equal(h.count("error"),1);
  assert.equal(h.count("processed"),0);
  assert.equal(h.count("legacy_lookup"),0);
});

test("identity RPC failure closes path",async()=>{

  const h=setup({identityError:true});

  await assert.rejects(
    h.run(),
    /HUMAN_QUOTE_STATUS_IDENTITY_RPC_FAILED/
  );

  assert.equal(h.count("legacy_lookup"),0);
  assert.equal(h.count("processed"),0);
});

test("malformed identity fails closed",async()=>{

  const h=setup({
    identities:[{
      ...match("lead"),
      operation_id:"invalid"
    }]
  });

  await assert.rejects(
    h.run(),
    /HUMAN_QUOTE_STATUS_IDENTITY_INVALID/
  );

  assert.equal(h.count("legacy_lookup"),0);
});

test("missing persisted inbox fails closed",async()=>{

  const h=setup({
    identities:[{
      outcome:"not_found",
      reason:"SCOPED_INBOX_EVENT_NOT_FOUND"
    }]
  });

  await assert.rejects(
    h.run(),
    /HUMAN_QUOTE_STATUS_IDENTITY_INVALID/
  );

  assert.equal(h.count("processed"),0);
});

test("projection RPC failure does not finalize",async()=>{

  const h=setup({
    identities:[match("lead")],
    projectionError:true
  });

  await assert.rejects(
    h.run(),
    /HUMAN_QUOTE_STATUS_PROJECTION_FAILED/
  );

  assert.equal(h.count("processed"),0);
  assert.equal(h.count("legacy_update"),0);
});

test("invalid projection fails closed",async()=>{

  const h=setup({
    identities:[match("lead")],
    projection:{
      outcome:"projected",
      reason:"unexpected"
    }
  });

  await assert.rejects(
    h.run(),
    /HUMAN_QUOTE_STATUS_PROJECTION_INVALID/
  );

  assert.equal(h.count("processed"),0);
});

test("conventional message unchanged",async()=>{

  const h=setup({
    message:{
      id:messageId,
      metadata:{source:"legacy"}
    }
  });

  assert.equal((await h.run()).status,"succeeded");
  assert.equal(h.count("legacy_update"),1);
  assert.equal(h.count("processed"),1);
});

test("legacy responsible notification unchanged",async()=>{

  const h=setup({
    notification:{id:"notification"}
  });

  assert.equal((await h.run()).status,"succeeded");
  assert.equal(h.count("notification_update"),1);
  assert.equal(h.count("processed"),1);
});

test("unrelated missing message preserves legacy failure",async()=>{

  const h=setup();

  assert.equal(
    (await h.run()).detail,
    "status_message_not_found_by_external_message_id"
  );

  assert.equal(h.count("error"),1);
  assert.equal(h.count("processed"),0);
});

test("late acceptance recovered before missing-message failure",async()=>{

  const h=setup({
    identities:[unmatched,match("phone")]
  });

  assert.equal((await h.run()).status,"succeeded");
  assert.equal(h.count("error"),0);
  assert.equal(h.count("processed"),1);
});

test("late history never uses conventional updater",async()=>{

  const h=setup({
    identities:[unmatched,match("lead")],
    message:{
      id:messageId,
      metadata:{source:"human_quote_send_history"}
    }
  });

  assert.equal((await h.run()).status,"succeeded");
  assert.equal(h.count("legacy_update"),0);
});

test("unresolved independent history fails closed",async()=>{

  const h=setup({
    message:{
      id:messageId,
      metadata:{source:"human_quote_send_history"}
    }
  });

  await assert.rejects(
    h.run(),
    /HUMAN_QUOTE_HISTORY_IDENTITY_UNRESOLVED/
  );

  assert.equal(h.count("legacy_update"),0);
  assert.equal(h.count("processed"),0);
});



test("acceptance after failure reconciles exact event",async()=>{

  const h=setup({
    identities:[unmatched,unmatched,match("phone")]
  });

  const r=await h.run();

  assert.equal(r.status,"succeeded");

  assert.equal(
    r.detail,
    "human_quote_status_reconciled_after_failure"
  );

  assert.equal(h.count("error"),1);
  assert.equal(h.count("processed"),0);
  assert.equal(h.count("legacy_update"),0);

  const rpc=h.calls.find(c=>
    c[0]==="reconcile_human_quote_status_inbox_by_system"
  );

  assert.deepEqual(rpc[1],{
    p_organization_id:inbox.organization_id,
    p_store_id:inbox.store_id,
    p_actor_user_id:actor,
    p_operation_id:op
  });

  assert.deepEqual(
    h.calls.filter(c=>c[0]==="persisted_filter"),
    [
      [
        "persisted_filter",
        "organization_id",
        inbox.organization_id
      ],
      [
        "persisted_filter",
        "store_id",
        inbox.store_id
      ],
      ["persisted_filter","id",inbox.id]
    ]
  );
});

test("lead projection precedes post-failure reconciliation",async()=>{

  const h=setup({
    identities:[unmatched,unmatched,match("lead")]
  });

  const r=await h.run();

  assert.equal(r.status,"succeeded");
  assert.equal(r.message_id,messageId);

  const projection=h.calls.findIndex(c=>
    c[0]==="project_human_quote_history_delivery_by_system"
  );

  const reconciliation=h.calls.findIndex(c=>
    c[0]==="reconcile_human_quote_status_inbox_by_system"
  );

  assert.ok(projection>=0);
  assert.ok(reconciliation>projection);

  assert.equal(h.count("processed"),0);
});

test("responsible acceptance recovered without CRM projection",async()=>{

  const h=setup({
    identities:[unmatched,unmatched,match("responsible")]
  });

  assert.equal((await h.run()).status,"succeeded");

  assert.equal(
    h.count("project_human_quote_history_delivery_by_system"),
    0
  );

  assert.equal(h.count("processed"),0);
});

test("concurrent reconciliation already completed is accepted",async()=>{

  const h=setup({
    identities:[unmatched,unmatched,match("phone")],

    reconciliation:{
      outcome:"unchanged",
      reason:"SCOPED_STATUS_RECONCILIATION",
      reconciled_count:0
    }
  });

  assert.equal((await h.run()).status,"succeeded");

  assert.equal(h.count("processed"),0);
});

test("batch count does not prove current event recovery",async()=>{

  const h=setup({
    identities:[unmatched,unmatched,match("phone")],

    persisted:{
      processed_at:null,
      processing_error:"status_message_not_found_by_external_message_id"
    }
  });

  assert.equal((await h.run()).status,"failed");

  assert.equal(h.count("error"),1);
  assert.equal(h.count("processed"),0);
});

for(const scenario of [

  {
    name:"reconciliation RPC error preserves failure",
    options:{
      reconciliationError:{message:"mock error"}
    }
  },

  {
    name:"reconciliation exception preserves failure",
    options:{reconciliationThrows:true}
  },

  {
    name:"invalid reconciliation result preserves failure",
    options:{
      reconciliation:{
        outcome:"reconciled",
        reason:"SCOPED_STATUS_RECONCILIATION",
        reconciled_count:0
      }
    }
  },

  {
    name:"unconfirmed persisted event preserves failure",
    options:{persisted:null}
  },

  {
    name:"persisted lookup error preserves failure",
    options:{persistedError:{message:"mock error"}}
  },

  {
    name:"invalid processed timestamp preserves failure",
    options:{
      persisted:{
        processed_at:"invalid",
        processing_error:null
      }
    }
  }

]){

  test(scenario.name,async()=>{

    const h=setup({
      identities:[unmatched,unmatched,match("phone")],
      ...scenario.options
    });

    assert.equal((await h.run()).status,"failed");

    assert.equal(h.count("error"),1);
    assert.equal(h.count("processed"),0);
    assert.equal(h.count("legacy_update"),0);
  });
}

test("rejected late identity never finalizes twice",async()=>{

  const h=setup({
    identities:[
      unmatched,
      unmatched,
      {
        outcome:"rejected",
        reason:"HUMAN_QUOTE_EVENT_EVIDENCE_INVALID"
      }
    ]
  });

  assert.equal((await h.run()).status,"failed");

  assert.equal(h.count("error"),1);
  assert.equal(h.count("processed"),0);

  assert.equal(
    h.count("reconcile_human_quote_status_inbox_by_system"),
    0
  );
});

test("late lead projection failure preserves original failure",async()=>{

  const h=setup({
    identities:[unmatched,unmatched,match("lead")],
    projectionError:true
  });

  assert.equal((await h.run()).status,"failed");

  assert.equal(h.count("error"),1);
  assert.equal(h.count("processed"),0);

  assert.equal(
    h.count("reconcile_human_quote_status_inbox_by_system"),
    0
  );
});
