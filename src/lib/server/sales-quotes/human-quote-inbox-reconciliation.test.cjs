const fs=require("node:fs");
const path=require("node:path");
const assert=require("node:assert/strict");
const test=require("node:test");
const ts=require("typescript");

const rpcName=
  "reconcile_human_quote_status_inbox_by_system";

const scope={
  organizationId:"org-test",
  storeId:"store-test",
  actorUserId:"actor-test"
};

const operationId="operation-test";

const unchanged={
  outcome:"unchanged",
  reason:"SCOPED_STATUS_RECONCILIATION",
  reconciled_count:0
};

const reconciled={
  outcome:"reconciled",
  reason:"SCOPED_STATUS_RECONCILIATION",
  reconciled_count:3
};

function loadService(kind){

  const name="human-quote-"+kind+"-send.ts";

  const source=fs.readFileSync(
    path.join(__dirname,name),
    "utf8"
  );

  const ast=ts.createSourceFile(
    name,source,ts.ScriptTarget.Latest,true
  );

  const service=ast.statements.find(n=>
    ts.isFunctionDeclaration(n) &&
    n.name?.text===(
      kind==="customer"
        ? "executeHumanQuoteCustomerSend"
        : "executeHumanQuoteResponsibleSend"
    )
  );

  assert.ok(service);

  const helper=service.body.statements.find(n=>
    ts.isFunctionDeclaration(n) &&
    n.name?.text==="reconcileAcceptedInbox"
  );

  assert.ok(helper);

  const compiled=ts.transpileModule(
    helper.getText(ast)+
      "\nreturn reconcileAcceptedInbox;",
    {
      compilerOptions:{
        target:ts.ScriptTarget.ES2022,
        module:ts.ModuleKind.CommonJS
      }
    }
  ).outputText;

  function setup(options={}){

    const calls=[];

    const context={
      scope,
      supabase:{
        async rpc(name,args){

          calls.push([name,args]);

          if(options.throws){
            throw new Error("mock failure");
          }

          return {
            error:options.error || null,
            data:options.data===undefined
              ? reconciled
              : options.data
          };
        }
      }
    };

    const run=new Function(
      "context",
      "registered",
      compiled
    )(context,{operationId});

    return {run,calls};
  }

  return {ast,service,setup};
}

for(const kind of ["customer","responsible"]){

  const {ast,service,setup}=loadService(kind);

  test(kind+" exact accepted operation reconciled",async()=>{

    const h=setup();

    assert.equal(
      await h.run("accepted"),
      "reconciled"
    );

    assert.deepEqual(h.calls,[
      [
        rpcName,
        {
          p_organization_id:scope.organizationId,
          p_store_id:scope.storeId,
          p_actor_user_id:scope.actorUserId,
          p_operation_id:operationId
        }
      ]
    ]);
  });

  test(kind+" no eligible errors is successful",async()=>{

    const h=setup({data:unchanged});

    assert.equal(
      await h.run("accepted"),
      "unchanged"
    );
  });

  for(const scenario of [

    {
      name:"RPC error",
      options:{error:{message:"mock failure"}}
    },

    {
      name:"RPC exception",
      options:{throws:true}
    },

    {
      name:"wrong reason",
      options:{
        data:{...reconciled,reason:"invalid"}
      }
    },

    {
      name:"negative count",
      options:{
        data:{...reconciled,reconciled_count:-1}
      }
    },

    {
      name:"inconsistent outcome",
      options:{
        data:{...reconciled,reconciled_count:0}
      }
    },

    {
      name:"fractional count",
      options:{
        data:{...reconciled,reconciled_count:1.5}
      }
    },

    {
      name:"malformed response",
      options:{data:[]}
    }

  ]){

    test(kind+" "+scenario.name+" remains pending",async()=>{

      const h=setup(scenario.options);

      assert.equal(
        await h.run("accepted"),
        "pending"
      );

      assert.equal(h.calls.length,1);
    });
  }

  test(kind+" nonaccepted never reconciles",async()=>{

    const h=setup();

    for(const status of [
      "registered",
      "attempt_started",
      "blocked",
      "failed",
      "uncertain",
      "unconfirmed"
    ]){

      assert.equal(
        await h.run(status),
        "not_applicable"
      );
    }

    assert.equal(h.calls.length,0);
  });

  test(kind+" replay reconciles without transport",async()=>{

    const h=setup({data:unchanged});

    assert.equal(
      await h.run("accepted"),
      "unchanged"
    );

    assert.equal(
      await h.run("accepted"),
      "unchanged"
    );

    assert.equal(h.calls.length,2);

    for(const call of h.calls){
      assert.equal(call[0],rpcName);
    }

    assert.deepEqual(h.calls[0],h.calls[1]);
  });

  test(kind+" initial and replay return paths are wired",()=>{

    const paths=[];

    function walk(node){

      if(node!==service && ts.isFunctionLike(node)){
        return;
      }

      if(
        ts.isReturnStatement(node) &&
        node.expression &&
        ts.isObjectLiteralExpression(node.expression)
      ){

        const props=node.expression.properties;

        const status=props.find(p=>
          ts.isPropertyAssignment(p) &&
          p.name.getText(ast)==="status"
        );

        if(status){

          const value=status.initializer.getText(ast);

          if([
            "registered.status",
            "result.status"
          ].includes(value)){

            const reconciliation=props.find(p=>
              ts.isPropertyAssignment(p) &&
              p.name.getText(ast)==="inboxReconciliation"
            );

            assert.ok(reconciliation);

            assert.equal(
              reconciliation.initializer.getText(ast),
              ("await reconcileAcceptedInbox("+value+", ingressReady"+(kind==="customer"?' && historyProjection !== "pending"':"")+")")
            );

            if(kind==="customer"){

              const historyIndex=props.findIndex(p=>
                ts.isPropertyAssignment(p) &&
                p.name.getText(ast)==="historyProjection"
              );

              assert.ok(historyIndex>=0);

              assert.ok(
                props.indexOf(reconciliation)>historyIndex
              );
            }

            paths.push(value);
          }
        }
      }

      ts.forEachChild(node,walk);
    }

    walk(service);

    assert.deepEqual(
      paths.sort(),
      ["registered.status","result.status"]
    );
  });
}



for(const ingressKind of ["customer","responsible"]){

  const ingressFile=path.join(
    __dirname,"human-quote-"+ingressKind+"-send.ts"
  );

  const ingressAst=ts.createSourceFile(
    ingressFile,
    fs.readFileSync(ingressFile,"utf8"),
    ts.ScriptTarget.Latest,true
  );

  function loadIngressHelper(name,rpc){

    let found;

    function walk(n){
      if(ts.isFunctionDeclaration(n) &&
         n.name?.text===name){
        found=n;
      }
      ts.forEachChild(n,walk);
    }

    walk(ingressAst);
    assert.ok(found,name);

    const js=ts.transpileModule(
      found.getText(ingressAst)+"\nreturn "+name+";",
      {
        compilerOptions:{
          target:ts.ScriptTarget.ES2022,
          module:ts.ModuleKind.CommonJS
        }
      }
    ).outputText;

    return new Function("context","registered",js)(
      {
        scope:{
          organizationId:"org",
          storeId:"store",
          actorUserId:"actor"
        },
        supabase:{rpc}
      },
      {operationId:"operation"}
    );
  }

  const base={
    outcome:"unchanged",
    reason:"SCOPED_STATUS_INGRESS_RECOVERY",
    recovered_count:0,
    existing_count:0,
    conflict_count:0
  };

  const cases=[
    ["no evidence",base,true],
    ["recovered evidence",{
      ...base,outcome:"recovered",recovered_count:1
    },true],
    ["conflicting evidence",{
      ...base,outcome:"conflict",conflict_count:1
    },false],
    ["inconsistent count",{
      ...base,outcome:"recovered"
    },false],
    ["negative count",{
      ...base,existing_count:-1
    },false],
    ["malformed response",null,false],
    ["RPC error",base,false,"error"],
    ["RPC exception",base,false,"throw"]
  ];

  for(const [label,data,expected,mode] of cases){

    test(ingressKind+" ingress: "+label,async()=>{

      const run=loadIngressHelper(
        "recoverAcceptedIngress",
        async(name,args)=>{

          assert.equal(
            name,"recover_human_quote_status_ingress_by_system"
          );

          assert.deepEqual(args,{
            p_organization_id:"org",
            p_store_id:"store",
            p_actor_user_id:"actor",
            p_operation_id:"operation"
          });

          if(mode==="throw"){
            throw new Error("synthetic");
          }

          return {
            data,error:mode==="error"?{}:null
          };
        }
      );

      assert.equal(await run("accepted"),expected);
    });
  }

  test(ingressKind+" ingress skips nonaccepted sends",async()=>{

    let calls=0;

    const run=loadIngressHelper(
      "recoverAcceptedIngress",
      async()=>{calls++;}
    );

    for(const status of [
      "registered","blocked","failed",
      "uncertain","unconfirmed","attempt_started"
    ]){
      assert.equal(await run(status),true);
    }

    assert.equal(calls,0);
  });

  test(ingressKind+" reconciliation waits for prerequisites",async()=>{

    let calls=0;

    const run=loadIngressHelper(
      "reconcileAcceptedInbox",
      async()=>{calls++;}
    );

    assert.equal(await run("accepted",false),"pending");
    assert.equal(await run("uncertain",false),"not_applicable");
    assert.equal(calls,0);
  });
}
