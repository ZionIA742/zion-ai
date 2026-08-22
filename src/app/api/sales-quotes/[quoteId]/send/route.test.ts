import { strict as assert } from "node:assert";
import Module from "node:module";
import { join } from "node:path";

type TestCase = { name: string; run: () => Promise<void> | void };

type VersionFixture = {
  id: string;
  quote_id: string;
  organization_id: string;
  store_id: string;
  version_number: number | null;
  status: string | null;
  store_file_id: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  original_filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  quote_snapshot: Record<string, unknown> | null;
  created_at: string | null;
  sent_at: string | null;
};

type QuoteFixture = {
  id: string;
  organization_id: string;
  store_id: string;
  commercial_opportunity_id: string | null;
  conversation_id: string | null;
  lead_id: string | null;
  quote_number: string | null;
  status: string | null;
  current_version_id: string | null;
};

const projectSrcPath = join(process.cwd(), "src");
type ResolveFilenameHook = (
  request: string,
  parent: unknown,
  isMain: boolean,
  options: unknown,
) => string;
type ModuleWithResolveFilename = typeof Module & { _resolveFilename: ResolveFilenameHook };
const moduleWithResolveFilename = Module as ModuleWithResolveFilename;
const originalResolveFilename = moduleWithResolveFilename._resolveFilename;

moduleWithResolveFilename._resolveFilename = function resolveFilenamePatched(
  request: string,
  parent: unknown,
  isMain: boolean,
  options: unknown,
) {
  if (request.startsWith("@/")) {
    const nextRequest = join(projectSrcPath, request.slice(2));
    return originalResolveFilename.call(this, nextRequest, parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const routeModulePromise = import("./route");
async function loadRouteModule() {
  return routeModulePromise;
}

function createQuoteFixture(overrides?: Partial<QuoteFixture>): QuoteFixture {
  return {
    id: "quote-1",
    organization_id: "org-1",
    store_id: "store-1",
    commercial_opportunity_id: "opp-1",
    conversation_id: "conv-1",
    lead_id: "lead-1",
    quote_number: "ORC-001",
    status: "approved",
    current_version_id: "version-1",
    ...overrides,
  };
}

function createVersionFixture(overrides?: Partial<VersionFixture>): VersionFixture {
  return {
    id: "version-1",
    quote_id: "quote-1",
    organization_id: "org-1",
    store_id: "store-1",
    version_number: 1,
    status: "approved",
    store_file_id: null,
    storage_bucket: "zion-store-files",
    storage_path: "org-1/store-1/sales-quotes/quote-1/orc-001-v0001.pdf",
    original_filename: "orc-001-v0001.pdf",
    mime_type: "application/pdf",
    size_bytes: 1024,
    quote_snapshot: {},
    created_at: "2026-08-14T12:00:00.000Z",
    sent_at: null,
    ...overrides,
  };
}

function createSupabaseRecorder(args: {
  version: VersionFixture;
  storeFile?: Record<string, unknown> | null;
}) {
  return {
    from(table: string) {
      return {
        select() {
          const builder = {
            eq() { return builder; },
            maybeSingle: async () => {
              if (table === "sales_quote_versions") return { data: args.version, error: null };
              if (table === "store_files") return { data: args.storeFile ?? null, error: null };
              return { data: null, error: null };
            },
          };
          return builder;
        },
      };
    },
  };
}

function createScope(args?: {
  quote?: QuoteFixture;
  supabase?: ReturnType<typeof createSupabaseRecorder>;
}) {
  const quote = args?.quote ?? createQuoteFixture();
  const supabase = args?.supabase ?? createSupabaseRecorder({
    version: createVersionFixture({
      id: String(quote.current_version_id || "version-1"),
      quote_id: quote.id,
    }),
  });
  return {
    user: { id: "user-1" },
    supabase,
    organizationId: quote.organization_id,
    store: { id: quote.store_id, organization_id: quote.organization_id, name: "Store 1" },
    quote,
  };
}

function createSettingsResult(overrides?: Partial<{
  quotePdfEnabled: boolean;
  aiCanGenerateQuote: boolean;
  aiCanSendQuoteToCustomer: boolean;
  requiresHumanApprovalBeforeSend: boolean;
}>) {
  return {
    row: null,
    settings: {
      quotePdfEnabled: true,
      aiCanGenerateQuote: true,
      aiCanSendQuoteToCustomer: true,
      requiresHumanApprovalBeforeSend: false,
      quoteNumberPrefix: "ORC",
      nextQuoteNumber: 2,
      ...overrides,
    },
  };
}

function createOperation(overrides?: Partial<Record<string, unknown>>) {
  return {
    message_id: "message-1",
    outbound_idempotency_key:
      "sales_quote_send:org-1:store-1:opp-1:quote-1:version-1",
    outbound_delivery_state: "pending",
    commercial_opportunity_id: "opp-1",
    sales_quote_id: "quote-1",
    sales_quote_version_id: "version-1",
    external_message_id: null,
    outcome: "queued",
    ...overrides,
  };
}

async function parseBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

const tests: TestCase[] = [
  {
    name: "first send materializes canonical PDF document metadata without marking quote sent",
    run: async () => {
      const { createSendQuotePostHandler } = await loadRouteModule();
      const quote = createQuoteFixture();
      const version = createVersionFixture();
      const calls: Array<Record<string, unknown>> = [];
      const handler = createSendQuotePostHandler({
        resolveQuoteScope: async () => createScope({
          quote,
          supabase: createSupabaseRecorder({ version }),
        }) as never,
        loadQuoteSettings: async () => createSettingsResult() as never,
        materializeQuoteSend: async (payload: Record<string, unknown>) => {
          calls.push(payload);
          return createOperation() as never;
        },
      });
      const response = await handler(new Request("https://example.test"), {
        params: Promise.resolve({ quoteId: "quote-1" }),
      });
      const body = await parseBody(response);
      assert.equal(response.status, 200);
      assert.equal(body.sendState, "queued");
      assert.equal(calls.length, 1);
      const metadata = calls[0]?.messageMetadata as Record<string, unknown>;
      assert.equal(metadata.outbound_origin, "sales_quote_send");
      assert.equal(metadata.storage_bucket, "zion-store-files");
      assert.equal(metadata.mime_type, "application/pdf");
      assert.equal(metadata.original_file_name, "orc-001-v0001.pdf");
      assert.equal(metadata.sales_quote_id, "quote-1");
      assert.equal(metadata.sales_quote_version_id, "version-1");
      assert.equal(quote.status, "approved");
      assert.equal(version.sent_at, null);
    },
  },
  {
    name: "same operation can return already_queued without creating another logical send",
    run: async () => {
      const { createSendQuotePostHandler } = await loadRouteModule();
      const handler = createSendQuotePostHandler({
        resolveQuoteScope: async () => createScope() as never,
        loadQuoteSettings: async () => createSettingsResult() as never,
        materializeQuoteSend: async () => createOperation({ outcome: "already_queued" }) as never,
      });
      const response = await handler(new Request("https://example.test"), {
        params: Promise.resolve({ quoteId: "quote-1" }),
      });
      const body = await parseBody(response);
      assert.equal(response.status, 200);
      assert.equal(body.sendState, "already_queued");
      assert.equal(body.messageId, "message-1");
    },
  },
  {
    name: "existing uncertain operation returns 409 and never pretends a new send was queued",
    run: async () => {
      const { createSendQuotePostHandler } = await loadRouteModule();
      const handler = createSendQuotePostHandler({
        resolveQuoteScope: async () => createScope() as never,
        loadQuoteSettings: async () => createSettingsResult() as never,
        materializeQuoteSend: async () =>
          createOperation({ outcome: "uncertain", outbound_delivery_state: "uncertain" }) as never,
      });
      const response = await handler(new Request("https://example.test"), {
        params: Promise.resolve({ quoteId: "quote-1" }),
      });
      const body = await parseBody(response);
      assert.equal(response.status, 409);
      assert.equal(body.error, "QUOTE_SEND_UNCERTAIN_REQUIRES_RECONCILIATION");
    },
  },
  {
    name: "existing failed operation returns 409 for explicit review",
    run: async () => {
      const { createSendQuotePostHandler } = await loadRouteModule();
      const handler = createSendQuotePostHandler({
        resolveQuoteScope: async () => createScope() as never,
        loadQuoteSettings: async () => createSettingsResult() as never,
        materializeQuoteSend: async () =>
          createOperation({ outcome: "failed", outbound_delivery_state: "failed" }) as never,
      });
      const response = await handler(new Request("https://example.test"), {
        params: Promise.resolve({ quoteId: "quote-1" }),
      });
      const body = await parseBody(response);
      assert.equal(response.status, 409);
      assert.equal(body.error, "QUOTE_SEND_FAILED_REQUIRES_REVIEW");
    },
  },
  {
    name: "already sent current version returns already_sent without materializing",
    run: async () => {
      const { createSendQuotePostHandler } = await loadRouteModule();
      let materialized = false;
      const handler = createSendQuotePostHandler({
        resolveQuoteScope: async () => createScope({
          quote: createQuoteFixture({ status: "sent" }),
          supabase: createSupabaseRecorder({
            version: createVersionFixture({
              status: "sent",
              sent_at: "2026-08-14T18:00:00.000Z",
            }),
          }),
        }) as never,
        loadQuoteSettings: async () => createSettingsResult() as never,
        materializeQuoteSend: async () => {
          materialized = true;
          return createOperation() as never;
        },
      });
      const response = await handler(new Request("https://example.test"), {
        params: Promise.resolve({ quoteId: "quote-1" }),
      });
      const body = await parseBody(response);
      assert.equal(response.status, 200);
      assert.equal(body.sendState, "already_sent");
      assert.equal(materialized, false);
    },
  },
  {
    name: "explicit opportunity is required",
    run: async () => {
      const { createSendQuotePostHandler } = await loadRouteModule();
      const handler = createSendQuotePostHandler({
        resolveQuoteScope: async () => createScope({
          quote: createQuoteFixture({ commercial_opportunity_id: null }),
        }) as never,
      });
      const response = await handler(new Request("https://example.test"), {
        params: Promise.resolve({ quoteId: "quote-1" }),
      });
      const body = await parseBody(response);
      assert.equal(response.status, 409);
      assert.equal(body.error, "QUOTE_COMMERCIAL_OPPORTUNITY_REQUIRED");
    },
  },
  {
    name: "superseded current version is refused before materialization",
    run: async () => {
      const { createSendQuotePostHandler } = await loadRouteModule();
      let materialized = false;
      const handler = createSendQuotePostHandler({
        resolveQuoteScope: async () => createScope({
          supabase: createSupabaseRecorder({
            version: createVersionFixture({ status: "superseded", sent_at: null }),
          }),
        }) as never,
        loadQuoteSettings: async () => createSettingsResult() as never,
        materializeQuoteSend: async () => {
          materialized = true;
          return createOperation() as never;
        },
      });
      const response = await handler(new Request("https://example.test"), {
        params: Promise.resolve({ quoteId: "quote-1" }),
      });
      const body = await parseBody(response);
      assert.equal(response.status, 409);
      assert.equal(body.error, "QUOTE_VERSION_NOT_SENDABLE");
      assert.equal(materialized, false);
    },
  },
  {
    name: "non-PDF artifact is refused",
    run: async () => {
      const { createSendQuotePostHandler } = await loadRouteModule();
      const handler = createSendQuotePostHandler({
        resolveQuoteScope: async () => createScope({
          supabase: createSupabaseRecorder({
            version: createVersionFixture({ mime_type: "image/png" }),
          }),
        }) as never,
        loadQuoteSettings: async () => createSettingsResult() as never,
      });
      const response = await handler(new Request("https://example.test"), {
        params: Promise.resolve({ quoteId: "quote-1" }),
      });
      const body = await parseBody(response);
      assert.equal(response.status, 409);
      assert.equal(body.error, "QUOTE_FILE_NOT_PDF");
    },
  },
  {
    name: "explicit store_file_id must resolve inside the same tenant",
    run: async () => {
      const { createSendQuotePostHandler } = await loadRouteModule();
      const handler = createSendQuotePostHandler({
        resolveQuoteScope: async () => createScope({
          supabase: createSupabaseRecorder({
            version: createVersionFixture({ store_file_id: "file-missing" }),
            storeFile: null,
          }),
        }) as never,
        loadQuoteSettings: async () => createSettingsResult() as never,
      });
      const response = await handler(new Request("https://example.test"), {
        params: Promise.resolve({ quoteId: "quote-1" }),
      });
      const body = await parseBody(response);
      assert.equal(response.status, 409);
      assert.equal(body.error, "QUOTE_STORE_FILE_NOT_FOUND");
    },
  },
  {
    name: "human approval gate remains enforced when store requires it",
    run: async () => {
      const { createSendQuotePostHandler } = await loadRouteModule();
      const handler = createSendQuotePostHandler({
        resolveQuoteScope: async () => createScope({
          quote: createQuoteFixture({ status: "generated" }),
        }) as never,
        loadQuoteSettings: async () =>
          createSettingsResult({ requiresHumanApprovalBeforeSend: true }) as never,
      });
      const response = await handler(new Request("https://example.test"), {
        params: Promise.resolve({ quoteId: "quote-1" }),
      });
      const body = await parseBody(response);
      assert.equal(response.status, 409);
      assert.equal(body.error, "QUOTE_REQUIRES_APPROVAL");
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
