const fs = require("node:fs");
const assert = require("node:assert/strict");
const ts = require("typescript");

async function run(source) {

  const compiled = ts.transpileModule(source,{
    compilerOptions:{
      module:ts.ModuleKind.CommonJS,
      target:ts.ScriptTarget.ES2022,
      strict:true,
    }
  });

  const m = {exports:{}};

  new Function("module","exports",compiled.outputText)(
    m,m.exports
  );

  const execute = m.exports.executeHumanQuoteTransport;

  const token = "10000000-0000-4000-8000-000000000001";

  let count = 0;

  async function check(name,fn) {
    await fn();
    count++;
    console.log("ok - "+name);
  }

  function fixture() {

    const calls = [];

    const deps = {

      async begin() {
        calls.push("begin");

        return {
          outcome:"attempt_created",
          attemptToken:token,
        };
      },

      async send() {
        calls.push("send");

        return {
          outcome:"accepted",
          externalMessageId:"synthetic-message-id",
        };
      },

      async finish(input) {

        calls.push("finish");

        assert.equal(input.attemptToken,token);

        const states = {
          accept:"accepted",
          fail:"failed",
          uncertain:"uncertain",
        };

        return {status:states[input.action]};
      }
    };

    return {deps,calls};
  }

  await check("accepted send runs exactly once",async()=>{

    const x=fixture();
    const result=await execute(x.deps);

    assert.equal(result.status,"accepted");
    assert.equal(result.providerRequestAttempted,true);

    assert.deepEqual(x.calls,[
      "begin","send","finish"
    ]);
  });

  for(const status of [
    "blocked","attempt_started","accepted","failed","uncertain"
  ]) {

    await check("existing "+status+" cannot send again",async()=>{

      const x=fixture();

      x.deps.begin=async()=>({
        outcome:"existing_state",status,
      });

      const result=await execute(x.deps);

      assert.equal(result.status,status);
      assert.equal(result.providerRequestAttempted,false);
      assert.deepEqual(x.calls,[]);
    });
  }

  await check("begin failure prevents provider request",async()=>{

    const x=fixture();

    x.deps.begin=async()=>{
      throw new Error("database unavailable");
    };

    const result=await execute(x.deps);

    assert.equal(result.status,"unconfirmed");
    assert.deepEqual(x.calls,[]);
  });

  await check("invalid attempt token prevents provider request",async()=>{

    const x=fixture();

    x.deps.begin=async()=>({
      outcome:"attempt_created",
      attemptToken:"invalid",
    });

    const result=await execute(x.deps);

    assert.equal(result.status,"unconfirmed");
    assert.deepEqual(x.calls,[]);
  });

  await check("provider exception becomes uncertain",async()=>{

    const x=fixture();

    x.deps.send=async()=>{
      x.calls.push("send");
      throw new Error("connection lost");
    };

    const result=await execute(x.deps);

    assert.equal(result.status,"uncertain");

    assert.deepEqual(x.calls,[
      "begin","send","finish"
    ]);
  });

  await check("definitive rejection is recorded without retry",async()=>{

    const x=fixture();

    x.deps.send=async()=>{
      x.calls.push("send");
      return {outcome:"failed"};
    };

    const result=await execute(x.deps);

    assert.equal(result.status,"failed");

    assert.deepEqual(x.calls,[
      "begin","send","finish"
    ]);
  });

  await check("missing provider id becomes uncertain",async()=>{

    const x=fixture();

    x.deps.send=async()=>{
      x.calls.push("send");
      return {outcome:"accepted",externalMessageId:""};
    };

    const result=await execute(x.deps);

    assert.equal(result.status,"uncertain");

    assert.deepEqual(x.calls,[
      "begin","send","finish"
    ]);
  });

  await check("database finalization failure never retries",async()=>{

    const x=fixture();

    x.deps.finish=async()=>{
      x.calls.push("finish");
      throw new Error("database response lost");
    };

    const result=await execute(x.deps);

    assert.equal(result.status,"unconfirmed");
    assert.equal(result.providerRequestAttempted,true);

    assert.deepEqual(x.calls,[
      "begin","send","finish"
    ]);
  });

  await check("wrong persisted status cannot report success",async()=>{

    const x=fixture();

    x.deps.finish=async()=>({status:"registered"});

    const result=await execute(x.deps);

    assert.equal(result.status,"unconfirmed");
  });

  assert.equal(count,13);

  console.log("HUMAN_QUOTE_SEND_TRANSPORT: 13/13 PASS");
}

module.exports=run;

if(require.main===module) {
  run(
    fs.readFileSync(
      "src/lib/server/sales-quotes/human-quote-send-transport.ts",
      "utf8"
    )
  ).catch(error=>{
    console.error(error);
    process.exitCode=1;
  });
}
