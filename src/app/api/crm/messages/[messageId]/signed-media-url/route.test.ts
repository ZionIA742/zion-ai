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

type QueryCall = {
  table: string;
  columns: string;
  filters: Array<{ column: string; value: unknown }>;
};

type QueryResponse = {
  data: unknown;
  error: { message: string } | null;
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
  reasonCode: StoreApiAccessDenied["payload"]["reasonCode"],
  error = "STORE_API_ACCESS_DENIED",
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
      reasonCode,
      message: "Mensagem interna.",
    },
    httpStatus,
    payload: {
      ok: false,
      error,
      message: "Mensagem publica.",
      status,
      reasonCode,
    },
  };
}

function createGrantedAccess(
  overrides?: Partial<StoreApiAccessGranted>,
): StoreApiAccessGranted {
  return {
    ok: true,
    supabase: {} as StoreApiAccessGranted["supabase"],
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

function createQueryBuilder(
  calls: QueryCall[],
  table: string,
  columns: string,
  queue: QueryResponse[],
) {
  const filters: Array<{ column: string; value: unknown }> = [];

  return {
    eq(column: string, value: unknown) {
      filters.push({ column, value });
      return this;
    },
    async maybeSingle() {
      calls.push({
        table,
        columns,
        filters: [...filters],
      });

      return queue.shift() ?? { data: null, error: null };
    },
  };
}

function createPrivilegedClientMock(args?: {
  messages?: QueryResponse[];
  conversations?: QueryResponse[];
  leads?: QueryResponse[];
  signedUrl?: string | null;
  signedUrlError?: { message: string } | null;
}) {
  const queryCalls: QueryCall[] = [];
  const storageCalls: Array<{ bucket: string; path: string; expiresIn: number }> = [];
  const queues = {
    messages: [...(args?.messages ?? [])],
    conversations: [...(args?.conversations ?? [])],
    leads: [...(args?.leads ?? [])],
  };

  return {
    queryCalls,
    storageCalls,
    from(table: string) {
      return {
        select(columns: string) {
          if (table === "messages") {
            return createQueryBuilder(queryCalls, table, columns, queues.messages);
          }

          if (table === "conversations") {
            return createQueryBuilder(queryCalls, table, columns, queues.conversations);
          }

          if (table === "leads") {
            return createQueryBuilder(queryCalls, table, columns, queues.leads);
          }

          throw new Error(`Unexpected table ${table}`);
        },
      };
    },
    storage: {
      from(bucket: string) {
        return {
          async createSignedUrl(path: string, expiresIn: number) {
            storageCalls.push({ bucket, path, expiresIn });
            return {
              data: args?.signedUrl ? { signedUrl: args.signedUrl } : null,
              error: args?.signedUrlError ?? null,
            };
          },
        };
      },
    },
  };
}

function buildRequest() {
  return new Request("https://example.test/api/crm/messages/message-1/signed-media-url");
}

function buildContext(messageId = "message-1") {
  return {
    params: Promise.resolve({ messageId }),
  };
}

async function parseBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

const tests: TestCase[] = [
  {
    name: "active account receives signed url for media from canonical store",
    run: async () => {
      const { createSignedMediaUrlGetHandler } = await loadRouteModule();
      let resolveCount = 0;
      let clientCreateCount = 0;
      const client = createPrivilegedClientMock({
        messages: [
          {
            data: {
              id: "message-1",
              organization_id: "access-org",
              store_id: "access-store",
              conversation_id: "conversation-1",
              lead_id: "lead-1",
              message_type: "image",
              media_url: "access-org/access-store/lead-1/media/file.jpg",
              metadata: {
                storage_bucket: "zion-store-files",
                storage_path: "access-org/access-store/lead-1/media/file.jpg",
                mime_type: "image/jpeg",
                original_file_name: "file.jpg",
                attachment_kind: "image",
              },
            },
            error: null,
          },
        ],
        conversations: [
          {
            data: {
              id: "conversation-1",
              organization_id: "access-org",
              lead_id: "lead-1",
            },
            error: null,
          },
        ],
        leads: [
          {
            data: {
              id: "lead-1",
              organization_id: "access-org",
              store_id: "access-store",
            },
            error: null,
          },
        ],
        signedUrl: "https://signed.example.test/file.jpg",
      });

      const handler = createSignedMediaUrlGetHandler({
        resolveAccess: async () => {
          resolveCount += 1;
          return createGrantedAccess();
        },
        createPrivilegedClient: () => {
          clientCreateCount += 1;
          return client as never;
        },
      });

      const response = await handler(buildRequest(), buildContext());
      const body = await parseBody(response);

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.signedUrl, "https://signed.example.test/file.jpg");
      assert.equal(body.mimeType, "image/jpeg");
      assert.equal(body.attachmentKind, "image");
      assert.equal(body.fileName, "file.jpg");
      assert.equal(body.expiresInSeconds, 60);
      assert.equal(resolveCount, 1);
      assert.equal(clientCreateCount, 1);
      assert.equal(client.queryCalls.length, 3);
      assert.deepEqual(client.queryCalls[0], {
        table: "messages",
        columns:
          "id, organization_id, store_id, conversation_id, lead_id, message_type, media_url, metadata",
        filters: [
          { column: "id", value: "message-1" },
          { column: "organization_id", value: "access-org" },
        ],
      });
      assert.deepEqual(client.queryCalls[1], {
        table: "conversations",
        columns: "id, organization_id, lead_id",
        filters: [
          { column: "id", value: "conversation-1" },
          { column: "organization_id", value: "access-org" },
        ],
      });
      assert.deepEqual(client.queryCalls[2], {
        table: "leads",
        columns: "id, organization_id, store_id",
        filters: [
          { column: "id", value: "lead-1" },
          { column: "organization_id", value: "access-org" },
          { column: "store_id", value: "access-store" },
        ],
      });
      assert.deepEqual(client.storageCalls, [
        {
          bucket: "zion-store-files",
          path: "access-org/access-store/lead-1/media/file.jpg",
          expiresIn: 60,
        },
      ]);
    },
  },
  {
    name: "onboarding account receives 409 before message or storage lookup",
    run: async () => {
      const { createSignedMediaUrlGetHandler } = await loadRouteModule();
      let clientCreateCount = 0;
      const client = createPrivilegedClientMock();
      const handler = createSignedMediaUrlGetHandler({
        resolveAccess: async () =>
          createDeniedAccess(
            409,
            "store_ready_onboarding_required",
            "onboarding_required",
            "STORE_API_REQUIREMENT_MISMATCH",
          ),
        createPrivilegedClient: () => {
          clientCreateCount += 1;
          return client as never;
        },
      });

      const response = await handler(buildRequest(), buildContext());
      const body = await parseBody(response);

      assert.equal(response.status, 409);
      assert.equal(body.ok, false);
      assert.equal(body.error, "STORE_API_REQUIREMENT_MISMATCH");
      assert.equal(body.reasonCode, "onboarding_required");
      assert.equal(clientCreateCount, 0);
      assert.equal(client.queryCalls.length, 0);
      assert.equal(client.storageCalls.length, 0);
    },
  },
  {
    name: "anonymous user stays denied before message or storage lookup",
    run: async () => {
      const { createSignedMediaUrlGetHandler } = await loadRouteModule();
      const client = createPrivilegedClientMock();
      const handler = createSignedMediaUrlGetHandler({
        resolveAccess: async () =>
          createDeniedAccess(
            401,
            "anonymous",
            "anonymous",
            "STORE_API_UNAUTHENTICATED",
          ),
        createPrivilegedClient: () => client as never,
      });

      const response = await handler(buildRequest(), buildContext());
      const body = await parseBody(response);

      assert.equal(response.status, 401);
      assert.equal(body.error, "STORE_API_UNAUTHENTICATED");
      assert.equal(client.queryCalls.length, 0);
      assert.equal(client.storageCalls.length, 0);
    },
  },
  {
    name: "missing membership and multiple org or store remain fail closed through wrapper contract",
    run: async () => {
      const { createSignedMediaUrlGetHandler } = await loadRouteModule();
      const cases = [
        createDeniedAccess(409, "store_missing_membership", "missing_membership"),
        createDeniedAccess(409, "store_multi_org_unsupported", "multi_org_unsupported"),
        createDeniedAccess(409, "store_multi_store_unsupported", "multi_store_unsupported"),
      ];

      for (const denied of cases) {
        const client = createPrivilegedClientMock();
        const handler = createSignedMediaUrlGetHandler({
          resolveAccess: async () => denied,
          createPrivilegedClient: () => client as never,
        });
        const response = await handler(buildRequest(), buildContext());
        const body = await parseBody(response);

        assert.equal(response.status, 409);
        assert.equal(body.reasonCode, denied.payload.reasonCode);
        assert.equal(client.queryCalls.length, 0);
        assert.equal(client.storageCalls.length, 0);
      }
    },
  },
  {
    name: "message from another organization is denied and does not hit storage",
    run: async () => {
      const { createSignedMediaUrlGetHandler } = await loadRouteModule();
      const client = createPrivilegedClientMock({
        messages: [{ data: null, error: null }],
      });
      const handler = createSignedMediaUrlGetHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => client as never,
      });

      const response = await handler(buildRequest(), buildContext());
      const body = await parseBody(response);

      assert.equal(response.status, 404);
      assert.equal(body.error, "MESSAGE_NOT_FOUND");
      assert.equal(client.queryCalls.length, 1);
      assert.equal(client.storageCalls.length, 0);
    },
  },
  {
    name: "path from another tenant is denied and does not create signed url",
    run: async () => {
      const { createSignedMediaUrlGetHandler } = await loadRouteModule();
      const client = createPrivilegedClientMock({
        messages: [
          {
            data: {
              id: "message-1",
              organization_id: "access-org",
              store_id: "access-store",
              conversation_id: "conversation-1",
              lead_id: "lead-1",
              message_type: "image",
              media_url: "other-org/other-store/lead-1/media/file.jpg",
              metadata: {
                storage_bucket: "zion-store-files",
                storage_path: "other-org/other-store/lead-1/media/file.jpg",
                mime_type: "image/jpeg",
                original_file_name: "file.jpg",
                attachment_kind: "image",
              },
            },
            error: null,
          },
        ],
        conversations: [
          {
            data: {
              id: "conversation-1",
              organization_id: "access-org",
              lead_id: "lead-1",
            },
            error: null,
          },
        ],
        leads: [
          {
            data: {
              id: "lead-1",
              organization_id: "access-org",
              store_id: "access-store",
            },
            error: null,
          },
        ],
      });
      const handler = createSignedMediaUrlGetHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => client as never,
      });

      const response = await handler(buildRequest(), buildContext());
      const body = await parseBody(response);

      assert.equal(response.status, 403);
      assert.equal(body.error, "STORE_SCOPE_INCONSISTENT");
      assert.equal(client.storageCalls.length, 0);
    },
  },
  {
    name: "message store from another tenant is denied and does not create signed url",
    run: async () => {
      const { createSignedMediaUrlGetHandler } = await loadRouteModule();
      const client = createPrivilegedClientMock({
        messages: [
          {
            data: {
              id: "message-1",
              organization_id: "access-org",
              store_id: "other-store",
              conversation_id: "conversation-1",
              lead_id: "lead-1",
              message_type: "image",
              media_url: "access-org/access-store/lead-1/media/file.jpg",
              metadata: {
                storage_bucket: "zion-store-files",
                storage_path: "access-org/access-store/lead-1/media/file.jpg",
                mime_type: "image/jpeg",
                original_file_name: "file.jpg",
                attachment_kind: "image",
              },
            },
            error: null,
          },
        ],
        conversations: [
          {
            data: {
              id: "conversation-1",
              organization_id: "access-org",
              lead_id: "lead-1",
            },
            error: null,
          },
        ],
        leads: [
          {
            data: {
              id: "lead-1",
              organization_id: "access-org",
              store_id: "access-store",
            },
            error: null,
          },
        ],
      });
      const handler = createSignedMediaUrlGetHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => client as never,
      });

      const response = await handler(buildRequest(), buildContext());
      const body = await parseBody(response);

      assert.equal(response.status, 403);
      assert.equal(body.error, "STORE_SCOPE_INCONSISTENT");
      assert.equal(client.storageCalls.length, 0);
    },
  },
  {
    name: "signed url generation failure preserves public response format",
    run: async () => {
      const { createSignedMediaUrlGetHandler } = await loadRouteModule();
      const client = createPrivilegedClientMock({
        messages: [
          {
            data: {
              id: "message-1",
              organization_id: "access-org",
              store_id: "access-store",
              conversation_id: "conversation-1",
              lead_id: "lead-1",
              message_type: "image",
              media_url: "access-org/access-store/lead-1/media/file.jpg",
              metadata: {
                storage_bucket: "zion-store-files",
                storage_path: "access-org/access-store/lead-1/media/file.jpg",
                mime_type: "image/jpeg",
                original_file_name: "file.jpg",
                attachment_kind: "image",
              },
            },
            error: null,
          },
        ],
        conversations: [
          {
            data: {
              id: "conversation-1",
              organization_id: "access-org",
              lead_id: "lead-1",
            },
            error: null,
          },
        ],
        leads: [
          {
            data: {
              id: "lead-1",
              organization_id: "access-org",
              store_id: "access-store",
            },
            error: null,
          },
        ],
        signedUrlError: { message: "storage failed" },
      });
      const handler = createSignedMediaUrlGetHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => client as never,
      });

      const response = await handler(buildRequest(), buildContext());
      const body = await parseBody(response);

      assert.equal(response.status, 500);
      assert.equal(body.error, "SIGNED_URL_GENERATION_FAILED");
      assert.equal(body.message, "storage failed");
      assert.equal(client.storageCalls.length, 1);
    },
  },
  {
    name: "production route uses resolveStoreApiAccess and no longer performs membership auth",
    run: () => {
      const source = readFileSync(
        join(
          process.cwd(),
          "src/app/api/crm/messages/[messageId]/signed-media-url/route.ts",
        ),
        "utf8",
      );

      assert.equal(source.includes("resolveStoreApiAccess"), true);
      assert.equal(source.includes('requirement: "active"'), true);
      assert.equal(source.includes("createSupabaseServerClient"), false);
      assert.equal(source.includes('.from("memberships")'), false);
      assert.equal(source.includes('.from("stores")'), false);
      assert.equal(source.includes("access.organizationId"), true);
      assert.equal(source.includes("access.storeId"), true);
    },
  },
];

async function main() {
  let passed = 0;

  for (const test of tests) {
    try {
      await test.run();
      passed += 1;
    } catch (error) {
      console.error(`FAIL ${test.name}`);
      throw error;
    }
  }

  console.log(`signed-media-url-route: ${passed}/${tests.length} tests passed`);
}

void main();
