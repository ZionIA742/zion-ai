import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import ts from "typescript";

const listPath = join(process.cwd(), "src/app/api/zion-admin/whatsapp-pins/route.ts");
const revealPath = join(
  process.cwd(),
  "src/app/api/zion-admin/whatsapp-pins/reveal/route.ts",
);

function source(path: string) {
  return readFileSync(path, "utf8");
}

type AccessGranted = {
  ok: true;
  sessionUserId: string;
};

type AccessDenied = {
  ok: false;
  httpStatus: number;
  payload: Record<string, unknown>;
};

type HarnessOptions = {
  routePath: string;
  access: AccessGranted | AccessDenied;
  rpcData?: unknown;
  rpcError?: Error | null;
  decryptedPin?: string;
  decryptError?: Error;
  request?: Request;
};

async function executeRoute(options: HarnessOptions) {
  const routeSource = ts.transpileModule(
    source(options.routePath)
    .replace(/import\s+[\s\S]*?\s+from\s+"[^"]+";\s*/g, "")
    .replace(/export const /g, "const ")
    .replace(/export async function /g, "async function "),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  const context = vm.createContext({
    Request,
    Response,
    Headers,
    setTimeout,
    clearTimeout,
    __calls: calls,
    serviceCreated: false,
    decryptCalls: 0,
    __run: null,
    __service: {
      rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
        return Promise.resolve({ data: options.rpcData ?? [], error: options.rpcError ?? null });
      },
    },
  });

  const prelude = `
    const accessValue = ${JSON.stringify(options.access)};
    async function resolveZionAdminApiAccess() { return accessValue; }
    function createServiceSupabaseClient() {
      globalThis.serviceCreated = true;
      return globalThis.__service;
    }
    function createZionAdminApiJsonResponse(payload, status) {
      return new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }
    function createZionAdminApiDeniedResponse(access) {
      return createZionAdminApiJsonResponse(access.payload, access.httpStatus);
    }
    function decryptWhatsappTwoStepPin(material) {
      globalThis.decryptCalls += 1;
      if (${options.decryptError ? "true" : "false"}) throw new Error("${options.decryptError?.message || "WHATSAPP_TWO_STEP_PIN_DECRYPT_FAILED"}");
      return ${JSON.stringify(options.decryptedPin ?? "123456")};
    }
  `;

  vm.runInContext(`${prelude}\n${routeSource}\n__run = ${routeSource.includes("async function GET") ? "GET" : "POST"};`, context);
  const defaultRequest = options.routePath === revealPath
    ? new Request("http://zion.test/api/zion-admin/whatsapp-pins/reveal", {
        method: "POST",
        body: JSON.stringify({ secretId, organizationId, storeId }),
        headers: { "content-type": "application/json" },
      })
    : new Request("http://zion.test/api/zion-admin/whatsapp-pins");
  const response = await (context as { __run: (request?: Request) => Promise<Response> }).__run(
    options.request ?? defaultRequest,
  );

  return {
    response,
    body: await response.json(),
    calls: context.__calls,
    serviceCreated: context.serviceCreated,
    decryptCalls: context.decryptCalls,
  };
}

const granted: AccessGranted = { ok: true, sessionUserId: "11111111-1111-4111-8111-111111111111" };
const denied: AccessDenied = {
  ok: false,
  httpStatus: 403,
  payload: { ok: false, error: "ZION_ADMIN_API_FORBIDDEN" },
};
const secretId = "22222222-2222-4222-8222-222222222222";
const organizationId = "33333333-3333-4333-8333-333333333333";
const storeId = "44444444-4444-4444-8444-444444444444";
const material = {
  secret_id: secretId,
  ciphertext: "ciphertext-mock",
  iv: "iv-mock",
  auth_tag: "auth-tag-mock",
  key_version: 1,
  secret_status: "active",
};

async function testListAuthorizationAndSecrecy() {
  const allowed = await executeRoute({
    routePath: listPath,
    access: granted,
    rpcData: [
      {
        secret_id: secretId,
        organization_id: organizationId,
        store_id: storeId,
        store_name: "Loja mock",
        phone_number_id_masked: "****1234",
        secret_status: "active",
        can_reveal: true,
      },
    ],
  });
  assert.equal(allowed.response.status, 200);
  assert.equal(allowed.calls[0]?.name, "list_zion_admin_whatsapp_pins_by_system");
  assert.equal(allowed.calls[0]?.args.p_actor_user_id, granted.sessionUserId);
  assert.equal("ciphertext" in allowed.body, false);
  assert.equal("iv" in allowed.body, false);
  assert.equal("auth_tag" in allowed.body, false);
  assert.equal("pin" in allowed.body, false);
  assert.equal(allowed.response.headers.get("cache-control"), "no-store");

  const forbidden = await executeRoute({ routePath: listPath, access: denied });
  assert.equal(forbidden.response.status, 403);
  assert.equal(forbidden.serviceCreated, false);

  const allowlistAbsent = await executeRoute({ routePath: listPath, access: denied });
  assert.equal(allowlistAbsent.response.status, 403);
  assert.equal(allowlistAbsent.serviceCreated, false);

  const browserActor = await executeRoute({
    routePath: listPath,
    access: granted,
    rpcData: [],
    request: new Request("http://zion.test/api/zion-admin/whatsapp-pins?actor_user_id=99999999-9999-4999-8999-999999999999"),
  });
  assert.equal(browserActor.calls[0]?.args.p_actor_user_id, granted.sessionUserId);
}

async function testRevealStatesAndFailures() {
  const active = await executeRoute({
    routePath: revealPath,
    access: granted,
    rpcData: [material],
    decryptedPin: "123456",
    request: new Request("http://zion.test/api/zion-admin/whatsapp-pins/reveal", {
      method: "POST",
      body: JSON.stringify({ secretId, organizationId, storeId, actor_user_id: "99999999-9999-4999-8999-999999999999" }),
      headers: { "content-type": "application/json" },
    }),
  });
  assert.equal(active.response.status, 200);
  assert.equal(active.body.pin, "123456");
  assert.equal(active.calls[0]?.args.p_actor_user_id, granted.sessionUserId);
  assert.equal(active.calls[0]?.args.p_secret_id, secretId);
  assert.equal(active.calls[0]?.name, "read_zion_admin_whatsapp_pin_material_by_system");
  assert.equal(active.response.headers.get("cache-control"), "no-store");
  assert.equal(active.decryptCalls, 1);

  const invalidated = await executeRoute({
    routePath: revealPath,
    access: granted,
    rpcData: [{ ...material, secret_status: "invalidated" }],
  });
  assert.equal(invalidated.response.status, 200);
  assert.equal(invalidated.body.secretStatus, "invalidated");

  const pending = await executeRoute({
    routePath: revealPath,
    access: granted,
    rpcData: [],
  });
  assert.equal(pending.response.status, 404);
  assert.equal(pending.decryptCalls, 0);

  const mismatched = await executeRoute({
    routePath: revealPath,
    access: granted,
    rpcData: [{ ...material, secret_id: "55555555-5555-4555-8555-555555555555" }],
  });
  assert.equal(mismatched.response.status, 404);
  assert.equal(mismatched.decryptCalls, 0);

  const auditFailure = await executeRoute({
    routePath: revealPath,
    access: granted,
    rpcError: new Error("audit failed"),
  });
  assert.equal(auditFailure.response.status, 500);
  assert.equal(auditFailure.decryptCalls, 0);
  assert.equal(JSON.stringify(auditFailure.body).includes("ciphertext-mock"), false);

  const decryptFailure = await executeRoute({
    routePath: revealPath,
    access: granted,
    rpcData: [material],
    decryptError: new Error("WHATSAPP_TWO_STEP_PIN_DECRYPT_FAILED"),
  });
  assert.equal(decryptFailure.response.status, 500);
  assert.equal(decryptFailure.body.error, "ZION_ADMIN_WHATSAPP_PIN_DECRYPT_FAILED");
  assert.equal(JSON.stringify(decryptFailure.body).includes("ciphertext-mock"), false);
}

await testListAuthorizationAndSecrecy();
await testRevealStatesAndFailures();

const listSource = source(listPath);
const revealSource = source(revealPath);
const dashboardSource = source(join(process.cwd(), "src/app/zion-admin/ZionAdminDashboardClient.tsx"));
const pageSource = source(join(process.cwd(), "src/app/zion-admin/page.tsx"));

assert.equal(revealSource.includes('export async function POST'), true);
assert.equal(revealSource.includes('export async function GET'), false);
assert.equal(listSource.includes('requiredCapability: "manage_whatsapp_pins"'), true);
assert.equal(revealSource.includes('requiredCapability: "manage_whatsapp_pins"'), true);
assert.equal(pageSource.includes('requiredCapability: "manage_whatsapp_pins"'), true);
assert.equal(dashboardSource.includes('{revealed || "••••••"}'), true);
assert.equal(dashboardSource.includes("Ocultar PIN"), true);
assert.equal(dashboardSource.includes("15_000"), true);
assert.equal(dashboardSource.includes("PIN historico invalidado"), true);
assert.equal(dashboardSource.includes("disabled={pending || !pin.can_reveal"), true);
assert.equal(dashboardSource.includes("localStorage"), false);
assert.equal(dashboardSource.includes("sessionStorage"), false);
assert.equal(dashboardSource.includes("/register"), false);

console.log("zion admin whatsapp pins functional mock tests passed: 12 assertions groups");
