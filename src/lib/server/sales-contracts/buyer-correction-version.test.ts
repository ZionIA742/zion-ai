import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildContractTextDraftPdf } from "./build-contract-text-draft-pdf";
import { HistoricalContractTextError, prepareBuyerCorrectionVersion, readHistoricalContractText } from "./buyer-correction-version";
import { ContractBuyerCorrectionError } from "./correct-and-render-contract-text";

const buyer = {
  name: "Ana Silva",
  phone: "11999999999",
  document: "12345678900",
  email: "ana@example.com",
  address: "Rua A, 10",
};

function hash(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function draftReaderSupabase(row: Record<string, unknown> | null) {
  return {
    from(table: string) {
      assert.equal(table, "sales_contract_text_drafts");
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        async maybeSingle() { return { data: row, error: null }; },
      };
      return builder;
    },
  };
}

test("recupera texto historico somente com revisao, escopo e hash exatos", async () => {
  const text = "Nome: Ana Silva\nCLAUSULA 1: Fixa";
  const result = await readHistoricalContractText({
    supabase: draftReaderSupabase({ id: "draft-1", organization_id: "org-1", store_id: "store-1", commercial_opportunity_id: "opp-1", template_version_id: "template-1", draft_text: text, revision: 4 }) as never,
    draftId: "draft-1", revision: 4, expectedSha256: hash(text), organizationId: "org-1", storeId: "store-1", commercialOpportunityId: "opp-1", templateVersionId: "template-1",
  });
  assert.equal(result, text);
});

test("rejeita revisao ou escopo historico divergente", async () => {
  const text = "Nome: Ana Silva";
  await assert.rejects(
    () => readHistoricalContractText({
      supabase: draftReaderSupabase({ id: "draft-1", organization_id: "other-org", store_id: "store-1", commercial_opportunity_id: "opp-1", template_version_id: "template-1", draft_text: text, revision: 3 }) as never,
      draftId: "draft-1", revision: 4, expectedSha256: hash(text), organizationId: "org-1", storeId: "store-1", commercialOpportunityId: "opp-1", templateVersionId: "template-1",
    }),
    (error: unknown) => error instanceof HistoricalContractTextError && error.code === "REVISION_MISMATCH" || error instanceof HistoricalContractTextError && error.code === "SCOPE_MISMATCH",
  );
});

test("rejeita rascunho historico alterado pelo hash", async () => {
  await assert.rejects(
    () => readHistoricalContractText({
      supabase: draftReaderSupabase({ id: "draft-1", organization_id: "org-1", store_id: "store-1", commercial_opportunity_id: "opp-1", template_version_id: "template-1", draft_text: "texto alterado", revision: 4 }) as never,
      draftId: "draft-1", revision: 4, expectedSha256: hash("texto original"), organizationId: "org-1", storeId: "store-1", commercialOpportunityId: "opp-1", templateVersionId: "template-1",
    }),
    (error: unknown) => error instanceof HistoricalContractTextError && error.code === "HASH_MISMATCH",
  );
});

test("prepara snapshot e PDF corrigidos sem alterar clausulas", async () => {
  const originalText = [
    "Nome: Ana Silva",
    "Telefone: 11999999999",
    "CPF: 12345678900",
    "E-mail: ana@example.com",
    "Endereco: Rua A, 10",
    "",
    "CLAUSULA 1: O valor e irrevogavel.",
  ].join("\n");
  const previousPdf = await buildContractTextDraftPdf({ text: originalText });
  const snapshot = {
    schema: "zion.sales_contract_snapshot.v2",
    identity: { contract_id: "contract-1", organization_id: "org-1", store_id: "store-1" },
    lineage: { quote_id: null, quote_version_id: null, commercial_opportunity_id: "opp-1", proposal_acceptance_event_id: null },
    template_authority: { template_id: "template-1", template_version_id: "template-version-1", template_version_number: 1, rules: [] },
    renderer_input: { identity: {}, customer: { leadId: "lead-1", ...buyer }, commercialTerms: { payment: "A vista" }, values: { totalCents: 10 }, items: [], templateAuthority: { clauses: "CLAUSULA 1" } },
    content_fingerprint: "a".repeat(64),
    materialized_at: "2026-10-30T00:00:00.000Z",
    origin: { source: "responsible_text_draft", commercial_amounts_authoritative: false },
    text_provenance: {
      mode: "saved_text_draft", draft_id: "draft-1", organization_id: "org-1", store_id: "store-1", commercial_opportunity_id: "opp-1", template_version_id: "template-version-1", revision: 1,
      text_sha256: hash(originalText), pdf_sha256: hash(previousPdf), text_representation: "persisted_text_utf8_exact", rendered_text_representation: "line_endings_normalized_to_lf",
    },
  };
  const result = await prepareBuyerCorrectionVersion({
    previousSnapshot: snapshot,
    previousVersionId: "version-1",
    previousPdfSha256: hash(previousPdf),
    actorUserId: "user-1",
    originalText,
    previousBuyer: buyer,
    correctedBuyer: { ...buyer, name: "Ana Souza" },
  });

  assert.match(result.renderedText, /Nome: Ana Souza/);
  assert.doesNotMatch(result.renderedText, /Nome: Ana Silva/);
  assert.match(result.renderedText, /CLAUSULA 1: O valor e irrevogavel\./);
  assert.equal(result.renderedTextSha256, hash(result.renderedText));
  assert.equal(result.pdfSha256, hash(result.pdfBytes));
  assert.equal(snapshot.renderer_input.customer.name, "Ana Silva");
  assert.equal((result.correctedSnapshot.text_provenance as Record<string, unknown>).text_representation, "buyer_corrected_text_utf8_exact");
  assert.equal((result.correctedSnapshot.buyer_correction as Record<string, unknown>).previous_text_sha256, hash(originalText));
});

test("rejeita campo cadastral ambiguo antes de gerar versao", async () => {
  await assert.rejects(
    () => prepareBuyerCorrectionVersion({
      previousSnapshot: { renderer_input: { customer: {} }, text_provenance: { text_representation: "persisted_text_utf8_exact", text_sha256: hash("Nome: Ana Silva\nNome: Ana Silva"), pdf_sha256: "b".repeat(64) } },
      previousVersionId: "version-1", previousPdfSha256: "b".repeat(64), actorUserId: "user-1",
      originalText: "Nome: Ana Silva\nNome: Ana Silva", previousBuyer: { ...buyer }, correctedBuyer: { ...buyer, name: "Ana Souza" },
    }),
    (error: unknown) => error instanceof ContractBuyerCorrectionError && error.code === "BUYER_FIELD_AMBIGUOUS",
  );
});
