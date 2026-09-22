import { strict as assert } from "node:assert";
import {
  buildQuoteSnapshot,
  createQuoteVersion,
  recordQuoteGenerationFailure,
} from "./quote-versioning";
import type {
  QuoteLeadRow,
  QuoteSettings,
  QuoteStoreRow,
  SalesQuoteItemRow,
  SalesQuoteRow,
} from "./types";

function createQuote(overrides: Partial<SalesQuoteRow> = {}): SalesQuoteRow {
  return {
    id: "quote-1",
    organization_id: "org-1",
    store_id: "store-1",
    conversation_id: null,
    lead_id: null,
    quote_number: "ORC-1",
    title: "Quote",
    status: "draft",
    customer_name: "Quote Customer",
    customer_phone: "11888888888",
    customer_notes: null,
    internal_notes: null,
    payment_terms: null,
    delivery_terms: null,
    warranty_terms: null,
    valid_until: null,
    subtotal_cents: 1000,
    discount_cents: 0,
    total_cents: 1000,
    current_version_id: null,
    metadata: {},
    created_at: "2026-09-04T00:00:00.000Z",
    updated_at: "2026-09-04T00:00:00.000Z",
    ...overrides,
  };
}

function createItem(overrides: Partial<SalesQuoteItemRow> = {}): SalesQuoteItemRow {
  return {
    id: "item-1",
    quote_id: "quote-1",
    organization_id: "org-1",
    store_id: "store-1",
    item_type: "service",
    name: "Item",
    description: null,
    quantity: 1,
    unit_price_cents: 1000,
    discount_cents: 0,
    subtotal_cents: 1000,
    total_cents: 1000,
    sort_order: 1,
    sku: null,
    metadata: {},
    created_at: "2026-09-04T00:00:00.000Z",
    updated_at: "2026-09-04T00:00:00.000Z",
    ...overrides,
  };
}

const settings: QuoteSettings = {
  quotePdfEnabled: true,
  aiCanGenerateQuote: true,
  aiCanSendQuoteToCustomer: false,
  requiresHumanApprovalBeforeSend: true,
  quoteNumberPrefix: "ORC",
  nextQuoteNumber: 2,
};

const store: QuoteStoreRow = {
  id: "store-1",
  organization_id: "org-1",
  name: "Store",
};

const lead: QuoteLeadRow = {
  id: "lead-1",
  organization_id: "org-1",
  store_id: "store-1",
  name: "Lead",
  phone: "11999999999",
};

function createSupabaseRecorder() {
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const rpcs: Array<{ functionName: string; args: Record<string, unknown> }> = [];

  return {
    inserts,
    updates,
    rpcs,
    supabase: {
      async rpc(functionName: string, args: Record<string, unknown>) {
        rpcs.push({ functionName, args });
        return {
          data: {
            id: `version-${rpcs.length}`,
            quote_id: args.p_quote_id,
            organization_id: args.p_organization_id,
            store_id: args.p_store_id,
            version_number: rpcs.length,
            status: args.p_version_status,
            quote_kind: args.p_quote_kind ?? null,
            store_file_id: args.p_store_file_id ?? null,
            storage_bucket: args.p_storage_bucket ?? null,
            storage_path: args.p_storage_path ?? null,
            original_filename: args.p_original_filename ?? null,
            mime_type: args.p_mime_type ?? null,
            size_bytes: args.p_size_bytes ?? null,
            quote_snapshot: args.p_quote_snapshot,
            created_at: "2026-09-04T00:00:00.000Z",
            sent_at: null,
          },
          error: null,
        };
      },
      from(table: string) {
        return {
          insert(payload: Record<string, unknown>) {
            inserts.push({ table, payload });
            return {
              select() {
                return {
                  async maybeSingle() {
                    return {
                      data: {
                        ...(payload as Record<string, unknown>),
                        id: "version-1",
                        created_at: "2026-09-04T00:00:00.000Z",
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
          update(payload: Record<string, unknown>) {
            updates.push({ table, payload });
            return {
              eq() {
                return { error: null };
              },
            };
          },
        };
      },
    },
  };
}

const tests: Array<{ name: string; run: () => Promise<void> }> = [
  {
    name: "buildQuoteSnapshot preserves quote and item canonical money fields without recalculation",
    run: async () => {
      const snapshot = buildQuoteSnapshot({
        quote: createQuote({
          subtotal_cents: 10000,
          discount_cents: 1750,
          total_cents: 8250,
        }),
        items: [
          createItem({
            quantity: 3,
            unit_price_cents: 3333,
            discount_cents: 777,
            subtotal_cents: 9999,
            total_cents: 9222,
          }),
        ],
        settings,
        store,
        lead,
      });

      assert.equal(snapshot.quote.subtotalCents, 10000);
      assert.equal(snapshot.quote.discountCents, 1750);
      assert.equal(snapshot.quote.totalCents, 8250);

      assert.equal(snapshot.items[0].quantity, 3);
      assert.equal(snapshot.items[0].unitPriceCents, 3333);
      assert.equal(snapshot.items[0].discountCents, 777);
      assert.equal(snapshot.items[0].subtotalCents, 9999);
      assert.equal(snapshot.items[0].totalCents, 9222);
    },
  },
  {
    name: "buildQuoteSnapshot preserves multiple item money values, zero values, full discount, and input order",
    run: async () => {
      const snapshot = buildQuoteSnapshot({
        quote: createQuote({
          subtotal_cents: 5000,
          discount_cents: 5000,
          total_cents: 0,
        }),
        items: [
          createItem({
            id: "item-zero",
            name: "Zero item",
            quantity: 1,
            unit_price_cents: 0,
            discount_cents: 0,
            subtotal_cents: 0,
            total_cents: 0,
            sort_order: 20,
          }),
          createItem({
            id: "item-full-discount",
            name: "Full discount item",
            quantity: 2,
            unit_price_cents: 2500,
            discount_cents: 5000,
            subtotal_cents: 5000,
            total_cents: 0,
            sort_order: 10,
          }),
        ],
        settings,
        store,
        lead,
      });

      assert.equal(snapshot.quote.subtotalCents, 5000);
      assert.equal(snapshot.quote.discountCents, 5000);
      assert.equal(snapshot.quote.totalCents, 0);

      assert.deepEqual(
        snapshot.items.map((item) => ({
          id: item.id,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          discountCents: item.discountCents,
          subtotalCents: item.subtotalCents,
          totalCents: item.totalCents,
          sortOrder: item.sortOrder,
        })),
        [
          {
            id: "item-zero",
            quantity: 1,
            unitPriceCents: 0,
            discountCents: 0,
            subtotalCents: 0,
            totalCents: 0,
            sortOrder: 20,
          },
          {
            id: "item-full-discount",
            quantity: 2,
            unitPriceCents: 2500,
            discountCents: 5000,
            subtotalCents: 5000,
            totalCents: 0,
            sortOrder: 10,
          },
        ],
      );
    },
  },
  {
    name: "buildQuoteSnapshot freezes rendered header fields",
    run: async () => {
      const snapshot = buildQuoteSnapshot({
        quote: createQuote({
          customer_name: "Ada Customer",
          customer_phone: "11977776666",
          payment_terms: "Pix em 2 parcelas",
          delivery_terms: "Entrega em 10 dias",
          warranty_terms: "Garantia de 12 meses",
          valid_until: "2026-10-01",
          created_at: "2026-09-04T12:00:00.000Z",
        }),
        items: [createItem()],
        settings,
        store,
        lead,
        quoteKind: "preliminary",
      });

      assert.equal(snapshot.quote.customerName, "Ada Customer");
      assert.equal(snapshot.quote.customerPhone, "11977776666");
      assert.equal(snapshot.quote.quoteKind, "preliminary");
      assert.equal(
        snapshot.quote.quoteKindNotice,
        "Valores e condicoes sujeitos a conclusao da visita tecnica.",
      );
      assert.equal(snapshot.quote.paymentTerms, "Pix em 2 parcelas");
      assert.equal(snapshot.quote.deliveryTerms, "Entrega em 10 dias");
      assert.equal(snapshot.quote.warrantyTerms, "Garantia de 12 meses");
      assert.equal(snapshot.quote.validUntil, "2026-10-01");
      assert.equal(snapshot.quote.createdAt, "2026-09-04T12:00:00.000Z");
    },
  },
  {
    name: "createQuoteVersion persists the buildQuoteSnapshot payload without monetary mutation",
    run: async () => {
      const recorder = createSupabaseRecorder();
      const quote = createQuote({
        subtotal_cents: 10000,
        discount_cents: 1750,
        total_cents: 8250,
      });
      const snapshot = buildQuoteSnapshot({
        quote,
        items: [
          createItem({
            quantity: 3,
            unit_price_cents: 3333,
            discount_cents: 777,
            subtotal_cents: 9999,
            total_cents: 9222,
          }),
        ],
        settings,
        store,
        lead,
      });

      await createQuoteVersion({
        supabase: recorder.supabase,
        quote,
        versionNumber: 1,
        storeFileId: "file-1",
        storageBucket: "bucket",
        storagePath: "path.pdf",
        originalFilename: "quote.pdf",
        sizeBytes: 123,
        quoteSnapshot: snapshot,
        nextQuoteStatus: "pending_review",
      });

      assert.equal(recorder.rpcs[0].functionName, "create_sales_quote_version_by_system");
      assert.strictEqual(recorder.rpcs[0].args.p_quote_snapshot, snapshot);
      assert.deepEqual(recorder.rpcs[0].args.p_quote_snapshot, snapshot);
      assert.equal(recorder.rpcs[0].args.p_version_status, "generated");
      assert.equal(recorder.rpcs[0].args.p_next_quote_status, "pending_review");
    },
  },
  {
    name: "recordQuoteGenerationFailure persists the buildQuoteSnapshot payload without monetary mutation",
    run: async () => {
      const recorder = createSupabaseRecorder();
      const quote = createQuote({
        subtotal_cents: 5000,
        discount_cents: 5000,
        total_cents: 0,
      });
      const snapshot = buildQuoteSnapshot({
        quote,
        items: [
          createItem({
            quantity: 2,
            unit_price_cents: 2500,
            discount_cents: 5000,
            subtotal_cents: 5000,
            total_cents: 0,
          }),
        ],
        settings,
        store,
        lead,
      });

      await recordQuoteGenerationFailure({
        supabase: recorder.supabase,
        quote,
        versionNumber: 2,
        quoteSnapshot: snapshot,
      });

      assert.equal(recorder.rpcs[0].functionName, "create_sales_quote_version_by_system");
      assert.strictEqual(recorder.rpcs[0].args.p_quote_snapshot, snapshot);
      assert.deepEqual(recorder.rpcs[0].args.p_quote_snapshot, snapshot);
      assert.equal(recorder.rpcs[0].args.p_version_status, "failed");
      assert.equal(recorder.rpcs[0].args.p_next_quote_status, null);
    },
  },
  {
    name: "createQuoteVersion sends null quote_kind to the canonical writer",
    run: async () => {
      const recorder = createSupabaseRecorder();

      await createQuoteVersion({
        supabase: recorder.supabase,
        quote: createQuote(),
        versionNumber: 1,
        storeFileId: "file-1",
        storageBucket: "bucket",
        storagePath: "path.pdf",
        originalFilename: "quote.pdf",
        sizeBytes: 123,
        quoteSnapshot: {} as never,
        nextQuoteStatus: "pending_review",
      });

      assert.equal(recorder.rpcs[0].functionName, "create_sales_quote_version_by_system");
      assert.equal(recorder.rpcs[0].args.p_quote_kind, null);
    },
  },
  {
    name: "explicit quoteKind is persisted",
    run: async () => {
      const recorder = createSupabaseRecorder();

      await createQuoteVersion({
        supabase: recorder.supabase,
        quote: createQuote(),
        versionNumber: 1,
        storeFileId: "file-1",
        storageBucket: "bucket",
        storagePath: "path.pdf",
        originalFilename: "quote.pdf",
        sizeBytes: 123,
        quoteSnapshot: {} as never,
        nextQuoteStatus: "pending_review",
        quoteKind: "definitive",
      });

      assert.equal(recorder.rpcs[0].args.p_quote_kind, "definitive");
    },
  },
  {
    name: "generation failure preserves null quote_kind",
    run: async () => {
      const recorder = createSupabaseRecorder();

      await recordQuoteGenerationFailure({
        supabase: recorder.supabase,
        quote: createQuote(),
        versionNumber: 2,
        quoteSnapshot: {} as never,
      });

      assert.equal(recorder.rpcs[0].functionName, "create_sales_quote_version_by_system");
      assert.equal(recorder.rpcs[0].args.p_quote_kind, null);
    },
  },
];

async function main() {
  for (const test of tests) {
    await test.run();
  }

  console.log(`quote-versioning: ${tests.length} tests passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
