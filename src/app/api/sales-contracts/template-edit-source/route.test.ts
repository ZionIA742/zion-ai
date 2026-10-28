import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createContractTemplateEditSourceGetHandler } from "./route";

type Row = Record<string, unknown>;

type TestRows = {
  leads?: Row | null;
  commercial_opportunities?: Row | null;
  store_contract_templates?: Row | null;
  store_contract_template_versions?: Row | null;
  store_files?: Row | null;
};

function defaults(): Required<TestRows> {
  return {
    leads: { id: "lead-1", organization_id: "org-1", store_id: "store-1" },
    commercial_opportunities: {
      id: "opp-1", organization_id: "org-1", store_id: "store-1", origin_lead_id: "lead-1",
    },
    store_contract_templates: {
      id: "template-1", organization_id: "org-1", store_id: "store-1",
      status: "active", active_version_id: "version-1",
    },
    store_contract_template_versions: {
      id: "version-1", template_id: "template-1", organization_id: "org-1",
      store_id: "store-1", status: "active", store_file_id: "file-1",
      storage_bucket: "private-contracts", storage_path: "org-1/store-1/template.pdf",
      original_filename: "modelo.pdf", raw_extracted_text: "CLÁUSULA 1\nTexto original.\n\nCLÁUSULA 2\nSem alterações.",
    },
    store_files: {
      id: "file-1", organization_id: "org-1", store_id: "store-1",
      file_kind: "store_contract_template_source", storage_bucket: "private-contracts",
      storage_path: "org-1/store-1/template.pdf", original_filename: "modelo-original.pdf",
    },
  };
}

function setup(overrides: TestRows = {}, denied = false, recovery: {
  downloadFails?: boolean;
  extractedText?: string;
  extractFails?: boolean;
} = {}) {
  const reads: string[] = [];
  const privateReads: string[] = [];
  const downloaded: string[] = [];
  const extracted: string[] = [];
  const rows = { ...defaults(), ...overrides };
  const query = (table: string, privileged: boolean) => {
    (privileged ? privateReads : reads).push(table);
    return {
      select(_columns: string) { return this; },
      eq(_column: string, _value: unknown) { return this; },
      async maybeSingle() { return { data: rows[table as keyof TestRows], error: null }; },
    };
  };
  const access = {
    ok: true as const, organizationId: "org-1", storeId: "store-1",
    supabase: { from: (table: string) => query(table, false) },
  };
  const serviceClient = {
    from: (table: string) => query(table, true),
    storage: { from: (bucket: string) => ({
      download: async (path: string) => {
        downloaded.push(`${bucket}/${path}`);
        if (recovery.downloadFails) return { data: null, error: new Error("download") };
        return { data: new Blob(["PDF FIXTURE"]), error: null };
      },
    }) },
  };
  const handler = createContractTemplateEditSourceGetHandler({
    resolveAccess: async () => denied
      ? ({
          ok: false, httpStatus: 403, payload: { ok: false, error: "STORE_API_DENIED",
            message: "denied", status: "store_commercial_blocked",
            reasonCode: "store_commercial_blocked" }, resolution: {},
        } as never)
      : (access as never),
    createServiceClient: () => serviceClient as never,
    extractText: async ({ fileName, mimeType }) => {
      extracted.push(`${fileName}:${mimeType}`);
      if (recovery.extractFails) throw new Error("unreadable pdf");
      return { text: recovery.extractedText ?? "CONTRATO EXTRAIDO\nClausula A", summary: "review" };
    },
  });
  const request = (args = "leadId=lead-1&commercialOpportunityId=opp-1") =>
    new Request(`https://zion.example/api/sales-contracts/template-edit-source?${args}`);
  return { handler, request, reads, privateReads, downloaded, extracted, rows };
}

async function main() {
  {
    const h = setup();
    const response = await h.handler(h.request());
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(body.available, true);
    assert.equal(body.templateId, "template-1");
    assert.equal(body.templateVersionId, "version-1");
    assert.equal(body.originalFilename, "modelo-original.pdf");
    assert.equal(body.text, h.rows.store_contract_template_versions?.raw_extracted_text);
    assert.deepEqual(h.privateReads, ["store_contract_templates", "store_contract_template_versions", "store_files"]);
    assert.deepEqual(h.downloaded, []);
    assert.equal(body.recoveredFromFile, false);
  }
  {
    const h = setup({}, true);
    const response = await h.handler(h.request());
    assert.equal(response.status, 403);
    assert.deepEqual(h.reads, []);
    assert.deepEqual(h.privateReads, []);
  }
  {
    const h = setup();
    const response = await h.handler(h.request("leadId=lead-1"));
    assert.equal(response.status, 400);
    assert.deepEqual(h.reads, []);
    assert.deepEqual(h.privateReads, []);
  }
  {
    const h = setup({ leads: { id: "lead-1", organization_id: "org-other", store_id: "store-1" } });
    assert.equal((await h.handler(h.request())).status, 403);
    assert.deepEqual(h.privateReads, []);
  }
  {
    const h = setup({ commercial_opportunities: {
      id: "opp-1", organization_id: "org-1", store_id: "store-1", origin_lead_id: "different-lead",
    } });
    assert.equal((await h.handler(h.request())).status, 403);
    assert.deepEqual(h.privateReads, []);
  }
  {
    const h = setup({ store_contract_templates: null });
    const response = await h.handler(h.request());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).available, false);
  }
  {
    const original = defaults().store_contract_template_versions!;
    const h = setup({ store_contract_template_versions: { ...original, raw_extracted_text: null } });
    const response = await h.handler(h.request());
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.text, "CONTRATO EXTRAIDO\nClausula A");
    assert.equal(body.recoveredFromFile, true);
    assert.equal(body.reviewRequired, true);
    assert.deepEqual(h.downloaded, ["private-contracts/org-1/store-1/template.pdf"]);
    assert.deepEqual(h.extracted, ["modelo-original.pdf:application/pdf"]);
  }
  {
    const original = defaults().store_contract_template_versions!;
    const h = setup({ store_contract_template_versions: { ...original, raw_extracted_text: null } }, false, { downloadFails: true });
    const response = await h.handler(h.request());
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "CONTRACT_TEMPLATE_RECOVERY_DOWNLOAD_FAILED");
  }
  {
    const original = defaults().store_contract_template_versions!;
    const h = setup({ store_contract_template_versions: { ...original, raw_extracted_text: null } }, false, { extractedText: "" });
    const response = await h.handler(h.request());
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "CONTRACT_TEMPLATE_RECOVERY_TEXT_EMPTY");
  }
  {
    const original = defaults().store_contract_template_versions!;
    const h = setup({ store_contract_template_versions: { ...original, raw_extracted_text: null } }, false, { extractFails: true });
    const response = await h.handler(h.request());
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "CONTRACT_TEMPLATE_RECOVERY_EXTRACT_FAILED");
  }
  {
    const original = defaults().store_contract_template_versions!;
    const h = setup({ store_contract_template_versions: { ...original, raw_extracted_text: null } }, false, { extractedText: "X".repeat(300_001) });
    const response = await h.handler(h.request());
    assert.equal(response.status, 413);
  }
  {
    const original = defaults().store_contract_template_versions!;
    const h = setup({ store_contract_template_versions: { ...original, raw_extracted_text: "X".repeat(300_001) } });
    const response = await h.handler(h.request());
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error, "CONTRACT_TEMPLATE_TEXT_TOO_LARGE");
  }
  {
    const original = defaults().store_files!;
    const h = setup({ store_files: { ...original, storage_path: "other/file.pdf" } });
    assert.equal((await h.handler(h.request())).status, 403);
  }
  {
    const original = defaults().store_contract_template_versions!;
    const h = setup({ store_contract_template_versions: { ...original, id: "version-other" } });
    assert.equal((await h.handler(h.request())).status, 403);
  }
  {
    const existingPdfRoute = readFileSync(
      join(process.cwd(), "src/app/api/sales-contracts/template-source/route.ts"), "utf8",
    );
    assert.equal(existingPdfRoute.includes("raw_extracted_text"), false);
    const editorRoute = readFileSync(
      join(process.cwd(), "src/app/api/sales-contracts/template-edit-source/route.ts"), "utf8",
    );
    assert.equal(editorRoute.includes(".insert("), false);
    assert.equal(editorRoute.includes(".update("), false);
    assert.equal(editorRoute.includes("createSignedUrl"), false);
  }
  console.log("ZION P9 template edit source: 15/15 PASS");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
