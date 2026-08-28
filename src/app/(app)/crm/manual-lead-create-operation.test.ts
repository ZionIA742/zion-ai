import { strict as assert } from "node:assert";
import {
  buildManualCommercialLeadCreationSnapshot,
  buildManualCommercialLeadCreationStorageKey,
  clearPendingManualCommercialLeadCreationOperation,
  getOrCreatePendingManualCommercialLeadCreationOperation,
} from "./manual-lead-create-operation";

type TestCase = {
  name: string;
  run: () => void;
};

function createStorage() {
  const state = new Map<string, string>();

  return {
    state,
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

const tests: TestCase[] = [
  {
    name: "mesmo snapshot reutiliza a mesma operation id",
    run: () => {
      const storage = createStorage();
      const storageKey = buildManualCommercialLeadCreationStorageKey({
        organizationId: "org-a",
        storeId: "store-a",
      });
      const snapshot = buildManualCommercialLeadCreationSnapshot({
        name: "Cliente A",
        phone: "(11) 99999-9999",
      });

      const first = getOrCreatePendingManualCommercialLeadCreationOperation({
        storage,
        storageKey,
        requestSnapshot: snapshot,
        createOperationId: () => "operation-1",
      });
      const second = getOrCreatePendingManualCommercialLeadCreationOperation({
        storage,
        storageKey,
        requestSnapshot: snapshot,
        createOperationId: () => "operation-2",
      });

      assert.equal(first.operationId, "operation-1");
      assert.equal(first.reused, false);
      assert.equal(second.operationId, "operation-1");
      assert.equal(second.reused, true);
      assert.deepEqual(JSON.parse(storage.getItem(storageKey) || "null"), {
        operationId: "operation-1",
        requestSnapshot: snapshot,
      });
    },
  },
  {
    name: "normalizacao de espacos preserva a mesma operacao",
    run: () => {
      const storage = createStorage();
      const storageKey = buildManualCommercialLeadCreationStorageKey({
        organizationId: "org-a",
        storeId: "store-a",
      });

      const firstSnapshot = buildManualCommercialLeadCreationSnapshot({
        name: "  Cliente A  ",
        phone: "  (11) 99999-9999  ",
      });
      const retrySnapshot = buildManualCommercialLeadCreationSnapshot({
        name: "Cliente A",
        phone: "(11) 99999-9999",
      });

      const first = getOrCreatePendingManualCommercialLeadCreationOperation({
        storage,
        storageKey,
        requestSnapshot: firstSnapshot,
        createOperationId: () => "operation-1",
      });
      const retry = getOrCreatePendingManualCommercialLeadCreationOperation({
        storage,
        storageKey,
        requestSnapshot: retrySnapshot,
        createOperationId: () => "operation-2",
      });

      assert.equal(first.operationId, "operation-1");
      assert.equal(retry.operationId, "operation-1");
      assert.equal(retry.reused, true);
    },
  },
  {
    name: "payload alterado gera nova operation id",
    run: () => {
      const storage = createStorage();
      const storageKey = buildManualCommercialLeadCreationStorageKey({
        organizationId: "org-a",
        storeId: "store-a",
      });

      const first = getOrCreatePendingManualCommercialLeadCreationOperation({
        storage,
        storageKey,
        requestSnapshot: buildManualCommercialLeadCreationSnapshot({
          name: "Cliente A",
          phone: null,
        }),
        createOperationId: () => "operation-1",
      });
      const second = getOrCreatePendingManualCommercialLeadCreationOperation({
        storage,
        storageKey,
        requestSnapshot: buildManualCommercialLeadCreationSnapshot({
          name: "Cliente B",
          phone: null,
        }),
        createOperationId: () => "operation-2",
      });

      assert.equal(first.operationId, "operation-1");
      assert.equal(second.operationId, "operation-2");
      assert.equal(second.reused, false);
    },
  },
  {
    name: "erro de rede preserva a operation id para retry",
    run: () => {
      const storage = createStorage();
      const storageKey = buildManualCommercialLeadCreationStorageKey({
        organizationId: "org-a",
        storeId: "store-a",
      });
      const snapshot = buildManualCommercialLeadCreationSnapshot({
        name: null,
        phone: "(11) 98888-7766",
      });

      getOrCreatePendingManualCommercialLeadCreationOperation({
        storage,
        storageKey,
        requestSnapshot: snapshot,
        createOperationId: () => "operation-1",
      });

      const retry = getOrCreatePendingManualCommercialLeadCreationOperation({
        storage,
        storageKey,
        requestSnapshot: snapshot,
        createOperationId: () => "operation-2",
      });

      assert.equal(retry.operationId, "operation-1");
      assert.equal(retry.reused, true);
    },
  },
  {
    name: "success limpa a operacao pendente",
    run: () => {
      const storage = createStorage();
      const storageKey = buildManualCommercialLeadCreationStorageKey({
        organizationId: "org-a",
        storeId: "store-a",
      });
      const snapshot = buildManualCommercialLeadCreationSnapshot({
        name: "Cliente A",
        phone: null,
      });

      getOrCreatePendingManualCommercialLeadCreationOperation({
        storage,
        storageKey,
        requestSnapshot: snapshot,
        createOperationId: () => "operation-1",
      });

      clearPendingManualCommercialLeadCreationOperation({
        storage,
        storageKey,
      });

      const next = getOrCreatePendingManualCommercialLeadCreationOperation({
        storage,
        storageKey,
        requestSnapshot: snapshot,
        createOperationId: () => "operation-2",
      });

      assert.equal(next.operationId, "operation-2");
      assert.equal(next.reused, false);
    },
  },
  {
    name: "organization e store fazem parte do escopo local da operacao",
    run: () => {
      const storage = createStorage();
      const snapshot = buildManualCommercialLeadCreationSnapshot({
        name: "Cliente A",
        phone: "(11) 99999-9999",
      });
      const orgAStoreA = buildManualCommercialLeadCreationStorageKey({
        organizationId: "org-a",
        storeId: "store-a",
      });
      const orgAStoreB = buildManualCommercialLeadCreationStorageKey({
        organizationId: "org-a",
        storeId: "store-b",
      });
      const orgBStoreA = buildManualCommercialLeadCreationStorageKey({
        organizationId: "org-b",
        storeId: "store-a",
      });

      assert.notEqual(
        orgAStoreA,
        orgAStoreB,
      );
      assert.notEqual(
        orgAStoreA,
        orgBStoreA,
      );

      const first = getOrCreatePendingManualCommercialLeadCreationOperation({
        storage,
        storageKey: orgAStoreA,
        requestSnapshot: snapshot,
        createOperationId: () => "operation-1",
      });
      const second = getOrCreatePendingManualCommercialLeadCreationOperation({
        storage,
        storageKey: orgAStoreB,
        requestSnapshot: snapshot,
        createOperationId: () => "operation-2",
      });
      const third = getOrCreatePendingManualCommercialLeadCreationOperation({
        storage,
        storageKey: orgBStoreA,
        requestSnapshot: snapshot,
        createOperationId: () => "operation-3",
      });

      assert.equal(first.operationId, "operation-1");
      assert.equal(second.operationId, "operation-2");
      assert.equal(third.operationId, "operation-3");
    },
  },
];

for (const test of tests) {
  test.run();
  process.stdout.write(`ok - ${test.name}\n`);
}

console.log(`manual-lead-create-operation: ${tests.length} tests passed`);
