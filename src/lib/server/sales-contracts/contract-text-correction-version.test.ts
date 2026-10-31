import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildContractTextDraftPdf } from "./build-contract-text-draft-pdf";
import { prepareContractTextCorrectionVersion } from "./contract-text-correction-version";

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

async function run() {
  const originalText = "CONTRATO HISTORICO\nNome: Cliente Original\nClausula 1 - Valor: R$ 10.000,00\nClausula 2 - Entrega em 30 dias.";
  const correctedText = originalText.replace("Cliente Original", "Cliente Corrigido");
  const previousPdfSha256 = sha256(await buildContractTextDraftPdf({ text: originalText }));
  const previousSnapshot = {
    schema: "sales_contract_snapshot_v1",
    identity: { contract_id: "contract-1" },
    renderer_input: { customer: { name: "Cliente Original" } },
    content_fingerprint: "a".repeat(64),
    text_provenance: {
      draft_id: "draft-1",
      revision: 4,
      template_version_id: "template-1",
      text_sha256: sha256(originalText),
      pdf_sha256: previousPdfSha256,
      text_representation: "saved_text_draft_utf8_exact",
    },
  };
  const copy = structuredClone(previousSnapshot);
  const result = await prepareContractTextCorrectionVersion({
    previousSnapshot,
    previousVersionId: "version-1",
    previousPdfSha256,
    actorUserId: "user-1",
    originalText,
    correctedText,
  });

  assert.deepEqual(previousSnapshot, copy, "snapshot historico nao deve ser modificado");
  assert.equal(result.correctedTextSha256, sha256(correctedText));
  assert.equal(result.pdfSha256, sha256(result.pdfBytes));
  assert.equal(result.correctedSnapshot.text_provenance.text_sha256, result.correctedTextSha256);
  assert.equal(result.correctedSnapshot.text_provenance.pdf_sha256, result.pdfSha256);
  assert.equal(result.correctedSnapshot.text_correction.kind, "full_text");
  assert.notEqual(result.correctedTextSha256, previousSnapshot.text_provenance.text_sha256);
  assert.ok(result.pdfBytes.byteLength > 500);

  await assert.rejects(
    () => prepareContractTextCorrectionVersion({
      previousSnapshot,
      previousVersionId: "version-1",
      previousPdfSha256,
      actorUserId: "user-1",
      originalText: "texto divergente",
      correctedText,
    }),
    /nao corresponde/i,
  );
  console.log("P9 correcao textual -> PDF e hashes: 9/9 PASS");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
