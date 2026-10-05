import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decryptWhatsappTwoStepPin,
  encryptWhatsappTwoStepPin,
  generateWhatsappTwoStepPin,
  WHATSAPP_PIN_ENCRYPTION_KEY_ENV,
} from "./whatsapp-two-step-pin-crypto";

const TEST_KEY = Buffer.alloc(32, 7).toString("base64");

function withTestKey<T>(callback: () => T): T {
  const previous = process.env[WHATSAPP_PIN_ENCRYPTION_KEY_ENV];
  process.env[WHATSAPP_PIN_ENCRYPTION_KEY_ENV] = TEST_KEY;
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env[WHATSAPP_PIN_ENCRYPTION_KEY_ENV];
    else process.env[WHATSAPP_PIN_ENCRYPTION_KEY_ENV] = previous;
  }
}

test("generates exactly six digits", () => {
  for (let index = 0; index < 100; index += 1) {
    assert.match(generateWhatsappTwoStepPin(), /^\d{6}$/);
  }
});

test("supports leading zero PINs in the roundtrip", () => {
  withTestKey(() => {
    const encrypted = encryptWhatsappTwoStepPin("000007");
    assert.equal(decryptWhatsappTwoStepPin(encrypted), "000007");
  });
});

test("uses a fresh IV and produces different ciphertexts", () => {
  withTestKey(() => {
    const first = encryptWhatsappTwoStepPin("123456");
    const second = encryptWhatsappTwoStepPin("123456");
    assert.notEqual(first.iv, second.iv);
    assert.notEqual(first.ciphertext, second.ciphertext);
  });
});

test("rejects a modified authentication tag", () => {
  withTestKey(() => {
    const encrypted = encryptWhatsappTwoStepPin("123456");
    assert.throws(
      () => decryptWhatsappTwoStepPin({ ...encrypted, authTag: TEST_KEY }),
      (error: unknown) =>
        error instanceof Error &&
        error.message === "WHATSAPP_TWO_STEP_PIN_DECRYPT_FAILED",
    );
  });
});

test("fails closed for an invalid or missing key", () => {
  const previous = process.env[WHATSAPP_PIN_ENCRYPTION_KEY_ENV];
  try {
    process.env[WHATSAPP_PIN_ENCRYPTION_KEY_ENV] = "not-a-key";
    assert.throws(() => encryptWhatsappTwoStepPin("123456"), /KEY_INVALID/);
    delete process.env[WHATSAPP_PIN_ENCRYPTION_KEY_ENV];
    assert.throws(() => encryptWhatsappTwoStepPin("123456"), /KEY_INVALID/);
  } finally {
    if (previous === undefined) delete process.env[WHATSAPP_PIN_ENCRYPTION_KEY_ENV];
    else process.env[WHATSAPP_PIN_ENCRYPTION_KEY_ENV] = previous;
  }
});

test("rejects invalid PINs without exposing their value", () => {
  withTestKey(() => {
    const invalidPins = ["12345", "1234567", "12a456", " 12345"];
    for (const invalidPin of invalidPins) {
      assert.throws(
        () => encryptWhatsappTwoStepPin(invalidPin),
        (error: unknown) =>
          error instanceof Error &&
          error.message === "WHATSAPP_TWO_STEP_PIN_INVALID" &&
          !error.message.includes(invalidPin),
      );
    }
  });
});
