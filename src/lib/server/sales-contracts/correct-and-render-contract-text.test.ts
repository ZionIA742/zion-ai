import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { extractTextFromFile } from "../onboarding-file-extractors";
import {
  ContractBuyerCorrectionError,
  correctAndRenderContractText,
} from "./correct-and-render-contract-text";

const originalText = [
  "CONTRATO DE PRESTACAO DE SERVICOS",
  "Nome: Ana Silva",
  "Telefone: (11) 99999-1111",
  "CPF: 111.222.333-44",
  "E-mail: ana@example.com",
  "Endereco: Rua das Flores, 10 - Sao Paulo",
  "",
  "CLAUSULA 1 - O preco total e R$ 10.000,00.",
  "CLAUSULA 2 - A entrega ocorrera em 30 dias.",
].join("\n");

const previousBuyer = {
  name: "Ana Silva",
  phone: "(11) 99999-1111",
  document: "111.222.333-44",
  email: "ana@example.com",
  address: "Rua das Flores, 10 - Sao Paulo",
};

test("nome corrigido aparece no PDF e os demais campos permanecem iguais", async () => {
  const result = await correctAndRenderContractText({
    originalText,
    previousBuyer,
    correctedBuyer: { ...previousBuyer, name: "Beatriz Costa" },
  });
  const extracted = await extractTextFromFile({
    fileName: "correcao.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(result.pdfBytes),
  });

  assert.match(extracted.text, /Nome: Beatriz Costa/);
  assert.doesNotMatch(extracted.text, /Nome: Ana Silva/);
  for (const value of Object.values(previousBuyer).slice(1)) assert.match(extracted.text, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
  assert.deepEqual(result.changedFields, ["name"]);
});

test("clausulas permanecem identicas e o texto original nao e modificado", async () => {
  const before = originalText;
  const result = await correctAndRenderContractText({
    originalText,
    previousBuyer,
    correctedBuyer: { ...previousBuyer, name: "Beatriz Costa" },
  });
  assert.equal(originalText, before);
  assert.equal(
    result.renderedText.slice(result.renderedText.indexOf("CLAUSULA")),
    originalText.slice(originalText.indexOf("CLAUSULA")),
  );
});

test("rejeita campo ambiguo sem gerar PDF", async () => {
  await assert.rejects(
    () => correctAndRenderContractText({
      originalText: `${originalText}\nNome: Ana Silva`,
      previousBuyer,
      correctedBuyer: { ...previousBuyer, name: "Beatriz Costa" },
    }),
    (error: unknown) => error instanceof ContractBuyerCorrectionError && error.code === "BUYER_FIELD_AMBIGUOUS",
  );
});

test("hash corresponde ao texto renderizado e ao PDF produzido", async () => {
  const result = await correctAndRenderContractText({
    originalText,
    previousBuyer,
    correctedBuyer: { ...previousBuyer, name: "Beatriz Costa" },
  });
  assert.equal(
    result.renderedTextSha256,
    createHash("sha256").update(Buffer.from(result.renderedText, "utf8")).digest("hex"),
  );
  assert.equal(
    result.pdfSha256,
    createHash("sha256").update(Buffer.from(result.pdfBytes)).digest("hex"),
  );
});

test("rejeita valor nao identificado sem substituir nome em clausula", async () => {
  await assert.rejects(
    () => correctAndRenderContractText({
      originalText: originalText.replace("Nome: Ana Silva", "CONTRATANTE: Ana Silva"),
      previousBuyer,
      correctedBuyer: { ...previousBuyer, name: "Beatriz Costa" },
    }),
    (error: unknown) => error instanceof ContractBuyerCorrectionError && error.code === "BUYER_FIELD_NOT_FOUND",
  );
});

console.log("ZION P9.9.15 correcao textual -> 5 testes focais definidos");
