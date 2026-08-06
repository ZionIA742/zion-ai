import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createStoreBrandingLogoDeleteHandler,
  createStoreBrandingLogoGetHandler,
  createStoreBrandingLogoPostHandler,
} from "./route";
import type {
  StoreApiAccessDenied,
  StoreApiAccessGranted,
} from "../../../../lib/server/store-api-access";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

type QueryCall = {
  table: string;
  columns: string;
  filters: Array<{ op: string; column: string; value: unknown }>;
};

type UpdateCall = {
  table: string;
  values: Record<string, unknown>;
  filters: Record<string, unknown>;
};

type InsertCall = {
  table: string;
  values: Record<string, unknown>;
};

function createDeniedAccess(
  httpStatus: 401 | 403 | 409 | 503,
  status: StoreApiAccessDenied["payload"]["status"],
  reasonCode: StoreApiAccessDenied["payload"]["reasonCode"],
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
      error:
        httpStatus === 401
          ? "STORE_API_UNAUTHENTICATED"
          : httpStatus === 403
            ? "STORE_API_FORBIDDEN"
            : httpStatus === 503
              ? "STORE_API_ACCESS_UNAVAILABLE"
              : "STORE_API_ACCESS_DENIED",
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

function createFormDataRequest(
  formDataFactory: () => FormData | Promise<FormData>,
  tracker: { reads: number },
) {
  return {
    formData: async () => {
      tracker.reads += 1;
      return formDataFactory();
    },
  } as unknown as Request;
}

function createPrivilegedClientMock(args?: {
  brandingResults?: Array<Record<string, unknown> | null>;
  signedUrl?: string | null;
  signedUrlError?: { message: string } | null;
  uploadError?: { message: string } | null;
  updateError?: { message: string } | null;
  insertError?: { message: string } | null;
  removeError?: { message: string } | null;
}) {
  const queryCalls: QueryCall[] = [];
  const updateCalls: UpdateCall[] = [];
  const insertCalls: InsertCall[] = [];
  const uploadCalls: Array<{
    bucket: string;
    path: string;
    options: Record<string, unknown>;
    size: number;
  }> = [];
  const signedUrlCalls: Array<{ bucket: string; path: string; expiresIn: number }> = [];
  const removeCalls: Array<{ bucket: string; paths: string[] }> = [];
  const brandingQueue = [...(args?.brandingResults ?? [])];

  const client = {
    queryCalls,
    updateCalls,
    insertCalls,
    uploadCalls,
    signedUrlCalls,
    removeCalls,
    from(table: string) {
      return {
        select(columns: string) {
          const state: QueryCall = {
            table,
            columns,
            filters: [],
          };

          return {
            eq(column: string, value: unknown) {
              state.filters.push({ op: "eq", column, value });
              return this;
            },
            async maybeSingle() {
              queryCalls.push({
                table: state.table,
                columns: state.columns,
                filters: [...state.filters],
              });

              return {
                data: brandingQueue.shift() ?? null,
                error: null,
              };
            },
          };
        },
        update(values: Record<string, unknown>) {
          const state: UpdateCall = {
            table,
            values,
            filters: {},
          };

          return {
            eq(column: string, value: unknown) {
              state.filters[column] = value;
              return this;
            },
            async then(
              onFulfilled: (value: { error: { message: string } | null }) => unknown,
              onRejected?: (reason: unknown) => unknown,
            ) {
              updateCalls.push({
                table: state.table,
                values: { ...state.values },
                filters: { ...state.filters },
              });

              return Promise.resolve({
                error: args?.updateError ?? null,
              }).then(onFulfilled, onRejected);
            },
          };
        },
        insert(values: Record<string, unknown>) {
          insertCalls.push({
            table,
            values: { ...values },
          });

          return Promise.resolve({
            error: args?.insertError ?? null,
          });
        },
      };
    },
    storage: {
      from(bucket: string) {
        return {
          async createSignedUrl(path: string, expiresIn: number) {
            signedUrlCalls.push({ bucket, path, expiresIn });
            return {
              data: args?.signedUrl ? { signedUrl: args.signedUrl } : null,
              error: args?.signedUrlError ?? null,
            };
          },
          async upload(
            path: string,
            body: File | Buffer,
            options: Record<string, unknown>,
          ) {
            uploadCalls.push({
              bucket,
              path,
              options,
              size: body instanceof File ? body.size : body.byteLength,
            });
            return {
              error: args?.uploadError ?? null,
            };
          },
          async remove(paths: string[]) {
            removeCalls.push({ bucket, paths: [...paths] });
            return {
              error: args?.removeError ?? null,
            };
          },
        };
      },
    },
  };

  return client;
}

const tests: TestCase[] = [
  {
    name: "valid account reads logo only from the canonical tenant scope",
    run: async () => {
      let resolveCount = 0;
      const client = createPrivilegedClientMock({
        brandingResults: [
          {
            id: "branding-1",
            organization_id: "access-org",
            store_id: "access-store",
            logo_storage_bucket: "zion-store-files",
            logo_storage_path: "access-org/access-store/branding/logo/current-logo.png",
            logo_original_filename: "current-logo.png",
            logo_mime_type: "image/png",
            logo_size_bytes: 1234,
            logo_uploaded_at: "2026-08-06T12:00:00Z",
            created_at: "2026-08-06T12:00:00Z",
            updated_at: "2026-08-06T12:00:00Z",
          },
        ],
        signedUrl: "https://example.test/logo",
      });
      const handler = createStoreBrandingLogoGetHandler({
        resolveAccess: async () => {
          resolveCount += 1;
          return createGrantedAccess();
        },
        createPrivilegedClient: () => client as never,
      });

      const response = await handler();
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.signedUrl, "https://example.test/logo");
      assert.equal(resolveCount, 1);
      assert.equal(client.queryCalls.length, 1);
      assert.deepEqual(client.queryCalls[0].filters, [
        { op: "eq", column: "organization_id", value: "access-org" },
        { op: "eq", column: "store_id", value: "access-store" },
      ]);
      assert.deepEqual(client.signedUrlCalls, [
        {
          bucket: "zion-store-files",
          path: "access-org/access-store/branding/logo/current-logo.png",
          expiresIn: 1800,
        },
      ]);
    },
  },
  {
    name: "post writes only to the canonical store and ignores tampered tenant ids",
    run: async () => {
      let resolveCount = 0;
      const requestReads = { reads: 0 };
      const client = createPrivilegedClientMock({
        brandingResults: [
          {
            id: "branding-1",
            organization_id: "access-org",
            store_id: "access-store",
            logo_storage_bucket: "zion-store-files",
            logo_storage_path: "access-org/access-store/branding/logo/old-logo.png",
            logo_original_filename: "old-logo.png",
            logo_mime_type: "image/png",
            logo_size_bytes: 111,
            logo_uploaded_at: "2026-08-06T12:00:00Z",
            created_at: "2026-08-06T12:00:00Z",
            updated_at: "2026-08-06T12:00:00Z",
          },
          {
            id: "branding-1",
            organization_id: "access-org",
            store_id: "access-store",
            logo_storage_bucket: "zion-store-files",
            logo_storage_path: "access-org/access-store/branding/logo/new-logo.png",
            logo_original_filename: "new-logo.png",
            logo_mime_type: "image/png",
            logo_size_bytes: 222,
            logo_uploaded_at: "2026-08-06T12:01:00Z",
            created_at: "2026-08-06T12:00:00Z",
            updated_at: "2026-08-06T12:01:00Z",
          },
        ],
        signedUrl: "https://example.test/logo-new",
      });
      const handler = createStoreBrandingLogoPostHandler({
        resolveAccess: async () => {
          resolveCount += 1;
          return createGrantedAccess();
        },
        createPrivilegedClient: () => client as never,
      });
      const logoFile = new File([Buffer.from("fake-png")], "nova-logo.png", {
        type: "image/png",
      });

      const response = await handler(
        createFormDataRequest(() => {
          const formData = new FormData();
          formData.set("organizationId", "body-org");
          formData.set("storeId", "body-store");
          formData.set("file", logoFile);
          return formData;
        }, requestReads),
      );
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.signedUrl, "https://example.test/logo-new");
      assert.equal(resolveCount, 1);
      assert.equal(requestReads.reads, 1);
      assert.equal(client.uploadCalls.length, 1);
      assert.equal(
        client.uploadCalls[0].path.startsWith("access-org/access-store/branding/logo/"),
        true,
      );
      assert.deepEqual(client.updateCalls, [
        {
          table: "store_branding_settings",
          values: {
            logo_storage_bucket: "zion-store-files",
            logo_storage_path: client.uploadCalls[0].path,
            logo_original_filename: "nova-logo.png",
            logo_mime_type: "image/png",
            logo_size_bytes: 8,
            logo_uploaded_at: client.updateCalls[0]?.values.logo_uploaded_at,
            updated_at: client.updateCalls[0]?.values.updated_at,
          },
          filters: {
            id: "branding-1",
            organization_id: "access-org",
            store_id: "access-store",
          },
        },
      ]);
      assert.deepEqual(client.removeCalls, [
        {
          bucket: "zion-store-files",
          paths: ["access-org/access-store/branding/logo/old-logo.png"],
        },
      ]);
    },
  },
  {
    name: "delete removes branding only from the canonical store",
    run: async () => {
      const client = createPrivilegedClientMock({
        brandingResults: [
          {
            id: "branding-1",
            organization_id: "access-org",
            store_id: "access-store",
            logo_storage_bucket: "zion-store-files",
            logo_storage_path: "access-org/access-store/branding/logo/current-logo.png",
            logo_original_filename: "current-logo.png",
            logo_mime_type: "image/png",
            logo_size_bytes: 1234,
            logo_uploaded_at: "2026-08-06T12:00:00Z",
            created_at: "2026-08-06T12:00:00Z",
            updated_at: "2026-08-06T12:00:00Z",
          },
          {
            id: "branding-1",
            organization_id: "access-org",
            store_id: "access-store",
            logo_storage_bucket: null,
            logo_storage_path: null,
            logo_original_filename: null,
            logo_mime_type: null,
            logo_size_bytes: null,
            logo_uploaded_at: null,
            created_at: "2026-08-06T12:00:00Z",
            updated_at: "2026-08-06T12:05:00Z",
          },
        ],
      });
      const handler = createStoreBrandingLogoDeleteHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => client as never,
      });

      const response = await handler();
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.signedUrl, null);
      assert.deepEqual(client.updateCalls, [
        {
          table: "store_branding_settings",
          values: {
            logo_storage_bucket: null,
            logo_storage_path: null,
            logo_original_filename: null,
            logo_mime_type: null,
            logo_size_bytes: null,
            logo_uploaded_at: null,
            updated_at: client.updateCalls[0]?.values.updated_at,
          },
          filters: {
            organization_id: "access-org",
            store_id: "access-store",
          },
        },
      ]);
      assert.deepEqual(client.removeCalls, [
        {
          bucket: "zion-store-files",
          paths: ["access-org/access-store/branding/logo/current-logo.png"],
        },
      ]);
    },
  },
  {
    name: "denied wrapper statuses are preserved for anonymous and fail-closed tenant cases",
    run: async () => {
      for (const denied of [
        createDeniedAccess(401, "anonymous", "anonymous"),
        createDeniedAccess(409, "store_missing_membership", "missing_membership"),
        createDeniedAccess(409, "store_multi_org_unsupported", "multi_org_unsupported"),
        createDeniedAccess(409, "store_missing_store", "missing_store"),
        createDeniedAccess(409, "store_multi_store_unsupported", "multi_store_unsupported"),
      ]) {
        let clientCreateCount = 0;
        const requestReads = { reads: 0 };
        const postHandler = createStoreBrandingLogoPostHandler({
          resolveAccess: async () => denied,
          createPrivilegedClient: () => {
            clientCreateCount += 1;
            throw new Error("client should not be created");
          },
        });

        const response = await postHandler(
          createFormDataRequest(() => {
            const formData = new FormData();
            formData.set("organizationId", "body-org");
            formData.set("storeId", "body-store");
            return formData;
          }, requestReads),
        );
        const body = (await response.json()) as Record<string, unknown>;

        assert.equal(response.status, denied.httpStatus);
        assert.equal(body.status, denied.payload.status);
        assert.equal(body.reasonCode, denied.payload.reasonCode);
        assert.equal(body.message, denied.payload.message);
        assert.equal(requestReads.reads, 0);
        assert.equal(clientCreateCount, 0);
      }
    },
  },
  {
    name: "cross-tenant storage paths fail closed for read and removal",
    run: async () => {
      const branding = {
        id: "branding-1",
        organization_id: "access-org",
        store_id: "access-store",
        logo_storage_bucket: "zion-store-files",
        logo_storage_path: "other-org/other-store/branding/logo/foreign-logo.png",
        logo_original_filename: "foreign-logo.png",
        logo_mime_type: "image/png",
        logo_size_bytes: 999,
        logo_uploaded_at: "2026-08-06T12:00:00Z",
        created_at: "2026-08-06T12:00:00Z",
        updated_at: "2026-08-06T12:00:00Z",
      };
      const getClient = createPrivilegedClientMock({
        brandingResults: [branding],
        signedUrl: "https://example.test/foreign",
      });
      const deleteClient = createPrivilegedClientMock({
        brandingResults: [branding],
      });
      const getHandler = createStoreBrandingLogoGetHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => getClient as never,
      });
      const deleteHandler = createStoreBrandingLogoDeleteHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => deleteClient as never,
      });

      const getResponse = await getHandler();
      const getBody = (await getResponse.json()) as Record<string, unknown>;
      assert.equal(getResponse.status, 409);
      assert.equal(getBody.error, "STORE_BRANDING_INVALID_STORAGE_SCOPE");
      assert.equal(getClient.signedUrlCalls.length, 0);

      const deleteResponse = await deleteHandler();
      const deleteBody = (await deleteResponse.json()) as Record<string, unknown>;
      assert.equal(deleteResponse.status, 409);
      assert.equal(deleteBody.error, "STORE_BRANDING_INVALID_STORAGE_SCOPE");
      assert.equal(deleteClient.updateCalls.length, 0);
      assert.equal(deleteClient.removeCalls.length, 0);
    },
  },
  {
    name: "route source uses canonical resolver and active requirement",
    run: async () => {
      const source = readFileSync(join(process.cwd(), "src/app/api/store-branding/logo/route.ts"), "utf8");

      assert.equal(source.includes("resolveStoreApiAccess"), true);
      assert.equal(source.includes("createStoreApiDeniedResponse"), true);
      assert.equal(source.includes('requirement: "active"'), true);
      assert.equal(source.includes('searchParams.get("storeId")'), false);
      assert.equal(source.includes('formData.get("storeId")'), false);
      assert.equal(source.includes('body?.storeId'), false);
      assert.equal(source.includes('STORE_BRANDING_INVALID_STORAGE_SCOPE'), true);
      assert.equal(source.includes("buildCanonicalLogoPathPrefix"), true);
    },
  },
];

async function main() {
  let passed = 0;

  for (const test of tests) {
    await test.run();
    passed += 1;
  }

  console.log(`store-branding-logo-route: ${passed}/${tests.length} tests passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
