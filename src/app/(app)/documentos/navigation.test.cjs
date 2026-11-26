const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const test = require("node:test");

const root = process.cwd();

const sidebar = fs.readFileSync(
  path.join(root,"src/components/layout/Sidebar.tsx"),"utf8"
);

const header = fs.readFileSync(
  path.join(root,"src/components/layout/AppHeader.tsx"),"utf8"
);

const page = fs.readFileSync(
  path.join(__dirname,"page.tsx"),"utf8"
);

test("documents is an independent navigation item",()=>{
  assert.equal(
    sidebar.split('href: "/documentos"').length,2
  );

  assert.ok(sidebar.includes(
    '{ label: "Documentos", href: "/documentos", icon: "documents" }'
  ));
});

test("follow-up remains unchanged",()=>{
  assert.ok(sidebar.includes(
    '{ label: "Follow-up", href: "/inbox", icon: "inbox" }'
  ));
});

test("documents has its own icon",()=>{
  assert.ok(sidebar.includes('| "documents"'));
  assert.ok(sidebar.includes('name === "documents"'));
});

test("documents follows existing active navigation",()=>{
  assert.ok(sidebar.includes("pathname === item.href"));
  assert.ok(sidebar.includes('pathname.startsWith('));
});

test("header recognizes documents route",()=>{
  assert.ok(header.includes(
    'pathname === "/documentos"'
  ));

  assert.ok(header.includes(
    'pathname.startsWith("/documentos/")'
  ));
});

test("documents page exists without invented records",()=>{
  assert.ok(page.includes("function DocumentsPage()"));
  assert.ok(page.includes("Central de Documentos"));
  assert.ok(!page.includes("ORC-000063"));
  assert.ok(!page.includes("ORC-000064"));
});

test("initial shell performs no document requests",()=>{
  assert.ok(!page.includes("fetch("));
  assert.ok(!page.includes("supabase"));
});


function loadPureTs(relativePath){
  const ts = require("typescript");

  const source = fs.readFileSync(
    path.join(root,relativePath),"utf8"
  );

  const js = ts.transpileModule(source,{
    compilerOptions:{
      module:ts.ModuleKind.CommonJS,
      target:ts.ScriptTarget.ES2022
    }
  }).outputText;

  const exports = {};

  new Function("exports",js)(exports);

  return exports;
}

const policy = loadPureTs(
  "src/lib/account-access-middleware-policy.ts"
);

const gate = loadPureTs(
  "src/lib/account-access-page-gate.ts"
);

test("documents does not duplicate the shell main landmark",()=>{
  assert.ok(!/<main\b/.test(page));
  assert.ok(!page.includes("</main>"));
});

test("anonymous document routes require login",()=>{
  for(const route of ["/documentos","/api/documents"]){

    assert.deepEqual(
      policy.resolveAccountAccessMiddlewarePolicy(
        route,"anonymous"
      ),
      {
        action:"redirect",
        destination:"/login",
        preserveRedirectTo:true
      }
    );
  }
});

test("authenticated and unavailable document sessions follow policy",()=>{
  for(const route of ["/documentos","/api/documents"]){

    assert.equal(
      policy.resolveAccountAccessMiddlewarePolicy(
        route,"authenticated"
      ).action,
      "next"
    );

    assert.equal(
      policy.resolveAccountAccessMiddlewarePolicy(
        route,"unavailable"
      ).destination,
      "/account/access-unavailable"
    );
  }
});

test("store page gate preserves commercial authorization",()=>{
  assert.equal(
    gate.resolveAccountAccessPageGate(
      {status:"store_ready_active"},"store_app"
    ).action,
    "render"
  );

  const denied = {
    anonymous:"/login",
    account_blocked:"/account/access-blocked",
    inactive_membership:"/account/access-blocked",
    store_commercial_blocked:"/account/access-blocked",
    store_ready_onboarding_required:"/onboarding",
    access_resolution_unavailable:"/account/access-unavailable"
  };

  for(const [status,destination] of Object.entries(denied)){

    assert.deepEqual(
      gate.resolveAccountAccessPageGate(
        {status},"store_app"
      ),
      {action:"redirect",destination}
    );
  }
});

test("documents inherits the protected store layout",()=>{
  const layout = fs.readFileSync(
    path.join(root,"src/app/(app)/layout.tsx"),"utf8"
  );

  assert.ok(layout.includes("resolveAccessForRequest"));
  assert.ok(layout.includes("resolveAccountAccessPageGate"));
  assert.ok(layout.includes('"store_app"'));
  assert.ok(layout.includes("<StoreSessionBoundary"));
  assert.ok(layout.includes("<AppShellClient>"));
});

test("documents is registered consistently in diagnostics",()=>{
  const {CLIENT_BROWSER_PAGES} = loadPureTs(
    "src/lib/diagnostics/client-browser-pages.ts"
  );

  assert.deepEqual(
    CLIENT_BROWSER_PAGES.filter(
      entry=>entry.page==="/documentos"
    ),
    [{page:"/documentos",domain:"store_area"}]
  );

  for(const file of [
    "src/app/api/zion-admin/diagnostics/route.ts",
    "src/app/zion-admin/ZionAdminDiagnosticIncidents.tsx"
  ]){

    const source = fs.readFileSync(
      path.join(root,file),"utf8"
    );

    assert.ok(source.includes(
      '"/dashboard", "/documentos", "/help", "/inbox"'
    ));
  }
});
