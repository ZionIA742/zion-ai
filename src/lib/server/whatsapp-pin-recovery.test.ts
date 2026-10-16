import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createWhatsappPinRecoveryGetHandler,
  createWhatsappPinRecoveryPostHandler,
  WHATSAPP_PIN_RECOVERY_TARGET,
} from "./whatsapp-pin-recovery";
import {
  encryptWhatsappTwoStepPin,
  WHATSAPP_PIN_ENCRYPTION_KEY_ENV,
} from "./whatsapp-two-step-pin-crypto";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const ATTEMPT = "22222222-2222-4222-8222-222222222222";
const OPERATION = "33333333-3333-4333-8333-333333333333";
const SECRET = "44444444-4444-4444-8444-444444444444";
const TOKEN = "oauth-token-never-returned";
process.env[WHATSAPP_PIN_ENCRYPTION_KEY_ENV] = Buffer.alloc(32, 9).toString("base64");
const historicalMaterial = encryptWhatsappTwoStepPin("123456");

function request(body: Record<string, unknown>) {
  return new Request("http://zion.test/api/zion-admin/whatsapp-pins/recovery", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function trustedRequest(body: Record<string, unknown>) {
  return new Request("http://zion.test/api/zion-admin/whatsapp-pins/recovery", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://zion.example" },
    body: JSON.stringify(body),
  });
}

function access() {
  return {
    ok: true as const,
    sessionUserId: ACTOR,
    payload: undefined,
  } as never;
}

type FakeRpcResult = { data: unknown; error: { message?: string | null } | null };
type FakeOptions = {
  uncertain?: boolean;
  rejected?: boolean;
  missingSecret?: boolean;
  begin?: FakeRpcResult;
  replacement?: FakeRpcResult;
  record?: FakeRpcResult;
  authorize?: FakeRpcResult;
  integration?: FakeRpcResult;
  finalize?: FakeRpcResult;
  resumable?: FakeRpcResult;
  rpcErrors?: Partial<Record<string, string>>;
};

function createFakeSupabase(options: FakeOptions = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const state = { consumed: false };
  const rows = options?.missingSecret ? [] : [{
    id: SECRET,
    organization_id: WHATSAPP_PIN_RECOVERY_TARGET.organizationId,
    store_id: WHATSAPP_PIN_RECOVERY_TARGET.storeId,
    provider: "whatsapp",
    phone_number_id: WHATSAPP_PIN_RECOVERY_TARGET.phoneNumberId,
    secret_kind: "two_step_verification_pin",
    status: "invalidated",
  }];
  const client = {
    from() {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        order() { return builder; },
        async limit() { return { data: rows, error: null }; },
      };
      return builder;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      const forcedError = options.rpcErrors?.[name];
      if (forcedError) return { data: null, error: { message: forcedError } };
      if (name === "read_whatsapp_pin_recovery_resumable_attempt_by_system") {
        return options.resumable || { data: [], error: null };
      }
      if (name === "prepare_whatsapp_pin_recovery_attempt_by_system") {
        return { data: [{ attempt_id: ATTEMPT, operation_id: OPERATION, status: "prepared", historical_secret_id: SECRET, outcome: "created", expires_at: "2099-01-01T00:00:00.000Z" }], error: null };
      }
      if (name === "begin_whatsapp_pin_recovery_attempt_by_system") {
        if (state.consumed) return { data: null, error: { message: "ZION_PIN_RECOVERY_AUTHORIZATION_INVALID_OR_CONSUMED" } };
        state.consumed = true;
        if (options.begin) return options.begin;
        return { data: [{ attempt_id: ATTEMPT, status: "executing", historical_secret_id: SECRET, waba_id: WHATSAPP_PIN_RECOVERY_TARGET.wabaId, phone_number_id: WHATSAPP_PIN_RECOVERY_TARGET.phoneNumberId, ciphertext: historicalMaterial.ciphertext, iv: historicalMaterial.iv, auth_tag: historicalMaterial.authTag, key_version: historicalMaterial.keyVersion }], error: null };
      }
      if (name === "create_whatsapp_pin_recovery_replacement_secret_by_system") {
        if (options.replacement) return options.replacement;
        return { data: [{ replacement_secret_id: "55555555-5555-4555-8555-555555555555", status: "pending", outcome: "created" }], error: null };
      }
      if (name === "record_whatsapp_pin_recovery_remote_result_by_system") {
        if (options.record) return options.record;
        return { data: [{ attempt_id: ATTEMPT, status: options?.uncertain ? "remote_uncertain" : options?.rejected ? "remote_rejected" : "remote_confirmed", outcome: "recorded" }], error: null };
      }
      if (name === "authorize_whatsapp_pin_recovery_materialization_token_by_system") {
        if (options.authorize) return options.authorize;
        return { data: [{ attempt_id: ATTEMPT, status: "remote_confirmed", outcome: "bound" }], error: null };
      }
      if (name === "materialize_store_whatsapp_embedded_signup_by_system") {
        if (options.integration) return options.integration;
        return { data: [{ integration_id: "66666666-6666-4666-8666-666666666666", outcome: "inserted", provider: "whatsapp", whatsapp_business_account_id: WHATSAPP_PIN_RECOVERY_TARGET.wabaId, phone_number_id: WHATSAPP_PIN_RECOVERY_TARGET.phoneNumberId, status: "active", is_active: true }], error: null };
      }
      if (name === "finalize_whatsapp_pin_recovery_materialization_by_system") {
        if (options.finalize) return options.finalize;
        return { data: [{ attempt_id: ATTEMPT, status: "completed", integration_id: "66666666-6666-4666-8666-666666666666", replacement_secret_id: "55555555-5555-4555-8555-555555555555", outcome: "completed" }], error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  };
  return { client, calls, state };
}

function validated() {
  return {
    accessToken: TOKEN,
    whatsappBusinessAccountId: WHATSAPP_PIN_RECOVERY_TARGET.wabaId,
    phoneNumberId: WHATSAPP_PIN_RECOVERY_TARGET.phoneNumberId,
    connectionMode: "standard" as const,
    displayPhoneNumber: "+55 11 99999-0000",
    graphApiVersion: "v99.0",
    appId: "app-1",
    validatedAt: "2026-10-15T12:00:00.000Z",
  };
}

function baseDeps(fake: ReturnType<typeof createFakeSupabase>, overrides: Record<string, unknown> = {}) {
  return {
    resolveAccess: async () => access(),
    createServiceSupabase: () => fake.client,
    now: () => new Date("2026-10-15T12:00:00.000Z"),
    createOperationId: () => OPERATION,
    buildSessionBindingHash: () => "a".repeat(64),
    isRequestOriginTrusted: () => true,
    isMetaExecutionEnabled: () => true,
    validateOAuth: async () => validated(),
    registerRemote: async () => ({
      result: "confirmed" as const,
      httpStatus: 200,
      metaErrorCode: null,
      requestId: "meta-request-1",
      evidenceHash: "b".repeat(64),
    }),
    ...overrides,
  };
}

test("prepare requires explicit target-bound consent and uses only server-selected historical secret", async () => {
  const fake = createFakeSupabase();
  const handler = createWhatsappPinRecoveryPostHandler(baseDeps(fake));
  const denied = await handler(request({ action: "prepare", consent: true, target: {} }));
  assert.equal(denied.status, 400);

  const response = await handler(request({
    action: "prepare",
    consent: true,
    target: {
      organizationId: WHATSAPP_PIN_RECOVERY_TARGET.organizationId,
      storeId: WHATSAPP_PIN_RECOVERY_TARGET.storeId,
      wabaId: WHATSAPP_PIN_RECOVERY_TARGET.wabaId,
      phoneNumberId: WHATSAPP_PIN_RECOVERY_TARGET.phoneNumberId,
    },
    historicalSecretId: "browser-must-be-ignored",
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.attemptId, ATTEMPT);
  assert.equal(body.historicalSecretId, undefined);
  const prepareCall = fake.calls.find((call) => call.name.startsWith("prepare_"));
  assert.equal(prepareCall?.args.p_historical_secret_id, SECRET);
  assert.equal(JSON.stringify(body).includes("ciphertext"), false);
});

test("POST rejects external and absent origins before capability or RPC access", async () => {
  const fake = createFakeSupabase();
  let accessCalls = 0;
  const handler = createWhatsappPinRecoveryPostHandler(baseDeps(fake, {
    resolveAccess: async () => { accessCalls += 1; return access(); },
    isRequestOriginTrusted: (incoming: Request) => incoming.headers.get("origin") === "https://zion.example",
  }));
  const body = { action: "execute", attemptId: ATTEMPT, operationId: OPERATION, oauthCode: "code" };
  const external = await handler(new Request("http://zion.test/api/zion-admin/whatsapp-pins/recovery", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: JSON.stringify(body),
  }));
  const absent = await handler(request(body));
  assert.equal(external.status, 403);
  assert.equal(absent.status, 403);
  assert.equal(accessCalls, 0);
  assert.equal(fake.calls.length, 0);
  assert.equal((await handler(trustedRequest({ action: "unknown" }))).status, 400);
});

test("access denial and missing historical secret stop before recovery RPC", async () => {
  const deniedFake = createFakeSupabase();
  const deniedHandler = createWhatsappPinRecoveryPostHandler(baseDeps(deniedFake, {
    resolveAccess: async () => ({ ok: false, httpStatus: 403, payload: { ok: false, error: "ZION_ADMIN_API_FORBIDDEN" } } as never),
  }));
  const denied = await deniedHandler(request({ action: "prepare", consent: true, target: WHATSAPP_PIN_RECOVERY_TARGET }));
  assert.equal(denied.status, 403);
  assert.equal(deniedFake.calls.length, 0);

  const missingFake = createFakeSupabase({ missingSecret: true });
  const missingHandler = createWhatsappPinRecoveryPostHandler(baseDeps(missingFake));
  const missing = await missingHandler(request({ action: "prepare", consent: true, target: WHATSAPP_PIN_RECOVERY_TARGET }));
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).error, "WHATSAPP_PIN_RECOVERY_HISTORICAL_SECRET_NOT_FOUND");
  assert.equal(missingFake.calls.length, 0);
});

test("GET resumes only the original administrator's validated remote_confirmed attempt", async () => {
  const fake = createFakeSupabase({
    resumable: {
      data: [{
        attempt_id: ATTEMPT,
        operation_id: OPERATION,
        status: "remote_confirmed",
        organization_id: WHATSAPP_PIN_RECOVERY_TARGET.organizationId,
        store_id: WHATSAPP_PIN_RECOVERY_TARGET.storeId,
        waba_id: WHATSAPP_PIN_RECOVERY_TARGET.wabaId,
        phone_number_id: WHATSAPP_PIN_RECOVERY_TARGET.phoneNumberId,
        created_at: "2026-10-16T19:56:48.585Z",
        remote_result_at: "2026-10-16T19:57:47.596Z",
        authorization_expires_at: "2026-10-16T20:01:48.441Z",
      }],
      error: null,
    },
  });
  const handler = createWhatsappPinRecoveryGetHandler(baseDeps(fake));
  const response = await handler();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.resumable, true);
  assert.equal(body.attemptId, ATTEMPT);
  assert.equal(body.operationId, OPERATION);
  assert.equal(body.status, "remote_confirmed");
  assert.equal(body.target.phoneNumberId, WHATSAPP_PIN_RECOVERY_TARGET.phoneNumberId);
  assert.equal(JSON.stringify(body).includes("ciphertext"), false);
  assert.equal(JSON.stringify(body).includes(TOKEN), false);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(fake.calls[0], {
    name: "read_whatsapp_pin_recovery_resumable_attempt_by_system",
    args: {
      p_actor_user_id: ACTOR,
      p_organization_id: WHATSAPP_PIN_RECOVERY_TARGET.organizationId,
      p_store_id: WHATSAPP_PIN_RECOVERY_TARGET.storeId,
      p_waba_id: WHATSAPP_PIN_RECOVERY_TARGET.wabaId,
      p_phone_number_id: WHATSAPP_PIN_RECOVERY_TARGET.phoneNumberId,
    },
  });
});

test("GET treats no resumable attempt and invalid reader payload safely", async () => {
  const emptyFake = createFakeSupabase();
  const emptyResponse = await createWhatsappPinRecoveryGetHandler(baseDeps(emptyFake))();
  assert.equal(emptyResponse.status, 200);
  assert.deepEqual(await emptyResponse.json(), { ok: true, resumable: false });

  const invalidFake = createFakeSupabase({
    resumable: {
      data: [{
        attempt_id: ATTEMPT,
        operation_id: OPERATION,
        status: "prepared",
        organization_id: WHATSAPP_PIN_RECOVERY_TARGET.organizationId,
        store_id: WHATSAPP_PIN_RECOVERY_TARGET.storeId,
        waba_id: WHATSAPP_PIN_RECOVERY_TARGET.wabaId,
        phone_number_id: WHATSAPP_PIN_RECOVERY_TARGET.phoneNumberId,
      }],
      error: null,
    },
  });
  const invalidResponse = await createWhatsappPinRecoveryGetHandler(baseDeps(invalidFake))();
  assert.equal(invalidResponse.status, 400);
  assert.equal((await invalidResponse.json()).error, "WHATSAPP_PIN_RECOVERY_RESUME_RETURN_INVALID");

  const multipleFake = createFakeSupabase({
    resumable: {
      data: [
        {
          attempt_id: ATTEMPT,
          operation_id: OPERATION,
          status: "remote_confirmed",
          organization_id: WHATSAPP_PIN_RECOVERY_TARGET.organizationId,
          store_id: WHATSAPP_PIN_RECOVERY_TARGET.storeId,
          waba_id: WHATSAPP_PIN_RECOVERY_TARGET.wabaId,
          phone_number_id: WHATSAPP_PIN_RECOVERY_TARGET.phoneNumberId,
          created_at: "2026-10-16T19:56:48.585Z",
          remote_result_at: "2026-10-16T19:57:47.596Z",
          authorization_expires_at: "2026-10-16T20:01:48.441Z",
        },
        {
          attempt_id: "77777777-7777-4777-8777-777777777777",
          operation_id: "88888888-8888-4888-8888-888888888888",
          status: "remote_confirmed",
          organization_id: WHATSAPP_PIN_RECOVERY_TARGET.organizationId,
          store_id: WHATSAPP_PIN_RECOVERY_TARGET.storeId,
          waba_id: WHATSAPP_PIN_RECOVERY_TARGET.wabaId,
          phone_number_id: WHATSAPP_PIN_RECOVERY_TARGET.phoneNumberId,
          created_at: "2026-10-16T19:56:49.585Z",
          remote_result_at: "2026-10-16T19:57:48.596Z",
          authorization_expires_at: "2026-10-16T20:01:49.441Z",
        },
      ],
      error: null,
    },
  });
  const multipleResponse = await createWhatsappPinRecoveryGetHandler(baseDeps(multipleFake))();
  assert.equal(multipleResponse.status, 400);
  assert.equal((await multipleResponse.json()).error, "WHATSAPP_PIN_RECOVERY_RESUME_RETURN_INVALID");
});

test("GET authorization failure and RPC failure happen before any recovery operation", async () => {
  const deniedFake = createFakeSupabase();
  let deniedRpcCalls = 0;
  const deniedResponse = await createWhatsappPinRecoveryGetHandler(baseDeps(deniedFake, {
    resolveAccess: async () => ({ ok: false, httpStatus: 403, payload: { ok: false, error: "ZION_ADMIN_API_FORBIDDEN" } } as never),
  }))();
  deniedRpcCalls += deniedFake.calls.length;
  assert.equal(deniedResponse.status, 403);
  assert.equal(deniedRpcCalls, 0);

  const failedFake = createFakeSupabase({ rpcErrors: { read_whatsapp_pin_recovery_resumable_attempt_by_system: "ZION_PIN_RECOVERY_READER_FAILED" } });
  const failedResponse = await createWhatsappPinRecoveryGetHandler(baseDeps(failedFake))();
  assert.equal(failedResponse.status, 503);
  assert.equal((await failedResponse.json()).error, "ZION_PIN_RECOVERY_READER_FAILED");
});

test("disabled feature flag prevents OAuth, PIN decrypt, register, and RPC consumption", async () => {
  const fake = createFakeSupabase();
  let validationCalls = 0;
  const handler = createWhatsappPinRecoveryPostHandler(baseDeps(fake, {
    isMetaExecutionEnabled: () => false,
    validateOAuth: async () => { validationCalls += 1; return validated(); },
  }));
  const response = await handler(request({ action: "execute", attemptId: ATTEMPT, operationId: OPERATION, oauthCode: "code" }));
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.error, "WHATSAPP_PIN_RECOVERY_META_EXECUTION_DISABLED");
  assert.equal(validationCalls, 0);
  assert.equal(fake.calls.length, 0);
});

test("execute consumes once, keeps PIN server-side, and records confirmed result", async () => {
  const fake = createFakeSupabase();
  let registeredPin = "";
  const handler = createWhatsappPinRecoveryPostHandler(baseDeps(fake, {
    registerRemote: async (_validated: unknown, pin: string) => {
      registeredPin = pin;
      return { result: "confirmed" as const, httpStatus: 200, metaErrorCode: null, requestId: "request-1", evidenceHash: "c".repeat(64) };
    },
  }));
  const response = await handler(request({ action: "execute", attemptId: ATTEMPT, operationId: OPERATION, oauthCode: "oauth-code" }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, "remote_confirmed");
  assert.equal(body.requiresFreshOAuth, true);
  assert.equal(registeredPin.length, 6);
  assert.equal(JSON.stringify(body).includes(registeredPin), false);
  assert.equal(fake.calls.filter((call) => call.name.includes("begin_" )).length, 1);
  assert.equal(fake.calls.filter((call) => call.name.includes("record_" )).length, 1);
  assert.equal(fake.calls.some((call) => JSON.stringify(call.args).includes(registeredPin)), false);
});

test("uncertain result is terminal for external retry and a second execute cannot register again", async () => {
  const fake = createFakeSupabase({ uncertain: true });
  let registerCalls = 0;
  const handler = createWhatsappPinRecoveryPostHandler(baseDeps(fake, {
    registerRemote: async () => {
      registerCalls += 1;
      return { result: "uncertain" as const, httpStatus: 502, metaErrorCode: null, requestId: null, evidenceHash: null };
    },
  }));
  const first = await handler(request({ action: "execute", attemptId: ATTEMPT, operationId: OPERATION, oauthCode: "oauth-code" }));
  assert.equal(first.status, 503);
  assert.equal((await first.json()).retryAllowed, false);
  const second = await handler(request({ action: "execute", attemptId: ATTEMPT, operationId: OPERATION, oauthCode: "oauth-code-2" }));
  assert.equal(second.status, 409);
  assert.equal(registerCalls, 1);
});

test("deterministic Meta rejection is recorded as rejected without materialization", async () => {
  const fake = createFakeSupabase({ rejected: true });
  const handler = createWhatsappPinRecoveryPostHandler(baseDeps(fake, {
    registerRemote: async () => ({ result: "rejected" as const, httpStatus: 400, metaErrorCode: "133010", requestId: "request-rejected", evidenceHash: null }),
  }));
  const response = await handler(request({ action: "execute", attemptId: ATTEMPT, operationId: OPERATION, oauthCode: "oauth-code" }));
  assert.equal(response.status, 422);
  assert.equal((await response.json()).status, "remote_rejected");
  assert.equal(fake.calls.some((call) => call.name.includes("authorize_") || call.name.includes("materialize_store_")), false);
});

test("materialization requires a fresh OAuth token and never returns it", async () => {
  const fake = createFakeSupabase();
  const handler = createWhatsappPinRecoveryPostHandler(baseDeps(fake));
  const response = await handler(request({ action: "materialize", attemptId: ATTEMPT, operationId: OPERATION, oauthCode: "fresh-oauth-code" }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, "completed");
  assert.equal(body.integrationId, "66666666-6666-4666-8666-666666666666");
  assert.equal(JSON.stringify(body).includes(TOKEN), false);
  assert.equal(fake.calls.some((call) => call.name.includes("authorize_")), true);
  assert.equal(fake.calls.some((call) => call.name.includes("materialize_store_")), true);
  assert.equal(fake.calls.some((call) => call.name.includes("finalize_")), true);
});

test("remote_confirmed can be resumed after initial authorization expiry with fresh OAuth", async () => {
  const fake = createFakeSupabase({
    resumable: {
      data: [{
        attempt_id: ATTEMPT,
        operation_id: OPERATION,
        status: "remote_confirmed",
        organization_id: WHATSAPP_PIN_RECOVERY_TARGET.organizationId,
        store_id: WHATSAPP_PIN_RECOVERY_TARGET.storeId,
        waba_id: WHATSAPP_PIN_RECOVERY_TARGET.wabaId,
        phone_number_id: WHATSAPP_PIN_RECOVERY_TARGET.phoneNumberId,
        created_at: "2026-10-16T19:56:48.585Z",
        remote_result_at: "2026-10-16T19:57:47.596Z",
        authorization_expires_at: "2026-10-16T19:58:00.000Z",
      }],
      error: null,
    },
  });
  const getResponse = await createWhatsappPinRecoveryGetHandler(baseDeps(fake))();
  assert.equal(getResponse.status, 200);
  assert.equal((await getResponse.json()).resumable, true);

  const handler = createWhatsappPinRecoveryPostHandler(baseDeps(fake, {
    validateOAuth: async () => ({ ...validated(), validatedAt: "2026-10-16T20:02:00.000Z" }),
  }));
  const response = await handler(trustedRequest({ action: "materialize", attemptId: ATTEMPT, operationId: OPERATION, oauthCode: "fresh-oauth-code" }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "completed");
  assert.equal(fake.calls.some((call) => call.name.includes("begin_")), false);
  assert.equal(fake.calls.some((call) => call.name.includes("record_")), false);
  assert.equal(fake.calls.some((call) => call.name.includes("authorize_")), true);
  assert.equal(fake.calls.some((call) => call.name.includes("materialize_store_")), true);
});

test("OAuth validation cannot move the recovery to another WABA or phone", async () => {
  const fake = createFakeSupabase();
  const handler = createWhatsappPinRecoveryPostHandler(baseDeps(fake, {
    validateOAuth: async () => ({ ...validated(), phoneNumberId: "other-phone" }),
  }));
  const response = await handler(request({ action: "execute", attemptId: ATTEMPT, operationId: OPERATION, oauthCode: "oauth-code" }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "WHATSAPP_PIN_RECOVERY_META_TARGET_MISMATCH");
  assert.equal(fake.calls.length, 0);
});

test("execute and materialize require the manage_whatsapp_pins capability", async () => {
  const fake = createFakeSupabase();
  let accessCalls = 0;
  const handler = createWhatsappPinRecoveryPostHandler(baseDeps(fake, {
    resolveAccess: async () => {
      accessCalls += 1;
      return { ok: false, httpStatus: 403, payload: { ok: false, error: "ZION_ADMIN_API_FORBIDDEN" } } as never;
    },
  }));
  const execute = await handler(trustedRequest({ action: "execute", attemptId: ATTEMPT, operationId: OPERATION, oauthCode: "code" }));
  const materialize = await handler(trustedRequest({ action: "materialize", attemptId: ATTEMPT, operationId: OPERATION, oauthCode: "fresh-code" }));
  assert.equal(execute.status, 403);
  assert.equal(materialize.status, 403);
  assert.equal(accessCalls, 2);
  assert.equal(fake.calls.length, 0);
});

test("expired or divergent authorization binding stops before the external call", async () => {
  for (const error of [
    "ZION_PIN_RECOVERY_AUTHORIZATION_INVALID_OR_CONSUMED",
    "ZION_PIN_RECOVERY_SCOPE_OR_SECRET_INVALID",
    "ZION_PIN_RECOVERY_MISSING_BINDING",
  ]) {
    const fake = createFakeSupabase({ rpcErrors: { begin_whatsapp_pin_recovery_attempt_by_system: error } });
    let registerCalls = 0;
    const handler = createWhatsappPinRecoveryPostHandler(baseDeps(fake, {
      registerRemote: async () => {
        registerCalls += 1;
        return { result: "confirmed" as const, httpStatus: 200, metaErrorCode: null, requestId: "unused", evidenceHash: "a".repeat(64) };
      },
    }));
    const response = await handler(trustedRequest({ action: "execute", attemptId: ATTEMPT, operationId: OPERATION, oauthCode: "code" }));
    assert.ok([400, 409, 503].includes(response.status));
    assert.equal(registerCalls, 0);
  }
});

test("malformed begin and replacement returns fail closed", async () => {
  const malformedBegins = [
    { attempt_id: ATTEMPT, status: "prepared", historical_secret_id: SECRET, waba_id: WHATSAPP_PIN_RECOVERY_TARGET.wabaId, phone_number_id: WHATSAPP_PIN_RECOVERY_TARGET.phoneNumberId, ciphertext: historicalMaterial.ciphertext, iv: historicalMaterial.iv, auth_tag: historicalMaterial.authTag, key_version: historicalMaterial.keyVersion },
    { attempt_id: ATTEMPT, status: "executing", historical_secret_id: SECRET, waba_id: "wrong-waba", phone_number_id: WHATSAPP_PIN_RECOVERY_TARGET.phoneNumberId, ciphertext: historicalMaterial.ciphertext, iv: historicalMaterial.iv, auth_tag: historicalMaterial.authTag, key_version: historicalMaterial.keyVersion },
    { attempt_id: ATTEMPT, status: "executing", historical_secret_id: SECRET, waba_id: WHATSAPP_PIN_RECOVERY_TARGET.wabaId, phone_number_id: WHATSAPP_PIN_RECOVERY_TARGET.phoneNumberId, ciphertext: historicalMaterial.ciphertext, iv: historicalMaterial.iv, auth_tag: historicalMaterial.authTag, key_version: 0 },
  ];
  for (const data of malformedBegins) {
    const fake = createFakeSupabase({ begin: { data: [data], error: null } });
    const response = await createWhatsappPinRecoveryPostHandler(baseDeps(fake))(trustedRequest({ action: "execute", attemptId: ATTEMPT, operationId: OPERATION, oauthCode: "code" }));
    assert.equal(response.status, 400);
    assert.equal(fake.calls.some((call) => call.name.includes("create_whatsapp_pin_recovery_replacement")), false);
  }
  const fake = createFakeSupabase({ replacement: { data: [{ replacement_secret_id: "not-a-uuid", status: "active", outcome: "created" }], error: null } });
  const response = await createWhatsappPinRecoveryPostHandler(baseDeps(fake))(trustedRequest({ action: "execute", attemptId: ATTEMPT, operationId: OPERATION, oauthCode: "code" }));
  assert.equal(response.status, 400);
  assert.equal(fake.calls.some((call) => call.name.includes("record_whatsapp_pin_recovery")), false);
});

test("remote recording must persist the classification returned by the external observation", async () => {
  const fake = createFakeSupabase({
    uncertain: true,
    record: { data: [{ attempt_id: ATTEMPT, status: "remote_confirmed", outcome: "recorded" }], error: null },
  });
  const response = await createWhatsappPinRecoveryPostHandler(baseDeps(fake, {
    registerRemote: async () => ({ result: "uncertain" as const, httpStatus: 502, metaErrorCode: null, requestId: null, evidenceHash: null }),
  }))(trustedRequest({ action: "execute", attemptId: ATTEMPT, operationId: OPERATION, oauthCode: "code" }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "WHATSAPP_PIN_RECOVERY_REMOTE_RESULT_RETURN_INVALID");
});

test("timeout, network failure, 5xx, and ambiguous 2xx are terminal uncertain outcomes", async () => {
  const observations = [
    { httpStatus: null, requestId: null },
    { httpStatus: null, requestId: null },
    { httpStatus: 503, requestId: "trace-503" },
    { httpStatus: 200, requestId: "trace-ambiguous" },
  ];
  for (const observation of observations) {
    const fake = createFakeSupabase({ uncertain: true });
    let registerCalls = 0;
    const handler = createWhatsappPinRecoveryPostHandler(baseDeps(fake, {
      registerRemote: async () => {
        registerCalls += 1;
        return { result: "uncertain" as const, httpStatus: observation.httpStatus, metaErrorCode: null, requestId: observation.requestId, evidenceHash: null };
      },
    }));
    const response = await handler(trustedRequest({ action: "execute", attemptId: ATTEMPT, operationId: OPERATION, oauthCode: "code" }));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).retryAllowed, false);
    assert.equal(registerCalls, 1);
  }
});

test("persistence failure after the external call cannot permit a second external attempt", async () => {
  const fake = createFakeSupabase({ rpcErrors: { record_whatsapp_pin_recovery_remote_result_by_system: "ZION_PIN_RECOVERY_RESULT_PERSISTENCE_FAILED" } });
  let registerCalls = 0;
  const handler = createWhatsappPinRecoveryPostHandler(baseDeps(fake, {
    registerRemote: async () => {
      registerCalls += 1;
      return { result: "confirmed" as const, httpStatus: 200, metaErrorCode: null, requestId: "trace-1", evidenceHash: "a".repeat(64) };
    },
  }));
  const first = await handler(trustedRequest({ action: "execute", attemptId: ATTEMPT, operationId: OPERATION, oauthCode: "code" }));
  const second = await handler(trustedRequest({ action: "execute", attemptId: ATTEMPT, operationId: OPERATION, oauthCode: "code-2" }));
  assert.equal(first.status, 503);
  assert.equal(second.status, 409);
  assert.equal(registerCalls, 1);
});

test("writer, finalization, token divergence, and missing WABA all fail closed after success evidence", async () => {
  const writerFailure = createFakeSupabase({ rpcErrors: { materialize_store_whatsapp_embedded_signup_by_system: "ZION_WRITER_FAILED" } });
  const writerResponse = await createWhatsappPinRecoveryPostHandler(baseDeps(writerFailure))(trustedRequest({ action: "materialize", attemptId: ATTEMPT, operationId: OPERATION, oauthCode: "fresh-code" }));
  assert.equal(writerResponse.status, 503);

  const finalizeFailure = createFakeSupabase({ rpcErrors: { finalize_whatsapp_pin_recovery_materialization_by_system: "ZION_PIN_RECOVERY_MATERIALIZED_TOKEN_MISMATCH" } });
  const finalizeResponse = await createWhatsappPinRecoveryPostHandler(baseDeps(finalizeFailure))(trustedRequest({ action: "materialize", attemptId: ATTEMPT, operationId: OPERATION, oauthCode: "fresh-code" }));
  assert.equal(finalizeResponse.status, 503);

  const missingWaba = createFakeSupabase({ integration: { data: [{ integration_id: "66666666-6666-4666-8666-666666666666", outcome: "inserted", provider: "whatsapp", phone_number_id: WHATSAPP_PIN_RECOVERY_TARGET.phoneNumberId, status: "active", is_active: true }], error: null } });
  const missingWabaResponse = await createWhatsappPinRecoveryPostHandler(baseDeps(missingWaba))(trustedRequest({ action: "materialize", attemptId: ATTEMPT, operationId: OPERATION, oauthCode: "fresh-code" }));
  assert.equal(missingWabaResponse.status, 400);
  assert.equal(missingWaba.calls.some((call) => call.name.includes("finalize_")), false);
});

test("execute and materialize replays use the existing terminal authorities", async () => {
  const executeFake = createFakeSupabase({ uncertain: true });
  let executeRegisters = 0;
  const executeHandler = createWhatsappPinRecoveryPostHandler(baseDeps(executeFake, {
    registerRemote: async () => {
      executeRegisters += 1;
      return { result: "uncertain" as const, httpStatus: 502, metaErrorCode: null, requestId: "trace", evidenceHash: null };
    },
  }));
  await executeHandler(trustedRequest({ action: "execute", attemptId: ATTEMPT, operationId: OPERATION, oauthCode: "code" }));
  const executeReplay = await executeHandler(trustedRequest({ action: "execute", attemptId: ATTEMPT, operationId: OPERATION, oauthCode: "code-2" }));
  assert.equal(executeReplay.status, 409);
  assert.equal(executeRegisters, 1);

  const materializeFake = createFakeSupabase({
    authorize: { data: [{ attempt_id: ATTEMPT, status: "remote_confirmed", outcome: "idempotent_replay" }], error: null },
    integration: { data: [{ integration_id: "66666666-6666-4666-8666-666666666666", outcome: "idempotent_replay", provider: "whatsapp", whatsapp_business_account_id: WHATSAPP_PIN_RECOVERY_TARGET.wabaId, phone_number_id: WHATSAPP_PIN_RECOVERY_TARGET.phoneNumberId, status: "active", is_active: true }], error: null },
    finalize: { data: [{ attempt_id: ATTEMPT, status: "completed", integration_id: "66666666-6666-4666-8666-666666666666", replacement_secret_id: "55555555-5555-4555-8555-555555555555", outcome: "idempotent_replay" }], error: null },
  });
  const materializeReplay = await createWhatsappPinRecoveryPostHandler(baseDeps(materializeFake))(trustedRequest({ action: "materialize", attemptId: ATTEMPT, operationId: OPERATION, oauthCode: "fresh-code" }));
  assert.equal(materializeReplay.status, 200);
  assert.equal((await materializeReplay.json()).outcome, "idempotent_replay");
});

test("two concurrent execute requests can produce only one external attempt", async () => {
  const fake = createFakeSupabase();
  let registerCalls = 0;
  const handler = createWhatsappPinRecoveryPostHandler(baseDeps(fake, {
    registerRemote: async () => {
      registerCalls += 1;
      await Promise.resolve();
      return { result: "confirmed" as const, httpStatus: 200, metaErrorCode: null, requestId: "trace", evidenceHash: "a".repeat(64) };
    },
  }));
  const [first, second] = await Promise.all([
    handler(trustedRequest({ action: "execute", attemptId: ATTEMPT, operationId: OPERATION, oauthCode: "code-1" })),
    handler(trustedRequest({ action: "execute", attemptId: ATTEMPT, operationId: OPERATION, oauthCode: "code-2" })),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 409]);
  assert.equal(registerCalls, 1);
  assert.equal(fake.calls.filter((call) => call.name === "begin_whatsapp_pin_recovery_attempt_by_system").length, 2);
});

test("PIN, OAuth token, and encrypted material never appear in HTTP responses or plaintext call logs", async () => {
  const fake = createFakeSupabase();
  const handler = createWhatsappPinRecoveryPostHandler(baseDeps(fake));
  const execute = await handler(trustedRequest({ action: "execute", attemptId: ATTEMPT, operationId: OPERATION, oauthCode: "oauth-code" }));
  const materialize = await handler(trustedRequest({ action: "materialize", attemptId: ATTEMPT, operationId: OPERATION, oauthCode: "fresh-code" }));
  const responses = JSON.stringify({ execute: await execute.json(), materialize: await materialize.json() });
  const callLog = JSON.stringify(fake.calls);
  assert.equal(responses.includes("123456"), false);
  assert.equal(responses.includes(TOKEN), false);
  assert.equal(responses.includes("oauth-code"), false);
  assert.equal(responses.includes("fresh-code"), false);
  assert.equal(callLog.includes("123456"), false);
  assert.equal(callLog.includes("oauth-code"), false);
  assert.equal(callLog.includes("fresh-code"), false);
});
