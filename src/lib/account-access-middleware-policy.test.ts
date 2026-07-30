import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  KNOWN_PUBLIC_MIDDLEWARE_PATHS,
  resolveAccountAccessMiddlewarePolicy,
  type MiddlewareAuthState,
} from "./account-access-middleware-policy";
import {
  buildRedirectUrl,
  evaluateMiddlewarePathname,
} from "../../middleware";

type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

function expectNext(pathname: string, authState: MiddlewareAuthState) {
  assert.deepEqual(resolveAccountAccessMiddlewarePolicy(pathname, authState), {
    action: "next",
    destination: null,
  });
}

function expectRedirect(
  pathname: string,
  authState: MiddlewareAuthState,
  destination: string,
  preserveRedirectTo: boolean,
) {
  assert.deepEqual(resolveAccountAccessMiddlewarePolicy(pathname, authState), {
    action: "redirect",
    destination,
    preserveRedirectTo,
  });
}

const tests: TestCase[] = [
  {
    name: "/login is public",
    run: () => {
      expectNext("/login", "anonymous");
    },
  },
  {
    name: "/auth/callback is public",
    run: () => {
      expectNext("/auth/callback", "anonymous");
    },
  },
  {
    name: "/auth/reset-password is public",
    run: () => {
      expectNext("/auth/reset-password", "anonymous");
    },
  },
  {
    name: "/auth/set-initial-password is public",
    run: () => {
      expectNext("/auth/set-initial-password", "anonymous");
    },
  },
  {
    name: "/account/access-blocked is public",
    run: () => {
      expectNext("/account/access-blocked", "anonymous");
    },
  },
  {
    name: "/account/access-unavailable is public",
    run: () => {
      expectNext("/account/access-unavailable", "anonymous");
    },
  },
  {
    name: "legal pages are public",
    run: () => {
      expectNext("/privacy-policy", "anonymous");
      expectNext("/terms-of-service", "anonymous");
      expectNext("/data-deletion", "anonymous");
    },
  },
  {
    name: "internal released routes remain public",
    run: () => {
      expectNext(
        "/api/internal/assistant/responsible-external-notifications/send",
        "anonymous",
      );
      expectNext("/api/internal/whatsapp/process-inbox", "anonymous");
      expectNext("/api/internal/assistant-operational-tasks/process", "anonymous");
    },
  },
  {
    name: "cron routes remain public",
    run: () => {
      expectNext("/api/cron/assistant-operational-tasks", "anonymous");
      expectNext("/api/cron/whatsapp-process-all", "anonymous");
    },
  },
  {
    name: "all known public middleware routes remain public",
    run: () => {
      for (const pathname of KNOWN_PUBLIC_MIDDLEWARE_PATHS) {
        expectNext(pathname, "anonymous");
        expectNext(pathname, "unavailable");
      }
    },
  },
  {
    name: "/favicon.ico is public",
    run: () => {
      expectNext("/favicon.ico", "anonymous");
    },
  },
  {
    name: "/favicon-administracao is protected",
    run: () => {
      expectRedirect("/favicon-administracao", "anonymous", "/login", true);
    },
  },
  {
    name: "/_next/arquivo is public",
    run: () => {
      expectNext("/_next/arquivo", "anonymous");
    },
  },
  {
    name: "/_next-falso is protected",
    run: () => {
      expectRedirect("/_next-falso", "anonymous", "/login", true);
    },
  },
  {
    name: "/zion-admin/login is public",
    run: () => {
      expectNext("/zion-admin/login", "anonymous");
    },
  },
  {
    name: "/onboarding is protected",
    run: () => {
      expectRedirect("/onboarding", "anonymous", "/login", true);
    },
  },
  {
    name: "/crm is protected",
    run: () => {
      expectRedirect("/crm", "anonymous", "/login", true);
    },
  },
  {
    name: "/ without session goes to /login",
    run: () => {
      expectRedirect("/", "anonymous", "/login", true);
    },
  },
  {
    name: "/ bypasses auth lookup even with old cookie",
    run: async () => {
      let clientCalls = 0;
      const result = await evaluateMiddlewarePathname("/", {
        hasSessionCookie: true,
        createClient: async () => {
          clientCalls += 1;
          return {
            getUser: async () => ({
              data: { user: { id: "user-1" } },
              error: null,
            }),
          };
        },
      });

      assert.equal(clientCalls, 0);
      assert.equal(result.authState, "anonymous");
      assert.deepEqual(result.decision, {
        action: "redirect",
        destination: "/login",
        preserveRedirectTo: true,
      });
    },
  },
  {
    name: "/ bypasses auth lookup even with valid session response",
    run: async () => {
      let clientCalls = 0;
      const result = await evaluateMiddlewarePathname("/", {
        hasSessionCookie: false,
        createClient: async () => {
          clientCalls += 1;
          return {
            getUser: async () => ({
              data: { user: { id: "user-1" } },
              error: null,
            }),
          };
        },
      });

      assert.equal(clientCalls, 0);
      assert.equal(result.authState, "anonymous");
      assert.deepEqual(result.decision, {
        action: "redirect",
        destination: "/login",
        preserveRedirectTo: true,
      });
    },
  },
  {
    name: "authenticated in /crm continues",
    run: () => {
      expectNext("/crm", "authenticated");
    },
  },
  {
    name: "anonymous in /crm goes to /login",
    run: () => {
      expectRedirect("/crm", "anonymous", "/login", true);
    },
  },
  {
    name: "anonymous in /zion-admin goes to /zion-admin/login",
    run: () => {
      expectRedirect("/zion-admin", "anonymous", "/zion-admin/login", true);
    },
  },
  {
    name: "anonymous in zion admin subroute goes to /zion-admin/login",
    run: () => {
      expectRedirect(
        "/zion-admin/overview",
        "anonymous",
        "/zion-admin/login",
        true,
      );
    },
  },
  {
    name: "unavailable in /crm goes to /account/access-unavailable",
    run: () => {
      expectRedirect(
        "/crm",
        "unavailable",
        "/account/access-unavailable",
        false,
      );
    },
  },
  {
    name: "unavailable in /zion-admin goes to /account/access-unavailable",
    run: () => {
      expectRedirect(
        "/zion-admin",
        "unavailable",
        "/account/access-unavailable",
        false,
      );
    },
  },
  {
    name: "auth unavailable on public route does not loop",
    run: () => {
      expectNext("/account/access-unavailable", "unavailable");
      expectNext("/login", "unavailable");
    },
  },
  {
    name: "trailing slash does not alter result",
    run: () => {
      assert.deepEqual(
        resolveAccountAccessMiddlewarePolicy("/crm/", "anonymous"),
        resolveAccountAccessMiddlewarePolicy("/crm", "anonymous"),
      );
      assert.deepEqual(
        resolveAccountAccessMiddlewarePolicy("/zion-admin/", "anonymous"),
        resolveAccountAccessMiddlewarePolicy("/zion-admin", "anonymous"),
      );
    },
  },
  {
    name: "pathname without query string keeps correct classification",
    run: () => {
      expectRedirect("/crm", "anonymous", "/login", true);
      expectNext("/auth/callback", "anonymous");
    },
  },
  {
    name: "redirectTo is preserved only for login redirects",
    run: () => {
      const storeLogin = resolveAccountAccessMiddlewarePolicy("/crm", "anonymous");
      const adminLogin = resolveAccountAccessMiddlewarePolicy(
        "/zion-admin",
        "anonymous",
      );
      const unavailable = resolveAccountAccessMiddlewarePolicy(
        "/crm",
        "unavailable",
      );

      assert.equal(storeLogin.action, "redirect");
      assert.equal(storeLogin.preserveRedirectTo, true);
      assert.equal(adminLogin.action, "redirect");
      assert.equal(adminLogin.preserveRedirectTo, true);
      assert.equal(unavailable.action, "redirect");
      assert.equal(unavailable.preserveRedirectTo, false);
    },
  },
  {
    name: "protected URL with original query does not copy query to login",
    run: () => {
      const url = buildRedirectUrl(
        "https://example.test/crm?token=segredo&cliente=123",
        "/crm",
        {
          action: "redirect",
          destination: "/login",
          preserveRedirectTo: true,
        },
      );

      assert.equal(url, "https://example.test/login?redirectTo=%2Fcrm");
    },
  },
  {
    name: "login redirect receives only redirectTo",
    run: () => {
      const url = new URL(
        buildRedirectUrl(
          "https://example.test/zion-admin?foo=1&bar=2",
          "/zion-admin",
          {
            action: "redirect",
            destination: "/zion-admin/login",
            preserveRedirectTo: true,
          },
        ),
      );

      assert.equal(url.pathname, "/zion-admin/login");
      assert.equal(url.searchParams.get("redirectTo"), "/zion-admin");
      assert.equal(Array.from(url.searchParams.keys()).join(","), "redirectTo");
    },
  },
  {
    name: "unavailable redirect receives no query and no redirectTo",
    run: () => {
      const url = new URL(
        buildRedirectUrl(
          "https://example.test/crm?token=segredo&cliente=123",
          "/crm",
          {
            action: "redirect",
            destination: "/account/access-unavailable",
            preserveRedirectTo: false,
          },
        ),
      );

      assert.equal(url.pathname, "/account/access-unavailable");
      assert.equal(url.search, "");
    },
  },
  {
    name: "public route does not create the client",
    run: async () => {
      let clientCalls = 0;
      const result = await evaluateMiddlewarePathname("/login", {
        createClient: async () => {
          clientCalls += 1;
          return {
            getUser: async () => ({
              data: { user: null },
              error: null,
            }),
          };
        },
      });

      assert.equal(clientCalls, 0);
      assert.equal(result.authState, "anonymous");
      assert.deepEqual(result.decision, {
        action: "next",
        destination: null,
      });
    },
  },
  {
    name: "protected route calls auth.getUser once",
    run: async () => {
      let clientCalls = 0;
      let getUserCalls = 0;
      const result = await evaluateMiddlewarePathname("/crm", {
        createClient: async () => {
          clientCalls += 1;
          return {
            getUser: async () => {
              getUserCalls += 1;
              return {
                data: { user: { id: "user-1" } },
                error: null,
              };
            },
          };
        },
      });

      assert.equal(clientCalls, 1);
      assert.equal(getUserCalls, 1);
      assert.equal(result.authState, "authenticated");
      assert.deepEqual(result.decision, {
        action: "next",
        destination: null,
      });
    },
  },
  {
    name: "client creation failure becomes unavailable",
    run: async () => {
      let clientCalls = 0;
      const result = await evaluateMiddlewarePathname("/crm", {
        hasSessionCookie: true,
        createClient: async () => {
          clientCalls += 1;
          throw new Error("client failed");
        },
      });

      assert.equal(clientCalls, 1);
      assert.equal(result.authState, "unavailable");
      assert.deepEqual(result.decision, {
        action: "redirect",
        destination: "/account/access-unavailable",
        preserveRedirectTo: false,
      });
    },
  },
  {
    name: "getUser error becomes unavailable",
    run: async () => {
      let clientCalls = 0;
      let getUserCalls = 0;
      const result = await evaluateMiddlewarePathname("/crm", {
        hasSessionCookie: true,
        createClient: async () => {
          clientCalls += 1;
          return {
            getUser: async () => {
              getUserCalls += 1;
              return {
                data: { user: null },
                error: new Error("supabase failed"),
              };
            },
          };
        },
      });

      assert.equal(clientCalls, 1);
      assert.equal(getUserCalls, 1);
      assert.equal(result.authState, "unavailable");
      assert.deepEqual(result.decision, {
        action: "redirect",
        destination: "/account/access-unavailable",
        preserveRedirectTo: false,
      });
    },
  },
  {
    name: "getUser exception becomes unavailable",
    run: async () => {
      let clientCalls = 0;
      let getUserCalls = 0;
      const result = await evaluateMiddlewarePathname("/crm", {
        hasSessionCookie: true,
        createClient: async () => {
          clientCalls += 1;
          return {
            getUser: async () => {
              getUserCalls += 1;
              throw new Error("network failed");
            },
          };
        },
      });

      assert.equal(clientCalls, 1);
      assert.equal(getUserCalls, 1);
      assert.equal(result.authState, "unavailable");
      assert.deepEqual(result.decision, {
        action: "redirect",
        destination: "/account/access-unavailable",
        preserveRedirectTo: false,
      });
    },
  },
  {
    name: "legitimate user absence becomes anonymous",
    run: async () => {
      let clientCalls = 0;
      let getUserCalls = 0;
      const result = await evaluateMiddlewarePathname("/crm", {
        createClient: async () => {
          clientCalls += 1;
          return {
            getUser: async () => {
              getUserCalls += 1;
              return {
                data: { user: null },
                error: null,
              };
            },
          };
        },
      });

      assert.equal(clientCalls, 1);
      assert.equal(getUserCalls, 1);
      assert.equal(result.authState, "anonymous");
      assert.deepEqual(result.decision, {
        action: "redirect",
        destination: "/login",
        preserveRedirectTo: true,
      });
    },
  },
  {
    name: "getUser error without session cookie behaves as anonymous",
    run: async () => {
      const result = await evaluateMiddlewarePathname("/", {
        hasSessionCookie: false,
        createClient: async () => ({
          getUser: async () => ({
            data: { user: null },
            error: new Error("supabase failed"),
          }),
        }),
      });

      assert.equal(result.authState, "anonymous");
      assert.deepEqual(result.decision, {
        action: "redirect",
        destination: "/login",
        preserveRedirectTo: true,
      });
    },
  },
  {
    name: "client creation failure without session cookie behaves as anonymous",
    run: async () => {
      const result = await evaluateMiddlewarePathname("/crm", {
        hasSessionCookie: false,
        createClient: async () => {
          throw new Error("client failed");
        },
      });

      assert.equal(result.authState, "anonymous");
      assert.deepEqual(result.decision, {
        action: "redirect",
        destination: "/login",
        preserveRedirectTo: true,
      });
    },
  },
  {
    name: "middleware production code has exactly one createServerClient call",
    run: () => {
      const middlewareSource = readFileSync(
        join(process.cwd(), "middleware.ts"),
        "utf8",
      );
      const createServerClientCalls = middlewareSource
        .split(/\r?\n/)
        .filter((line) => {
          const trimmed = line.trim();
          return (
            !trimmed.startsWith("import ") &&
            !trimmed.startsWith("//") &&
            trimmed.includes("createServerClient(")
          );
        }).length;

      assert.equal(createServerClientCalls, 1);
    },
  },
  {
    name: "root page source redirects directly to /login",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/app/page.tsx"),
        "utf8",
      );

      assert.equal(source.includes('redirect("/login")'), true);
      assert.equal(source.includes('redirect("/dashboard")'), false);
    },
  },
];

async function main() {
  let passed = 0;

  for (const test of tests) {
    try {
      await test.run();
      passed += 1;
    } catch (error) {
      console.error(`FAIL ${test.name}`);
      throw error;
    }
  }

  console.log(
    `account-access-middleware-policy: ${passed}/${tests.length} tests passed`,
  );
}

void main();
