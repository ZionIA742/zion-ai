import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createSalesQuotesListGetHandler } from "@/app/api/sales-quotes/route";
import { listUnlinkedSalesQuotesForLead } from "./unlinked-quote-list";

type Row = Record<string, unknown>;

function createFixture(freeMetadata?: Record<string, unknown>) {
  const tables: Record<string, Row[]> = {
    leads: [
      { id: "lead-a", organization_id: "org-1", store_id: "store-1" },
      { id: "lead-b", organization_id: "org-1", store_id: "store-1" },
      { id: "lead-foreign", organization_id: "org-2", store_id: "store-1" },
      { id: "lead-other-store", organization_id: "org-1", store_id: "store-2" },
    ],
    stores: [
      { id: "store-1", organization_id: "org-1" },
    ],
    sales_quotes: [
      {
        id: "quote-free",
        metadata: freeMetadata,
        organization_id: "org-1",
        store_id: "store-1",
        lead_id: "lead-a",
        commercial_opportunity_id: null,
        quote_number: "Q-FREE",
        title: "Orcamento livre",
        status: "draft",
        total_cents: 10000,
        current_version_id: "version-free",
        created_at: "2026-11-23T12:00:00Z",
      },
      {
        id: "quote-invalid-version",
        organization_id: "org-1",
        store_id: "store-1",
        lead_id: "lead-a",
        commercial_opportunity_id: null,
        quote_number: "Q-INVALID",
        title: "Versao de outro documento",
        status: "draft",
        total_cents: 5000,
        current_version_id: "version-other-quote",
        created_at: "2026-11-23T11:00:00Z",
      },
      {
        id: "quote-opportunity",
        organization_id: "org-1",
        store_id: "store-1",
        lead_id: "lead-a",
        commercial_opportunity_id: "opp-1",
        quote_number: "Q-OPP",
        title: "Orcamento comercial",
        status: "draft",
        total_cents: 20000,
        current_version_id: null,
        created_at: "2026-11-23T10:00:00Z",
      },
      {
        id: "quote-other-lead",
        organization_id: "org-1",
        store_id: "store-1",
        lead_id: "lead-b",
        commercial_opportunity_id: null,
        quote_number: "Q-LEAD",
        current_version_id: null,
        created_at: "2026-11-23T09:00:00Z",
      },
      {
        id: "quote-other-store",
        organization_id: "org-1",
        store_id: "store-2",
        lead_id: "lead-a",
        commercial_opportunity_id: null,
        quote_number: "Q-STORE",
        current_version_id: null,
        created_at: "2026-11-23T08:00:00Z",
      },
      {
        id: "quote-foreign",
        organization_id: "org-2",
        store_id: "store-1",
        lead_id: "lead-a",
        commercial_opportunity_id: null,
        quote_number: "Q-FOREIGN",
        current_version_id: null,
        created_at: "2026-11-23T07:00:00Z",
      },
    ],
    sales_quote_versions: [
      {
        id: "version-free",
        quote_id: "quote-free",
        organization_id: "org-1",
        store_id: "store-1",
        version_number: 1,
        status: "generated",
        original_filename: "quote-free.pdf",
        mime_type: "application/pdf",
        size_bytes: 123,
      },
      {
        id: "version-other-quote",
        quote_id: "quote-opportunity",
        organization_id: "org-1",
        store_id: "store-1",
        version_number: 1,
        status: "generated",
        original_filename: "wrong.pdf",
        mime_type: "application/pdf",
        size_bytes: 321,
      },
    ],
  };

  const queryTables: string[] = [];

  const supabase = {
    from(table: string) {
      queryTables.push(table);

      const filters: Array<(row: Row) => boolean> = [];
      let orderColumn: string | null = null;
      let ascending = true;

      function resolveRows() {
        const filtered = (tables[table] || []).filter((row) =>
          filters.every((filter) => filter(row)),
        );

        if (!orderColumn) return filtered;

        const column = orderColumn;

        return filtered.sort((left, right) => {
          const result = String(left[column] ?? "").localeCompare(
            String(right[column] ?? ""),
          );
          return ascending ? result : -result;
        });
      }

      return {
        select(_columns: string) {
          void _columns;
          return this;
        },
        eq(column: string, value: unknown) {
          filters.push((row) => row[column] === value);
          return this;
        },
        in(column: string, values: unknown[]) {
          filters.push((row) => values.includes(row[column]));
          return this;
        },
        is(column: string, value: null) {
          filters.push((row) => row[column] === value);
          return this;
        },
        order(column: string, options: { ascending: boolean }) {
          orderColumn = column;
          ascending = options.ascending;
          return this;
        },
        async maybeSingle() {
          return { data: resolveRows()[0] ?? null, error: null };
        },
        then(
          onFulfilled: (value: { data: Row[]; error: null }) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          return Promise.resolve({
            data: resolveRows(),
            error: null,
          }).then(onFulfilled, onRejected);
        },
      };
    },
    async rpc() {
      throw new Error("RPC comercial nao deve ser chamada sem oportunidade");
    },
  };

  return { supabase, queryTables };
}

function authFromFixture(fixture: ReturnType<typeof createFixture>) {
  return async () =>
    ({
      supabase: fixture.supabase,
      organizationIds: ["org-1"],
    }) as never;
}

test("lista apenas orcamentos sem oportunidade da organizacao, loja e lead", async () => {
  const fixture = createFixture();
  const result = await listUnlinkedSalesQuotesForLead({
    supabase: fixture.supabase as never,
    organizationId: "org-1",
    storeId: "store-1",
    leadId: "lead-a",
  });

  assert.deepEqual(
    result.map((quote) => quote.id),
    ["quote-free", "quote-invalid-version"],
  );
  assert.equal(result[0].current_version?.id, "version-free");
  assert.equal(result[0].current_version?.original_filename, "quote-free.pdf");
  assert.equal(result[0].human_edit_eligible, false);
});

test("nao associa versao pertencente a outro orcamento", async () => {
  const fixture = createFixture();
  const result = await listUnlinkedSalesQuotesForLead({
    supabase: fixture.supabase as never,
    organizationId: "org-1",
    storeId: "store-1",
    leadId: "lead-a",
  });

  const invalid = result.find((quote) => quote.id === "quote-invalid-version");
  assert.equal(invalid?.current_version_id, "version-other-quote");
  assert.equal(invalid?.current_version, null);
});

test("API autoriza lead e loja antes de consultar documentos", async () => {
  const fixture = createFixture();
  const handler = createSalesQuotesListGetHandler({
    authenticateQuoteRequest: authFromFixture(fixture),
  });

  const response = await handler(
    new Request("https://zion.test/api/sales-quotes?leadId=lead-a"),
  );

  const body = (await response.json()) as Record<string, unknown>;
  const quotes = body.quotes as Array<Record<string, unknown>>;

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.commercialOpportunityId, null);
  assert.equal(body.currentCommercialProposal, null);
  assert.equal(body.currentCommercialProposalAcceptance, null);
  assert.deepEqual(
    quotes.map((quote) => quote.id),
    ["quote-free", "quote-invalid-version"],
  );
  assert.equal(fixture.queryTables.includes("commercial_opportunities"), false);
});

test("API nao revela lead de outra organizacao", async () => {
  const fixture = createFixture();
  const handler = createSalesQuotesListGetHandler({
    authenticateQuoteRequest: authFromFixture(fixture),
  });

  const response = await handler(
    new Request("https://zion.test/api/sales-quotes?leadId=lead-foreign"),
  );

  assert.equal(response.status, 404);
});

test("API rejeita lead com loja fora do escopo autorizado", async () => {
  const fixture = createFixture();
  const handler = createSalesQuotesListGetHandler({
    authenticateQuoteRequest: authFromFixture(fixture),
  });

  const response = await handler(
    new Request("https://zion.test/api/sales-quotes?leadId=lead-other-store"),
  );

  assert.equal(response.status, 403);
});

test("API continua exigindo leadId", async () => {
  const fixture = createFixture();
  const handler = createSalesQuotesListGetHandler({
    authenticateQuoteRequest: authFromFixture(fixture),
  });

  const response = await handler(
    new Request("https://zion.test/api/sales-quotes"),
  );

  assert.equal(response.status, 400);
});

for (const scenario of [
  { name: "historico reconhecido", metadata: { created_via: "api_sales_quotes_create", legacy_human_edit_eligible: true }, expected: true },
  { name: "criador humano comprovado", metadata: { created_via: "api_sales_quotes_create", creation_actor_kind: "user", creation_actor_user_id: "11111111-1111-4111-8111-111111111111" }, expected: true },
  { name: "origem IA", metadata: { created_via: "p19a_quote_preparation", legacy_human_edit_eligible: true }, expected: false },
]) {
  test(`API livre: elegibilidade ${scenario.name}`, async () => {
    const fixture = createFixture(scenario.metadata);
    const handler = createSalesQuotesListGetHandler({ authenticateQuoteRequest: authFromFixture(fixture) });
    const response = await handler(new Request("https://zion.test/api/sales-quotes?leadId=lead-a"));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.quotes[0].human_edit_eligible, scenario.expected);
    assert.equal(body.quotes[1].human_edit_eligible, false);
    assert.equal(Object.hasOwn(body.quotes[0], "metadata"), false);
    assert.equal(fixture.queryTables.includes("commercial_opportunities"), false);
  });
}
