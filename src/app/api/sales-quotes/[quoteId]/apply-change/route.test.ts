import { strict as assert } from "node:assert";
import Module from "node:module";
import { join } from "node:path";

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

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

function createQuote(overrides?: Record<string, unknown>) {
  return {
    id: "quote-1",
    organization_id: "org-1",
    store_id: "store-1",
    commercial_opportunity_id: "opp-1",
    conversation_id: "conv-1",
    lead_id: "lead-1",
    quote_number: "ORC-001",
    title: "Orcamento",
    status: "pending_review",
    customer_name: "Cliente",
    customer_phone: "+5511999999999",
    customer_notes: null,
    internal_notes: null,
    payment_terms: null,
    delivery_terms: null,
    warranty_terms: null,
    valid_until: null,
    subtotal_cents: 30000,
    discount_cents: 1000,
    total_cents: 29000,
    current_version_id: "version-1",
    last_change_request_id: "change-1",
    metadata: {},
    created_at: "2026-09-21T12:00:00.000Z",
    updated_at: "2026-09-21T12:00:00.000Z",
    ...overrides,
  } as any;
}

function createCurrentItem(overrides?: Record<string, unknown>) {
  return {
    id: "item-1",
    quote_id: "quote-1",
    organization_id: "org-1",
    store_id: "store-1",
    item_type: "custom",
    name: "Item antigo",
    description: null,
    quantity: 3,
    unit_price_cents: 10000,
    discount_cents: 1000,
    subtotal_cents: 30000,
    total_cents: 29000,
    sort_order: 1,
    sku: null,
    metadata: {},
    created_at: "2026-09-21T12:00:00.000Z",
    updated_at: "2026-09-21T12:00:00.000Z",
    ...overrides,
  } as any;
}

async function buildUpdatedQuoteForTest(body: Record<string, unknown>) {
  const { buildUpdatedQuote } = await loadRouteModule();

  return buildUpdatedQuote({
    quote: createQuote(),
    body: body as any,
    currentItems: [createCurrentItem()],
  });
}

async function assertApplyChangeMoneyError(args: {
  body: Record<string, unknown>;
  expectedError: string;
  quote?: ReturnType<typeof createQuote>;
  currentItems?: ReturnType<typeof createCurrentItem>[];
}) {
  const { buildUpdatedQuote } = await loadRouteModule();

  assert.throws(
    () =>
      buildUpdatedQuote({
        quote: args.quote ?? createQuote(),
        body: args.body as any,
        currentItems: args.currentItems ?? [createCurrentItem()],
      }),
    (error: unknown) =>
      Boolean(
        error &&
          typeof error === "object" &&
          (error as { code?: string }).code === args.expectedError,
      ),
  );
}

const tests: TestCase[] = [
  {
    name: "apply-change calcula desconto do item como total da linha",
    run: async () => {
      const result = await buildUpdatedQuoteForTest({
        items: [
          {
            item_type: "custom",
            name: "Piscina",
            quantity: 3,
            unit_price_cents: 10000,
            discount_cents: 1000,
          },
        ],
      });

      assert.equal(result.updatedQuote.subtotal_cents, 30000);
      assert.equal(result.updatedQuote.discount_cents, 1000);
      assert.equal(result.updatedQuote.total_cents, 29000);
      assert.equal(result.nextItems[0].subtotalCents, 30000);
      assert.equal(result.nextItems[0].discountCents, 1000);
      assert.equal(result.nextItems[0].totalCents, 29000);
    },
  },
  {
    name: "apply-change calcula totais da quote como soma dos itens",
    run: async () => {
      const result = await buildUpdatedQuoteForTest({
        items: [
          {
            item_type: "custom",
            name: "Piscina",
            quantity: 2,
            unit_price_cents: 10000,
            discount_cents: 1500,
          },
          {
            item_type: "service",
            name: "Instalacao",
            quantity: 1,
            unit_price_cents: 5000,
            discount_cents: 500,
          },
        ],
      });

      assert.equal(result.updatedQuote.subtotal_cents, 25000);
      assert.equal(result.updatedQuote.discount_cents, 2000);
      assert.equal(result.updatedQuote.total_cents, 23000);
    },
  },
  {
    name: "apply-change preserva lineage persistida de itens catalog pool e service custom",
    run: async () => {
      const { buildUpdatedQuote } = await loadRouteModule();
      const currentItems = [
        createCurrentItem({
          id: "catalog-item-row",
          item_type: "catalog_item",
          name: "Filtro",
          commercial_opportunity_id: "opp-catalog",
          profile_component_id: "component-catalog",
          catalog_item_id: "catalog-1",
          pool_id: null,
          quantity: 1,
          unit_price_cents: 10000,
          discount_cents: 0,
          subtotal_cents: 10000,
          total_cents: 10000,
          sort_order: 1,
        }),
        createCurrentItem({
          id: "pool-item-row",
          item_type: "pool",
          name: "Piscina",
          commercial_opportunity_id: "opp-pool",
          profile_component_id: "component-pool",
          catalog_item_id: null,
          pool_id: "pool-1",
          quantity: 1,
          unit_price_cents: 20000,
          discount_cents: 0,
          subtotal_cents: 20000,
          total_cents: 20000,
          sort_order: 2,
        }),
        createCurrentItem({
          id: "service-item-row",
          item_type: "service",
          name: "Instalacao especial",
          commercial_opportunity_id: "opp-service",
          profile_component_id: "component-service",
          catalog_item_id: null,
          pool_id: null,
          quantity: 1,
          unit_price_cents: 5000,
          discount_cents: 0,
          subtotal_cents: 5000,
          total_cents: 5000,
          sort_order: 3,
        }),
      ];

      const result = buildUpdatedQuote({
        quote: createQuote({
          subtotal_cents: 35000,
          discount_cents: 0,
          total_cents: 35000,
        }),
        body: {
          items: [
            {
              id: "catalog-item-row",
              item_type: "catalog_item",
              name: "Filtro",
              quantity: 1,
              unit_price_cents: 10000,
              discount_cents: 500,
            },
            {
              id: "pool-item-row",
              item_type: "pool",
              name: "Piscina",
              quantity: 1,
              unit_price_cents: 20000,
              discount_cents: 1000,
            },
            {
              id: "service-item-row",
              item_type: "service",
              name: "Instalacao especial",
              quantity: 1,
              unit_price_cents: 5000,
              discount_cents: 250,
            },
          ],
        } as any,
        currentItems,
      });

      assert.deepEqual(
        result.nextItems.map((item: any) => ({
          commercialOpportunityId: item.commercialOpportunityId,
          profileComponentId: item.profileComponentId,
          poolId: item.poolId,
          catalogItemId: item.catalogItemId,
        })),
        [
          {
            commercialOpportunityId: "opp-catalog",
            profileComponentId: "component-catalog",
            poolId: null,
            catalogItemId: "catalog-1",
          },
          {
            commercialOpportunityId: "opp-pool",
            profileComponentId: "component-pool",
            poolId: "pool-1",
            catalogItemId: null,
          },
          {
            commercialOpportunityId: "opp-service",
            profileComponentId: "component-service",
            poolId: null,
            catalogItemId: null,
          },
        ],
      );
      assert.equal(result.updatedQuote.discount_cents, 1750);
      assert.equal(result.updatedQuote.total_cents, 33250);
    },
  },
  {
    name: "apply-change mantem item novo manual sem lineage canonica",
    run: async () => {
      const { buildUpdatedQuote } = await loadRouteModule();
      const result = buildUpdatedQuote({
        quote: createQuote(),
        body: {
          items: [
            {
              item_type: "custom",
              name: "Item manual novo",
              quantity: 1,
              unit_price_cents: 30000,
              discount_cents: 1000,
            },
          ],
        } as any,
        currentItems: [createCurrentItem()],
      });

      assert.equal(result.nextItems[0].id, null);
      assert.equal((result.nextItems[0] as any).commercialOpportunityId, null);
      assert.equal((result.nextItems[0] as any).profileComponentId, null);
      assert.equal((result.nextItems[0] as any).poolId, null);
      assert.equal((result.nextItems[0] as any).catalogItemId, null);
    },
  },
  {
    name: "apply-change ignora lineage enviada no body e usa item persistido",
    run: async () => {
      const { buildUpdatedQuote } = await loadRouteModule();
      const result = buildUpdatedQuote({
        quote: createQuote(),
        body: {
          items: [
            {
              id: "item-1",
              item_type: "catalog_item",
              name: "Item antigo",
              quantity: 3,
              unit_price_cents: 10000,
              discount_cents: 1500,
              commercial_opportunity_id: "opp-malicious",
              profile_component_id: "component-malicious",
              catalog_item_id: "catalog-malicious",
              pool_id: "pool-malicious",
            },
          ],
        } as any,
        currentItems: [
          createCurrentItem({
            item_type: "catalog_item",
            commercial_opportunity_id: "opp-persisted",
            profile_component_id: "component-persisted",
            catalog_item_id: "catalog-persisted",
            pool_id: null,
          }),
        ],
      });

      assert.equal((result.nextItems[0] as any).commercialOpportunityId, "opp-persisted");
      assert.equal((result.nextItems[0] as any).profileComponentId, "component-persisted");
      assert.equal((result.nextItems[0] as any).catalogItemId, "catalog-persisted");
      assert.equal((result.nextItems[0] as any).poolId, null);
    },
  },
  {
    name: "apply-change rejeita quantity menor ou igual a zero",
    run: () =>
      assertApplyChangeMoneyError({
        body: {
          items: [
            {
              item_type: "custom",
              name: "Piscina",
              quantity: 0,
              unit_price_cents: 10000,
            },
          ],
        },
        expectedError: "INVALID_ITEM_QUANTITY",
      }),
  },
  {
    name: "apply-change rejeita quantity nao inteira",
    run: () =>
      assertApplyChangeMoneyError({
        body: {
          items: [
            {
              item_type: "custom",
              name: "Piscina",
              quantity: 1.5,
              unit_price_cents: 10000,
            },
          ],
        },
        expectedError: "INVALID_ITEM_QUANTITY",
      }),
  },
  {
    name: "apply-change rejeita unit_price_cents negativo",
    run: () =>
      assertApplyChangeMoneyError({
        body: {
          items: [
            {
              item_type: "custom",
              name: "Piscina",
              quantity: 1,
              unit_price_cents: -1,
            },
          ],
        },
        expectedError: "INVALID_ITEM_UNIT_PRICE",
      }),
  },
  {
    name: "apply-change rejeita discount_cents negativo no item",
    run: () =>
      assertApplyChangeMoneyError({
        body: {
          items: [
            {
              item_type: "custom",
              name: "Piscina",
              quantity: 1,
              unit_price_cents: 10000,
              discount_cents: -1,
            },
          ],
        },
        expectedError: "INVALID_ITEM_DISCOUNT",
      }),
  },
  {
    name: "apply-change rejeita discount_cents maior que subtotal do item",
    run: () =>
      assertApplyChangeMoneyError({
        body: {
          items: [
            {
              item_type: "custom",
              name: "Piscina",
              quantity: 1,
              unit_price_cents: 10000,
              discount_cents: 10001,
            },
          ],
        },
        expectedError: "INVALID_ITEM_DISCOUNT",
      }),
  },
  {
    name: "apply-change permite discount_cents igual ao subtotal do item",
    run: async () => {
      const result = await buildUpdatedQuoteForTest({
        items: [
          {
            item_type: "custom",
            name: "Piscina",
            quantity: 1,
            unit_price_cents: 10000,
            discount_cents: 10000,
          },
        ],
      });

      assert.equal(result.updatedQuote.subtotal_cents, 10000);
      assert.equal(result.updatedQuote.discount_cents, 10000);
      assert.equal(result.updatedQuote.total_cents, 0);
      assert.equal(result.nextItems[0].totalCents, 0);
    },
  },
  {
    name: "apply-change rejeita discount_cents da quote divergente da soma dos itens",
    run: () =>
      assertApplyChangeMoneyError({
        body: {
          discount_cents: 1500,
          items: [
            {
              item_type: "custom",
              name: "Piscina",
              quantity: 1,
              unit_price_cents: 10000,
              discount_cents: 1000,
            },
          ],
        },
        expectedError: "INVALID_DISCOUNT_CENTS",
      }),
  },
  {
    name: "apply-change aceita discount_cents da quote igual a soma dos itens",
    run: async () => {
      const result = await buildUpdatedQuoteForTest({
        discount_cents: 1000,
        items: [
          {
            item_type: "custom",
            name: "Piscina",
            quantity: 3,
            unit_price_cents: 10000,
            discount_cents: 1000,
          },
        ],
      });

      assert.equal(result.updatedQuote.subtotal_cents, 30000);
      assert.equal(result.updatedQuote.discount_cents, 1000);
      assert.equal(result.updatedQuote.total_cents, 29000);
    },
  },
  {
    name: "apply-change deriva discount_cents da quote quando campo esta ausente",
    run: async () => {
      const result = await buildUpdatedQuoteForTest({
        items: [
          {
            item_type: "custom",
            name: "Piscina",
            quantity: 2,
            unit_price_cents: 10000,
            discount_cents: 750,
          },
        ],
      });

      assert.equal(result.updatedQuote.subtotal_cents, 20000);
      assert.equal(result.updatedQuote.discount_cents, 750);
      assert.equal(result.updatedQuote.total_cents, 19250);
    },
  },
  {
    name: "apply-change aceita limite exato int4 monetario",
    run: async () => {
      const result = await buildUpdatedQuoteForTest({
        items: [
          {
            item_type: "custom",
            name: "Piscina",
            quantity: 1,
            unit_price_cents: 2147483647,
            discount_cents: 0,
          },
        ],
      });

      assert.equal(result.updatedQuote.subtotal_cents, 2147483647);
      assert.equal(result.updatedQuote.discount_cents, 0);
      assert.equal(result.updatedQuote.total_cents, 2147483647);
      assert.equal(result.nextItems[0].subtotalCents, 2147483647);
      assert.equal(result.nextItems[0].totalCents, 2147483647);
    },
  },
  {
    name: "apply-change rejeita unit_price_cents acima de int4",
    run: () =>
      assertApplyChangeMoneyError({
        body: {
          items: [
            {
              item_type: "custom",
              name: "Piscina",
              quantity: 1,
              unit_price_cents: 2147483648,
            },
          ],
        },
        expectedError: "INVALID_ITEM_UNIT_PRICE",
      }),
  },
  {
    name: "apply-change rejeita discount_cents acima de int4",
    run: () =>
      assertApplyChangeMoneyError({
        body: {
          items: [
            {
              item_type: "custom",
              name: "Piscina",
              quantity: 1,
              unit_price_cents: 2147483647,
              discount_cents: 2147483648,
            },
          ],
        },
        expectedError: "INVALID_ITEM_DISCOUNT",
      }),
  },
  {
    name: "apply-change rejeita overflow de subtotal por multiplicacao",
    run: () =>
      assertApplyChangeMoneyError({
        body: {
          items: [
            {
              item_type: "custom",
              name: "Piscina",
              quantity: 2,
              unit_price_cents: 1073741824,
            },
          ],
        },
        expectedError: "INVALID_ITEM_SUBTOTAL",
      }),
  },
  {
    name: "apply-change aceita maior multiplicacao valida dentro de int4",
    run: async () => {
      const result = await buildUpdatedQuoteForTest({
        items: [
          {
            item_type: "custom",
            name: "Piscina",
            quantity: 2,
            unit_price_cents: 1073741823,
          },
        ],
      });

      assert.equal(result.updatedQuote.subtotal_cents, 2147483646);
      assert.equal(result.updatedQuote.discount_cents, 0);
      assert.equal(result.updatedQuote.total_cents, 2147483646);
    },
  },
  {
    name: "apply-change rejeita overflow agregado de subtotal",
    run: () =>
      assertApplyChangeMoneyError({
        body: {
          items: [
            {
              item_type: "custom",
              name: "Piscina",
              quantity: 1,
              unit_price_cents: 1073741824,
            },
            {
              item_type: "service",
              name: "Instalacao",
              quantity: 1,
              unit_price_cents: 1073741824,
            },
          ],
        },
        expectedError: "INVALID_QUOTE_MONEY_TOTALS",
      }),
  },
  {
    name: "apply-change aceita limite agregado exato de subtotal",
    run: async () => {
      const result = await buildUpdatedQuoteForTest({
        items: [
          {
            item_type: "custom",
            name: "Piscina",
            quantity: 1,
            unit_price_cents: 1073741824,
          },
          {
            item_type: "service",
            name: "Instalacao",
            quantity: 1,
            unit_price_cents: 1073741823,
          },
        ],
      });

      assert.equal(result.updatedQuote.subtotal_cents, 2147483647);
      assert.equal(result.updatedQuote.discount_cents, 0);
      assert.equal(result.updatedQuote.total_cents, 2147483647);
    },
  },
  {
    name: "apply-change rejeita overflow agregado de descontos",
    run: () =>
      assertApplyChangeMoneyError({
        body: {
          items: [
            {
              item_type: "custom",
              name: "Piscina",
              quantity: 1,
              unit_price_cents: 1073741824,
              discount_cents: 1073741824,
            },
            {
              item_type: "service",
              name: "Instalacao",
              quantity: 1,
              unit_price_cents: 1073741824,
              discount_cents: 1073741824,
            },
          ],
        },
        expectedError: "INVALID_QUOTE_MONEY_TOTALS",
      }),
  },
  {
    name: "apply-change rejeita quantity nao safe integer",
    run: () =>
      assertApplyChangeMoneyError({
        body: {
          items: [
            {
              item_type: "custom",
              name: "Piscina",
              quantity: Number.MAX_SAFE_INTEGER + 1,
              unit_price_cents: 0,
            },
          ],
        },
        expectedError: "INVALID_ITEM_QUANTITY",
      }),
  },
  {
    name: "apply-change rejeita unit_price_cents nao safe integer",
    run: () =>
      assertApplyChangeMoneyError({
        body: {
          items: [
            {
              item_type: "custom",
              name: "Piscina",
              quantity: 1,
              unit_price_cents: Number.MAX_SAFE_INTEGER + 1,
            },
          ],
        },
        expectedError: "INVALID_ITEM_UNIT_PRICE",
      }),
  },
  {
    name: "apply-change rejeita discount_cents nao safe integer",
    run: () =>
      assertApplyChangeMoneyError({
        body: {
          items: [
            {
              item_type: "custom",
              name: "Piscina",
              quantity: 1,
              unit_price_cents: 2147483647,
              discount_cents: Number.MAX_SAFE_INTEGER + 1,
            },
          ],
        },
        expectedError: "INVALID_ITEM_DISCOUNT",
      }),
  },
  {
    name: "apply-change rejeita discount_cents sem items quando soma dos itens e zero",
    run: () =>
      assertApplyChangeMoneyError({
        body: {
          discount_cents: 100,
        },
        quote: createQuote({
          subtotal_cents: 30000,
          discount_cents: 0,
          total_cents: 30000,
        }),
        currentItems: [
          createCurrentItem({
            discount_cents: 0,
            total_cents: 30000,
          }),
        ],
        expectedError: "INVALID_DISCOUNT_CENTS",
      }),
  },
  {
    name: "apply-change rejeita remocao de discount_cents sem items quando itens somam desconto",
    run: () =>
      assertApplyChangeMoneyError({
        body: {
          discount_cents: 0,
        },
        expectedError: "INVALID_DISCOUNT_CENTS",
      }),
  },
  {
    name: "apply-change preserva discount_cents sem items quando igual a soma dos itens",
    run: async () => {
      const { buildUpdatedQuote } = await loadRouteModule();
      const result = buildUpdatedQuote({
        quote: createQuote({
          discount_cents: 500,
          total_cents: 29500,
        }),
        body: {
          discount_cents: 1000,
        } as any,
        currentItems: [createCurrentItem()],
      });

      assert.equal(result.updatedQuote.subtotal_cents, 30000);
      assert.equal(result.updatedQuote.discount_cents, 1000);
      assert.equal(result.updatedQuote.total_cents, 29000);
      assert.deepEqual(result.appliedChanges.discount_cents, {
        from: 500,
        to: 1000,
      });
      assert.equal(result.itemsChanged, false);
    },
  },
  {
    name: "apply-change rejeita discount_cents positivo em quote sem items no builder",
    run: () =>
      assertApplyChangeMoneyError({
        body: {
          discount_cents: 1,
        },
        quote: createQuote({
          subtotal_cents: 0,
          discount_cents: 0,
          total_cents: 0,
        }),
        currentItems: [],
        expectedError: "INVALID_DISCOUNT_CENTS",
      }),
  },
  {
    name: "apply-change persiste troca de items via writer atomico",
    run: async () => {
      const { persistQuoteChangeAtomically } = await loadRouteModule();
      const rpcCalls: Array<{ name: string; payload: Record<string, unknown> }> = [];
      const supabase = {
        rpc: async (name: string, payload: Record<string, unknown>) => {
          rpcCalls.push({ name, payload });
          return {
            data: [
              {
                quote_id: "quote-1",
                item_count: 2,
                subtotal_cents: 25000,
                discount_cents: 2000,
                total_cents: 23000,
              },
            ],
            error: null,
          };
        },
        from: () => {
          throw new Error("direct table write should not be used");
        },
      };

      await persistQuoteChangeAtomically({
        supabase,
        quote: createQuote(),
        updatedQuote: createQuote({
          status: "pending_review",
          subtotal_cents: 25000,
          discount_cents: 2000,
          total_cents: 23000,
        }),
        items: [
          {
            id: "item-1",
            commercialOpportunityId: "opp-1",
            profileComponentId: "component-1",
            poolId: null,
            catalogItemId: "catalog-1",
            itemType: "custom",
            name: "Piscina",
            description: null,
            quantity: 2,
            unitPriceCents: 10000,
            discountCents: 1500,
            subtotalCents: 20000,
            totalCents: 18500,
            sortOrder: 1,
            sku: null,
            metadata: {},
          },
          {
            id: "item-2",
            itemType: "service",
            name: "Instalacao",
            description: null,
            quantity: 1,
            unitPriceCents: 5000,
            discountCents: 500,
            subtotalCents: 5000,
            totalCents: 4500,
            sortOrder: 2,
            sku: null,
            metadata: {},
          },
        ] as any,
      });

      assert.equal(rpcCalls.length, 1);
      assert.equal(rpcCalls[0].name, "apply_sales_quote_change_money_and_items_by_system");
      assert.equal(rpcCalls[0].payload.p_subtotal_cents, 25000);
      assert.equal(rpcCalls[0].payload.p_discount_cents, 2000);
      assert.equal(rpcCalls[0].payload.p_total_cents, 23000);
      assert.equal((rpcCalls[0].payload.p_items as unknown[]).length, 2);
      assert.deepEqual((rpcCalls[0].payload.p_items as any[])[0], {
        id: "item-1",
        commercial_opportunity_id: "opp-1",
        profile_component_id: "component-1",
        pool_id: null,
        catalog_item_id: "catalog-1",
        item_type: "custom",
        name: "Piscina",
        description: null,
        quantity: 2,
        unit_price_cents: 10000,
        discount_cents: 1500,
        subtotal_cents: 20000,
        total_cents: 18500,
        sort_order: 1,
        sku: null,
        metadata: {},
      });
    },
  },
  {
    name: "apply-change falha atomica nao executa delete ou insert direto de items",
    run: async () => {
      const { persistQuoteChangeAtomically } = await loadRouteModule();
      let directTableWrites = 0;
      const supabase = {
        rpc: async () => ({
          data: null,
          error: { message: "simulated delete ok insert fail equivalent" },
        }),
        from: () => {
          directTableWrites += 1;
          return {};
        },
      };

      await assert.rejects(
        () =>
          persistQuoteChangeAtomically({
            supabase,
            quote: createQuote(),
            updatedQuote: createQuote(),
            items: [
              {
                id: "item-1",
                itemType: "custom",
                name: "Piscina",
                description: null,
                quantity: 3,
                unitPriceCents: 10000,
                discountCents: 1000,
                subtotalCents: 30000,
                totalCents: 29000,
                sortOrder: 1,
                sku: null,
                metadata: {},
              },
            ] as any,
          }),
        /Falha ao aplicar alteracao atomica do orcamento/,
      );

      assert.equal(directTableWrites, 0);
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
        `not ok - ${testCase.name}\n${
          error instanceof Error ? error.stack || error.message : String(error)
        }`,
      );
    }
  }

  if (failures.length > 0) {
    process.stderr.write(`${failures.join("\n")}\n`);
    process.exitCode = 1;
  }
})();
