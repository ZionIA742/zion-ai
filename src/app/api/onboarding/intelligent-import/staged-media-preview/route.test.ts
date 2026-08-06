import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  POST,
  createStagedMediaPreviewPostHandler,
} from "./route";
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
  filters: Array<{ op: string; column: string; value: unknown }>;
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
      status: "store_ready_onboarding_required",
      sessionUserId: "user-1",
      safeHtmlDestination: "/onboarding",
      apiDecision: "allow",
      organizationResolution: "single",
      storeResolution: "single",
      organizationId: "access-org",
      storeId: "access-store",
      commercialAccess: "allowed",
      reasonCode: "onboarding_required",
      message: "Conta em onboarding liberada.",
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

function createPrivilegedClientMock(args?: {
  asset?: Record<string, unknown> | null;
  assetError?: { message: string } | null;
  signedUrl?: string | null;
  signedUrlError?: { message: string } | null;
}) {
  const queryCalls: QueryCall[] = [];
  const signedUrlCalls: Array<{ bucket: string; path: string; expiresIn: number }> = [];

  const client = {
    queryCalls,
    signedUrlCalls,
    from(table: string) {
      const state: QueryCall = {
        table,
        columns: "",
        filters: [],
      };

      return {
        select(columns: string) {
          state.columns = columns;
          return this;
        },
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
            data: args?.asset ?? null,
            error: args?.assetError ?? null,
          };
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
        };
      },
    },
  };

  return client;
}

const tests: TestCase[] = [
  {
    name: "onboarding account uses canonical tenant and ignores body tenant ids",
    run: async () => {
      const requestReads = { reads: 0 };
      let resolveCount = 0;
      const now = Date.now() + 60_000;
      const client = createPrivilegedClientMock({
        asset: {
          id: "asset-1",
          organization_id: "access-org",
          store_id: "access-store",
          import_batch_id: "batch-1",
          import_file_id: "file-1",
          source_kind: "docx_media",
          association_strength: "visual_evidence",
          requires_user_confirmation: true,
          status: "staged",
          expires_at: new Date(now).toISOString(),
          storage_bucket: "store-import-files",
          storage_path: "access-org/access-store/batch-1/media/asset-1-evidence.png",
        },
        signedUrl: "https://example.test/signed",
      });
      const handler = createStagedMediaPreviewPostHandler({
        resolveAccess: async () => {
          resolveCount += 1;
          return createGrantedAccess();
        },
        createPrivilegedClient: () => client as never,
      });

      const response = await handler(
        createJsonRequest(
          () => ({
            organizationId: "body-org",
            storeId: "body-store",
            stagingAssetId: "asset-1",
            importBatchId: "batch-1",
            importFileId: "file-1",
          }),
          requestReads,
        ),
      );
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.signedUrl, "https://example.test/signed");
      assert.equal(resolveCount, 1);
      assert.equal(requestReads.reads, 1);
      assert.equal(client.queryCalls.length, 1);
      assert.deepEqual(client.queryCalls[0].filters, [
        { op: "eq", column: "id", value: "asset-1" },
        { op: "eq", column: "organization_id", value: "access-org" },
        { op: "eq", column: "store_id", value: "access-store" },
        { op: "eq", column: "import_batch_id", value: "batch-1" },
        { op: "eq", column: "import_file_id", value: "file-1" },
      ]);
      assert.deepEqual(client.signedUrlCalls, [
        {
          bucket: "store-import-files",
          path: "access-org/access-store/batch-1/media/asset-1-evidence.png",
          expiresIn: 300,
        },
      ]);
    },
  },
  {
    name: "denied wrapper statuses are preserved and request body is not read",
    run: async () => {
      for (const denied of [
        createDeniedAccess(401, "anonymous", "anonymous"),
        createDeniedAccess(409, "store_missing_membership", "missing_membership"),
        createDeniedAccess(409, "store_multi_org_unsupported", "multi_org_unsupported"),
        createDeniedAccess(409, "store_missing_store", "missing_store"),
        createDeniedAccess(409, "store_multi_store_unsupported", "multi_store_unsupported"),
      ]) {
        const requestReads = { reads: 0 };
        let clientCreateCount = 0;
        const handler = createStagedMediaPreviewPostHandler({
          resolveAccess: async () => denied,
          createPrivilegedClient: () => {
            clientCreateCount += 1;
            throw new Error("should not create client");
          },
        });

        const response = await handler(
          createJsonRequest(() => {
            throw new Error("body should not be read");
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
    name: "preview stays scoped to canonical storage path during onboarding",
    run: async () => {
      const client = createPrivilegedClientMock({
        asset: {
          id: "asset-1",
          organization_id: "access-org",
          store_id: "access-store",
          import_batch_id: "batch-1",
          import_file_id: "file-1",
          source_kind: "docx_media",
          association_strength: "visual_evidence",
          requires_user_confirmation: true,
          status: "staged",
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          storage_bucket: "store-import-files",
          storage_path: "other-org/other-store/batch-1/media/asset-1-evidence.png",
        },
        signedUrl: "https://example.test/signed",
      });
      const handler = createStagedMediaPreviewPostHandler({
        resolveAccess: async () => createGrantedAccess(),
        createPrivilegedClient: () => client as never,
      });

      const response = await handler(
        createJsonRequest(
          () => ({
            organizationId: "body-org",
            storeId: "body-store",
            stagingAssetId: "asset-1",
            importBatchId: "batch-1",
            importFileId: "file-1",
          }),
          { reads: 0 },
        ),
      );
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 422);
      assert.equal(body.state, "invalid");
      assert.equal(client.signedUrlCalls.length, 0);
    },
  },
  {
    name: "source uses active_or_onboarding and does not read body tenant ids for scope",
    run: () => {
      const source = readFileSync(join(__dirname, "route.ts"), "utf8");

      assert.equal(source.includes("resolveStoreApiAccess"), true);
      assert.equal(source.includes("createStoreApiDeniedResponse"), true);
      assert.equal(source.includes('requirement: "active_or_onboarding"'), true);
      assert.equal(source.includes("const organizationId = String(body.organizationId"), false);
      assert.equal(source.includes("const storeId = String(body.storeId"), false);
      assert.equal(source.includes("createSupabaseServerClient"), false);
      assert.equal(source.includes("auth.getUser"), false);
      assert.equal(source.includes("getSession"), false);
    },
  },
  {
    name: "module exports the POST handler",
    run: () => {
      assert.equal(typeof POST, "function");
    },
  },
];

void (async () => {
  let passed = 0;

  for (const test of tests) {
    await test.run();
    passed += 1;
  }

  console.log(`onboarding-staged-media-preview-route: ${passed}/${tests.length} tests passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
