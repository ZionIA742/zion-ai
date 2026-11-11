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

type ResendFetch = (input: string, init?: RequestInit) => Promise<Response>;

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !/[\r\n]/.test(value);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

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

/**
 * Server-only opt-in transport. Invalid configuration remains disabled and
 * never calls the provider.
 */
export function createResendWhatsappNumberChangeEmailTransport(options: {
  apiKey?: string | null;
  from?: string | null;
  fetchImpl?: ResendFetch;
  endpoint?: string;
} = {}): WhatsappNumberChangeEmailTransport {
  const apiKey = options.apiKey?.trim() || "";
  const from = options.from?.trim() || "";
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = options.endpoint?.trim() || "https://api.resend.com/emails";

  if (!apiKey.startsWith("re_") || !validEmail(from) || !/^https:\/\//i.test(endpoint)) {
    return createDisabledWhatsappNumberChangeEmailTransport();
  }

  return {
    async send(message) {
      const recipient = message.recipient.trim();
      const storeName = message.storeName.trim() || "sua loja";
      const link = message.link.trim();
      const expiresAt = message.expiresAt.trim();
      if (!validEmail(recipient) || !link || !expiresAt) return { delivered: false };

      const safeStoreName = escapeHtml(storeName);
      const safeLink = escapeHtml(link);
      const text = [
        `Solicitação de troca do WhatsApp da ${storeName}.`,
        "",
        `Abra o link para continuar: ${link}`,
        `Este link expira em: ${expiresAt}`,
        "",
        "Se você não solicitou esta troca, ignore este e-mail.",
      ].join("\n");
      const html = [
        `<p>Solicitação de troca do WhatsApp da <strong>${safeStoreName}</strong>.</p>`,
        `<p><a href="${safeLink}">Continuar troca do WhatsApp</a></p>`,
        `<p>Este link expira em: ${escapeHtml(expiresAt)}</p>`,
        "<p>Se você não solicitou esta troca, ignore este e-mail.</p>",
      ].join("");

      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: [recipient],
            subject: `Troca do WhatsApp da ${storeName}`,
            text,
            html,
          }),
        });
        return { delivered: response.ok };
      } catch {
        return { delivered: false };
      }
    },
  };
}

export function createConfiguredWhatsappNumberChangeEmailTransport(): WhatsappNumberChangeEmailTransport {
  return createResendWhatsappNumberChangeEmailTransport({
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.RESEND_FROM_EMAIL,
  });
}
