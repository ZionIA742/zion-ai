import { strict as assert } from "node:assert";
import {
  createContractTemplateDownloadGetHandler,
} from "./route";

type Version = Record<string, unknown> | null;

function granted(supabase: unknown) {
  return {
    ok: true as const,
    supabase,
    resolution: {} as never,
    sessionUserId: "user-1",
    organizationId: "org-1",
    storeId: "store-1",
  };
}

function createFake(args: {
  version?: Version;
  file?: Version;
  signedUrl?: string | null;
}) {
  const template = { id: "template-1", organization_id: "org-1", store_id: "store-1" };
  const version = args.version === undefined
    ? {
        id: "version-1",
        template_id: "template-1",
        organization_id: "org-1",
        store_id: "store-1",
        store_file_id: "file-1",
        storage_bucket: "zion-store-files",
        storage_path: "org-1/store-1/file-1.pdf",
        original_filename: "contrato.pdf",
        mime_type: "application/pdf",
      }
    : args.version;
  const file = args.file === undefined
    ? {
        id: "file-1",
        organization_id: "org-1",
        store_id: "store-1",
        file_kind: "store_contract_template_source",
        storage_bucket: "zion-store-files",
        storage_path: "org-1/store-1/file-1.pdf",
        original_filename: "contrato.pdf",
        mime_type: "application/pdf",
      }
    : args.file;
  const storageCalls: string[] = [];

  function from(table: string) {
    const filters: Record<string, unknown> = {};
    const chain = {
      select() { return chain; },
      eq(column: string, value: unknown) {
        filters[column] = value;
        return chain;
      },
      async maybeSingle() {
        if (table === "store_contract_templates") return { data: template, error: null };
        if (table === "store_contract_template_versions") {
          const matches = version &&
            Object.entries(filters).every(([key, value]) => version[key] === value);
          return { data: matches ? version : null, error: null };
        }
        if (table === "store_files") {
          const matches = file &&
            Object.entries(filters).every(([key, value]) => file[key] === value);
          return { data: matches ? file : null, error: null };
        }
        return { data: null, error: null };
      },
    };
    return chain;
  }

  const client = {
    from,
    storage: {
      from(bucket: string) {
        return {
          async createSignedUrl(path: string, expiresIn: number) {
            storageCalls.push(`${bucket}:${path}:${expiresIn}`);
            return args.signedUrl === null
              ? { data: null, error: { message: "storage unavailable" } }
              : { data: { signedUrl: args.signedUrl || "https://private.example/signed" }, error: null };
          },
        };
      },
    },
  };

  return { client, storageCalls };
}

function request(storeId = "store-1") {
  return new Request(
    `http://localhost/api/store-contract-templates/version-1/download?storeId=${storeId}`,
  );
}

function context(versionId = "version-1") {
  return { params: Promise.resolve({ versionId }) };
}

const tests = [
  {
    name: "unauthenticated access is denied before storage",
    run: async () => {
      const response = await createContractTemplateDownloadGetHandler({
        resolveAccess: async () => ({
          ok: false as const,
          resolution: {} as never,
          httpStatus: 401,
          payload: {
            ok: false,
            error: "STORE_API_UNAUTHENTICATED",
            message: "Faca login para acessar esta API da loja.",
            status: "anonymous",
            reasonCode: "anonymous",
          },
        }),
      })(request(), context());
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error, "STORE_API_UNAUTHENTICATED");
    },
  },
  {
    name: "authorized PDF download returns a short-lived private URL",
    run: async () => {
      const fake = createFake({});
      const response = await createContractTemplateDownloadGetHandler({
        resolveAccess: async () => granted(fake.client),
      })(request(), context());
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.originalFilename, "contrato.pdf");
      assert.equal(body.expiresIn, 900);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.deepEqual(fake.storageCalls, ["zion-store-files:org-1/store-1/file-1.pdf:900"]);
    },
  },
  {
    name: "authorized DOCX download preserves original filename and mime type",
    run: async () => {
      const fake = createFake({
        version: {
          id: "version-1", template_id: "template-1", organization_id: "org-1", store_id: "store-1",
          store_file_id: "file-1", storage_bucket: "zion-store-files", storage_path: "org-1/store-1/file-1.docx",
          original_filename: "modelo-revisado.docx", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
        file: {
          id: "file-1", organization_id: "org-1", store_id: "store-1", file_kind: "store_contract_template_source",
          storage_bucket: "zion-store-files", storage_path: "org-1/store-1/file-1.docx", original_filename: "modelo-revisado.docx",
          mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      });
      const response = await createContractTemplateDownloadGetHandler({
        resolveAccess: async () => granted(fake.client),
      })(request(), context());
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.originalFilename, "modelo-revisado.docx");
      assert.equal(body.mimeType, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    },
  },
  {
    name: "foreign store, missing version, and missing file are blocked",
    run: async () => {
      const foreign = createFake({});
      const foreignResponse = await createContractTemplateDownloadGetHandler({
        resolveAccess: async () => granted(foreign.client),
      })(request("store-foreign"), context());
      assert.equal(foreignResponse.status, 403);

      const missingVersion = createFake({ version: null });
      const missingVersionResponse = await createContractTemplateDownloadGetHandler({
        resolveAccess: async () => granted(missingVersion.client),
      })(request(), context());
      assert.equal(missingVersionResponse.status, 404);

      const noFile = createFake({
        version: {
          id: "version-1", template_id: "template-1", organization_id: "org-1", store_id: "store-1",
          store_file_id: null, storage_bucket: null, storage_path: null, original_filename: "contrato.pdf", mime_type: "application/pdf",
        },
      });
      const noFileResponse = await createContractTemplateDownloadGetHandler({
        resolveAccess: async () => granted(noFile.client),
      })(request(), context());
      assert.equal(noFileResponse.status, 422);
    },
  },
  {
    name: "file scope mismatch and storage errors fail closed without writing",
    run: async () => {
      const mismatch = createFake({
        file: {
          id: "file-1", organization_id: "org-foreign", store_id: "store-1", file_kind: "store_contract_template_source",
          storage_bucket: "zion-store-files", storage_path: "org-1/store-1/file-1.pdf", original_filename: "contrato.pdf", mime_type: "application/pdf",
        },
      });
      const mismatchResponse = await createContractTemplateDownloadGetHandler({
        resolveAccess: async () => granted(mismatch.client),
      })(request(), context());
      assert.equal(mismatchResponse.status, 403);
      assert.equal(mismatch.storageCalls.length, 0);

      const storageFailure = createFake({ signedUrl: null });
      const storageResponse = await createContractTemplateDownloadGetHandler({
        resolveAccess: async () => granted(storageFailure.client),
      })(request(), context());
      assert.equal(storageResponse.status, 500);
      assert.equal(storageFailure.storageCalls.length, 1);
    },
  },
];

void (async () => {
  for (const test of tests) await test.run();
  console.log(`store-contract-template-download: ${tests.length}/${tests.length} tests passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
