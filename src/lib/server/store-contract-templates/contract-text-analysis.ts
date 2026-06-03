import { extractTextFromFile } from "@/lib/server/onboarding-file-extractors";

function cleanInlineText(value: string) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildContractAnalysisSummary(text: string) {
  const normalized = cleanInlineText(text);
  if (!normalized) {
    return "Nao foi possivel identificar texto legivel nesse arquivo.";
  }

  const lineCount = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length;
  const characterCount = normalized.length;
  const preview = normalized.slice(0, 220).replace(/\n+/g, " ");

  return `Texto lido com ${characterCount} caracteres e ${lineCount} linhas. Trecho inicial: ${preview}`;
}

export async function extractContractTextFromStoredFile(args: {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}) {
  const extracted = await extractTextFromFile({
    fileName: args.fileName,
    mimeType: args.mimeType,
    buffer: args.buffer,
  });

  const text = cleanInlineText(extracted.text || "");

  return {
    text,
    summary: buildContractAnalysisSummary(text),
  };
}
