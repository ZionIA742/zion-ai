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

function sessionWithoutUser(error = null) {
  return { data: { session: null }, error };
}

function sessionWithError(message) {
  return { data: { session: null }, error: new Error(message) };
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
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
  }
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

async function mountLoadedUser({
  sessionQueue,
  queryQueue,
  userId,
  organizationId,
  stores,
}) {
  sessionQueue.push(Promise.resolve(sessionFor(userId)));
  queryQueue.push(
    queryResult([{ organization_id: organizationId, created_at: "2026-01-01" }]),
    queryResult(stores),
  );
  const renderer = renderProbe();
  await act(async () => flushAsyncWork());
  return renderer;
}

function assertContextEmpty(snapshot) {
  assert.equal(snapshot?.organizationId, null);
  assert.deepEqual(snapshot?.stores, []);
  assert.equal(snapshot?.activeStoreId, null);
}

const tests = [
  {
    name: "usuario A para B limpa imediatamente",
    async run() {
      installLocalStorage();
      await withMockedSupabase(async ({ sessionQueue, queryQueue, emitAuth }) => {
        const storeA = store("store-a", "org-a", "Loja A");
        const renderer = await mountLoadedUser({
          sessionQueue,
          queryQueue,
          userId: "user-a",
          organizationId: "org-a",
          stores: [storeA],
        });
        const sessionB = deferred();
        sessionQueue.push(sessionB.promise);

        act(() => emitAuth({ user: { id: "user-b" } }));
        assertContextEmpty(renderer.snapshot);
        act(() => renderer.renderer.unmount());
      });
    },
  },
  {
    name: "B pendente nao expoe dados de A",
    async run() {
      installLocalStorage();
      await withMockedSupabase(async ({ sessionQueue, queryQueue, emitAuth }) => {
        const renderer = await mountLoadedUser({
          sessionQueue,
          queryQueue,
          userId: "user-a",
          organizationId: "org-a",
          stores: [store("store-a", "org-a", "Loja A")],
        });
        const sessionB = deferred();
        sessionQueue.push(sessionB.promise);
        act(() => emitAuth({ user: { id: "user-b" } }));
        assertContextEmpty(renderer.snapshot);
        act(() => renderer.renderer.unmount());
      });
    },
  },
  {
    name: "getSession nulo apos B permanece vazio",
    async run() {
      installLocalStorage();
      await withMockedSupabase(async ({ sessionQueue, queryQueue, emitAuth }) => {
        const renderer = await mountLoadedUser({
          sessionQueue,
          queryQueue,
          userId: "user-a",
          organizationId: "org-a",
          stores: [store("store-a", "org-a", "Loja A")],
        });
        sessionQueue.push(Promise.resolve(sessionWithoutUser()));
        act(() => emitAuth({ user: { id: "user-b" } }));
        assertContextEmpty(renderer.snapshot);
        await flushAsyncWork();
        assertContextEmpty(renderer.snapshot);
        act(() => renderer.renderer.unmount());
      });
    },
  },
  {
    name: "getSession com sessao antiga apos B permanece vazio",
    async run() {
      installLocalStorage();
      await withMockedSupabase(async ({ sessionQueue, queryQueue, emitAuth }) => {
        const renderer = await mountLoadedUser({
          sessionQueue,
          queryQueue,
          userId: "user-a",
          organizationId: "org-a",
          stores: [store("store-a", "org-a", "Loja A")],
        });
        sessionQueue.push(Promise.resolve(sessionFor("user-a")));
        act(() => emitAuth({ user: { id: "user-b" } }));
        assertContextEmpty(renderer.snapshot);
        await flushAsyncWork();
        assertContextEmpty(renderer.snapshot);
        act(() => renderer.renderer.unmount());
      });
    },
  },
  {
    name: "resposta atrasada de A nao sobrescreve B",
    async run() {
      installLocalStorage();
      await withMockedSupabase(async ({ sessionQueue, queryQueue, emitAuth }) => {
        const sessionA = deferred();
        sessionQueue.push(sessionA.promise);
        const renderer = renderProbe();
        const sessionB = deferred();
        sessionQueue.push(sessionB.promise);
        const storeB = store("store-b", "org-b", "Loja B");
        queryQueue.push(
          queryResult([{ organization_id: "org-b", created_at: "2026-01-01" }]),
          queryResult([storeB]),
        );
        act(() => emitAuth({ user: { id: "user-b" } }));
        sessionB.resolve(sessionFor("user-b"));
        await act(async () => flushAsyncWork());
        sessionA.resolve(sessionFor("user-a"));
        await act(async () => flushAsyncWork());
        assert.equal(renderer.snapshot?.organizationId, "org-b");
        assert.deepEqual(renderer.snapshot?.stores, [storeB]);
        act(() => renderer.renderer.unmount());
      });
    },
  },
  {
    name: "refresh concorrente com troca de usuario",
    async run() {
      installLocalStorage();
      await withMockedSupabase(async ({ sessionQueue, queryQueue, emitAuth }) => {
        const renderer = await mountLoadedUser({
          sessionQueue,
          queryQueue,
          userId: "user-a",
          organizationId: "org-a",
          stores: [store("store-a", "org-a", "Loja A")],
        });
        const refreshSession = deferred();
        const sessionB = deferred();
        sessionQueue.push(refreshSession.promise, sessionB.promise);
        const refreshPromise = renderer.snapshot?.refreshStores();
        act(() => emitAuth({ user: { id: "user-b" } }));
        assertContextEmpty(renderer.snapshot);
        refreshSession.resolve(sessionFor("user-a"));
        await refreshPromise;
        assertContextEmpty(renderer.snapshot);
        act(() => renderer.renderer.unmount());
      });
    },
  },
  {
    name: "selecao de loja A e bloqueada apos B",
    async run() {
      const storage = installLocalStorage();
      await withMockedSupabase(async ({ sessionQueue, queryQueue, emitAuth }) => {
        const storeA = store("store-a", "org-a", "Loja A");
        const renderer = await mountLoadedUser({
          sessionQueue,
          queryQueue,
          userId: "user-a",
          organizationId: "org-a",
          stores: [storeA],
        });
        const sessionB = deferred();
        sessionQueue.push(sessionB.promise);
        act(() => emitAuth({ user: { id: "user-b" } }));
        act(() => renderer.snapshot?.setActiveStoreId("store-a"));
        assertContextEmpty(renderer.snapshot);
        assert.equal(storage.getItem("zion_active_store_id:user-a"), null);
        act(() => renderer.renderer.unmount());
      });
    },
  },
  {
    name: "logout durante carregamento limpa e invalida",
    async run() {
      installLocalStorage();
      await withMockedSupabase(async ({ sessionQueue, queryQueue, emitAuth }) => {
        const renderer = await mountLoadedUser({
          sessionQueue,
          queryQueue,
          userId: "user-a",
          organizationId: "org-a",
          stores: [store("store-a", "org-a", "Loja A")],
        });
        const pending = deferred();
        sessionQueue.push(pending.promise);
        const refreshPromise = renderer.snapshot?.refreshStores();
        act(() => emitAuth(null));
        assertContextEmpty(renderer.snapshot);
        pending.resolve(sessionFor("user-a"));
        await refreshPromise;
        assertContextEmpty(renderer.snapshot);
        act(() => renderer.renderer.unmount());
      });
    },
  },
  {
    name: "atualizacao da mesma sessao preserva dados validos",
    async run() {
      installLocalStorage();
      await withMockedSupabase(async ({ sessionQueue, queryQueue, emitAuth }) => {
        const storeA = store("store-a", "org-a", "Loja A");
        const renderer = await mountLoadedUser({
          sessionQueue,
          queryQueue,
          userId: "user-a",
          organizationId: "org-a",
          stores: [storeA],
        });
        const sameSession = deferred();
        sessionQueue.push(sameSession.promise);
        const refreshedStore = store("store-a", "org-a", "Loja A atualizada");
        queryQueue.push(
          queryResult([{ organization_id: "org-a", created_at: "2026-01-01" }]),
          queryResult([refreshedStore]),
        );
        act(() => emitAuth({ user: { id: "user-a" } }));
        assert.equal(renderer.snapshot?.organizationId, "org-a");
        sameSession.resolve(sessionFor("user-a"));
        await flushAsyncWork();
        assert.deepEqual(renderer.snapshot?.stores, [refreshedStore]);
        act(() => renderer.renderer.unmount());
      });
    },
  },
  {
    name: "erro de getSession apos B nao reaplica dados antigos",
    async run() {
      installLocalStorage();
      await withMockedSupabase(async ({ sessionQueue, queryQueue, emitAuth }) => {
        const renderer = await mountLoadedUser({
          sessionQueue,
          queryQueue,
          userId: "user-a",
          organizationId: "org-a",
          stores: [store("store-a", "org-a", "Loja A")],
        });
        sessionQueue.push(Promise.resolve(sessionWithError("sessao indisponivel")));
        act(() => emitAuth({ user: { id: "user-b" } }));
        assertContextEmpty(renderer.snapshot);
        await flushAsyncWork();
        assertContextEmpty(renderer.snapshot);
        act(() => renderer.renderer.unmount());
      });
    },
  },
  {
    name: "desmontagem durante requisicoes pendentes",
    async run() {
      installLocalStorage();
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
];

for (const test of tests) await test.run();
console.log(`StoreProvider: ${tests.length} mounted behavioral tests passed`);
