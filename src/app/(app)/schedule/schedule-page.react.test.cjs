/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const fs = require("node:fs");
const ts = require("typescript");
const React = require("react");
const { act, create } = require("react-test-renderer");

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:55433";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";

const root = path.resolve(__dirname, "../../../..");
const originalResolveFilename = Module._resolveFilename;

function resolveSource(request) {
  const candidate = request.startsWith("@/")
    ? path.join(root, "src", request.slice(2))
    : request;
  if (candidate === request || path.extname(candidate)) return candidate;
  for (const extension of [".ts", ".tsx", ".js", ".cjs"]) {
    if (fs.existsSync(candidate + extension)) return candidate + extension;
  }
  return candidate;
}

Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  return originalResolveFilename.call(this, resolveSource(request), parent, isMain, options);
};

function transpile(source, filename) {
  return ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      sourceMap: false,
    },
  }).outputText;
}

require.extensions[".ts"] = function loadTs(module, filename) {
  module._compile(transpile(fs.readFileSync(filename, "utf8"), filename), filename);
};
require.extensions[".tsx"] = require.extensions[".ts"];

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function installBrowserStubs() {
  function createStorage() {
    const values = new Map();
    return {
      get length() { return values.size; },
      key: (index) => [...values.keys()][index] ?? null,
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
      clear: () => values.clear(),
    };
  }
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  global.window = global;
  global.window.localStorage = localStorage;
  global.window.sessionStorage = sessionStorage;
  global.window.addEventListener = () => {};
  global.window.removeEventListener = () => {};
  global.window.setInterval = setInterval;
  global.window.clearInterval = clearInterval;
  global.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  global.cancelAnimationFrame = (handle) => clearTimeout(handle);
  global.window.getComputedStyle = () => ({ visibility: "visible" });
  global.window.confirm = () => true;
  global.document = {
    cookie: "",
    activeElement: null,
    fullscreenElement: null,
    addEventListener() {},
    removeEventListener() {},
    exitFullscreen: async () => {},
  };
  global.IS_REACT_ACT_ENVIRONMENT = true;
  return { localStorage, sessionStorage };
}

function queryResult(table) {
  let data = [];
  if (table === "memberships") data = [{ organization_id: "org-a", created_at: "2026-01-01" }];
  if (table === "stores") data = [{ id: "store-a", organization_id: "org-a", name: "Loja A", created_at: "2026-01-01" }];
  if (table === "store_schedule_settings") data = { timezone_name: "America/Sao_Paulo", operating_hours: null };
  if (table === "leads") data = [{ id: "lead-a", name: "Cliente A", phone: "11999999999", state: "SP", created_at: "2026-01-01" }];
  if (table === "conversations") data = [{ id: "conversation-a", lead_id: "lead-a", status: "open", is_human_active: false, last_message_at: "2026-01-01" }];
  if (table === "commercial_opportunities") data = [{ id: "opportunity-a", stage: "qualified", primary_conversation_id: "conversation-a" }];
  const result = Promise.resolve({ data, error: null });
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    order: () => query,
    limit: () => query,
    maybeSingle: () => Promise.resolve({ data, error: null }),
    single: () => Promise.resolve({ data, error: null }),
    then: (resolve, reject) => result.then(resolve, reject),
    catch: (reject) => result.catch(reject),
  };
  return query;
}

async function flush() {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function findButton(renderer, label) {
  return renderer.root.findAll((node) => node.type === "button" && node.children.join("") === label)[0];
}

async function mountPage({ rpcPromise }) {
  const { supabase } = require("@/lib/supabaseBrowser");
  const auth = supabase.auth;
  const originals = {
    getUser: auth.getUser,
    getSession: auth.getSession,
    onAuthStateChange: auth.onAuthStateChange,
    from: supabase.from,
    rpc: supabase.rpc,
  };
  const authCallbacks = new Set();
  let currentUserId = "user-a";
  let rpcCalled = false;
  let authFailure = false;
  let nextAuthRead = null;
  rpcPromise.catch(() => {});
  auth.getUser = async () => {
    if (authFailure) throw new Error("auth unavailable");
    if (nextAuthRead?.getUser) return nextAuthRead.getUser;
    return { data: { user: { id: currentUserId } }, error: null };
  };
  auth.getSession = async () => {
    if (authFailure) throw new Error("session unavailable");
    if (nextAuthRead?.getSession) return nextAuthRead.getSession;
    return { data: { session: { user: { id: currentUserId } } }, error: null };
  };
  auth.onAuthStateChange = (callback) => {
    authCallbacks.add(callback);
    return { data: { subscription: { unsubscribe() { authCallbacks.delete(callback); } } } };
  };
  supabase.from = (table) => queryResult(table);
  supabase.rpc = (name) => {
    if (name === "create_common_appointment_by_user") {
      rpcCalled = true;
      return rpcPromise;
    }
    return Promise.resolve({ data: null, error: null });
  };
  global.fetch = async () => {
    return { ok: true, status: 200, json: async () => ({ ok: true, items: [] }) };
  };

  try {
    const { StoreProvider } = require("@/components/StoreProvider");
    const SchedulePage = require("./page.tsx").default;
    let renderer;
    await act(async () => {
      renderer = create(React.createElement(StoreProvider, null, React.createElement(SchedulePage)));
      await flush();
    });
    return {
      renderer,
      switchUser(userId) {
        currentUserId = userId;
        act(() => {
          for (const callback of [...authCallbacks]) {
            callback("SIGNED_IN", { user: { id: userId } });
          }
        });
      },
      switchToNoSession() {
        currentUserId = null;
        act(() => {
          for (const callback of [...authCallbacks]) callback("SIGNED_OUT", null);
        });
      },
      setNextAuthRead({ userId, sessionUserId = userId, userError = null, sessionError = null }) {
        nextAuthRead = {
          getUser: { data: { user: userId ? { id: userId } : null }, error: userError },
          getSession: { data: { session: sessionUserId ? { user: { id: sessionUserId } } : null }, error: sessionError },
        };
      },
      setDeferredAuthRead(getUserPromise, getSessionPromise) {
        nextAuthRead = { getUser: getUserPromise, getSession: getSessionPromise };
      },
      clearAuthRead() { nextAuthRead = null; },
      get rpcCalled() { return rpcCalled; },
      get authSubscriberCount() { return authCallbacks.size; },
      failAuth() { authFailure = true; nextAuthRead = null; },
      restore() {
        auth.getUser = originals.getUser;
        auth.getSession = originals.getSession;
        auth.onAuthStateChange = originals.onAuthStateChange;
        supabase.from = originals.from;
        supabase.rpc = originals.rpc;
        act(() => renderer.unmount());
      },
    };
  } catch (error) {
    auth.getUser = originals.getUser;
    auth.getSession = originals.getSession;
    auth.onAuthStateChange = originals.onAuthStateChange;
    supabase.from = originals.from;
    supabase.rpc = originals.rpc;
    throw error;
  }
}

async function run() {
  const { localStorage, sessionStorage } = installBrowserStubs();
  const recoveryKey = "zion:schedule:appointment-create:v1:user-a:org-a:store-a";
  const rpc = deferred();
  const mounted = await mountPage({ rpcPromise: rpc.promise });
  try {
    assert.ok(mounted.authSubscriberCount >= 2, "StoreProvider e SchedulePage devem manter inscrições independentes");
    const open = findButton(mounted.renderer, "+ Novo compromisso");
    assert.equal(open.props.disabled, false, "o painel deve estar pronto com loja autenticada");
    await act(async () => {
      open.props.onClick({ currentTarget: null });
      await flush();
    });
    const title = mounted.renderer.root.findAll((node) => node.type === "input" && node.props.placeholder?.startsWith("Ex.:"))[0];
    await act(async () => title.props.onChange({ target: { value: "Teste React Agenda" } }));
    const typeSelect = mounted.renderer.root.findAll((node) => node.type === "select")[0];
    await act(async () => typeSelect.props.onChange({ target: { value: "installation" } }));
    const save = findButton(mounted.renderer, "Salvar compromisso");
    assert.equal(save.props.disabled, false, "o formulário deve aceitar o envio");
    await act(async () => {
      save.props.onClick();
      await flush();
    });
    if (!mounted.rpcCalled) {
      console.error("debug storage", Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.getItem(sessionStorage.key(index))));
      console.error("debug buttons", mounted.renderer.root.findAll((node) => node.type === "button").map((node) => node.children.join("")));
      console.error("debug errors", mounted.renderer.root.findAll((node) => typeof node.props.className === "string" && node.props.className.includes("red-50")).map((node) => node.children));
      console.error("debug text", mounted.renderer.toJSON());
    }
    assert.equal(mounted.rpcCalled, true, "o handler real deve chamar a RPC humana comum");
    const recoveryRaw = sessionStorage.getItem(recoveryKey);
    assert.ok(recoveryRaw, "a página deve persistir recovery no sessionStorage antes da RPC");
    assert.equal(localStorage.getItem(recoveryKey), null, "recovery não pode vazar para localStorage");
    const recovery = JSON.parse(recoveryRaw)[0];
    assert.equal(recovery.userId, "user-a");
    assert.equal(typeof recovery.operationKey, "string");

    mounted.switchUser("user-b");
    rpc.reject(new Error("network timeout"));
    await act(async () => flush());
    assert.equal(
      sessionStorage.getItem(recoveryKey) !== null,
      true,
      "a resposta stale não deve apagar a evidência de A",
    );
  } finally {
    mounted.restore();
  }

  installBrowserStubs();
  const nullSessionRpc = deferred();
  const nullSessionPage = await mountPage({ rpcPromise: nullSessionRpc.promise });
  try {
    nullSessionPage.setNextAuthRead({ userId: null, sessionUserId: null });
    await act(async () => {
      findButton(nullSessionPage.renderer, "+ Novo compromisso").props.onClick({ currentTarget: null });
      await flush();
    });
    assert.equal(nullSessionPage.rpcCalled, false, "sessão nula deve invalidar a identidade e bloquear envio");
  } finally {
    nullSessionPage.restore();
  }

  installBrowserStubs();
  const staleRpc = deferred();
  const stalePage = await mountPage({ rpcPromise: staleRpc.promise });
  try {
    const userRead = deferred();
    const sessionRead = deferred();
    stalePage.setDeferredAuthRead(userRead.promise, sessionRead.promise);
    await act(async () => {
      findButton(stalePage.renderer, "+ Novo compromisso").props.onClick({ currentTarget: null });
      await Promise.resolve();
    });
    stalePage.switchUser("user-b");
    userRead.resolve({ data: { user: { id: "user-a" } }, error: null });
    sessionRead.resolve({ data: { session: { user: { id: "user-a" } } }, error: null });
    await act(async () => flush());
    assert.equal(stalePage.rpcCalled, false, "leitura stale de A não pode enviar pela sessão B");
    stalePage.clearAuthRead();
    stalePage.switchUser("user-a");
    await act(async () => flush());
  } finally {
    stalePage.restore();
  }

  installBrowserStubs();
  const authFailureRpc = deferred();
  const authFailurePage = await mountPage({ rpcPromise: authFailureRpc.promise });
  try {
    authFailurePage.failAuth();
    await act(async () => {
      findButton(authFailurePage.renderer, "+ Novo compromisso").props.onClick({ currentTarget: null });
      await flush();
    });
    assert.equal(authFailurePage.rpcCalled, false, "falha de identidade não pode alcançar a RPC");
  } finally {
    authFailurePage.restore();
  }

}

run()
  .then(() => {
    console.log("schedule page React harness passed");
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
