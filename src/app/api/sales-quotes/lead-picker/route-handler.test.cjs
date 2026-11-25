const fs=require("node:fs");
const path=require("node:path");
const ts=require("typescript");
const assert=require("node:assert/strict");

// No actual external connection is permitted.
globalThis.fetch=()=>{
  throw Error("UNMOCKED_NETWORK_FORBIDDEN");
};

process.env.NEXT_PUBLIC_SUPABASE_URL=
  "https://example.invalid";

process.env.SUPABASE_SERVICE_ROLE_KEY=
  "synthetic-test-key";

const org="11111111-1111-4111-8111-111111111111";
const store="22222222-2222-4222-8222-222222222222";
const user="33333333-3333-4333-8333-333333333333";
const otherOrg="44444444-4444-4444-8444-444444444444";
const otherStore="55555555-5555-4555-8555-555555555555";
const lead="66666666-6666-4666-8666-666666666666";

function load(file,resolver) {
  const js=ts.transpileModule(
    fs.readFileSync(file,"utf8"),
    {
      compilerOptions:{
        module:ts.ModuleKind.CommonJS,
        target:ts.ScriptTarget.ES2022
      }
    }
  ).outputText;

  const m={exports:{}};

  new Function("require","module","exports",js)(
    resolver,m,m.exports
  );

  return m.exports;
}

function setup(options={}) {
  const calls=[];

  const row={
    id:lead,
    organization_id:org,
    store_id:store,
    name:"Cliente Teste",
    phone:"11900000000",
    internal_secret:"MUST_NOT_LEAK"
  };

  const state={
    authenticated:true,
    activeMembership:true,
    membershipOrganization:org,
    storeExists:true,
    leadRows:[row],
    readError:false,
    ...options
  };

  function client(kind) {
    return {
      auth:{
        async getUser() {
          calls.push(["auth",kind]);

          return {
            data:{
              user:state.authenticated
                ? {id:user}
                : null
            },
            error:null
          };
        }
      },

      from(table) {
        calls.push(["from",kind,table]);

        const filters={};

        const query={
          select(value) {
            calls.push(["select",kind,table,value]);
            return query;
          },

          eq(key,value) {
            filters[key]=value;
            calls.push(["eq",kind,table,key,value]);
            return query;
          },

          in(key,value) {
            filters[key]=value;
            calls.push(["in",kind,table,key,value]);
            return query;
          },

          or(value) {
            calls.push(["or",kind,table,value]);
            return query;
          },

          order(key,value) {
            calls.push(["order",kind,table,key,value]);
            return query;
          },

          range(from,to) {
            calls.push(["range",kind,table,from,to]);
            return query;
          },

          async maybeSingle() {
            assert.equal(kind,"service");
            assert.equal(table,"stores");

            const allowed=
              state.storeExists &&
              filters.id===store &&
              filters.organization_id.includes(org);

            return {
              data:allowed
                ? {id:store,organization_id:org}
                : null,
              error:null
            };
          },

          then(resolve,reject) {
            return Promise.resolve().then(()=>{

              if(table==="memberships") {
                assert.equal(kind,"service");
                assert.equal(filters.user_id,user);
                assert.equal(filters.is_active,true);

                return {
                  data:state.activeMembership
                    ? [{
                        organization_id:
                          state.membershipOrganization
                      }]
                    : [],
                  error:null
                };
              }

              if(table==="leads") {
                assert.equal(kind,"session");
                assert.equal(filters.organization_id,org);
                assert.equal(filters.store_id,store);

                return state.readError
                  ? {
                      data:null,
                      error:{message:"PRIVATE_DB_ERROR"}
                    }
                  : {
                      data:state.leadRows,
                      error:null
                    };
              }

              throw Error("Unexpected table: "+table);

            }).then(resolve,reject);
          },

          insert() {
            throw Error("WRITE_FORBIDDEN");
          },

          update() {
            throw Error("WRITE_FORBIDDEN");
          },

          delete() {
            throw Error("WRITE_FORBIDDEN");
          }
        };

        return query;
      }
    };
  }

  const service=client("service");
  const session=client("session");

  const auth=load(
    path.resolve(
      "src/lib/server/sales-quotes/quote-auth.ts"
    ),
    name=>{
      if(name==="@supabase/supabase-js") {
        return {createClient:()=>service};
      }

      if(name==="@/lib/supabaseServer") {
        return {
          createSupabaseServerClient:
            async()=>session
        };
      }

      throw Error("Unexpected auth import: "+name);
    }
  );

  const api=load(
    path.join(__dirname,"route-handler.ts"),
    name=>{
      if(
        name===
        "@/lib/server/sales-quotes/quote-auth"
      ) return auth;

      throw Error("Unexpected route import: "+name);
    }
  );

  return {
    calls,row,state,

    async request(body={}) {
      const response=await api.POST(
        new Request(
          "https://example.invalid/api/sales-quotes/lead-picker",
          {
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({
              organizationId:org,
              storeId:store,
              ...body
            })
          }
        )
      );

      assert.equal(
        response.headers.get("cache-control"),
        "private, no-store"
      );

      return {
        status:response.status,
        data:await response.json()
      };
    },

    leadReads() {
      return calls.filter(
        c=>c[0]==="from" && c[2]==="leads"
      );
    }
  };
}

(async()=>{

  let count=0;

  async function test(name,fn) {
    await fn();
    count++;
    console.log("ok - "+name);
  }

  await test("active member reads scoped leads only",async()=>{
    const r=setup();
    const result=await r.request();

    assert.equal(result.status,200);
    assert.equal(result.data.ok,true);
    assert.equal(result.data.organizationId,org);
    assert.equal(result.data.storeId,store);

    assert.deepEqual(result.data.leads,[{
      id:lead,
      name:r.row.name,
      phone:r.row.phone
    }]);

    assert.deepEqual(
      r.leadReads(),
      [["from","session","leads"]]
    );

    assert.equal(result.data.hasMore,false);
    assert.equal(result.data.nextOffset,null);
  });

  await test("unauthenticated access is denied",async()=>{
    const r=setup({authenticated:false});

    assert.equal((await r.request()).status,401);
    assert.equal(r.leadReads().length,0);
  });

  await test("inactive membership is denied",async()=>{
    const r=setup({activeMembership:false});

    assert.equal((await r.request()).status,403);
    assert.equal(r.leadReads().length,0);
  });

  await test("another organization cannot read the store",async()=>{
    const r=setup({
      membershipOrganization:otherOrg
    });

    assert.equal((await r.request()).status,403);
    assert.equal(r.leadReads().length,0);
  });

  await test("organization and store mismatch is denied",async()=>{
    const r=setup();

    assert.equal(
      (await r.request({
        organizationId:otherOrg
      })).status,
      403
    );

    assert.equal(r.leadReads().length,0);
  });

  await test("another or missing store is denied",async()=>{
    const r=setup();

    assert.equal(
      (await r.request({
        storeId:otherStore
      })).status,
      403
    );

    assert.equal(r.leadReads().length,0);
  });

  await test("missing scope never reads leads",async()=>{
    const r=setup();

    assert.equal(
      (await r.request({storeId:""})).status,
      400
    );

    assert.equal(r.leadReads().length,0);
  });

  await test("name and phone use a single scoped filter",async()=>{
    for(const term of ["Cliente","119000","Jo\u00e3o"]) {
      const r=setup();

      assert.equal(
        (await r.request({search:term})).status,
        200
      );

      assert.ok(
        r.calls.some(c=>
          c[0]==="or" &&
          c[3]==='name.ilike."%'+term+
            '%",phone.ilike."%'+term+'%"'
        )
      );
    }
  });

  await test("invalid search grammar is blocked",async()=>{
    for(const search of [
      "%",
      "_",
      "*",
      'x",store_id.eq.anything',
      "\\",
      "a".repeat(81)
    ]) {
      const r=setup();

      assert.equal(
        (await r.request({search})).status,
        400
      );

      assert.equal(r.leadReads().length,0);
    }
  });

  await test("pagination returns thirty rows and next offset",async()=>{
    const r=setup();

    r.state.leadRows=Array.from(
      {length:31},
      (_,i)=>({
        ...r.row,
        id:"00000000-0000-4000-8000-"+
          String(i+1).padStart(12,"0")
      })
    );

    const result=await r.request({offset:30});

    assert.equal(result.status,200);
    assert.equal(result.data.leads.length,30);
    assert.equal(result.data.hasMore,true);
    assert.equal(result.data.nextOffset,60);

    assert.ok(
      r.calls.some(c=>
        c[0]==="range" &&
        c[3]===30 &&
        c[4]===60
      )
    );

    assert.equal(
      (await r.request({offset:-1})).status,
      400
    );
  });

  await test("foreign result rows fail closed",async()=>{
    for(const change of [
      {organization_id:otherOrg},
      {store_id:otherStore},
      {store_id:null}
    ]) {
      const r=setup();

      r.state.leadRows=[
        {...r.row,...change}
      ];

      const result=await r.request();

      assert.equal(result.status,500);
      assert.equal(result.data.ok,false);
      assert.equal(result.data.leads,undefined);
    }
  });

  await test("database errors do not leak private details",async()=>{
    const r=setup({readError:true});
    const result=await r.request();

    assert.equal(result.status,500);

    assert.ok(
      !JSON.stringify(result.data)
        .includes("PRIVATE_DB_ERROR")
    );

    assert.equal(result.data.leads,undefined);
  });

  await test("empty result is a valid page",async()=>{
    const r=setup({leadRows:[]});
    const result=await r.request();

    assert.equal(result.status,200);
    assert.deepEqual(result.data.leads,[]);
    assert.equal(result.data.hasMore,false);
    assert.equal(result.data.nextOffset,null);
  });

  await test("exact lookup keeps tenant and lead filters",async()=>{
    const r=setup();

    const result=await r.request({leadId:lead});

    assert.equal(result.status,200);
    assert.equal(result.data.leads[0].id,lead);

    assert.ok(r.calls.some(c=>
      c[0]==="eq" &&
      c[1]==="session" &&
      c[2]==="leads" &&
      c[3]==="id" &&
      c[4]===lead
    ));

    const missing=setup({leadRows:[]});

    assert.deepEqual(
      (await missing.request({leadId:lead})).data.leads,
      []
    );
  });

  await test("exact lookup rejects ambiguous or foreign results",async()=>{
    const wrong=setup();

    assert.equal(
      (await wrong.request({leadId:otherStore})).status,
      500
    );

    const duplicate=setup();

    duplicate.state.leadRows=[
      duplicate.row,
      duplicate.row
    ];

    assert.equal(
      (await duplicate.request({leadId:lead})).status,
      500
    );

    for(const input of [
      {leadId:"bad"},
      {leadId:lead,search:"Cliente"},
      {leadId:lead,offset:30}
    ]) {
      const r=setup();

      assert.equal((await r.request(input)).status,400);
      assert.equal(r.leadReads().length,0);
    }
  });

  assert.equal(count,15);

  console.log(
    "QUOTE_LEAD_PICKER_API: "+count+"/15 PASS"
  );

})().catch(error=>{
  console.error(error.stack);
  process.exitCode=1;
});
