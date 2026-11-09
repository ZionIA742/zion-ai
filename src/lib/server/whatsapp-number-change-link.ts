import { createHash, randomBytes } from "node:crypto";

export const WHATSAPP_NUMBER_CHANGE_PROVIDER = "whatsapp" as const;
export const WHATSAPP_NUMBER_CHANGE_LINK_TTL_MS = 30 * 60_000;

export type WhatsappNumberChangeEmail = {
  recipient: string;
  storeName: string;
  link: string;
  expiresAt: string;
};

export type WhatsappNumberChangeEmailTransport = {
  send(message: WhatsappNumberChangeEmail): Promise<{ delivered: boolean }>;
};

export function createWhatsappNumberChangeToken() {
  return randomBytes(32).toString("base64url");
}

export function hashWhatsappNumberChangeToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function buildWhatsappNumberChangeLink(baseUrl: string, token: string) {
  const url = new URL("/whatsapp-number-change", baseUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

export function createSimulatedWhatsappNumberChangeEmailTransport(
  sink: (message: WhatsappNumberChangeEmail) => void,
): WhatsappNumberChangeEmailTransport {
  return {
    async send(message) {
      sink(message);
      return { delivered: true };
    },
  };
}

export function createDisabledWhatsappNumberChangeEmailTransport(): WhatsappNumberChangeEmailTransport {
  return {
    async send() {
      return { delivered: false };
    },
  };
}
