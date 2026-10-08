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
    in(column: string, value: unknown[]) {
      filters.push({ column, value });
      return this;
    },
    order() {
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
  pools?: QueryResponse[];
  poolPhotos?: QueryResponse[];
  catalogItems?: QueryResponse[];
  catalogPhotos?: QueryResponse[];
  signedUrl?: string | null;
  signedUrlError?: { message: string } | null;
}) {
  const queryCalls: QueryCall[] = [];
  const storageCalls: Array<{ bucket: string; path: string; expiresIn: number }> = [];
  const queues = {
    messages: [...(args?.messages ?? [])],
    conversations: [...(args?.conversations ?? [])],
    leads: [...(args?.leads ?? [])],
    pools: [...(args?.pools ?? [])],
    pool_photos: [...(args?.poolPhotos ?? [])],
    store_catalog_items: [...(args?.catalogItems ?? [])],
    store_catalog_item_photos: [...(args?.catalogPhotos ?? [])],
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

          if (table === "pools") return createQueryBuilder(queryCalls, table, columns, queues.pools);
          if (table === "pool_photos") return createQueryBuilder(queryCalls, table, columns, queues.pool_photos);
          if (table === "store_catalog_items") return createQueryBuilder(queryCalls, table, columns, queues.store_catalog_items);
          if (table === "store_catalog_item_photos") return createQueryBuilder(queryCalls, table, columns, queues.store_catalog_item_photos);

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
    name: "valid private pool catalog photo is revalidated by canonical lineage",
    run: async () => {
      const { createSignedMediaUrlGetHandler } = await loadRouteModule();
      const client = createPrivilegedClientMock({
        messages: [{ data: { id: "message-1", organization_id: "access-org", store_id: "access-store", conversation_id: "conversation-1", lead_id: "lead-1", message_type: "image", media_url: "pool-path/photo.jpg", metadata: { storage_bucket: "pool-photos", storage_path: "pool-path/photo.jpg", media_purpose: "catalog_product_photo", target_type: "pool", pool_id: "pool-1", catalog_photo_id: "pool-photo-1", attachment_kind: "image" } }, error: null }],
        conversations: [{ data: { id: "conversation-1", organization_id: "access-org", lead_id: "lead-1" }, error: null }],
        leads: [{ data: { id: "lead-1", organization_id: "access-org", store_id: "access-store" }, error: null }],
        pools: [{ data: { id: "pool-1", organization_id: "access-org", store_id: "access-store" }, error: null }],
        poolPhotos: [{ data: { id: "pool-photo-1", pool_id: "pool-1", organization_id: "access-org", store_id: "access-store", storage_path: "pool-path/photo.jpg" }, error: null }],
        signedUrl: "https://signed.example.test/pool.jpg",
      });
      const handler = createSignedMediaUrlGetHandler({ resolveAccess: async () => createGrantedAccess(), createPrivilegedClient: () => client as never });
      const response = await handler(buildRequest(), buildContext());
      const body = await parseBody(response);
      assert.equal(response.status, 200);
      assert.equal(body.signedUrl, "https://signed.example.test/pool.jpg");
      assert.deepEqual(client.queryCalls.find((call) => call.table === "pools")?.filters, [
        { column: "id", value: "pool-1" },
        { column: "organization_id", value: "access-org" },
        { column: "store_id", value: "access-store" },
      ]);
      assert.deepEqual(client.queryCalls.find((call) => call.table === "pool_photos")?.filters, [
        { column: "pool_id", value: "pool-1" },
        { column: "organization_id", value: "access-org" },
        { column: "store_id", value: "access-store" },
        { column: "storage_path", value: "pool-path/photo.jpg" },
        { column: "id", value: "pool-photo-1" },
      ]);
      assert.deepEqual(client.storageCalls, [{ bucket: "pool-photos", path: "pool-path/photo.jpg", expiresIn: 60 }]);
    },
  },
  {
    name: "valid private catalog item photo is revalidated by parent and child lineage",
    run: async () => {
      const { createSignedMediaUrlGetHandler } = await loadRouteModule();
      const client = createPrivilegedClientMock({
        messages: [{ data: { id: "message-1", organization_id: "access-org", store_id: "access-store", conversation_id: "conversation-1", lead_id: "lead-1", message_type: "image", media_url: "catalog-path/photo.jpg", metadata: { storage_bucket: "store-catalog-photos", storage_path: "catalog-path/photo.jpg", media_purpose: "catalog_product_photo", target_type: "catalog_item", catalog_item_id: "item-1", catalog_photo_id: "item-photo-1", attachment_kind: "image" } }, error: null }],
        conversations: [{ data: { id: "conversation-1", organization_id: "access-org", lead_id: "lead-1" }, error: null }],
        leads: [{ data: { id: "lead-1", organization_id: "access-org", store_id: "access-store" }, error: null }],
        catalogItems: [{ data: { id: "item-1", organization_id: "access-org", store_id: "access-store" }, error: null }],
        catalogPhotos: [{ data: { id: "item-photo-1", catalog_item_id: "item-1", storage_path: "catalog-path/photo.jpg" }, error: null }],
        signedUrl: "https://signed.example.test/catalog.jpg",
      });
      const handler = createSignedMediaUrlGetHandler({ resolveAccess: async () => createGrantedAccess(), createPrivilegedClient: () => client as never });
      const response = await handler(buildRequest(), buildContext());
      const body = await parseBody(response);
      assert.equal(response.status, 200);
      assert.equal(body.signedUrl, "https://signed.example.test/catalog.jpg");
      assert.deepEqual(client.queryCalls.find((call) => call.table === "store_catalog_items")?.filters, [
        { column: "id", value: "item-1" },
        { column: "organization_id", value: "access-org" },
        { column: "store_id", value: "access-store" },
      ]);
      assert.deepEqual(client.queryCalls.find((call) => call.table === "store_catalog_item_photos")?.filters, [
        { column: "id", value: "item-photo-1" },
        { column: "catalog_item_id", value: "item-1" },
        { column: "storage_path", value: "catalog-path/photo.jpg" },
      ]);
      assert.deepEqual(client.storageCalls, [{ bucket: "store-catalog-photos", path: "catalog-path/photo.jpg", expiresIn: 60 }]);
    },
  },
  {
    name: "catalog lineage mismatch and arbitrary bucket never create signed url",
    run: async () => {
      const { createSignedMediaUrlGetHandler } = await loadRouteModule();
      for (const metadata of [
        { storage_bucket: "pool-photos", storage_path: "x.jpg", media_purpose: "catalog_product_photo", target_type: "pool", pool_id: "pool-1", catalog_photo_id: "photo-1" },
        { storage_bucket: "store-catalog-photos", storage_path: "x.jpg", media_purpose: "wrong", target_type: "catalog_item", catalog_item_id: "item-1", catalog_photo_id: "photo-1" },
        { storage_bucket: "arbitrary", storage_path: "x.jpg", media_purpose: "catalog_product_photo", target_type: "pool", pool_id: "pool-1" },
      ]) {
        const client = createPrivilegedClientMock({
          messages: [{ data: { id: "message-1", organization_id: "access-org", store_id: "access-store", conversation_id: "conversation-1", lead_id: "lead-1", message_type: "image", media_url: "x.jpg", metadata }, error: null }],
          conversations: [{ data: { id: "conversation-1", organization_id: "access-org", lead_id: "lead-1" }, error: null }],
          leads: [{ data: { id: "lead-1", organization_id: "access-org", store_id: "access-store" }, error: null }],
          pools: [{ data: null, error: null }],
        });
        const handler = createSignedMediaUrlGetHandler({ resolveAccess: async () => createGrantedAccess(), createPrivilegedClient: () => client as never });
        const response = await handler(buildRequest(), buildContext());
        assert.notEqual(response.status, 200);
        assert.equal(client.storageCalls.length, 0);
      }
    },
  },
  {
    name: "message lead mismatch is denied before catalog lineage or storage",
    run: async () => {
      const { createSignedMediaUrlGetHandler } = await loadRouteModule();
      const client = createPrivilegedClientMock({
        messages: [{ data: { id: "message-1", organization_id: "access-org", store_id: "access-store", conversation_id: "conversation-1", lead_id: "other-lead", message_type: "image", media_url: "access-org/access-store/lead-1/photo.jpg", metadata: { storage_bucket: "zion-store-files", storage_path: "access-org/access-store/lead-1/photo.jpg", attachment_kind: "image" } }, error: null }],
        conversations: [{ data: { id: "conversation-1", organization_id: "access-org", lead_id: "lead-1" }, error: null }],
      });
      const handler = createSignedMediaUrlGetHandler({ resolveAccess: async () => createGrantedAccess(), createPrivilegedClient: () => client as never });
      const response = await handler(buildRequest(), buildContext());
      assert.equal(response.status, 403);
      assert.equal((await parseBody(response)).error, "LEAD_RELATION_INCONSISTENT");
      assert.equal(client.queryCalls.some((call) => call.table === "leads"), false);
      assert.equal(client.storageCalls.length, 0);
    },
  },
  {
    name: "null message lead uses the canonical conversation lead",
    run: async () => {
      const { createSignedMediaUrlGetHandler } = await loadRouteModule();
      const client = createPrivilegedClientMock({
        messages: [{ data: { id: "message-1", organization_id: "access-org", store_id: "access-store", conversation_id: "conversation-1", lead_id: null, message_type: "image", media_url: "access-org/access-store/lead-1/photo.jpg", metadata: { storage_bucket: "zion-store-files", storage_path: "access-org/access-store/lead-1/photo.jpg", attachment_kind: "image" } }, error: null }],
        conversations: [{ data: { id: "conversation-1", organization_id: "access-org", lead_id: "lead-1" }, error: null }],
        leads: [{ data: { id: "lead-1", organization_id: "access-org", store_id: "access-store" }, error: null }],
        signedUrl: "https://signed.example.test/legacy.jpg",
      });
      const handler = createSignedMediaUrlGetHandler({ resolveAccess: async () => createGrantedAccess(), createPrivilegedClient: () => client as never });
      const response = await handler(buildRequest(), buildContext());
      assert.equal(response.status, 200);
      assert.equal((await parseBody(response)).signedUrl, "https://signed.example.test/legacy.jpg");
      assert.deepEqual(client.queryCalls.find((call) => call.table === "leads")?.filters, [
        { column: "id", value: "lead-1" },
        { column: "organization_id", value: "access-org" },
        { column: "store_id", value: "access-store" },
      ]);
    },
  },
  {
    name: "every invalid catalog lineage fails closed before storage signing",
    run: async () => {
      const { createSignedMediaUrlGetHandler } = await loadRouteModule();
      const cases = [
        {
          bucket: "pool-photos",
          metadata: { storage_bucket: "pool-photos", storage_path: "pool/photo.jpg", media_purpose: "catalog_product_photo", target_type: "pool", pool_id: "pool-1", catalog_photo_id: "pool-photo-1" },
          pools: { id: "pool-1", organization_id: "other-org", store_id: "access-store" },
          poolPhotos: { id: "pool-photo-1", pool_id: "pool-1", organization_id: "access-org", store_id: "access-store", storage_path: "pool/photo.jpg" },
        },
        {
          bucket: "pool-photos",
          metadata: { storage_bucket: "pool-photos", storage_path: "pool/photo.jpg", media_purpose: "catalog_product_photo", target_type: "pool", pool_id: "pool-1", catalog_photo_id: "wrong-photo" },
          pools: { id: "pool-1", organization_id: "access-org", store_id: "access-store" },
          poolPhotos: { id: "pool-photo-1", pool_id: "pool-1", organization_id: "access-org", store_id: "access-store", storage_path: "pool/photo.jpg" },
        },
        {
          bucket: "pool-photos",
          metadata: { storage_bucket: "pool-photos", storage_path: "pool/wrong.jpg", media_purpose: "catalog_product_photo", target_type: "pool", pool_id: "pool-1", catalog_photo_id: "pool-photo-1" },
          pools: { id: "pool-1", organization_id: "access-org", store_id: "access-store" },
          poolPhotos: { id: "pool-photo-1", pool_id: "pool-1", organization_id: "access-org", store_id: "access-store", storage_path: "pool/photo.jpg" },
        },
        {
          bucket: "store-catalog-photos",
          metadata: { storage_bucket: "store-catalog-photos", storage_path: "item/photo.jpg", media_purpose: "catalog_product_photo", target_type: "catalog_item", catalog_item_id: "item-1", catalog_photo_id: "item-photo-1" },
          catalogItem: { id: "item-1", organization_id: "other-org", store_id: "access-store" },
          catalogPhoto: { id: "item-photo-1", catalog_item_id: "item-1", storage_path: "item/photo.jpg" },
        },
        {
          bucket: "store-catalog-photos",
          metadata: { storage_bucket: "store-catalog-photos", storage_path: "item/photo.jpg", media_purpose: "catalog_product_photo", target_type: "catalog_item", catalog_item_id: "item-1", catalog_photo_id: "wrong-photo" },
          catalogItem: { id: "item-1", organization_id: "access-org", store_id: "access-store" },
          catalogPhoto: { id: "item-photo-1", catalog_item_id: "item-1", storage_path: "item/photo.jpg" },
        },
        {
          bucket: "store-catalog-photos",
          metadata: { storage_bucket: "store-catalog-photos", storage_path: "item/wrong.jpg", media_purpose: "catalog_product_photo", target_type: "catalog_item", catalog_item_id: "item-1", catalog_photo_id: "item-photo-1" },
          catalogItem: { id: "item-1", organization_id: "access-org", store_id: "access-store" },
          catalogPhoto: { id: "item-photo-1", catalog_item_id: "item-1", storage_path: "item/photo.jpg" },
        },
        {
          bucket: "pool-photos",
          metadata: { storage_bucket: "pool-photos", storage_path: "pool/photo.jpg", media_purpose: "catalog_product_photo", target_type: "pool", pool_id: "pool-1" },
          pools: { id: "pool-1", organization_id: "access-org", store_id: "access-store" },
          poolPhotos: { id: "pool-photo-1", pool_id: "pool-1", organization_id: "access-org", store_id: "access-store", storage_path: "pool/photo.jpg" },
        },
        {
          bucket: "pool-photos",
          metadata: { storage_bucket: "pool-photos", storage_path: "pool/photo.jpg", media_purpose: "catalog_product_photo", target_type: "wrong", pool_id: "pool-1", catalog_photo_id: "pool-photo-1" },
          pools: { id: "pool-1", organization_id: "access-org", store_id: "access-store" },
          poolPhotos: { id: "pool-photo-1", pool_id: "pool-1", organization_id: "access-org", store_id: "access-store", storage_path: "pool/photo.jpg" },
        },
        {
          bucket: "arbitrary",
          metadata: { storage_bucket: "arbitrary", storage_path: "x.jpg", media_purpose: "catalog_product_photo", target_type: "pool", pool_id: "pool-1", catalog_photo_id: "pool-photo-1" },
        },
      ];

      for (const item of cases) {
        const client = createPrivilegedClientMock({
          messages: [{ data: { id: "message-1", organization_id: "access-org", store_id: "access-store", conversation_id: "conversation-1", lead_id: "lead-1", message_type: "image", media_url: "private/photo.jpg", metadata: item.metadata }, error: null }],
          conversations: [{ data: { id: "conversation-1", organization_id: "access-org", lead_id: "lead-1" }, error: null }],
          leads: [{ data: { id: "lead-1", organization_id: "access-org", store_id: "access-store" }, error: null }],
          pools: item.pools ? [{ data: item.pools, error: null }] : [],
          poolPhotos: item.poolPhotos ? [{ data: item.poolPhotos, error: null }] : [],
          catalogItems: item.catalogItem ? [{ data: item.catalogItem, error: null }] : [],
          catalogPhotos: item.catalogPhoto ? [{ data: item.catalogPhoto, error: null }] : [],
        });
        const handler = createSignedMediaUrlGetHandler({ resolveAccess: async () => createGrantedAccess(), createPrivilegedClient: () => client as never });
        const response = await handler(buildRequest(), buildContext());
        assert.notEqual(response.status, 200, item.bucket);
        assert.equal(client.storageCalls.length, 0, item.bucket);
      }
    },
  },
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
      assert.equal(body.message, "Nao foi possivel gerar o link temporario deste anexo.");
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
