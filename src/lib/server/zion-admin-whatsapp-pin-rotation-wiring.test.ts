import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Node's built-in type stripper requires explicit .ts specifiers. The Next.js
// production module uses normal extensionless imports. Create temporary test
// copies outside the repository with explicit extensions; never rewrite source.
const sourceDir = dirname(fileURLToPath(import.meta.url));
const tempDir = mkdtempSync(join(tmpdir(), "zion-pin-c2d-test-"));
const dependencies = [
  "whatsapp-two-step-pin-crypto.ts",
  "meta-whatsapp-pin-rotation.ts",
  "zion-admin-whatsapp-pin-rotation-binding.ts",
  "zion-admin-whatsapp-pin-rotation-execution.ts",
];
let wired: typeof import("./zion-admin-whatsapp-pin-rotation-wiring") | null = null;
try {
  for (const filename of dependencies) {
    copyFileSync(join(sourceDir, filename), join(tempDir, filename));
  }
  let source = readFileSync(join(sourceDir, "zion-admin-whatsapp-pin-rotation-wiring.ts"), "utf8");
  for (const filename of dependencies) {
    source = source.replaceAll(`"./${filename.slice(0, -3)}"`, `"./${filename}"`);
  }
  writeFileSync(join(tempDir, "zion-admin-whatsapp-pin-rotation-wiring.ts"), source);
  wired = await import(pathToFileURL(join(tempDir, "zion-admin-whatsapp-pin-rotation-wiring.ts")).href);
} finally {
  // Module source and its dependencies are cached in memory after import.
  rmSync(tempDir, { recursive: true, force: true });
}
if (!wired) throw new Error("OFFLINE_MODULE_LOAD_FAILED");
const { createTrustedWhatsappPinRotationExecutionDeps, executeTrustedWhatsappPinRotationWhenEnabled } = wired;

const operation = {
  rotationId: "11111111-1111-4111-8111-111111111111",
  operationId: "22222222-2222-4222-8222-222222222222",
  actorUserId: "33333333-3333-4333-8333-333333333333",
  sessionBindingHash: "a".repeat(64),
};
const readerRow = {
  organization_id: "44444444-4444-4444-8444-444444444444",
  store_id: "55555555-5555-4555-8555-555555555555",
  phone_number_id: "5511999999999",
  integration_id: "66666666-6666-4666-8666-666666666666",
  old_secret_id: "77777777-7777-4777-8777-777777777777",
  access_token: "FAKE_TEST_TOKEN_DO_NOT_USE_REAL",
  ciphertext: "FAKE_CIPHER",
  iv: "FAKE_IV",
  auth_tag: "FAKE_TAG",
  key_version: 1,
};
const evidence = "b".repeat(64);
function arrange(override: Record<string, unknown> = {}) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const metaCalls: Array<Record<string, unknown>> = [];
  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === "zion_admin_read_whatsapp_pin_rotation_binding_by_system") {
        return { error: null, data: [readerRow] };
      }
      if (name === "zion_admin_begin_whatsapp_pin_rotation_by_system") {
        return { error: null, data: [{
          rotation_id: operation.rotationId, status: "executing",
          new_secret_id: "88888888-8888-4888-8888-888888888888",
          phone_number_id: readerRow.phone_number_id, integration_id: readerRow.integration_id,
        }] };
      }
      if (name === "zion_admin_record_whatsapp_pin_rotation_result_by_system") {
        const statusByResult: Record<string, string> = {
          confirmed: "remote_confirmed", rejected: "remote_rejected", uncertain: "remote_uncertain",
        };
        return { error: null, data: [{
          rotation_id: operation.rotationId, status: statusByResult[String(args.p_result)],
          outcome: "recorded",
        }] };
      }
      return { error: null, data: [{ rotation_id: operation.rotationId,
        status: "completed", outcome: "completed",
        new_secret_id: "88888888-8888-4888-8888-888888888888" }] };
    },
  };
  const primitives = {
    decryptPin: () => "123456",
    generatePin: () => "654321",
    encryptPin: () => ({ ciphertext: "TEST_CIPHER", iv: "TEST_IV", authTag: "TEST_TAG", keyVersion: 1 as const }),
    setMetaPin: async (input: Record<string, unknown>) => {
      metaCalls.push(input);
      return { result: "confirmed" as const, httpStatus: 200, metaErrorCode: null,
        requestId: "trace", evidenceHash: evidence };
    },
    ...override,
  };
  return { db, rpcCalls, metaCalls, primitives };
}

test("disabled by default: no reader, claim, Meta, PIN generation or encryption", async () => {
  const { db, rpcCalls, metaCalls, primitives } = arrange({
    decryptPin: () => { throw Error("unexpected decrypt"); },
    generatePin: () => { throw Error("unexpected generate"); },
    encryptPin: () => { throw Error("unexpected encryption"); },
    executionEnabled: () => false,
  });
  const out = await executeTrustedWhatsappPinRotationWhenEnabled(operation, { db }, primitives);
  assert.equal(out.state, "preflight_denied");
  assert.equal(rpcCalls.length, 0);
  assert.equal(metaCalls.length, 0);
});

test("building deps is side-effect-free and uses same authorized operation", async () => {
  const { db, rpcCalls, primitives } = arrange();
  const deps = createTrustedWhatsappPinRotationExecutionDeps({ db, graphApiVersion: () => "v24.0" }, primitives);
  assert.equal(rpcCalls.length, 0);
  const binding = await deps.loadTrustedBinding(operation);
  assert.equal(binding.phoneNumberId, readerRow.phone_number_id);
  assert.equal(binding.accessToken, readerRow.access_token);
  assert.equal(binding.activePin, "123456");
  assert.equal(binding.graphApiVersion, "v24.0");
  assert.equal(rpcCalls[0].name, "zion_admin_read_whatsapp_pin_rotation_binding_by_system");
  assert.deepEqual(rpcCalls[0].args, {
    p_rotation_id: operation.rotationId, p_operation_id: operation.operationId,
    p_actor_user_id: operation.actorUserId, p_session_binding_hash: operation.sessionBindingHash,
  });
});

test("confirmed mock Meta: read, claim, one Meta request, record, finalize", async () => {
  const { db, rpcCalls, metaCalls, primitives } = arrange({ executionEnabled: () => true });
  const out = await executeTrustedWhatsappPinRotationWhenEnabled(
    operation, { db, graphApiVersion: () => "v24.0" }, primitives,
  );
  assert.equal(out.state, "completed");
  assert.deepEqual(rpcCalls.map(x => x.name), [
    "zion_admin_read_whatsapp_pin_rotation_binding_by_system",
    "zion_admin_begin_whatsapp_pin_rotation_by_system",
    "zion_admin_record_whatsapp_pin_rotation_result_by_system",
    "zion_admin_finalize_whatsapp_pin_rotation_by_system",
  ]);
  assert.equal(metaCalls.length, 1);
  assert.equal(metaCalls[0].newPin, "654321");
  assert.equal(metaCalls[0].accessToken, readerRow.access_token);
  assert.equal(rpcCalls[1].args.p_ciphertext, "TEST_CIPHER");
  assert.doesNotMatch(JSON.stringify(out), /654321|FAKE_TEST_TOKEN/);
});

test("uncertain mock remote outcome is terminal without retry or finalize", async () => {
  const { db, rpcCalls, metaCalls, primitives } = arrange({
    executionEnabled: () => true,
    setMetaPin: async (input: Record<string, unknown>) => {
      metaCalls.push(input);
      return { result: "uncertain" as const, httpStatus: null, metaErrorCode: null,
        requestId: null, evidenceHash: null };
    },
  });
  const out = await executeTrustedWhatsappPinRotationWhenEnabled(operation, { db, graphApiVersion: () => "v24.0" }, primitives);
  assert.equal(out.state, "remote_uncertain");
  assert.equal(metaCalls.length, 1);
  assert.equal(rpcCalls.length, 3);
  assert.equal(rpcCalls[2].args.p_result, "uncertain");
});

test("reader failure blocks PIN generation, Meta and SQL claim", async () => {
  const { rpcCalls, metaCalls, primitives } = arrange({ executionEnabled: () => true });
  const db = { rpc: async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({name,args}); return { data: null, error: {message: "sensitive secret"} };
  } };
  const out = await executeTrustedWhatsappPinRotationWhenEnabled(operation, { db, graphApiVersion: () => "v24.0" }, primitives);
  assert.equal(out.state, "preflight_denied");
  assert.equal(rpcCalls.length, 1);
  assert.equal(metaCalls.length, 0);
});

test("missing graph version blocks before SQL and Meta", async () => {
  const {db, rpcCalls, metaCalls, primitives} = arrange({ executionEnabled: () => true });
  const out = await executeTrustedWhatsappPinRotationWhenEnabled(operation,
    { db, graphApiVersion: () => "invalid" }, primitives);
  assert.equal(out.state, "preflight_denied");
  assert.equal(rpcCalls.length, 0);
  assert.equal(metaCalls.length, 0);
});

test("default configuration denies before any dependency when execution flag is absent", async () => {
  const flag = "ZION_ADMIN_WHATSAPP_PIN_ROTATION_EXECUTION_ENABLED";
  const oldValue = process.env[flag];
  try {
    delete process.env[flag];
    const { db, rpcCalls, metaCalls, primitives } = arrange();
    const out = await executeTrustedWhatsappPinRotationWhenEnabled(operation, { db }, primitives);
    assert.equal(out.state, "preflight_denied");
    assert.equal(rpcCalls.length, 0);
    assert.equal(metaCalls.length, 0);
  } finally {
    if (oldValue === undefined) delete process.env[flag];
    else process.env[flag] = oldValue;
  }
});

test("explicit mocked Meta rejection is recorded without finalization", async () => {
  const {db, rpcCalls, metaCalls, primitives} = arrange({
    executionEnabled: () => true,
    setMetaPin: async (input: Record<string, unknown>) => {
      metaCalls.push(input);
      return { result: "rejected" as const, httpStatus: 400,
        metaErrorCode: "100", requestId: null, evidenceHash: evidence };
    },
  });
  const out = await executeTrustedWhatsappPinRotationWhenEnabled(operation,
    { db, graphApiVersion: () => "v24.0" }, primitives);
  assert.equal(out.state, "remote_rejected");
  assert.equal(metaCalls.length, 1);
  assert.equal(rpcCalls.length, 3);
  assert.equal(rpcCalls[2].args.p_result, "rejected");
});
