import { createHash } from "node:crypto";

export type CanonicalPayloadValue =
  | null
  | boolean
  | number
  | string
  | CanonicalPayloadValue[]
  | { [key: string]: CanonicalPayloadValue };

function assertCanonicalNumber(value: number) {
  if (!Number.isFinite(value)) {
    throw new TypeError("canonical_payload_v1 nao aceita numero nao finito");
  }

  if (Object.is(value, -0)) return "0";

  const serialized = String(value);
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(serialized)) {
    throw new TypeError("canonical_payload_v1 encontrou numero invalido");
  }

  return serialized.toLowerCase();
}

function escapeCanonicalString(value: string) {
  let output = '"';

  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint >= 0xd800 && codePoint <= 0xdfff) {
      throw new TypeError("canonical_payload_v1 nao aceita surrogate isolado");
    }

    switch (character) {
      case '"': output += "\\\""; break;
      case "\\": output += "\\\\"; break;
      case "\b": output += "\\b"; break;
      case "\f": output += "\\f"; break;
      case "\n": output += "\\n"; break;
      case "\r": output += "\\r"; break;
      case "\t": output += "\\t"; break;
      default:
        if (codePoint < 0x20) {
          output += `\\u${codePoint.toString(16).padStart(4, "0")}`;
        } else {
          output += character;
        }
    }
  }

  return `${output}"`;
}

export function canonicalizePayloadV1(value: CanonicalPayloadValue): string {
  if (value === null) return "null";
  if (typeof value === "string") return escapeCanonicalString(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return assertCanonicalNumber(value);

  if (Array.isArray(value)) {
    return `[${value.map(canonicalizePayloadV1).join(",")}]`;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("canonical_payload_v1 nao aceita objeto nao simples");
  }

  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${escapeCanonicalString(key)}:${canonicalizePayloadV1(value[key])}`).join(",")}}`;
}

export function sha256CanonicalPayloadV1(value: CanonicalPayloadValue) {
  const canonicalPayload = canonicalizePayloadV1(value);
  return {
    canonicalPayload,
    fingerprint: createHash("sha256").update(Buffer.from(canonicalPayload, "utf8")).digest("hex"),
  };
}

export function withoutVolatileQuoteSnapshotFields(value: Record<string, unknown>) {
  const snapshot = { ...value };
  delete snapshot.generatedAt;
  delete snapshot.generationError;
  return snapshot as CanonicalPayloadValue;
}
