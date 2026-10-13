import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  extractPdfTextWithParser,
  extractTextFromFile,
  PdfTextExtractionError,
  type PdfParserModule,
} from "./onboarding-file-extractors";

async function createPdf(text?: string) {
  const document = await PDFDocument.create();
  const page = document.addPage([420, 240]);

  if (text) {
    const font = await document.embedFont(StandardFonts.Helvetica);
    page.drawText(text, { x: 30, y: 180, size: 16, font, color: rgb(0, 0, 0) });
  }

  return Buffer.from(await document.save());
}

test("extracts text from a real PDF through the shared extractor", async () => {
  const buffer = await createPdf("texto selecionavel de teste");
  const result = await extractTextFromFile({
    fileName: "contrato-teste.pdf",
    mimeType: "application/pdf",
    buffer,
  });

  assert.match(result.text, /texto selecionavel de teste/);
});

test("classifies a PDF dependency loading failure without exposing internals", async () => {
  await assert.rejects(
    () => extractPdfTextWithParser(Buffer.from("pdf"), () => {
      throw new Error("private dependency path");
    }),
    (error: unknown) => {
      assert.ok(error instanceof PdfTextExtractionError);
      assert.equal(error.code, "PDF_READER_LOAD_FAILED");
      assert.equal(error.message, "Falha tecnica ao ler o PDF.");
      return true;
    },
  );
});

test("classifies getText failure without exposing the parser error", async () => {
  const parserModule: PdfParserModule = {
    PDFParse: class {
      async getText() {
        throw new Error("private parser details");
      }
      async destroy() {}
    },
  };

  await assert.rejects(
    () => extractPdfTextWithParser(Buffer.from("pdf"), () => parserModule),
    (error: unknown) => {
      assert.ok(error instanceof PdfTextExtractionError);
      assert.equal(error.code, "PDF_READER_PARSE_FAILED");
      assert.equal(error.message, "Falha tecnica ao ler o PDF.");
      return true;
    },
  );
});

test("preserves extracted text when destroy fails after getText", async () => {
  const parserModule: PdfParserModule = {
    PDFParse: class {
      async getText() {
        return { text: "texto ja extraido" };
      }
      async destroy() {
        throw new Error("private cleanup details");
      }
    },
  };

  const result = await extractPdfTextWithParser(Buffer.from("pdf"), () => parserModule);

  assert.equal(result.text, "texto ja extraido");
  assert.equal(result.warningCode, "PDF_READER_DESTROY_FAILED");
});

test("keeps a genuinely textless PDF as empty text", async () => {
  const buffer = await createPdf();
  const result = await extractTextFromFile({
    fileName: "contrato-vazio.pdf",
    mimeType: "application/pdf",
    buffer,
  });

  assert.equal(result.text, "");
});
