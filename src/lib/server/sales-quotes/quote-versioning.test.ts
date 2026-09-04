import { strict as assert } from "node:assert";
import {
  createQuoteVersion,
  recordQuoteGenerationFailure,
} from "./quote-versioning";

function createQuote(overrides: Record<string, unknown> = {}) {
  return {
    id: "quote-1",
    organization_id: "org-1",
    store_id: "store-1",
    quote_number: "ORC-1",
    title: "Quote",
    status: "draft",
    customer_notes: null,
    internal_notes: null,
    subtotal_cents: 1000,
    discount_cents: 0,
    total_cents: 1000,
    current_version_id: null,
    ...overrides,
  };
}

function createSupabaseRecorder() {
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];

  return {
    inserts,
    updates,
    supabase: {
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
    name: "legacy createQuoteVersion preserves null quote_kind",
    run: async () => {
      const recorder = createSupabaseRecorder();

      await createQuoteVersion({
        supabase: recorder.supabase,
        quote: createQuote() as never,
        versionNumber: 1,
        storeFileId: "file-1",
        storageBucket: "bucket",
        storagePath: "path.pdf",
        originalFilename: "quote.pdf",
        sizeBytes: 123,
        quoteSnapshot: {} as never,
        nextQuoteStatus: "pending_review",
      });

      assert.equal(recorder.inserts[0].table, "sales_quote_versions");
      assert.equal(recorder.inserts[0].payload.quote_kind, null);
    },
  },
  {
    name: "explicit quoteKind is persisted",
    run: async () => {
      const recorder = createSupabaseRecorder();

      await createQuoteVersion({
        supabase: recorder.supabase,
        quote: createQuote() as never,
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

      assert.equal(recorder.inserts[0].payload.quote_kind, "definitive");
    },
  },
  {
    name: "generation failure preserves null quote_kind",
    run: async () => {
      const recorder = createSupabaseRecorder();

      await recordQuoteGenerationFailure({
        supabase: recorder.supabase,
        quote: createQuote() as never,
        versionNumber: 2,
        quoteSnapshot: {} as never,
      });

      assert.equal(recorder.inserts[0].table, "sales_quote_versions");
      assert.equal(recorder.inserts[0].payload.quote_kind, null);
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
