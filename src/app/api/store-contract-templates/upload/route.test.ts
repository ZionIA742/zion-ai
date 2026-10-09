import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  StoreContractTemplateAccessError,
  resolveStoreContractTemplateScopeForAuthorizedStoreScope,
} from "@/lib/server/store-contract-templates/template-management";
import type {
  StoreApiAccessDenied,
  StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreContractTemplateUploadPostHandler } from "./route";

type TestCase = { name: string; run: () => Promise<void> | void };

function granted(): StoreApiAccessGranted {
  return {
    ok: true,
    supabase: {} as StoreApiAccessGranted["supabase"],
    resolution: {} as StoreApiAccessGranted["resolution"],
    sessionUserId: "user-1",
    organizationId: "org-1",
    storeId: "store-1",
  };
}

function denied(): StoreApiAccessDenied {
  return {
    ok: false,
    resolution: {} as StoreApiAccessDenied["resolution"],
    httpStatus: 401,
    payload: {
      ok: false,
      error: "STORE_API_UNAUTHENTICATED",
      message: "Faca login para acessar esta API da loja.",
      status: "anonymous",
      reasonCode: "anonymous",
    },
  };
}

function result() {
  return {
    store: { id: "store-1", organization_id: "org-1", name: "Loja" },
    organizationId: "org-1",
    template: { id: "template-1" },
    activeVersion: { id: "version-1" },
    versions: [{ id: "version-1" }],
    extractedRules: [{ id: "rule-1" }],
    uploadedVersion: { id: "version-2" },
  };
}

function requestWithFormData(values: Record<string, FormDataEntryValue>): Request {
  return {
    formData: async () => {
      const formData = new FormData();
      for (const [key, value] of Object.entries(values)) formData.set(key, value);
      return formData;
    },
  } as Request;
}

function validFile() {
  return new File(["pdf"], "contrato.pdf", { type: "application/pdf" });
}

const tests: TestCase[] = [
  {
    name: "canonical denial happens before formData",
    run: async () => {
      let formDataCalls = 0;
      let uploadCalls = 0;
      let requirement = "";
      const response = await createStoreContractTemplateUploadPostHandler({
        resolveAccess: async (args) => {
          requirement = args.requirement;
          return denied();
        },
        uploadTemplate: async () => {
          uploadCalls += 1;
          return result() as never;
        },
      })({
        formData: async () => {
          formDataCalls += 1;
          throw new Error("formData must not run");
        },
      } as unknown as Request);
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error, "STORE_API_UNAUTHENTICATED");
      assert.equal(requirement, "active_or_onboarding");
      assert.equal(formDataCalls, 0);
      assert.equal(uploadCalls, 0);
    },
  },
  {
    name: "missing or non-File entry preserves FILE_REQUIRED precedence",
    run: async () => {
      let uploadCalls = 0;
      const response = await createStoreContractTemplateUploadPostHandler({
        resolveAccess: async () => granted(),
        uploadTemplate: async () => {
          uploadCalls += 1;
          return result() as never;
        },
      })(requestWithFormData({ storeId: "store-1", file: "not-a-file" }));
      const body = await response.json();
      assert.equal(response.status, 400);
      assert.equal(body.error, "FILE_REQUIRED");
      assert.equal(body.message, "Selecione um arquivo valido do contrato base.");
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(uploadCalls, 0);
    },
  },
  {
    name: "store assertions fail before scoped upload",
    run: async () => {
      for (const [values, status, code] of [
        [{ file: validFile() }, 400, "INVALID_STORE_ID"],
        [{ storeId: "store-foreign", file: validFile() }, 403, "STORE_FORBIDDEN"],
        [{ storeId: "store-1", organizationId: "org-foreign", file: validFile() }, 403, "ORGANIZATION_STORE_MISMATCH"],
      ] as const) {
        let uploadCalls = 0;
        const response = await createStoreContractTemplateUploadPostHandler({
          resolveAccess: async () => granted(),
          uploadTemplate: async () => {
            uploadCalls += 1;
            return result() as never;
          },
        })(requestWithFormData(values));
        assert.equal(response.status, status);
        assert.equal((await response.json()).error, code);
        assert.equal(uploadCalls, 0);
      }
    },
  },
  {
    name: "omitted organization is accepted and canonical scope plus same File are forwarded",
    run: async () => {
      const file = validFile();
      let receivedScope: unknown;
      let receivedFile: unknown;
      const response = await createStoreContractTemplateUploadPostHandler({
        resolveAccess: async () => granted(),
        uploadTemplate: async (scope, received) => {
          receivedScope = scope;
          receivedFile = received;
          return result() as never;
        },
      })(requestWithFormData({ storeId: "store-1", file }));
      assert.equal(response.status, 200);
      assert.deepEqual(receivedScope, {
        organizationId: "org-1",
        storeId: "store-1",
        sessionUserId: "user-1",
      });
      assert.equal(receivedFile, file);
      assert.deepEqual(await response.json(), {
        ok: true,
        store: result().store,
        template: result().template,
        activeVersion: result().activeVersion,
        versions: result().versions,
        extractedRules: result().extractedRules,
        uploadedVersion: result().uploadedVersion,
      });
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    },
  },
  {
    name: "scoped upload access errors preserve status, code, and message",
    run: async () => {
      const response = await createStoreContractTemplateUploadPostHandler({
        resolveAccess: async () => granted(),
        uploadTemplate: async () => {
          throw new StoreContractTemplateAccessError(409, "TEMPLATE_BUSY", "busy");
        },
      })(requestWithFormData({ storeId: "store-1", file: validFile() }));
      const body = await response.json();
      assert.equal(response.status, 409);
      assert.equal(body.error, "TEMPLATE_BUSY");
      assert.equal(body.message, "busy");
    },
  },
  {
    name: "authorized scope validates before service client",
    run: async () => {
      let createCalls = 0;
      await assert.rejects(
        () =>
          resolveStoreContractTemplateScopeForAuthorizedStoreScope(
            { organizationId: "", storeId: "store-1", sessionUserId: "user-1" },
            {
              createServiceSupabaseClient: () => {
                createCalls += 1;
                return {} as never;
              },
            },
          ),
        (error: unknown) =>
          error instanceof StoreContractTemplateAccessError &&
          error.code === "INVALID_AUTHORIZED_TEMPLATE_SCOPE",
      );
      assert.equal(createCalls, 0);
    },
  },
  {
    name: "scoped resolver queries the canonical organization/store pair",
    run: async () => {
      const calls: string[] = [];
      const query = {
        select() { return query; },
        eq(column: string, value: string) { calls.push(`${column}=${value}`); return query; },
        async maybeSingle() {
          return { data: { id: "store-1", organization_id: "org-1", name: "Loja" }, error: null };
        },
      };
      const scope = await resolveStoreContractTemplateScopeForAuthorizedStoreScope(
        { organizationId: "org-1", storeId: "store-1", sessionUserId: "user-1" },
        { createServiceSupabaseClient: () => ({ from: () => query }) as never },
      );
      assert.equal(scope.userId, "user-1");
      assert.deepEqual(calls, ["id=store-1", "organization_id=org-1"]);
    },
  },
  {
    name: "core extraction preserves validation, storage, actor, metadata, reload, and rollback contracts",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/lib/server/store-contract-templates/template-management.ts"),
        "utf8",
      );
      const start = source.indexOf("async function uploadStoreContractTemplateVersionWithResolvedScope");
      const end = source.indexOf("export async function uploadStoreContractTemplateVersion(args", start);
      const core = source.slice(start, end);
      for (const pattern of [
        /EMPTY_FILE/, /FILE_TOO_LARGE/, /INVALID_FILE_TYPE/, /ensureStoreContractTemplate/, /getNextTemplateVersionNumber/,
        /buildTemplateStoragePath/, /\.upload\(storagePath, uploadBody, \{[\s\S]*?upsert: false/, /from\("store_files"\)/,
        /uploaded_by: scope\.userId/, /from\("store_contract_template_versions"\)/, /status: "uploaded"/,
        /uploaded_by_user_id: scope\.userId/, /storage\.from\(STORAGE_BUCKET\)\.remove\(\[storagePath\]\)/,
        /\.from\("store_files"\)\.delete\(\)\.eq\("id", storeFile\.id\)/, /loadTemplateVersions/, /loadStoreContractTemplate/, /loadTemplateExtractedRules/,
      ]) assert.match(core, pattern);
      assert.match(core, /15 MB/);
    },
  },
  {
    name: "legacy upload keeps legacy resolver and delegates to shared core",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/lib/server/store-contract-templates/template-management.ts"),
        "utf8",
      );
      const start = source.indexOf("export async function uploadStoreContractTemplateVersion(args");
      const end = source.indexOf("export async function uploadStoreContractTemplateVersionForAuthorizedStoreScope", start);
      const legacy = source.slice(start, end);
      assert.match(legacy, /resolveAuthorizedStoreTemplateScope\(args\)/);
      assert.match(legacy, /uploadStoreContractTemplateVersionWithResolvedScope\(scope, args\.file\)/);
      assert.doesNotMatch(legacy, /resolveStoreContractTemplateScopeForAuthorizedStoreScope/);
    },
  },
  {
    name: "scoped domain path has no legacy authentication dependency",
    run: () => {
      const source = readFileSync(
        join(process.cwd(), "src/lib/server/store-contract-templates/template-management.ts"),
        "utf8",
      );
      const start = source.indexOf("export async function uploadStoreContractTemplateVersionForAuthorizedStoreScope");
      const scoped = source.slice(start, source.indexOf("export async function approveStoreContractTemplateVersion", start));
      assert.match(scoped, /resolveStoreContractTemplateScopeForAuthorizedStoreScope/);
      assert.match(scoped, /uploadStoreContractTemplateVersionWithResolvedScope/);
      assert.doesNotMatch(scoped, /authenticateTemplateRequest|createSupabaseServerClient|auth\.getUser|memberships/);
    },
  },
];

void (async () => {
  let passed = 0;
  for (const test of tests) {
    await test.run();
    passed += 1;
  }
  console.log(`store-contract-templates-upload-route: ${passed}/${tests.length} tests passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
