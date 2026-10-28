import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import {
  buildContractTextDraftPdf,
  ContractTextDraftPdfError,
  MAX_CONTRACT_TEXT_DRAFT_CHARS,
} from "./build-contract-text-draft-pdf";

async function expectError(text: string, code: ContractTextDraftPdfError["code"]) {
  await assert.rejects(
    () => buildContractTextDraftPdf({ text }),
    (error: unknown) => error instanceof ContractTextDraftPdfError && error.code === code,
  );
}

async function run() {
  const draft = "CONTRATO DE TESTE\nClausula 01 - Preco: R$ 28.500,00\nEntrega em Sao Paulo — revisão humana.\nNAO ENVIAR";
  const copy = draft;
  const bytes = await buildContractTextDraftPdf({ text: draft });
  const document = await PDFDocument.load(bytes);
  assert.ok(bytes.byteLength > 500, "PDF deve conter bytes reais");
  assert.equal(document.getPageCount(), 1, "Documento curto deve caber em uma pagina");
  assert.equal(draft, copy, "O texto de entrada nao deve ser alterado");

  const longDraft = Array.from({ length: 180 }, (_, i) => `Clausula ${i + 1}: teste com acentuacao: ação, revisão, preço.`).join("\n");
  const longPdf = await PDFDocument.load(await buildContractTextDraftPdf({ text: longDraft }));
  assert.ok(longPdf.getPageCount() >= 2, "Contrato longo deve ser paginado");

  const veryLongLine = "ABC ".repeat(300);
  const wrappedPdf = await PDFDocument.load(await buildContractTextDraftPdf({ text: veryLongLine }));
  assert.equal(wrappedPdf.getPageCount(), 1, "Linha longa deve quebrar sem transbordar da pagina");

  await expectError("", "EMPTY_TEXT");
  await expectError(" \n\t ", "EMPTY_TEXT");
  await expectError("X".repeat(MAX_CONTRACT_TEXT_DRAFT_CHARS + 1), "TEXT_TOO_LONG");
  await expectError("Contrato\u0000teste", "CONTROL_CHARACTER");
  await expectError("Contrato 😀", "UNSUPPORTED_CHARACTER");

  console.log("ZION P9 contrato texto -> PDF isolado: 10/10 PASS; sem escrita ou envio");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
