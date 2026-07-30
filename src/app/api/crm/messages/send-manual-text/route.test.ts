import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  handleSendManualTextPost,
} from "./route";
import type {
  StoreApiAccessDenied,
  StoreApiAccessGranted,
} from "@/lib/server/store-api-access";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

type QueryRecord = {
  table: string;
  columns: string;
  filters: Record<string, unknown>;
};

function createDeniedAccess(
  httpStatus: 401 | 403 | 409 | 503,
  status: StoreApiAccessDenied["payload"]["status"],
): StoreApiAccessDenied {
  return {
    ok: false,
    resolution: {
      domain: "store_area",
      status,
      sessionUserId: null,
      safeHtmlDestination: "/account/access-blocked",
      apiDecision: "deny_409",
      organizationResolution: "none",
      storeResolution: "none",
      organizationId: null,
      storeId: null,
      commercialAccess: "unknown",
      reasonCode: "missing_membership",
      message: "Conta nao esta pronta para usar a API da loja.",
    },
    httpStatus,
    payload: {
      ok: false,
      error:
        httpStatus === 401
          ? "STORE_API_UNAUTHENTICATED"
          : httpStatus === 503
            ? "STORE_API_ACCESS_UNAVAILABLE"
            : httpStatus === 403
              ? "STORE_API_FORBIDDEN"
              : "STORE_API_ACCESS_DENIED",
      message: "Mensagem publica.",
      status,
      reasonCode: "missing_membership",
    },
  };
}

function createGrantedAccess(
  overrides?: Partial<StoreApiAccessGranted>,
): StoreApiAccessGranted {
  return {
    ok: true,
    supabase: {
      rpc: async () => ({
        data: {
          id: "panel-message-id",
          metadata: {
            source: "panel",
          },
        },
        error: null,
      }),
    } as unknown as StoreApiAccessGranted["supabase"],
    resolution: {
      domain: "store_area",
      status: "store_ready_active",
      sessionUserId: "user-1",
      safeHtmlDestination: "/crm",
      apiDecision: "allow",
      organizationResolution: "single",
      storeResolution: "single",
      organizationId: "access-org",
      storeId: "access-store",
      commercialAccess: "allowed",
      reasonCode: "missing_membership",
      message: "Conta liberada.",
    },
    sessionUserId: "user-1",
    organizationId: "access-org",
    storeId: "access-store",
    ...overrides,
  };
}

function createJsonRequest(
  bodyFactory: () => unknown | Promise<unknown>,
  tracker: { reads: number },
) {
  return {
    json: async () => {
      tracker.reads += 1;
      return bodyFactory();
    },
  } as unknown as Request;
}

function createServiceSupabaseMock(args?: {
  conversation?: ConversationFixture | null;
  conversationError?: unknown;
  lead?: LeadFixture | null;
  leadError?: unknown;
  insertMessageResult?: { data: unknown; error: unknown };
}) {
  const queries: QueryRecord[] = [];
  const rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = [];

  const supabase = {
    queries,
    rpcCalls,
    from(table: string) {
      const state: QueryRecord = {
        table,
        columns: "",
        filters: {},
      };

      return {
        select(columns: string) {
          state.columns = columns;
          return this;
        },
        eq(column: string, value: unknown) {
          state.filters[column] = value;
          return this;
        },
        async maybeSingle() {
          queries.push({
            table: state.table,
            columns: state.columns,
            filters: { ...state.filters },
          });

          if (table === "conversations") {
            if (args?.conversationError) {
              return { data: null, error: args.conversationError };
            }
            return { data: args?.conversation ?? null, error: null };
          }

          if (table === "leads") {
            if (args?.leadError) {
              return { data: null, error: args.leadError };
            }
            return { data: args?.lead ?? null, error: null };
          }

          return { data: null, error: null };
        },
      };
    },
    async rpc(name: string, params: Record<string, unknown>) {
      rpcCalls.push({ name, params });
      return args?.insertMessageResult ?? { data: null, error: null };
    },
  };

  return supabase;
}

type ConversationFixture = {
  id: string;
  organization_id: string;
  store_id: string | null;
  lead_id: string | null;
};

type LeadFixture = {
  id: string;
  organization_id: string;
  store_id: string | null;
};

const tests: TestCase[] = [
  {
    name: "401 403 409 and 503 denied statuses are preserved",
    run: async () => {
      for (const [httpStatus, status] of [
        [401, "anonymous"],
        [403, "cross_domain_forbidden"],
        [409, "store_missing_membership"],
        [503, "access_resolution_unavailable"],
      ] as const) {
        const requestReads = { reads: 0 };
        let createServiceCalls = 0;
        let resolveCalls = 0;

        const response = await handleSendManualTextPost(
          createJsonRequest(() => {
            throw new Error("body must not be read");
          }, requestReads),
          {
            resolveStoreAccess: async () => {
              resolveCalls += 1;
              return createDeniedAccess(httpStatus, status);
            },
            createServiceSupabaseClient: () => {
              createServiceCalls += 1;
              throw new Error("service role must not be created");
            },
            isRealWhatsappConversation: async () => false,
          },
        );

        const body = (await response.json()) as Record<string, unknown>;
        assert.equal(response.status, httpStatus);
        assert.equal(body.status, status);
        assert.equal(response.headers.get("Cache-Control"), "no-store");
        assert.equal(requestReads.reads, 0);
        assert.equal(createServiceCalls, 0);
        assert.equal(resolveCalls, 1);
      }
    },
  },
  {
    name: "body organizationId and storeId are ignored in favor of canonical access scope",
    run: async () => {
      const requestReads = { reads: 0 };
      const serviceSupabase = createServiceSupabaseMock({
        conversation: {
          id: "conversation-1",
          organization_id: "access-org",
          store_id: "access-store",
          lead_id: "lead-1",
        },
        lead: {
          id: "lead-1",
          organization_id: "access-org",
          store_id: "access-store",
        },
      });
      const panelRpcCalls: Array<Record<string, unknown>> = [];
      let createServiceCalls = 0;

      const response = await handleSendManualTextPost(
        createJsonRequest(
          () => ({
            organizationId: "body-org",
            storeId: "body-store",
            conversationId: "conversation-1",
            text: "hello",
          }),
          requestReads,
        ),
        {
          resolveStoreAccess: async () =>
            createGrantedAccess({
              organizationId: "access-org",
              storeId: "access-store",
              supabase: {
              rpc: async (_name: string, params: Record<string, unknown>) => {
                panelRpcCalls.push(params);
                return {
                    data: {
                      id: "message-1",
                      metadata: {
                        source: "panel",
                      },
                    },
                    error: null,
                  };
                },
              } as unknown as StoreApiAccessGranted["supabase"],
            }),
          createServiceSupabaseClient: () => {
            createServiceCalls += 1;
            return serviceSupabase as never;
          },
          isRealWhatsappConversation: async () => false,
        },
      );

      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(response.status, 200);
      assert.deepEqual(body, {
        ok: true,
        messageId: "message-1",
        route: "manual_text_panel",
        externalEligible: false,
        metadata: {
          source: "panel",
        },
      });
      assert.equal(requestReads.reads, 1);
      assert.equal(createServiceCalls, 1);
      assert.deepEqual(serviceSupabase.queries[0]?.filters, {
        id: "conversation-1",
        organization_id: "access-org",
        store_id: "access-store",
      });
      assert.deepEqual(serviceSupabase.queries[1]?.filters, {
        id: "lead-1",
        organization_id: "access-org",
        store_id: "access-store",
      });
      assert.deepEqual(panelRpcCalls[0], {
        p_organization_id: "access-org",
        p_conversation_id: "conversation-1",
        p_text: "hello",
      });
    },
  },
  {
    name: "conversation from another store is rejected before persistence",
    run: async () => {
      const serviceSupabase = createServiceSupabaseMock({
        conversation: null,
      });
      let createServiceCalls = 0;
      let panelRpcCalls = 0;

      const response = await handleSendManualTextPost(
        createJsonRequest(
          () => ({
            conversationId: "foreign-conversation",
            text: "hello",
          }),
          { reads: 0 },
        ),
        {
          resolveStoreAccess: async () => createGrantedAccess(),
          createServiceSupabaseClient: () => {
            createServiceCalls += 1;
            return serviceSupabase as never;
          },
          isRealWhatsappConversation: async () => {
            throw new Error("must not check whatsapp before scope");
          },
        },
      );

      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(response.status, 404);
      assert.equal(body.error, "CONVERSATION_NOT_FOUND_OR_FORBIDDEN");
      assert.equal(body.message, "Conversa nao encontrada para a loja informada.");
      assert.equal(createServiceCalls, 1);
      assert.equal(serviceSupabase.rpcCalls.length, 0);
      assert.equal(panelRpcCalls, 0);
    },
  },
  {
    name: "conversation from another organization is rejected by canonical scope query",
    run: async () => {
      const serviceSupabase = createServiceSupabaseMock({
        conversation: null,
      });

      const response = await handleSendManualTextPost(
        createJsonRequest(
          () => ({
            conversationId: "foreign-org-conversation",
            text: "hello",
          }),
          { reads: 0 },
        ),
        {
          resolveStoreAccess: async () =>
            createGrantedAccess({
              organizationId: "access-org",
              storeId: "access-store",
            }),
          createServiceSupabaseClient: () => serviceSupabase as never,
          isRealWhatsappConversation: async () => false,
        },
      );

      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(response.status, 404);
      assert.equal(body.error, "CONVERSATION_NOT_FOUND_OR_FORBIDDEN");
      assert.deepEqual(serviceSupabase.queries[0]?.filters, {
        id: "foreign-org-conversation",
        organization_id: "access-org",
        store_id: "access-store",
      });
      assert.equal(serviceSupabase.rpcCalls.length, 0);
    },
  },
  {
    name: "lead is derived from validated conversation and must match canonical scope",
    run: async () => {
      const serviceSupabase = createServiceSupabaseMock({
        conversation: {
          id: "conversation-1",
          organization_id: "access-org",
          store_id: "access-store",
          lead_id: "lead-1",
        },
        lead: null,
      });
      let whatsappChecks = 0;

      const response = await handleSendManualTextPost(
        createJsonRequest(
          () => ({
            conversationId: "conversation-1",
            text: "hello",
          }),
          { reads: 0 },
        ),
        {
          resolveStoreAccess: async () => createGrantedAccess(),
          createServiceSupabaseClient: () => serviceSupabase as never,
          isRealWhatsappConversation: async () => {
            whatsappChecks += 1;
            return false;
          },
        },
      );

      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(response.status, 404);
      assert.equal(body.error, "LEAD_NOT_FOUND_OR_FORBIDDEN");
      assert.deepEqual(serviceSupabase.queries[1]?.filters, {
        id: "lead-1",
        organization_id: "access-org",
        store_id: "access-store",
      });
      assert.equal(whatsappChecks, 0);
      assert.equal(serviceSupabase.rpcCalls.length, 0);
    },
  },
  {
    name: "service role is created only after gate and basic field validation",
    run: async () => {
      let createServiceCalls = 0;
      let resolveCalls = 0;

      const response = await handleSendManualTextPost(
        createJsonRequest(
          () => ({
            conversationId: "",
            text: "",
          }),
          { reads: 0 },
        ),
        {
          resolveStoreAccess: async () => {
            resolveCalls += 1;
            return createGrantedAccess();
          },
          createServiceSupabaseClient: () => {
            createServiceCalls += 1;
            throw new Error("service role must not be created");
          },
          isRealWhatsappConversation: async () => false,
        },
      );

      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(resolveCalls, 1);
      assert.equal(createServiceCalls, 0);
      assert.equal(response.status, 400);
      assert.equal(body.error, "MISSING_FIELDS");
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    },
  },
  {
    name: "whatsapp success preserves the current payload contract",
    run: async () => {
      const serviceSupabase = createServiceSupabaseMock({
        conversation: {
          id: "conversation-1",
          organization_id: "access-org",
          store_id: "access-store",
          lead_id: "lead-1",
        },
        lead: {
          id: "lead-1",
          organization_id: "access-org",
          store_id: "access-store",
        },
        insertMessageResult: {
          data: { id: "whatsapp-message-id" },
          error: null,
        },
      });

      const response = await handleSendManualTextPost(
        createJsonRequest(
          () => ({
            conversationId: "conversation-1",
            text: "hello",
          }),
          { reads: 0 },
        ),
        {
          resolveStoreAccess: async () => createGrantedAccess(),
          createServiceSupabaseClient: () => serviceSupabase as never,
          isRealWhatsappConversation: async () => true,
        },
      );

      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(response.status, 200);
      assert.deepEqual(body, {
        ok: true,
        messageId: "whatsapp-message-id",
        route: "manual_text_whatsapp",
        externalEligible: true,
        metadata: {
          source: "panel",
          channel: "whatsapp",
          external_channel: "whatsapp",
          send_external: true,
          outbound_origin: "crm_manual_text",
          whatsapp_detected_from_conversation: true,
        },
      });
      assert.equal(serviceSupabase.rpcCalls.length, 1);
      assert.equal(serviceSupabase.rpcCalls[0]?.name, "insert_message");
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    },
  },
  {
    name: "technical failures are sanitized and do not leak raw provider messages",
    run: async () => {
      const serviceSupabase = createServiceSupabaseMock({
        conversationError: {
          message: "select * from conversations leaked detail",
        },
      });

      const response = await handleSendManualTextPost(
        createJsonRequest(
          () => ({
            conversationId: "conversation-1",
            text: "hello",
          }),
          { reads: 0 },
        ),
        {
          resolveStoreAccess: async () => createGrantedAccess(),
          createServiceSupabaseClient: () => serviceSupabase as never,
          isRealWhatsappConversation: async () => false,
        },
      );

      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(response.status, 500);
      assert.equal(body.error, "CONVERSATION_LOOKUP_FAILED");
      assert.equal(body.message, "Nao foi possivel validar a conversa informada.");
      assert.equal(String(body.message).includes("select *"), false);
    },
  },
  {
    name: "unexpected failures are sanitized with no-store",
    run: async () => {
      const response = await handleSendManualTextPost(
        createJsonRequest(
          () => ({
            conversationId: "conversation-1",
            text: "hello",
          }),
          { reads: 0 },
        ),
        {
          resolveStoreAccess: async () => createGrantedAccess(),
          createServiceSupabaseClient: () => {
            throw new Error("service role key leaked");
          },
          isRealWhatsappConversation: async () => false,
        },
      );

      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(response.status, 500);
      assert.equal(body.error, "SEND_MANUAL_TEXT_ROUTE_FAILED");
      assert.equal(body.message, "Erro interno ao enviar texto manual.");
      assert.equal(String(body.message).includes("service role key leaked"), false);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    },
  },
  {
    name: "route source uses canonical store gate and does not use legacy auth calls",
    run: () => {
      const source = readFileSync(join(__dirname, "route.ts"), "utf8");

      assert.equal(source.includes("resolveStoreApiAccess"), true);
      assert.equal(source.includes("createStoreApiDeniedResponse"), true);
      assert.equal(source.includes("createSupabaseServerClient"), false);
      assert.equal(source.includes("auth.getUser"), false);
      assert.equal(source.includes("getSession"), false);
    },
  },
];

async function run() {
  const failures: string[] = [];

  for (const test of tests) {
    try {
      await test.run();
    } catch (error) {
      failures.push(
        `${test.name}: ${error instanceof Error ? error.stack || error.message : String(error)}`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join("\n\n"));
  }
}

void run();
