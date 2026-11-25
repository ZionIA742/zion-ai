import { createHash } from "node:crypto";

export type HumanQuoteSendRecipient =
  | { kind: "lead"; leadId: string }
  | { kind: "phone"; phone: string }
  | { kind: "responsible" };

export type HumanQuoteSendRequest = {
  operationId: string;
  quoteVersionId: string;
  recipient: HumanQuoteSendRecipient;
};

export type HumanQuoteSendAuthorityScope = {
  organizationId: string;
  storeId: string;
  actorUserId: string;
  quoteId: string;
};

export class HumanQuoteSendContractError extends Error {
  readonly status = 400;

  constructor(readonly code: string) {
    super(code);
    this.name = "HumanQuoteSendContractError";
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(code: string): never {
  throw new HumanQuoteSendContractError(code);
}

function uuid(value: unknown, code: string): string {
  if (
    typeof value !== "string" ||
    !UUID_PATTERN.test(value.trim()) ||
    value.trim() === "00000000-0000-0000-0000-000000000000"
  ) {
    return fail(code);
  }

  return value.trim().toLowerCase();
}

function record(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
  ) {
    return fail("HUMAN_QUOTE_SEND_INVALID_OBJECT");
  }

  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  const actual = Object.keys(value);

  if (
    actual.length !== expected.length ||
    !expected.every(
      (key) => Object.prototype.hasOwnProperty.call(value, key),
    )
  ) {
    fail("HUMAN_QUOTE_SEND_UNEXPECTED_FIELDS");
  }
}

export function normalizeHumanQuoteSendPhone(
  input: unknown,
): string {
  if (typeof input !== "string") {
    return fail("HUMAN_QUOTE_SEND_PHONE_INVALID");
  }

  const raw = input.trim();

  if (
    !raw ||
    raw.length > 40 ||
    !/^\+?[0-9 ()-]+$/.test(raw)
  ) {
    return fail("HUMAN_QUOTE_SEND_PHONE_INVALID");
  }

  let digits = raw.replace(/\D/g, "");

  if (raw.startsWith("+")) {
    if (!/^[1-9][0-9]{7,14}$/.test(digits)) {
      return fail("HUMAN_QUOTE_SEND_PHONE_INVALID");
    }
  } else if (/^[1-9][0-9]{9,10}$/.test(digits)) {
    digits = "55" + digits;
  } else if (!/^55[1-9][0-9]{9,10}$/.test(digits)) {
    return fail("HUMAN_QUOTE_SEND_PHONE_COUNTRY_CODE_REQUIRED");
  }

  if (
    digits.startsWith("55") &&
    !/^55[1-9][0-9]{9,10}$/.test(digits)
  ) {
    return fail("HUMAN_QUOTE_SEND_PHONE_INVALID");
  }

  // Preserve explicit international identity across validation passes.
  return "+" + digits;
}

export function parseHumanQuoteSendRequest(
  input: unknown,
): HumanQuoteSendRequest {
  const body = record(input);

  exactKeys(body, [
    "operationId",
    "quoteVersionId",
    "recipient",
  ]);

  const operationId = uuid(
    body.operationId,
    "HUMAN_QUOTE_SEND_OPERATION_ID_REQUIRED",
  );

  const quoteVersionId = uuid(
    body.quoteVersionId,
    "HUMAN_QUOTE_SEND_VERSION_REQUIRED",
  );

  const recipient = record(body.recipient);

  if (recipient.kind === "lead") {
    exactKeys(recipient, ["kind", "leadId"]);

    return {
      operationId,
      quoteVersionId,
      recipient: {
        kind: "lead",
        leadId: uuid(
          recipient.leadId,
          "HUMAN_QUOTE_SEND_LEAD_REQUIRED",
        ),
      },
    };
  }

  if (recipient.kind === "phone") {
    exactKeys(recipient, ["kind", "phone"]);

    return {
      operationId,
      quoteVersionId,
      recipient: {
        kind: "phone",
        phone: normalizeHumanQuoteSendPhone(recipient.phone),
      },
    };
  }

  if (recipient.kind === "responsible") {
    exactKeys(recipient, ["kind"]);

    return {
      operationId,
      quoteVersionId,
      recipient: { kind: "responsible" },
    };
  }

  return fail("HUMAN_QUOTE_SEND_RECIPIENT_KIND_INVALID");
}

function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

export function buildHumanQuoteSendIdentity(
  authorityScope: HumanQuoteSendAuthorityScope,
  input: HumanQuoteSendRequest,
): {
  operationKey: string;
  requestFingerprint: string;
} {
  const scope = {
    organizationId: uuid(
      authorityScope.organizationId,
      "HUMAN_QUOTE_SEND_ORGANIZATION_REQUIRED",
    ),
    storeId: uuid(
      authorityScope.storeId,
      "HUMAN_QUOTE_SEND_STORE_REQUIRED",
    ),
    actorUserId: uuid(
      authorityScope.actorUserId,
      "HUMAN_QUOTE_SEND_ACTOR_REQUIRED",
    ),
    quoteId: uuid(
      authorityScope.quoteId,
      "HUMAN_QUOTE_SEND_QUOTE_REQUIRED",
    ),
  };

  const request = parseHumanQuoteSendRequest(input);

  // The same operation ID must not silently become
  // a different quote, version or recipient.
  const operationKey =
    "human_quote_send:v1:" +
    fingerprint([
      scope.organizationId,
      scope.storeId,
      scope.actorUserId,
      request.operationId,
    ]);

  const requestFingerprint = fingerprint([
    "human_quote_send:v1",
    scope,
    request.quoteVersionId,
    request.recipient,
  ]);

  return { operationKey, requestFingerprint };
}
