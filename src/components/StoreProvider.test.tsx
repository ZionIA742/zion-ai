import { strict as assert } from "node:assert";
import { createElement, useEffect } from "react";
import { act, create } from "react-test-renderer";
import { StoreProvider, useStoreContext } from "./StoreProvider";
import { supabase } from "@/lib/supabaseBrowser";

if (!("window" in globalThis)) {
  Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
}

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
});

function deferred() {
  let resolve;
  const promise = new Promise((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function sessionFor(userId) {
  return { data: { session: { user: { id: userId } } }, error: null };
}

function createQuery(result) {
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    order: () => query,
    then: (onFulfilled, onRejected) => result.then(onFulfilled, onRejected),
  };

  return query;
}

function installLocalStorage() {
  const values = new Map();
  const storage = {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });

  return storage;
}

async function withMockedSupabase(run) {
  const auth = supabase.auth;
  const client = supabase;
  const originalGetSession = auth.getSession;
  const originalOnAuthStateChange = auth.onAuthStateChange;
  const originalFrom = client.from;
  const sessionQueue = [];
  const queryQueue = [];
  let authCallback = null;

  auth.getSession = () => {
    const next = sessionQueue.shift();
    if (!next) throw new Error("unexpected getSession call");
    return next;
  };
  auth.onAuthStateChange = (callback) => {
    authCallback = callback;
    return { data: { subscription: { unsubscribe() {} } } };
  };
  client.from = () => {
    const next = queryQueue.shift();
    if (!next) throw new Error("unexpected query call");
    return createQuery(next);
  };

  try {
    await run({
      sessionQueue,
      queryQueue,
      emitAuth: (session) => {
        assert.ok(authCallback);
        authCallback("SIGNED_IN", session);
      },
    });
  } finally {
    auth.getSession = originalGetSession;
    auth.onAuthStateChange = originalOnAuthStateChange;
    client.from = originalFrom;
  }
}

function queryResult(data) {
  return Promise.resolve({ data, error: null });
}

async function flushAsyncWork() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

function renderProbe() {
  let snapshot = null;
  function Probe() {
    const value = useStoreContext();
    useEffect(() => {
      snapshot = value;
    }, [value]);
    return null;
  }

  let renderer;
  act(() => {
    renderer = create(createElement(StoreProvider, null, createElement(Probe)));
  });

  return {
    renderer,
    get snapshot() {
      return snapshot;
    },
  };
}

const store = (id, organizationId, name) => ({
  id,
  organization_id: organizationId,
  name,
  created_at: "2026-01-01T00:00:00.000Z",
});

const tests = [
  {
    name: "resposta antiga do usuario A nao sobrescreve o usuario B",
    async run() {
      installLocalStorage();
      await withMockedSupabase(async ({ sessionQueue, queryQueue, emitAuth }) => {
        const sessionA = deferred();
        const sessionB = deferred();
        sessionQueue.push(sessionA.promise, sessionB.promise);
        const renderer = renderProbe();

        const storeB = store("store-b", "org-b", "Loja B");
        queryQueue.push(
          queryResult([{ organization_id: "org-b", created_at: "2026-01-01" }]),
          queryResult([storeB]),
        );
        act(() => emitAuth({ user: { id: "user-b" } }));
        await act(async () => {
          sessionB.resolve(sessionFor("user-b"));
          await flushAsyncWork();
        });

        assert.equal(renderer.snapshot?.organizationId, "org-b");
        assert.deepEqual(renderer.snapshot?.stores, [storeB]);

        const storeA = store("store-a", "org-a", "Loja A");
        queryQueue.push(
          queryResult([{ organization_id: "org-a", created_at: "2026-01-01" }]),
          queryResult([storeA]),
        );
        await act(async () => {
          sessionA.resolve(sessionFor("user-a"));
          await flushAsyncWork();
        });

        assert.equal(renderer.snapshot?.organizationId, "org-b");
        assert.deepEqual(renderer.snapshot?.stores, [storeB]);
        act(() => renderer.renderer.unmount());
      });
    },
  },
  {
    name: "logout invalida carregamento pendente e desmontagem ignora resposta tardia",
    async run() {
      installLocalStorage();
      await withMockedSupabase(async ({ sessionQueue, queryQueue, emitAuth }) => {
        const sessionA = deferred();
        sessionQueue.push(sessionA.promise);
        const renderer = renderProbe();

        act(() => emitAuth(null));
        assert.equal(renderer.snapshot?.organizationId, null);
        assert.deepEqual(renderer.snapshot?.stores, []);
        assert.equal(renderer.snapshot?.activeStoreId, null);

        queryQueue.push(
          queryResult([{ organization_id: "org-a", created_at: "2026-01-01" }]),
          queryResult([store("store-a", "org-a", "Loja A")]),
        );
        await act(async () => {
          sessionA.resolve(sessionFor("user-a"));
          await flushAsyncWork();
        });
        assert.equal(renderer.snapshot?.organizationId, null);
        act(() => renderer.renderer.unmount());
      });

      await withMockedSupabase(async ({ sessionQueue, queryQueue }) => {
        const session = deferred();
        sessionQueue.push(session.promise);
        const renderer = renderProbe();
        act(() => renderer.renderer.unmount());
        session.resolve(sessionFor("user-a"));
        queryQueue.push(queryResult([]), queryResult([]));
        await flushAsyncWork();
      });
    },
  },
  {
    name: "preserva selecao valida da loja atual",
    async run() {
      const storage = installLocalStorage();
      await withMockedSupabase(async ({ sessionQueue, queryQueue }) => {
        const session = deferred();
        sessionQueue.push(session.promise);
        const firstStore = store("store-1", "org-1", "Loja 1");
        const secondStore = store("store-2", "org-1", "Loja 2");
        queryQueue.push(
          queryResult([{ organization_id: "org-1", created_at: "2026-01-01" }]),
          queryResult([firstStore, secondStore]),
        );
        const renderer = renderProbe();

        await act(async () => {
          session.resolve(sessionFor("user-1"));
          await flushAsyncWork();
        });
        assert.equal(renderer.snapshot?.activeStoreId, "store-1");

        act(() => renderer.snapshot?.setActiveStoreId("store-2"));
        assert.equal(renderer.snapshot?.activeStoreId, "store-2");
        assert.equal(storage.getItem("zion_active_store_id:user-1"), "store-2");

        const refreshSession = deferred();
        sessionQueue.push(refreshSession.promise);
        queryQueue.push(
          queryResult([{ organization_id: "org-1", created_at: "2026-01-01" }]),
          queryResult([firstStore, secondStore]),
        );
        await act(async () => {
          const refreshPromise = renderer.snapshot?.refreshStores();
          renderer.snapshot?.setActiveStoreId("store-2");
          refreshSession.resolve(sessionFor("user-1"));
          await refreshPromise;
          await flushAsyncWork();
        });
        assert.equal(renderer.snapshot?.activeStoreId, "store-2");
        act(() => renderer.renderer.unmount());
      });
    },
  },
];

for (const test of tests) await test.run();
console.log(`StoreProvider: ${tests.length} mounted behavioral tests passed`);
