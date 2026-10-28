import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * Isolated, non-persisting renderer for a manually reviewed contract text draft.
 * Does not create a canonical contract version, store a file, or send messages.
 *
 * Fail closed if a character cannot be represented by the embedded font:
 * never silently drop or replace contractual text.
 */
export const MAX_CONTRACT_TEXT_DRAFT_CHARS = 300_000;

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 48;
const MARGIN_TOP = 52;
const MARGIN_BOTTOM = 48;
const FONT_SIZE = 11;
const LINE_HEIGHT = 17;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN_X;

export class ContractTextDraftPdfError extends Error {
  constructor(
    public readonly code: "EMPTY_TEXT" | "TEXT_TOO_LONG" | "UNSUPPORTED_CHARACTER" | "CONTROL_CHARACTER",
    message: string,
  ) {
    super(message);
    this.name = "ContractTextDraftPdfError";
  }
}

export type BuildContractTextDraftPdfInput = {
  /** Exact text already saved for the authorized opportunity/revision. */
  text: string;
};

function validateText(text: string): string {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new ContractTextDraftPdfError("EMPTY_TEXT", "O rascunho do contrato esta vazio.");
  }
  if (text.length > MAX_CONTRACT_TEXT_DRAFT_CHARS) {
    throw new ContractTextDraftPdfError("TEXT_TOO_LONG", "O texto do contrato excede o limite permitido.");
  }
  // The PDF renderer must never render untrusted control characters silently.
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text)) {
    throw new ContractTextDraftPdfError("CONTROL_CHARACTER", "O rascunho contem caracteres de controle nao imprimiveis.");
  }
  return text.replace(/\r\n?/gu, "\n");
}

function ensureSupportedGlyphs(font: PDFFont, text: string): void {
  // PDF's standard Helvetica font can represent common Portuguese accents,
  // but not all Unicode characters. Reject any unrepresentable character.
  try {
    font.encodeText(text.replace(/[\n\t]/gu, ""));
  } catch {
    throw new ContractTextDraftPdfError(
      "UNSUPPORTED_CHARACTER",
      "O contrato contem caracteres que a fonte atual do PDF nao consegue representar. Nenhum caractere foi omitido; a geracao foi interrompida.",
    );
  }
}

/**
 * Render the full text, preserving its source order and explicit line breaks.
 * Layout wraps long lines visually; it never invents clauses or substitutes data.
 * Tabs are displayed as four spaces (the original source text is not mutated).
 */
export async function buildContractTextDraftPdf(
  input: BuildContractTextDraftPdfInput,
): Promise<Uint8Array> {
  const text = validateText(input.text);
  const pdf = await PDFDocument.create();
  pdf.setCreator("ZION");
  pdf.setProducer("ZION");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  ensureSupportedGlyphs(font, text);

  let page: PDFPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN_TOP;

  function nextPageIfNeeded(): void {
    if (y - FONT_SIZE < MARGIN_BOTTOM) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN_TOP;
    }
  }

  function drawLine(line: string): void {
    nextPageIfNeeded();
    if (line.length > 0) {
      page.drawText(line, {
        x: MARGIN_X,
        y,
        font,
        size: FONT_SIZE,
        color: rgb(0.12, 0.15, 0.19),
      });
    }
    y -= LINE_HEIGHT;
  }

  for (const sourceLine of text.split("\n")) {
    const visualLine = sourceLine.replace(/\t/gu, "    ");
    if (visualLine.length === 0) {
      drawLine("");
      continue;
    }

    // Prefer word boundaries without dropping or rearranging source characters.
    // Preserve whitespace rather than silently trimming contractual text.
    let current = "";
    for (const segment of visualLine.match(/\s+|\S+/gu) ?? []) {
      const candidate = current + segment;
      if (font.widthOfTextAtSize(candidate, FONT_SIZE) <= CONTENT_WIDTH) {
        current = candidate;
        continue;
      }

      const isWord = /^\S/u.test(segment);
      if (isWord && current.length > 0) {
        drawLine(current);
        current = "";
      }

      // Split characters only for oversized words or whitespace runs.
      for (const character of segment) {
        const next = current + character;
        if (current.length > 0 && font.widthOfTextAtSize(next, FONT_SIZE) > CONTENT_WIDTH) {
          drawLine(current);
          current = character;
        } else {
          current = next;
        }
      }
    }
    drawLine(current);
  }

  return pdf.save();
}
