import assert from "node:assert/strict";
import {
  buildCanonicalContractRendererInput,
  buildContractSnapshotV2,
  computeContractContentFingerprint,
} from "./canonical-contract-renderer.ts";

function createInput(overrides = {}) {
  return buildCanonicalContractRendererInput({
    contract: {
      id: "contract-1",
      organization_id: "org-1",
      store_id: "store-1",
      lead_id: "lead-1",
      quote_id: "quote-1",
      quote_version_id: "quote-version-1",
      commercial_opportunity_id: "opportunity-1",
      contract_number: "CTR-1",
      title: "Titulo mutavel ignorado",
      customer_name: "Cliente mutavel ignorado",
      customer_phone: "telefone mutavel ignorado",
      currency: "BRL",
      subtotal_cents: 1,
      discount_cents: 1,
      total_cents: 1,
      payment_terms: "termo mutavel ignorado",
      delivery_terms: "termo mutavel ignorado",
      warranty_terms: "termo mutavel ignorado",
      contract_terms: "fallback proibido",
      valid_until: "2020-01-01",
      metadata: { proposal_acceptance_event_id: "acceptance-1" },
      created_at: "2026-10-08T12:00:00.000Z",
    },
    store: { id: "store-1", organization_id: "org-1", name: "Loja 1" },
    lead: { id: "lead-1", organization_id: "org-1", store_id: "store-1", name: "Lead", phone: "5511" },
    quoteSnapshot: {
      quote: {
        id: "quote-1",
        title: "Titulo da quote authority",
        customerName: "Cliente da quote authority",
        customerPhone: "5522",
        currency: "BRL",
        validUntil: "2026-12-31",
        subtotalCents: 10000,
        discountCents: 500,
        totalCents: 9500,
        paymentTerms: "Pagamento da quote authority",
        deliveryTerms: "Entrega da quote authority",
        warrantyTerms: "Garantia da quote authority",
      },
    },
    items: [{
      id: "item-1",
      name: "Item",
      description: "Descricao",
      quantity: 1,
      unitPriceCents: 10000,
      discountCents: 500,
      totalCents: 9500,
      metadata: { source: "quote-snapshot" },
    }],
    templateTerms: {
      contractTemplateUsed: true,
      templateId: "template-1",
      templateVersionId: "template-version-1",
      templateVersionNumber: 3,
      generatedContractTerms: "Clausulas finais da authority",
      rulesUsed: [{
        rule_id: "rule-1",
        rule_key: "pagamento",
        rule_group: "pagamento",
        label: "Pagamento",
        value_text: "Clausulas finais da authority",
        review_status: "approved",
        sort_order: 1,
      }],
      snapshotGeneratedAt: "2026-10-08T12:01:00.000Z",
      warning: null,
    },
    brandVisual: { primaryColor: "#123456", secondaryColor: "#abcdef", documentFooter: "Rodape" },
    logo: { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" },
    ...overrides,
  });
}

const tests = [
  {
    name: "authorized template produces canonical renderer input",
    run() {
      const input = createInput();
      assert.equal(input.templateAuthority.templateId, "template-1");
      assert.equal(input.templateAuthority.templateVersionId, "template-version-1");
      assert.equal(input.templateAuthority.clauses, "Clausulas finais da authority");
      assert.equal(input.branding.logo.mimeType, "image/png");
    },
  },
  {
    name: "quote authority terms are used instead of mutable contract fields",
    run() {
      const input = createInput();
      assert.deepEqual(input.commercialTerms, {
        payment: "Pagamento da quote authority",
        delivery: "Entrega da quote authority",
        warranty: "Garantia da quote authority",
      });
      assert.notEqual(input.templateAuthority.clauses, "fallback proibido");
    },
  },
  {
    name: "renderer input is persisted byte-for-byte as snapshot renderer input",
    run() {
      const input = createInput();
      const snapshot = buildContractSnapshotV2({
        input,
        contentFingerprint: computeContractContentFingerprint(input),
        materializedAt: "2026-10-08T12:02:00.000Z",
      });
      assert.strictEqual(snapshot.renderer_input, input);
      assert.equal(snapshot.schema, "zion.sales_contract_snapshot.v2");
      assert.equal(snapshot.template_authority.template_version_number, 3);
    },
  },
  {
    name: "fingerprint is deterministic and excludes materialization time",
    run() {
      const input = createInput();
      const fingerprint = computeContractContentFingerprint(input);
      const second = computeContractContentFingerprint({ ...input, createdAt: "2027-01-01T00:00:00.000Z" });
      assert.equal(fingerprint, second);
      assert.equal(fingerprint.length, 64);
    },
  },
  {
    name: "semantic changes alter fingerprint",
    run() {
      const input = createInput();
      const changed = {
        ...input,
        commercialTerms: { ...input.commercialTerms, payment: "Outro pagamento" },
      };
      assert.notEqual(
        computeContractContentFingerprint(input),
        computeContractContentFingerprint(changed),
      );
    },
  },
  {
    name: "snapshot preserves historical renderer input after current template changes",
    run() {
      const historical = createInput();
      const snapshot = buildContractSnapshotV2({
        input: historical,
        contentFingerprint: computeContractContentFingerprint(historical),
        materializedAt: "2026-10-08T12:02:00.000Z",
      });
      const current = { ...historical, templateAuthority: { ...historical.templateAuthority, clauses: "Template atual" } };
      assert.equal(snapshot.renderer_input.templateAuthority.clauses, "Clausulas finais da authority");
      assert.notEqual(snapshot.renderer_input.templateAuthority.clauses, current.templateAuthority.clauses);
    },
  },
];

const failures = [];
for (const test of tests) {
  try {
    test.run();
    process.stdout.write(`ok - ${test.name}\n`);
  } catch (error) {
    failures.push(`not ok - ${test.name}\n${error?.stack || error}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
}
