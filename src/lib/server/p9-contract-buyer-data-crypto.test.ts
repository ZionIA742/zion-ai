import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decryptContractBuyerData,
  encryptContractBuyerData,
  P9_CONTRACT_BUYER_DATA_ENCRYPTION_KEY_ENV,
} from "./p9-contract-buyer-data-crypto";

const TEST_KEY = Buffer.alloc(32, 11).toString("base64");
const CONTEXT = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  storeId: "00000000-0000-4000-8000-000000000002",
  commercialOpportunityId: "00000000-0000-4000-8000-000000000003",
  acceptanceEventId: "00000000-0000-4000-8000-000000000004",
  fieldKey: "cpf",
} as const;
const TEST_VALUE = "contract-buyer-data-test-sentinel";

function withTestKey<T>(callback: () => T): T {
  const previous = process.env[P9_CONTRACT_BUYER_DATA_ENCRYPTION_KEY_ENV];
  process.env[P9_CONTRACT_BUYER_DATA_ENCRYPTION_KEY_ENV] = TEST_KEY;
  try {
    return callback();
  } finally {
    if (previous === undefined) {
      delete process.env[P9_CONTRACT_BUYER_DATA_ENCRYPTION_KEY_ENV];
    } else {
      process.env[P9_CONTRACT_BUYER_DATA_ENCRYPTION_KEY_ENV] = previous;
    }
  }
}

test("round trips contract buyer data with authenticated context", () => {
  withTestKey(() => {
    const encrypted = encryptContractBuyerData(TEST_VALUE, CONTEXT);
    assert.equal(decryptContractBuyerData(encrypted, CONTEXT), TEST_VALUE);
    assert.equal(encrypted.nonce.length, 12);
    assert.equal(encrypted.ciphertext.length, TEST_VALUE.length + 16);
  });
});

test("uses a fresh nonce and produces different ciphertexts", () => {
  withTestKey(() => {
    const first = encryptContractBuyerData(TEST_VALUE, CONTEXT);
    const second = encryptContractBuyerData(TEST_VALUE, CONTEXT);
    assert.notDeepEqual(first.nonce, second.nonce);
    assert.notDeepEqual(first.ciphertext, second.ciphertext);
  });
});

test("rejects modified ciphertext, tag, nonce, and context", () => {
  withTestKey(() => {
    const encrypted = encryptContractBuyerData(TEST_VALUE, CONTEXT);

    const modifiedCiphertext = Buffer.from(encrypted.ciphertext);
    modifiedCiphertext[0] ^= 1;
    assert.throws(() => decryptContractBuyerData(
      { ...encrypted, ciphertext: modifiedCiphertext },
      CONTEXT,
    ), /DECRYPT_FAILED/);

    const modifiedTag = Buffer.from(encrypted.ciphertext);
    modifiedTag[modifiedTag.length - 1] ^= 1;
    assert.throws(() => decryptContractBuyerData(
      { ...encrypted, ciphertext: modifiedTag },
      CONTEXT,
    ), /DECRYPT_FAILED/);

    const modifiedNonce = Buffer.from(encrypted.nonce);
    modifiedNonce[0] ^= 1;
    assert.throws(() => decryptContractBuyerData(
      { ...encrypted, nonce: modifiedNonce },
      CONTEXT,
    ), /DECRYPT_FAILED/);

    assert.throws(() => decryptContractBuyerData(encrypted, {
      ...CONTEXT,
      organizationId: "00000000-0000-4000-8000-000000000099",
    }), /DECRYPT_FAILED/);
  });
});

test("fails closed for missing and invalid keys", () => {
  const previous = process.env[P9_CONTRACT_BUYER_DATA_ENCRYPTION_KEY_ENV];
  try {
    process.env[P9_CONTRACT_BUYER_DATA_ENCRYPTION_KEY_ENV] = "not-a-key";
    assert.throws(
      () => encryptContractBuyerData(TEST_VALUE, CONTEXT),
      /KEY_INVALID/,
    );
    delete process.env[P9_CONTRACT_BUYER_DATA_ENCRYPTION_KEY_ENV];
    assert.throws(
      () => encryptContractBuyerData(TEST_VALUE, CONTEXT),
      /KEY_INVALID/,
    );
  } finally {
    if (previous === undefined) {
      delete process.env[P9_CONTRACT_BUYER_DATA_ENCRYPTION_KEY_ENV];
    } else {
      process.env[P9_CONTRACT_BUYER_DATA_ENCRYPTION_KEY_ENV] = previous;
    }
  }
});

test("does not expose values or context in validation errors", () => {
  withTestKey(() => {
    assert.throws(
      () => encryptContractBuyerData("", CONTEXT),
      (error: unknown) =>
        error instanceof Error &&
        error.message === "P9_CONTRACT_BUYER_DATA_VALUE_INVALID" &&
        !error.message.includes(TEST_VALUE) &&
        !error.message.includes(CONTEXT.organizationId),
    );
    assert.throws(
      () => encryptContractBuyerData(TEST_VALUE, {
        ...CONTEXT,
        fieldKey: "",
      }),
      (error: unknown) =>
        error instanceof Error &&
        error.message === "P9_CONTRACT_BUYER_DATA_CONTEXT_INVALID" &&
        !error.message.includes(TEST_VALUE),
    );
  });
});
