import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac } from "node:crypto";
const { createWhatsappPinRotationExecuteHandler } = await import(
  new URL("./zion-admin-whatsapp-pin-rotation-execute-handler.ts", import.meta.url).href
) as typeof import("./zion-admin-whatsapp-pin-rotation-execute-handler");
const { createWhatsappPinRotationSessionBinding } = await import(
  new URL("./zion-admin-whatsapp-pin-rotation-preparation.ts", import.meta.url).href
) as typeof import("./zion-admin-whatsapp-pin-rotation-preparation");

const actor = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";
const storeId = "33333333-3333-4333-8333-333333333333";
const secretId = "44444444-4444-4444-8444-444444444444";
const operationId = "55555555-5555-4555-8555-555555555555";
const rotationId = "66666666-6666-4666-8666-666666666666";
const cookie = "sb-auth-cookie=the-users-signed-auth-session";
const hmacSecret = "x".repeat(64);
const body = { action: "execute", consent: true, organizationId, storeId, secretId, operationId, rotationId };
const url = "http://127.0.0.1:3100/api/zion-admin/whatsapp-pins/rotation/execute";

function setup(overrides: Record<string, unknown> = {}) {
  const calls: Array<{ type: string; value?: unknown }> = [];
  const db = { rpc: async () => ({ data: null, error: null }) };
  const deps = {
    isFeatureEnabled: () => true,
    isExecutionEnabled: () => true,
    isTrustedOrigin: (req: Request) => req.headers.get("origin") === new URL(req.url).origin,
    resolveAccess: async () => ({ ok: true as const, sessionUserId: actor }),
    createServiceClient: () => db,
    resolvePhoneTarget: async (input: unknown) => { calls.push({ type: "target", value: input }); return "15551234567"; },
    computeBinding: createWhatsappPinRotationSessionBinding,
    bindingSecret: () => hmacSecret,
    execute: async (op: unknown) => { calls.push({ type: "execute", value: op }); return { ok: true, rotationId, state: "completed" as const }; },
    ...overrides,
  };
  const handler = createWhatsappPinRotationExecuteHandler(deps);
  const request = (payload: unknown = body, headers: Record<string, string> = {}) => new Request(url, {
    method: "POST", headers: { origin: new URL(url).origin, cookie, ...headers }, body: JSON.stringify(payload),
  });
  return { handler, request, calls };
}

test("default flag disabled: no target read and no Meta execution", async () => {
  for (const override of [{ isFeatureEnabled: () => false }, { isExecutionEnabled: () => false }]) {
    const {handler, request, calls} = setup(override);
    assert.equal((await handler(request())).status, 503);
    assert.equal(calls.length, 0);
  }
});

test("origin mismatch or absent origin denied before access or DB", async () => {
  const {handler, request, calls} = setup();
  assert.equal((await handler(request(undefined, {origin: "https://attacker.test"}))).status, 403);
  assert.equal((await handler(request(undefined, {origin: ""}))).status, 403);
  assert.equal(calls.length, 0);
});

test("admin access denied; no target read", async () => {
  const {handler,request,calls} = setup({resolveAccess: async () => ({ ok: false, httpStatus: 403 })});
  assert.equal((await handler(request())).status, 403);
  assert.equal(calls.length, 0);
});

test("access lookup error fails closed", async () => {
  const {handler,request,calls} = setup({resolveAccess: async () => {throw new Error("private failure");}});
  const resp = await handler(request());
  assert.equal(resp.status, 503);
  assert.doesNotMatch(await resp.text(), /private failure/);
  assert.equal(calls.length, 0);
});

test("explicit consent and execute action are mandatory", async () => {
  const {handler,request,calls} = setup();
  assert.equal((await handler(request({...body,consent: false}))).status, 400);
  assert.equal((await handler(request({...body,action: "authorize"}))).status, 400);
  assert.equal(calls.length, 0);
});

test("never accept phone, token, secret PIN or client HMAC fields", async () => {
  const {handler,request,calls} = setup();
  for (const field of ["phoneNumberId", "accessToken", "pin", "newPin", "sessionBindingHash"]) {
    assert.equal((await handler(request({...body,[field]: "do-not-trust"}))).status, 400);
  }
  assert.equal(calls.length, 0);
});

test("invalid scope/secret/operation UUID rejected", async () => {
  const {handler,request,calls} = setup();
  for (const field of ["organizationId", "storeId", "secretId", "operationId", "rotationId"]) {
    assert.equal((await handler(request({...body,[field]: "bad-id"}))).status, 400);
  }
  assert.equal(calls.length, 0);
});

test("invalid JSON and excessive payload rejected", async () => {
  const {handler,calls} = setup();
  const request = new Request(url, {method: "POST",headers: {origin: new URL(url).origin,cookie},body: "not-json"});
  assert.equal((await handler(request)).status, 400);
  const tooLong = new Request(url, {method: "POST", headers: {origin: new URL(url).origin,cookie},body: JSON.stringify({ ...body, extra: "x".repeat(8500) })});
  assert.equal((await handler(tooLong)).status, 400);
  assert.equal(calls.length, 0);
});

test("server-side target is scoped to actor, org, store and PIN secret", async () => {
  const {handler,request,calls} = setup();
  assert.equal((await handler(request())).status, 200);
  assert.deepEqual(calls[0], {type:"target", value:{actorUserId:actor,organizationId,storeId,secretId}});
  assert.equal(calls.filter(c=>c.type === "execute").length, 1);
});

test("unavailable or masked target never executes", async () => {
  for (const resolvePhoneTarget of [async () => {throw Error("secret SQL error");},async () => "****8518"]) {
    const {handler,request,calls} = setup({resolvePhoneTarget});
    const resp = await handler(request());
    assert.equal(resp.status, 409);
    assert.equal(calls.filter(c=>c.type === "execute").length, 0);
    assert.doesNotMatch(await resp.text(), /secret SQL error|8518/);
  }
});

test("HMAC matches preparation authority and depends on session", async () => {
  const {handler,request,calls} = setup();
  assert.equal((await handler(request())).status, 200);
  const op = calls.find(c=>c.type === "execute")?.value as Record<string,string>;
  const correct = createHmac("sha256",hmacSecret).update(JSON.stringify([
    actor, operationId, organizationId, storeId, "15551234567", cookie,
  ])).digest("hex");
  assert.equal(op.sessionBindingHash, correct);
  const next = setup();
  await next.handler(next.request(undefined,{cookie:"sb-auth-cookie=second-session-XXXXXXXX"}));
  const other = next.calls.find(c=>c.type === "execute")?.value as Record<string,string>;
  assert.notEqual(other.sessionBindingHash, op.sessionBindingHash);
});

test("missing HMAC secret or session cookie fails before execution", async () => {
  const missingSecret = setup({bindingSecret: () => ""});
  assert.equal((await missingSecret.handler(missingSecret.request())).status,503);
  assert.equal(missingSecret.calls.filter(c=>c.type==="execute").length,0);
  const missingCookie = setup();
  assert.equal((await missingCookie.handler(missingCookie.request(undefined,{cookie:""}))).status,503);
  assert.equal(missingCookie.calls.filter(c=>c.type==="execute").length,0);
});

test("completion returns only generic result; no PIN, phone or token", async () => {
  const {handler,request} = setup();
  const resp = await handler(request());
  assert.deepEqual(await resp.json(),{ok:true,status:"completed"});
});

test("remote uncertain and reconciliation required never return success or retry", async () => {
  for (const state of ["remote_uncertain","manual_reconciliation_required","remote_rejected","authorization_rejected","preflight_denied"]) {
    const {handler,request,calls} = setup({execute: async () => {
      calls.push({type:"execute"});
      return {ok:false, rotationId, state};
    }});
    const resp = await handler(request());
    assert.equal(resp.status, 409);
    assert.deepEqual(await resp.json(),{ok:false,status:state});
    assert.equal(calls.filter(c=>c.type === "execute").length,1);
  }
});

test("executor throw is ambiguous, generic and never retried", async () => {
  const {handler,request,calls} = setup({execute: async () => {calls.push({type:"execute"});throw Error("sensitive token");}});
  const resp = await handler(request());
  assert.equal(resp.status,409);
  assert.equal(calls.filter(c=>c.type === "execute").length,1);
  assert.doesNotMatch(await resp.text(),/sensitive token/);
});

test("unknown executor result fails closed and never returns a sensitive payload", async () => {
  const {handler,request} = setup({execute: async () => ({ok:true, rotationId, state:"INVALID",pin:"123456",accessToken:"private"})});
  const resp = await handler(request());
  assert.equal(resp.status,409);
  assert.doesNotMatch(await resp.text(),/123456|private/);
});
