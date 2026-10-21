import assert from "node:assert/strict";
import { test } from "node:test";
import type { RotationDeps } from "./zion-admin-whatsapp-pin-rotation-preparation";

const { createPinRotationPreparationHandler, isTrustedRotationOrigin } = await import(
  new URL("./zion-admin-whatsapp-pin-rotation-preparation.ts", import.meta.url).href
);

const actor = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";
const storeId = "33333333-3333-4333-8333-333333333333";
const phoneNumberId = "15551234567";
const secretId = "8dd11e09-dbf4-4a92-8939-690ce20d8b87";
const operationId = "ecec7b8c-497e-47cb-a64d-45191e37da6b";
const rotationId = "4fcbe215-1bdd-4c8c-88a5-8d4f4d31322a";
const cookie = "sb-authorization-cookie=abc12345678901234567";

function setup(opts: Partial<RotationDeps> = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const deps: RotationDeps = {
    resolveAccess: async () => ({ ok: true, sessionUserId: actor }),
    createServiceClient: () => ({
      rpc: async (name, args) => {
        calls.push({ name, args });
        const authorize = name === "zion_admin_authorize_whatsapp_pin_rotation_by_system";
        return { error: null, data: [{ rotation_id: rotationId, operation_id: operationId,
          status: authorize ? "authorized" : "prepared", outcome: authorize ? "authorized" : "created" }] };
      },
    }),
    isEnabled: () => true,
    isTrustedOrigin: isTrustedRotationOrigin,
    bindingSecret: () => "z".repeat(64),
    now: () => new Date("2026-10-20T16:00:00.000Z"),
    operationId: () => operationId,
    resolvePhoneTarget: async () => phoneNumberId,
    ...opts,
  };
  const handler = createPinRotationPreparationHandler(deps);
  const body = { action: "prepare", consent: true, organizationId, storeId, secretId };
  const request = (payload: Record<string, unknown> = body, headers: Record<string, string> = {}) => new Request("http://127.0.0.1:3100/api/zion-admin/whatsapp-pins/rotation", {
    method: "POST", headers: { "origin": "http://127.0.0.1:3100", "cookie": cookie, ...headers },
    body: JSON.stringify(payload),
  });
  return { handler, request, calls, body };
}

test("disabled by default returns 503 and never creates authority", async () => {
  const { handler, request, calls } = setup({ isEnabled: () => false });
  assert.equal((await handler(request())).status, 503);
  assert.equal(calls.length, 0);
});

test("same-origin check refuses cross-site and missing origin", async () => {
  const { handler, request, calls } = setup();
  assert.equal((await handler(request(undefined, { origin: "https://external.test" }))).status, 403);
  assert.equal((await handler(request(undefined, { origin: "null" }))).status, 403);
  assert.equal(calls.length, 0);
});

test("admin capability denial stops before writing", async () => {
  const { handler, request, calls } = setup({ resolveAccess: async () => ({ ok: false, httpStatus: 403 }) });
  assert.equal((await handler(request())).status, 403);
  assert.equal(calls.length, 0);
});

test("failed access lookup is fail-closed", async () => {
  const { handler, request, calls } = setup({ resolveAccess: async () => { throw new Error("unavailable"); } });
  assert.equal((await handler(request())).status, 503);
  assert.equal(calls.length, 0);
});

test("explicit human consent is required", async () => {
  const { handler, request, body, calls } = setup();
  assert.equal((await handler(request({ ...body, consent: false }))).status, 400);
  assert.equal(calls.length, 0);
});

test("invalid store, secret or raw browser phone is rejected", async () => {
  const { handler, request, body, calls } = setup();
  assert.equal((await handler(request({ ...body, storeId: "?" }))).status, 400);
  assert.equal((await handler(request({ ...body, secretId: "?" }))).status, 400);
  assert.equal((await handler(request({ ...body, phoneNumberId: "1234567890" }))).status, 400);
  assert.equal(calls.length, 0);
});

test("missing binding key and absent session cookie fail closed", async () => {
  const { handler, request, calls } = setup({ bindingSecret: () => "" });
  assert.equal((await handler(request())).status, 503);
  const second = setup();
  assert.equal((await second.handler(second.request(undefined, { cookie: "" }))).status, 503);
  assert.equal(calls.length, 0);
  assert.equal(second.calls.length, 0);
});

test("prepare calls SQL only with generated operation and hashed session binding", async () => {
  const { handler, request, calls } = setup();
  const resp = await handler(request());
  assert.equal(resp.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "zion_admin_prepare_whatsapp_pin_rotation_by_system");
  assert.equal(calls[0].args.p_operation_id, operationId);
  assert.match(String(calls[0].args.p_session_binding_hash), /^[a-f\d]{64}$/);
  assert.equal(calls[0].args.p_phone_number_id, phoneNumberId);
  assert.equal(calls[0].args.p_expires_at, "2026-10-20T16:05:00.000Z");
  const text = await resp.text();
  assert.doesNotMatch(text, /session_binding_hash|pin\s*:/i);
});

test("authorize requires rotation and operation, binds same scoped session", async () => {
  const { handler, request, body, calls } = setup();
  const resp = await handler(request({ ...body, action: "authorize", operationId, rotationId }));
  assert.equal(resp.status, 200);
  assert.equal(calls[0].name, "zion_admin_authorize_whatsapp_pin_rotation_by_system");
  assert.equal(calls[0].args.p_rotation_id, rotationId);
  assert.equal(calls[0].args.p_actor_user_id, actor);
  assert.equal((await resp.json()).executionEnabled, false);
});

test("authorizing from another session changes HMAC and SQL must reject", async () => {
  const first = setup();
  await first.handler(first.request());
  const second = setup();
  await second.handler(second.request({ ...second.body, action: "authorize", operationId, rotationId },
    { cookie: "sb-authorization-cookie=different-cookie-value-999" }));
  assert.notEqual(first.calls[0].args.p_session_binding_hash, second.calls[0].args.p_session_binding_hash);
});

test("SQL errors do not leak implementation details or secrets", async () => {
  const { handler, request } = setup({ createServiceClient: () => ({ rpc: async () => ({ data: null, error: { message: "secret PIN=123456" } }) }) });
  const resp = await handler(request());
  assert.equal(resp.status, 409);
  assert.doesNotMatch(await resp.text(), /123456|secret/i);
});

test("invalid SQL result cannot be considered authorized", async () => {
  const { handler, request } = setup({ createServiceClient: () => ({ rpc: async () => ({ data: [{ status: "completed" }], error: null }) }) });
  assert.equal((await handler(request())).status, 503);
});

test("no exposed execution endpoint and no Meta call are present", async () => {
  const { handler, request } = setup();
  const resp = await handler(request({ ...setup().body, action: "execute" }));
  assert.equal(resp.status, 400);
});


test("server target resolver receives only scoped listed secret and admin identity", async () => {
  const targets: Array<Parameters<RotationDeps["resolvePhoneTarget"]>[0]> = [];
  const { handler, request } = setup({ resolvePhoneTarget: async (input) => { targets.push(input); return phoneNumberId; } });
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(targets, [{ actorUserId: actor, organizationId, storeId, secretId }]);
  assert.doesNotMatch(await response.text(), /15551234567/);
});

test("target resolution fails closed without calling rotation authority", async () => {
  const { handler, request, calls } = setup({ resolvePhoneTarget: async () => { throw new Error("private-db-error"); } });
  const response = await handler(request());
  assert.equal(response.status, 409);
  assert.equal(calls.length, 0);
  assert.doesNotMatch(await response.text(), /private-db-error/);
});

test("invalid canonical phone fails before SQL and never uses browser supplied value", async () => {
  const { handler, request, calls } = setup({ resolvePhoneTarget: async () => "****8518" });
  assert.equal((await handler(request())).status, 409);
  assert.equal(calls.length, 0);
});
