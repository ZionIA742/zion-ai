import { strict as assert } from "node:assert";
import Module from "node:module";
import { join } from "node:path";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

type InsertCall = {
  table: string;
  payload: Record<string, unknown>;
};
type RpcCall = {
  fn: string;
  args: Record<string, unknown>;
};
type QuoteRowFixture = Record<string, unknown>;
type QuoteItemFixture = Record<string, unknown>;
type SupabaseRecorderOptions = {
  quoteRows?: QuoteRowFixture[];
  quoteItemRows?: QuoteItemFixture[];
  firstLookupMisses?: number;
  salesQuoteInsertError?: { code?: string | null; message?: string | null } | null;
  salesQuoteItemsInsertError?: { code?: string | null; message?: string | null } | null;
  rpcResults?:
    | Array<{ data: unknown; error: { message?: string | null } | null }>
    | undefined;
};

function createNumberReservation() {
  return {
    quoteNumber: "ORC-001",
    reservedNumber: 1,
    settings: {
      quotePdfEnabled: true,
      aiCanGenerateQuote: true,
      aiCanSendQuoteToCustomer: true,
      requiresHumanApprovalBeforeSend: false,
      quoteNumberPrefix: "ORC",
      nextQuoteNumber: 2,
    },
  };
}

const projectSrcPath = join(process.cwd(), "src");
type ResolveFilenameHook = (
  request: string,
  parent: unknown,
  isMain: boolean,
  options: unknown,
) => string;
type ModuleWithResolveFilename = typeof Module & {
  _resolveFilename: ResolveFilenameHook;
};
const moduleWithResolveFilename = Module as ModuleWithResolveFilename;
const originalResolveFilename = moduleWithResolveFilename._resolveFilename;

moduleWithResolveFilename._resolveFilename = function resolveFilenamePatched(
  request: string,
  parent: unknown,
  isMain: boolean,
  options: unknown,
) {
  if (request.startsWith("@/")) {
    const nextRequest = join(projectSrcPath, request.slice(2));
    return originalResolveFilename.call(this, nextRequest, parent, isMain, options);
  }

  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const routeModulePromise = import("./route");

async function loadRouteModule() {
  return routeModulePromise;
}

function createRequest(body: unknown) {
  return new Request("https://example.test/api/sales-quotes/create", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function createScope(args?: {
  organizationId?: string;
  storeId?: string;
  leadId?: string | null;
  conversationId?: string | null;
  supabase?: ReturnType<typeof createSupabaseRecorder>;
}) {
  const supabase = args?.supabase ?? createSupabaseRecorder();

  return {
    user: { id: "user-1" },
    supabase,
    organizationIds: ["access-org"],
    organizationId: args?.organizationId ?? "access-org",
    store: {
      id: args?.storeId ?? "access-store",
      organization_id: args?.organizationId ?? "access-org",
      name: "Store 1",
    },
    conversation: args?.conversationId
      ? {
          id: args.conversationId,
          organization_id: args?.organizationId ?? "access-org",
          lead_id: args?.leadId ?? "lead-a",
          status: "open",
          is_human_active: false,
        }
      : null,
    lead: args?.leadId
      ? {
          id: args.leadId,
          organization_id: args?.organizationId ?? "access-org",
          store_id: args?.storeId ?? "access-store",
          name: "Lead A",
          phone: "+5511999999999",
        }
      : null,
  };
}

function createSupabaseRecorder(options?: SupabaseRecorderOptions) {
  const insertCalls: InsertCall[] = [];
  const rpcCalls: RpcCall[] = [];
  const deletedQuoteIds: string[] = [];
  const quoteRows = [...(options?.quoteRows ?? [])];
  const quoteItemRows = [...(options?.quoteItemRows ?? [])];
  let remainingFirstLookupMisses = options?.firstLookupMisses ?? 0;
  const rpcResults = [...(options?.rpcResults ?? [])];

  function matchesFilters(
    row: Record<string, unknown>,
    filters: Array<{ column: string; value: unknown }>
  ) {
    return filters.every((filter) => row[filter.column] === filter.value);
  }

  function createQueryBuilder(table: string) {
    const filters: Array<{ column: string; value: unknown }> = [];
    let orderColumn: string | null = null;

    return {
      eq(column: string, value: unknown) {
        filters.push({ column, value });
        return this;
      },
      order(column: string) {
        orderColumn = column;
        return this;
      },
      async maybeSingle() {
        if (table === "sales_quotes") {
          const hasIdempotencyFilter = filters.some(
            (filter) => filter.column === "creation_idempotency_key"
          );

          if (hasIdempotencyFilter && remainingFirstLookupMisses > 0) {
            remainingFirstLookupMisses -= 1;
            return {
              data: null,
              error: null,
            };
          }

          const row =
            quoteRows.find((candidate) => matchesFilters(candidate, filters)) ?? null;

          return {
            data: row,
            error: null,
          };
        }

        return {
          data: null,
          error: null,
        };
      },
      then(
        onFulfilled?: ((value: { data: QuoteItemFixture[] | null; error: null }) => unknown) | null,
        onRejected?: ((reason: unknown) => unknown) | null,
      ) {
        const run = async () => {
          if (table === "sales_quote_items") {
            const rows = quoteItemRows.filter((candidate) =>
              matchesFilters(candidate, filters)
            );

            if (orderColumn === "sort_order") {
              rows.sort(
                (left, right) =>
                  Number(left.sort_order || 0) - Number(right.sort_order || 0)
              );
            }

            return {
              data: rows,
              error: null,
            };
          }

          return {
            data: null,
            error: null,
          };
        };

        return run().then(onFulfilled ?? undefined, onRejected ?? undefined);
      },
    };
  }

  return {
    insertCalls,
    rpcCalls,
    deletedQuoteIds,
    quoteRows,
    quoteItemRows,
    from(table: string) {
      return {
        insert(payload: Record<string, unknown> | Record<string, unknown>[]) {
          if (table === "sales_quotes") {
            const firstPayload = Array.isArray(payload) ? payload[0] : payload;
            insertCalls.push({
              table,
              payload: firstPayload ?? {},
            });

            return {
              select() {
                return {
                  async maybeSingle() {
                    if (options?.salesQuoteInsertError) {
                      const existingQuote = quoteRows.find((candidate) =>
                        matchesFilters(candidate, [
                          {
                            column: "organization_id",
                            value: firstPayload.organization_id,
                          },
                          {
                            column: "store_id",
                            value: firstPayload.store_id,
                          },
                          {
                            column: "creation_idempotency_key",
                            value: firstPayload.creation_idempotency_key,
                          },
                        ])
                      );

                      if (
                        existingQuote &&
                        (existingQuote.creation_request_fingerprint == null ||
                          existingQuote.creation_request_fingerprint === "")
                      ) {
                        existingQuote.creation_request_fingerprint =
                          firstPayload.creation_request_fingerprint;
                      }

                      return {
                        data: null,
                        error: options.salesQuoteInsertError,
                      };
                    }

                    const row = {
                      id: "quote-1",
                      organization_id: firstPayload.organization_id,
                      store_id: firstPayload.store_id,
                      commercial_opportunity_id: firstPayload.commercial_opportunity_id,
                      creation_idempotency_key:
                        firstPayload.creation_idempotency_key,
                      creation_request_fingerprint:
                        firstPayload.creation_request_fingerprint,
                      conversation_id: firstPayload.conversation_id,
                      lead_id: firstPayload.lead_id,
                      quote_number: "ORC-001",
                      title: firstPayload.title,
                      status: "draft",
                      customer_name: firstPayload.customer_name,
                      customer_phone: firstPayload.customer_phone,
                      customer_notes: firstPayload.customer_notes,
                      internal_notes: firstPayload.internal_notes,
                      warranty_terms: firstPayload.warranty_terms,
                      valid_until: firstPayload.valid_until,
                      subtotal_cents: firstPayload.subtotal_cents,
                      discount_cents: firstPayload.discount_cents,
                      total_cents: firstPayload.total_cents,
                      current_version_id: null,
                      metadata: firstPayload.metadata,
                      created_at: null,
                      updated_at: null,
                    };

                    quoteRows.push(row);

                    return {
                      data: row,
                      error: null,
                    };
                  },
                };
              },
            };
          }

          if (table === "sales_quote_items") {
            const rows = Array.isArray(payload) ? payload : [payload];

            if (options?.salesQuoteItemsInsertError) {
              return Promise.resolve({
                data: null,
                error: options.salesQuoteItemsInsertError,
              });
            }

            for (const row of rows) {
              insertCalls.push({
                table,
                payload: row,
              });
              quoteItemRows.push(row);
            }

            return Promise.resolve({
              data: null,
              error: null,
            });
          }

          const firstPayload = Array.isArray(payload) ? payload[0] : payload;
          insertCalls.push({
            table,
            payload: firstPayload ?? {},
          });

          return {
            select() {
              return {
                async maybeSingle() {
                  if (table === "sales_quotes") {
                    return {
                      data: {
                        id: "quote-1",
                        quote_number: "ORC-001",
                        status: "draft",
                      },
                      error: null,
                    };
                  }

                  return {
                    data: null,
                    error: null,
                  };
                },
              };
            },
            async then() {
              return {
                data: null,
                error: null,
              };
            },
          };
        },
        delete() {
          return {
            eq: (_column: string, value: unknown) => {
              deletedQuoteIds.push(String(value || ""));
              return Promise.resolve({ error: null });
            },
          };
        },
        select() {
          return createQueryBuilder(table);
        },
        eq(column: string, value: unknown) {
          return createQueryBuilder(table).eq(column, value);
        },
      };
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });

      return (
        rpcResults.shift() ?? {
          data: [
            {
              commercial_opportunity_id: String(args.p_commercial_opportunity_id || ""),
              sales_quote_id: String(args.p_sales_quote_id || ""),
              stage: "orcamento",
              lifecycle_cycle: 1,
              lifecycle_event_id: "event-1",
              event_type: "stage_transition",
              reason_code: "explicit_quote_intent_required",
              stage_changed: true,
              outcome: "advanced_to_orcamento",
              stage_changed_at: "2026-08-13T12:00:00.000Z",
              updated_at: "2026-08-13T12:00:00.000Z",
            },
          ],
          error: null,
        }
      );
    },
  };
}

async function parseBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

const tests: TestCase[] = [
  {
    name: "commercialOpportunityId ausente rejeita e nao cria sales_quotes",
    run: async () => {
      const { createCreateQuotePostHandler } = await loadRouteModule();
      const supabase = createSupabaseRecorder();
      const scope = createScope({
        leadId: "lead-a",
        conversationId: "conversation-a",
        supabase,
      });

      const response = await createCreateQuotePostHandler({
        resolveQuoteScope: async () => scope as never,
        reserveQuoteNumber: async () => createNumberReservation(),
        resolveOpportunityDetail: async () => {
          throw new Error("must not resolve opportunity when id is missing");
        },
      })(
        createRequest({
          organizationId: "body-org",
          storeId: "body-store",
          creationIdempotencyKey: "quote_create:key-1",
          leadId: "lead-a",
          conversationId: "conversation-a",
          items: [{ item_type: "custom", name: "Piscina", quantity: 1, unit_price_cents: 1000 }],
        })
      );

      const body = await parseBody(response);
      assert.equal(response.status, 400);
      assert.equal(body.ok, false);
      assert.equal(body.error, "MISSING_COMMERCIAL_OPPORTUNITY_ID");
      assert.equal(supabase.insertCalls.length, 0);
    },
  },
  {
    name: "commercialOpportunityId valido persiste o valor exato no insert da quote",
    run: async () => {
      const { createCreateQuotePostHandler } = await loadRouteModule();
      const supabase = createSupabaseRecorder();
      const scope = createScope({
        leadId: "lead-a",
        conversationId: "conversation-a",
        supabase,
      });

      const response = await createCreateQuotePostHandler({
        resolveQuoteScope: async () => scope as never,
        reserveQuoteNumber: async () => createNumberReservation(),
        resolveOpportunityDetail: async () => ({
          ok: true,
          data: {
            opportunity: {
              id: "opportunity-a",
              organizationId: "access-org",
              storeId: "access-store",
              customerId: "customer-1",
              stage: "qualificacao",
              stageStatus: "valid",
              stageChangedAt: null,
              createdAt: null,
              updatedAt: null,
            },
            customer: {
              id: "customer-1",
              displayName: "Cliente 1",
            },
            originLead: {
              id: "lead-a",
              name: "Lead A",
              phone: "+5511999999999",
            },
            primaryConversation: {
              id: "conversation-a",
              leadId: "lead-a",
              isHumanActive: false,
            },
            hasOriginLead: true,
            hasPrimaryConversation: true,
            isHumanActive: false,
            displayName: "Cliente 1",
            phone: "+5511999999999",
            warnings: [],
            problems: [],
            requiresAttention: false,
          },
        }),
      })(
        createRequest({
          organizationId: "body-org",
          storeId: "body-store",
          creationIdempotencyKey: "quote_create:key-1",
          leadId: "lead-a",
          conversationId: "conversation-a",
          commercialOpportunityId: "opportunity-a",
          title: "Orcamento A",
          items: [{ item_type: "custom", name: "Piscina", quantity: 1, unit_price_cents: 1000 }],
        })
      );

      const body = await parseBody(response);
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(supabase.insertCalls.length >= 1, true);
      assert.deepEqual(supabase.insertCalls[0], {
        table: "sales_quotes",
        payload: {
          organization_id: "access-org",
          store_id: "access-store",
          commercial_opportunity_id: "opportunity-a",
          creation_idempotency_key: "quote_create:key-1",
          creation_request_fingerprint:
            supabase.insertCalls[0]?.payload.creation_request_fingerprint,
          conversation_id: "conversation-a",
          lead_id: "lead-a",
          quote_number: "ORC-001",
          title: "Orcamento A",
          status: "draft",
          customer_name: "Lead A",
          customer_phone: "+5511999999999",
          customer_notes: null,
          internal_notes: null,
          warranty_terms: null,
          valid_until: null,
          subtotal_cents: 1000,
          discount_cents: 0,
          total_cents: 1000,
          current_version_id: null,
          metadata: supabase.insertCalls[0]?.payload.metadata,
        },
      });
      assert.equal(supabase.rpcCalls.length, 1);
      assert.deepEqual(supabase.rpcCalls[0], {
        fn: "advance_commercial_opportunity_to_quote_stage_by_system",
        args: {
          p_organization_id: "access-org",
          p_store_id: "access-store",
          p_commercial_opportunity_id: "opportunity-a",
          p_sales_quote_id: "quote-1",
          p_idempotency_key:
            "sales_quote_created_stage_projection:quote-1:opportunity-a",
          p_reason_details: "sales quote created",
          p_source: "sales_quote_create_route",
        },
      });
    },
  },
  {
    name: "validity_days valido converte para valid_until date-only em UTC",
    run: async () => {
      const { createCreateQuotePostHandler } = await loadRouteModule();
      const supabase = createSupabaseRecorder();
      const scope = createScope({
        leadId: "lead-a",
        conversationId: "conversation-a",
        supabase,
      });

      const response = await createCreateQuotePostHandler({
        resolveQuoteScope: async () => scope as never,
        reserveQuoteNumber: async () => createNumberReservation(),
        getNow: () => new Date("2026-08-13T15:45:00.000Z"),
        resolveOpportunityDetail: async () => ({
          ok: true,
          data: {
            opportunity: {
              id: "opportunity-a",
              organizationId: "access-org",
              storeId: "access-store",
              customerId: "customer-1",
              stage: "qualificacao",
              stageStatus: "valid",
              stageChangedAt: null,
              createdAt: null,
              updatedAt: null,
            },
            customer: { id: "customer-1", displayName: "Cliente 1" },
            originLead: {
              id: "lead-a",
              name: "Lead A",
              phone: "+5511999999999",
            },
            primaryConversation: {
              id: "conversation-a",
              leadId: "lead-a",
              isHumanActive: false,
            },
            hasOriginLead: true,
            hasPrimaryConversation: true,
            isHumanActive: false,
            displayName: "Cliente 1",
            phone: "+5511999999999",
            warnings: [],
            problems: [],
            requiresAttention: false,
          },
        }),
      })(
        createRequest({
          storeId: "body-store",
          creationIdempotencyKey: "quote_create:validity-days",
          leadId: "lead-a",
          conversationId: "conversation-a",
          commercialOpportunityId: "opportunity-a",
          title: "Orcamento A",
          warranty_terms: "Garantia padrao",
          validity_days: "7",
          items: [{ item_type: "custom", name: "Piscina", quantity: 1, unit_price_cents: 1000 }],
        })
      );

      const body = await parseBody(response);
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(supabase.insertCalls.length >= 1, true);
      assert.equal(supabase.insertCalls[0]?.payload.valid_until, "2026-08-20");
      assert.notEqual(supabase.insertCalls[0]?.payload.valid_until, "7");
      assert.equal(supabase.insertCalls[0]?.payload.warranty_terms, "Garantia padrao");
      assert.deepEqual(supabase.insertCalls[0]?.payload.metadata, {
        commercial_opportunity_id: "opportunity-a",
        warranty_terms: "Garantia padrao",
        validity_days: "7",
        valid_until: "2026-08-20",
        item_count: 1,
      });
    },
  },
  {
    name: "validity_days invalido falha fechado antes do insert",
    run: async () => {
      const { createCreateQuotePostHandler } = await loadRouteModule();

      for (const invalidValue of ["-1", "7.5", "sete"]) {
        const supabase = createSupabaseRecorder();
        const scope = createScope({
          leadId: "lead-a",
          conversationId: "conversation-a",
          supabase,
        });

        const response = await createCreateQuotePostHandler({
          resolveQuoteScope: async () => scope as never,
          reserveQuoteNumber: async () => {
            throw new Error("must not reserve when validity_days is invalid");
          },
          resolveOpportunityDetail: async () => {
            throw new Error("must not resolve opportunity when validity_days is invalid");
          },
        })(
          createRequest({
            storeId: "body-store",
            creationIdempotencyKey: "quote_create:invalid-validity",
            leadId: "lead-a",
            conversationId: "conversation-a",
            commercialOpportunityId: "opportunity-a",
            title: "Orcamento A",
            validity_days: invalidValue,
            items: [{ item_type: "custom", name: "Piscina", quantity: 1, unit_price_cents: 1000 }],
          })
        );

        const body = await parseBody(response);
        assert.equal(response.status, 400);
        assert.equal(body.ok, false);
        assert.equal(body.error, "INVALID_VALIDITY_DAYS");
        assert.equal(supabase.insertCalls.length, 0);
      }
    },
  },
  {
    name: "opportunity inexistente rejeita sem inserir quote",
    run: async () => {
      const { createCreateQuotePostHandler } = await loadRouteModule();
      const supabase = createSupabaseRecorder();
      const scope = createScope({
        leadId: "lead-a",
        conversationId: "conversation-a",
        supabase,
      });

      const response = await createCreateQuotePostHandler({
        resolveQuoteScope: async () => scope as never,
        reserveQuoteNumber: async () => {
          throw new Error("must not reserve when opportunity is invalid");
        },
        resolveOpportunityDetail: async () => ({
          ok: false,
          error: "not_found",
          message: "Oportunidade nao encontrada.",
        }),
      })(
        createRequest({
          storeId: "body-store",
          creationIdempotencyKey: "quote_create:key-1",
          leadId: "lead-a",
          conversationId: "conversation-a",
          commercialOpportunityId: "opportunity-missing",
          items: [{ item_type: "custom", name: "Piscina", quantity: 1, unit_price_cents: 1000 }],
        })
      );

      const body = await parseBody(response);
      assert.equal(response.status, 404);
      assert.equal(body.error, "COMMERCIAL_OPPORTUNITY_NOT_FOUND");
      assert.equal(supabase.insertCalls.length, 0);
    },
  },
  {
    name: "opportunity de outro tenant rejeita sem inserir quote",
    run: async () => {
      const { createCreateQuotePostHandler } = await loadRouteModule();
      const supabase = createSupabaseRecorder();
      const scope = createScope({
        leadId: "lead-a",
        conversationId: "conversation-a",
        supabase,
      });

      const response = await createCreateQuotePostHandler({
        resolveQuoteScope: async () => scope as never,
        reserveQuoteNumber: async () => {
          throw new Error("must not reserve when tenant is mismatched");
        },
        resolveOpportunityDetail: async () => ({
          ok: true,
          data: {
            opportunity: {
              id: "opportunity-x",
              organizationId: "other-org",
              storeId: "other-store",
              customerId: "customer-1",
              stage: "qualificacao",
              stageStatus: "valid",
              stageChangedAt: null,
              createdAt: null,
              updatedAt: null,
            },
            customer: { id: "customer-1", displayName: "Cliente 1" },
            originLead: {
              id: "lead-a",
              name: "Lead A",
              phone: "+5511999999999",
            },
            primaryConversation: {
              id: "conversation-a",
              leadId: "lead-a",
              isHumanActive: false,
            },
            hasOriginLead: true,
            hasPrimaryConversation: true,
            isHumanActive: false,
            displayName: "Cliente 1",
            phone: "+5511999999999",
            warnings: [],
            problems: [],
            requiresAttention: false,
          },
        }),
      })(
        createRequest({
          organizationId: "body-org",
          storeId: "body-store",
          creationIdempotencyKey: "quote_create:key-1",
          leadId: "lead-a",
          conversationId: "conversation-a",
          commercialOpportunityId: "opportunity-x",
          items: [{ item_type: "custom", name: "Piscina", quantity: 1, unit_price_cents: 1000 }],
        })
      );

      const body = await parseBody(response);
      assert.equal(response.status, 403);
      assert.equal(body.error, "COMMERCIAL_OPPORTUNITY_ORGANIZATION_MISMATCH");
      assert.equal(supabase.insertCalls.length, 0);
    },
  },
  {
    name: "opportunity do lead B para quote do lead A rejeita sem inserir quote",
    run: async () => {
      const { createCreateQuotePostHandler } = await loadRouteModule();
      const supabase = createSupabaseRecorder();
      const scope = createScope({
        leadId: "lead-a",
        conversationId: "conversation-a",
        supabase,
      });

      const response = await createCreateQuotePostHandler({
        resolveQuoteScope: async () => scope as never,
        reserveQuoteNumber: async () => {
          throw new Error("must not reserve when lead mismatches");
        },
        resolveOpportunityDetail: async () => ({
          ok: true,
          data: {
            opportunity: {
              id: "opportunity-b",
              organizationId: "access-org",
              storeId: "access-store",
              customerId: "customer-1",
              stage: "qualificacao",
              stageStatus: "valid",
              stageChangedAt: null,
              createdAt: null,
              updatedAt: null,
            },
            customer: { id: "customer-1", displayName: "Cliente 1" },
            originLead: {
              id: "lead-b",
              name: "Lead B",
              phone: "+5511888888888",
            },
            primaryConversation: {
              id: "conversation-a",
              leadId: "lead-b",
              isHumanActive: false,
            },
            hasOriginLead: true,
            hasPrimaryConversation: true,
            isHumanActive: false,
            displayName: "Cliente 1",
            phone: "+5511888888888",
            warnings: [],
            problems: [],
            requiresAttention: false,
          },
        }),
      })(
        createRequest({
          storeId: "body-store",
          creationIdempotencyKey: "quote_create:key-1",
          leadId: "lead-a",
          conversationId: "conversation-a",
          commercialOpportunityId: "opportunity-b",
          items: [{ item_type: "custom", name: "Piscina", quantity: 1, unit_price_cents: 1000 }],
        })
      );

      const body = await parseBody(response);
      assert.equal(response.status, 403);
      assert.equal(body.error, "COMMERCIAL_OPPORTUNITY_LEAD_MISMATCH");
      assert.equal(supabase.insertCalls.length, 0);
    },
  },
  {
    name: "duas opportunities no mesmo cliente usam exatamente a explicitamente selecionada",
    run: async () => {
      const { createCreateQuotePostHandler } = await loadRouteModule();
      const supabase = createSupabaseRecorder();
      const scope = createScope({
        leadId: "lead-a",
        conversationId: "conversation-a",
        supabase,
      });

      const response = await createCreateQuotePostHandler({
        resolveQuoteScope: async () => scope as never,
        reserveQuoteNumber: async () => createNumberReservation(),
        resolveOpportunityDetail: async (commercialOpportunityId) => ({
          ok: true,
          data: {
            opportunity: {
              id: String(commercialOpportunityId),
              organizationId: "access-org",
              storeId: "access-store",
              customerId: "customer-1",
              stage: "qualificacao",
              stageStatus: "valid",
              stageChangedAt: null,
              createdAt: null,
              updatedAt: null,
            },
            customer: { id: "customer-1", displayName: "Cliente 1" },
            originLead: {
              id: "lead-a",
              name: "Lead A",
              phone: "+5511999999999",
            },
            primaryConversation: {
              id: "conversation-a",
              leadId: "lead-a",
              isHumanActive: false,
            },
            hasOriginLead: true,
            hasPrimaryConversation: true,
            isHumanActive: false,
            displayName: "Cliente 1",
            phone: "+5511999999999",
            warnings: [],
            problems: [],
            requiresAttention: false,
          },
        }),
      })(
        createRequest({
          storeId: "body-store",
          creationIdempotencyKey: "quote_create:key-1",
          leadId: "lead-a",
          conversationId: "conversation-a",
          commercialOpportunityId: "opportunity-a",
          items: [{ item_type: "custom", name: "Piscina", quantity: 1, unit_price_cents: 1000 }],
        })
      );

      const body = await parseBody(response);
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(
        supabase.insertCalls[0]?.payload.commercial_opportunity_id,
        "opportunity-a"
      );
      assert.notEqual(
        supabase.insertCalls[0]?.payload.commercial_opportunity_id,
        "opportunity-b"
      );
    },
  },
  {
    name: "browser mentindo tenant ids nao muda a authority do servidor",
    run: async () => {
      const { createCreateQuotePostHandler } = await loadRouteModule();
      const supabase = createSupabaseRecorder();
      const scope = createScope({
        organizationId: "access-org",
        storeId: "access-store",
        leadId: "lead-a",
        conversationId: "conversation-a",
        supabase,
      });

      const response = await createCreateQuotePostHandler({
        resolveQuoteScope: async () => scope as never,
        reserveQuoteNumber: async () => createNumberReservation(),
        resolveOpportunityDetail: async () => ({
          ok: true,
          data: {
            opportunity: {
              id: "opportunity-a",
              organizationId: "access-org",
              storeId: "access-store",
              customerId: "customer-1",
              stage: "qualificacao",
              stageStatus: "valid",
              stageChangedAt: null,
              createdAt: null,
              updatedAt: null,
            },
            customer: { id: "customer-1", displayName: "Cliente 1" },
            originLead: {
              id: "lead-a",
              name: "Lead A",
              phone: "+5511999999999",
            },
            primaryConversation: {
              id: "conversation-a",
              leadId: "lead-a",
              isHumanActive: false,
            },
            hasOriginLead: true,
            hasPrimaryConversation: true,
            isHumanActive: false,
            displayName: "Cliente 1",
            phone: "+5511999999999",
            warnings: [],
            problems: [],
            requiresAttention: false,
          },
        }),
      })(
        createRequest({
          organizationId: "fake-org",
          storeId: "fake-store",
          creationIdempotencyKey: "quote_create:key-1",
          leadId: "lead-a",
          conversationId: "conversation-a",
          commercialOpportunityId: "opportunity-a",
          items: [{ item_type: "custom", name: "Piscina", quantity: 1, unit_price_cents: 1000 }],
        })
      );

      const body = await parseBody(response);
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(supabase.insertCalls[0]?.payload.organization_id, "access-org");
      assert.equal(supabase.insertCalls[0]?.payload.store_id, "access-store");
    },
  },
  {
    name: "creationIdempotencyKey ausente rejeita",
    run: async () => {
      const { createCreateQuotePostHandler } = await loadRouteModule();
      const supabase = createSupabaseRecorder();
      const scope = createScope({
        leadId: "lead-a",
        conversationId: "conversation-a",
        supabase,
      });

      const response = await createCreateQuotePostHandler({
        resolveQuoteScope: async () => scope as never,
      })(
        createRequest({
          storeId: "body-store",
          leadId: "lead-a",
          conversationId: "conversation-a",
          commercialOpportunityId: "opportunity-a",
          items: [{ item_type: "custom", name: "Piscina", quantity: 1, unit_price_cents: 1000 }],
        })
      );

      const body = await parseBody(response);
      assert.equal(response.status, 400);
      assert.equal(body.error, "MISSING_CREATION_IDEMPOTENCY_KEY");
      assert.equal(supabase.insertCalls.length, 0);
    },
  },
  {
    name: "replay com mesma key e mesmo payload retorna a mesma quote",
    run: async () => {
      const { createCreateQuotePostHandler } = await loadRouteModule();
      const supabase = createSupabaseRecorder();
      const scope = createScope({
        leadId: "lead-a",
        conversationId: "conversation-a",
        supabase,
      });

      const handler = createCreateQuotePostHandler({
        resolveQuoteScope: async () => scope as never,
        reserveQuoteNumber: async () => createNumberReservation(),
        resolveOpportunityDetail: async () => ({
          ok: true,
          data: {
            opportunity: {
              id: "opportunity-a",
              organizationId: "access-org",
              storeId: "access-store",
              customerId: "customer-1",
              stage: "qualificacao",
              stageStatus: "valid",
              stageChangedAt: null,
              createdAt: null,
              updatedAt: null,
            },
            customer: { id: "customer-1", displayName: "Cliente 1" },
            originLead: {
              id: "lead-a",
              name: "Lead A",
              phone: "+5511999999999",
            },
            primaryConversation: {
              id: "conversation-a",
              leadId: "lead-a",
              isHumanActive: false,
            },
            hasOriginLead: true,
            hasPrimaryConversation: true,
            isHumanActive: false,
            displayName: "Cliente 1",
            phone: "+5511999999999",
            warnings: [],
            problems: [],
            requiresAttention: false,
          },
        }),
      });

      const requestBody = {
        storeId: "body-store",
        creationIdempotencyKey: "quote_create:key-1",
        leadId: "lead-a",
        conversationId: "conversation-a",
        commercialOpportunityId: "opportunity-a",
        title: "Orcamento A",
        items: [{ item_type: "custom", name: "Piscina", quantity: 1, unit_price_cents: 1000 }],
      };

      const firstResponse = await handler(createRequest(requestBody));
      const secondResponse = await handler(createRequest(requestBody));
      const firstBody = await parseBody(firstResponse);
      const secondBody = await parseBody(secondResponse);

      assert.equal(firstResponse.status, 200);
      assert.equal(secondResponse.status, 200);
      assert.equal(firstBody.quoteId, "quote-1");
      assert.equal(secondBody.quoteId, "quote-1");
      assert.equal(secondBody.replayed, true);
      assert.equal(
        supabase.insertCalls.filter((call) => call.table === "sales_quotes").length,
        1
      );
      assert.equal(supabase.rpcCalls.length, 2);
      assert.equal(
        supabase.rpcCalls.every(
          (call) =>
            call.fn === "advance_commercial_opportunity_to_quote_stage_by_system" &&
            call.args.p_idempotency_key ===
              "sales_quote_created_stage_projection:quote-1:opportunity-a"
        ),
        true
      );
    },
  },
  {
    name: "replay com mesma key e mesmo payload nao reserva novo numero",
    run: async () => {
      const { createCreateQuotePostHandler } = await loadRouteModule();
      const supabase = createSupabaseRecorder();
      const scope = createScope({
        leadId: "lead-a",
        conversationId: "conversation-a",
        supabase,
      });
      let reserveCalls = 0;

      const handler = createCreateQuotePostHandler({
        resolveQuoteScope: async () => scope as never,
        reserveQuoteNumber: async () => {
          reserveCalls += 1;
          return createNumberReservation();
        },
        resolveOpportunityDetail: async () => ({
          ok: true,
          data: {
            opportunity: {
              id: "opportunity-a",
              organizationId: "access-org",
              storeId: "access-store",
              customerId: "customer-1",
              stage: "qualificacao",
              stageStatus: "valid",
              stageChangedAt: null,
              createdAt: null,
              updatedAt: null,
            },
            customer: { id: "customer-1", displayName: "Cliente 1" },
            originLead: {
              id: "lead-a",
              name: "Lead A",
              phone: "+5511999999999",
            },
            primaryConversation: {
              id: "conversation-a",
              leadId: "lead-a",
              isHumanActive: false,
            },
            hasOriginLead: true,
            hasPrimaryConversation: true,
            isHumanActive: false,
            displayName: "Cliente 1",
            phone: "+5511999999999",
            warnings: [],
            problems: [],
            requiresAttention: false,
          },
        }),
      });

      const requestBody = {
        storeId: "body-store",
        creationIdempotencyKey: "quote_create:key-1",
        leadId: "lead-a",
        conversationId: "conversation-a",
        commercialOpportunityId: "opportunity-a",
        title: "Orcamento A",
        warranty_terms: "Garantia padrao",
        validity_days: "15",
        items: [{ item_type: "custom", name: "Piscina", quantity: 1, unit_price_cents: 1000 }],
      };

      const firstResponse = await handler(createRequest(requestBody));
      const response = await handler(createRequest(requestBody));

      assert.equal(firstResponse.status, 200);
      const body = await parseBody(response);
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.replayed, true);
      assert.equal(reserveCalls, 1);
    },
  },
  {
    name: "replay com validity_days usa o mesmo fingerprint mesmo com relogio diferente",
    run: async () => {
      const { createCreateQuotePostHandler } = await loadRouteModule();
      const supabase = createSupabaseRecorder();
      const scope = createScope({
        leadId: "lead-a",
        conversationId: "conversation-a",
        supabase,
      });
      let reserveCalls = 0;
      let nowCallCount = 0;

      const handler = createCreateQuotePostHandler({
        resolveQuoteScope: async () => scope as never,
        reserveQuoteNumber: async () => {
          reserveCalls += 1;
          return createNumberReservation();
        },
        getNow: () => {
          nowCallCount += 1;
          return nowCallCount === 1
            ? new Date("2026-08-13T10:00:00.000Z")
            : new Date("2026-08-14T10:00:00.000Z");
        },
        resolveOpportunityDetail: async () => ({
          ok: true,
          data: {
            opportunity: {
              id: "opportunity-a",
              organizationId: "access-org",
              storeId: "access-store",
              customerId: "customer-1",
              stage: "qualificacao",
              stageStatus: "valid",
              stageChangedAt: null,
              createdAt: null,
              updatedAt: null,
            },
            customer: { id: "customer-1", displayName: "Cliente 1" },
            originLead: {
              id: "lead-a",
              name: "Lead A",
              phone: "+5511999999999",
            },
            primaryConversation: {
              id: "conversation-a",
              leadId: "lead-a",
              isHumanActive: false,
            },
            hasOriginLead: true,
            hasPrimaryConversation: true,
            isHumanActive: false,
            displayName: "Cliente 1",
            phone: "+5511999999999",
            warnings: [],
            problems: [],
            requiresAttention: false,
          },
        }),
      });

      const requestBody = {
        storeId: "body-store",
        creationIdempotencyKey: "quote_create:validity-replay",
        leadId: "lead-a",
        conversationId: "conversation-a",
        commercialOpportunityId: "opportunity-a",
        title: "Orcamento A",
        warranty_terms: "Garantia padrao",
        validity_days: "7",
        items: [{ item_type: "custom", name: "Piscina", quantity: 1, unit_price_cents: 1000 }],
      };

      const firstResponse = await handler(createRequest(requestBody));
      const secondResponse = await handler(createRequest(requestBody));
      const firstBody = await parseBody(firstResponse);
      const secondBody = await parseBody(secondResponse);

      assert.equal(firstResponse.status, 200);
      assert.equal(firstBody.ok, true);
      assert.equal(secondResponse.status, 200);
      assert.equal(secondBody.ok, true);
      assert.equal(secondBody.replayed, true);
      assert.equal(reserveCalls, 1);
      assert.equal(
        supabase.insertCalls.filter((call) => call.table === "sales_quotes").length,
        1
      );
      assert.equal(supabase.quoteRows[0]?.valid_until, "2026-08-20");
      assert.deepEqual(supabase.quoteRows[0]?.metadata, {
        commercial_opportunity_id: "opportunity-a",
        warranty_terms: "Garantia padrao",
        validity_days: "7",
        valid_until: "2026-08-20",
        item_count: 1,
      });
    },
  },
  {
    name: "reuso incompatível da mesma key com payload diferente rejeita",
    run: async () => {
      const { createCreateQuotePostHandler } = await loadRouteModule();
      const supabase = createSupabaseRecorder({
        quoteRows: [
          {
            id: "quote-existing",
            organization_id: "access-org",
            store_id: "access-store",
            commercial_opportunity_id: "opportunity-a",
            creation_idempotency_key: "quote_create:key-1",
            creation_request_fingerprint: "different-fingerprint",
            conversation_id: "conversation-a",
            lead_id: "lead-a",
            quote_number: "ORC-001",
            title: "Orcamento existente",
            status: "draft",
            customer_name: "Lead A",
            customer_phone: "+5511999999999",
            customer_notes: null,
            internal_notes: null,
            warranty_terms: "Garantia padrao",
            valid_until: "2026-08-28",
            subtotal_cents: 1000,
            discount_cents: 0,
            total_cents: 1000,
            current_version_id: null,
            metadata: null,
            created_at: null,
            updated_at: null,
          },
        ],
      });
      const scope = createScope({
        leadId: "lead-a",
        conversationId: "conversation-a",
        supabase,
      });

      const response = await createCreateQuotePostHandler({
        resolveQuoteScope: async () => scope as never,
        reserveQuoteNumber: async () => createNumberReservation(),
        resolveOpportunityDetail: async () => ({
          ok: true,
          data: {
            opportunity: {
              id: "opportunity-a",
              organizationId: "access-org",
              storeId: "access-store",
              customerId: "customer-1",
              stage: "qualificacao",
              stageStatus: "valid",
              stageChangedAt: null,
              createdAt: null,
              updatedAt: null,
            },
            customer: { id: "customer-1", displayName: "Cliente 1" },
            originLead: {
              id: "lead-a",
              name: "Lead A",
              phone: "+5511999999999",
            },
            primaryConversation: {
              id: "conversation-a",
              leadId: "lead-a",
              isHumanActive: false,
            },
            hasOriginLead: true,
            hasPrimaryConversation: true,
            isHumanActive: false,
            displayName: "Cliente 1",
            phone: "+5511999999999",
            warnings: [],
            problems: [],
            requiresAttention: false,
          },
        }),
      })(
        createRequest({
          storeId: "body-store",
          creationIdempotencyKey: "quote_create:key-1",
          leadId: "lead-a",
          conversationId: "conversation-a",
          commercialOpportunityId: "opportunity-a",
          title: "Orcamento A",
          items: [{ item_type: "custom", name: "Piscina", quantity: 1, unit_price_cents: 1000 }],
        })
      );

      const body = await parseBody(response);
      assert.equal(response.status, 409);
      assert.equal(body.error, "QUOTE_CREATION_IDEMPOTENCY_KEY_REUSED");
    },
  },
  {
    name: "quote existente com items ausentes retorna in progress",
    run: async () => {
      const { createCreateQuotePostHandler } = await loadRouteModule();
      const supabase = createSupabaseRecorder();
      const scope = createScope({
        leadId: "lead-a",
        conversationId: "conversation-a",
        supabase,
      });
      let reserveCalls = 0;

      const handler = createCreateQuotePostHandler({
        resolveQuoteScope: async () => scope as never,
        reserveQuoteNumber: async () => {
          reserveCalls += 1;
          return createNumberReservation();
        },
        resolveOpportunityDetail: async () => ({
          ok: true,
          data: {
            opportunity: {
              id: "opportunity-a",
              organizationId: "access-org",
              storeId: "access-store",
              customerId: "customer-1",
              stage: "qualificacao",
              stageStatus: "valid",
              stageChangedAt: null,
              createdAt: null,
              updatedAt: null,
            },
            customer: { id: "customer-1", displayName: "Cliente 1" },
            originLead: {
              id: "lead-a",
              name: "Lead A",
              phone: "+5511999999999",
            },
            primaryConversation: {
              id: "conversation-a",
              leadId: "lead-a",
              isHumanActive: false,
            },
            hasOriginLead: true,
            hasPrimaryConversation: true,
            isHumanActive: false,
            displayName: "Cliente 1",
            phone: "+5511999999999",
            warnings: [],
            problems: [],
            requiresAttention: false,
          },
        }),
      });

      const requestBody = {
        storeId: "body-store",
        creationIdempotencyKey: "quote_create:key-1",
        leadId: "lead-a",
        conversationId: "conversation-a",
        commercialOpportunityId: "opportunity-a",
        title: "Orcamento A",
        items: [{ item_type: "custom", name: "Piscina", quantity: 1, unit_price_cents: 1000 }],
      };

      const firstResponse = await handler(createRequest(requestBody));
      assert.equal(firstResponse.status, 200);
      supabase.quoteItemRows.length = 0;

      const response = await handler(createRequest(requestBody));

      const body = await parseBody(response);
      assert.equal(response.status, 409);
      assert.equal(body.error, "QUOTE_CREATION_IN_PROGRESS");
      assert.equal(reserveCalls, 1);
      assert.equal(
        supabase.insertCalls.filter((call) => call.table === "sales_quotes").length,
        1
      );
      assert.equal(
        supabase.insertCalls.filter((call) => call.table === "sales_quote_items").length,
        1
      );
      assert.equal(supabase.rpcCalls.length, 1);
    },
  },
  {
    name: "falha no insert de items compensa quote incompleta e nao chama writer especializado",
    run: async () => {
      const { createCreateQuotePostHandler } = await loadRouteModule();
      const supabase = createSupabaseRecorder({
        salesQuoteItemsInsertError: {
          message: "items failed",
        },
      });
      const scope = createScope({
        leadId: "lead-a",
        conversationId: "conversation-a",
        supabase,
      });

      const response = await createCreateQuotePostHandler({
        resolveQuoteScope: async () => scope as never,
        reserveQuoteNumber: async () => createNumberReservation(),
        resolveOpportunityDetail: async () => ({
          ok: true,
          data: {
            opportunity: {
              id: "opportunity-a",
              organizationId: "access-org",
              storeId: "access-store",
              customerId: "customer-1",
              stage: "qualificacao",
              stageStatus: "valid",
              stageChangedAt: null,
              createdAt: null,
              updatedAt: null,
            },
            customer: { id: "customer-1", displayName: "Cliente 1" },
            originLead: {
              id: "lead-a",
              name: "Lead A",
              phone: "+5511999999999",
            },
            primaryConversation: {
              id: "conversation-a",
              leadId: "lead-a",
              isHumanActive: false,
            },
            hasOriginLead: true,
            hasPrimaryConversation: true,
            isHumanActive: false,
            displayName: "Cliente 1",
            phone: "+5511999999999",
            warnings: [],
            problems: [],
            requiresAttention: false,
          },
        }),
      })(
        createRequest({
          storeId: "body-store",
          creationIdempotencyKey: "quote_create:key-1",
          leadId: "lead-a",
          conversationId: "conversation-a",
          commercialOpportunityId: "opportunity-a",
          title: "Orcamento A",
          items: [{ item_type: "custom", name: "Piscina", quantity: 1, unit_price_cents: 1000 }],
        })
      );

      const body = await parseBody(response);
      assert.equal(response.status, 500);
      assert.equal(body.error, "UNEXPECTED_ERROR");
      assert.deepEqual(supabase.deletedQuoteIds, ["quote-1"]);
      assert.equal(supabase.rpcCalls.length, 0);
    },
  },
  {
    name: "conflito concorrente trata duplicate key como replay quando fingerprint coincide",
    run: async () => {
      const { createCreateQuotePostHandler } = await loadRouteModule();
      const existingQuote = {
        id: "quote-existing",
        organization_id: "access-org",
        store_id: "access-store",
        commercial_opportunity_id: "opportunity-a",
        creation_idempotency_key: "quote_create:key-1",
        creation_request_fingerprint: "",
        conversation_id: "conversation-a",
        lead_id: "lead-a",
        quote_number: "ORC-001",
        title: "Orcamento A",
        status: "draft",
        customer_name: "Lead A",
        customer_phone: "+5511999999999",
        customer_notes: null,
        internal_notes: null,
        subtotal_cents: 1000,
        discount_cents: 0,
        total_cents: 1000,
        current_version_id: null,
        metadata: null,
        created_at: null,
        updated_at: null,
      };
      const supabase = createSupabaseRecorder({
        quoteRows: [existingQuote],
        quoteItemRows: [
          {
            quote_id: "quote-existing",
            item_type: "custom",
            name: "Piscina",
            description: null,
            quantity: 1,
            unit_price_cents: 1000,
            discount_cents: 0,
            subtotal_cents: 1000,
            total_cents: 1000,
            sort_order: 1,
            sku: null,
          },
        ],
        firstLookupMisses: 1,
        salesQuoteInsertError: {
          code: "23505",
          message: "duplicate key value violates unique constraint",
        },
      });
      const scope = createScope({
        leadId: "lead-a",
        conversationId: "conversation-a",
        supabase,
      });

      const handler = createCreateQuotePostHandler({
        resolveQuoteScope: async () => scope as never,
        reserveQuoteNumber: async () => createNumberReservation(),
        resolveOpportunityDetail: async () => ({
          ok: true,
          data: {
            opportunity: {
              id: "opportunity-a",
              organizationId: "access-org",
              storeId: "access-store",
              customerId: "customer-1",
              stage: "qualificacao",
              stageStatus: "valid",
              stageChangedAt: null,
              createdAt: null,
              updatedAt: null,
            },
            customer: { id: "customer-1", displayName: "Cliente 1" },
            originLead: {
              id: "lead-a",
              name: "Lead A",
              phone: "+5511999999999",
            },
            primaryConversation: {
              id: "conversation-a",
              leadId: "lead-a",
              isHumanActive: false,
            },
            hasOriginLead: true,
            hasPrimaryConversation: true,
            isHumanActive: false,
            displayName: "Cliente 1",
            phone: "+5511999999999",
            warnings: [],
            problems: [],
            requiresAttention: false,
          },
        }),
      });

      const response = await handler(
        createRequest({
          storeId: "body-store",
          creationIdempotencyKey: "quote_create:key-1",
          leadId: "lead-a",
          conversationId: "conversation-a",
          commercialOpportunityId: "opportunity-a",
          title: "Orcamento A",
          items: [{ item_type: "custom", name: "Piscina", quantity: 1, unit_price_cents: 1000 }],
        })
      );

      const body = await parseBody(response);
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.quoteId, "quote-existing");
      assert.equal(body.replayed, true);
      assert.equal(supabase.rpcCalls.length, 1);
    },
  },
  {
    name: "23505 sem row em org store key retorna conflito nao idempotente",
    run: async () => {
      const { createCreateQuotePostHandler } = await loadRouteModule();
      const supabase = createSupabaseRecorder({
        salesQuoteInsertError: {
          code: "23505",
          message: "duplicate key value violates unique constraint",
        },
      });
      const scope = createScope({
        leadId: "lead-a",
        conversationId: "conversation-a",
        supabase,
      });

      const response = await createCreateQuotePostHandler({
        resolveQuoteScope: async () => scope as never,
        reserveQuoteNumber: async () => createNumberReservation(),
        resolveOpportunityDetail: async () => ({
          ok: true,
          data: {
            opportunity: {
              id: "opportunity-a",
              organizationId: "access-org",
              storeId: "access-store",
              customerId: "customer-1",
              stage: "qualificacao",
              stageStatus: "valid",
              stageChangedAt: null,
              createdAt: null,
              updatedAt: null,
            },
            customer: { id: "customer-1", displayName: "Cliente 1" },
            originLead: {
              id: "lead-a",
              name: "Lead A",
              phone: "+5511999999999",
            },
            primaryConversation: {
              id: "conversation-a",
              leadId: "lead-a",
              isHumanActive: false,
            },
            hasOriginLead: true,
            hasPrimaryConversation: true,
            isHumanActive: false,
            displayName: "Cliente 1",
            phone: "+5511999999999",
            warnings: [],
            problems: [],
            requiresAttention: false,
          },
        }),
      })(
        createRequest({
          storeId: "body-store",
          creationIdempotencyKey: "quote_create:key-1",
          leadId: "lead-a",
          conversationId: "conversation-a",
          commercialOpportunityId: "opportunity-a",
          title: "Orcamento A",
          items: [{ item_type: "custom", name: "Piscina", quantity: 1, unit_price_cents: 1000 }],
        })
      );

      const body = await parseBody(response);
      assert.equal(response.status, 409);
      assert.equal(body.error, "QUOTE_CREATION_UNIQUE_CONFLICT");
      assert.equal(body.quoteId, undefined);
    },
  },
  {
    name: "mesma key em outro tenant nao colide",
    run: async () => {
      const { createCreateQuotePostHandler } = await loadRouteModule();
      const supabase = createSupabaseRecorder({
        quoteRows: [
          {
            id: "quote-other-tenant",
            organization_id: "org-b",
            store_id: "store-b",
            commercial_opportunity_id: "opportunity-a",
            creation_idempotency_key: "quote_create:key-1",
            creation_request_fingerprint: "tenant-b-fingerprint",
            conversation_id: "conversation-a",
            lead_id: "lead-a",
            quote_number: "ORC-999",
            title: "Orcamento tenant B",
            status: "draft",
            customer_name: "Lead B",
            customer_phone: "+5511888888888",
            customer_notes: null,
            internal_notes: null,
            warranty_terms: null,
            valid_until: null,
            subtotal_cents: 1000,
            discount_cents: 0,
            total_cents: 1000,
            current_version_id: null,
            metadata: null,
            created_at: null,
            updated_at: null,
          },
        ],
      });
      const scope = createScope({
        organizationId: "access-org",
        storeId: "access-store",
        leadId: "lead-a",
        conversationId: "conversation-a",
        supabase,
      });

      const response = await createCreateQuotePostHandler({
        resolveQuoteScope: async () => scope as never,
        reserveQuoteNumber: async () => createNumberReservation(),
        resolveOpportunityDetail: async () => ({
          ok: true,
          data: {
            opportunity: {
              id: "opportunity-a",
              organizationId: "access-org",
              storeId: "access-store",
              customerId: "customer-1",
              stage: "qualificacao",
              stageStatus: "valid",
              stageChangedAt: null,
              createdAt: null,
              updatedAt: null,
            },
            customer: { id: "customer-1", displayName: "Cliente 1" },
            originLead: {
              id: "lead-a",
              name: "Lead A",
              phone: "+5511999999999",
            },
            primaryConversation: {
              id: "conversation-a",
              leadId: "lead-a",
              isHumanActive: false,
            },
            hasOriginLead: true,
            hasPrimaryConversation: true,
            isHumanActive: false,
            displayName: "Cliente 1",
            phone: "+5511999999999",
            warnings: [],
            problems: [],
            requiresAttention: false,
          },
        }),
      })(
        createRequest({
          organizationId: "body-org",
          storeId: "body-store",
          creationIdempotencyKey: "quote_create:key-1",
          leadId: "lead-a",
          conversationId: "conversation-a",
          commercialOpportunityId: "opportunity-a",
          title: "Orcamento A",
          items: [{ item_type: "custom", name: "Piscina", quantity: 1, unit_price_cents: 1000 }],
        })
      );

      const body = await parseBody(response);
      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.quoteId, "quote-1");
    },
  },
  {
    name: "writer aceita outcomes validos sem tratar skip ou replay como erro",
    run: async () => {
      const { createCreateQuotePostHandler } = await loadRouteModule();
      const acceptedOutcomes = [
        "advanced_to_orcamento",
        "already_in_quote_stage",
        "stage_not_eligible_for_quote_projection",
        "idempotent_replay",
      ];

      for (const outcome of acceptedOutcomes) {
        const supabase = createSupabaseRecorder({
          rpcResults: [
            {
              data: [
                {
                  commercial_opportunity_id: "opportunity-a",
                  sales_quote_id: "quote-1",
                  stage: outcome === "stage_not_eligible_for_quote_projection" ? "negociacao" : "orcamento",
                  lifecycle_cycle: 1,
                  lifecycle_event_id: outcome === "stage_not_eligible_for_quote_projection" ? null : "event-1",
                  event_type: outcome === "stage_not_eligible_for_quote_projection" ? null : "stage_transition",
                  reason_code: "explicit_quote_intent_required",
                  stage_changed: outcome === "advanced_to_orcamento",
                  outcome,
                  stage_changed_at: "2026-08-13T12:00:00.000Z",
                  updated_at: "2026-08-13T12:00:00.000Z",
                },
              ],
              error: null,
            },
          ],
        });
        const scope = createScope({
          leadId: "lead-a",
          conversationId: "conversation-a",
          supabase,
        });

        const response = await createCreateQuotePostHandler({
          resolveQuoteScope: async () => scope as never,
          reserveQuoteNumber: async () => createNumberReservation(),
          resolveOpportunityDetail: async () => ({
            ok: true,
            data: {
              opportunity: {
                id: "opportunity-a",
                organizationId: "access-org",
                storeId: "access-store",
                customerId: "customer-1",
                stage: "qualificacao",
                stageStatus: "valid",
                stageChangedAt: null,
                createdAt: null,
                updatedAt: null,
              },
              customer: { id: "customer-1", displayName: "Cliente 1" },
              originLead: {
                id: "lead-a",
                name: "Lead A",
                phone: "+5511999999999",
              },
              primaryConversation: {
                id: "conversation-a",
                leadId: "lead-a",
                isHumanActive: false,
              },
              hasOriginLead: true,
              hasPrimaryConversation: true,
              isHumanActive: false,
              displayName: "Cliente 1",
              phone: "+5511999999999",
              warnings: [],
              problems: [],
              requiresAttention: false,
            },
          }),
        })(
          createRequest({
            storeId: "body-store",
            creationIdempotencyKey: `quote_create:${outcome}`,
            leadId: "lead-a",
            conversationId: "conversation-a",
            commercialOpportunityId: "opportunity-a",
            title: "Orcamento A",
            items: [{ item_type: "custom", name: "Piscina", quantity: 1, unit_price_cents: 1000 }],
          })
        );

        const body = await parseBody(response);
        assert.equal(response.status, 200, outcome);
        assert.equal(body.ok, true, outcome);
      }
    },
  },
  {
    name: "falha da projection apos persistencia retorna erro controlado e preserva a quote",
    run: async () => {
      const { createCreateQuotePostHandler } = await loadRouteModule();
      const supabase = createSupabaseRecorder({
        rpcResults: [
          {
            data: null,
            error: {
              message: "rpc failed",
            },
          },
        ],
      });
      const scope = createScope({
        leadId: "lead-a",
        conversationId: "conversation-a",
        supabase,
      });

      const response = await createCreateQuotePostHandler({
        resolveQuoteScope: async () => scope as never,
        reserveQuoteNumber: async () => createNumberReservation(),
        resolveOpportunityDetail: async () => ({
          ok: true,
          data: {
            opportunity: {
              id: "opportunity-a",
              organizationId: "access-org",
              storeId: "access-store",
              customerId: "customer-1",
              stage: "qualificacao",
              stageStatus: "valid",
              stageChangedAt: null,
              createdAt: null,
              updatedAt: null,
            },
            customer: { id: "customer-1", displayName: "Cliente 1" },
            originLead: {
              id: "lead-a",
              name: "Lead A",
              phone: "+5511999999999",
            },
            primaryConversation: {
              id: "conversation-a",
              leadId: "lead-a",
              isHumanActive: false,
            },
            hasOriginLead: true,
            hasPrimaryConversation: true,
            isHumanActive: false,
            displayName: "Cliente 1",
            phone: "+5511999999999",
            warnings: [],
            problems: [],
            requiresAttention: false,
          },
        }),
      })(
        createRequest({
          storeId: "body-store",
          creationIdempotencyKey: "quote_create:projection-failure",
          leadId: "lead-a",
          conversationId: "conversation-a",
          commercialOpportunityId: "opportunity-a",
          title: "Orcamento A",
          items: [{ item_type: "custom", name: "Piscina", quantity: 1, unit_price_cents: 1000 }],
        })
      );

      const body = await parseBody(response);
      assert.equal(response.status, 409);
      assert.equal(body.error, "QUOTE_CREATED_STAGE_PROJECTION_FAILED");
      assert.equal(body.quoteId, "quote-1");
      assert.deepEqual(supabase.deletedQuoteIds, []);
      assert.equal(
        supabase.quoteRows.some((row) => row.id === "quote-1"),
        true
      );
      assert.equal(
        supabase.quoteItemRows.some((row) => row.quote_id === "quote-1"),
        true
      );
    },
  },
  {
    name: "retry apos projection failure reutiliza a mesma quote e tenta projection de novo",
    run: async () => {
      const { createCreateQuotePostHandler } = await loadRouteModule();
      const supabase = createSupabaseRecorder({
        rpcResults: [
          {
            data: null,
            error: {
              message: "rpc failed",
            },
          },
          {
            data: [
              {
                commercial_opportunity_id: "opportunity-a",
                sales_quote_id: "quote-1",
                stage: "orcamento",
                lifecycle_cycle: 1,
                lifecycle_event_id: "event-2",
                event_type: "stage_transition",
                reason_code: "explicit_quote_intent_required",
                stage_changed: true,
                outcome: "advanced_to_orcamento",
                stage_changed_at: "2026-08-13T12:00:00.000Z",
                updated_at: "2026-08-13T12:00:00.000Z",
              },
            ],
            error: null,
          },
        ],
      });
      const scope = createScope({
        leadId: "lead-a",
        conversationId: "conversation-a",
        supabase,
      });

      const handler = createCreateQuotePostHandler({
        resolveQuoteScope: async () => scope as never,
        reserveQuoteNumber: async () => createNumberReservation(),
        resolveOpportunityDetail: async () => ({
          ok: true,
          data: {
            opportunity: {
              id: "opportunity-a",
              organizationId: "access-org",
              storeId: "access-store",
              customerId: "customer-1",
              stage: "qualificacao",
              stageStatus: "valid",
              stageChangedAt: null,
              createdAt: null,
              updatedAt: null,
            },
            customer: { id: "customer-1", displayName: "Cliente 1" },
            originLead: {
              id: "lead-a",
              name: "Lead A",
              phone: "+5511999999999",
            },
            primaryConversation: {
              id: "conversation-a",
              leadId: "lead-a",
              isHumanActive: false,
            },
            hasOriginLead: true,
            hasPrimaryConversation: true,
            isHumanActive: false,
            displayName: "Cliente 1",
            phone: "+5511999999999",
            warnings: [],
            problems: [],
            requiresAttention: false,
          },
        }),
      });

      const request = {
        storeId: "body-store",
        creationIdempotencyKey: "quote_create:projection-failure",
        leadId: "lead-a",
        conversationId: "conversation-a",
        commercialOpportunityId: "opportunity-a",
        title: "Orcamento A",
        items: [{ item_type: "custom", name: "Piscina", quantity: 1, unit_price_cents: 1000 }],
      };

      const firstResponse = await handler(createRequest(request));
      const secondResponse = await handler(createRequest(request));
      const firstBody = await parseBody(firstResponse);
      const secondBody = await parseBody(secondResponse);

      assert.equal(firstResponse.status, 409);
      assert.equal(firstBody.error, "QUOTE_CREATED_STAGE_PROJECTION_FAILED");
      assert.equal(secondResponse.status, 200);
      assert.equal(secondBody.ok, true);
      assert.equal(secondBody.quoteId, "quote-1");
      assert.equal(secondBody.replayed, true);
      assert.equal(
        supabase.insertCalls.filter((call) => call.table === "sales_quotes").length,
        1
      );
      assert.equal(
        supabase.insertCalls.filter((call) => call.table === "sales_quote_items").length,
        1
      );
      assert.equal(supabase.rpcCalls.length, 2);
      assert.equal(
        supabase.rpcCalls.every(
          (call) =>
            call.args.p_idempotency_key ===
            "sales_quote_created_stage_projection:quote-1:opportunity-a"
        ),
        true
      );
    },
  },
];

void (async () => {
  const failures: string[] = [];

  for (const testCase of tests) {
    try {
      await testCase.run();
      process.stdout.write(`ok - ${testCase.name}\n`);
    } catch (error) {
      failures.push(
        `not ok - ${testCase.name}\n${error instanceof Error ? error.stack || error.message : String(error)}`
      );
    }
  }

  if (failures.length > 0) {
    process.stderr.write(`${failures.join("\n")}\n`);
    process.exitCode = 1;
  }
})();
