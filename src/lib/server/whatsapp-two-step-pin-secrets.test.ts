import assert from "node:assert/strict";
import { test } from "node:test";

import {
  encryptWhatsappTwoStepPin,
  WHATSAPP_PIN_ENCRYPTION_KEY_ENV,
} from "./whatsapp-two-step-pin-crypto";
import {
  activateWhatsappTwoStepPinSecret,
  createPendingWhatsappTwoStepPinSecret,
  invalidateWhatsappTwoStepPinSecret,
  readWhatsappTwoStepPinMetadata,
  revealWhatsappTwoStepPinServerSide,
} from "./whatsapp-two-step-pin-secrets";

const TEST_KEY = Buffer.alloc(32, 7).toString("base64");

test("secret writers send only encrypted material and scoped identifiers", async () => {
  process.env[WHATSAPP_PIN_ENCRYPTION_KEY_ENV] = TEST_KEY;
  const material = encryptWhatsappTwoStepPin("000007");
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const supabase = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name.includes("pending")) {
        return { data: [{ secret_id: "secret-1", status: "pending" }], error: null };
      }
      if (name.includes("activate")) {
        return { data: [{ secret_id: "secret-1", status: "active" }], error: null };
      }
      return { data: [{ secret_id: "secret-1", status: "invalidated" }], error: null };
    },
  };

  await createPendingWhatsappTwoStepPinSecret({
    supabase,
    organizationId: "org-1",
    storeId: "store-1",
    phoneNumberId: "phone-1",
    material,
  });
  await activateWhatsappTwoStepPinSecret({
    supabase,
    organizationId: "org-1",
    storeId: "store-1",
    phoneNumberId: "phone-1",
    externalIntegrationId: "integration-1",
  });
  await invalidateWhatsappTwoStepPinSecret({
    supabase,
    organizationId: "org-1",
    storeId: "store-1",
    secretId: "secret-1",
  });

  assert.equal(calls.length, 3);
  assert.equal(calls[0]?.args.p_ciphertext, material.ciphertext);
  assert.equal(calls[0]?.args.p_iv, material.iv);
  assert.equal(calls[0]?.args.p_auth_tag, material.authTag);
  assert.equal(Object.values(calls[0]?.args ?? {}).includes("000007"), false);
  assert.equal(calls[1]?.args.p_external_integration_id, "integration-1");
  assert.equal(calls[2]?.args.p_secret_id, "secret-1");
});

test("metadata reader excludes encrypted material and reveal decrypts server-side", async () => {
  process.env[WHATSAPP_PIN_ENCRYPTION_KEY_ENV] = TEST_KEY;
  const material = encryptWhatsappTwoStepPin("123456");
  const supabase = {
    async rpc(name: string) {
      if (name.includes("metadata")) {
        return {
          data: [{
            managed_pin: true,
            status: "active",
            key_version: 1,
            created_at: "2026-10-05T12:00:00.000Z",
            last_revealed_at: null,
            last_rotated_at: null,
          }],
          error: null,
        };
      }
      return {
        data: [{
          secret_id: "secret-1",
          ciphertext: material.ciphertext,
          iv: material.iv,
          auth_tag: material.authTag,
          key_version: 1,
        }],
        error: null,
      };
    },
  };

  const metadata = await readWhatsappTwoStepPinMetadata({
    supabase,
    organizationId: "org-1",
    storeId: "store-1",
    phoneNumberId: "phone-1",
  });
  assert.deepEqual(metadata, {
    managed_pin: true,
    status: "active",
    key_version: 1,
    created_at: "2026-10-05T12:00:00.000Z",
    last_revealed_at: null,
    last_rotated_at: null,
  });
  assert.equal(await revealWhatsappTwoStepPinServerSide({
    supabase,
    organizationId: "org-1",
    storeId: "store-1",
    phoneNumberId: "phone-1",
  }), "123456");
});
