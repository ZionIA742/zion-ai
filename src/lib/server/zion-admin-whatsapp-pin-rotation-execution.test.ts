import assert from "node:assert/strict";
import { test } from "node:test";
import type { PinRotationExecutionDeps } from "./zion-admin-whatsapp-pin-rotation-execution";

const { executeAuthorizedWhatsappPinRotation } = await import(
  new URL("./zion-admin-whatsapp-pin-rotation-execution.ts", import.meta.url).href
);

const operation = {
  rotationId: "11111111-1111-4111-8111-111111111111",
  operationId: "22222222-2222-4222-8222-222222222222",
  actorUserId: "33333333-3333-4333-8333-333333333333",
  sessionBindingHash: "a".repeat(64),
};
const binding = {
  organizationId: "44444444-4444-4444-8444-444444444444",
  storeId: "55555555-5555-4555-8555-555555555555",
  phoneNumberId: "5511999999999",
  integrationId: "66666666-6666-4666-8666-666666666666",
  activePin: "123456",
  accessToken: "DO_NOT_USE_REAL_TOKEN_FOR_TESTS",
  graphApiVersion: "v23.0",
};
const secret = "654321";
const evidenceHash = "f".repeat(64);

function arrange(opts: Partial<PinRotationExecutionDeps> = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const metaCalls: Array<Parameters<PinRotationExecutionDeps["setMetaPin"]>[0]> = [];
  const deps: PinRotationExecutionDeps = {
    db: {
      rpc: async (name, args) => {
        calls.push({ name, args });
        if (name === "zion_admin_begin_whatsapp_pin_rotation_by_system") {
          return { error: null, data: [{
            rotation_id: operation.rotationId, status: "executing",
            new_secret_id: "77777777-7777-4777-8777-777777777777",
            phone_number_id: binding.phoneNumberId, integration_id: binding.integrationId,
          }] };
        }
        if (name === "zion_admin_record_whatsapp_pin_rotation_result_by_system") {
          return { error: null, data: [{ rotation_id: operation.rotationId,
            status: { confirmed: "remote_confirmed", rejected: "remote_rejected", uncertain: "remote_uncertain" }[String(args.p_result) as "confirmed" | "rejected" | "uncertain"],
            outcome: "recorded" }] };
        }
        return { error: null, data: [{
          rotation_id: operation.rotationId, status: "completed", outcome: "completed",
          new_secret_id: "77777777-7777-4777-8777-777777777777",
        }] };
      },
    },
    loadTrustedBinding: async () => binding,
    generateSecurePin: () => secret,
    encryptPin: () => ({ ciphertext: "ciphertext", iv: "iv", authTag: "tag", keyVersion: 1 }),
    setMetaPin: async (input) => {
      metaCalls.push(input);
      return { result: "confirmed", httpStatus: 200, metaErrorCode: null,
        requestId: "trace", evidenceHash };
    },
    ...opts,
  };
  return { calls, metaCalls, deps };
}

test("confirmed remote execution: claim, Meta once, record, finalize in order", async () => {
  const { calls, metaCalls, deps } = arrange();
  const result = await executeAuthorizedWhatsappPinRotation(operation, deps);
  assert.deepEqual(result, { ok: true, rotationId: operation.rotationId, state: "completed" });
  assert.deepEqual(calls.map(x => x.name), [
    "zion_admin_begin_whatsapp_pin_rotation_by_system",
    "zion_admin_record_whatsapp_pin_rotation_result_by_system",
    "zion_admin_finalize_whatsapp_pin_rotation_by_system",
  ]);
  assert.equal(metaCalls.length, 1);
  assert.equal(metaCalls[0].newPin, secret);
  assert.equal(calls[0].args.p_ciphertext, "ciphertext");
  assert.equal(calls[1].args.p_result, "confirmed");
  assert.doesNotMatch(JSON.stringify(result), /654321|DO_NOT_USE_REAL_TOKEN/);
});

test("uncertain response is persisted; no finalize and no retry", async () => {
  const { calls, metaCalls, deps } = arrange({ setMetaPin: async (input) => {
    metaCalls.push(input);
    return { result: "uncertain", httpStatus: null, metaErrorCode: null,
      requestId: null, evidenceHash: null };
  } });
  const result = await executeAuthorizedWhatsappPinRotation(operation, deps);
  assert.equal(result.state, "remote_uncertain");
  assert.equal(metaCalls.length, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].args.p_result, "uncertain");
});

test("deterministic Meta rejection is recorded, never activated", async () => {
  const { calls, deps } = arrange({ setMetaPin: async () => ({ result: "rejected", httpStatus: 400,
    metaErrorCode: "100", requestId: null, evidenceHash: evidenceHash }) });
  const result = await executeAuthorizedWhatsappPinRotation(operation, deps);
  assert.equal(result.state, "remote_rejected");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].args.p_result, "rejected");
});

test("claim RPC rejection blocks all Meta calls", async () => {
  const { metaCalls, deps } = arrange({ db: { rpc: async () => ({ data: null,
    error: { message: "PIN=123456 and token=secret" } }) } });
  const result = await executeAuthorizedWhatsappPinRotation(operation, deps);
  assert.equal(result.state, "authorization_rejected");
  assert.equal(metaCalls.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /PIN=|token=/);
});

test("missing trusted binding blocks claim", async () => {
  const { calls, deps } = arrange({ loadTrustedBinding: async () => ({ ...binding, accessToken: "" }) });
  const result = await executeAuthorizedWhatsappPinRotation(operation, deps);
  assert.equal(result.state, "preflight_denied");
  assert.equal(calls.length, 0);
});

test("generated PIN equal to active is regenerated before claim", async () => {
  let count = 0;
  const { calls, metaCalls, deps } = arrange({ generateSecurePin: () => ++count === 1 ? binding.activePin : secret });
  const result = await executeAuthorizedWhatsappPinRotation(operation, deps);
  assert.equal(result.state, "completed");
  assert.equal(count, 2);
  assert.equal(metaCalls[0].newPin, secret);
  assert.equal(calls.length, 3);
});

test("non-six-digit generated PIN is rejected before claim", async () => {
  const { calls, deps } = arrange({ generateSecurePin: () => "12345" });
  const result = await executeAuthorizedWhatsappPinRotation(operation, deps);
  assert.equal(result.state, "preflight_denied");
  assert.equal(calls.length, 0);
});

test("encryption failure does not consume authorization", async () => {
  const { calls, deps } = arrange({ encryptPin: () => { throw new Error("secret PIN=654321"); } });
  const result = await executeAuthorizedWhatsappPinRotation(operation, deps);
  assert.equal(result.state, "preflight_denied");
  assert.equal(calls.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /654321/);
});

test("malformed SQL begin does not call Meta and requires review", async () => {
  const { metaCalls, deps } = arrange({ db: { rpc: async () => ({ error: null,
    data: [{ rotation_id: operation.rotationId, status: "executing",
      new_secret_id: "77777777-7777-4777-8777-777777777777", phone_number_id: "99999",
      integration_id: binding.integrationId }] }) } });
  const result = await executeAuthorizedWhatsappPinRotation(operation, deps);
  assert.equal(result.state, "manual_reconciliation_required");
  assert.equal(metaCalls.length, 0);
});

test("transport exception after claim is uncertain and not retried", async () => {
  const { calls, deps } = arrange({ setMetaPin: async () => { throw new Error("timeout"); } });
  const result = await executeAuthorizedWhatsappPinRotation(operation, deps);
  assert.equal(result.state, "remote_uncertain");
  assert.equal(calls[1].args.p_result, "uncertain");
  assert.equal(calls.length, 2);
});

test("invalid success response cannot finalize", async () => {
  const { calls, deps } = arrange({ setMetaPin: async () => ({ result: "confirmed", httpStatus: 200,
    metaErrorCode: null, requestId: null, evidenceHash: null }) });
  const result = await executeAuthorizedWhatsappPinRotation(operation, deps);
  assert.equal(result.state, "remote_uncertain");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].args.p_result, "uncertain");
});

test("failure recording Meta result requires manual review and no second Meta call", async () => {
  let sent = 0;
  const { calls, deps } = arrange({
    db: { rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "zion_admin_begin_whatsapp_pin_rotation_by_system") {
        return { data: [{ rotation_id: operation.rotationId, status: "executing",
          new_secret_id: "77777777-7777-4777-8777-777777777777",
          phone_number_id: binding.phoneNumberId, integration_id: binding.integrationId }], error: null };
      }
      return { data: null, error: { message: "db unavailable" } };
    } },
    setMetaPin: async () => { sent++;
      return { result: "confirmed", httpStatus: 200, metaErrorCode: null,
        requestId: null, evidenceHash };
    },
  });
  const result = await executeAuthorizedWhatsappPinRotation(operation, deps);
  assert.equal(result.state, "manual_reconciliation_required");
  assert.equal(sent, 1);
  assert.equal(calls.length, 2);
});

test("finalization failure requires manual review, not another Meta call", async () => {
  const { calls, metaCalls, deps } = arrange();
  const rpc = deps.db.rpc;
  deps.db.rpc = async (name, args) => {
    if (name === "zion_admin_finalize_whatsapp_pin_rotation_by_system") {
      calls.push({ name, args });
      return { data: null, error: { message: "error" } };
    }
    return rpc(name, args);
  };
  const result = await executeAuthorizedWhatsappPinRotation(operation, deps);
  assert.equal(result.state, "manual_reconciliation_required");
  assert.equal(metaCalls.length, 1);
  assert.equal(calls.length, 3);
});

test("invalid operation never calls DB nor Meta", async () => {
  const { calls, metaCalls, deps } = arrange();
  const result = await executeAuthorizedWhatsappPinRotation({ ...operation, sessionBindingHash: "broken" }, deps);
  assert.equal(result.state, "preflight_denied");
  assert.equal(metaCalls.length, 0);
  assert.equal(calls.length, 0);
});

test("network loss during claim is ambiguous and must not retry", async () => {
  const { metaCalls, deps } = arrange({ db: { rpc: async () => { throw new Error("ECONNRESET"); } } });
  const result = await executeAuthorizedWhatsappPinRotation(operation, deps);
  assert.equal(result.state, "manual_reconciliation_required");
  assert.equal(metaCalls.length, 0);
});
