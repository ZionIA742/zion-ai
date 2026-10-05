import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomInt,
} from "node:crypto";

export const WHATSAPP_PIN_ENCRYPTION_KEY_ENV =
  "ZION_WHATSAPP_PIN_ENCRYPTION_KEY_V1" as const;
export const WHATSAPP_PIN_KEY_VERSION = 1 as const;

const ALGORITHM = "aes-256-gcm" as const;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export type EncryptedWhatsappTwoStepPin = {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: typeof WHATSAPP_PIN_KEY_VERSION;
};

function invalidSecretMaterial(): Error {
  return new Error("WHATSAPP_PIN_SECRET_MATERIAL_INVALID");
}

function readEncryptionKey(): Buffer {
  const encoded = process.env[WHATSAPP_PIN_ENCRYPTION_KEY_ENV];
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) {
    throw new Error("WHATSAPP_PIN_ENCRYPTION_KEY_INVALID");
  }

  const key = Buffer.from(encoded, "base64");
  if (
    key.length !== 32 ||
    key.toString("base64") !== encoded
  ) {
    throw new Error("WHATSAPP_PIN_ENCRYPTION_KEY_INVALID");
  }

  return key;
}

function assertPin(pin: unknown): asserts pin is string {
  if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) {
    throw new Error("WHATSAPP_TWO_STEP_PIN_INVALID");
  }
}

function decodeBase64(value: unknown, expectedBytes: number): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw invalidSecretMaterial();
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== expectedBytes || decoded.toString("base64") !== value) {
    throw invalidSecretMaterial();
  }
  return decoded;
}

export function generateWhatsappTwoStepPin(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function encryptWhatsappTwoStepPin(
  pin: string,
): EncryptedWhatsappTwoStepPin {
  assertPin(pin);
  const key = readEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(pin, "utf8"),
    cipher.final(),
  ]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: WHATSAPP_PIN_KEY_VERSION,
  };
}

export function decryptWhatsappTwoStepPin(
  encrypted: EncryptedWhatsappTwoStepPin,
): string {
  try {
    if (encrypted?.keyVersion !== WHATSAPP_PIN_KEY_VERSION) {
      throw invalidSecretMaterial();
    }

    const key = readEncryptionKey();
    const iv = decodeBase64(encrypted.iv, IV_BYTES);
    const authTag = decodeBase64(encrypted.authTag, AUTH_TAG_BYTES);
    const ciphertext = decodeBase64(encrypted.ciphertext, 6);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const pin = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    assertPin(pin);
    return pin;
  } catch {
    throw new Error("WHATSAPP_TWO_STEP_PIN_DECRYPT_FAILED");
  }
}
