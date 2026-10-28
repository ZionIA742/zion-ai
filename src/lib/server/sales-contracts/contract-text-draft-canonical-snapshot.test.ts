import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildContractTextDraftPdf } from "./build-contract-text-draft-pdf.js";
import {
  buildContractSnapshotV2,
  computeContractContentFingerprint,
  type CanonicalContractRendererInput,
} from "./canonical-contract-renderer.js";
import {
  buildContractTextDraftCanonicalSnapshot,
  ContractTextDraftCanonicalSnapshotError,
} from "./contract-text-draft-canonical-snapshot.js";
import type { ContractTextDraftVersionProvenance } from "./contract-text-draft-version-provenance.js";

function buildInput(): CanonicalContractRendererInput {
  return {
    identity: {
      contractId: "contract-1",
      organizationId: "org-1",
      storeId: "store-1",
      quoteId: "quote-1",
      quoteVersionId: "quote-version-1",
      quoteNumber: "Q-1",
      contractNumber: "C-1",
      title: "Contrato",
      validUntil: null,
    },
    lineage: {
      commercialOpportunityId: "opp-1",
      proposalAcceptanceEventId: "acceptance-1",
    },
    customer: {
      leadId: "lead-1",
      name: "Cliente",
      phone: null,
    },
    store: { id: "store-1", name: "Loja" },
    items: [
      {
        id: "item-1",
        name: "Piscina",
        description: "Piscina azul",
        quantity: 1,
        unitPriceCents: 100000,
        discountCents: 0,
        totalCents: 100000,
        metadata: { source: "quote" },
      },
    ],
    values: {
      currency: "BRL",
      subtotalCents: 100000,
      discountCents: 0,
      totalCents: 100000,
    },
    commercialTerms: {
      payment: "Pix",
      delivery: "A combinar",
      warranty: "Conforme regras aprovadas",
    },
    templateAuthority: {
      templateId: "template-1",
      templateVersionId: "template-version-1",
      templateVersionNumber: 1,
      rules: [
        {
          rule_id: "rule-1",
          rule_key: "payment_terms",
          rule_group: "pagamento",
          label: "Forma de pagamento",
          value_text: "Pix ou transferencia",
          review_status: "approved",
          sort_order: 1,
        },
        {
          rule_id: "rule-2",
          rule_key: "warranty",
          rule_group: "garantia",
          label: "Garantia",
          value_text: "Conforme termo aprovado",
          review_status: "approved",
          sort_order: 2,
        },
      ],
      clauses: "Clausulas aprovadas",
    },
    branding: {
      primaryColor: null,
      secondaryColor: null,
      documentFooter: null,
      logo: null,
    },
    createdAt: "2026-10-27T12:00:00.000Z",
  };
}

function buildProvenance(
  overrides: Partial<ContractTextDraftVersionProvenance> = {},
): ContractTextDraftVersionProvenance {
  return {
    mode: "saved_text_draft",
    draft_id: "draft-1",
    organization_id: "org-1",
    store_id: "store-1",
    commercial_opportunity_id: "opp-1",
    template_version_id: "template-version-1",
    revision: 3,
    text_sha256: createHash("sha256").update("Texto salvo", "utf8").digest("hex"),
    pdf_sha256: createHash("sha256").update("pdf-bytes").digest("hex"),
    text_representation: "persisted_text_utf8_exact",
    rendered_text_representation: "line_endings_normalized_to_lf",
    ...overrides,
  };
}

function buildSnapshot() {
  const input = buildInput();
  return buildContractSnapshotV2({
    input,
    contentFingerprint: computeContractContentFingerprint(input),
    materializedAt: "2026-10-27T12:01:00.000Z",
  });
}

test("adds textual provenance while preserving the V2 snapshot fields", () => {
  const original = buildSnapshot();
  const provenance = buildProvenance();
  const result = buildContractTextDraftCanonicalSnapshot({
    snapshot: original,
    provenance,
  });

  assert.equal(result.snapshot.schema, original.schema);
  assert.deepEqual(result.snapshot.identity, original.identity);
  assert.deepEqual(result.snapshot.lineage, original.lineage);
  assert.deepEqual(result.snapshot.template_authority, original.template_authority);
  assert.deepEqual(result.snapshot.renderer_input, original.renderer_input);
  assert.equal(result.snapshot.text_provenance.revision, 3);
  assert.equal(result.snapshot.text_provenance.mode, "saved_text_draft");
  assert.equal(result.snapshot.content_fingerprint, result.contentFingerprint);
  assert.equal(result.baseContentFingerprint, original.content_fingerprint);
});

test("is deterministic and changes fingerprint for a different revision or text hash", () => {
  const snapshot = buildSnapshot();
  const first = buildContractTextDraftCanonicalSnapshot({
    snapshot,
    provenance: buildProvenance(),
  });
  const replay = buildContractTextDraftCanonicalSnapshot({
    snapshot,
    provenance: buildProvenance(),
  });
  const changedRevision = buildContractTextDraftCanonicalSnapshot({
    snapshot,
    provenance: buildProvenance({ revision: 4 }),
  });
  const changedText = buildContractTextDraftCanonicalSnapshot({
    snapshot,
    provenance: buildProvenance({ text_sha256: "a".repeat(64) }),
  });

  assert.equal(first.contentFingerprint, replay.contentFingerprint);
  assert.notEqual(first.contentFingerprint, changedRevision.contentFingerprint);
  assert.notEqual(first.contentFingerprint, changedText.contentFingerprint);
});

test("does not share mutable references with inputs or result", () => {
  const snapshot = buildSnapshot();
  const provenance = buildProvenance();
  const snapshotBefore = structuredClone(snapshot);
  const provenanceBefore = structuredClone(provenance);

  const result = buildContractTextDraftCanonicalSnapshot({ snapshot, provenance });

  result.snapshot.renderer_input.items[0].name = "Alterado no resultado";
  result.snapshot.template_authority.rules[0].value_text = "Alterado no resultado";
  result.snapshot.text_provenance.revision = 99;

  assert.equal(snapshot.renderer_input.items[0].name, "Piscina");
  assert.equal(snapshot.template_authority.rules[0].value_text, "Pix ou transferencia");
  assert.equal(provenance.revision, 3);

  assert.deepEqual(snapshot, snapshotBefore);
  assert.deepEqual(provenance, provenanceBefore);

  snapshot.renderer_input.items[0].name = "Alterado na entrada";
  snapshot.template_authority.rules[0].value_text = "Alterado na entrada";
  provenance.revision = 100;

  assert.equal(result.snapshot.renderer_input.items[0].name, "Alterado no resultado");
  assert.equal(result.snapshot.template_authority.rules[0].value_text, "Alterado no resultado");
  assert.equal(result.snapshot.text_provenance.revision, 99);
});

test("renders the same text twice with identical PDF bytes and SHA-256", async () => {
  const text = "Contrato textual\nRevisao 3\nClausula aprovada";
  const first = await buildContractTextDraftPdf({ text });
  const second = await buildContractTextDraftPdf({ text });

  const hash = (bytes: Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");

  assert.deepEqual(first, second);
  assert.equal(hash(first), hash(second));
});

test("rejects mismatched scope and invalid base fingerprints", () => {
  const snapshot = buildSnapshot();

  assert.throws(
    () =>
      buildContractTextDraftCanonicalSnapshot({
        snapshot,
        provenance: buildProvenance({ store_id: "store-2" }),
      }),
    (error: unknown) =>
      error instanceof ContractTextDraftCanonicalSnapshotError &&
      error.code === "TEXT_PROVENANCE_SCOPE_MISMATCH",
  );

  assert.throws(
    () =>
      buildContractTextDraftCanonicalSnapshot({
        snapshot: { ...snapshot, content_fingerprint: "b".repeat(64) },
        provenance: buildProvenance(),
      }),
    (error: unknown) =>
      error instanceof ContractTextDraftCanonicalSnapshotError &&
      error.code === "INVALID_CANONICAL_SNAPSHOT",
  );
});

test("rejects invalid provenance without fabricating commercial identity", () => {
  const snapshot = buildSnapshot();

  assert.throws(
    () =>
      buildContractTextDraftCanonicalSnapshot({
        snapshot,
        provenance: buildProvenance({ commercial_opportunity_id: "" }),
      }),
    (error: unknown) =>
      error instanceof ContractTextDraftCanonicalSnapshotError &&
      error.code === "INVALID_TEXT_PROVENANCE",
  );
});

test("manual snapshot preserves null quote lineage and marks commercial amounts as non-authoritative", () => {
  const input = buildInput();
  input.identity.quoteId = null;
  input.identity.quoteVersionId = null;
  input.identity.quoteNumber = null;
  input.lineage.proposalAcceptanceEventId = null;
  input.items = [];
  input.values = {
    currency: "BRL",
    subtotalCents: 0,
    discountCents: 0,
    totalCents: 0,
  };
  input.commercialTerms = {
    payment: null,
    delivery: null,
    warranty: null,
  };

  const base = buildContractSnapshotV2({
    input,
    contentFingerprint: computeContractContentFingerprint(input),
    materializedAt: "2026-10-27T12:01:00.000Z",
    origin: {
      source: "responsible_text_draft",
      commercialAmountsAuthoritative: false,
    },
  });
  const result = buildContractTextDraftCanonicalSnapshot({
    snapshot: base,
    provenance: buildProvenance(),
  });

  assert.equal(result.snapshot.lineage.quote_id, null);
  assert.equal(result.snapshot.lineage.quote_version_id, null);
  assert.equal(result.snapshot.renderer_input.identity.quoteId, null);
  assert.equal(result.snapshot.renderer_input.identity.quoteVersionId, null);
  assert.equal(result.snapshot.origin?.source, "responsible_text_draft");
  assert.equal(result.snapshot.origin?.commercial_amounts_authoritative, false);
  assert.equal(result.snapshot.renderer_input.values.totalCents, 0);
  assert.equal(result.snapshot.text_provenance.commercial_opportunity_id, "opp-1");
});

test("manual snapshot rejects quote lineage or authoritative amounts", () => {
  const input = buildInput();
  const base = buildContractSnapshotV2({
    input,
    contentFingerprint: computeContractContentFingerprint(input),
    materializedAt: "2026-10-27T12:01:00.000Z",
    origin: {
      source: "responsible_text_draft",
      commercialAmountsAuthoritative: false,
    },
  });

  assert.throws(
    () =>
      buildContractTextDraftCanonicalSnapshot({
        snapshot: base,
        provenance: buildProvenance(),
      }),
    (error: unknown) =>
      error instanceof ContractTextDraftCanonicalSnapshotError &&
      error.code === "INVALID_CANONICAL_SNAPSHOT",
  );
});
