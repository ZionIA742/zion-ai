import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GET,
  POST,
  createIntelligentImportGetHandler,
  createIntelligentImportPostHandler,
} from "./route";
import type {
  StoreApiAccessDenied,
  StoreApiAccessGranted,
} from "@/lib/server/store-api-access";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
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

const tests: TestCase[] = [
  {
    name: "onboarding account uses canonical tenant and ignores form tenant ids",
    run: async () => {
      const requestReads = { reads: 0 };
      let resolveCount = 0;
      const importCalls: Array<Record<string, unknown>> = [];
      const handler = createIntelligentImportPostHandler({
        resolveAccess: async () => {
          resolveCount += 1;
          return createGrantedAccess();
        },
        runImport: async (params) => {
          importCalls.push({
            organizationId: params.organizationId,
            storeId: params.storeId,
            uploadedBy: params.uploadedBy,
            debugParser: params.debugParser,
            source: params.source,
            fileCount: params.files.length,
            firstFileName: params.files[0]?.fileName ?? null,
          });

          return {
            ok: true,
            importedFileIds: ["file-1"],
            importedFiles: [],
            mediaStagingWarnings: [],
            rawFilePersistenceWarnings: [],
            stagedMediaAssetIds: ["asset-1"],
            stagedMediaAssets: [],
            summary: {
              totalFiles: 1,
              extractedFiles: 1,
              normalizedItems: 1,
              dedupedItems: 1,
              duplicateItems: 0,
              extractedImages: 0,
            },
            extractedPreview: [],
            extractedImagePreview: [],
            imageDiagnostics: {
              totalExtractedImagesRaw: 0,
              totalAliasedImages: 0,
              files: [],
            },
            normalizedPreview: [],
            dedupedPreview: [],
            parserDebug: undefined,
          };
        },
      });

      const response = await handler(
        createFormDataRequest(() => {
          const formData = new FormData();
          formData.append("organizationId", "body-org");
          formData.append("storeId", "body-store");
          formData.append("debugParser", "true");
          formData.append(
            "files",
            new File(["catalog"], "catalogo.pdf", { type: "application/pdf" }),
          );
          return formData;
        }, requestReads),
      );

      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.message, "Importacao inteligente processada com sucesso.");
      assert.equal(resolveCount, 1);
      assert.equal(requestReads.reads, 1);
      assert.equal(importCalls.length, 1);
      assert.deepEqual(importCalls[0], {
        organizationId: "access-org",
        storeId: "access-store",
        uploadedBy: "user-1",
        debugParser: true,
        source: "onboarding_intelligent_import",
        fileCount: 1,
        firstFileName: "catalogo.pdf",
      });
    },
  },
  {
    name: "denied wrapper statuses are preserved and form data is not read",
    run: async () => {
      for (const denied of [
        createDeniedAccess(401, "anonymous", "anonymous"),
        createDeniedAccess(409, "store_missing_membership", "missing_membership"),
        createDeniedAccess(409, "store_multi_org_unsupported", "multi_org_unsupported"),
        createDeniedAccess(409, "store_missing_store", "missing_store"),
        createDeniedAccess(409, "store_multi_store_unsupported", "multi_store_unsupported"),
      ]) {
        const requestReads = { reads: 0 };
        let importCallCount = 0;
        const handler = createIntelligentImportPostHandler({
          resolveAccess: async () => denied,
          runImport: async () => {
            importCallCount += 1;
            throw new Error("should not run");
          },
        });

        const response = await handler(
          createFormDataRequest(() => {
            throw new Error("formData should not be read");
          }, requestReads),
        );
        const body = (await response.json()) as Record<string, unknown>;

        assert.equal(response.status, denied.httpStatus);
        assert.equal(body.status, denied.payload.status);
        assert.equal(body.reasonCode, denied.payload.reasonCode);
        assert.equal(body.message, denied.payload.message);
        assert.equal(requestReads.reads, 0);
        assert.equal(importCallCount, 0);
      }
    },
  },
  {
    name: "unsupported file validation stays active during onboarding",
    run: async () => {
      const handler = createIntelligentImportPostHandler({
        resolveAccess: async () => createGrantedAccess(),
        runImport: async () => {
          throw new Error("should not run for unsupported file");
        },
      });

      const response = await handler(
        createFormDataRequest(() => {
          const formData = new FormData();
          formData.append(
            "files",
            new File(["bad"], "catalogo.exe", {
              type: "application/octet-stream",
            }),
          );
          return formData;
        }, { reads: 0 }),
      );
      const body = (await response.json()) as Record<string, unknown>;

      assert.equal(response.status, 400);
      assert.equal(body.error, "ONBOARDING_INTELLIGENT_IMPORT_UNSUPPORTED_FILE");
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    },
  },
  {
    name: "GET preserves onboarding access gate",
    run: async () => {
      let resolveCount = 0;
      const handler = createIntelligentImportGetHandler({
        resolveAccess: async () => {
          resolveCount += 1;
          return createGrantedAccess();
        },
      });

      const response = await handler();
      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.route, "onboarding/intelligent-import");
      assert.equal(resolveCount, 1);
    },
  },
  {
    name: "source uses active_or_onboarding and does not read tenant ids from formData",
    run: () => {
      const source = readFileSync(join(__dirname, "route.ts"), "utf8");

      assert.equal(source.includes("resolveStoreApiAccess"), true);
      assert.equal(source.includes("createStoreApiDeniedResponse"), true);
      assert.equal(source.includes('requirement: "active_or_onboarding"'), true);
      assert.equal(source.includes('formData.get("organizationId")'), false);
      assert.equal(source.includes('formData.get("storeId")'), false);
      assert.equal(source.includes("createSupabaseServerClient"), false);
      assert.equal(source.includes("auth.getUser"), false);
      assert.equal(source.includes("getSession"), false);
    },
  },
  {
    name: "module exports route handlers",
    run: () => {
      assert.equal(typeof POST, "function");
      assert.equal(typeof GET, "function");
    },
  },
];

void (async () => {
  let passed = 0;

  for (const test of tests) {
    await test.run();
    passed += 1;
  }

  console.log(`onboarding-intelligent-import-route: ${passed}/${tests.length} tests passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
