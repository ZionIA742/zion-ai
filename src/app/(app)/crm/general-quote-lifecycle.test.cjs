const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const assert = require("node:assert/strict");

function run(source) {
  const ast = ts.createSourceFile(
    "page.tsx",source,
    ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX
  );

  assert.equal(ast.parseDiagnostics.length,0);

  const nodes = [];

  function walk(node) {
    nodes.push(node);
    ts.forEachChild(node,walk);
  }

  walk(ast);

  function unique(items,label) {
    assert.equal(items.length,1,label);
    return items[0];
  }

  function declaration(name) {
    return unique(
      nodes.filter(node =>
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === name
      ),
      "DECLARATION: "+name
    );
  }

  const scopeExpression =
    declaration("crmScopeKey").initializer.getText(ast);

  const openingExpression =
    declaration("canOpenGeneralQuoteEditor")
      .initializer.getText(ast);

  const effect = unique(
    nodes.filter(node =>
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "useLayoutEffect" &&
      node.arguments[0]?.getText(ast)
        .includes("setQuoteEditorScope(null)")
    ),
    "EDITOR_RESET_EFFECT"
  );

  const effectCallback =
    effect.arguments[0].getText(ast);

  const effectDependencies =
    effect.arguments[1].getText(ast);

  const modal = unique(
    nodes.filter(node =>
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(ast) === "GeneralQuoteEditor"
    ),
    "GENERAL_QUOTE_EDITOR_MOUNT"
  );

  let condition = modal.parent;

  while (
    condition &&
    !ts.isConditionalExpression(condition)
  ) condition = condition.parent;

  assert.ok(condition,"MODAL_CONDITION_MISSING");

  const mountExpression =
    condition.condition.getText(ast);

  function prop(name) {
    return unique(
      modal.attributes.properties.filter(p =>
        ts.isJsxAttribute(p) &&
        p.name.getText(ast) === name
      ),
      "MODAL_PROP: "+name
    );
  }

  const keyExpression =
    prop("key").initializer.expression.getText(ast);

  const closeExpression =
    prop("onClose").initializer.expression.getText(ast);

  assert.equal(
    prop("organizationId").initializer.expression.getText(ast),
    "organizationId"
  );

  assert.equal(
    prop("storeId").initializer.expression.getText(ast),
    "activeStoreId"
  );

  function evaluate(expression,env) {
    return new Function(
      ...Object.keys(env),
      "return ("+expression+");"
    )(...Object.values(env));
  }

  function harness() {
    let quoteEditorScope = null;
    let previousDeps = null;

    let context = {
      organizationId:"org-a",
      activeStoreId:"store-a",
      storeLoading:false
    };

    function environment() {
      const env = {
        ...context,
        quoteEditorScope,
        setQuoteEditorScope:value=>{
          quoteEditorScope=value;
        }
      };

      env.crmScopeKey =
        evaluate(scopeExpression,env);

      env.canOpenGeneralQuoteEditor =
        evaluate(openingExpression,env);

      return env;
    }

    function snapshot() {
      const env = environment();

      return {
        visible:Boolean(
          evaluate(mountExpression,env)
        ),
        canOpen:env.canOpenGeneralQuoteEditor,
        scope:quoteEditorScope,
        key:evaluate(keyExpression,env)
      };
    }

    function render(changes={}) {
      context={...context,...changes};

      const env=environment();

      // React evaluates render before layout effects.
      const before=snapshot();

      const deps=evaluate(effectDependencies,env);

      const changed=
        previousDeps===null ||
        deps.length!==previousDeps.length ||
        deps.some((value,i)=>
          !Object.is(value,previousDeps[i])
        );

      if(changed) {
        previousDeps=[...deps];

        evaluate(effectCallback,env)();
      }

      return {
        before,
        after:snapshot()
      };
    }

    function open() {
      const env=environment();

      if(env.canOpenGeneralQuoteEditor) {
        quoteEditorScope=env.crmScopeKey;
      }

      return render().after;
    }

    function close() {
      const env=environment();

      if(closeExpression==="closeGeneralQuoteEditor") {
        const callback=declaration(
          "closeGeneralQuoteEditor"
        ).initializer;

        assert.ok(ts.isCallExpression(callback));

        assert.equal(
          callback.expression.getText(ast),
          "useCallback"
        );

        assert.equal(
          callback.arguments[1].getText(ast),
          "[]"
        );

        evaluate(
          callback.arguments[0].getText(ast),env
        )();
      } else {
        evaluate(closeExpression,env)();
      }

      return render().after;
    }

    render();

    return {render,open,close,snapshot};
  }

  let count=0;

  function test(name,fn) {
    fn();
    count++;
    console.log("ok - "+name);
  }

  test("same-scope loading refresh preserves open editor",()=>{
    const h=harness();

    const opened=h.open();

    assert.equal(opened.visible,true);

    const refresh=h.render({storeLoading:true});

    assert.equal(
      refresh.before.visible,true,
      "SAME_SCOPE_REFRESH_CLOSED_EDITOR"
    );

    assert.equal(
      refresh.after.visible,true,
      "SAME_SCOPE_REFRESH_CLOSED_EDITOR"
    );

    assert.equal(refresh.after.scope,opened.scope);
    assert.equal(refresh.after.key,opened.key);

    const restored=h.render({storeLoading:false});

    assert.equal(restored.after.visible,true);
    assert.equal(restored.after.key,opened.key);
  });

  test("loading prevents opening a new editor",()=>{
    const h=harness();

    h.render({storeLoading:true});

    assert.equal(h.snapshot().canOpen,false);
    assert.equal(h.open().visible,false);

    h.render({storeLoading:false});

    assert.equal(h.open().visible,true);
  });

  test("repeated same-scope refreshes preserve component key",()=>{
    const h=harness();
    const opened=h.open();

    for(let i=0;i<5;i++) {
      const loading=h.render({storeLoading:true});
      const ready=h.render({storeLoading:false});

      for(const current of [loading,ready]) {
        assert.equal(current.before.visible,true);
        assert.equal(current.after.visible,true);
        assert.equal(current.after.key,opened.key);
      }
    }
  });

  test("real store change closes without exposing old scope",()=>{
    const h=harness();

    h.open();

    const switched=h.render({
      activeStoreId:"store-b"
    });

    assert.equal(switched.before.visible,false);
    assert.equal(switched.after.visible,false);
    assert.equal(switched.after.scope,null);

    assert.equal(
      h.render({
        activeStoreId:"store-a"
      }).after.visible,
      false
    );
  });

  test("organization change invalidates the open editor",()=>{
    const h=harness();

    h.open();

    const switched=h.render({
      organizationId:"org-b"
    });

    assert.equal(switched.before.visible,false);
    assert.equal(switched.after.visible,false);
    assert.equal(switched.after.scope,null);
  });

  test("loss of authorized scope closes immediately",()=>{
    const h=harness();

    h.open();

    const lost=h.render({
      organizationId:null,
      activeStoreId:null,
      storeLoading:true
    });

    assert.equal(lost.before.visible,false);
    assert.equal(lost.after.visible,false);
    assert.equal(lost.after.scope,null);
    assert.equal(lost.after.canOpen,false);

    const restored=h.render({
      organizationId:"org-a",
      activeStoreId:"store-a",
      storeLoading:false
    });

    assert.equal(restored.after.visible,false);
  });

  test("explicit close remains effective across refresh",()=>{
    const h=harness();

    assert.equal(h.open().visible,true);
    assert.equal(h.close().visible,false);

    h.render({storeLoading:true});
    h.render({storeLoading:false});

    assert.equal(h.snapshot().visible,false);

    assert.equal(h.open().visible,true);
  });

  assert.equal(count,7);

  console.log(
    "GENERAL_QUOTE_LIFECYCLE: "+count+"/7 PASS"
  );
}

module.exports=run;

if(require.main===module) {
  run(
    fs.readFileSync(
      path.join(__dirname,"page.tsx"),
      "utf8"
    )
  );
}
