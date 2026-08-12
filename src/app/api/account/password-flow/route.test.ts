import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

type RequestUser = {
  id: string;
};

type RequestScopedSupabase = {
  auth: {
    getUser: () => Promise<{
      data: { user: RequestUser | null };
      error: unknown;
    }>;
  };
};

type ProvisioningUser = {
  id: string;
  app_metadata?: Record<string, unknown> | null;
};

type PasswordFlowRuntimeState = {
  createSupabaseClient: () => Promise<RequestScopedSupabase>;
  createServiceClient: () => unknown;
  getAuthAdminUserById: (_service: unknown, userId: string) => Promise<ProvisioningUser>;
  resolveTrustedPasswordFlow: (
    user: ProvisioningUser,
    options?: { attemptId?: string | null },
  ) => {
    flow: string;
    message: string;
    attemptState: string;
  };
  getInvalidFirstAccessAttemptMessage: (state: string) => string;
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
          headers: {
            "content-type": "application/json",
          },
        });
      }
    }
  `);

  const supabaseServerModuleUrl = toDataUrl(`
    export async function createSupabaseServerClient() {
      return globalThis.__passwordFlowRuntimeState.createSupabaseClient();
    }
  `);

  const provisioningModuleUrl = toDataUrl(`
    export function createServiceSupabaseClient() {
      return globalThis.__passwordFlowRuntimeState.createServiceClient();
    }

    export async function getAuthAdminUserById(...args) {
      return globalThis.__passwordFlowRuntimeState.getAuthAdminUserById(...args);
    }

    export function resolveTrustedPasswordFlow(...args) {
      return globalThis.__passwordFlowRuntimeState.resolveTrustedPasswordFlow(...args);
    }

    export function getInvalidFirstAccessAttemptMessage(state) {
      return globalThis.__passwordFlowRuntimeState.getInvalidFirstAccessAttemptMessage(state);
    }
  `);

  const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8")
    .replace(
      'import { NextResponse } from "next/server";',
      `import { NextResponse } from ${JSON.stringify(nextServerModuleUrl)};`,
    )
    .replace(
      'import { createSupabaseServerClient } from "@/lib/supabaseServer";',
      `import { createSupabaseServerClient } from ${JSON.stringify(
        supabaseServerModuleUrl,
      )};`,
    )
    .replace(
      /import\s*\{\s*createServiceSupabaseClient,\s*getAuthAdminUserById,\s*getInvalidFirstAccessAttemptMessage,\s*resolveTrustedPasswordFlow,\s*\}\s*from\s*"@\/lib\/server\/zion-account-provisioning";/,
      `import { createServiceSupabaseClient, getAuthAdminUserById, getInvalidFirstAccessAttemptMessage, resolveTrustedPasswordFlow } from ${JSON.stringify(
        provisioningModuleUrl,
      )};`,
    )
    .replace(
      "function getErrorDiagnostics(error: unknown) {",
      "function getErrorDiagnostics(error) {",
    )
    .replace(/const value = error as \{[\s\S]*?\} \| null;/, "const value = error;")
    .replace("export async function GET(request: Request) {", "export async function GET(request) {")
    .replace("} catch (error: unknown) {", "} catch (error) {");

  return import(
    toDataUrl(`${routeSource}\n//# sourceURL=account-password-flow-route-${importCounter}.mjs`)
  );
}

async function createPasswordFlowHarness(options: {
  requestUser: RequestUser | null;
  authError?: unknown;
  authAdminUser?: ProvisioningUser;
  authAdminError?: unknown;
  resolvedFlow?: { flow: string; message: string; attemptState: string };
}) {
  const calls = {
    createSupabase: 0,
    createServiceSupabase: 0,
    getUser: 0,
    getAuthAdminUserById: [] as string[],
    attempts: [] as Array<string | null | undefined>,
    invalidAttemptMessages: [] as string[],
  };

  const runtimeState: PasswordFlowRuntimeState = {
    async createSupabaseClient() {
      calls.createSupabase += 1;

      return {
        auth: {
          async getUser() {
            calls.getUser += 1;

            return {
              data: {
                user: options.requestUser,
              },
              error: options.authError ?? null,
            };
          },
        },
      };
    },
    createServiceClient() {
      calls.createServiceSupabase += 1;
      return { kind: "service" };
    },
    async getAuthAdminUserById(_service, userId) {
      calls.getAuthAdminUserById.push(userId);

      if (options.authAdminError) {
        throw options.authAdminError;
      }

      return (
        options.authAdminUser ?? {
          id: userId,
          app_metadata: null,
        }
      );
    },
    resolveTrustedPasswordFlow(user, resolveOptions) {
      calls.attempts.push(resolveOptions?.attemptId);
      return (
        options.resolvedFlow ?? {
          flow: "recovery",
          message: "Digite sua nova senha para concluir a recuperacao.",
          attemptState: "not_applicable",
        }
      );
    },
    getInvalidFirstAccessAttemptMessage(state) {
      calls.invalidAttemptMessages.push(state);
      return `invalid:${state}`;
    },
  };

  (globalThis as typeof globalThis & {
    __passwordFlowRuntimeState?: PasswordFlowRuntimeState;
  }).__passwordFlowRuntimeState = runtimeState;

  const routeModule = await importRouteModule();

  return {
    calls,
    async run(url = "https://example.com/api/account/password-flow") {
      try {
        return await routeModule.GET(new Request(url));
      } finally {
        delete (globalThis as typeof globalThis & {
          __passwordFlowRuntimeState?: PasswordFlowRuntimeState;
        }).__passwordFlowRuntimeState;
      }
    },
  };
}

async function getJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

function assertNoSensitiveMetadata(payload: Record<string, unknown>) {
  assert.equal("provisioned_via" in payload, false);
  assert.equal("zion_provisioning_status" in payload, false);
  assert.equal("zion_first_access_required" in payload, false);
  assert.equal("app_metadata" in payload, false);
}

const tests: TestCase[] = [
  {
    name: "user without session returns 401 and does not reach auth admin",
    run: async () => {
      const harness = await createPasswordFlowHarness({
        requestUser: null,
      });
      const response = await harness.run();
      const payload = await getJson(response);

      assert.equal(response.status, 401);
      assert.deepEqual(payload, {
        error: "Usuario nao autenticado.",
      });
      assert.deepEqual(harness.calls.getAuthAdminUserById, []);
      assertNoSensitiveMetadata(payload);
    },
  },
  {
    name: "valid first access with matching attempt returns attemptValid true",
    run: async () => {
      const harness = await createPasswordFlowHarness({
        requestUser: { id: "user-1" },
        resolvedFlow: {
          flow: "first_access",
          message: "Defina sua primeira senha para concluir o acesso inicial.",
          attemptState: "valid",
        },
      });
      const response = await harness.run(
        "https://example.com/api/account/password-flow?attempt=fia_current",
      );
      const payload = await getJson(response);

      assert.equal(response.status, 200);
      assert.deepEqual(payload, {
        flow: "first_access",
        message: "Defina sua primeira senha para concluir o acesso inicial.",
        attemptValid: true,
        requiresNewLogin: false,
      });
      assert.deepEqual(harness.calls.attempts, ["fia_current"]);
      assertNoSensitiveMetadata(payload);
    },
  },
  {
    name: "first access with missing attempt returns safe invalid message",
    run: async () => {
      const harness = await createPasswordFlowHarness({
        requestUser: { id: "user-2" },
        resolvedFlow: {
          flow: "first_access",
          message: "Defina sua primeira senha para concluir o acesso inicial.",
          attemptState: "missing",
        },
      });
      const response = await harness.run();
      const payload = await getJson(response);

      assert.equal(response.status, 200);
      assert.deepEqual(payload, {
        flow: "first_access",
        message: "invalid:missing",
        attemptValid: false,
        requiresNewLogin: false,
      });
      assertNoSensitiveMetadata(payload);
    },
  },
  {
    name: "recovery remains separate and does not require invite attempt",
    run: async () => {
      const harness = await createPasswordFlowHarness({
        requestUser: { id: "user-3" },
      });
      const response = await harness.run();
      const payload = await getJson(response);

      assert.equal(response.status, 200);
      assert.deepEqual(payload, {
        flow: "recovery",
        message: "Digite sua nova senha para concluir a recuperacao.",
        attemptValid: null,
        requiresNewLogin: false,
      });
      assert.deepEqual(harness.calls.attempts, [null]);
      assert.deepEqual(harness.calls.invalidAttemptMessages, []);
      assert.equal(harness.calls.createServiceSupabase, 1);
      assert.deepEqual(harness.calls.getAuthAdminUserById, ["user-3"]);
      assertNoSensitiveMetadata(payload);
    },
  },
  {
    name: "recovery with attempt stays recovery and never promotes to first_access",
    run: async () => {
      const harness = await createPasswordFlowHarness({
        requestUser: { id: "user-7" },
        resolvedFlow: {
          flow: "recovery",
          message: "Digite sua nova senha para concluir a recuperacao.",
          attemptState: "not_applicable",
        },
      });
      const response = await harness.run(
        "https://example.com/api/account/password-flow?attempt=fia_old",
      );
      const payload = await getJson(response);

      assert.equal(response.status, 200);
      assert.deepEqual(payload, {
        flow: "recovery",
        message: "Digite sua nova senha para concluir a recuperacao.",
        attemptValid: null,
        requiresNewLogin: false,
      });
      assert.deepEqual(harness.calls.attempts, ["fia_old"]);
      assert.deepEqual(harness.calls.invalidAttemptMessages, []);
      assert.equal(harness.calls.createServiceSupabase, 1);
      assert.deepEqual(harness.calls.getAuthAdminUserById, ["user-7"]);
      assertNoSensitiveMetadata(payload);
    },
  },
  {
    name: "pending provisioning metadata returns provisioning_pending",
    run: async () => {
      const harness = await createPasswordFlowHarness({
        requestUser: { id: "user-4" },
        resolvedFlow: {
          flow: "provisioning_pending",
          message:
            "O provisionamento da sua conta ainda esta pendente de conclusao administrativa.",
          attemptState: "not_applicable",
        },
      });
      const response = await harness.run();
      const payload = await getJson(response);

      assert.equal(response.status, 200);
      assert.deepEqual(payload, {
        flow: "provisioning_pending",
        message:
          "O provisionamento da sua conta ainda esta pendente de conclusao administrativa.",
        attemptValid: null,
        requiresNewLogin: false,
      });
      assertNoSensitiveMetadata(payload);
    },
  },
  {
    name: "failed provisioning metadata returns provisioning_failed",
    run: async () => {
      const harness = await createPasswordFlowHarness({
        requestUser: { id: "user-5" },
        resolvedFlow: {
          flow: "provisioning_failed",
          message:
            "O provisionamento da sua conta exige revisao interna antes de qualquer acesso.",
          attemptState: "not_applicable",
        },
      });
      const response = await harness.run();
      const payload = await getJson(response);

      assert.equal(response.status, 200);
      assert.deepEqual(payload, {
        flow: "provisioning_failed",
        message:
          "O provisionamento da sua conta exige revisao interna antes de qualquer acesso.",
        attemptValid: null,
        requiresNewLogin: false,
      });
      assertNoSensitiveMetadata(payload);
    },
  },
  {
    name: "auth admin technical failure returns sanitized 500 response",
    run: async () => {
      const originalError = console.error;
      const logged: string[] = [];

      console.error = (...args: unknown[]) => {
        logged.push(
          args
            .map((value) => {
              if (typeof value === "string") {
                return value;
              }

              try {
                return JSON.stringify(value);
              } catch {
                return String(value);
              }
            })
            .join(" "),
        );
      };

      try {
        const harness = await createPasswordFlowHarness({
          requestUser: { id: "user-6" },
          authAdminError: {
            message: "service role exploded",
            code: "boom",
          },
        });
        const response = await harness.run();
        const payload = await getJson(response);

        assert.equal(response.status, 500);
        assert.deepEqual(payload, {
          error: "Falha tecnica ao verificar o fluxo seguro da conta.",
        });
        assert.equal(logged.join(" ").includes("service role exploded"), true);
        assertNoSensitiveMetadata(payload);
      } finally {
        console.error = originalError;
      }
    },
  },
];

async function run() {
  for (const testCase of tests) {
    await testCase.run();
  }

  console.log(`account-password-flow route tests: ${tests.length} passed`);
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
