import { strict as assert } from "node:assert";
import {
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

for (const test of tests) {
  test.run();
  process.stdout.write(`ok - ${test.name}\n`);
}

console.log(`quote-create-operation: ${tests.length} tests passed`);
