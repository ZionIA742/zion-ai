import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createSimulateCustomerPostHandler } from "./handler";
import type {
  StoreApiAccessDenied,
  StoreApiAccessGranted,
} from "../../../lib/server/store-api-access";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

type QueryCall = {
  table: string;
  columns: string;
  eqs: Array<{ field: string; value: unknown }>;
};

function createGrantedAccess(): StoreApiAccessGranted {
  return {
    ok: true,
    supabase: {} as never,
    resolution: {
      domain: "store_area",
      status: "store_ready_active",
      sessionUserId: "user-1",
      safeHtmlDestination: "/crm",
      apiDecision: "allow",
      organizationResolution: "single",
      storeResolution: "single",
      organizationId: "server-org",
      storeId: "server-store",
      commercialAccess: "allowed",
      reasonCode: "ready_active",
      message: "Conta pronta.",
    },
    sessionUserId: "user-1",
    organizationId: "server-org",
    storeId: "server-store",
  };
}

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
      safeHtmlDestination:
        httpStatus === 503 ? "/account/access-unavailable" : "/account/access-blocked",
      apiDecision:
        httpStatus === 401
          ? "deny_401"
          : httpStatus === 403
            ? "deny_403"
            : httpStatus === 503
              ? "deny_503"
              : "deny_409",
      organizationResolution: "none",
      storeResolution: "none",
      organizationId: null,
      storeId: null,
      commercialAccess: "unknown",
      reasonCode: "missing_membership",
      message: "Acesso negado.",
    },
    httpStatus,
    payload: {
      ok: false,
      error:
        httpStatus === 401
          ? "STORE_API_UNAUTHENTICATED"
          : httpStatus === 403
            ? "STORE_API_FORBIDDEN"
            : httpStatus === 503
              ? "STORE_API_ACCESS_UNAVAILABLE"
              : "STORE_API_ACCESS_DENIED",
      message: `public-${httpStatus}`,
      status,
      reasonCode: "missing_membership",
    },
  };
}

function createRequest(
  body: unknown,
  hooks?: { onJson?: () => void; jsonThrows?: boolean },
): Request {
  return {
    async json() {
      hooks?.onJson?.();
      if (hooks?.jsonThrows) {
        throw new Error("JSON_BODY_SENTINEL");
      }
      return body;
    },
  } as Request;
}

function createFakeSupabase(options?: {
  conversationResult?: { data: unknown; error: { message: string } | null };
  leadResult?: { data: unknown; error: { message: string } | null };
  insertData?: unknown;
  insertError?: { message: string } | null;
  throwOnFromTable?: string | null;
  throwOnMaybeSingleCall?: number | null;
  throwOnRpc?: boolean;
}) {
  const queryCalls: QueryCall[] = [];
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  let maybeSingleCount = 0;

  return {
    client: {
      from(table: string) {
        if (options?.throwOnFromTable === table) {
          throw new Error(`${table.toUpperCase()}_THROW_SENTINEL`);
        }

        const call: QueryCall = {
          table,
          columns: "",
          eqs: [],
        };

        const builder = {
          select(columns: string) {
            call.columns = columns;
            return builder;
          },
          eq(field: string, value: unknown) {
            call.eqs.push({ field, value });
            return builder;
          },
          async maybeSingle<T>() {
            queryCalls.push(call);
            maybeSingleCount += 1;

            if (options?.throwOnMaybeSingleCall === maybeSingleCount) {
              throw new Error(`MAYBE_SINGLE_THROW_${maybeSingleCount}`);
            }

            if (maybeSingleCount === 1) {
              return (options?.conversationResult ?? {
                data: {
                  id: "conv-1",
                  organization_id: "server-org",
                  lead_id: "lead-1",
                  is_human_active: false,
                },
                error: null,
              }) as { data: T | null; error: { message: string } | null };
            }

            return (options?.leadResult ?? {
              data: {
                id: "lead-1",
                organization_id: "server-org",
                store_id: "server-store",
              },
              error: null,
            }) as { data: T | null; error: { message: string } | null };
          },
        };

        return builder;
      },
      async rpc(fn: string, args: Record<string, unknown>) {
        rpcCalls.push({ fn, args });
        if (options?.throwOnRpc) {
          throw new Error("RPC_THROW_SENTINEL");
        }
        return {
          data: options?.insertData ?? "",
          error: options?.insertError ?? null,
        };
      },
    },
    queryCalls,
    rpcCalls,
  };
}

const tests: TestCase[] = [
  {
    name: "401 is preserved",
    run: async () => {
      const handler = createSimulateCustomerPostHandler({
        resolveAccess: async () => createDeniedAccess(401, "anonymous"),
        createDeniedResponse: (access) =>
          Response.json(access.payload, {
            status: access.httpStatus,
            headers: { "Cache-Control": "no-store" },
          }) as never,
      });

      const response = await handler(createRequest({}));
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 401);
      assert.equal(body.message, "public-401");
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    },
  },
  {
    name: "403 is preserved",
    run: async () => {
      const handler = createSimulateCustomerPostHandler({
        resolveAccess: async () =>
          createDeniedAccess(403, "cross_domain_forbidden"),
        createDeniedResponse: (access) =>
          Response.json(access.payload, {
            status: access.httpStatus,
            headers: { "Cache-Control": "no-store" },
          }) as never,
      });

      const response = await handler(createRequest({}));
      assert.equal(response.status, 403);
    },
  },
  {
    name: "409 is preserved",
    run: async () => {
      const handler = createSimulateCustomerPostHandler({
        resolveAccess: async () =>
          createDeniedAccess(409, "store_missing_membership"),
        createDeniedResponse: (access) =>
          Response.json(access.payload, {
            status: access.httpStatus,
            headers: { "Cache-Control": "no-store" },
          }) as never,
      });

      const response = await handler(createRequest({}));
      assert.equal(response.status, 409);
    },
  },
  {
    name: "503 is preserved",
    run: async () => {
      const handler = createSimulateCustomerPostHandler({
        resolveAccess: async () =>
          createDeniedAccess(503, "access_resolution_unavailable"),
        createDeniedResponse: (access) =>
          Response.json(access.payload, {
            status: access.httpStatus,
            headers: { "Cache-Control": "no-store" },
          }) as never,
      });

      const response = await handler(createRequest({}));
      assert.equal(response.status, 503);
    },
  },
  {
    name: "access denied does not read the body",
    run: async () => {
      let bodyReads = 0;
      const handler = createSimulateCustomerPostHandler({
        resolveAccess: async () => createDeniedAccess(401, "anonymous"),
        createDeniedResponse: (access) =>
          Response.json(access.payload, {
            status: access.httpStatus,
            headers: { "Cache-Control": "no-store" },
          }) as never,
      });

      await handler(
        createRequest({}, {
          onJson: () => {
            bodyReads += 1;
          },
        }),
      );

      assert.equal(bodyReads, 0);
    },
  },
  {
    name: "access denied does not create privileged client query or rpc",
    run: async () => {
      let createClientCalls = 0;
      let aiCalls = 0;
      const handler = createSimulateCustomerPostHandler({
        resolveAccess: async () => createDeniedAccess(403, "store_commercial_blocked"),
        createDeniedResponse: (access) =>
          Response.json(access.payload, {
            status: access.httpStatus,
            headers: { "Cache-Control": "no-store" },
          }) as never,
        createPrivilegedClient: () => {
          createClientCalls += 1;
          throw new Error("should not create");
        },
        runAiFlow: async () => {
          aiCalls += 1;
          return { ok: true };
        },
      });

      await handler(createRequest({ conversationId: "conv-1", text: "Oi" }));

      assert.equal(createClientCalls, 0);
      assert.equal(aiCalls, 0);
    },
  },
  {
    name: "access resolution occurs exactly once",
    run: async () => {
      let resolveCalls = 0;
      const fakeSupabase = createFakeSupabase();
      const handler = createSimulateCustomerPostHandler({
        resolveAccess: async () => {
          resolveCalls += 1;
          return createGrantedAccess();
        },
        createPrivilegedClient: () => fakeSupabase.client as never,
        runAiFlow: async () => ({ ok: true }),
      });

      await handler(createRequest({ conversationId: "conv-1", text: "Oi" }));

      assert.equal(resolveCalls, 1);
    },
  },
  {
    name: "service role is created only after access is granted",
    run: async () => {
      const events: string[] = [];
      const fakeSupabase = createFakeSupabase();
      const handler = createSimulateCustomerPostHandler({
        resolveAccess: async () => {
          events.push("resolveAccess:start");
          events.push("resolveAccess:done");
          return createGrantedAccess();
        },
        createPrivilegedClient: () => {
          events.push("createPrivilegedClient");
          return fakeSupabase.client as never;
        },
        runAiFlow: async () => {
          events.push("runAiFlow");
          return { ok: true };
        },
      });

      await handler(createRequest({ conversationId: "conv-1", text: "Oi" }));

      assert.deepEqual(events.slice(0, 3), [
        "resolveAccess:start",
        "resolveAccess:done",
        "createPrivilegedClient",
      ]);
    },
  },
  {
    name: "organizationId and storeId from the body are ignored",
    run: async () => {
      const fakeSupabase = createFakeSupabase();
      const aiCalls: Array<Record<string, unknown>> = [];
      const handler = createSimulateCustomerPostHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => fakeSupabase.client as never,
        runAiFlow: async (args) => {
          aiCalls.push(args);
          return { ok: true };
        },
      });

      await handler(
        createRequest({
          organizationId: "body-org",
          storeId: "body-store",
          conversationId: "conv-1",
          text: "Oi",
        }),
      );

      const [conversationQuery] = fakeSupabase.queryCalls;
      assert.equal(conversationQuery.eqs[1]?.value, "server-org");
      assert.equal(conversationQuery.eqs.length, 2);
      assert.deepEqual(aiCalls[0], {
        organizationId: "server-org",
        storeId: "server-store",
        conversationId: "conv-1",
      });
    },
  },
  {
    name: "canonical server ids are used in queries",
    run: async () => {
      const fakeSupabase = createFakeSupabase();
      const handler = createSimulateCustomerPostHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => fakeSupabase.client as never,
        runAiFlow: async () => ({ ok: true }),
      });

      await handler(createRequest({ conversationId: "conv-1", text: "Oi" }));

      assert.deepEqual(fakeSupabase.queryCalls[0], {
        table: "conversations",
        columns: "id, organization_id, lead_id, is_human_active",
        eqs: [
          { field: "id", value: "conv-1" },
          { field: "organization_id", value: "server-org" },
        ],
      });
    },
  },
  {
    name: "conversation outside scope is rejected",
    run: async () => {
      const fakeSupabase = createFakeSupabase({
        conversationResult: {
          data: null,
          error: null,
        },
      });
      let aiCalls = 0;
      const handler = createSimulateCustomerPostHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => fakeSupabase.client as never,
        runAiFlow: async () => {
          aiCalls += 1;
          return { ok: true };
        },
      });

      const response = await handler(
        createRequest({ conversationId: "conv-out", text: "Oi" }),
      );
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 404);
      assert.equal(body.error, "SIMULATE_CUSTOMER_CONVERSATION_NOT_AVAILABLE");
      assert.equal(fakeSupabase.queryCalls.length, 1);
      assert.equal(fakeSupabase.rpcCalls.length, 0);
      assert.equal(aiCalls, 0);
    },
  },
  {
    name: "lead id is derived from the conversation",
    run: async () => {
      const fakeSupabase = createFakeSupabase({
        conversationResult: {
          data: {
            id: "conv-1",
            organization_id: "server-org",
            lead_id: "lead-from-conversation",
            is_human_active: false,
          },
          error: null,
        },
      });
      const handler = createSimulateCustomerPostHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => fakeSupabase.client as never,
        runAiFlow: async () => ({ ok: true }),
      });

      await handler(
        createRequest({
          conversationId: "conv-1",
          text: "Oi",
          leadId: "malicious-lead",
        } as Record<string, unknown>),
      );

      const leadQuery = fakeSupabase.queryCalls[1];
      assert.equal(leadQuery.table, "leads");
      assert.equal(leadQuery.eqs[0]?.value, "lead-from-conversation");
    },
  },
  {
    name: "lead is validated in the same organization and store",
    run: async () => {
      const fakeSupabase = createFakeSupabase();
      const handler = createSimulateCustomerPostHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => fakeSupabase.client as never,
        runAiFlow: async () => ({ ok: true }),
      });

      await handler(createRequest({ conversationId: "conv-1", text: "Oi" }));

      assert.deepEqual(fakeSupabase.queryCalls[1], {
        table: "leads",
        columns: "id, organization_id, store_id",
        eqs: [
          { field: "id", value: "lead-1" },
          { field: "organization_id", value: "server-org" },
          { field: "store_id", value: "server-store" },
        ],
      });
    },
  },
  {
    name: "lead from another store is rejected",
    run: async () => {
      const fakeSupabase = createFakeSupabase({
        leadResult: {
          data: null,
          error: null,
        },
      });
      let aiCalls = 0;
      const handler = createSimulateCustomerPostHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => fakeSupabase.client as never,
        runAiFlow: async () => {
          aiCalls += 1;
          return { ok: true };
        },
      });

      const response = await handler(
        createRequest({ conversationId: "conv-1", text: "Oi" }),
      );
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 404);
      assert.equal(body.error, "SIMULATE_CUSTOMER_CONVERSATION_NOT_AVAILABLE");
      assert.equal(fakeSupabase.queryCalls[1]?.table, "leads");
      assert.equal(fakeSupabase.rpcCalls.length, 0);
      assert.equal(aiCalls, 0);
    },
  },
  {
    name: "insert_message uses the validated conversation and AI runs only after validation",
    run: async () => {
      const events: string[] = [];
      const fakeSupabase = createFakeSupabase({
        conversationResult: {
          data: {
            id: "canonical-conversation-id",
            organization_id: "server-org",
            lead_id: "lead-1",
            is_human_active: false,
          },
          error: null,
        },
      });

      const originalRpc = fakeSupabase.client.rpc.bind(fakeSupabase.client);
      fakeSupabase.client.rpc = async (fn, args) => {
        events.push(`rpc:${fn}`);
        return originalRpc(fn, args);
      };

      const handler = createSimulateCustomerPostHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => fakeSupabase.client as never,
        runAiFlow: async () => {
          events.push("runAiFlow");
          return { ok: true };
        },
      });

      await handler(createRequest({ conversationId: "body-conversation", text: "Oi" }));

      assert.equal(fakeSupabase.rpcCalls[0]?.fn, "insert_message");
      assert.equal(
        fakeSupabase.rpcCalls[0]?.args.p_conversation_id,
        "canonical-conversation-id",
      );
      assert.deepEqual(events, ["rpc:insert_message", "runAiFlow"]);
    },
  },
  {
    name: "errors are sanitized",
    run: async () => {
      const handler = createSimulateCustomerPostHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => {
          throw new Error(
            "Verifique NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY",
          );
        },
      });

      const response = await handler(
        createRequest({ conversationId: "conv-1", text: "Oi" }),
      );
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 500);
      assert.equal(body.error, "SIMULATE_CUSTOMER_ROUTE_FAILED");
      assert.equal(
        String(body.message).includes("SUPABASE_SERVICE_ROLE_KEY"),
        false,
      );
      assert.equal(String(body.message).includes("NEXT_PUBLIC_SUPABASE_URL"), false);
    },
  },
  {
    name: "payload success contains only approved public fields",
    run: async () => {
      const fakeSupabase = createFakeSupabase();
      const handler = createSimulateCustomerPostHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => fakeSupabase.client as never,
        runAiFlow: async () => ({ ok: true }),
      });

      const response = await handler(
        createRequest({ conversationId: "conv-1", text: "Oi" }),
      );
      const body = (await response.json()) as Record<string, unknown>;

      assert.deepEqual(Object.keys(body).sort(), [
        "aiReplySaved",
        "customerMessageSaved",
        "message",
        "ok",
      ]);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    },
  },
  {
    name: "req.json throw returns 400 and stops before privileged client creation",
    run: async () => {
      let createClientCalls = 0;
      const handler = createSimulateCustomerPostHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => {
          createClientCalls += 1;
          throw new Error("should not create");
        },
      });

      const response = await handler(
        createRequest({}, { jsonThrows: true }),
      );
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 400);
      assert.equal(body.error, "SIMULATE_CUSTOMER_INVALID_REQUEST");
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(String(JSON.stringify(body)).includes("JSON_BODY_SENTINEL"), false);
      assert.equal(createClientCalls, 0);
    },
  },
  {
    name: "null body returns 400 and stops before privileged client creation",
    run: async () => {
      let createClientCalls = 0;
      const handler = createSimulateCustomerPostHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => {
          createClientCalls += 1;
          throw new Error("should not create");
        },
      });

      const response = await handler(createRequest(null));
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 400);
      assert.equal(body.error, "SIMULATE_CUSTOMER_INVALID_REQUEST");
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(createClientCalls, 0);
    },
  },
  {
    name: "array body returns 400 and stops before privileged client creation",
    run: async () => {
      let createClientCalls = 0;
      const handler = createSimulateCustomerPostHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => {
          createClientCalls += 1;
          throw new Error("should not create");
        },
      });

      const response = await handler(createRequest([]));
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 400);
      assert.equal(body.error, "SIMULATE_CUSTOMER_INVALID_REQUEST");
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(createClientCalls, 0);
    },
  },
  {
    name: "conversation lookup throw returns 500 and stops before rpc and ai flow",
    run: async () => {
      const fakeSupabase = createFakeSupabase({
        throwOnFromTable: "conversations",
      });
      let aiCalls = 0;
      const handler = createSimulateCustomerPostHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => fakeSupabase.client as never,
        runAiFlow: async () => {
          aiCalls += 1;
          return { ok: true };
        },
      });

      const response = await handler(
        createRequest({ conversationId: "conv-1", text: "Oi" }),
      );
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 500);
      assert.equal(body.error, "SIMULATE_CUSTOMER_ROUTE_FAILED");
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(String(JSON.stringify(body)).includes("CONVERSATIONS_THROW_SENTINEL"), false);
      assert.equal(fakeSupabase.rpcCalls.length, 0);
      assert.equal(aiCalls, 0);
    },
  },
  {
    name: "lead lookup throw returns 500 and stops before rpc and ai flow",
    run: async () => {
      const fakeSupabase = createFakeSupabase({
        throwOnMaybeSingleCall: 2,
      });
      let aiCalls = 0;
      const handler = createSimulateCustomerPostHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => fakeSupabase.client as never,
        runAiFlow: async () => {
          aiCalls += 1;
          return { ok: true };
        },
      });

      const response = await handler(
        createRequest({ conversationId: "conv-1", text: "Oi" }),
      );
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 500);
      assert.equal(body.error, "SIMULATE_CUSTOMER_ROUTE_FAILED");
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(String(JSON.stringify(body)).includes("MAYBE_SINGLE_THROW_2"), false);
      assert.equal(fakeSupabase.rpcCalls.length, 0);
      assert.equal(aiCalls, 0);
    },
  },
  {
    name: "rpc throw returns 500 and stops before ai flow",
    run: async () => {
      const fakeSupabase = createFakeSupabase({
        throwOnRpc: true,
      });
      let aiCalls = 0;
      const handler = createSimulateCustomerPostHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => fakeSupabase.client as never,
        runAiFlow: async () => {
          aiCalls += 1;
          return { ok: true };
        },
      });

      const response = await handler(
        createRequest({ conversationId: "conv-1", text: "Oi" }),
      );
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 500);
      assert.equal(body.error, "SIMULATE_CUSTOMER_ROUTE_FAILED");
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(String(JSON.stringify(body)).includes("RPC_THROW_SENTINEL"), false);
      assert.equal(aiCalls, 0);
    },
  },
  {
    name: "operational customer reply routing returns 200 without commercial AI fallback",
    run: async () => {
      const fakeSupabase = createFakeSupabase({
        insertData: "inserted-message-1",
      });
      let aiCalls = 0;
      const handler = createSimulateCustomerPostHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => fakeSupabase.client as never,
        routeOperationalCustomerReply: async (args) => {
          assert.equal(args.messageId, "inserted-message-1");
          assert.equal(args.customerMessage, "Claro podemos remarcar para esse dia e esse horario");
          return {
            handled: true,
            ok: true,
          };
        },
        runAiFlow: async () => {
          aiCalls += 1;
          return { ok: true };
        },
      });

      const response = await handler(
        createRequest({
          conversationId: "conv-1",
          text: "Claro podemos remarcar para esse dia e esse horario",
        }),
      );
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.customerMessageSaved, true);
      assert.equal(body.aiReplySaved, false);
      assert.equal(aiCalls, 0);
    },
  },
  {
    name: "operational customer reply routing failure stays sanitized and blocks commercial AI fallback",
    run: async () => {
      const fakeSupabase = createFakeSupabase({
        insertData: "inserted-message-1",
      });
      let aiCalls = 0;
      const handler = createSimulateCustomerPostHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => fakeSupabase.client as never,
        routeOperationalCustomerReply: async () => ({
          handled: true,
          ok: false,
          error: "QUEUE_PROCESSING_FAILED",
        }),
        runAiFlow: async () => {
          aiCalls += 1;
          return { ok: true };
        },
      });

      const response = await handler(
        createRequest({ conversationId: "conv-1", text: "Claro podemos remarcar para esse dia e esse horario" }),
      );
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 409);
      assert.equal(body.error, "SIMULATE_CUSTOMER_AI_REPLY_UNAVAILABLE");
      assert.equal(body.customerMessageSaved, true);
      assert.equal(body.aiReplySaved, false);
      assert.equal(String(JSON.stringify(body)).includes("QUEUE_PROCESSING_FAILED"), false);
      assert.equal(aiCalls, 0);
    },
  },
  {
    name: "runAiFlow throw returns 409 after insert with sanitized payload",
    run: async () => {
      const fakeSupabase = createFakeSupabase();
      const handler = createSimulateCustomerPostHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => fakeSupabase.client as never,
        runAiFlow: async () => {
          throw new Error("AI_THROW_SENTINEL");
        },
      });

      const response = await handler(
        createRequest({ conversationId: "conv-1", text: "Oi" }),
      );
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 409);
      assert.equal(body.error, "SIMULATE_CUSTOMER_AI_REPLY_UNAVAILABLE");
      assert.equal(body.customerMessageSaved, true);
      assert.equal(body.aiReplySaved, false);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(String(JSON.stringify(body)).includes("AI_THROW_SENTINEL"), false);
      assert.equal(fakeSupabase.rpcCalls.length, 1);
    },
  },
  {
    name: "runAiFlow false result stays sanitized with no internal details",
    run: async () => {
      const fakeSupabase = createFakeSupabase();
      const handler = createSimulateCustomerPostHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => fakeSupabase.client as never,
        runAiFlow: async () => ({
          ok: false,
          error: "AI_INTERNAL_ERROR",
          message: "AI_RETURN_SENTINEL",
        }),
      });

      const response = await handler(
        createRequest({ conversationId: "conv-1", text: "Oi" }),
      );
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 409);
      assert.equal(body.error, "SIMULATE_CUSTOMER_AI_REPLY_UNAVAILABLE");
      assert.equal(body.customerMessageSaved, true);
      assert.equal(body.aiReplySaved, false);
      assert.equal(String(JSON.stringify(body)).includes("AI_RETURN_SENTINEL"), false);
      assert.equal(String(JSON.stringify(body)).includes("AI_INTERNAL_ERROR"), false);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    },
  },
  {
    name: "route.ts does not export factory or extra types",
    run: () => {
      const routeSource = readFileSync(join(__dirname, "route.ts"), "utf8");

      assert.equal(
        routeSource.includes("createSimulateCustomerPostHandler"),
        false,
      );
      assert.equal(routeSource.includes("type "), false);
      assert.equal(
        routeSource.includes(
          'import { POST as simulateCustomerPost } from "./handler";',
        ),
        true,
      );
      assert.equal(routeSource.includes('export const runtime = "nodejs";'), true);
      assert.equal(routeSource.includes("export const POST = simulateCustomerPost;"), true);
    },
  },
  {
    name: "route.ts uses the secure handler",
    run: () => {
      const routeSource = readFileSync(join(__dirname, "route.ts"), "utf8");

      assert.equal(routeSource.includes("simulateCustomerPost"), true);
      assert.equal(routeSource.includes("NextResponse"), false);
      assert.equal(routeSource.includes("createClient"), false);
      assert.equal(routeSource.includes("generateAndSaveAiSalesReply"), false);
    },
  },
];

async function run() {
  for (const test of tests) {
    await test.run();
  }

  console.log(`simulate-customer-handler: ${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
