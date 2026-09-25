import { strict as assert } from "node:assert";
import { createGenerateContractPdfPostHandler } from "./route";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

type SupabaseCall = {
  table: string;
  operation: string;
  filters?: Array<{ column: string; value: unknown }>;
  payload?: Record<string, unknown>;
};

type TestState = {
  scope: ReturnType<typeof createScope>;
  calls: SupabaseCall[];
  pdfInputs: Array<Record<string, unknown>>;
  storedFiles: Array<Record<string, unknown>>;
};

let state: TestState;

function createQuoteVersionRow(overrides?: Record<string, unknown>) {
  return {
    id: "version-accepted-v1",
    quote_id: "quote-1",
    organization_id: "org-1",
    store_id: "store-1",
    status: "sent",
    sent_at: "2026-09-24T10:00:00.000Z",
    quote_snapshot: {
      quote: {
        id: "quote-1",
      },
      items: [
        {
          id: "snapshot-item-v1",
          name: "ITEM IMUTAVEL V1",
          description: "Snapshot v1",
          quantity: 7,
          unitPriceCents: 12345,
          discountCents: 345,
          subtotalCents: 86415,
          totalCents: 86070,
          sku: "SKU-V1",
          sortOrder: 12,
          metadata: {
            marker: "snapshot-only-v1",
          },
        },
      ],
    },
    ...overrides,
  };
}

function createSupabaseMock(args: {
  quoteVersionRow: Record<string, unknown> | null;
  calls: SupabaseCall[];
}) {
  function makeThenable(result: { data: unknown; error: unknown }) {
    return {
      then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
        return Promise.resolve(result).then(resolve, reject);
      },
    };
  }

  return {
    storage: {
      from() {
        return {
          remove: async () => ({ data: null, error: null }),
        };
      },
    },
    from(table: string) {
      if (table === "sales_quote_items") {
        throw new Error("sales_quote_items must not be queried by contract PDF generation");
      }

      const filters: Array<{ column: string; value: unknown }> = [];

      if (table === "sales_quote_versions") {
        return {
          select() {
            const builder = {
              eq(column: string, value: unknown) {
                filters.push({ column, value });
                return builder;
              },
              maybeSingle: async () => {
                args.calls.push({
                  table,
                  operation: "maybeSingle",
                  filters: [...filters],
                });
                return { data: args.quoteVersionRow, error: null };
              },
            };
            return builder;
          },
        };
      }

      if (table === "sales_contract_versions") {
        return {
          select() {
            const selectBuilder = {
              eq(column: string, value: unknown) {
                filters.push({ column, value });
                return selectBuilder;
              },
              order() {
                return selectBuilder;
              },
              limit() {
                args.calls.push({
                  table,
                  operation: "select",
                  filters: [...filters],
                });
                return makeThenable({ data: [], error: null });
              },
            };
            return selectBuilder;
          },
          insert(payload: Record<string, unknown>) {
            args.calls.push({
              table,
              operation: "insert",
              payload,
            });
            return {
              select() {
                return {
                  maybeSingle: async () => ({
                    data: {
                      id: "contract-version-1",
                      contract_id: "contract-1",
                      version_number: payload.version_number,
                      contract_snapshot: payload.contract_snapshot,
                    },
                    error: null,
                  }),
                };
              },
            };
          },
          update(payload: Record<string, unknown>) {
            args.calls.push({
              table,
              operation: "update",
              payload,
            });
            return {
              eq() {
                return makeThenable({ data: null, error: null });
              },
            };
          },
          delete() {
            return {
              eq() {
                return makeThenable({ data: null, error: null });
              },
            };
          },
        };
      }

      if (table === "sales_contracts" || table === "store_files") {
        return {
          update(payload: Record<string, unknown>) {
            args.calls.push({
              table,
              operation: "update",
              payload,
            });
            return {
              eq() {
                return makeThenable({ data: null, error: null });
              },
            };
          },
          delete() {
            return {
              eq() {
                return makeThenable({ data: null, error: null });
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  };
}

function createScope(overrides?: {
  contract?: Record<string, unknown>;
  quoteVersionRow?: Record<string, unknown> | null;
}) {
  const calls: SupabaseCall[] = [];
  const quoteVersionRow =
    "quoteVersionRow" in (overrides ?? {})
      ? overrides?.quoteVersionRow ?? null
      : createQuoteVersionRow();

  const supabase = createSupabaseMock({
    quoteVersionRow,
    calls,
  });

  const contract = {
    id: "contract-1",
    organization_id: "org-1",
    store_id: "store-1",
    lead_id: "lead-1",
    conversation_id: "conversation-1",
    quote_id: "quote-1",
    quote_version_id: "version-accepted-v1",
    current_version_id: null,
    contract_number: "CTR-1",
    title: "Contrato",
    status: "draft",
    customer_name: "Cliente",
    customer_phone: "5511999999999",
    currency: "BRL",
    subtotal_cents: 86415,
    discount_cents: 345,
    total_cents: 86070,
    payment_terms: "Pix",
    delivery_terms: "Entrega",
    warranty_terms: "Garantia",
    contract_terms: "Termos",
    valid_until: "2026-10-24",
    sent_at: null,
    customer_signed_at: null,
    store_signed_at: null,
    completed_at: null,
    metadata: {
      quote_number: "ORC-1",
      fake_current_mutable_version_id: "version-v2",
    },
    created_at: "2026-09-24T09:00:00.000Z",
    updated_at: "2026-09-24T09:00:00.000Z",
    ...overrides?.contract,
  };

  return {
    user: { id: "user-1" },
    userId: "user-1",
    supabase,
    sessionSupabase: supabase,
    organizationId: "org-1",
    store: { id: "store-1", organization_id: "org-1", name: "Store 1" },
    conversation: { id: "conversation-1" },
    lead: { id: "lead-1", name: "Cliente", phone: "5511999999999" },
    contract,
    currentVersion: null,
    calls,
  };
}

function resetState(args?: Parameters<typeof createScope>[0]) {
  const scope = createScope(args);
  state = {
    scope,
    calls: scope.calls,
    pdfInputs: [],
    storedFiles: [],
  };
}

async function callRoute() {
  const handler = createGenerateContractPdfPostHandler({
    buildContractPdf: async (input: Record<string, unknown>) => {
      state.pdfInputs.push(input);
      return new Uint8Array([37, 80, 68, 70]);
    },
    loadStoreBrandVisualPolicy: async () => ({
      configured: false,
      useLogoOnContracts: null,
      primaryColor: null,
      secondaryColor: null,
      documentFooter: null,
    }),
    loadStoreLogoForContractPdf: async () => null,
    pushAssistantDocumentReviewMessage: async () => {},
    registerContractBusinessEvent: async () => {},
    resolveAuthorizedExistingContract: async () => state.scope,
    resolveContractTemplateTerms: async () => ({
      contractTemplateUsed: false,
      templateId: null,
      templateVersionId: null,
      templateVersionNumber: null,
      generatedContractTerms: null,
      rulesUsed: [],
      snapshotGeneratedAt: "2026-09-24T12:00:00.000Z",
      warning: null,
    }),
    storeContractPdfFile: async (input: Record<string, unknown>) => {
      state.storedFiles.push(input);
      return {
        storeFileId: "store-file-1",
        storageBucket: "contracts",
        storagePath: "contracts/contract-1.pdf",
        originalFilename: "contract-1.pdf",
        sizeBytes: 4,
      };
    },
  });

  const response = await handler(
    new Request("https://example.test", { method: "POST" }),
    { params: Promise.resolve({ contractId: "contract-1" }) },
  );
  const body = await response.json();
  return { response, body };
}

function insertedContractSnapshot() {
  const insert = state.calls.find(
    (call) => call.table === "sales_contract_versions" && call.operation === "insert",
  );
  return insert?.payload?.contract_snapshot as Record<string, unknown> | undefined;
}

function quoteVersionRead() {
  return state.calls.find(
    (call) => call.table === "sales_quote_versions" && call.operation === "maybeSingle",
  );
}

function assertNoMutableQuoteItemsQuery() {
  assert.equal(
    state.calls.some((call) => call.table === "sales_quote_items"),
    false,
    "contract PDF generation must not query sales_quote_items",
  );
}

const tests: TestCase[] = [
  {
    name: "uses exact immutable quote version snapshot items for PDF and persisted contract snapshot",
    run: async () => {
      resetState();
      const { response, body } = await callRoute();

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assertNoMutableQuoteItemsQuery();

      assert.deepEqual(quoteVersionRead()?.filters, [
        { column: "id", value: "version-accepted-v1" },
        { column: "quote_id", value: "quote-1" },
        { column: "organization_id", value: "org-1" },
        { column: "store_id", value: "store-1" },
      ]);
      assert.notEqual(
        quoteVersionRead()?.filters?.some((filter) => filter.value === "version-v2"),
        true,
      );

      assert.deepEqual((state.pdfInputs[0]?.items as unknown[])[0], {
        name: "ITEM IMUTAVEL V1",
        description: "Snapshot v1",
        quantity: 7,
        unit_price_cents: 12345,
        discount_cents: 345,
        total_cents: 86070,
      });

      const snapshot = insertedContractSnapshot();
      const snapshotItem = (snapshot?.items as Array<Record<string, unknown>>)[0];
      assert.deepEqual(snapshotItem, {
        id: "snapshot-item-v1",
        name: "ITEM IMUTAVEL V1",
        description: "Snapshot v1",
        quantity: 7,
        unitPriceCents: 12345,
        discountCents: 345,
        totalCents: 86070,
        metadata: {
          marker: "snapshot-only-v1",
        },
      });
      assert.equal(state.storedFiles.length, 1);
    },
  },
  {
    name: "snapshot without items array fails closed before PDF storage or contract version",
    run: async () => {
      resetState({
        quoteVersionRow: createQuoteVersionRow({
          quote_snapshot: { quote: { id: "quote-1" } },
        }),
      });

      const { response, body } = await callRoute();

      assert.equal(response.status, 409);
      assert.equal(body.error, "CONTRACT_QUOTE_SNAPSHOT_ITEMS_INVALID");
      assert.equal(state.pdfInputs.length, 0);
      assert.equal(state.storedFiles.length, 0);
      assert.equal(insertedContractSnapshot(), undefined);
    },
  },
  {
    name: "snapshot quote id mismatch fails closed",
    run: async () => {
      resetState({
        quoteVersionRow: createQuoteVersionRow({
          quote_snapshot: { quote: { id: "quote-other" }, items: [] },
        }),
      });

      const { response, body } = await callRoute();

      assert.equal(response.status, 409);
      assert.equal(body.error, "CONTRACT_QUOTE_SNAPSHOT_LINEAGE_MISMATCH");
      assert.equal(state.pdfInputs.length, 0);
      assert.equal(state.storedFiles.length, 0);
      assert.equal(insertedContractSnapshot(), undefined);
    },
  },
  {
    name: "missing contract quote_version_id fails before PDF storage or contract version",
    run: async () => {
      resetState({
        contract: { quote_version_id: null },
      });

      const { response, body } = await callRoute();

      assert.equal(response.status, 409);
      assert.equal(body.error, "CONTRACT_QUOTE_VERSION_ID_REQUIRED_FOR_PDF");
      assert.equal(quoteVersionRead(), undefined);
      assert.equal(state.pdfInputs.length, 0);
      assert.equal(state.storedFiles.length, 0);
      assert.equal(insertedContractSnapshot(), undefined);
    },
  },
  {
    name: "missing contract quote_id fails before quote version read, PDF storage or contract version",
    run: async () => {
      resetState({
        contract: { quote_id: null },
      });

      const { response, body } = await callRoute();

      assert.equal(response.status, 409);
      assert.equal(body.error, "CONTRACT_QUOTE_ID_REQUIRED_FOR_PDF");
      assert.equal(quoteVersionRead(), undefined);
      assert.equal(state.pdfInputs.length, 0);
      assert.equal(state.storedFiles.length, 0);
      assert.equal(insertedContractSnapshot(), undefined);
    },
  },
  {
    name: "missing exact quote version fails closed",
    run: async () => {
      resetState({
        quoteVersionRow: null,
      });

      const { response, body } = await callRoute();

      assert.equal(response.status, 409);
      assert.equal(body.error, "CONTRACT_QUOTE_VERSION_NOT_FOUND");
      assert.deepEqual(quoteVersionRead()?.filters?.[0], {
        column: "id",
        value: "version-accepted-v1",
      });
      assert.equal(state.pdfInputs.length, 0);
      assert.equal(state.storedFiles.length, 0);
      assert.equal(insertedContractSnapshot(), undefined);
    },
  },
  {
    name: "exact quote version with invalid status fails closed",
    run: async () => {
      resetState({
        quoteVersionRow: createQuoteVersionRow({
          status: "approved",
          sent_at: "2026-09-24T10:00:00.000Z",
        }),
      });

      const { response, body } = await callRoute();

      assert.equal(response.status, 409);
      assert.equal(body.error, "CONTRACT_QUOTE_VERSION_STATUS_INVALID");
      assert.deepEqual(quoteVersionRead()?.filters?.[0], {
        column: "id",
        value: "version-accepted-v1",
      });
      assert.equal(state.pdfInputs.length, 0);
      assert.equal(state.storedFiles.length, 0);
      assert.equal(insertedContractSnapshot(), undefined);
    },
  },
  {
    name: "exact sent quote version without sent_at fails closed",
    run: async () => {
      resetState({
        quoteVersionRow: createQuoteVersionRow({
          status: "sent",
          sent_at: null,
        }),
      });

      const { response, body } = await callRoute();

      assert.equal(response.status, 409);
      assert.equal(body.error, "CONTRACT_QUOTE_VERSION_SENT_AT_REQUIRED");
      assert.deepEqual(quoteVersionRead()?.filters?.[0], {
        column: "id",
        value: "version-accepted-v1",
      });
      assert.equal(state.pdfInputs.length, 0);
      assert.equal(state.storedFiles.length, 0);
      assert.equal(insertedContractSnapshot(), undefined);
    },
  },
  {
    name: "superseded exact quote version with sent_at remains valid historical lineage",
    run: async () => {
      resetState({
        quoteVersionRow: createQuoteVersionRow({
          status: "superseded",
          sent_at: "2026-09-24T10:00:00.000Z",
        }),
      });

      const { response, body } = await callRoute();

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assertNoMutableQuoteItemsQuery();
      assert.equal(
        ((state.pdfInputs[0]?.items as Array<Record<string, unknown>>)[0]).name,
        "ITEM IMUTAVEL V1",
      );
      assert.ok(insertedContractSnapshot());
    },
  },
];

void (async () => {
  const failures: string[] = [];

  for (const testCase of tests) {
    try {
      await testCase.run();
      process.stdout.write(`ok - ${testCase.name}\n`);
    } catch (error) {
      failures.push(
        `not ok - ${testCase.name}\n${error instanceof Error ? error.stack || error.message : String(error)}`,
      );
    }
  }

  if (failures.length > 0) {
    process.stderr.write(`${failures.join("\n")}\n`);
    process.exitCode = 1;
  }
})();
