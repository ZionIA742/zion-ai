import { strict as assert } from "node:assert";
import Module from "node:module";
import { join } from "node:path";
import { QuoteAccessError } from "@/lib/server/sales-quotes/quote-auth";

type TestCase = { name: string; run: () => Promise<void> | void };

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

const QUOTE_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const ORG_ID = "44444444-4444-4444-8444-444444444444";
const STORE_ID = "55555555-5555-4555-8555-555555555555";
const USER_ID = "66666666-6666-4666-8666-666666666666";

async function loadRouteModule() {
  return routeModulePromise;
}

function createQuote(overrides?: Record<string, unknown>) {
  return {
    id: QUOTE_ID,
    organization_id: ORG_ID,
    store_id: STORE_ID,
    commercial_opportunity_id: "77777777-7777-4777-8777-777777777777",
    conversation_id: "88888888-8888-4888-8888-888888888888",
    lead_id: "99999999-9999-4999-8999-999999999999",
    quote_number: "ORC-001",
    title: "Orcamento",
    status: "pending_review",
    customer_name: "Cliente",
    customer_phone: "+5511999999999",
    customer_notes: null,
    internal_notes: null,
    payment_terms: null,
    delivery_terms: null,
    warranty_terms: null,
    valid_until: "2026-12-31",
    subtotal_cents: 30000,
    discount_cents: 0,
    total_cents: 30000,
    current_version_id: VERSION_ID,
    last_change_request_id: null,
    metadata: {},
    created_at: "2026-09-23T12:00:00.000Z",
    updated_at: "2026-09-23T12:00:00.000Z",
    ...overrides,
  } as any;
}

function createVersion(overrides?: Record<string, unknown>) {
  return {
    id: VERSION_ID,
    quote_id: QUOTE_ID,
    organization_id: ORG_ID,
    store_id: STORE_ID,
    version_number: 1,
    status: "pending_review",
    store_file_id: null,
    storage_bucket: "zion-store-files",
    storage_path: "quotes/orc-001.pdf",
    original_filename: "orc-001.pdf",
    mime_type: "application/pdf",
    size_bytes: 1024,
    quote_snapshot: { quote: { validUntil: "2026-12-31" } },
    created_at: "2026-09-23T12:00:00.000Z",
    sent_at: null,
    ...overrides,
  } as any;
}

function createSupabaseRecorder(args?: { version?: any | null }) {
  const calls: Array<{ table: string; action: string }> = [];
  const version = args?.version === undefined ? createVersion() : args.version;

  return {
    calls,
    from(table: string) {
      calls.push({ table, action: "from" });
      assert.equal(
        table,
        "sales_quote_versions",
        "approve route must not touch mutable tables directly",
      );

      const builder = {
        select() {
          calls.push({ table, action: "select" });
          return builder;
        },
        eq() {
          calls.push({ table, action: "eq" });
          return builder;
        },
        maybeSingle: async () => {
          calls.push({ table, action: "maybeSingle" });
          return { data: version, error: null };
        },
      };

      return builder;
    },
  };
}

function createScope(args?: { quote?: any; version?: any | null }) {
  const quote = args?.quote ?? createQuote();
  const supabase = createSupabaseRecorder({ version: args?.version });

  return {
    user: { id: USER_ID },
    supabase,
    organizationId: quote.organization_id,
    store: {
      id: quote.store_id,
      organization_id: quote.organization_id,
      name: "Store 1",
    },
    conversation: null,
    lead: null,
    quote,
  };
}

function createRequest(body: Record<string, unknown> | null = { quoteVersionId: VERSION_ID }) {
  return new Request("https://example.test", {
    method: "POST",
    body: body === null ? undefined : JSON.stringify(body),
    headers: body === null ? undefined : { "content-type": "application/json" },
  });
}

async function parseBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

const tests: TestCase[] = [
  {
    name: "rejects missing quoteVersionId before resolving quote scope",
    run: async () => {
      const { createApproveQuotePostHandler } = await loadRouteModule();
      let resolved = false;
      const handler = createApproveQuotePostHandler({
        resolveQuoteScope: async () => {
          resolved = true;
          return createScope() as never;
        },
      });

      const response = await handler(createRequest({}), {
        params: Promise.resolve({ quoteId: QUOTE_ID }),
      });
      const body = await parseBody(response);

      assert.equal(response.status, 400);
      assert.equal(body.error, "QUOTE_VERSION_REQUIRED");
      assert.equal(resolved, false);
    },
  },
  {
    name: "does not use current_version_id as an approval fallback",
    run: async () => {
      const { createApproveQuotePostHandler } = await loadRouteModule();
      let writerCalls = 0;
      const handler = createApproveQuotePostHandler({
        resolveQuoteScope: async () => createScope() as never,
        approveQuoteVersion: async () => {
          writerCalls += 1;
          throw new Error("writer should not run without explicit body version");
        },
      });

      const response = await handler(createRequest(null), {
        params: Promise.resolve({ quoteId: QUOTE_ID }),
      });
      const body = await parseBody(response);

      assert.equal(response.status, 400);
      assert.equal(body.error, "QUOTE_VERSION_REQUIRED");
      assert.equal(writerCalls, 0);
    },
  },
  {
    name: "approves exactly the explicit current version",
    run: async () => {
      const { createApproveQuotePostHandler } = await loadRouteModule();
      const writerCalls: Array<Record<string, unknown>> = [];
      const handler = createApproveQuotePostHandler({
        resolveQuoteScope: async () => createScope() as never,
        approveQuoteVersion: async (payload: Record<string, unknown>) => {
          writerCalls.push(payload);
          return createVersion({ status: "approved" }) as never;
        },
      });

      const response = await handler(createRequest(), {
        params: Promise.resolve({ quoteId: QUOTE_ID }),
      });
      const body = await parseBody(response);

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.versionId, VERSION_ID);
      assert.equal(writerCalls.length, 1);
      assert.equal(writerCalls[0].quoteId, QUOTE_ID);
      assert.equal(writerCalls[0].versionId, VERSION_ID);
      assert.equal(writerCalls[0].approvedBy, USER_ID);
    },
  },
  {
    name: "rejects stale displayed version without calling the writer",
    run: async () => {
      const { createApproveQuotePostHandler } = await loadRouteModule();
      let writerCalls = 0;
      const handler = createApproveQuotePostHandler({
        resolveQuoteScope: async () =>
          createScope({
            quote: createQuote({ current_version_id: OTHER_VERSION_ID }),
          }) as never,
        approveQuoteVersion: async () => {
          writerCalls += 1;
          throw new Error("writer should not run for a stale version");
        },
      });

      const response = await handler(createRequest(), {
        params: Promise.resolve({ quoteId: QUOTE_ID }),
      });
      const body = await parseBody(response);

      assert.equal(response.status, 409);
      assert.equal(body.error, "QUOTE_VERSION_STALE");
      assert.equal(writerCalls, 0);
    },
  },
  {
    name: "rejects version from another quote",
    run: async () => {
      const { createApproveQuotePostHandler } = await loadRouteModule();
      const handler = createApproveQuotePostHandler({
        resolveQuoteScope: async () =>
          createScope({
            version: createVersion({
              quote_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            }),
          }) as never,
      });

      const response = await handler(createRequest(), {
        params: Promise.resolve({ quoteId: QUOTE_ID }),
      });
      const body = await parseBody(response);

      assert.equal(response.status, 409);
      assert.equal(body.error, "QUOTE_VERSION_QUOTE_MISMATCH");
    },
  },
  {
    name: "rejects missing version deterministically",
    run: async () => {
      const { createApproveQuotePostHandler } = await loadRouteModule();
      const handler = createApproveQuotePostHandler({
        resolveQuoteScope: async () => createScope({ version: null }) as never,
      });

      const response = await handler(createRequest(), {
        params: Promise.resolve({ quoteId: QUOTE_ID }),
      });
      const body = await parseBody(response);

      assert.equal(response.status, 404);
      assert.equal(body.error, "QUOTE_VERSION_NOT_FOUND");
    },
  },
  {
    name: "writer failure does not cause direct sales_quotes mutation",
    run: async () => {
      const { createApproveQuotePostHandler } = await loadRouteModule();
      const scope = createScope();
      const handler = createApproveQuotePostHandler({
        resolveQuoteScope: async () => scope as never,
        approveQuoteVersion: async () => {
          throw new QuoteAccessError(
            409,
            "QUOTE_VERSION_STALE",
            "Existe uma versao mais recente do orcamento.",
          );
        },
      });

      const response = await handler(createRequest(), {
        params: Promise.resolve({ quoteId: QUOTE_ID }),
      });
      const body = await parseBody(response);

      assert.equal(response.status, 409);
      assert.equal(body.error, "QUOTE_VERSION_STALE");
      assert.equal(
        scope.supabase.calls.some((call) => call.table === "sales_quotes"),
        false,
      );
    },
  },
  {
    name: "replay of the same approved version stays stable",
    run: async () => {
      const { createApproveQuotePostHandler } = await loadRouteModule();
      let writerCalls = 0;
      const handler = createApproveQuotePostHandler({
        resolveQuoteScope: async () =>
          createScope({
            quote: createQuote({ status: "approved" }),
            version: createVersion({ status: "approved" }),
          }) as never,
        approveQuoteVersion: async () => {
          writerCalls += 1;
          return createVersion({ status: "approved" }) as never;
        },
      });

      const response = await handler(createRequest(), {
        params: Promise.resolve({ quoteId: QUOTE_ID }),
      });
      const body = await parseBody(response);

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.alreadyApproved, true);
      assert.equal(body.replayed, true);
      assert.equal(writerCalls, 1);
    },
  },
  {
    name: "expired snapshot blocks before writer",
    run: async () => {
      const { createApproveQuotePostHandler } = await loadRouteModule();
      let writerCalls = 0;
      const handler = createApproveQuotePostHandler({
        resolveQuoteScope: async () =>
          createScope({
            quote: createQuote({ valid_until: "2099-12-31" }),
            version: createVersion({
              quote_snapshot: { quote: { validUntil: "2026-01-01" } },
            }),
          }) as never,
        approveQuoteVersion: async () => {
          writerCalls += 1;
          throw new Error("writer should not run after expiration failure");
        },
      });

      const response = await handler(createRequest(), {
        params: Promise.resolve({ quoteId: QUOTE_ID }),
      });
      const body = await parseBody(response);

      assert.equal(response.status, 409);
      assert.equal(body.error, "QUOTE_VERSION_EXPIRED");
      assert.equal(writerCalls, 0);
    },
  },
];

for (const testCase of tests) {
  await testCase.run();
}

console.log(`approve route tests passed (${tests.length}/${tests.length})`);
