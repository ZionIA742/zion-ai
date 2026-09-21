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
}) {
  const { buildUpdatedQuote } = await loadRouteModule();

  assert.throws(
    () =>
      buildUpdatedQuote({
        quote: createQuote(),
        body: args.body as any,
        currentItems: [createCurrentItem()],
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
    name: "apply-change preserva remocao de desconto via Assistant sem items",
    run: async () => {
      const result = await buildUpdatedQuoteForTest({
        discount_cents: 0,
      });

      assert.equal(result.updatedQuote.subtotal_cents, 30000);
      assert.equal(result.updatedQuote.discount_cents, 0);
      assert.equal(result.updatedQuote.total_cents, 30000);
      assert.deepEqual(result.appliedChanges.discount_cents, {
        from: 1000,
        to: 0,
      });
      assert.equal(result.itemsChanged, false);
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
