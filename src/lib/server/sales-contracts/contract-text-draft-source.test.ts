import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  MAX_CONTRACT_TEXT_DRAFT_CHARS,
  ContractTextDraftSourceError,
  readContractTextDraftSource,
  type AuthorizedContractTextDraftScope,
} from "./contract-text-draft-source";

const scope: AuthorizedContractTextDraftScope = {
  organizationId: "org-1",
  storeId: "store-1",
  commercialOpportunityId: "opp-1",
  templateVersionId: "version-1",
  revision: 7,
};

const baseRows = {
  opportunity: { id: "opp-1", organization_id: "org-1", store_id: "store-1" },
  template: { id: "template-1", organization_id: "org-1", store_id: "store-1", status: "active", active_version_id: "version-1" },
  version: { id: "version-1", template_id: "template-1", organization_id: "org-1", store_id: "store-1", status: "active" },
  draft: { id: "draft-1", organization_id: "org-1", store_id: "store-1", commercial_opportunity_id: "opp-1", template_version_id: "version-1", draft_text: "Cláusula 1\r\nPreço: R$ 10,00.", revision: 7 },
};

type TableName = keyof typeof baseRows;
type MockRows = Partial<Omit<typeof baseRows, "draft">> & { draft?: typeof baseRows.draft | null };

function createMockSupabase(overrides: MockRows = {}) {
  const rows = { ...baseRows, ...overrides };
  const calls: string[] = [];
  const client = {
    from(table: string) {
      calls.push(`from:${table}`);
      const key = table === "commercial_opportunities" ? "opportunity" : table === "store_contract_templates" ? "template" : table === "store_contract_template_versions" ? "version" : table === "sales_contract_text_drafts" ? "draft" : null;
      if (!key) throw new Error(`UNEXPECTED_TABLE:${table}`);
      const query = {
        select() { calls.push(`select:${table}`); return query; },
        eq(column: string, value: unknown) { calls.push(`eq:${table}:${column}:${String(value)}`); return query; },
        maybeSingle<T>() { calls.push(`maybeSingle:${table}`); return Promise.resolve({ data: rows[key as TableName] as T | null, error: null }); },
      };
      return query;
    },
  };
  return { client, calls };
}

async function read(overrides: MockRows = {}, requestedScope = scope) {
  return readContractTextDraftSource({ supabase: createMockSupabase(overrides).client as never, authorizedScope: requestedScope });
}

async function rejectsWith(code: string, action: () => Promise<unknown>) {
  await assert.rejects(action, (error: unknown) => error instanceof ContractTextDraftSourceError && error.code === code);
}

test("recupera o rascunho exato e todos os campos tipados", async () => {
  const result = await read();
  assert.deepEqual(result, {
    draftId: "draft-1",
    organizationId: "org-1",
    storeId: "store-1",
    commercialOpportunityId: "opp-1",
    templateVersionId: "version-1",
    revision: 7,
    text: "Cláusula 1\r\nPreço: R$ 10,00.",
    sha256: createHash("sha256").update(Buffer.from("Cláusula 1\r\nPreço: R$ 10,00.", "utf8")).digest("hex"),
  });
});

test("falha sem rascunho, sem fallback", async () => rejectsWith("DRAFT_NOT_FOUND", () => read({ draft: null })));
test("falha quando a revisao diverge", async () => rejectsWith("DRAFT_REVISION_MISMATCH", () => read({}, { ...scope, revision: 8 })));
test("falha quando a organizacao diverge", async () => rejectsWith("OPPORTUNITY_SCOPE_MISMATCH", () => read({ opportunity: { ...baseRows.opportunity, organization_id: "org-other" } })));
test("falha quando a loja diverge", async () => rejectsWith("OPPORTUNITY_SCOPE_MISMATCH", () => read({ opportunity: { ...baseRows.opportunity, store_id: "store-other" } })));
test("falha quando a oportunidade diverge", async () => rejectsWith("OPPORTUNITY_SCOPE_MISMATCH", () => read({ opportunity: { ...baseRows.opportunity, id: "opp-other" } })));
test("falha quando a versao do modelo diverge", async () => rejectsWith("CONTRACT_TEMPLATE_NOT_AUTHORIZED", () => read({ template: { ...baseRows.template, active_version_id: "version-other" } })));
test("falha para modelo inativo ou sem autoridade", async () => {
  await rejectsWith("CONTRACT_TEMPLATE_NOT_AUTHORIZED", () => read({ template: { ...baseRows.template, status: "draft" } }));
  await rejectsWith("CONTRACT_TEMPLATE_VERSION_NOT_AUTHORIZED", () => read({ version: { ...baseRows.version, status: "approved" } }));
});
test("falha para texto vazio", async () => rejectsWith("DRAFT_TEXT_INVALID", () => read({ draft: { ...baseRows.draft, draft_text: " \n\t" } })));
test("falha para texto acima de 300.000 caracteres", async () => rejectsWith("DRAFT_TEXT_INVALID", () => read({ draft: { ...baseRows.draft, draft_text: "x".repeat(MAX_CONTRACT_TEXT_DRAFT_CHARS + 1) } })));
test("calcula SHA-256 deterministicamente sobre os bytes UTF-8 exatos", async () => {
  const first = await read();
  const second = await read();
  assert.equal(first.sha256, second.sha256);
  assert.notEqual(first.sha256, createHash("sha256").update("Cláusula 1\nPreço: R$ 10,00.").digest("hex"));
});
test("nao possui escrita nem efeitos externos", async () => {
  const { client, calls } = createMockSupabase();
  const result = await readContractTextDraftSource({ supabase: client as never, authorizedScope: scope });
  assert.equal(result.draftId, "draft-1");
  assert.equal(calls.some((call) => /insert|update|delete|upsert|rpc|storage/i.test(call)), false);
});
