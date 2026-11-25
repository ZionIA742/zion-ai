const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function loadModule(source, resolver) {
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
      d => d.category === ts.DiagnosticCategory.Error
    ).length,
    0
  );

  const m = {exports:{}};

  new Function(
    "require","module","exports",
    compiled.outputText
  )(resolver,m,m.exports);

  return m.exports;
}

async function run(source,contractSource,responsibleSource) {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    throw new Error("EXTERNAL_NETWORK_FORBIDDEN");
  };

  try {
    const contract = loadModule(contractSource,require);

    const responsibleAuthority = loadModule(
      responsibleSource,
      name => {
        if(name === "@supabase/supabase-js") {
          return {
            createClient() {
              throw new Error("REAL_CLIENT_FORBIDDEN");
            },
          };
        }

        throw new Error("UNEXPECTED_IMPORT: "+name);
      }
    );

    const {
      resolveHumanQuoteSendRecipient: resolve,
      HumanQuoteSendRecipientError,
    } = loadModule(source,name => {
      if(name === "./human-quote-send-contract") {
        return contract;
      }

      if(name === "../store-responsibles") {
        return responsibleAuthority;
      }

      throw new Error("UNEXPECTED_IMPORT: "+name);
    });

    const id = n =>
      "10000000-0000-4000-8000-" +
      String(n).padStart(12,"0");

    const organizationId = id(1);
    const storeId = id(2);
    const leadId = id(3);
    const responsibleId = id(4);
    const phone = "+5511999991234";

    const lead = {
      id:leadId,
      organization_id:organizationId,
      store_id:storeId,
      phone:"(11) 99999-1234",
    };

    const responsible = {
      id:responsibleId,
      name:"Responsible Test",
      role:"owner",
      whatsapp_number:"5511999991234",
    };

    function mockDb(options = {}) {
      const calls = [];

      const supabase = {
        from(table) {
          calls.push(["from",table]);

          assert.ok(
            table === "leads" ||
            table === "store_responsibles"
          );

          const result =
            table === "leads"
              ? {
                  data:Object.hasOwn(options,"lead")
                    ? options.lead : {...lead},
                  error:options.leadError || null,
                }
              : {
                  data:Object.hasOwn(options,"responsibles")
                    ? options.responsibles : [{...responsible}],
                  error:options.responsibleError || null,
                };

          const query = {
            select(columns) {
              calls.push(["select",columns]);
              return query;
            },
            eq(column,value) {
              calls.push(["eq",column,value]);
              return query;
            },
            maybeSingle() {
              calls.push(["maybeSingle"]);
              return Promise.resolve(result);
            },
            then(fulfilled,rejected) {
              return Promise.resolve(result)
                .then(fulfilled,rejected);
            },
          };

          return query;
        },
      };

      return {supabase,calls};
    }

    function input(db,recipient,extra = {}) {
      return {
        supabase:db.supabase,
        organizationId,
        storeId,
        recipient,
        ...extra,
      };
    }

    let count=0;

    async function check(name,fn) {
      await fn();
      count++;
      console.log("ok - "+name);
    }

    async function denied(args,code) {
      await assert.rejects(
        () => resolve(args),
        error =>
          error instanceof HumanQuoteSendRecipientError &&
          error.code === code
      );
    }

    const leadRequest = {kind:"lead",leadId};
    const responsibleRequest = {kind:"responsible"};
    const phoneRequest = {kind:"phone",phone};

    await check("lead resolution uses exact tenant filters",async () => {
      const db=mockDb();

      assert.deepEqual(
        await resolve(input(db,leadRequest)),
        {
          kind:"lead",
          leadId,
          responsibleId:null,
          candidatePhone:phone,
          crmEffectEligible:true,
        }
      );

      assert.deepEqual(db.calls,[
        ["from","leads"],
        ["select","id,organization_id,store_id,phone"],
        ["eq","id",leadId],
        ["eq","organization_id",organizationId],
        ["eq","store_id",storeId],
        ["maybeSingle"],
      ]);
    });

    await check("free phone does not access CRM records",async () => {
      const db=mockDb();

      assert.deepEqual(
        await resolve(input(db,phoneRequest)),
        {
          kind:"phone",
          leadId:null,
          responsibleId:null,
          candidatePhone:phone,
          crmEffectEligible:false,
        }
      );

      assert.deepEqual(db.calls,[]);
    });

    await check("responsible uses actual canonical authority",async () => {
      const db=mockDb();

      assert.deepEqual(
        await resolve(input(db,responsibleRequest)),
        {
          kind:"responsible",
          leadId:null,
          responsibleId,
          candidatePhone:phone,
          crmEffectEligible:false,
        }
      );

      assert.deepEqual(db.calls,[
        ["from","store_responsibles"],
        ["select","id, name, role, whatsapp_number"],
        ["eq","organization_id",organizationId],
        ["eq","store_id",storeId],
        ["eq","is_primary",true],
        ["eq","is_active",true],
      ]);
    });

    await check("missing lead is rejected",async () => {
      await denied(
        input(mockDb({lead:null}),leadRequest),
        "HUMAN_QUOTE_SEND_RECIPIENT_LEAD_NOT_FOUND"
      );
    });

    await check("foreign lead rows are rejected defensively",async () => {
      for(const key of ["id","organization_id","store_id"]) {
        await denied(
          input(
            mockDb({lead:{...lead,[key]:id(99)}}),
            leadRequest
          ),
          "HUMAN_QUOTE_SEND_RECIPIENT_LEAD_NOT_FOUND"
        );
      }
    });

    await check("lead lookup error is sanitized",async () => {
      await denied(
        input(
          mockDb({leadError:{message:"private database detail"}}),
          leadRequest
        ),
        "HUMAN_QUOTE_SEND_RECIPIENT_LEAD_LOOKUP_FAILED"
      );
    });

    await check("invalid lead phone is rejected",async () => {
      for(const value of [null,"","abc","123"]) {
        await denied(
          input(mockDb({lead:{...lead,phone:value}}),leadRequest),
          "HUMAN_QUOTE_SEND_RECIPIENT_LEAD_PHONE_INVALID"
        );
      }
    });

    await check("missing active primary responsible is rejected",async () => {
      await denied(
        input(mockDb({responsibles:[]}),responsibleRequest),
        "HUMAN_QUOTE_SEND_RECIPIENT_RESPONSIBLE_PRIMARY_NOT_CONFIGURED"
      );
    });

    await check("ambiguous primary responsible is rejected",async () => {
      await denied(
        input(
          mockDb({
            responsibles:[
              responsible,
              {...responsible,id:id(99)},
            ],
          }),
          responsibleRequest
        ),
        "HUMAN_QUOTE_SEND_RECIPIENT_RESPONSIBLE_PRIMARY_STATE_INVALID"
      );
    });

    await check("invalid responsible destination is rejected",async () => {
      await denied(
        input(
          mockDb({
            responsibles:[
              {...responsible,whatsapp_number:"invalid"},
            ],
          }),
          responsibleRequest
        ),
        "HUMAN_QUOTE_SEND_RECIPIENT_RESPONSIBLE_PRIMARY_INVALID_DESTINATION"
      );
    });

    await check("invalid store scope cannot access the database",async () => {
      for(const key of ["organizationId","storeId"]) {
        const db=mockDb();

        await denied(
          input(db,leadRequest,{[key]:"invalid"}),
          "HUMAN_QUOTE_SEND_RECIPIENT_SCOPE_INVALID"
        );

        assert.deepEqual(db.calls,[]);
      }
    });

    await check("invalid lead identity cannot access the database",async () => {
      const db=mockDb();

      await denied(
        input(db,{kind:"lead",leadId:"invalid"}),
        "HUMAN_QUOTE_SEND_RECIPIENT_LEAD_INVALID"
      );

      assert.deepEqual(db.calls,[]);
    });

    await check("free phone requires normalized input",async () => {
      const db=mockDb();

      await denied(
        input(db,{kind:"phone",phone:"(11) 99999-1234"}),
        "HUMAN_QUOTE_SEND_RECIPIENT_PHONE_NOT_CANONICAL"
      );

      await denied(
        input(db,{kind:"phone",phone:"123"}),
        "HUMAN_QUOTE_SEND_RECIPIENT_PHONE_INVALID"
      );

      assert.deepEqual(db.calls,[]);
    });

    await check("invalid responsible identity is rejected",async () => {
      await denied(
        input(
          mockDb({
            responsibles:[{...responsible,id:"invalid"}],
          }),
          responsibleRequest
        ),
        "HUMAN_QUOTE_SEND_RECIPIENT_RESPONSIBLE_INVALID"
      );
    });

    await check("same phone does not merge recipient modes",async () => {
      const db=mockDb();

      const a=await resolve(input(db,leadRequest));
      const b=await resolve(input(db,phoneRequest));
      const c=await resolve(input(db,responsibleRequest));

      assert.equal(a.candidatePhone,b.candidatePhone);
      assert.equal(b.candidatePhone,c.candidatePhone);

      assert.equal(a.crmEffectEligible,true);
      assert.equal(b.crmEffectEligible,false);
      assert.equal(c.crmEffectEligible,false);

      assert.equal(b.leadId,null);
      assert.equal(c.leadId,null);
    });

    await check("responsible lookup error is sanitized",async () => {
      await denied(
        input(
          mockDb({responsibleError:{message:"private database detail"}}),
          responsibleRequest
        ),
        "HUMAN_QUOTE_SEND_RECIPIENT_RESPONSIBLE_LOOKUP_FAILED"
      );
    });

    assert.equal(count,16);

    console.log("HUMAN_QUOTE_SEND_RECIPIENT: 16/16 PASS");

  } finally {
    globalThis.fetch=originalFetch;
  }
}

module.exports=run;

if(require.main===module) {
  run(
    fs.readFileSync(
      path.join(__dirname,"human-quote-send-recipient.ts"),
      "utf8"
    ),
    fs.readFileSync(
      path.join(__dirname,"human-quote-send-contract.ts"),
      "utf8"
    ),
    fs.readFileSync(
      path.join(__dirname,"../store-responsibles.ts"),
      "utf8"
    )
  ).catch(error => {
    console.error(error);
    process.exitCode=1;
  });
}
