import { strict as assert } from "node:assert";
import {
  resolveManualQuoteCreationContext,
  buildManualQuoteCreationSnapshot,
  buildManualQuoteCreationStorageKey,
  clearPendingManualQuoteCreationOperation,
  getOrCreatePendingManualQuoteCreationOperation,
} from "./quote-create-operation";

type TestCase = {
  name: string;
  run: () => void;
};

function createStorage() {
  const state = new Map<string, string>();

  return {
    getItem(key: string) {
      return state.has(key) ? state.get(key)! : null;
    },
    setItem(key: string, value: string) {
      state.set(key, value);
    },
    removeItem(key: string) {
      state.delete(key);
    },
  };
}

function createSnapshot(overrides?: Partial<Parameters<typeof buildManualQuoteCreationSnapshot>[0]>) {
  return buildManualQuoteCreationSnapshot({
    organizationId: "org-a",
    storeId: "store-a",
    leadId: "lead-a",
    conversationId: "conversation-a",
    commercialOpportunityId: "opportunity-a",
    title: "Orcamento A",
    customer_name: "Cliente A",
    customer_phone: "+5511999999999",
    customer_notes: "Observacao",
    internal_notes: null,
    warranty_terms: "Garantia padrao",
    validity_days: "15",
    discount_cents: 0,
    items: [
      {
        item_type: "custom",
        name: "Piscina",
        description: null,
        quantity: 1,
        unit_price_cents: 1000,
        discount_cents: 0,
      },
    ],
    ...overrides,
  });
}

const tests: TestCase[] = [
  {
    name: "mesmo snapshot reutiliza a mesma key",
    run: () => {
      const storage = createStorage();
      const storageKey = buildManualQuoteCreationStorageKey({
        organizationId: "org-a",
        storeId: "store-a",
        leadId: "lead-a",
        conversationId: "conversation-a",
        commercialOpportunityId: "opportunity-a",
      });
      const snapshot = createSnapshot();

      const first = getOrCreatePendingManualQuoteCreationOperation({
        storage,
        storageKey,
        requestSnapshot: snapshot,
        createIdempotencyKey: () => "quote_create:key-1",
      });
      const second = getOrCreatePendingManualQuoteCreationOperation({
        storage,
        storageKey,
        requestSnapshot: snapshot,
        createIdempotencyKey: () => "quote_create:key-2",
      });

      assert.equal(first.idempotencyKey, "quote_create:key-1");
      assert.equal(second.idempotencyKey, "quote_create:key-1");
      assert.equal(second.reused, true);
    },
  },
  {
    name: "snapshot alterado gera uma nova key",
    run: () => {
      const storage = createStorage();
      const storageKey = buildManualQuoteCreationStorageKey({
        organizationId: "org-a",
        storeId: "store-a",
        leadId: "lead-a",
        conversationId: "conversation-a",
        commercialOpportunityId: "opportunity-a",
      });

      const first = getOrCreatePendingManualQuoteCreationOperation({
        storage,
        storageKey,
        requestSnapshot: createSnapshot(),
        createIdempotencyKey: () => "quote_create:key-1",
      });
      const second = getOrCreatePendingManualQuoteCreationOperation({
        storage,
        storageKey,
        requestSnapshot: createSnapshot({ title: "Orcamento B" }),
        createIdempotencyKey: () => "quote_create:key-2",
      });

      assert.equal(first.idempotencyKey, "quote_create:key-1");
      assert.equal(second.idempotencyKey, "quote_create:key-2");
      assert.equal(second.reused, false);
    },
  },
  {
    name: "network error preserva a key pendente",
    run: () => {
      const storage = createStorage();
      const storageKey = buildManualQuoteCreationStorageKey({
        organizationId: "org-a",
        storeId: "store-a",
        leadId: "lead-a",
        conversationId: "conversation-a",
        commercialOpportunityId: "opportunity-a",
      });
      const snapshot = createSnapshot();

      getOrCreatePendingManualQuoteCreationOperation({
        storage,
        storageKey,
        requestSnapshot: snapshot,
        createIdempotencyKey: () => "quote_create:key-1",
      });

      const retry = getOrCreatePendingManualQuoteCreationOperation({
        storage,
        storageKey,
        requestSnapshot: snapshot,
        createIdempotencyKey: () => "quote_create:key-2",
      });

      assert.equal(retry.idempotencyKey, "quote_create:key-1");
      assert.equal(retry.reused, true);
    },
  },
  {
    name: "falha apos create e pdf pendente preserva a mesma key",
    run: () => {
      const storage = createStorage();
      const storageKey = buildManualQuoteCreationStorageKey({
        organizationId: "org-a",
        storeId: "store-a",
        leadId: "lead-a",
        conversationId: "conversation-a",
        commercialOpportunityId: "opportunity-a",
      });
      const snapshot = createSnapshot();

      const first = getOrCreatePendingManualQuoteCreationOperation({
        storage,
        storageKey,
        requestSnapshot: snapshot,
        createIdempotencyKey: () => "quote_create:key-1",
      });

      const retryAfterPdfFailure = getOrCreatePendingManualQuoteCreationOperation({
        storage,
        storageKey,
        requestSnapshot: snapshot,
        createIdempotencyKey: () => "quote_create:key-2",
      });

      assert.equal(first.idempotencyKey, "quote_create:key-1");
      assert.equal(retryAfterPdfFailure.idempotencyKey, "quote_create:key-1");
      assert.equal(retryAfterPdfFailure.reused, true);
    },
  },
  {
    name: "refresh reaproveita a mesma key pendente",
    run: () => {
      const storage = createStorage();
      const storageKey = buildManualQuoteCreationStorageKey({
        organizationId: "org-a",
        storeId: "store-a",
        leadId: "lead-a",
        conversationId: "conversation-a",
        commercialOpportunityId: "opportunity-a",
      });
      const snapshot = createSnapshot();

      getOrCreatePendingManualQuoteCreationOperation({
        storage,
        storageKey,
        requestSnapshot: snapshot,
        createIdempotencyKey: () => "quote_create:key-1",
      });

      const afterRefresh = getOrCreatePendingManualQuoteCreationOperation({
        storage,
        storageKey,
        requestSnapshot: snapshot,
        createIdempotencyKey: () => "quote_create:key-2",
      });

      assert.equal(afterRefresh.idempotencyKey, "quote_create:key-1");
      assert.equal(afterRefresh.reused, true);
    },
  },
  {
    name: "validade ou garantia alterada gera nova key",
    run: () => {
      const storage = createStorage();
      const storageKey = buildManualQuoteCreationStorageKey({
        organizationId: "org-a",
        storeId: "store-a",
        leadId: "lead-a",
        conversationId: "conversation-a",
        commercialOpportunityId: "opportunity-a",
      });

      const first = getOrCreatePendingManualQuoteCreationOperation({
        storage,
        storageKey,
        requestSnapshot: createSnapshot(),
        createIdempotencyKey: () => "quote_create:key-1",
      });
      const second = getOrCreatePendingManualQuoteCreationOperation({
        storage,
        storageKey,
        requestSnapshot: createSnapshot({ validity_days: "30" }),
        createIdempotencyKey: () => "quote_create:key-2",
      });

      assert.equal(first.idempotencyKey, "quote_create:key-1");
      assert.equal(second.idempotencyKey, "quote_create:key-2");
      assert.equal(second.reused, false);
    },
  },
  {
    name: "success limpa a operacao local",
    run: () => {
      const storage = createStorage();
      const storageKey = buildManualQuoteCreationStorageKey({
        organizationId: "org-a",
        storeId: "store-a",
        leadId: "lead-a",
        conversationId: "conversation-a",
        commercialOpportunityId: "opportunity-a",
      });
      const snapshot = createSnapshot();

      getOrCreatePendingManualQuoteCreationOperation({
        storage,
        storageKey,
        requestSnapshot: snapshot,
        createIdempotencyKey: () => "quote_create:key-1",
      });
      clearPendingManualQuoteCreationOperation({
        storage,
        storageKey,
      });

      const next = getOrCreatePendingManualQuoteCreationOperation({
        storage,
        storageKey,
        requestSnapshot: snapshot,
        createIdempotencyKey: () => "quote_create:key-2",
      });

      assert.equal(next.idempotencyKey, "quote_create:key-2");
      assert.equal(next.reused, false);
    },
  },
];

const contextInput = {
  organizationId: "org-a", storeId: "store-a", linkLead: false,
  currentLeadId: "lead-a", currentConversationId: "conversation-a",
  currentOpportunityId: "opportunity-a", currentLeadName: "Cliente A",
  currentLeadPhone: "+5511999999999",
};
const independentScope = { organizationId: "org-a", storeId: "store-a", leadId: null,
  conversationId: null, commercialOpportunityId: null };

tests.push(
  { name: "sem vinculo nao herda dados do lead", run: () => {
    assert.deepEqual(resolveManualQuoteCreationContext(contextInput), {
      ...independentScope, customer_name: null, customer_phone: null,
    });
  } },
  { name: "vinculo explicito preenche contexto e cliente", run: () => {
    assert.deepEqual(resolveManualQuoteCreationContext({ ...contextInput, linkLead: true }), {
      organizationId: "org-a", storeId: "store-a", leadId: "lead-a",
      conversationId: "conversation-a", commercialOpportunityId: "opportunity-a",
      customer_name: "Cliente A", customer_phone: "+5511999999999",
    });
  } },
  { name: "cliente manual opcional nao cria vinculo", run: () => {
    assert.deepEqual(resolveManualQuoteCreationContext({ ...contextInput, manualCustomerName: "  Outro  ", manualCustomerPhone: " " }), {
      ...independentScope, customer_name: "Outro", customer_phone: null,
    });
  } },
  { name: "lead vinculado pode nao ter dados pessoais ou oportunidade", run: () => {
    const result = resolveManualQuoteCreationContext({ ...contextInput, linkLead: true,
      currentLeadName: null, currentLeadPhone: null, currentConversationId: null, currentOpportunityId: null });
    assert.equal(result.leadId, "lead-a");
    assert.equal(result.customer_name, null); assert.equal(result.customer_phone, null);
    assert.equal(result.conversationId, null); assert.equal(result.commercialOpportunityId, null);
  } },
  { name: "vinculo sem lead e escopo sem loja rejeitados", run: () => {
    assert.throws(() => resolveManualQuoteCreationContext({ ...contextInput, linkLead: true, currentLeadId: null }));
    assert.throws(() => resolveManualQuoteCreationContext({ ...contextInput, storeId: "" }));
    assert.throws(() => resolveManualQuoteCreationContext({ ...contextInput, organizationId: "" }));
  } },
  { name: "snapshot independente tem ids e cliente nulos", run: () => {
    const snapshot = JSON.parse(createSnapshot(resolveManualQuoteCreationContext(contextInput)));
    for (const key of ["leadId", "conversationId", "commercialOpportunityId", "customer_name", "customer_phone"]) {
      assert.equal(snapshot[key], null);
    }
  } },
  { name: "operacoes vinculadas e independentes nao compartilham chave", run: () => {
    const linked = resolveManualQuoteCreationContext({ ...contextInput, linkLead: true });
    assert.notEqual(buildManualQuoteCreationStorageKey(linked), buildManualQuoteCreationStorageKey(independentScope));
    assert.equal(buildManualQuoteCreationStorageKey(linked), "zion:manual-quote-create:org-a:store-a:lead-a:conversation-a:opportunity-a");
  } },
  { name: "origem do editor separa operacoes independentes", run: () => {
    const key = buildManualQuoteCreationStorageKey({ ...independentScope, draftOriginLeadId: "lead-a" });
    assert.notEqual(key, buildManualQuoteCreationStorageKey({ ...independentScope, draftOriginLeadId: "lead-b" }));
    assert.notEqual(key, buildManualQuoteCreationStorageKey({ ...independentScope, storeId: "store-b", draftOriginLeadId: "lead-a" }));
    const storage = createStorage();
    const requestSnapshot = createSnapshot(resolveManualQuoteCreationContext(contextInput));
    const first = getOrCreatePendingManualQuoteCreationOperation({ storage, storageKey: key, requestSnapshot, createIdempotencyKey: () => "quote_create:a" });
    const retry = getOrCreatePendingManualQuoteCreationOperation({ storage, storageKey: key, requestSnapshot, createIdempotencyKey: () => "quote_create:b" });
    assert.equal(first.idempotencyKey, retry.idempotencyKey);
    assert.equal(retry.reused, true);
  } },
);

for (const test of tests) {
  test.run();
  process.stdout.write(`ok - ${test.name}\n`);
}

console.log(`quote-create-operation: ${tests.length} tests passed`);
