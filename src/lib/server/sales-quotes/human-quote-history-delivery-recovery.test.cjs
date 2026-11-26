const fs=require("node:fs");
const path=require("node:path");
const assert=require("node:assert/strict");
const test=require("node:test");
const ts=require("typescript");

const file=path.join(
  __dirname,
  "human-quote-customer-send.ts"
);

const source=fs.readFileSync(file,"utf8");

const ast=ts.createSourceFile(
  file,source,ts.ScriptTarget.Latest,true
);

let target;

function walk(node){

  if(
    ts.isFunctionDeclaration(node) &&
    node.name?.text==="projectAcceptedHistory"
  ){
    target=node;
  }

  ts.forEachChild(node,walk);
}

walk(ast);

assert.ok(target);

const compiled=ts.transpileModule(
  target.getText(ast)+"\nreturn projectAcceptedHistory;",
  {
    compilerOptions:{
      target:ts.ScriptTarget.ES2022,
      module:ts.ModuleKind.CommonJS
    }
  }
).outputText;

const messageId="11111111-1111-4111-8111-111111111111";
const conversationId="22222222-2222-4222-8222-222222222222";

const historyScope={
  p_organization_id:"org",
  p_store_id:"store",
  p_actor_user_id:"actor",
  p_operation_id:"operation"
};

const recorded={
  outcome:"recorded",
  reason:"ACCEPTED_DOCUMENT_RECORDED",
  message_id:messageId,
  conversation_id:conversationId
};

const noEvidence={
  outcome:"unchanged",
  reason:"NO_DELIVERY_EVIDENCE",
  message_id:messageId
};

const reconciled={
  outcome:"projected",
  reason:"DELIVERY_EVIDENCE_RECONCILED",
  message_id:messageId,
  delivery_status:"read",
  evidence_count:3
};

function setup(options={}){

  const calls=[];

  const context={
    supabase:{
      async rpc(name,args){

        calls.push([name,args]);

        if(name==="project_human_quote_send_history_by_system"){

          if(options.historyThrows){
            throw new Error("history failure");
          }

          return {
            error:options.historyError || null,
            data:options.history ?? recorded
          };
        }

        assert.equal(
          name,
          "project_human_quote_history_delivery_by_system"
        );

        if(options.deliveryThrows){
          throw new Error("delivery failure");
        }

        return {
          error:options.deliveryError || null,
          data:options.delivery ?? reconciled
        };
      }
    }
  };

  const deps={
    context,
    request:{
      recipient:{kind:options.kind || "lead"}
    },
    historyScope,
    validHistoryUuid:value=>
      typeof value==="string" &&
      /^[0-9a-f-]{36}$/i.test(value),
    HISTORY_PROJECTION_SKIPS:new Set([
      "NO_PROVEN_CONVERSATION"
    ])
  };

  const run=new Function(
    ...Object.keys(deps),
    compiled
  )(...Object.values(deps));

  return {run,calls};
}

test("early evidence recovered after history recording",async()=>{

  const h=setup();

  assert.equal(await h.run("accepted"),"recorded");

  assert.deepEqual(h.calls,[
    [
      "project_human_quote_send_history_by_system",
      historyScope
    ],
    [
      "project_human_quote_history_delivery_by_system",
      historyScope
    ]
  ]);
});

test("accepted history without events succeeds",async()=>{

  const h=setup({delivery:noEvidence});

  assert.equal(await h.run("accepted"),"recorded");
});

test("unchanged delivery evidence succeeds on replay",async()=>{

  const h=setup({
    delivery:{...reconciled,outcome:"unchanged"}
  });

  assert.equal(await h.run("accepted"),"recorded");
  assert.equal(await h.run("accepted"),"recorded");

  assert.equal(h.calls.length,4);
});

for(const scenario of [
  {
    name:"delivery RPC error remains pending",
    options:{deliveryError:{message:"failure"}}
  },
  {
    name:"delivery exception remains pending",
    options:{deliveryThrows:true}
  },
  {
    name:"wrong message remains pending",
    options:{
      delivery:{
        ...reconciled,
        message_id:conversationId
      }
    }
  },
  {
    name:"malformed evidence remains pending",
    options:{
      delivery:{...reconciled,evidence_count:0}
    }
  },
  {
    name:"unexpected status remains pending",
    options:{
      delivery:{...reconciled,delivery_status:"invalid"}
    }
  },
  {
    name:"history disappearance remains pending",
    options:{
      delivery:{
        outcome:"skipped",
        reason:"BOUND_HISTORY_MESSAGE_UNAVAILABLE"
      }
    }
  }
]){

  test(scenario.name,async()=>{

    const h=setup(scenario.options);

    assert.equal(await h.run("accepted"),"pending");
    assert.equal(h.calls.length,2);
  });
}

test("skipped history does not project delivery",async()=>{

  const h=setup({
    history:{
      outcome:"skipped",
      reason:"NO_PROVEN_CONVERSATION"
    }
  });

  assert.equal(await h.run("accepted"),"skipped");
  assert.equal(h.calls.length,1);
});

test("history failure does not project delivery",async()=>{

  const h=setup({historyThrows:true});

  assert.equal(await h.run("accepted"),"pending");
  assert.equal(h.calls.length,1);
});

test("nonaccepted operations never reconcile",async()=>{

  const h=setup();

  for(const status of [
    "registered","blocked","uncertain","failed"
  ]){
    assert.equal(
      await h.run(status),
      "not_applicable"
    );
  }

  assert.equal(h.calls.length,0);
});

test("manual destination does not create CRM history",async()=>{

  const h=setup({kind:"phone"});

  assert.equal(await h.run("accepted"),"not_applicable");
  assert.equal(h.calls.length,0);
});
