import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

export const P9_CONTRACT_BUYER_DATA_ENCRYPTION_KEY_ENV =
  "ZION_P9_CONTRACT_BUYER_DATA_ENCRYPTION_KEY_V1" as const;
export const P9_CONTRACT_BUYER_DATA_KEY_VERSION = "v1" as const;

const ALGORITHM = "aes-256-gcm" as const;
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ContractBuyerDataContext = {
  organizationId: string;
  storeId: string;
  commercialOpportunityId: string;
  acceptanceEventId: string;
  fieldKey: string;
};

export type EncryptedContractBuyerData = {
  ciphertext: Buffer;
  nonce: Buffer;
  keyVersion: typeof P9_CONTRACT_BUYER_DATA_KEY_VERSION;
};

function invalidSecretMaterial(): Error {
  return new Error("P9_CONTRACT_BUYER_DATA_SECRET_MATERIAL_INVALID");
}

function readEncryptionKey(): Buffer {
  const encoded =
    process.env[P9_CONTRACT_BUYER_DATA_ENCRYPTION_KEY_ENV];
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) {
    throw new Error("P9_CONTRACT_BUYER_DATA_ENCRYPTION_KEY_INVALID");
  }

  const key = Buffer.from(encoded, "base64");
  if (key.length !== KEY_BYTES || key.toString("base64") !== encoded) {
    throw new Error("P9_CONTRACT_BUYER_DATA_ENCRYPTION_KEY_INVALID");
  }

  return key;
}

function assertContext(context: ContractBuyerDataContext): void {
  if (
    !context ||
    !UUID_PATTERN.test(context.organizationId) ||
    !UUID_PATTERN.test(context.storeId) ||
    !UUID_PATTERN.test(context.commercialOpportunityId) ||
    !UUID_PATTERN.test(context.acceptanceEventId) ||
    typeof context.fieldKey !== "string" ||
    context.fieldKey.trim().length === 0 ||
    context.fieldKey.length > 128
  ) {
    throw new Error("P9_CONTRACT_BUYER_DATA_CONTEXT_INVALID");
  }
}

function contextAsAdditionalData(
  context: ContractBuyerDataContext,
): Buffer {
  assertContext(context);
  return Buffer.from(
    JSON.stringify({
      domain: "p9-contract-buyer-data",
      keyVersion: P9_CONTRACT_BUYER_DATA_KEY_VERSION,
      organizationId: context.organizationId,
      storeId: context.storeId,
      commercialOpportunityId: context.commercialOpportunityId,
      acceptanceEventId: context.acceptanceEventId,
      fieldKey: context.fieldKey,
    }),
    "utf8",
  );
}

export function encryptContractBuyerData(
  value: string,
  context: ContractBuyerDataContext,
): EncryptedContractBuyerData {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("P9_CONTRACT_BUYER_DATA_VALUE_INVALID");
  }

  const key = readEncryptionKey();
  const additionalData = contextAsAdditionalData(context);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  cipher.setAAD(additionalData);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  return {
    ciphertext,
    nonce,
    keyVersion: P9_CONTRACT_BUYER_DATA_KEY_VERSION,
  };
}

export function decryptContractBuyerData(
  encrypted: EncryptedContractBuyerData,
  context: ContractBuyerDataContext,
): string {
  try {
    if (
      encrypted?.keyVersion !== P9_CONTRACT_BUYER_DATA_KEY_VERSION ||
      !Buffer.isBuffer(encrypted.ciphertext) ||
      !Buffer.isBuffer(encrypted.nonce) ||
      encrypted.nonce.length !== NONCE_BYTES ||
      encrypted.ciphertext.length < AUTH_TAG_BYTES
    ) {
      throw invalidSecretMaterial();
    }

    const key = readEncryptionKey();
    const additionalData = contextAsAdditionalData(context);
    const tagOffset = encrypted.ciphertext.length - AUTH_TAG_BYTES;
    const ciphertext = encrypted.ciphertext.subarray(0, tagOffset);
    const authTag = encrypted.ciphertext.subarray(tagOffset);
    const decipher = createDecipheriv(ALGORITHM, key, encrypted.nonce);
    decipher.setAAD(additionalData);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("P9_CONTRACT_BUYER_DATA_DECRYPT_FAILED");
  }
}
