import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  prepareContractTextDraftVersionProvenance,
  ContractTextDraftVersionProvenanceError,
} from "./contract-text-draft-version-provenance";
import type { ContractTextDraftSource } from "./contract-text-draft-source";

const text = "Cláusula 1\r\nValor: R$ 10,00.";
const pdfBytes = new Uint8Array([37, 80, 68, 70, 45, 49]);

function textSha256(value: string): string {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

const draft: ContractTextDraftSource = {
  draftId: "draft-1",
  organizationId: "org-1",
  storeId: "store-1",
  commercialOpportunityId: "opportunity-1",
  templateVersionId: "template-version-1",
  revision: 4,
  text,
  sha256: textSha256(text),
};

function expectCode(code: ContractTextDraftVersionProvenanceError["code"], action: () => unknown): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof ContractTextDraftVersionProvenanceError);
    assert.equal(error.code, code);
    return true;
  });
}

test("prepara proveniencia válida sem afirmar identidade entre texto e renderização", () => {
  const result = prepareContractTextDraftVersionProvenance({ draft, pdfBytes });

  assert.deepEqual(result.provenance, {
    mode: "saved_text_draft",
    draft_id: "draft-1",
    organization_id: "org-1",
    store_id: "store-1",
    commercial_opportunity_id: "opportunity-1",
    template_version_id: "template-version-1",
    revision: 4,
    text_sha256: draft.sha256,
    pdf_sha256: createHash("sha256").update(pdfBytes).digest("hex"),
    text_representation: "persisted_text_utf8_exact",
    rendered_text_representation: "line_endings_normalized_to_lf",
  });
});

test("detecta alteração no texto quando o hash recebido ficou obsoleto", () => {
  expectCode("DRAFT_TEXT_HASH_MISMATCH", () =>
    prepareContractTextDraftVersionProvenance({
      draft: { ...draft, text: `${draft.text} alterado` },
      pdfBytes,
    }),
  );
});

test("preserva e valida a revisão exata recebida", () => {
  const result = prepareContractTextDraftVersionProvenance({
    draft: { ...draft, revision: 9 },
    pdfBytes,
  });
  assert.equal(result.provenance.revision, 9);
  expectCode("INVALID_DRAFT_SOURCE", () =>
    prepareContractTextDraftVersionProvenance({
      draft: { ...draft, revision: 0 },
      pdfBytes,
    }),
  );
});

test("rejeita hash divergente informado pelo resolver", () => {
  expectCode("DRAFT_TEXT_HASH_MISMATCH", () =>
    prepareContractTextDraftVersionProvenance({
      draft: { ...draft, sha256: "0".repeat(64) },
      pdfBytes,
    }),
  );
});

test("rejeita PDF vazio", () => {
  expectCode("PDF_BYTES_INVALID", () =>
    prepareContractTextDraftVersionProvenance({ draft, pdfBytes: new Uint8Array() }),
  );
});

test("o resultado e determinístico e não modifica as entradas", () => {
  const sourceBefore = structuredClone(draft);
  const bytesBefore = Array.from(pdfBytes);
  const first = prepareContractTextDraftVersionProvenance({ draft, pdfBytes });
  const second = prepareContractTextDraftVersionProvenance({ draft, pdfBytes });

  assert.deepEqual(first, second);
  assert.deepEqual(draft, sourceBefore);
  assert.deepEqual(Array.from(pdfBytes), bytesBefore);
});
