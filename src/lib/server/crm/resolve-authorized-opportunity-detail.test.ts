import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveAuthorizedOpportunityDetail } from "./resolve-authorized-opportunity-detail";
import {
  createProductionDataAccess,
  resolveAuthorizedOpportunityDetailCore,
  resolveAuthorizedOpportunityDetailWithDeps,
  type AuthorizedStoreContext,
  type OpportunityDetailDataAccess,
  type ServiceSupabaseLike,
} from "./resolve-authorized-opportunity-detail.internal";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

type OpportunityRow = {
  id: string;
  organization_id: string;
  store_id: string;
  customer_id: string;
  origin_lead_id: string | null;
  primary_conversation_id: string | null;
  stage: string | null;
  stage_changed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type CustomerRow = {
  id: string;
  organization_id: string;
  display_name: string | null;
  merged_into_customer_id: string | null;
};

type CustomerStoreLinkRow = {
  id: string;
  organization_id: string;
  store_id: string;
  customer_id: string;
};

type LeadRow = {
  id: string;
  organization_id: string;
  store_id: string | null;
  name: string | null;
  phone: string | null;
};

type ConversationIdentityRow = {
  id: string;
  organization_id: string;
  lead_id: string | null;
};

type ConversationHumanStateRow = {
  id: string;
  organization_id: string;
  is_human_active: boolean | null;
};

type ConversationSessionRow = {
  id: string;
  organization_id: string;
  store_id: string;
  conversation_id: string;
  status: string;
};

type ContextLinkRow = {
  id: string;
  organization_id: string;
  store_id: string;
  conversation_session_id: string;
  customer_id: string;
  commercial_opportunity_id: string;
  lead_customer_link_id: string;
  status: string;
  unlinked_at: string | null;
};

type LeadCustomerLinkProofRow = {
  id: string;
  organization_id: string;
  store_id: string;
  customer_id: string;
  lead_id: string;
  status: string;
  unlinked_at: string | null;
};

type FactoryOptions = {
  opportunity?: OpportunityRow | null;
  customer?: CustomerRow | null;
  customerStoreLink?: CustomerStoreLinkRow | null;
  lead?: LeadRow | null;
  conversationIdentity?: ConversationIdentityRow | null;
  conversationHumanState?: ConversationHumanStateRow | null;
  conversationSession?: ConversationSessionRow | null;
  contextLink?: ContextLinkRow | null;
  leadCustomerLinkProof?: LeadCustomerLinkProofRow | null;
  thrown?: Partial<Record<keyof OpportunityDetailDataAccess, Error>>;
  onCall?: Partial<Record<keyof OpportunityDetailDataAccess, () => void>>;
};

type RecordedFilter = {
  kind: "eq" | "is";
  column: string;
  value: unknown;
};

type RecordedQuery = {
  table: string;
  operation: "select";
  selection: string;
  filters: RecordedFilter[];
  maybeSingleCalls: number;
};

type QueryResponse = {
  data: unknown | null;
  error?: { message: string } | null;
};

type QueryHandler = {
  table: string;
  response: QueryResponse;
  match?: (query: RecordedQuery) => boolean;
};

type RecordingHarness = {
  client: ServiceSupabaseLike;
  queries: RecordedQuery[];
  assertAllHandlersConsumed(): void;
};

function createBaseContext(): AuthorizedStoreContext {
  return {
    sessionUserId: "user-scope",
    organizationId: "22222222-2222-4222-8222-222222222222",
    storeId: "33333333-3333-4333-8333-333333333333",
  };
}

function createBaseOpportunity(
  overrides: Partial<OpportunityRow> = {},
): OpportunityRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    organization_id: "22222222-2222-4222-8222-222222222222",
    store_id: "33333333-3333-4333-8333-333333333333",
    customer_id: "44444444-4444-4444-8444-444444444444",
    origin_lead_id: "55555555-5555-4555-8555-555555555555",
    primary_conversation_id: "66666666-6666-4666-8666-666666666666",
    stage: "qualificacao",
    stage_changed_at: "2026-07-31T10:00:00.000Z",
    created_at: "2026-07-30T10:00:00.000Z",
    updated_at: "2026-07-31T11:00:00.000Z",
    ...overrides,
  };
}

function createBaseCustomer(
  overrides: Partial<CustomerRow> = {},
): CustomerRow {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    organization_id: "22222222-2222-4222-8222-222222222222",
    display_name: "Cliente sintetico",
    merged_into_customer_id: null,
    ...overrides,
  };
}

function createBaseCustomerStoreLink(
  overrides: Partial<CustomerStoreLinkRow> = {},
): CustomerStoreLinkRow {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    organization_id: "22222222-2222-4222-8222-222222222222",
    store_id: "33333333-3333-4333-8333-333333333333",
    customer_id: "44444444-4444-4444-8444-444444444444",
    ...overrides,
  };
}

function createBaseLead(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    organization_id: "22222222-2222-4222-8222-222222222222",
    store_id: "33333333-3333-4333-8333-333333333333",
    name: "Lead sintetico",
    phone: "5511999999999",
    ...overrides,
  };
}

function createBaseConversationIdentity(
  overrides: Partial<ConversationIdentityRow> = {},
): ConversationIdentityRow {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    organization_id: "22222222-2222-4222-8222-222222222222",
    lead_id: "55555555-5555-4555-8555-555555555555",
    ...overrides,
  };
}

function createBaseConversationHumanState(
  overrides: Partial<ConversationHumanStateRow> = {},
): ConversationHumanStateRow {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    organization_id: "22222222-2222-4222-8222-222222222222",
    is_human_active: true,
    ...overrides,
  };
}

function createBaseConversationSession(
  overrides: Partial<ConversationSessionRow> = {},
): ConversationSessionRow {
  return {
    id: "88888888-8888-4888-8888-888888888888",
    organization_id: "22222222-2222-4222-8222-222222222222",
    store_id: "33333333-3333-4333-8333-333333333333",
    conversation_id: "66666666-6666-4666-8666-666666666666",
    status: "active",
    ...overrides,
  };
}

function createBaseContextLink(
  overrides: Partial<ContextLinkRow> = {},
): ContextLinkRow {
  return {
    id: "99999999-9999-4999-8999-999999999999",
    organization_id: "22222222-2222-4222-8222-222222222222",
    store_id: "33333333-3333-4333-8333-333333333333",
    conversation_session_id: "88888888-8888-4888-8888-888888888888",
    customer_id: "44444444-4444-4444-8444-444444444444",
    commercial_opportunity_id: "11111111-1111-4111-8111-111111111111",
    lead_customer_link_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    status: "active",
    unlinked_at: null,
    ...overrides,
  };
}

function createBaseLeadCustomerLinkProof(
  overrides: Partial<LeadCustomerLinkProofRow> = {},
): LeadCustomerLinkProofRow {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    organization_id: "22222222-2222-4222-8222-222222222222",
    store_id: "33333333-3333-4333-8333-333333333333",
    customer_id: "44444444-4444-4444-8444-444444444444",
    lead_id: "55555555-5555-4555-8555-555555555555",
    status: "active",
    unlinked_at: null,
    ...overrides,
  };
}

function createDataAccess(
  options: FactoryOptions = {},
): OpportunityDetailDataAccess {
  const onCall = options.onCall ?? {};

  return {
    isSafeOpportunityId(value) {
      onCall.isSafeOpportunityId?.();
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      );
    },
    async loadOpportunityById() {
      onCall.loadOpportunityById?.();
      if (options.thrown?.loadOpportunityById) throw options.thrown.loadOpportunityById;
      return options.opportunity === undefined ? createBaseOpportunity() : options.opportunity;
    },
    async loadCustomerById() {
      onCall.loadCustomerById?.();
      if (options.thrown?.loadCustomerById) throw options.thrown.loadCustomerById;
      return options.customer === undefined ? createBaseCustomer() : options.customer;
    },
    async loadCustomerStoreLink() {
      onCall.loadCustomerStoreLink?.();
      if (options.thrown?.loadCustomerStoreLink) {
        throw options.thrown.loadCustomerStoreLink;
      }
      return options.customerStoreLink === undefined
        ? createBaseCustomerStoreLink()
        : options.customerStoreLink;
    },
    async loadLeadById() {
      onCall.loadLeadById?.();
      if (options.thrown?.loadLeadById) throw options.thrown.loadLeadById;
      return options.lead === undefined ? createBaseLead() : options.lead;
    },
    async loadConversationIdentityById() {
      onCall.loadConversationIdentityById?.();
      if (options.thrown?.loadConversationIdentityById) {
        throw options.thrown.loadConversationIdentityById;
      }
      return options.conversationIdentity === undefined
        ? createBaseConversationIdentity()
        : options.conversationIdentity;
    },
    async loadConversationHumanStateById() {
      onCall.loadConversationHumanStateById?.();
      if (options.thrown?.loadConversationHumanStateById) {
        throw options.thrown.loadConversationHumanStateById;
      }
      return options.conversationHumanState === undefined
        ? createBaseConversationHumanState()
        : options.conversationHumanState;
    },
    async loadActiveConversationSessionByConversationId() {
      onCall.loadActiveConversationSessionByConversationId?.();
      if (options.thrown?.loadActiveConversationSessionByConversationId) {
        throw options.thrown.loadActiveConversationSessionByConversationId;
      }
      return options.conversationSession === undefined
        ? createBaseConversationSession()
        : options.conversationSession;
    },
    async loadActiveContextLinkBySession() {
      onCall.loadActiveContextLinkBySession?.();
      if (options.thrown?.loadActiveContextLinkBySession) {
        throw options.thrown.loadActiveContextLinkBySession;
      }
      return options.contextLink === undefined
        ? createBaseContextLink()
        : options.contextLink;
    },
    async loadActiveLeadCustomerLinkProof() {
      onCall.loadActiveLeadCustomerLinkProof?.();
      if (options.thrown?.loadActiveLeadCustomerLinkProof) {
        throw options.thrown.loadActiveLeadCustomerLinkProof;
      }
      return options.leadCustomerLinkProof === undefined
        ? createBaseLeadCustomerLinkProof()
        : options.leadCustomerLinkProof;
    },
  };
}

function hasFilter(
  query: RecordedQuery,
  kind: RecordedFilter["kind"],
  column: string,
  value: unknown,
) {
  return query.filters.some(
    (filter) =>
      filter.kind === kind &&
      filter.column === column &&
      filter.value === value,
  );
}

function createExpectedQueryHandler(
  table: string,
  expectedFilters: RecordedFilter[],
  response: QueryResponse,
): QueryHandler {
  return {
    table,
    response,
    match(query) {
      return (
        query.filters.length === expectedFilters.length &&
        expectedFilters.every((filter) =>
          hasFilter(query, filter.kind, filter.column, filter.value),
        )
      );
    },
  };
}

function createRecordingHarness(handlers: QueryHandler[]): RecordingHarness {
  const queries: RecordedQuery[] = [];
  const consumed = new Set<number>();

  const client: ServiceSupabaseLike = {
    from(table: string) {
      return {
        select(selection: string) {
          const record: RecordedQuery = {
            table,
            operation: "select",
            selection,
            filters: [],
            maybeSingleCalls: 0,
          };
          queries.push(record);

          const filter = {
            eq(column: string, value: unknown) {
              record.filters.push({ kind: "eq", column, value });
              return filter;
            },
            is(column: string, value: null) {
              record.filters.push({ kind: "is", column, value });
              return filter;
            },
            async maybeSingle() {
              record.maybeSingleCalls += 1;

              const handlerIndex = handlers.findIndex((handler, index) => {
                if (consumed.has(index) || handler.table !== table) {
                  return false;
                }

                return handler.match ? handler.match(record) : true;
              });

              if (handlerIndex === -1) {
                throw new Error(`Unexpected query for ${table}`);
              }

              consumed.add(handlerIndex);
              const handler = handlers[handlerIndex];
              return {
                data: handler.response.data,
                error: handler.response.error ?? null,
              };
            },
          };

          return filter;
        },
      };
    },
  };

  return {
    client,
    queries,
    assertAllHandlersConsumed() {
      const pending = handlers
        .map((handler, index) => ({ handler, index }))
        .filter(({ index }) => !consumed.has(index));

      assert.deepEqual(
        pending.map(({ handler }) => handler.table),
        [],
        `unused query handlers: ${pending.map(({ handler }) => handler.table).join(", ")}`,
      );
    },
  };
}

function findQuery(queries: RecordedQuery[], table: string, ordinal = 0) {
  const matches = queries.filter((entry) => entry.table === table);
  assert.ok(matches[ordinal], `expected recorded query ${table} at index ${ordinal}`);
  return matches[ordinal];
}

function assertHasEq(query: RecordedQuery, column: string, value: unknown) {
  assert.equal(
    hasFilter(query, "eq", column, value),
    true,
    `expected eq filter ${column}`,
  );
}

function assertHasIsNull(query: RecordedQuery, column: string) {
  assert.equal(
    hasFilter(query, "is", column, null),
    true,
    `expected is null filter ${column}`,
  );
}

function assertNoFilter(query: RecordedQuery, column: string) {
  assert.equal(
    query.filters.some((filter) => filter.column === column),
    false,
    `did not expect filter ${column}`,
  );
}

function assertFilterCount(query: RecordedQuery, expectedCount: number) {
  assert.equal(
    query.filters.length,
    expectedCount,
    `expected ${expectedCount} filters for ${query.table}`,
  );
}

function assertConversationRejectedWithoutProof(
  result: Awaited<ReturnType<typeof resolveAuthorizedOpportunityDetailCore>>,
  humanStateCalls: number,
) {
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected success");
  assert.equal(result.data.hasPrimaryConversation, true);
  assert.equal(result.data.primaryConversation, null);
  assert.equal(result.data.isHumanActive, null);
  assert.equal(
    result.data.problems.includes("primary_conversation_scope_inconsistency"),
    true,
  );
  assert.equal(result.data.requiresAttention, true);
  assert.equal(humanStateCalls, 0);
}

const tests: TestCase[] = [
  {
    name: "wrapper publico tem apenas um parametro e nao aceita overrides",
    run: () => {
      assert.equal(resolveAuthorizedOpportunityDetail.length, 1);
      const source = readFileSync(
        join(
          process.cwd(),
          "src/lib/server/crm/resolve-authorized-opportunity-detail.ts",
        ),
        "utf8",
      );

      assert.match(
        source,
        /export async function resolveAuthorizedOpportunityDetail\(\s*commercialOpportunityId: string,\s*\)/,
      );
      assert.equal(source.includes("overrides"), false);
      assert.equal(source.includes("defaultDeps"), false);
    },
  },
  {
    name: "usuario nao autenticado falha antes do service_role",
    run: async () => {
      let createDataAccessCalls = 0;
      const result = await resolveAuthorizedOpportunityDetailWithDeps(
        "11111111-1111-4111-8111-111111111111",
        {
          async resolveStoreAccess() {
            return { ok: false, reason: "unauthenticated" };
          },
          createDataAccess() {
            createDataAccessCalls += 1;
            return createDataAccess();
          },
        },
      );

      assert.deepEqual(result, {
        ok: false,
        error: "unauthenticated",
        message: "Usuario nao autenticado.",
      });
      assert.equal(createDataAccessCalls, 0);
    },
  },
  {
    name: "contexto autorizado indisponivel retorna falha tecnica",
    run: async () => {
      const result = await resolveAuthorizedOpportunityDetailWithDeps(
        "11111111-1111-4111-8111-111111111111",
        {
          async resolveStoreAccess() {
            return { ok: false, reason: "unavailable" };
          },
          createDataAccess() {
            throw new Error("should not create service client");
          },
        },
      );

      assert.deepEqual(result, {
        ok: false,
        error: "technical_error",
        message: "Nao foi possivel carregar o detalhe da oportunidade.",
      });
    },
  },
  {
    name: "oportunidade correta no contexto atual retorna detalhe seguro",
    run: async () => {
      const result = await resolveAuthorizedOpportunityDetailCore(
        "11111111-1111-4111-8111-111111111111",
        createBaseContext(),
        createDataAccess(),
      );

      assert.equal(result.ok, true);
      if (!result.ok) throw new Error("expected success");
      assert.equal(result.data.opportunity.id, "11111111-1111-4111-8111-111111111111");
      assert.equal(result.data.opportunity.stage, "qualificacao");
      assert.equal(result.data.customer.displayName, "Cliente sintetico");
      assert.equal(result.data.originLead?.name, "Lead sintetico");
      assert.equal(result.data.primaryConversation?.id, "66666666-6666-4666-8666-666666666666");
      assert.equal(result.data.primaryConversation?.leadId, "55555555-5555-4555-8555-555555555555");
      assert.equal(result.data.isHumanActive, true);
    },
  },
  {
    name: "oportunidade fora do contexto retorna not_found",
    run: async () => {
      const result = await resolveAuthorizedOpportunityDetailCore(
        "11111111-1111-4111-8111-111111111111",
        createBaseContext(),
        createDataAccess({ opportunity: null }),
      );

      assert.deepEqual(result, {
        ok: false,
        error: "not_found",
        message: "Oportunidade nao encontrada.",
      });
    },
  },
  {
    name: "cliente inconsistente retorna detalhe parcial sem dados pessoais",
    run: async () => {
      const result = await resolveAuthorizedOpportunityDetailCore(
        "11111111-1111-4111-8111-111111111111",
        createBaseContext(),
        createDataAccess({
          customerStoreLink: null,
        }),
      );

      assert.equal(result.ok, true);
      if (!result.ok) throw new Error("expected success");
      assert.deepEqual(result.data.problems, [
        "customer_scope_inconsistency",
        "primary_conversation_scope_inconsistency",
      ]);
      assert.equal(result.data.customer.displayName, null);
      assert.equal(result.data.originLead, null);
      assert.equal(result.data.displayName, null);
      assert.equal(result.data.phone, null);
      assert.equal(result.data.requiresAttention, true);
    },
  },
  {
    name: "lead e conversa ausentes geram warnings neutros",
    run: async () => {
      const result = await resolveAuthorizedOpportunityDetailCore(
        "11111111-1111-4111-8111-111111111111",
        createBaseContext(),
        createDataAccess({
          opportunity: createBaseOpportunity({
            origin_lead_id: null,
            primary_conversation_id: null,
          }),
        }),
      );

      assert.equal(result.ok, true);
      if (!result.ok) throw new Error("expected success");
      assert.equal(result.data.hasOriginLead, false);
      assert.equal(result.data.hasPrimaryConversation, false);
      assert.equal(result.data.originLead, null);
      assert.equal(result.data.primaryConversation, null);
      assert.equal(result.data.isHumanActive, null);
      assert.equal(result.data.warnings.includes("missing_origin_lead"), true);
      assert.equal(result.data.warnings.includes("missing_primary_conversation"), true);
      assert.deepEqual(result.data.problems, []);
      assert.equal(result.data.requiresAttention, false);
    },
  },
  {
    name: "lead ausente com conversa declarada recusa a conversa e exige atencao",
    run: async () => {
      let humanStateCalls = 0;

      const result = await resolveAuthorizedOpportunityDetailCore(
        "11111111-1111-4111-8111-111111111111",
        createBaseContext(),
        createDataAccess({
          opportunity: createBaseOpportunity({ origin_lead_id: null }),
          onCall: {
            loadConversationHumanStateById() {
              humanStateCalls += 1;
            },
          },
        }),
      );

      assert.equal(result.ok, true);
      if (!result.ok) throw new Error("expected success");
      assert.equal(result.data.hasOriginLead, false);
      assert.equal(result.data.hasPrimaryConversation, true);
      assert.equal(result.data.originLead, null);
      assert.equal(result.data.primaryConversation, null);
      assert.equal(result.data.isHumanActive, null);
      assert.equal(result.data.warnings.includes("missing_origin_lead"), true);
      assert.equal(
        result.data.problems.includes("primary_conversation_scope_inconsistency"),
        true,
      );
      assert.equal(result.data.requiresAttention, true);
      assert.equal(humanStateCalls, 0);
    },
  },
  {
    name: "conversa ausente gera warning neutro sem problem",
    run: async () => {
      const result = await resolveAuthorizedOpportunityDetailCore(
        "11111111-1111-4111-8111-111111111111",
        createBaseContext(),
        createDataAccess({
          opportunity: createBaseOpportunity({ primary_conversation_id: null }),
        }),
      );

      assert.equal(result.ok, true);
      if (!result.ok) throw new Error("expected success");
      assert.equal(result.data.hasPrimaryConversation, false);
      assert.equal(result.data.warnings.includes("missing_primary_conversation"), true);
      assert.deepEqual(result.data.problems, []);
      assert.equal(result.data.requiresAttention, false);
      assert.equal(result.data.primaryConversation, null);
      assert.equal(result.data.isHumanActive, null);
    },
  },
  {
    name: "conversa declarada sem identidade validada e recusada antes do estado humano",
    run: async () => {
      let humanStateCalls = 0;

      const result = await resolveAuthorizedOpportunityDetailCore(
        "11111111-1111-4111-8111-111111111111",
        createBaseContext(),
        createDataAccess({
          conversationIdentity: null,
          onCall: {
            loadConversationHumanStateById() {
              humanStateCalls += 1;
            },
          },
        }),
      );

      assertConversationRejectedWithoutProof(result, humanStateCalls);
    },
  },
  {
    name: "conversa vinculada a outro lead e recusada antes do estado humano",
    run: async () => {
      let humanStateCalls = 0;

      const result = await resolveAuthorizedOpportunityDetailCore(
        "11111111-1111-4111-8111-111111111111",
        createBaseContext(),
        createDataAccess({
          conversationIdentity: createBaseConversationIdentity({
            lead_id: "abababab-abab-4bab-8bab-abababababab",
          }),
          onCall: {
            loadConversationHumanStateById() {
              humanStateCalls += 1;
            },
          },
        }),
      );

      assertConversationRejectedWithoutProof(result, humanStateCalls);
    },
  },
  {
    name: "core recusa conversa quando session loader retorna null e nao consulta estado humano",
    run: async () => {
      let humanStateCalls = 0;

      const result = await resolveAuthorizedOpportunityDetailCore(
        "11111111-1111-4111-8111-111111111111",
        createBaseContext(),
        createDataAccess({
          conversationSession: null,
          onCall: {
            loadConversationHumanStateById() {
              humanStateCalls += 1;
            },
          },
        }),
      );

      assertConversationRejectedWithoutProof(result, humanStateCalls);
    },
  },
  {
    name: "core recusa conversa quando loaders canonicos retornam null para cenarios filtrados",
    run: async () => {
      const scenarios: Array<{
        name: string;
        overrides: FactoryOptions;
      }> = [
        {
          name: "session inexistente",
          overrides: { conversationSession: null },
        },
        {
          name: "session filtrada por status inativo",
          overrides: { conversationSession: null },
        },
        {
          name: "session de organizacao divergente",
          overrides: { conversationSession: null },
        },
        {
          name: "session de loja divergente",
          overrides: { conversationSession: null },
        },
        {
          name: "context link inexistente",
          overrides: { contextLink: null },
        },
        {
          name: "context link com status inativo",
          overrides: { contextLink: null },
        },
        {
          name: "context link com unlinked_at preenchido",
          overrides: { contextLink: null },
        },
        {
          name: "context link de outra oportunidade",
          overrides: { contextLink: null },
        },
        {
          name: "context link de organizacao divergente",
          overrides: { contextLink: null },
        },
        {
          name: "context link de loja divergente",
          overrides: { contextLink: null },
        },
        {
          name: "context link de cliente divergente",
          overrides: { contextLink: null },
        },
        {
          name: "lead-customer link inexistente",
          overrides: { leadCustomerLinkProof: null },
        },
        {
          name: "lead-customer link com status inativo",
          overrides: { leadCustomerLinkProof: null },
        },
        {
          name: "lead-customer link com unlinked_at preenchido",
          overrides: { leadCustomerLinkProof: null },
        },
        {
          name: "lead-customer link de organizacao divergente",
          overrides: { leadCustomerLinkProof: null },
        },
        {
          name: "lead-customer link de loja divergente",
          overrides: { leadCustomerLinkProof: null },
        },
        {
          name: "lead-customer link de cliente divergente",
          overrides: { leadCustomerLinkProof: null },
        },
        {
          name: "lead-customer link de lead divergente",
          overrides: { leadCustomerLinkProof: null },
        },
      ];

      for (const scenario of scenarios) {
        let humanStateCalls = 0;
        const result = await resolveAuthorizedOpportunityDetailCore(
          "11111111-1111-4111-8111-111111111111",
          createBaseContext(),
          createDataAccess({
            ...scenario.overrides,
            onCall: {
              loadConversationHumanStateById() {
                humanStateCalls += 1;
              },
            },
          }),
        );

        try {
          assertConversationRejectedWithoutProof(result, humanStateCalls);
        } catch (error) {
          throw new Error(
            `${scenario.name}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    },
  },
  {
    name: "isHumanActive so existe depois da prova canonica completa",
    run: async () => {
      const result = await resolveAuthorizedOpportunityDetailCore(
        "11111111-1111-4111-8111-111111111111",
        createBaseContext(),
        createDataAccess({
          conversationHumanState: createBaseConversationHumanState({
            is_human_active: false,
          }),
        }),
      );

      assert.equal(result.ok, true);
      if (!result.ok) throw new Error("expected success");
      assert.equal(result.data.primaryConversation?.isHumanActive, false);
      assert.equal(result.data.isHumanActive, false);
    },
  },
  {
    name: "estagio invalido nao usa fallback",
    run: async () => {
      const result = await resolveAuthorizedOpportunityDetailCore(
        "11111111-1111-4111-8111-111111111111",
        createBaseContext(),
        createDataAccess({
          opportunity: createBaseOpportunity({ stage: "etapa_inexistente" }),
        }),
      );

      assert.equal(result.ok, true);
      if (!result.ok) throw new Error("expected success");
      assert.equal(result.data.opportunity.stage, null);
      assert.equal(result.data.opportunity.stageStatus, "invalid");
      assert.deepEqual(result.data.problems, ["invalid_stage"]);
      assert.equal(result.data.requiresAttention, true);
    },
  },
  {
    name: "core preserva o cliente explicitamente vinculado a oportunidade",
    run: async () => {
      const result = await resolveAuthorizedOpportunityDetailCore(
        "11111111-1111-4111-8111-111111111111",
        createBaseContext(),
        createDataAccess({
          opportunity: createBaseOpportunity({
            customer_id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
          }),
          customer: createBaseCustomer({ id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd" }),
          customerStoreLink: createBaseCustomerStoreLink({
            customer_id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
          }),
          contextLink: createBaseContextLink({
            customer_id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
          }),
          leadCustomerLinkProof: createBaseLeadCustomerLinkProof({
            customer_id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
          }),
        }),
      );

      assert.equal(result.ok, true);
      if (!result.ok) throw new Error("expected success");
      assert.equal(result.data.customer.id, "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd");
    },
  },
  {
    name: "core preserva o lead explicitamente vinculado a oportunidade",
    run: async () => {
      const result = await resolveAuthorizedOpportunityDetailCore(
        "11111111-1111-4111-8111-111111111111",
        createBaseContext(),
        createDataAccess({
          opportunity: createBaseOpportunity({
            origin_lead_id: "efefefef-efef-4fef-8fef-efefefefefef",
          }),
          lead: createBaseLead({ id: "efefefef-efef-4fef-8fef-efefefefefef" }),
          conversationIdentity: createBaseConversationIdentity({
            lead_id: "efefefef-efef-4fef-8fef-efefefefefef",
          }),
          leadCustomerLinkProof: createBaseLeadCustomerLinkProof({
            lead_id: "efefefef-efef-4fef-8fef-efefefefefef",
          }),
        }),
      );

      assert.equal(result.ok, true);
      if (!result.ok) throw new Error("expected success");
      assert.equal(result.data.originLead?.id, "efefefef-efef-4fef-8fef-efefefefefef");
      assert.equal(
        result.data.primaryConversation?.leadId,
        "efefefef-efef-4fef-8fef-efefefefefef",
      );
    },
  },
  {
    name: "nenhuma busca usa recencia selecao substituta ou prova circular",
    run: () => {
      const publicSource = readFileSync(
        join(
          process.cwd(),
          "src/lib/server/crm/resolve-authorized-opportunity-detail.ts",
        ),
        "utf8",
      );
      const internalSource = readFileSync(
        join(
          process.cwd(),
          "src/lib/server/crm/resolve-authorized-opportunity-detail.internal.ts",
        ),
        "utf8",
      );
      const merged = `${publicSource}\n${internalSource}`;

      assert.equal(merged.includes('.order("created_at"'), false);
      assert.equal(merged.includes(".order('created_at'"), false);
      assert.equal(merged.includes(".limit(1)"), false);
      assert.equal(
        (internalSource.match(/from\("commercial_opportunities"\)/g) ?? []).length,
        1,
      );
      assert.equal(internalSource.includes("loadCanonicalOpportunityConversationProof"), false);
      assert.equal(/from\("commercial_opportunities"\)[\s\S]{0,240}\.eq\("lead_id"/.test(merged), false);
      assert.equal(/from\("commercial_opportunities"\)[\s\S]{0,240}\.eq\("customer_id"/.test(merged), false);
    },
  },
  {
    name: "runtime sanitiza falha tecnica sem vazar detalhes sensiveis",
    run: async () => {
      const sensitiveMessage =
        "synthetic failure: table=commercial_opportunities sql=select * payload={customer_id:'44444444-4444-4444-8444-444444444444'} secret-id=alpha-123";
      const result = await resolveAuthorizedOpportunityDetailWithDeps(
        "11111111-1111-4111-8111-111111111111",
        {
          async resolveStoreAccess() {
            return { ok: true, context: createBaseContext() };
          },
          createDataAccess() {
            return createDataAccess({
              thrown: {
                loadConversationIdentityById: new Error(sensitiveMessage),
              },
            });
          },
        },
      );

      assert.deepEqual(result, {
        ok: false,
        error: "technical_error",
        message: "Nao foi possivel carregar o detalhe da oportunidade.",
      });
      assert.equal(result.message.includes("synthetic failure"), false);
      assert.equal(result.message.includes("commercial_opportunities"), false);
      assert.equal(result.message.toLowerCase().includes("sql"), false);
      assert.equal(result.message.includes("payload"), false);
      assert.equal(result.message.includes("44444444-4444-4444-8444-444444444444"), false);
    },
  },
  {
    name: "requiresAttention ignora warnings e considera problems",
    run: async () => {
      const onlyWarnings = await resolveAuthorizedOpportunityDetailCore(
        "11111111-1111-4111-8111-111111111111",
        createBaseContext(),
        createDataAccess({
          opportunity: createBaseOpportunity({
            origin_lead_id: null,
            primary_conversation_id: null,
          }),
          customer: createBaseCustomer({ display_name: null }),
        }),
      );

      assert.equal(onlyWarnings.ok, true);
      if (!onlyWarnings.ok) throw new Error("expected success");
      assert.equal(onlyWarnings.data.requiresAttention, false);

      const withProblem = await resolveAuthorizedOpportunityDetailCore(
        "11111111-1111-4111-8111-111111111111",
        createBaseContext(),
        createDataAccess({
          customerStoreLink: null,
        }),
      );

      assert.equal(withProblem.ok, true);
      if (!withProblem.ok) throw new Error("expected success");
      assert.equal(withProblem.data.requiresAttention, true);
    },
  },
  {
    name: "loadOpportunityById usa filtros reais por id organizacao e loja",
    run: async () => {
      const harness = createRecordingHarness([
        createExpectedQueryHandler(
          "commercial_opportunities",
          [
            { kind: "eq", column: "id", value: "11111111-1111-4111-8111-111111111111" },
            {
              kind: "eq",
              column: "organization_id",
              value: "22222222-2222-4222-8222-222222222222",
            },
            { kind: "eq", column: "store_id", value: "33333333-3333-4333-8333-333333333333" },
          ],
          { data: createBaseOpportunity() },
        ),
      ]);
      const dataAccess = createProductionDataAccess(harness.client);

      await dataAccess.loadOpportunityById(
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
      );

      harness.assertAllHandlersConsumed();
      const query = findQuery(harness.queries, "commercial_opportunities");
      assert.equal(query.operation, "select");
      assert.equal(query.maybeSingleCalls, 1);
      assertFilterCount(query, 3);
      assertHasEq(query, "id", "11111111-1111-4111-8111-111111111111");
      assertHasEq(query, "organization_id", "22222222-2222-4222-8222-222222222222");
      assertHasEq(query, "store_id", "33333333-3333-4333-8333-333333333333");
      assertNoFilter(query, "customer_id");
      assertNoFilter(query, "lead_id");
    },
  },
  {
    name: "loader produtivo de conversation_sessions envia filtros canonicos completos",
    run: async () => {
      const harness = createRecordingHarness([
        createExpectedQueryHandler(
          "conversation_sessions",
          [
            {
              kind: "eq",
              column: "conversation_id",
              value: "66666666-6666-4666-8666-666666666666",
            },
            {
              kind: "eq",
              column: "organization_id",
              value: "22222222-2222-4222-8222-222222222222",
            },
            { kind: "eq", column: "store_id", value: "33333333-3333-4333-8333-333333333333" },
            { kind: "eq", column: "status", value: "active" },
          ],
          { data: createBaseConversationSession() },
        ),
      ]);
      const dataAccess = createProductionDataAccess(harness.client);

      await dataAccess.loadActiveConversationSessionByConversationId(
        "66666666-6666-4666-8666-666666666666",
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
      );

      harness.assertAllHandlersConsumed();
      const query = findQuery(harness.queries, "conversation_sessions");
      assertFilterCount(query, 4);
      assertHasEq(query, "conversation_id", "66666666-6666-4666-8666-666666666666");
      assertHasEq(query, "organization_id", "22222222-2222-4222-8222-222222222222");
      assertHasEq(query, "store_id", "33333333-3333-4333-8333-333333333333");
      assertHasEq(query, "status", "active");
    },
  },
  {
    name: "loader produtivo de commercial_session_context_links envia filtros canonicos completos",
    run: async () => {
      const harness = createRecordingHarness([
        createExpectedQueryHandler(
          "commercial_session_context_links",
          [
            {
              kind: "eq",
              column: "conversation_session_id",
              value: "88888888-8888-4888-8888-888888888888",
            },
            {
              kind: "eq",
              column: "commercial_opportunity_id",
              value: "11111111-1111-4111-8111-111111111111",
            },
            {
              kind: "eq",
              column: "organization_id",
              value: "22222222-2222-4222-8222-222222222222",
            },
            { kind: "eq", column: "store_id", value: "33333333-3333-4333-8333-333333333333" },
            {
              kind: "eq",
              column: "customer_id",
              value: "44444444-4444-4444-8444-444444444444",
            },
            { kind: "eq", column: "status", value: "active" },
            { kind: "is", column: "unlinked_at", value: null },
          ],
          { data: createBaseContextLink() },
        ),
      ]);
      const dataAccess = createProductionDataAccess(harness.client);

      await dataAccess.loadActiveContextLinkBySession(
        "88888888-8888-4888-8888-888888888888",
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
        "44444444-4444-4444-8444-444444444444",
      );

      harness.assertAllHandlersConsumed();
      const query = findQuery(harness.queries, "commercial_session_context_links");
      assertFilterCount(query, 7);
      assertHasEq(query, "conversation_session_id", "88888888-8888-4888-8888-888888888888");
      assertHasEq(query, "commercial_opportunity_id", "11111111-1111-4111-8111-111111111111");
      assertHasEq(query, "organization_id", "22222222-2222-4222-8222-222222222222");
      assertHasEq(query, "store_id", "33333333-3333-4333-8333-333333333333");
      assertHasEq(query, "customer_id", "44444444-4444-4444-8444-444444444444");
      assertHasEq(query, "status", "active");
      assertHasIsNull(query, "unlinked_at");
    },
  },
  {
    name: "loader produtivo de lead_customer_links envia filtros canonicos completos",
    run: async () => {
      const harness = createRecordingHarness([
        createExpectedQueryHandler(
          "lead_customer_links",
          [
            {
              kind: "eq",
              column: "id",
              value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            },
            {
              kind: "eq",
              column: "organization_id",
              value: "22222222-2222-4222-8222-222222222222",
            },
            { kind: "eq", column: "store_id", value: "33333333-3333-4333-8333-333333333333" },
            {
              kind: "eq",
              column: "customer_id",
              value: "44444444-4444-4444-8444-444444444444",
            },
            {
              kind: "eq",
              column: "lead_id",
              value: "55555555-5555-4555-8555-555555555555",
            },
            { kind: "eq", column: "status", value: "active" },
            { kind: "is", column: "unlinked_at", value: null },
          ],
          { data: createBaseLeadCustomerLinkProof() },
        ),
      ]);
      const dataAccess = createProductionDataAccess(harness.client);

      await dataAccess.loadActiveLeadCustomerLinkProof(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
        "44444444-4444-4444-8444-444444444444",
        "55555555-5555-4555-8555-555555555555",
      );

      harness.assertAllHandlersConsumed();
      const query = findQuery(harness.queries, "lead_customer_links");
      assertFilterCount(query, 7);
      assertHasEq(query, "id", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      assertHasEq(query, "organization_id", "22222222-2222-4222-8222-222222222222");
      assertHasEq(query, "store_id", "33333333-3333-4333-8333-333333333333");
      assertHasEq(query, "customer_id", "44444444-4444-4444-8444-444444444444");
      assertHasEq(query, "lead_id", "55555555-5555-4555-8555-555555555555");
      assertHasEq(query, "status", "active");
      assertHasIsNull(query, "unlinked_at");
    },
  },
  {
    name: "prova explicita valida filtros canonicos da conversa e aceita o vinculo",
    run: async () => {
      const harness = createRecordingHarness([
        createExpectedQueryHandler(
          "commercial_opportunities",
          [
            { kind: "eq", column: "id", value: "11111111-1111-4111-8111-111111111111" },
            {
              kind: "eq",
              column: "organization_id",
              value: "22222222-2222-4222-8222-222222222222",
            },
            { kind: "eq", column: "store_id", value: "33333333-3333-4333-8333-333333333333" },
          ],
          { data: createBaseOpportunity() },
        ),
        {
          table: "customers",
          response: { data: createBaseCustomer() },
        },
        {
          table: "customer_store_links",
          response: { data: createBaseCustomerStoreLink() },
        },
        {
          table: "leads",
          response: { data: createBaseLead() },
        },
        {
          table: "conversations",
          response: { data: createBaseConversationIdentity() },
          match(query) {
            return query.selection.includes("lead_id");
          },
        },
        createExpectedQueryHandler(
          "conversation_sessions",
          [
            {
              kind: "eq",
              column: "conversation_id",
              value: "66666666-6666-4666-8666-666666666666",
            },
            {
              kind: "eq",
              column: "organization_id",
              value: "22222222-2222-4222-8222-222222222222",
            },
            { kind: "eq", column: "store_id", value: "33333333-3333-4333-8333-333333333333" },
            { kind: "eq", column: "status", value: "active" },
          ],
          { data: createBaseConversationSession() },
        ),
        createExpectedQueryHandler(
          "commercial_session_context_links",
          [
            {
              kind: "eq",
              column: "conversation_session_id",
              value: "88888888-8888-4888-8888-888888888888",
            },
            {
              kind: "eq",
              column: "commercial_opportunity_id",
              value: "11111111-1111-4111-8111-111111111111",
            },
            {
              kind: "eq",
              column: "organization_id",
              value: "22222222-2222-4222-8222-222222222222",
            },
            { kind: "eq", column: "store_id", value: "33333333-3333-4333-8333-333333333333" },
            {
              kind: "eq",
              column: "customer_id",
              value: "44444444-4444-4444-8444-444444444444",
            },
            { kind: "eq", column: "status", value: "active" },
            { kind: "is", column: "unlinked_at", value: null },
          ],
          { data: createBaseContextLink() },
        ),
        createExpectedQueryHandler(
          "lead_customer_links",
          [
            {
              kind: "eq",
              column: "id",
              value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            },
            {
              kind: "eq",
              column: "organization_id",
              value: "22222222-2222-4222-8222-222222222222",
            },
            { kind: "eq", column: "store_id", value: "33333333-3333-4333-8333-333333333333" },
            {
              kind: "eq",
              column: "customer_id",
              value: "44444444-4444-4444-8444-444444444444",
            },
            {
              kind: "eq",
              column: "lead_id",
              value: "55555555-5555-4555-8555-555555555555",
            },
            { kind: "eq", column: "status", value: "active" },
            { kind: "is", column: "unlinked_at", value: null },
          ],
          { data: createBaseLeadCustomerLinkProof() },
        ),
        {
          table: "conversations",
          response: { data: createBaseConversationHumanState() },
          match(query) {
            return query.selection.includes("is_human_active");
          },
        },
      ]);
      const dataAccess = createProductionDataAccess(harness.client);

      const result = await resolveAuthorizedOpportunityDetailCore(
        "11111111-1111-4111-8111-111111111111",
        createBaseContext(),
        dataAccess,
      );

      assert.equal(result.ok, true);
      if (!result.ok) throw new Error("expected success");
      harness.assertAllHandlersConsumed();

      const opportunityQuery = findQuery(harness.queries, "commercial_opportunities");
      assertFilterCount(opportunityQuery, 3);
      assertHasEq(opportunityQuery, "id", "11111111-1111-4111-8111-111111111111");

      const sessionQuery = findQuery(harness.queries, "conversation_sessions");
      assertFilterCount(sessionQuery, 4);
      assertHasEq(sessionQuery, "conversation_id", "66666666-6666-4666-8666-666666666666");
      assertHasEq(sessionQuery, "organization_id", "22222222-2222-4222-8222-222222222222");
      assertHasEq(sessionQuery, "store_id", "33333333-3333-4333-8333-333333333333");
      assertHasEq(sessionQuery, "status", "active");

      const contextQuery = findQuery(harness.queries, "commercial_session_context_links");
      assertFilterCount(contextQuery, 7);
      assertHasEq(contextQuery, "conversation_session_id", "88888888-8888-4888-8888-888888888888");
      assertHasEq(contextQuery, "commercial_opportunity_id", "11111111-1111-4111-8111-111111111111");
      assertHasEq(contextQuery, "organization_id", "22222222-2222-4222-8222-222222222222");
      assertHasEq(contextQuery, "store_id", "33333333-3333-4333-8333-333333333333");
      assertHasEq(contextQuery, "customer_id", "44444444-4444-4444-8444-444444444444");
      assertHasEq(contextQuery, "status", "active");
      assertHasIsNull(contextQuery, "unlinked_at");

      const leadCustomerQuery = findQuery(harness.queries, "lead_customer_links");
      assertFilterCount(leadCustomerQuery, 7);
      assertHasEq(leadCustomerQuery, "id", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      assertHasEq(leadCustomerQuery, "lead_id", "55555555-5555-4555-8555-555555555555");
      assertHasEq(leadCustomerQuery, "customer_id", "44444444-4444-4444-8444-444444444444");
      assertHasEq(
        leadCustomerQuery,
        "organization_id",
        "22222222-2222-4222-8222-222222222222",
      );
      assertHasEq(leadCustomerQuery, "store_id", "33333333-3333-4333-8333-333333333333");
      assertHasEq(leadCustomerQuery, "status", "active");
      assertHasIsNull(leadCustomerQuery, "unlinked_at");

      const conversationIdentityQuery = findQuery(harness.queries, "conversations", 0);
      const conversationHumanStateQuery = findQuery(harness.queries, "conversations", 1);
      assert.equal(conversationIdentityQuery.selection.includes("lead_id"), true);
      assert.equal(conversationHumanStateQuery.selection.includes("is_human_active"), true);
      assert.equal(result.data.primaryConversation?.id, "66666666-6666-4666-8666-666666666666");
      assert.equal(result.data.isHumanActive, true);
    },
  },
];

async function main() {
  let passed = 0;

  for (const test of tests) {
    await test.run();
    passed += 1;
  }

  console.log(
    `resolve-authorized-opportunity-detail: ${passed}/${tests.length} tests completed in direct execution`,
  );
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
