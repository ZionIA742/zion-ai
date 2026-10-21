import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuthorizedRotation } from "./zion-admin-whatsapp-pin-rotation-execution";
import type { ActiveEncryptedPin, RotationBindingDependencies } from "./zion-admin-whatsapp-pin-rotation-binding";

const { resolveTrustedWhatsappPinRotationBinding } = await import(
  new URL("./zion-admin-whatsapp-pin-rotation-binding.ts", import.meta.url).href
);

const op = {
  rotationId: "11111111-1111-4111-8111-111111111111",
  operationId: "22222222-2222-4222-8222-222222222222",
  actorUserId: "33333333-3333-4333-8333-333333333333",
  sessionBindingHash: "a".repeat(64),
};
const row = {
  organization_id: "44444444-4444-4444-8444-444444444444",
  store_id: "55555555-5555-4555-8555-555555555555",
  phone_number_id: "5511999999999",
  integration_id: "66666666-6666-4666-8666-666666666666",
  old_secret_id: "77777777-7777-4777-8777-777777777777",
  access_token: "TEST_FAKE_META_TOKEN_NOT_REAL",
  ciphertext: "TEST_CIPHER",
  iv: "TEST_IV",
  auth_tag: "TEST_TAG",
  key_version: 1,
};
function arrange(options: Partial<RotationBindingDependencies> = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const decrypted: ActiveEncryptedPin[] = [];
  const deps: RotationBindingDependencies = {
    db: { rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: [row], error: null };
    } },
    graphApiVersion: () => "v24.0",
    decryptPin: (material) => { decrypted.push(material); return "012345"; },
    ...options,
  };
  return { calls, decrypted, deps };
}
async function denied(opValue: AuthorizedRotation, deps: RotationBindingDependencies) {
  await assert.rejects(
    resolveTrustedWhatsappPinRotationBinding(opValue, deps),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "ZION_ADMIN_PIN_ROTATION_BINDING_UNAVAILABLE");
      assert.doesNotMatch(error.message, /CIPHER|TOKEN|012345|secret/i);
      return true;
    },
  );
}

test("trusted service RPC supplies linked credential and decrypts only in server memory", async () => {
  const { calls, decrypted, deps } = arrange();
  const binding = await resolveTrustedWhatsappPinRotationBinding(op, deps);
  assert.deepEqual(calls, [{
    name: "zion_admin_read_whatsapp_pin_rotation_binding_by_system",
    args: {
      p_rotation_id: op.rotationId,
      p_operation_id: op.operationId,
      p_actor_user_id: op.actorUserId,
      p_session_binding_hash: op.sessionBindingHash,
    },
  }]);
  assert.deepEqual(decrypted, [{ ciphertext: "TEST_CIPHER", iv: "TEST_IV", authTag: "TEST_TAG", keyVersion: 1 }]);
  assert.equal(binding.phoneNumberId, row.phone_number_id);
  assert.equal(binding.integrationId, row.integration_id);
  assert.equal(binding.activePin, "012345");
  assert.equal(binding.accessToken, row.access_token);
  assert.equal(binding.graphApiVersion, "v24.0");
});

test("invalid operation ID is denied without querying the database", async () => {
  const { calls, deps } = arrange();
  await denied({ ...op, rotationId: "not-uuid" }, deps);
  assert.equal(calls.length, 0);
});

test("invalid binding hash is denied without querying the database", async () => {
  const { calls, deps } = arrange();
  await denied({ ...op, sessionBindingHash: "broken" }, deps);
  assert.equal(calls.length, 0);
});

test("missing or invalid Graph API version denies before database access", async () => {
  const { calls, deps } = arrange({ graphApiVersion: () => "https://invalid/" });
  await denied(op, deps);
  assert.equal(calls.length, 0);
});

test("SQL error is sanitized even if error mentions secrets", async () => {
  const { deps } = arrange({ db: { rpc: async () => ({ data: null, error: { message: "token and PIN leaked" } }) } });
  await denied(op, deps);
});

test("unexpected missing row or duplicate rows are both denied", async () => {
  for (const data of [null, [], [row, row]]) {
    const { deps } = arrange({ db: { rpc: async () => ({ data, error: null }) } });
    await denied(op, deps);
  }
});

test("SQL server throw is sanitized and never retries", async () => {
  let count = 0;
  const { deps } = arrange({ db: { rpc: async () => { count++; throw new Error("plaintext PIN 888888"); } } });
  await denied(op, deps);
  assert.equal(count, 1);
});

test("missing or wrong integration / tenant / phone binding denies before decrypt", async () => {
  for (const patch of [
    { organization_id: null },
    { store_id: "different-store" },
    { phone_number_id: "invalid" },
    { integration_id: "invalid" },
    { old_secret_id: null },
  ]) {
    let decryptCount = 0;
    const { deps } = arrange({
      db: { rpc: async () => ({ data: [{ ...row, ...patch }], error: null }) },
      decryptPin: () => { decryptCount++; return "123456"; },
    });
    await denied(op, deps);
    assert.equal(decryptCount, 0);
  }
});

test("missing token fails closed and decrypt is not called", async () => {
  let decryptCount = 0;
  const { deps } = arrange({
    db: { rpc: async () => ({ data: [{ ...row, access_token: "" }], error: null }) },
    decryptPin: () => { decryptCount++; return "123456"; },
  });
  await denied(op, deps);
  assert.equal(decryptCount, 0);
});

test("wrong key version or cipher material fails before decrypt", async () => {
  for (const patch of [{ key_version: 2 }, { ciphertext: null }, { iv: "" }, { auth_tag: null }]) {
    let decryptCount = 0;
    const { deps } = arrange({
      db: { rpc: async () => ({ data: [{ ...row, ...patch }], error: null }) },
      decryptPin: () => { decryptCount++; return "123456"; },
    });
    await denied(op, deps);
    assert.equal(decryptCount, 0);
  }
});

test("decryption exception never exposes sensitive error", async () => {
  const { deps } = arrange({ decryptPin: () => { throw new Error("secret 999999"); } });
  await denied(op, deps);
});

test("plaintext that is not exactly six digits fails closed", async () => {
  const { deps } = arrange({ decryptPin: () => "12345" });
  await denied(op, deps);
});
