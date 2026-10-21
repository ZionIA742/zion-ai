import { createHash } from "node:crypto";

/**
 * ZION-ADM / PIN rotation: remote-only adapter.
 *
 * This module does not generate a PIN, update the local secret ledger,
 * authorize a user, or retry an external request. The caller must establish
 * the authorized store/phone/WABA binding, consume a one-shot operation claim,
 * and finalize the ledger transactionally after a confirmed observation.
 */
export type MetaWhatsappPinRotationObservation = {
  result: "confirmed" | "rejected" | "uncertain";
  httpStatus: number | null;
  metaErrorCode: string | null;
  requestId: string | null;
  evidenceHash: string | null;
};

export type MetaWhatsappPinRotationInput = {
  graphApiVersion: string;
  phoneNumberId: string;
  accessToken: string;
  newPin: string;
};

export type MetaWhatsappPinRotationDeps = {
  fetch?: typeof fetch;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

function requireInput(input: MetaWhatsappPinRotationInput): void {
  if (
    !/^v\d{1,2}\.\d{1,2}$/.test(input.graphApiVersion) ||
    !/^\d{5,32}$/.test(input.phoneNumberId) ||
    !input.accessToken.trim() ||
    !/^\d{6}$/.test(input.newPin)
  ) {
    // Never include PINs or tokens in error messages.
    throw new Error("ZION_WHATSAPP_PIN_ROTATION_REMOTE_INPUT_INVALID");
  }
}

function hashEvidence(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex");
}

function metaCode(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const error = (body as Record<string, unknown>).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return null;
  const code = (error as Record<string, unknown>).code;
  if ((typeof code === "number" && Number.isSafeInteger(code) && code >= 0) ||
      (typeof code === "string" && /^\d{1,12}$/.test(code))) {
    return String(code);
  }
  return null;
}

/**
 * Meta's Set Two-Step Verification Code endpoint is POST /{phone-number-id},
 * NOT /{phone-number-id}/register (which is for phone registration).
 *
 * A transport failure, timeout, unexpected response, or rate limit has an
 * UNCERTAIN outcome: the caller must not retry blindly or activate a PIN.
 */
export async function setMetaWhatsappTwoStepVerificationPin(
  input: MetaWhatsappPinRotationInput,
  deps: MetaWhatsappPinRotationDeps = {},
): Promise<MetaWhatsappPinRotationObservation> {
  requireInput(input);
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error("ZION_WHATSAPP_PIN_ROTATION_TIMEOUT_INVALID");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (deps.fetch ?? fetch)(
      `https://graph.facebook.com/${input.graphApiVersion}/${input.phoneNumberId}`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${input.accessToken}`,
        },
        body: JSON.stringify({ pin: input.newPin }),
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      },
    );

    const requestId = response.headers.get("x-fb-trace-id") ||
      response.headers.get("x-fb-request-id");
    let raw = "";
    try {
      raw = await response.text();
    } catch {
      // The remote call might have completed even if its body was unreadable.
      return { result: "uncertain", httpStatus: response.status, metaErrorCode: null,
        requestId, evidenceHash: null };
    }
    if (Buffer.byteLength(raw, "utf8") > MAX_RESPONSE_BYTES) {
      return { result: "uncertain", httpStatus: response.status, metaErrorCode: null,
        requestId, evidenceHash: null };
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return { result: "uncertain", httpStatus: response.status, metaErrorCode: null,
        requestId, evidenceHash: hashEvidence({ status: response.status, raw, requestId }) };
    }

    const evidenceHash = hashEvidence({ status: response.status, body, requestId });
    const successful = response.status >= 200 && response.status <= 299 &&
      body && typeof body === "object" && !Array.isArray(body) &&
      (body as Record<string, unknown>).success === true;
    if (successful) {
      return { result: "confirmed", httpStatus: response.status,
        metaErrorCode: null, requestId, evidenceHash };
    }

    const errorCode = metaCode(body);
    const rejected = [400, 401, 403].includes(response.status) && errorCode !== null;
    return {
      result: rejected ? "rejected" : "uncertain",
      httpStatus: response.status,
      metaErrorCode: errorCode,
      requestId,
      evidenceHash,
    };
  } catch {
    // A timeout/connection reset cannot prove that Meta did not apply the PIN.
    return { result: "uncertain", httpStatus: null,
      metaErrorCode: null, requestId: null, evidenceHash: null };
  } finally {
    clearTimeout(timeout);
  }
}
