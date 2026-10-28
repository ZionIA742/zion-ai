import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import test from "node:test";
import type { ContractTextDraftSource } from "./contract-text-draft-source";
import { ContractTextDraftPdfError } from "./build-contract-text-draft-pdf";
import { renderContractTextDraftVersion } from "./render-contract-text-draft-version";

const text = "CONTRATO DE TESTE\r\nCláusula 1 - Valor: R$ 10,00.";

function sha256Text(value: string): string {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

const draft: ContractTextDraftSource = {
  draftId: "draft-1",
  organizationId: "org-1",
  storeId: "store-1",
  commercialOpportunityId: "opportunity-1",
  templateVersionId: "template-version-1",
  revision: 7,
  text,
  sha256: sha256Text(text),
};

test("gera um PDF real e proveniência dos mesmos bytes e texto", async () => {
  const result = await renderContractTextDraftVersion(draft);
  const document = await PDFDocument.load(result.pdfBytes);

  assert.ok(result.pdfBytes.byteLength > 500);
  assert.equal(document.getPageCount(), 1);
  assert.equal(
    result.pdfSha256,
    createHash("sha256").update(result.pdfBytes).digest("hex"),
  );
  assert.equal(result.textSha256, sha256Text(text));
  assert.equal(result.provenance.pdf_sha256, result.pdfSha256);
  assert.equal(result.provenance.text_sha256, result.textSha256);
  assert.equal(result.provenance.mode, "saved_text_draft");
  assert.equal(result.provenance.text_representation, "persisted_text_utf8_exact");
  assert.equal(result.provenance.rendered_text_representation, "line_endings_normalized_to_lf");
});

test("preserva revisão e identidade do resolver", async () => {
  const result = await renderContractTextDraftVersion(draft);

  assert.deepEqual(result.provenance, {
    mode: "saved_text_draft",
    draft_id: "draft-1",
    organization_id: "org-1",
    store_id: "store-1",
    commercial_opportunity_id: "opportunity-1",
    template_version_id: "template-version-1",
    revision: 7,
    text_sha256: draft.sha256,
    pdf_sha256: result.pdfSha256,
    text_representation: "persisted_text_utf8_exact",
    rendered_text_representation: "line_endings_normalized_to_lf",
  });
});

test("falha quando o texto mudou mas o hash antigo foi mantido", async () => {
  await assert.rejects(
    () =>
      renderContractTextDraftVersion({
        ...draft,
        text: `${draft.text} alterado`,
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "ContractTextDraftVersionProvenanceError" &&
      (error as Error & { code?: string }).code === "DRAFT_TEXT_HASH_MISMATCH",
  );
});

test("propaga falha de caractere não suportado sem resultado parcial", async () => {
  await assert.rejects(
    () =>
      renderContractTextDraftVersion({
        ...draft,
        text: "Contrato 😀",
        sha256: sha256Text("Contrato 😀"),
      }),
    (error: unknown) => error instanceof ContractTextDraftPdfError && error.code === "UNSUPPORTED_CHARACTER",
  );
});

test("não modifica a origem recebida e não acessa efeitos externos", async () => {
  const sourceBefore = structuredClone(draft);
  const result = await renderContractTextDraftVersion(draft);

  assert.deepEqual(draft, sourceBefore);
  assert.ok(result.pdfBytes instanceof Uint8Array);
  assert.equal(result.provenance.draft_id, draft.draftId);
});
