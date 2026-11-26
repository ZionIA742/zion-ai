const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const React = require("react");
const ts = require("typescript");
const { act, create } = require("react-test-renderer");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const boundaryPath = path.join(
  __dirname,
  "StoreSessionBoundary.tsx",
);

const boundarySource = fs.readFileSync(
  boundaryPath,
  "utf8",
);

function loadBoundary(auth) {
  const compiled = ts.transpileModule(boundarySource, {
    fileName: boundaryPath,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });

  const mod = new Module(boundaryPath, module);

  mod.filename = boundaryPath;
  mod.paths = module.paths;

  const originalRequire = mod.require.bind(mod);

  mod.require = (request) =>
    request === "@/lib/supabaseBrowser"
      ? { supabase: { auth } }
      : originalRequire(request);

  mod._compile(compiled.outputText, boundaryPath);

  return mod.exports.default;
}

async function fixture(run, options = {}) {
  const previousWindow =
    Object.getOwnPropertyDescriptor(globalThis, "window");

  const previousFetch = globalThis.fetch;

  const navigations = [];
  let callback;
  let unsubscribed = 0;
  let renderer;
  let childMounts = 0;
  let childUnmounts = 0;

  const auth = {
    onAuthStateChange(handler) {
      if (options.subscriptionError) {
        throw new Error("simulated_subscription_error");
      }

      callback = handler;

      return {
        data: {
          subscription: {
            unsubscribe() {
              unsubscribed += 1;
            },
          },
        },
      };
    },

    getSession() {
      throw new Error("UNEXPECTED_GET_SESSION");
    },

    getUser() {
      throw new Error("UNEXPECTED_GET_USER");
    },
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        replace(destination) {
          navigations.push(["replace", destination]);
        },
        reload() {
          navigations.push(["reload"]);
        },
      },
    },
  });

  globalThis.fetch = async () => {
    throw new Error("REAL_NETWORK_REQUEST_BLOCKED");
  };

  const Boundary = loadBoundary(auth);

  function ProtectedContent() {
    React.useEffect(() => {
      childMounts += 1;

      return () => {
        childUnmounts += 1;
      };
    }, []);

    return React.createElement(
      "article",
      null,
      "PRIVATE_STORE_CONTENT",
    );
  }

  function visible() {
    return renderer.root.findAllByType("article").length === 1;
  }

  function emit(event, userId) {
    assert.equal(typeof callback, "function");

    act(() => {
      callback(
        event,
        userId
          ? { user: { id: userId } }
          : null,
      );
    });
  }

  try {
    act(() => {
      renderer = create(
        React.createElement(
          Boundary,
          { expectedUserId: "user-a" },
          React.createElement(ProtectedContent),
        ),
      );
    });

    await run({
      visible,
      emit,
      navigations,
      counts: () => ({
        childMounts,
        childUnmounts,
        unsubscribed,
      }),
      unmount() {
        act(() => renderer.unmount());
        renderer = null;
      },
    });
  } finally {
    if (renderer) {
      act(() => renderer.unmount());
    }

    globalThis.fetch = previousFetch;

    if (previousWindow) {
      Object.defineProperty(
        globalThis,
        "window",
        previousWindow,
      );
    } else {
      delete globalThis.window;
    }
  }
}

test("initial session is hidden until matching identity and token refresh preserves content", async () => {
  await fixture(async (f) => {
    assert.equal(f.visible(), false);

    f.emit("INITIAL_SESSION", "user-a");

    assert.equal(f.visible(), true);
    assert.equal(f.counts().childMounts, 1);

    f.emit("TOKEN_REFRESHED", "user-a");
    f.emit("SIGNED_IN", "user-a");

    assert.equal(f.visible(), true);
    assert.equal(f.counts().childMounts, 1);
    assert.equal(f.counts().childUnmounts, 0);
    assert.deepEqual(f.navigations, []);
  });
});

test("anonymous initial session never mounts protected content", async () => {
  await fixture(async (f) => {
    f.emit("INITIAL_SESSION", null);

    assert.equal(f.visible(), false);
    assert.equal(f.counts().childMounts, 0);
    assert.deepEqual(f.navigations, [
      ["replace", "/login"],
    ]);
  });
});

test("logout unmounts protected content and delayed events cannot restore it", async () => {
  await fixture(async (f) => {
    f.emit("INITIAL_SESSION", "user-a");
    assert.equal(f.visible(), true);

    f.emit("SIGNED_OUT", null);

    assert.equal(f.visible(), false);
    assert.equal(f.counts().childUnmounts, 1);

    f.emit("SIGNED_IN", "user-a");
    f.emit("TOKEN_REFRESHED", "user-a");

    assert.equal(f.visible(), false);
    assert.equal(f.counts().childMounts, 1);
    assert.deepEqual(f.navigations, [
      ["replace", "/login"],
    ]);
  });
});

test("initial identity mismatch requires fresh server validation", async () => {
  await fixture(async (f) => {
    f.emit("INITIAL_SESSION", "user-b");

    assert.equal(f.visible(), false);
    assert.equal(f.counts().childMounts, 0);
    assert.deepEqual(f.navigations, [
      ["reload"],
    ]);
  });
});

test("identity A to B unmounts A and prevents stale identity restoration", async () => {
  await fixture(async (f) => {
    f.emit("INITIAL_SESSION", "user-a");
    assert.equal(f.visible(), true);

    f.emit("SIGNED_IN", "user-b");

    assert.equal(f.visible(), false);
    assert.equal(f.counts().childUnmounts, 1);

    f.emit("TOKEN_REFRESHED", "user-a");
    f.emit("SIGNED_IN", "user-b");

    assert.equal(f.visible(), false);
    assert.deepEqual(f.navigations, [
      ["reload"],
    ]);
  });
});

test("unmount removes subscription and ignores delayed callback", async () => {
  await fixture(async (f) => {
    f.emit("INITIAL_SESSION", "user-a");

    f.unmount();

    assert.equal(f.counts().unsubscribed, 1);
    assert.equal(f.counts().childUnmounts, 1);

    f.emit("SIGNED_OUT", null);

    assert.deepEqual(f.navigations, []);
  });
});

test("subscription failure keeps protected content hidden", async () => {
  await fixture(async (f) => {
    assert.equal(f.visible(), false);
    assert.equal(f.counts().childMounts, 0);

    assert.deepEqual(f.navigations, [
      ["replace", "/account/access-unavailable"],
    ]);
  }, { subscriptionError: true });
});

test("server layout keeps canonical gate and binds protected shell to resolved identity", () => {
  const layout = fs.readFileSync(
    path.join(__dirname, "layout.tsx"),
    "utf8",
  );

  assert.match(
    layout,
    /resolveAccessForRequest\(/,
  );

  assert.match(
    layout,
    /resolveAccountAccessPageGate\(resolution, "store_app"\)/,
  );

  assert.match(
    layout,
    /redirect\(gate\.destination\)/,
  );

  assert.match(
    layout,
    /if \(!resolution\.sessionUserId\)/,
  );

  assert.match(
    layout,
    /<StoreSessionBoundary\s+key=\{resolution\.sessionUserId\}\s+expectedUserId=\{resolution\.sessionUserId\}\s*>\s*<AppShellClient>\{children\}<\/AppShellClient>\s*<\/StoreSessionBoundary>/,
  );

  assert.doesNotMatch(
    boundarySource,
    /auth\.(getSession|getUser|signOut)\s*\(/,
  );
});
