import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createContractTextDraftHandlers } from "./route";

type Row = Record<string, unknown>;
type Tables = Record<string, Row | null>;
type DraftRow = Row & { revision: number; draft_text: string };

function fixture(options: {
  rows?: Partial<Tables>;
  existingDraft?: DraftRow | null;
  denied?: boolean;
  sessionUserId?: string | null;
  createConflict?: boolean;
} = {}) {
  const defaultRows: Tables = {
    leads: { id: "lead-1", organization_id: "org-1", store_id: "store-1" },
    commercial_opportunities: { id: "opp-1", organization_id: "org-1", store_id: "store-1", origin_lead_id: "lead-1" },
    store_contract_templates: { id: "template-1", organization_id: "org-1", store_id: "store-1", status: "active", active_version_id: "version-1" },
    store_contract_template_versions: { id: "version-1", template_id: "template-1", organization_id: "org-1", store_id: "store-1", status: "active", store_file_id: "file-1", storage_bucket: "private-contracts", storage_path: "template.pdf", raw_extracted_text: "CLAUSULA 1\n\nTexto original" },
    store_files: { id: "file-1", organization_id: "org-1", store_id: "store-1", file_kind: "store_contract_template_source", storage_bucket: "private-contracts", storage_path: "template.pdf" },
  };
  const rows = { ...defaultRows, ...options.rows };
  let draft = options.existingDraft ?? null;
  const writes: Array<{ method: "insert" | "update"; table: string; payload: Row; filters: Row }> = [];
  const reads: string[] = [];
  const privateReads: string[] = [];

  const query = (table: string, privileged: boolean) => {
    const filters: Row = {};
    let method: "insert" | "update" | null = null;
    let payload: Row = {};
    (privileged ? privateReads : reads).push(table);
    const builder = {
      select(_fields: string) { return this; },
      eq(column: string, value: unknown) { filters[column] = value; return this; },
      insert(value: Row) { method = "insert"; payload = value; return this; },
      update(value: Row) { method = "update"; payload = value; return this; },
      async maybeSingle() {
        if (table !== "sales_contract_text_drafts") return { data: rows[table] ?? null, error: null };
        if (method === "update") {
          writes.push({ method: "update", table, payload, filters: { ...filters } });
          if (!draft || filters.revision !== draft.revision) return { data: null, error: null };
          draft = { ...draft, draft_text: String(payload.draft_text), revision: draft.revision + 1,
            updated_at: "2026-10-26T12:00:00Z" };
          return { data: draft, error: null };
        }
        return { data: draft, error: null };
      },
      async single() {
        if (table !== "sales_contract_text_drafts" || method !== "insert") throw new Error("unexpected single");
        writes.push({ method: "insert", table, payload, filters: { ...filters } });
        if (options.createConflict || draft) return { data: null, error: { code: "23505", message: "duplicate key" } };
        draft = { ...payload, draft_text: String(payload.draft_text), id: "draft-1", revision: 1, updated_at: "2026-10-26T12:00:00Z" };
        return { data: draft, error: null };
      },
    };
    return builder;
  };
  const access = { ok: true as const, organizationId: "org-1", storeId: "store-1", sessionUserId: options.sessionUserId === undefined ? "user-1" : options.sessionUserId,
    supabase: { from: (table: string) => query(table, false) } };
  const privateClient = { from: (table: string) => query(table, true) };
  const handlers = createContractTextDraftHandlers({
    resolveAccess: async () => options.denied ? ({
      ok: false, httpStatus: 403,
      payload: { ok: false, error: "STORE_API_DENIED", message: "denied", status: "store_commercial_blocked", reasonCode: "store_commercial_blocked" }, resolution: {},
    } as never) : access as never,
    createServiceClient: () => privateClient as never,
  });
  const url = "https://zion.example/api/sales-contracts/text-draft?leadId=lead-1&commercialOpportunityId=opp-1";
  const read = async (urlOverride = url) => {
    const response = await handlers.GET(new Request(urlOverride));
    assert.ok(response, "GET must return an HTTP response");
    return response;
  };
  const save = async (payload: Row) => {
    const response = await handlers.PUT(new Request(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }));
    assert.ok(response, "PUT must return an HTTP response");
    return response;
  };
  const body = (patch: Row = {}): Row => ({ leadId: "lead-1", commercialOpportunityId: "opp-1", templateVersionId: "version-1", text: "CLAUSULA REVISADA\n\nTexto preservado", expectedRevision: null, ...patch });
  return { handlers, read, save, body, writes, reads, privateReads, currentDraft: () => draft };
}

async function main() {
  let passed = 0;
  {
    const h = fixture();
    const r = await h.read(); const b = await r.json();
    assert.equal(r.status, 200); assert.equal(b.templateVersionId, "version-1");
    assert.equal(b.draft, null); assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(b.draftId, null); assert.equal(b.draftSha256, null);
    assert.deepEqual(h.writes, []); passed++;
  }
  {
    const h = fixture({ existingDraft: { id: "draft-1", revision: 2, draft_text: "Texto guardado", template_version_id: "version-1", updated_at: "2026-10-26" } });
    const b = await (await h.read()).json();
    assert.equal(b.draft.text, "Texto guardado"); assert.equal(b.draft.revision, 2);
    assert.equal(b.draft.draftId, "draft-1");
    assert.equal(b.draft.draftSha256, createHash("sha256").update(Buffer.from("Texto guardado", "utf8")).digest("hex"));
    assert.equal(b.draftId, b.draft.draftId); assert.equal(b.draftSha256, b.draft.draftSha256);
    assert.deepEqual(h.writes, []); passed++;
  }
  {
    const h = fixture();
    const r = await h.save(h.body()); const b = await r.json();
    assert.equal(r.status, 200); assert.equal(b.draft.revision, 1);
    assert.equal(b.draft.text, "CLAUSULA REVISADA\n\nTexto preservado");
    assert.equal(b.draft.draftId, "draft-1");
    assert.equal(b.draft.draftSha256, createHash("sha256").update(Buffer.from("CLAUSULA REVISADA\n\nTexto preservado", "utf8")).digest("hex"));
    assert.equal(h.writes.length, 1); assert.equal(h.writes[0].method, "insert");
    assert.equal(h.writes[0].payload.created_by_user_id, "user-1");
    assert.equal(h.writes[0].payload.updated_by_user_id, "user-1");
    assert.equal(h.writes[0].payload.template_version_id, "version-1"); passed++;
  }
  {
    const h = fixture({ existingDraft: { id: "draft-1", revision: 3, draft_text: "Anterior", updated_at: "2026-10-26" } });
    const r = await h.save(h.body({ text: "Atualizado\n\nSem alterar original", expectedRevision: 3 })); const b = await r.json();
    assert.equal(r.status, 200); assert.equal(b.draft.revision, 4);
    assert.equal(b.draft.draftId, "draft-1");
    assert.equal(b.draft.draftSha256, createHash("sha256").update(Buffer.from("Atualizado\n\nSem alterar original", "utf8")).digest("hex"));
    assert.equal(h.writes[0].filters.revision, 3);
    assert.equal(h.writes[0].payload.draft_text, "Atualizado\n\nSem alterar original");
    assert.deepEqual(Object.keys(h.writes[0].payload).sort(), ["draft_text", "updated_by_user_id"]);
    passed++;
  }
  {
    const h = fixture({ existingDraft: { id: "draft-1", revision: 4, draft_text: "Mais recente", updated_at: "2026-10-26" } });
    const r = await h.save(h.body({ expectedRevision: 3 })); const b = await r.json();
    assert.equal(r.status, 409); assert.equal(b.error, "CONTRACT_DRAFT_REVISION_CONFLICT");
    assert.equal(h.currentDraft()?.draft_text, "Mais recente"); passed++;
  }
  {
    const h = fixture({ createConflict: true });
    const r = await h.save(h.body()); assert.equal(r.status, 409);
    assert.equal((await r.json()).error, "CONTRACT_DRAFT_REVISION_CONFLICT"); passed++;
  }
  {
    const h = fixture({ denied: true });
    const r = await h.save(h.body()); assert.equal(r.status, 403);
    assert.deepEqual(h.privateReads, []); assert.deepEqual(h.writes, []); passed++;
  }
  {
    const h = fixture({ rows: { leads: { id: "lead-1", organization_id: "org-other", store_id: "store-1" } } });
    const r = await h.save(h.body()); assert.equal(r.status, 403);
    assert.deepEqual(h.privateReads, []); assert.deepEqual(h.writes, []); passed++;
  }
  {
    const h = fixture({ rows: { commercial_opportunities: { id: "opp-1", organization_id: "org-1", store_id: "store-1", origin_lead_id: "other-lead" } } });
    assert.equal((await h.save(h.body())).status, 403);
    assert.deepEqual(h.privateReads, []); assert.deepEqual(h.writes, []); passed++;
  }
  {
    const h = fixture(); const r = await h.save(h.body({ templateVersionId: "version-old" }));
    assert.equal(r.status, 409); assert.equal((await r.json()).error, "CONTRACT_TEMPLATE_VERSION_CHANGED");
    assert.deepEqual(h.writes, []); passed++;
  }
  {
    const h = fixture(); const r = await h.save(h.body({ text: " \n" }));
    assert.equal(r.status, 400); assert.deepEqual(h.writes, []); passed++;
  }
  {
    const h = fixture(); const r = await h.save(h.body({ text: "x".repeat(300_001) }));
    assert.equal(r.status, 400); assert.deepEqual(h.writes, []); passed++;
  }
  {
    const h = fixture(); const r = await h.save(h.body({ expectedRevision: -1 }));
    assert.equal(r.status, 400); assert.deepEqual(h.writes, []); passed++;
  }
  {
    const h = fixture({ sessionUserId: null }); const r = await h.save(h.body());
    assert.equal(r.status, 403); assert.deepEqual(h.writes, []); passed++;
  }
  {
    const h = fixture({ rows: { store_contract_templates: { id: "template-1", organization_id: "org-1", store_id: "store-1", status: "disabled", active_version_id: null } } });
    assert.equal((await h.save(h.body())).status, 409); assert.deepEqual(h.writes, []); passed++;
  }
  {
    const h = fixture({ rows: { store_files: { id: "file-1", organization_id: "org-1", store_id: "store-1", file_kind: "store_contract_template_source", storage_bucket: "private-contracts", storage_path: "different.pdf" } } });
    assert.equal((await h.save(h.body())).status, 403); assert.deepEqual(h.writes, []); passed++;
  }
  {
    const h = fixture(); assert.equal((await h.read("https://zion.example/api/sales-contracts/text-draft?leadId=lead-1")).status, 400);
    assert.deepEqual(h.privateReads, []); passed++;
  }
  {
    const source = readFileSync(join(process.cwd(), "src/app/api/sales-contracts/template-source/route.ts"), "utf8");
    assert.equal(source.includes("raw_extracted_text"), false);
    const route = readFileSync(join(process.cwd(), "src/app/api/sales-contracts/text-draft/route.ts"), "utf8");
    assert.equal(route.includes(".delete("), false);
    assert.equal(route.includes(".from(\"sales_contracts\")"), false);
    assert.equal(route.includes(".from(\"sales_contract_versions\")"), false);
    assert.equal(route.includes("createSignedUrl"), false); passed++;
  }
  console.log(`ZION P9 contract text drafts: ${passed}/${passed} PASS`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
