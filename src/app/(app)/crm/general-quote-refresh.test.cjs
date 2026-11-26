const fs=require("node:fs");
const path=require("node:path");
const assert=require("node:assert/strict");
const test=require("node:test");
const ts=require("typescript");

function extract(file,component,attribute,env){

  const ast=ts.createSourceFile(
    file,
    fs.readFileSync(path.join(__dirname,file),"utf8"),
    ts.ScriptTarget.Latest,true
  );

  const matches=[];

  function visit(node){

    if(
      (ts.isJsxOpeningElement(node) ||
       ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(ast)===component
    ){

      const prop=node.attributes.properties.find(
        item=>ts.isJsxAttribute(item) &&
        item.name.getText(ast)===attribute
      );

      if(prop?.initializer &&
         ts.isJsxExpression(prop.initializer)){
        matches.push(prop.initializer.expression);
      }
    }

    ts.forEachChild(node,visit);
  }

  visit(ast);

  assert.equal(matches.length,1);

  const js=ts.transpileModule(
    "const callback = "+matches[0].getText(ast)+";",
    {compilerOptions:{target:ts.ScriptTarget.ES2022}}
  ).outputText;

  return new Function(
    ...Object.keys(env),
    js+"\nreturn callback;"
  )(...Object.values(env));
}

async function scenario(options={}){

  const calls=[];

  const refresh=extract(
    "page.tsx",
    "GeneralQuoteEditor",
    "onLeadQuoteAccepted",
    {
      crmScopeKey:"scope-a",
      currentCrmScopeRef:{
        current:options.scopeChanged?"scope-b":"scope-a"
      },
      fetchPageData:async args=>calls.push(args)
    }
  );

  const accepted=extract(
    "GeneralQuoteEditor.tsx",
    "ManualQuoteSuccessPanel",
    "onAccepted",
    {
      mounted:{current:!options.unmounted},
      userRef:{
        current:options.userChanged?"user-b":"user-a"
      },
      userId:"user-a",
      onLeadQuoteAccepted:refresh
    }
  );

  await accepted(
    {kind:options.kind??"lead"},
    {providerAccepted:options.accepted??true}
  );

  return calls;
}

test("accepted lead refreshes silently exactly once",async()=>{
  assert.deepEqual(await scenario(),[
    {silent:true,force:true}
  ]);
});

for(const [name,options] of [
  ["manual phone",{kind:"phone"}],
  ["responsible",{kind:"responsible"}],
  ["not accepted",{accepted:false}],
  ["unmounted editor",{unmounted:true}],
  ["changed user",{userChanged:true}],
  ["changed CRM scope",{scopeChanged:true}]
]){
  test(name+" does not refresh CRM",async()=>{
    assert.deepEqual(await scenario(options),[]);
  });
}
