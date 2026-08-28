import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Module from "node:module";
import type {
  StoreApiAccessDenied,
  StoreApiAccessGranted,
} from "@/lib/server/store-api-access";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

type RpcCall = {
  fn: string;
  args: Record<string, unknown>;
};

const projectSrcPath = join(process.cwd(), "src");
type ResolveFilenameHook = (
  request: string,
  parent: unknown,
  isMain: boolean,
  options: unknown,
) => string;
type ModuleWithResolveFilename = typeof Module & {
  _resolveFilename: ResolveFilenameHook;
};
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

function createDeniedAccess(
  httpStatus: 401 | 403 | 409 | 503,
  status: StoreApiAccessDenied["payload"]["status"],
): StoreApiAccessDenied {
  return {
    ok: false,
    resolution: {
      domain: status === "anonymous" ? "anonymous" : "store_area",
      status,
      sessionUserId: null,
      safeHtmlDestination:
        status === "anonymous" ? "/login" : "/account/access-blocked",
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
      message: "Mensagem interna.",
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

function createSupabaseMock(args?: {
  rpcResult?: { data: unknown; error: { message: string } | null };
}) {
  const rpcCalls: RpcCall[] = [];

  return {
    rpcCalls,
    async rpc(fn: string, rpcArgs: Record<string, unknown>) {
      rpcCalls.push({ fn, args: rpcArgs });
      return args?.rpcResult ?? {
        data: [
          {
            operation_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            lead_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            customer_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
            customer_store_link_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
            lead_customer_link_id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
            commercial_opportunity_id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
            stage: "novo_lead",
            primary_conversation_id: null,
            replayed: false,
            created_at: "2026-08-27T12:00:00.000Z",
          },
        ],
        error: null,
      };
    },
  };
}

function createGrantedAccess(
  overrides?: Partial<StoreApiAccessGranted>,
): StoreApiAccessGranted {
  return {
    ok: true,
    supabase: createSupabaseMock() as unknown as StoreApiAccessGranted["supabase"],
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
      reasonCode: "ready_active",
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

async function parseBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

const OPERATION_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const tests: TestCase[] = [
  {
    name: "denied access preserves wrapper response and does not read the body",
    run: async () => {
      const { createManualCommercialLeadPostHandler } = await loadRouteModule();
      const requestReads = { reads: 0 };

      const response = await createManualCommercialLeadPostHandler({
        resolveAccess: async () =>
          createDeniedAccess(409, "store_missing_membership"),
      })(
        createJsonRequest(() => {
          throw new Error("body must not be read");
        }, requestReads),
      );

      const body = await parseBody(response);
      assert.equal(response.status, 409);
      assert.equal(body.ok, false);
      assert.equal(body.status, "store_missing_membership");
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(requestReads.reads, 0);
    },
  },
  {
    name: "body tenant ids are ignored and rpc receives only authorized scope",
    run: async () => {
      const { createManualCommercialLeadPostHandler } = await loadRouteModule();
      const supabase = createSupabaseMock();

      const response = await createManualCommercialLeadPostHandler({
        resolveAccess: async () =>
          createGrantedAccess({
            organizationId: "access-org",
            storeId: "access-store",
            supabase: supabase as unknown as StoreApiAccessGranted["supabase"],
          }),
      })(
        createJsonRequest(
          () => ({
            organizationId: "body-org",
            storeId: "body-store",
            operationId: OPERATION_ID.toUpperCase(),
            name: "  Cliente Manual  ",
            phone: "  (11) 98888-7766  ",
          }),
          { reads: 0 },
        ),
      );

      const body = await parseBody(response);
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.leadId, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
      assert.equal(
        body.commercialOpportunityId,
        "ffffffff-ffff-ffff-ffff-ffffffffffff",
      );
      assert.equal(body.primaryConversationId, null);
      assert.equal(body.replayed, false);

      assert.equal(supabase.rpcCalls.length, 1);
      assert.deepEqual(supabase.rpcCalls[0], {
        fn: "create_manual_commercial_lead_by_user",
        args: {
          p_request_organization_id: "access-org",
          p_store_id: "access-store",
          p_operation_id: OPERATION_ID,
          p_name: "Cliente Manual",
          p_phone: "(11) 98888-7766",
        },
      });
    },
  },
  {
    name: "missing operation id returns 400 and never calls rpc",
    run: async () => {
      const { createManualCommercialLeadPostHandler } = await loadRouteModule();
      const supabase = createSupabaseMock();

      const response = await createManualCommercialLeadPostHandler({
        resolveAccess: async () =>
          createGrantedAccess({
            supabase: supabase as unknown as StoreApiAccessGranted["supabase"],
          }),
      })(
        createJsonRequest(
          () => ({
            name: "Cliente Manual",
          }),
          { reads: 0 },
        ),
      );

      const body = await parseBody(response);
      assert.equal(response.status, 400);
      assert.equal(body.error, "INVALID_OPERATION_ID");
      assert.equal(supabase.rpcCalls.length, 0);
    },
  },
  {
    name: "invalid operation uuid returns 400 and never calls rpc",
    run: async () => {
      const { createManualCommercialLeadPostHandler } = await loadRouteModule();
      const supabase = createSupabaseMock();

      const response = await createManualCommercialLeadPostHandler({
        resolveAccess: async () =>
          createGrantedAccess({
            supabase: supabase as unknown as StoreApiAccessGranted["supabase"],
          }),
      })(
        createJsonRequest(
          () => ({
            operationId: "not-a-uuid",
            name: "Cliente Manual",
          }),
          { reads: 0 },
        ),
      );

      const body = await parseBody(response);
      assert.equal(response.status, 400);
      assert.equal(body.error, "INVALID_OPERATION_ID");
      assert.equal(supabase.rpcCalls.length, 0);
    },
  },
  {
    name: "blank name and phone return 400 and never call rpc",
    run: async () => {
      const { createManualCommercialLeadPostHandler } = await loadRouteModule();
      const supabase = createSupabaseMock();

      const response = await createManualCommercialLeadPostHandler({
        resolveAccess: async () =>
          createGrantedAccess({
            supabase: supabase as unknown as StoreApiAccessGranted["supabase"],
          }),
      })(
        createJsonRequest(
          () => ({
            operationId: OPERATION_ID,
            name: "   ",
            phone: null,
          }),
          { reads: 0 },
        ),
      );

      const body = await parseBody(response);
      assert.equal(response.status, 400);
      assert.equal(body.error, "MANUAL_COMMERCIAL_LEAD_MISSING_IDENTITY");
      assert.equal(supabase.rpcCalls.length, 0);
    },
  },
  {
    name: "invalid json returns controlled 400",
    run: async () => {
      const { createManualCommercialLeadPostHandler } = await loadRouteModule();
      const supabase = createSupabaseMock();

      const response = await createManualCommercialLeadPostHandler({
        resolveAccess: async () =>
          createGrantedAccess({
            supabase: supabase as unknown as StoreApiAccessGranted["supabase"],
          }),
      })(
        createJsonRequest(
          () => Promise.reject(new SyntaxError("invalid json")),
          { reads: 0 },
        ),
      );

      const body = await parseBody(response);
      assert.equal(response.status, 400);
      assert.equal(body.error, "INVALID_REQUEST_BODY");
      assert.equal(supabase.rpcCalls.length, 0);
    },
  },
  {
    name: "exact replay is returned as success",
    run: async () => {
      const { createManualCommercialLeadPostHandler } = await loadRouteModule();
      const supabase = createSupabaseMock({
        rpcResult: {
          data: [
            {
              operation_id: OPERATION_ID,
              lead_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
              customer_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
              customer_store_link_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
              lead_customer_link_id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
              commercial_opportunity_id:
                "ffffffff-ffff-ffff-ffff-ffffffffffff",
              stage: "novo_lead",
              primary_conversation_id: null,
              replayed: true,
              created_at: "2026-08-27T12:00:00.000Z",
            },
          ],
          error: null,
        },
      });

      const response = await createManualCommercialLeadPostHandler({
        resolveAccess: async () =>
          createGrantedAccess({
            supabase: supabase as unknown as StoreApiAccessGranted["supabase"],
          }),
      })(
        createJsonRequest(
          () => ({
            operationId: OPERATION_ID,
            name: "Cliente Manual",
          }),
          { reads: 0 },
        ),
      );

      const body = await parseBody(response);
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.replayed, true);
      assert.equal(supabase.rpcCalls.length, 1);
    },
  },
  {
    name: "divergent replay returns controlled 409",
    run: async () => {
      const { createManualCommercialLeadPostHandler } = await loadRouteModule();
      const supabase = createSupabaseMock({
        rpcResult: {
          data: null,
          error: {
            message: "manual commercial lead replay payload mismatch",
          },
        },
      });

      const response = await createManualCommercialLeadPostHandler({
        resolveAccess: async () =>
          createGrantedAccess({
            supabase: supabase as unknown as StoreApiAccessGranted["supabase"],
          }),
      })(
        createJsonRequest(
          () => ({
            operationId: OPERATION_ID,
            name: "Payload diferente",
          }),
          { reads: 0 },
        ),
      );

      const body = await parseBody(response);
      assert.equal(response.status, 409);
      assert.equal(body.error, "MANUAL_COMMERCIAL_LEAD_OPERATION_CONFLICT");
    },
  },
  {
    name: "writer authorization failure returns controlled 403",
    run: async () => {
      const { createManualCommercialLeadPostHandler } = await loadRouteModule();
      const supabase = createSupabaseMock({
        rpcResult: {
          data: null,
          error: {
            message: "manual commercial lead creation by user is not authorized",
          },
        },
      });

      const response = await createManualCommercialLeadPostHandler({
        resolveAccess: async () =>
          createGrantedAccess({
            supabase: supabase as unknown as StoreApiAccessGranted["supabase"],
          }),
      })(
        createJsonRequest(
          () => ({
            operationId: OPERATION_ID,
            phone: "(11) 90000-0000",
          }),
          { reads: 0 },
        ),
      );

      const body = await parseBody(response);
      assert.equal(response.status, 403);
      assert.equal(body.error, "MANUAL_COMMERCIAL_LEAD_FORBIDDEN");
    },
  },
  {
    name: "empty rpc result returns controlled 500",
    run: async () => {
      const { createManualCommercialLeadPostHandler } = await loadRouteModule();
      const supabase = createSupabaseMock({
        rpcResult: {
          data: [],
          error: null,
        },
      });

      const response = await createManualCommercialLeadPostHandler({
        resolveAccess: async () =>
          createGrantedAccess({
            supabase: supabase as unknown as StoreApiAccessGranted["supabase"],
          }),
      })(
        createJsonRequest(
          () => ({
            operationId: OPERATION_ID,
            name: "Cliente Manual",
          }),
          { reads: 0 },
        ),
      );

      const body = await parseBody(response);
      assert.equal(response.status, 500);
      assert.equal(body.error, "CREATE_MANUAL_COMMERCIAL_LEAD_EMPTY_RESULT");
    },
  },
  {
    name: "production route uses store access and only the by_user manual writer",
    run: async () => {
      const source = readFileSync(
        join(process.cwd(), "src/app/api/crm/leads/manual/route.ts"),
        "utf8",
      );

      assert.equal(source.includes("resolveStoreApiAccess"), true);
      assert.equal(source.includes('requirement: "active"'), true);
      assert.equal(
        source.includes('"create_manual_commercial_lead_by_user"'),
        true,
      );
      assert.equal(
        source.includes("create_commercial_opportunity_with_context_by_system"),
        false,
      );
      assert.equal(source.includes(".from("), false);
      assert.equal(source.includes(".insert("), false);
      assert.equal(source.includes(".order("), false);
      assert.equal(
        source.includes("p_request_organization_id: access.organizationId"),
        true,
      );
      assert.equal(source.includes("p_store_id: access.storeId"), true);
    },
  },
];

async function run() {
  const failures: string[] = [];

  for (const test of tests) {
    try {
      await test.run();
      process.stdout.write(`ok - ${test.name}\n`);
    } catch (error) {
      failures.push(
        `not ok - ${test.name}\n${
          error instanceof Error ? error.stack || error.message : String(error)
        }`,
      );
    }
  }

  if (failures.length > 0) {
    process.stderr.write(`${failures.join("\n")}\n`);
    process.exit(1);
  }

  process.stdout.write(`1..${tests.length}\n`);
}

void run();
