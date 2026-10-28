import { strict as assert } from "node:assert";
import { createContractTextDraftHandlers } from "./route";

type Row = Record<string, unknown>;
const recoveredText = "CLAUSULA 1\nTexto conferido.\nCLAUSULA 2\nValores e prazos.";
function setup(options: {
  saved?: boolean;
  extractText?: string;
  downloadError?: boolean;
  storeMismatch?: boolean;
} = {}) {
  const writes: Array<{ kind: string; payload: Row }> = [];
  const downloads: string[] = [];
  let draft: Row | null = options.saved ? { id: "draft-1", draft_text: "versao salva", template_version_id: "version-1", revision: 2, updated_at: "now" } : null;
  const rows: Record<string, Row> = {
    leads: { id: "lead-1", organization_id: "org-1", store_id: options.storeMismatch ? "other-store" : "store-1" },
    commercial_opportunities: { id: "opp-1", organization_id: "org-1", store_id: "store-1", origin_lead_id: "lead-1" },
    store_contract_templates: { id: "template-1", organization_id: "org-1", store_id: "store-1", status: "active", active_version_id: "version-1" },
    store_contract_template_versions: { id: "version-1", template_id: "template-1", organization_id: "org-1", store_id: "store-1", status: "active", store_file_id: "file-1", storage_bucket: "private", storage_path: "file.pdf", original_filename: "original.pdf", mime_type: "application/pdf", raw_extracted_text: null },
    store_files: { id: "file-1", organization_id: "org-1", store_id: "store-1", file_kind: "store_contract_template_source", storage_bucket: "private", storage_path: "file.pdf", original_filename: "original.pdf" },
  };
  function query(table: string) {
    let method: "insert" | "update" | null = null;
    let payload: Row = {};
    const filters: Row = {};
    const builder = {
      select(_fields: string) { return this; },
      eq(name: string, value: unknown) { filters[name] = value; return this; },
      insert(value: Row) { method = "insert"; payload = value; return this; },
      update(value: Row) { method = "update"; payload = value; return this; },
      async maybeSingle() {
        if (table !== "sales_contract_text_drafts") return { data: rows[table], error: null };
        if (method === "update") {
          writes.push({ kind: "update", payload });
          if (!draft || filters.revision !== draft.revision) return { data: null, error: null };
          draft = { ...draft, draft_text: payload.draft_text, revision: Number(draft.revision) + 1 };
        }
        return { data: draft, error: null };
      },
      async single() {
        if (table !== "sales_contract_text_drafts" || method !== "insert") throw Error("unexpected insert");
        writes.push({ kind: "insert", payload });
        if (draft) return { data: null, error: { code: "23505" } };
        draft = { ...payload, id: "draft-1", revision: 1, updated_at: "now" };
        return { data: draft, error: null };
      },
    };
    return builder;
  }
  const client = {
    from: (name: string) => query(name),
    storage: { from: (bucket: string) => ({ download: async (path: string) => {
      downloads.push(`${bucket}/${path}`);
      return options.downloadError ? { data: null, error: Error("storage") } : { data: new Blob(["PDF fixture"]), error: null };
    } }) },
  };
  const handlers = createContractTextDraftHandlers({
    resolveAccess: async () => ({
      ok: true as const, organizationId: "org-1", storeId: "store-1", sessionUserId: "user-1",
      supabase: { from: (name: string) => query(name) },
    }) as never,
    createServiceClient: () => client as never,
    extractText: async () => ({ text: options.extractText ?? recoveredText, summary: "ok" }),
  });
  const request = (patch: Row = {}) => handlers.PUT(new Request("https://zion.example/api/sales-contracts/text-draft", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      leadId: "lead-1", commercialOpportunityId: "opp-1", templateVersionId: "version-1",
      text: "CLAUSULA 1 - EDITADA\nConteudo conferido", expectedRevision: null, ...patch,
    }),
  }));
  return { request, writes, downloads, handlers };
}
async function main() {
  let pass = 0;
  {
    const h = setup(); const r = await h.request();
    assert.equal(r.status, 409); assert.equal((await r.json()).error, "CONTRACT_DRAFT_RECOVERY_REVIEW_REQUIRED");
    assert.deepEqual(h.downloads, []); assert.deepEqual(h.writes, []); pass++;
  }
  {
    const h = setup(); const r = await h.request({ recoveryReviewed: true, reviewedSourceText: recoveredText });
    const b = await r.json(); assert.equal(r.status, 200); assert.equal(b.draft.revision, 1);
    assert.deepEqual(h.downloads, ["private/file.pdf"]);
    assert.equal(h.writes.length, 1); assert.equal(h.writes[0].payload.created_by_user_id, "user-1"); pass++;
  }
  {
    const h = setup(); const r = await h.request({ recoveryReviewed: true, reviewedSourceText: "OUTRO PDF" });
    assert.equal(r.status, 409); assert.equal((await r.json()).error, "CONTRACT_DRAFT_RECOVERY_CHANGED");
    assert.deepEqual(h.writes, []); pass++;
  }
  {
    const h = setup({ extractText: "ALTERADO NO SERVIDOR" });
    const r = await h.request({ recoveryReviewed: true, reviewedSourceText: recoveredText });
    assert.equal(r.status, 409); assert.deepEqual(h.writes, []); pass++;
  }
  {
    const h = setup({ downloadError: true });
    const r = await h.request({ recoveryReviewed: true, reviewedSourceText: recoveredText });
    assert.equal(r.status, 409); assert.deepEqual(h.writes, []); pass++;
  }
  {
    const h = setup({ saved: true });
    const r = await h.request({ expectedRevision: 2 }); const b = await r.json();
    assert.equal(r.status, 200); assert.equal(b.draft.revision, 3);
    assert.deepEqual(h.downloads, []); assert.equal(h.writes[0].kind, "update"); pass++;
  }
  {
    const h = setup({ storeMismatch: true });
    const r = await h.request({ recoveryReviewed: true, reviewedSourceText: recoveredText });
    assert.equal(r.status, 403); assert.deepEqual(h.downloads, []); assert.deepEqual(h.writes, []); pass++;
  }
  console.log(`ZION P9 reviewed PDF draft: ${pass}/${pass} PASS`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
