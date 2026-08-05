import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

type TestCase = {
  name: string;
  run: () => Promise<void>;
};

type RuntimeState = {
  requestUser: { id: string } | null;
  resolvedFlow: {
    flow: string;
    attemptState: string;
  };
  authUser: {
    id: string;
    app_metadata?: Record<string, unknown> | null;
  };
  updateError?: unknown;
};

let importCounter = 0;

function toDataUrl(source: string) {
  return `data:text/javascript;base64,${Buffer.from(source, "utf8").toString("base64")}`;
}

async function importRouteModule() {
  importCounter += 1;

  const nextServerModuleUrl = toDataUrl(`
    export class NextResponse extends Response {
      static json(payload, init = {}) {
        return new Response(JSON.stringify(payload), {
          status: init.status ?? 200,
          headers: { "content-type": "application/json" },
        });
      }
    }
  `);

  const supabaseServerModuleUrl = toDataUrl(`
    export async function createSupabaseServerClient() {
      return globalThis.__firstAccessCompleteRuntimeState.requestSupabase;
    }
  `);

  const provisioningModuleUrl = toDataUrl(`
    export function buildCompletedFirstAccessMetadata(currentMetadata, completedAtIso) {
      return {
        ...(currentMetadata || {}),
        zion_first_access_required: false,
        zion_first_access_completed_at: completedAtIso,
        zion_first_access_invite_id: null,
        zion_password_login_required_after: completedAtIso,
      };
    }
    export function createServiceSupabaseClient() {
      return globalThis.__firstAccessCompleteRuntimeState.serviceSupabase;
    }
    export async function getAuthAdminUserById() {
      return globalThis.__firstAccessCompleteRuntimeState.authUser;
    }
    export function resolveTrustedPasswordFlow() {
      return globalThis.__firstAccessCompleteRuntimeState.resolvedFlow;
    }
  `);

  const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8")
    .replace(
      'import { NextResponse } from "next/server";',
      `import { NextResponse } from ${JSON.stringify(nextServerModuleUrl)};`,
    )
    .replace(
      'import { createSupabaseServerClient } from "@/lib/supabaseServer";',
      `import { createSupabaseServerClient } from ${JSON.stringify(supabaseServerModuleUrl)};`,
    )
    .replace(
      /import\s*\{\s*buildCompletedFirstAccessMetadata,\s*createServiceSupabaseClient,\s*getAuthAdminUserById,\s*resolveTrustedPasswordFlow,\s*\}\s*from\s*"@\/lib\/server\/zion-account-provisioning";/,
      `import { buildCompletedFirstAccessMetadata, createServiceSupabaseClient, getAuthAdminUserById, resolveTrustedPasswordFlow } from ${JSON.stringify(provisioningModuleUrl)};`,
    )
    .replace(/function getErrorDiagnostics\(error: unknown\)/, "function getErrorDiagnostics(error)")
    .replace(/const value = error as \{[\s\S]*?\} \| null;/, "const value = error;")
    .replace("export async function POST(request: Request) {", "export async function POST(request) {")
    .replace(/} catch \(error: unknown\) \{/, "} catch (error) {");

  return import(toDataUrl(`${routeSource}\n//# sourceURL=first-access-complete-route-${importCounter}.mjs`));
}

async function createHarness(state: RuntimeState) {
  const runtimeState = {
    ...state,
    calls: {
      resolveAttempts: [] as Array<string | null | undefined>,
      updateUserById: 0,
    },
    requestSupabase: {
      auth: {
        async getUser() {
          return {
            data: { user: state.requestUser },
            error: null,
          };
        },
      },
    },
    serviceSupabase: {
      auth: {
        admin: {
          async updateUserById(_userId: string, payload: { app_metadata: Record<string, unknown> }) {
            runtimeState.calls.updateUserById += 1;
            runtimeState.authUser.app_metadata = payload.app_metadata;
            return {
              data: { user: runtimeState.authUser },
              error: state.updateError ?? null,
            };
          },
        },
      },
    },
  };

  const provisioningFlow = runtimeState.resolvedFlow;
  runtimeState.resolvedFlow = new Proxy(provisioningFlow, {
    get(target, prop) {
      return Reflect.get(target, prop);
    },
  });

  (globalThis as typeof globalThis & {
    __firstAccessCompleteRuntimeState?: typeof runtimeState;
  }).__firstAccessCompleteRuntimeState = runtimeState;

  const routeModule = await importRouteModule();

  return {
    state: runtimeState,
    async run(body: Record<string, unknown>) {
      try {
        return await routeModule.POST(
          new Request("https://example.com/api/account/first-access/complete", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
        );
      } finally {
        delete (globalThis as typeof globalThis & {
          __firstAccessCompleteRuntimeState?: typeof runtimeState;
        }).__firstAccessCompleteRuntimeState;
      }
    },
  };
}

async function getJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

const tests: TestCase[] = [
  {
    name: "missing attempt returns safe 409 and does not update metadata",
    run: async () => {
      const harness = await createHarness({
        requestUser: { id: "user-1" },
        resolvedFlow: { flow: "first_access", attemptState: "missing" },
        authUser: { id: "user-1", app_metadata: {} },
      });
      const response = await harness.run({});
      const payload = await getJson(response);

      assert.equal(response.status, 409);
      assert.equal(
        payload.error,
        "Este convite nao e mais valido para concluir a primeira senha. Solicite um novo envio ao administrador.",
      );
      assert.equal(harness.state.calls.updateUserById, 0);
    },
  },
  {
    name: "mismatched attempt returns safe 409 and does not update metadata",
    run: async () => {
      const harness = await createHarness({
        requestUser: { id: "user-1" },
        resolvedFlow: { flow: "first_access", attemptState: "mismatch" },
        authUser: { id: "user-1", app_metadata: {} },
      });
      const response = await harness.run({ attempt: "fia_old" });

      assert.equal(response.status, 409);
      assert.equal(harness.state.calls.updateUserById, 0);
    },
  },
  {
    name: "valid current attempt completes first access and writes login-required marker",
    run: async () => {
      const harness = await createHarness({
        requestUser: { id: "user-1" },
        resolvedFlow: { flow: "first_access", attemptState: "valid" },
        authUser: { id: "user-1", app_metadata: { zion_first_access_required: true } },
      });
      const response = await harness.run({ attempt: "fia_current" });
      const payload = await getJson(response);

      assert.equal(response.status, 200);
      assert.equal(payload.ok, true);
      assert.equal(harness.state.calls.updateUserById, 1);
      assert.equal(
        typeof harness.state.authUser.app_metadata?.zion_password_login_required_after,
        "string",
      );
    },
  },
];

async function run() {
  for (const test of tests) {
    await test.run();
  }

  console.log(`account-first-access-complete route tests: ${tests.length} passed`);
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
