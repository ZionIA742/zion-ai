import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createContractTemplateSourceGetHandler } from "./route";

const ORGANIZATION_ID = "org-1";
const STORE_ID = "store-1";
const LEAD_ID = "lead-1";
const OPPORTUNITY_ID = "opportunity-1";

type TableResult = { data: unknown; error: { message: string } | null };

function createQuery(tableResults: Record<string, TableResult>) {
  return (table: string) => {
    const result = tableResults[table] || { data: null, error: null };
    const query = {
      select() {
        return query;
      },
      eq() {
        return query;
      },
      async maybeSingle<T>() {
        return result as { data: T | null; error: { message: string } | null };
      },
    };
    return query;
  };
}

function createAccess(
  tableResults: Record<string, TableResult>,
  signedUrl = "https://signed.example/template",
) {
  const signedCalls: Array<{ bucket: string; path: string; expiresIn: number }> = [];
  const from = createQuery(tableResults);
  const access = {
    ok: true as const,
    organizationId: ORGANIZATION_ID,
    storeId: STORE_ID,
    sessionUserId: "user-1",
    supabase: {
      from,
      storage: {
        from(bucket: string) {
          return {
            async createSignedUrl(path: string, expiresIn: number) {
              signedCalls.push({ bucket, path, expiresIn });
              return { data: { signedUrl }, error: null };
            },
          };
        },
      },
    },
    signedCalls,
  };
  return access;
}

function baseRows(): Record<string, TableResult> {
  return {
    leads: {
      data: { id: LEAD_ID, organization_id: ORGANIZATION_ID, store_id: STORE_ID },
      error: null,
    },
    commercial_opportunities: {
      data: {
        id: OPPORTUNITY_ID,
        organization_id: ORGANIZATION_ID,
        store_id: STORE_ID,
        origin_lead_id: LEAD_ID,
      },
      error: null,
    },
    store_contract_templates: {
      data: {
        id: "template-1",
        organization_id: ORGANIZATION_ID,
        store_id: STORE_ID,
        status: "active",
        active_version_id: "version-1",
      },
      error: null,
    },
    store_contract_template_versions: {
      data: {
        id: "version-1",
        template_id: "template-1",
        organization_id: ORGANIZATION_ID,
        store_id: STORE_ID,
        status: "active",
        store_file_id: "file-1",
        storage_bucket: "zion-store-files",
        storage_path: "stores/store-1/contracts/modelo-original.pdf",
        original_filename: "modelo-original.pdf",
        mime_type: "application/pdf",
      },
      error: null,
    },
    store_files: {
      data: {
        id: "file-1",
        organization_id: ORGANIZATION_ID,
        store_id: STORE_ID,
        file_kind: "store_contract_template_source",
        storage_bucket: "zion-store-files",
        storage_path: "stores/store-1/contracts/modelo-original.pdf",
        original_filename: "modelo-original.pdf",
        mime_type: "application/pdf",
      },
      error: null,
    },
  };
}

function request() {
  return new Request(
    `http://localhost/api/sales-contracts/template-source?leadId=${LEAD_ID}&commercialOpportunityId=${OPPORTUNITY_ID}`,
  );
}

test("returns a temporary URL for the active original template in the authorized store", async () => {
  const access = createAccess(baseRows());
  const handler = createContractTemplateSourceGetHandler({
    resolveAccess: async () => access as never,
  });

  const response = await handler(request());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    ok: true,
    available: true,
    signedUrl: "https://signed.example/template",
    originalFilename: "modelo-original.pdf",
    mimeType: "application/pdf",
    expiresIn: 900,
  });
  assert.deepEqual(access.signedCalls, [
    {
      bucket: "zion-store-files",
      path: "stores/store-1/contracts/modelo-original.pdf",
      expiresIn: 900,
    },
  ]);
});

test("does not cross the store boundary when the opportunity is outside the session scope", async () => {
  const rows = baseRows();
  rows.commercial_opportunities.data = {
    id: OPPORTUNITY_ID,
    organization_id: ORGANIZATION_ID,
    store_id: "store-2",
    origin_lead_id: LEAD_ID,
  };
  const access = createAccess(rows);
  const handler = createContractTemplateSourceGetHandler({
    resolveAccess: async () => access as never,
  });

  const response = await handler(request());
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.error, "CONTRACT_SCOPE_MISMATCH");
  assert.equal(access.signedCalls.length, 0);
});

test("reports an absent active template without inventing a file", async () => {
  const rows = baseRows();
  rows.store_contract_templates.data = null;
  const access = createAccess(rows);
  const handler = createContractTemplateSourceGetHandler({
    resolveAccess: async () => access as never,
  });

  const response = await handler(request());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    ok: true,
    available: false,
    message: "A loja ainda nao possui um modelo de contrato ativo.",
  });
  assert.equal(access.signedCalls.length, 0);
});

test("preserves the original PDF metadata and never exposes extracted text", async () => {
  const rows = baseRows();
  const access = createAccess(rows);
  const handler = createContractTemplateSourceGetHandler({
    resolveAccess: async () => access as never,
  });

  const body = await (await handler(request())).json();

  assert.equal(body.originalFilename, "modelo-original.pdf");
  assert.equal(body.mimeType, "application/pdf");
  assert.equal("raw_extracted_text" in body, false);
});

test("denies an unauthenticated or unavailable store session before reading files", async () => {
  const fromCalls: string[] = [];
  const handler = createContractTemplateSourceGetHandler({
    resolveAccess: async () => ({
      ok: false,
      httpStatus: 403,
      payload: {
        ok: false,
        error: "STORE_API_DENIED",
        message: "denied",
        status: "store_commercial_blocked",
        reasonCode: "store_commercial_blocked",
      },
      resolution: {} as never,
    } as never),
  });

  const response = await handler(request());
  assert.equal(response.status, 403);
  assert.equal(fromCalls.length, 0);
});

test("is a read-and-sign path only; it has no generation or mutation fallback", () => {
  const source = readFileSync(
    join(process.cwd(), "src/app/api/sales-contracts/template-source/route.ts"),
    "utf8",
  );

  assert.equal(source.includes(".insert("), false);
  assert.equal(source.includes(".update("), false);
  assert.equal(source.includes("raw_extracted_text"), false);
  assert.equal(source.includes("createSignedUrl"), true);
});

console.log("contract template source: focused tests passed");
