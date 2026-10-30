import { createHash } from "node:crypto";
import { buildContractTextDraftPdf } from "./build-contract-text-draft-pdf";

export type ContractBuyerData = {
  name?: string | null;
  phone?: string | null;
  document?: string | null;
  email?: string | null;
  address?: string | null;
};

export type CorrectAndRenderContractTextResult = {
  /** Text after only the verified buyer-field replacements, normalized for rendering. */
  renderedText: string;
  pdfBytes: Uint8Array;
  renderedTextSha256: string;
  pdfSha256: string;
  changedFields: Array<keyof ContractBuyerData>;
};

export type ContractBuyerCorrectionErrorCode =
  | "INVALID_BUYER_DATA"
  | "BUYER_FIELD_NOT_FOUND"
  | "BUYER_FIELD_AMBIGUOUS"
  | "BUYER_FIELD_VALUE_MISMATCH";

export class ContractBuyerCorrectionError extends Error {
  constructor(
    public readonly code: ContractBuyerCorrectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ContractBuyerCorrectionError";
  }
}

type BuyerField = keyof ContractBuyerData;

const FIELD_LABELS: Record<BuyerField, RegExp> = {
  name: /^(?:nome(?:\s+completo)?|comprador)$/iu,
  phone: /^(?:telefone|celular|fone)$/iu,
  document: /^(?:cpf\s*\/\s*cnpj|cpf|cnpj|documento)$/iu,
  email: /^(?:e-?mail)$/iu,
  address: /^(?:endere[cç]o|endereco|resid[eê]ncia|residencia)$/iu,
};

const FIELD_ORDER: BuyerField[] = ["name", "phone", "document", "email", "address"];

function fail(code: ContractBuyerCorrectionErrorCode, message: string): never {
  throw new ContractBuyerCorrectionError(code, message);
}

function normalizedRenderedText(text: string): string {
  return text.replace(/\r\n?/gu, "\n");
}

function hash(value: Uint8Array | string): string {
  return createHash("sha256")
    .update(typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value))
    .digest("hex");
}

function changedFields(previous: ContractBuyerData, corrected: ContractBuyerData): BuyerField[] {
  return FIELD_ORDER.filter((field) => {
    const oldValue = previous[field];
    const newValue = corrected[field];
    if (oldValue == null && newValue == null) return false;
    if (typeof oldValue !== "string" || typeof newValue !== "string") {
      fail("INVALID_BUYER_DATA", "Os dados anterior e corrigido do comprador devem ser textos.");
    }
    if (newValue.trim().length === 0) {
      fail("INVALID_BUYER_DATA", "Um campo corrigido do comprador esta vazio.");
    }
    return oldValue !== newValue;
  });
}

function replaceBuyerField(
  lines: string[],
  field: BuyerField,
  previousValue: string,
  correctedValue: string,
): void {
  const matches: Array<{ index: number; prefix: string; value: string; suffix: string }> = [];

  lines.forEach((line, index) => {
    const separator = line.match(/^(\s*)([^:]+?)(\s*:\s*)(.*?)(\s*)$/u);
    if (!separator || !FIELD_LABELS[field].test(separator[2].trim())) return;
    matches.push({
      index,
      prefix: `${separator[1]}${separator[2]}${separator[3]}`,
      value: separator[4],
      suffix: separator[5],
    });
  });

  if (matches.length === 0) {
    fail("BUYER_FIELD_NOT_FOUND", `O campo cadastral ${field} nao foi identificado no texto.`);
  }
  if (matches.length !== 1) {
    fail("BUYER_FIELD_AMBIGUOUS", `O campo cadastral ${field} aparece mais de uma vez no texto.`);
  }

  const match = matches[0];
  if (match.value.trim() !== previousValue) {
    fail("BUYER_FIELD_VALUE_MISMATCH", `O valor anterior do campo cadastral ${field} nao confere com o texto.`);
  }
  const leadingWhitespaceLength = match.value.length - match.value.trimStart().length;
  const leadingWhitespace = match.value.slice(0, leadingWhitespaceLength);
  lines[match.index] = `${match.prefix}${leadingWhitespace}${correctedValue}${match.suffix}`;
}

/**
 * Corrects only uniquely identified, labelled buyer fields and renders the
 * resulting text with the canonical text PDF builder. This function is pure
 * with respect to the supplied text and performs no persistence or logging.
 */
export async function correctAndRenderContractText(args: {
  originalText: string;
  previousBuyer: ContractBuyerData;
  correctedBuyer: ContractBuyerData;
}): Promise<CorrectAndRenderContractTextResult> {
  if (typeof args?.originalText !== "string") {
    fail("INVALID_BUYER_DATA", "O texto original do contrato e invalido.");
  }

  const originalText = normalizedRenderedText(args.originalText);
  const lines = originalText.split("\n");
  const fields = changedFields(args.previousBuyer, args.correctedBuyer);

  for (const field of fields) {
    replaceBuyerField(
      lines,
      field,
      args.previousBuyer[field] as string,
      args.correctedBuyer[field] as string,
    );
  }

  const renderedText = lines.join("\n");
  const pdfBytes = await buildContractTextDraftPdf({ text: renderedText });
  return {
    renderedText,
    pdfBytes,
    renderedTextSha256: hash(renderedText),
    pdfSha256: hash(pdfBytes),
    changedFields: fields,
  };
}
