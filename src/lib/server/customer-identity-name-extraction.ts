export type CustomerIdentityNameExtractionResult =
  | {
      ok: true;
      displayName: string;
    }
  | {
      ok: false;
      reason: "empty" | "no_high_confidence_self_declaration" | "invalid_name";
    };

const SELF_DECLARATION_PATTERNS = [
  /\bmeu\s+nome\s+(?:e|eh|é)\s+(.+)/iu,
  /\bme\s+chamo\s+(.+)/iu,
  /\bsou\s+(?:o|a)\s+(.+)/iu,
  /\baqui\s+(?:e|eh|é)\s+(?:o|a)\s+(.+)/iu,
];

const THIRD_PERSON_PATTERNS = [
  /\bmeu\s+(?:marido|esposo|pai|filho|irmao|irmão|socio|sócio)\s+(?:e|eh|é)\b/iu,
  /\bminha\s+(?:esposa|mae|mãe|filha|irma|irmã|socia|sócia)\s+(?:e|eh|é)\b/iu,
  /\bfale\s+com\s+(?:o|a)?\s*[\p{L}]/iu,
  /\borcamento\s+(?:e|eh|é|para)\s+(?:para\s+)?(?:o|a)?\s*[\p{L}]/iu,
  /\borçamento\s+(?:e|eh|é|para)\s+(?:para\s+)?(?:o|a)?\s*[\p{L}]/iu,
  /\bcoloca\s+no\s+nome\s+(?:do|da|de)?\s*[\p{L}]/iu,
  /\bresponsavel\s+(?:e|eh|é)\s+[\p{L}]/iu,
  /\bresponsável\s+(?:e|eh|é)\s+[\p{L}]/iu,
];

const INVALID_NAME_WORDS = new Set([
  "cliente",
  "whatsapp",
  "orcamento",
  "orçamento",
  "piscina",
  "visita",
  "instalacao",
  "instalação",
  "pagamento",
  "pix",
  "dono",
  "dona",
  "casa",
  "proprietario",
  "proprietaria",
  "imovel",
  "tecnico",
  "tecnica",
  "vendedor",
  "atendente",
  "obra",
  "responsavel",
  "responsável",
]);

function normalizeSpacing(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function trimCapturedName(value: string) {
  const withoutTail = String(value || "")
    .split(/[.!?,;:\n\r]/, 1)[0]
    .replace(/\b(?:tenho|quero|preciso|para|sobre|e|mas)\b.*$/iu, "");

  return normalizeSpacing(withoutTail).normalize("NFC");
}

function isValidDeclaredName(value: string) {
  const name = normalizeSpacing(value);
  if (name.length < 2 || name.length > 80) return false;
  if (!/^[\p{L}][\p{L}\p{M}' -]*$/u.test(name)) return false;

  const parts = name.split(" ").filter(Boolean);
  if (parts.length > 5) return false;

  return parts.every((part) => {
    const normalized = part
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return normalized.length >= 2 && !INVALID_NAME_WORDS.has(normalized);
  });
}

export function extractCustomerSelfDeclaredName(
  message: string | null | undefined,
): CustomerIdentityNameExtractionResult {
  const text = normalizeSpacing(String(message || ""));
  if (!text) return { ok: false, reason: "empty" };

  if (THIRD_PERSON_PATTERNS.some((pattern) => pattern.test(text))) {
    return { ok: false, reason: "no_high_confidence_self_declaration" };
  }

  for (const pattern of SELF_DECLARATION_PATTERNS) {
    const match = pattern.exec(text);
    if (!match?.[1]) continue;

    const displayName = trimCapturedName(match[1]);
    if (!isValidDeclaredName(displayName)) {
      return { ok: false, reason: "invalid_name" };
    }

    return { ok: true, displayName };
  }

  return { ok: false, reason: "no_high_confidence_self_declaration" };
}

export function buildCustomerIdentityNameOperationKey(sourceMessageId: string) {
  return `p9_identity_name_v1:${String(sourceMessageId || "").trim()}`;
}
