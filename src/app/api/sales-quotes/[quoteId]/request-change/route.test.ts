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
const writerModulePromise = import("@/lib/server/sales-quotes/quote-change-requests");

async function loadRouteModule() {
  return routeModulePromise;
}

async function loadWriterModule() {
  return writerModulePromise;
}

function createQuote(overrides?: Record<string, unknown>) {
  return {
    id: "quote-1",
    organization_id: "org-1",
    store_id: "store-1",
    commercial_opportunity_id: "opp-1",
    conversation_id: "conv-1",
    lead_id: "lead-1",
    quote_number: "ORC-001",
    title: "Orcamento",
    status: "draft",
    customer_name: "Cliente",
    customer_phone: "+5511999999999",
    customer_notes: null,
    internal_notes: null,
    payment_terms: null,
    delivery_terms: null,
    warranty_terms: null,
    valid_until: null,
    subtotal_cents: 30000,
    discount_cents: 0,
    total_cents: 30000,
    current_version_id: "version-1",
    last_change_request_id: null,
    metadata: {},
    created_at: "2026-09-22T12:00:00.000Z",
    updated_at: "2026-09-22T12:00:00.000Z",
    ...overrides,
  } as any;
}

function createScope(args?: { quote?: ReturnType<typeof createQuote>; supabase?: any }) {
  const quote = args?.quote ?? createQuote();
  return {
    user: { id: "user-1" },
    supabase:
      args?.supabase ??
      ({
        from() {
          throw new Error("request-change route should not write tables directly");
        },
      } as any),
    organizationId: quote.organization_id,
    store: {
      id: quote.store_id,
      organization_id: quote.organization_id,
      name: "Store 1",
    },
    conversation: {
      id: quote.conversation_id,
      organization_id: quote.organization_id,
      lead_id: quote.lead_id,
    },
    lead: {
      id: quote.lead_id,
      organization_id: quote.organization_id,
      store_id: quote.store_id,
      name: "Cliente",
      phone: "+5511999999999",
    },
    quote,
  };
}

function createRequest(requestText = "Trocar o filtro por outro modelo") {
  return new Request("https://example.test", {
    method: "POST",
    body: JSON.stringify({ request_text: requestText }),
    headers: { "content-type": "application/json" },
  });
}

async function parseBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

const tests: TestCase[] = [
  {
    name: "draft quote em qualificacao prepara conversa antes do guard e conclui request-change",
    run: async () => {
      const { createRequestChangePostHandler } = await loadRouteModule();
      const calls: string[] = [];
      const handler = createRequestChangePostHandler({
        resolveQuoteScope: async () => {
          calls.push("resolve");
          return createScope({ quote: createQuote({ status: "draft" }) }) as never;
        },
        ensureConversationReady: async (payload) => {
          calls.push("prepare");
          assert.equal(payload.actorUserId, "user-1");
          assert.equal(payload.organizationId, "org-1");
          assert.equal(payload.conversationId, "conv-1");
          assert.equal(payload.leadId, "lead-1");
          assert.equal(payload.source, "quote_change_request");
          return {
            transitioned: true,
            currentState: "orcamento",
            skippedReason: "transitioned",
          };
        },
        canInsertEvent: async (payload) => {
          calls.push("guard");
          assert.equal(payload.eventType, "orcamento_alteracao_solicitada");
          return {
            allowed: true,
            currentState: "orcamento",
            skippedReason: "rule_found",
          };
        },
        requestQuoteChange: async (payload) => {
          calls.push("writer");
          assert.equal(payload.quote.id, "quote-1");
          assert.equal(payload.organizationId, "org-1");
          assert.equal(payload.storeId, "store-1");
          assert.equal(payload.conversationId, "conv-1");
          assert.equal(payload.leadId, "lead-1");
          assert.equal(payload.requestText, "Trocar o filtro por outro modelo");
          return {
            quoteId: "quote-1",
            changeRequestId: "change-1",
            status: "changes_requested",
            eventCreated: true,
            reusedExistingRequest: false,
          };
        },
      });

      const response = await handler(createRequest(), {
        params: Promise.resolve({ quoteId: "quote-1" }),
      });
      const body = await parseBody(response);

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.changeRequestId, "change-1");
      assert.equal(body.status, "changes_requested");
      assert.equal(body.reusedExistingRequest, false);
      assert.equal(body.replayed, false);
      assert.deepEqual(calls, ["resolve", "prepare", "guard", "writer"]);
    },
  },
  {
    name: "falha na preparacao de estado bloqueia antes de qualquer mutacao request-change",
    run: async () => {
      const { createRequestChangePostHandler } = await loadRouteModule();
      let guardCalls = 0;
      let writerCalls = 0;
      const handler = createRequestChangePostHandler({
        resolveQuoteScope: async () => createScope() as never,
        ensureConversationReady: async () => {
          throw new QuoteAccessError(
            409,
            "QUOTE_CRM_TRANSITION_FAILED",
            "transicao recusada",
          );
        },
        canInsertEvent: async () => {
          guardCalls += 1;
          throw new Error("guard should not run after preparation failure");
        },
        requestQuoteChange: async () => {
          writerCalls += 1;
          throw new Error("writer should not run after preparation failure");
        },
      });

      const response = await handler(createRequest(), {
        params: Promise.resolve({ quoteId: "quote-1" }),
      });
      const body = await parseBody(response);

      assert.equal(response.status, 409);
      assert.equal(body.error, "QUOTE_CRM_TRANSITION_FAILED");
      assert.equal(guardCalls, 0);
      assert.equal(writerCalls, 0);
    },
  },
  {
    name: "event guard continua negando sem mutacao request-change",
    run: async () => {
      const { createRequestChangePostHandler } = await loadRouteModule();
      let writerCalls = 0;
      const handler = createRequestChangePostHandler({
        resolveQuoteScope: async () => createScope() as never,
        ensureConversationReady: async () => ({
          transitioned: false,
          currentState: "orcamento",
          skippedReason: "already_allowed",
        }),
        canInsertEvent: async () => ({
          allowed: false,
          currentState: "qualificacao",
          skippedReason: "rule_not_found",
        }),
        requestQuoteChange: async () => {
          writerCalls += 1;
          throw new Error("writer should not run when guard denies");
        },
      });

      const response = await handler(createRequest(), {
        params: Promise.resolve({ quoteId: "quote-1" }),
      });
      const body = await parseBody(response);

      assert.equal(response.status, 409);
      assert.equal(body.error, "QUOTE_EVENT_NOT_ALLOWED");
      assert.equal(writerCalls, 0);
    },
  },
  {
    name: "falha do writer atomico nao dispara escrita direta de fallback",
    run: async () => {
      const { createRequestChangePostHandler } = await loadRouteModule();
      let writerCalls = 0;
      let directTableAccess = 0;
      const handler = createRequestChangePostHandler({
        resolveQuoteScope: async () =>
          createScope({
            supabase: {
              from() {
                directTableAccess += 1;
                throw new Error("direct table access should not happen");
              },
            },
          }) as never,
        ensureConversationReady: async () => ({
          transitioned: false,
          currentState: "orcamento",
          skippedReason: "already_allowed",
        }),
        canInsertEvent: async () => ({
          allowed: true,
          currentState: "orcamento",
          skippedReason: "rule_found",
        }),
        requestQuoteChange: async () => {
          writerCalls += 1;
          throw new Error("simulated atomic writer rollback after attempted operation");
        },
      });

      const response = await handler(createRequest(), {
        params: Promise.resolve({ quoteId: "quote-1" }),
      });
      const body = await parseBody(response);

      assert.equal(response.status, 500);
      assert.equal(body.error, "UNEXPECTED_ERROR");
      assert.equal(writerCalls, 1);
      assert.equal(directTableAccess, 0);
    },
  },
  {
    name: "escopo cruzado organization store quote e negado pelo writer",
    run: async () => {
      const { createRequestChangePostHandler } = await loadRouteModule();
      const handler = createRequestChangePostHandler({
        resolveQuoteScope: async () => createScope() as never,
        ensureConversationReady: async () => ({
          transitioned: false,
          currentState: "orcamento",
          skippedReason: "already_allowed",
        }),
        canInsertEvent: async () => ({
          allowed: true,
          currentState: "orcamento",
          skippedReason: "rule_found",
        }),
        requestQuoteChange: async () => {
          throw new QuoteAccessError(
            403,
            "QUOTE_SCOPE_MISMATCH",
            "escopo cruzado",
          );
        },
      });

      const response = await handler(createRequest(), {
        params: Promise.resolve({ quoteId: "quote-1" }),
      });
      const body = await parseBody(response);

      assert.equal(response.status, 403);
      assert.equal(body.error, "QUOTE_SCOPE_MISMATCH");
    },
  },
  {
    name: "estado open incoerente falha fechado sem duplicata silenciosa",
    run: async () => {
      const { createRequestChangePostHandler } = await loadRouteModule();
      const handler = createRequestChangePostHandler({
        resolveQuoteScope: async () => createScope() as never,
        ensureConversationReady: async () => ({
          transitioned: false,
          currentState: "orcamento",
          skippedReason: "already_allowed",
        }),
        canInsertEvent: async () => ({
          allowed: true,
          currentState: "orcamento",
          skippedReason: "rule_found",
        }),
        requestQuoteChange: async () => {
          throw new QuoteAccessError(
            409,
            "QUOTE_CHANGE_REQUEST_INCONSISTENT_OPEN",
            "request open incoerente",
          );
        },
      });

      const response = await handler(createRequest(), {
        params: Promise.resolve({ quoteId: "quote-1" }),
      });
      const body = await parseBody(response);

      assert.equal(response.status, 409);
      assert.equal(body.error, "QUOTE_CHANGE_REQUEST_INCONSISTENT_OPEN");
    },
  },
  {
    name: "replay coerente retorna mesmo changeRequestId sem quebrar caller",
    run: async () => {
      const { createRequestChangePostHandler } = await loadRouteModule();
      const handler = createRequestChangePostHandler({
        resolveQuoteScope: async () => createScope() as never,
        ensureConversationReady: async () => ({
          transitioned: false,
          currentState: "orcamento",
          skippedReason: "already_allowed",
        }),
        canInsertEvent: async () => ({
          allowed: true,
          currentState: "orcamento",
          skippedReason: "rule_found",
        }),
        requestQuoteChange: async () => ({
          quoteId: "quote-1",
          changeRequestId: "change-existing",
          status: "changes_requested",
          eventCreated: false,
          reusedExistingRequest: true,
        }),
      });

      const response = await handler(createRequest(), {
        params: Promise.resolve({ quoteId: "quote-1" }),
      });
      const body = await parseBody(response);

      assert.equal(response.status, 200);
      assert.equal(body.changeRequestId, "change-existing");
      assert.equal(body.reusedExistingRequest, true);
      assert.equal(body.replayed, true);
    },
  },
  {
    name: "writer adapter chama somente a RPC atomica e valida retorno de sucesso",
    run: async () => {
      const { requestQuoteChangeAtomically } = await loadWriterModule();
      const rpcCalls: Array<{ name: string; payload: Record<string, unknown> }> = [];
      const supabase = {
        rpc: async (name: string, payload: Record<string, unknown>) => {
          rpcCalls.push({ name, payload });
          return {
            data: [
              {
                quote_id: "quote-1",
                change_request_id: "change-1",
                status: "changes_requested",
                event_created: true,
                reused_existing_request: false,
              },
            ],
            error: null,
          };
        },
        from() {
          throw new Error("direct table write should not be used");
        },
      };

      const result = await requestQuoteChangeAtomically({
        supabase,
        quote: createQuote(),
        organizationId: "org-1",
        storeId: "store-1",
        conversationId: "conv-1",
        leadId: "lead-1",
        requestText: "Trocar item",
      });

      assert.equal(result.changeRequestId, "change-1");
      assert.equal(result.status, "changes_requested");
      assert.equal(result.reusedExistingRequest, false);
      assert.equal(rpcCalls.length, 1);
      assert.equal(rpcCalls[0].name, "request_sales_quote_change_by_system");
      assert.equal(rpcCalls[0].payload.p_quote_id, "quote-1");
      assert.equal(rpcCalls[0].payload.p_request_text, "Trocar item");
    },
  },
  {
    name: "writer adapter mapeia guard negado pelo banco para 409 sem mutacao parcial aparente",
    run: async () => {
      const { requestQuoteChangeAtomically } = await loadWriterModule();
      const supabase = {
        rpc: async () => ({
          data: null,
          error: { message: "ZION_QUOTE_EVENT_NOT_ALLOWED" },
        }),
      };

      await assert.rejects(
        () =>
          requestQuoteChangeAtomically({
            supabase,
            quote: createQuote(),
            organizationId: "org-1",
            storeId: "store-1",
            conversationId: "conv-1",
            leadId: "lead-1",
            requestText: "Trocar item",
          }),
        (error: unknown) =>
          Boolean(
            error &&
              typeof error === "object" &&
              (error as { code?: string }).code === "QUOTE_EVENT_NOT_ALLOWED",
          ),
      );
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
        `not ok - ${testCase.name}\n${
          error instanceof Error ? error.stack || error.message : String(error)
        }`,
      );
    }
  }

  if (failures.length > 0) {
    process.stderr.write(`${failures.join("\n")}\n`);
    process.exitCode = 1;
  }
})();
