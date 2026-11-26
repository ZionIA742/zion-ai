import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createCatalogProductsGetHandler } from "./route-handler";

type Row = Record<string, unknown>;

const granted = {
  ok: true as const,
  supabase: {} as never,
  sessionUserId: "user-1",
  organizationId: "org-1",
  storeId: "store-1",
  resolution: {} as never,
};

const denied = {
  ok: false as const,
  httpStatus: 401 as const,
  payload: {
    ok: false as const,
    error: "STORE_API_UNAUTHENTICATED",
    message: "Nao autenticado.",
    status: "anonymous" as const,
    reasonCode: "anonymous" as const,
  },
  resolution: {} as never,
};

function createClient(data: Record<string, Row[]>, options: { lookupError?: boolean; signingError?: boolean; batchFault?: string } = {}) {
  const calls: Array<{ table: string; filters: Row[]; columns: string }> = [];
  const storageCalls: Array<{ bucket: string; path: string; expiresIn: number }> = [];
  const batchCalls: Array<{
    bucket: string;
    paths: string[];
    expiresIn: number;
  }> = [];

  const client = {
    calls,
    storageCalls,
    batchCalls,
    from(table: string) {
      const filters: Row[] = [];
      let columns = "";
      let selectedRange: [number, number] | null = null;
      const builder = {
        select(value: string) {
          columns = value;
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          return builder;
        },
        in(column: string, value: unknown[]) {
          filters.push({ column, value });
          return builder;
        },
        order() {
          return builder;
        },
        range(from: number, to: number) {
          selectedRange = [from, to];
          return builder;
        },
        then(resolve: (value: unknown) => void) {
          calls.push({ table, filters: [...filters], columns });
          let rows = selectedRange
            ? (data[table] || []).slice(
                selectedRange[0],
                selectedRange[1] + 1,
              )
            : data[table] || [];

          const relation =
            table === "pools" &&
            columns.includes("pool_photos!pool_photos_pool_id_fkey(")
              ? "pool_photos"
              : table === "store_catalog_items" &&
                columns.includes("store_catalog_item_photos!store_catalog_item_photos_catalog_item_id_fkey(")
                ? "store_catalog_item_photos"
                : null;

          if (relation) {
            rows = rows.map((row) => ({
              ...row,
              [relation]:
                Object.prototype.hasOwnProperty.call(row, relation)
                  ? row[relation]
                  : data[relation] || [],
            }));
          }

          resolve({
            data: options.lookupError ? null : rows,
            error: options.lookupError
              ? { message: "internal database detail" }
              : null,
          });
        },
      };
      return builder;
    },
    storage: {
      from(bucket: string) {
        return {
          async createSignedUrls(paths: string[], expiresIn: number) {
            batchCalls.push({
              bucket,
              paths: [...paths],
              expiresIn,
            });

            for (const path of paths) {
              storageCalls.push({
                bucket,
                path,
                expiresIn,
              });
            }

            if (options.signingError) {
              return {
                data: null,
                error: { message: "private storage detail" },
              };
            }

            let entries: Array<{
              path: string;
              signedUrl: string;
              error: string | null;
            }> = paths.map((path) => ({
              path,
              signedUrl: `https://signed.test/${path}`,
              error: null,
            }));

            switch (options.batchFault) {
              case "missing":
                entries.pop();
                break;

              case "duplicate":
                entries[1] = { ...entries[0] };
                break;

              case "foreign":
                entries[0].path = "foreign/private.jpg";
                break;

              case "item_error":
                entries[0].error = "private item error";
                break;

              case "empty_url":
                entries[0].signedUrl = "";
                break;

              case "invalid_url":
                entries[0].signedUrl = "javascript:invalid";
                break;
            }

            return {
              data: entries.reverse(),
              error: null,
            };
          },

          async createSignedUrl(path: string, expiresIn: number) {
            storageCalls.push({ bucket, path, expiresIn });
            if (options.signingError) return { data: null, error: { message: "storage detail" } };
            return { data: { signedUrl: `https://signed.test/${path}` }, error: null };
          },
        };
      },
    },
  };
  return client;
}

test("anonymous access is denied before creating the service client", async () => {
  let clientCreated = false;
  const handler = createCatalogProductsGetHandler({
    resolveAccess: async () => denied,
    createServiceClient: () => {
      clientCreated = true;
      throw new Error("must not create client");
    },
  });
  const response = await handler();
  assert.equal(response.status, 401);
  assert.equal(clientCreated, false);
});

test("catalog GET bulk-loads scoped metadata, excludes unnamed sources, and returns no storage paths", async () => {
  const client = createClient({
    pools: [
      { id: "pool-1", name: "  Piscina Alpha ", is_active: true, photo_url: null },
      { id: "pool-http", name: "Piscina HTTP", is_active: true, photo_url: "https://cdn.test/pool.jpg" },
      { id: "pool-blank", name: "   ", is_active: true, photo_url: "https://cdn.test/blank.jpg" },
      { id: "pool-no-photo", name: "Sem foto", is_active: true, photo_url: null },
    ],
    store_catalog_items: [
      { id: "item-1", name: "  Item Alpha ", sku: "SKU-1", is_active: true },
      { id: "item-blank", name: "   ", sku: "SKU-X", is_active: true },
      { id: "item-no-photo", name: "Sem foto", sku: null, is_active: true },
    ],
    pool_photos: [
      { id: "pool-photo-null", pool_id: "pool-1", organization_id: "org-1", store_id: "store-1", storage_path: "pool/null.jpg", sort_order: null },
      { id: "pool-photo-2", pool_id: "pool-1", organization_id: "org-1", store_id: "store-1", storage_path: "pool/second.jpg", sort_order: 2 },
      { id: "pool-photo-1", pool_id: "pool-1", organization_id: "org-1", store_id: "store-1", storage_path: "pool/first.jpg", sort_order: 1 },
    ],
    store_catalog_item_photos: [
      { id: "item-photo-null-sort", catalog_item_id: "item-1", storage_path: "item/null-sort.jpg", sort_order: null, created_at: "2026-09-01" },
      { id: "item-photo-null-created", catalog_item_id: "item-1", storage_path: "item/null-created.jpg", sort_order: 1, created_at: null },
      { id: "item-photo-2", catalog_item_id: "item-1", storage_path: "item/second.jpg", sort_order: 1, created_at: "2026-10-02" },
      { id: "item-photo-1", catalog_item_id: "item-1", storage_path: "item/first.jpg", sort_order: 1, created_at: "2026-10-01" },
    ],
  });
  const handler = createCatalogProductsGetHandler({
    resolveAccess: async () => granted,
    createServiceClient: () => client as never,
  });
  const response = await handler();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.products, [
    { sourceKind: "pool", sourceId: "pool-1", name: "Piscina Alpha", sku: null, previewUrl: "https://signed.test/pool/first.jpg" },
    { sourceKind: "pool", sourceId: "pool-http", name: "Piscina HTTP", sku: null, previewUrl: "https://cdn.test/pool.jpg" },
    { sourceKind: "pool", sourceId: "pool-no-photo", name: "Sem foto", sku: null, previewUrl: null },
    { sourceKind: "catalog_item", sourceId: "item-1", name: "Item Alpha", sku: "SKU-1", previewUrl: "https://signed.test/item/first.jpg" },
    { sourceKind: "catalog_item", sourceId: "item-no-photo", name: "Sem foto", sku: null, previewUrl: null },
  ]);
  assert.equal(JSON.stringify(body).includes("storage_path"), false);
  assert.deepEqual(client.storageCalls, [
    { bucket: "pool-photos", path: "pool/first.jpg", expiresIn: 60 },
    { bucket: "store-catalog-photos", path: "item/first.jpg", expiresIn: 60 },
  ]);

  const poolsCall = client.calls.find((call) => call.table === "pools");
  const itemsCall = client.calls.find((call) => call.table === "store_catalog_items");
  const poolPhotosCall = client.calls.find((call) => call.table === "pool_photos");
  const itemPhotosCall = client.calls.find((call) => call.table === "store_catalog_item_photos");
  assert.deepEqual(poolsCall?.filters, [
    { column: "organization_id", value: "org-1" },
    { column: "store_id", value: "store-1" },
    { column: "is_active", value: true },
  ]);
  assert.deepEqual(itemsCall?.filters, [
    { column: "organization_id", value: "org-1" },
    { column: "store_id", value: "store-1" },
    { column: "is_active", value: true },
  ]);
  assert.deepEqual(poolPhotosCall?.filters, [
    { column: "organization_id", value: "org-1" },
    { column: "store_id", value: "store-1" },
    { column: "pool_id", value: ["pool-1", "pool-http", "pool-no-photo"] },
  ]);
  assert.deepEqual(itemPhotosCall?.filters, [
    { column: "catalog_item_id", value: ["item-1", "item-no-photo"] },
  ]);
  assert.equal(body.products[0].previewUrl, "https://signed.test/pool/first.jpg");
  assert.equal(body.products[3].previewUrl, "https://signed.test/item/first.jpg");
});

test("catalog lookup and signing errors fail closed with generic public messages", async () => {
  for (const options of [{ lookupError: true }, { signingError: true }]) {
    const client = createClient({
      pools: [{ id: "pool-1", name: "Pool", photo_url: null }],
      store_catalog_items: [],
      pool_photos: [{ id: "photo-1", pool_id: "pool-1", storage_path: "pool/photo.jpg", sort_order: 1 }],
    }, options);
    const handler = createCatalogProductsGetHandler({
      resolveAccess: async () => granted,
      createServiceClient: () => client as never,
    });
    const response = await handler();
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(body.message, "Nao foi possivel carregar o catalogo.");
    assert.equal(JSON.stringify(body).includes("internal database detail"), false);
    assert.equal(JSON.stringify(body).includes("storage detail"), false);
  }
});

test("catalog GET source contract has no invented fallback names and no per-source metadata query", () => {
  const source = readFileSync(join(process.cwd(), "src/app/api/crm/catalog-products/route-handler.ts"), "utf8");
  assert.doesNotMatch(source, /name\) \|\| ["'](Piscina|Produto)["']/);
  assert.match(source, /\.in\("pool_id", poolIds\)/);
  assert.match(source, /\.in\("catalog_item_id", itemIds\)/);
  assert.match(source, /compareNullableNumber/);
  assert.match(source, /compareNullableText/);
  assert.doesNotMatch(source, /Number\(null\)/);
  assert.match(source, /Nao foi possivel carregar o catalogo/);
});

test("empty catalog is valid and does not request photo signing", async () => {
  const client = createClient({
    pools: [],
    store_catalog_items: [],
  });

  const handler = createCatalogProductsGetHandler({
    resolveAccess: async () => granted,
    createServiceClient: () => client as never,
  });

  const response = await handler();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body.products, []);
  assert.deepEqual(client.storageCalls, []);
});

test("products without photos remain visible without invented preview URLs", async () => {
  const client = createClient({
    pools: [
      { id: "pool-1", name: "Pool without photo", photo_url: null },
    ],
    store_catalog_items: [
      { id: "item-1", name: "Item without photo", sku: "SKU-1" },
    ],
    pool_photos: [],
    store_catalog_item_photos: [],
  });

  const handler = createCatalogProductsGetHandler({
    resolveAccess: async () => granted,
    createServiceClient: () => client as never,
  });

  const response = await handler();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.products.length, 2);
  assert.equal(body.products[0].previewUrl, null);
  assert.equal(body.products[1].previewUrl, null);
  assert.equal(body.products[1].sku, "SKU-1");
  assert.deepEqual(client.storageCalls, []);
});

test("catalog picker loads details before confirming the photo-only send contract", () => {
  const source = readFileSync(
    join(process.cwd(), "src/app/(app)/crm/lead/[id]/CatalogProductComposerPicker.tsx"),
    "utf8",
  );

  assert.match(source, /view: "search"/);
  assert.match(source, /view: "detail"/);
  assert.match(source, /detail\.photos\.map/);
  assert.match(source, /disabled=\{detail\.photos\.length === 0\}/);
  assert.match(source, /if \(!previewUrl\) return;/);
  assert.match(source, /Sem foto cadastrada/);
  assert.doesNotMatch(source, /src=\{product\.previewUrl\}/);
});

test("lightweight catalog does not load photos or expose internal metadata", async () => {
  const client = createClient({
    pools: [
      { id: "pool-1", name: "Piscina Alpha" },
    ],
    store_catalog_items: [
      {
        id: "item-1",
        name: "Produto Alpha",
        sku: "SKU-1",
        metadata: {
          categoria: "outros",
          internal_secret: "must-not-be-returned",
        },
      },
    ],
  });

  const handler = createCatalogProductsGetHandler({
    resolveAccess: async () => granted,
    createServiceClient: () => client as never,
  });

  const response = await handler(
    new Request(
      "http://localhost/api/crm/catalog-products?view=list",
    ),
  );

  const body = await response.json();

  assert.equal(response.status, 200);

  assert.deepEqual(body.products, [
    {
      sourceKind: "pool",
      sourceId: "pool-1",
      name: "Piscina Alpha",
      sku: null,
      category: "piscinas",
    },
    {
      sourceKind: "catalog_item",
      sourceId: "item-1",
      name: "Produto Alpha",
      sku: "SKU-1",
      category: "outros",
    },
  ]);

  assert.deepEqual(
    client.calls.map((call) => call.table),
    ["pools", "store_catalog_items"],
  );

  for (const call of client.calls) {
    assert.deepEqual(call.filters, [
      { column: "organization_id", value: "org-1" },
      { column: "store_id", value: "store-1" },
      { column: "is_active", value: true },
    ]);
  }

  assert.deepEqual(client.storageCalls, []);
  assert.equal(JSON.stringify(body).includes("previewUrl"), false);
  assert.equal(JSON.stringify(body).includes("internal_secret"), false);
});

test("lightweight catalog supports pagination without photo signing", async () => {
  const pools = Array.from(
    { length: 101 },
    (_, index) => ({
      id: `pool-${index}`,
      name: `Pool ${index}`,
    }),
  );

  const client = createClient({
    pools,
    store_catalog_items: [],
  });

  const handler = createCatalogProductsGetHandler({
    resolveAccess: async () => granted,
    createServiceClient: () => client as never,
  });

  const first = await handler(
    new Request(
      "http://localhost/api/crm/catalog-products?view=list&page=0",
    ),
  );

  const firstBody = await first.json();

  assert.equal(first.status, 200);
  assert.equal(firstBody.products.length, 100);
  assert.equal(firstBody.hasMore.pools, true);

  const second = await handler(
    new Request(
      "http://localhost/api/crm/catalog-products?view=list&page=1",
    ),
  );

  const secondBody = await second.json();

  assert.equal(second.status, 200);
  assert.equal(secondBody.products.length, 1);
  assert.equal(secondBody.products[0].sourceId, "pool-100");
  assert.equal(secondBody.hasMore.pools, false);

  const invalid = await handler(
    new Request(
      "http://localhost/api/crm/catalog-products?view=list&page=-1",
    ),
  );

  assert.equal(invalid.status, 400);
  assert.deepEqual(client.storageCalls, []);
});

const detailPoolId = "550e8400-e29b-41d4-a716-446655440001";
const detailItemId = "550e8400-e29b-41d4-a716-446655440002";

const detailScope = {
  organization_id: "org-1",
  store_id: "store-1",
  is_active: true,
};

function detailRequest(
  kind: string,
  id: string,
) {
  return new Request(
    `http://localhost/api/crm/catalog-products?view=detail&sourceKind=${kind}&sourceId=${id}`,
  );
}

test("pool detail returns all scoped photos in canonical order", async () => {
  const client = createClient({
    pools: [{
      ...detailScope,
      id: detailPoolId,
      name: "Piscina Alpha",
      width_m: 3,
      length_m: 6,
      depth_m: 1.4,
      material: "Fibra",
      price: 15000,
      price_status: "valid",
    }],
    pool_photos: [
      {
        id: "photo-2",
        pool_id: detailPoolId,
        ...detailScope,
        storage_path: "pool/second.jpg",
        sort_order: 2,
      },
      {
        id: "photo-1",
        pool_id: detailPoolId,
        ...detailScope,
        storage_path: "pool/first.jpg",
        sort_order: 1,
      },
      {
        id: "foreign-photo",
        pool_id: detailPoolId,
        organization_id: "foreign-org",
        store_id: "foreign-store",
        storage_path: "foreign/photo.jpg",
        sort_order: 0,
      },
    ],
  });

  const handler = createCatalogProductsGetHandler({
    resolveAccess: async () => granted,
    createServiceClient: () => client as never,
  });

  const response = await handler(
    detailRequest("pool", detailPoolId),
  );

  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.product.category, "piscinas");
  assert.equal(body.product.characteristics.length_m, 6);

  assert.deepEqual(body.product.price, {
    amount: 15000,
    currency: "BRL",
  });

  assert.deepEqual(
    body.product.photos.map((photo: Row) => photo.id),
    ["photo-1", "photo-2"],
  );

  assert.equal(client.storageCalls.length, 2);
  assert.equal(client.storageCalls[0].path, "pool/first.jpg");
  assert.equal(client.storageCalls[1].path, "pool/second.jpg");

  assert.deepEqual(
    client.calls.map((call) => call.table),
    ["pools"],
  );

  assert.deepEqual(client.calls[0].filters, [
    { column: "pool_photos.organization_id", value: "org-1" },
    { column: "pool_photos.store_id", value: "store-1" },
    { column: "organization_id", value: "org-1" },
    { column: "store_id", value: "store-1" },
    { column: "is_active", value: true },
    { column: "id", value: detailPoolId },
  ]);

  assert.match(
    client.calls[0].columns,
    /pool_photos!pool_photos_pool_id_fkey\(/,
  );

  assert.equal(
    JSON.stringify(body).includes("storage_path"),
    false,
  );
});

test("item detail exposes only allowed commercial metadata", async () => {
  const client = createClient({
    store_catalog_items: [{
      ...detailScope,
      id: detailItemId,
      name: "Filtro Alpha",
      sku: "FLT-1",
      description: "Filtro para piscina",
      price_cents: 150000,
      price_status: "valid",
      currency: "BRL",
      metadata: {
        categoria: "acessorios",
        brand: "Marca Alpha",
        material: "Plastico",
        internal_secret: "must-not-be-returned",
        source_file_name: "internal-file.xlsx",
      },
    }],
    store_catalog_item_photos: [
      {
        id: "item-photo-1",
        catalog_item_id: detailItemId,
        storage_path: "item/first.jpg",
        sort_order: 1,
      },
      {
        id: "item-photo-2",
        catalog_item_id: detailItemId,
        storage_path: "item/second.jpg",
        sort_order: 2,
      },
      {
        id: "unrelated-photo",
        catalog_item_id: "another-product",
        storage_path: "other/photo.jpg",
        sort_order: 0,
      },
    ],
  });

  const handler = createCatalogProductsGetHandler({
    resolveAccess: async () => granted,
    createServiceClient: () => client as never,
  });

  const response = await handler(
    detailRequest("catalog_item", detailItemId),
  );

  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.product.category, "acessorios");
  assert.equal(body.product.sku, "FLT-1");

  assert.deepEqual(body.product.price, {
    amount: 1500,
    currency: "BRL",
  });

  assert.equal(
    body.product.characteristics.brand,
    "Marca Alpha",
  );

  assert.equal(body.product.photos.length, 2);
  assert.equal(client.storageCalls.length, 2);

  assert.equal(
    JSON.stringify(body).includes("internal_secret"),
    false,
  );

  assert.equal(
    JSON.stringify(body).includes("internal-file.xlsx"),
    false,
  );
});

test("product detail supports absent photos and unconfirmed prices", async () => {
  const client = createClient({
    store_catalog_items: [{
      ...detailScope,
      id: detailItemId,
      name: "Produto sem foto",
      price_cents: 99999,
      price_status: "invalid",
      currency: "BRL",
      metadata: { categoria: "outros" },
    }],
    store_catalog_item_photos: [],
  });

  const handler = createCatalogProductsGetHandler({
    resolveAccess: async () => granted,
    createServiceClient: () => client as never,
  });

  const response = await handler(
    detailRequest("catalog_item", detailItemId),
  );

  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.product.photos, []);
  assert.equal(body.product.price, null);
  assert.deepEqual(client.storageCalls, []);
});

test("invalid foreign inactive and missing products cannot load photos", async () => {
  for (const rows of [
    [],
    [{
      ...detailScope,
      id: detailPoolId,
      name: "Foreign",
      store_id: "another-store",
    }],
    [{
      ...detailScope,
      id: detailPoolId,
      name: "Foreign organization",
      organization_id: "another-org",
    }],
    [{
      ...detailScope,
      id: detailPoolId,
      name: "Inactive",
      is_active: false,
    }],
  ]) {
    const client = createClient({ pools: rows });

    const handler = createCatalogProductsGetHandler({
      resolveAccess: async () => granted,
      createServiceClient: () => client as never,
    });

    const response = await handler(
      detailRequest("pool", detailPoolId),
    );

    assert.equal(response.status, 404);
    assert.equal(client.calls.length, 1);
    assert.deepEqual(client.storageCalls, []);

    const invalid = await handler(
      detailRequest("pool", "invalid-id"),
    );

    assert.equal(invalid.status, 400);
    assert.equal(client.calls.length, 1);
  }
});

test("detail signing failures do not expose private storage errors", async () => {
  const client = createClient({
    pools: [{
      ...detailScope,
      id: detailPoolId,
      name: "Pool",
    }],
    pool_photos: [{
      ...detailScope,
      id: "photo-1",
      pool_id: detailPoolId,
      storage_path: "private/photo.jpg",
      sort_order: 1,
    }],
  }, { signingError: true });

  const handler = createCatalogProductsGetHandler({
    resolveAccess: async () => granted,
    createServiceClient: () => client as never,
  });

  const response = await handler(
    detailRequest("pool", detailPoolId),
  );

  const body = await response.json();

  assert.equal(response.status, 500);
  assert.equal(client.storageCalls.length, 1);

  assert.equal(
    JSON.stringify(body).includes("storage detail"),
    false,
  );

  assert.equal(
    JSON.stringify(body).includes("private/photo.jpg"),
    false,
  );
});

test("catalog scope mismatch rejects list and detail before product reads", async () => {
  for (const view of [
    "view=list",
    `view=detail&sourceKind=pool&sourceId=${detailPoolId}`,
  ]) {
    for (const scope of [
      "expectedOrganizationId=foreign-org&expectedStoreId=store-1",
      "expectedOrganizationId=org-1&expectedStoreId=foreign-store",
      "expectedStoreId=store-1",
      "expectedOrganizationId=org-1",
    ]) {
      const client = createClient({});

      const handler = createCatalogProductsGetHandler({
        resolveAccess: async () => granted,
        createServiceClient: () => client as never,
      });

      const response = await handler(
        new Request(
          `http://localhost/api/crm/catalog-products?${view}&${scope}`,
        ),
      );

      const body = await response.json();

      assert.equal(response.status, 409);
      assert.equal(body.error, "CATALOG_STORE_SCOPE_MISMATCH");
      assert.equal(client.calls.length, 0);
      assert.equal(client.storageCalls.length, 0);
    }
  }
});

test("catalog accepts the expected authenticated store scope", async () => {
  const client = createClient({
    pools: [{
      ...detailScope,
      id: detailPoolId,
      name: "Scoped Pool",
    }],
    store_catalog_items: [],
    pool_photos: [],
  });

  const handler = createCatalogProductsGetHandler({
    resolveAccess: async () => granted,
    createServiceClient: () => client as never,
  });

  const scope =
    "expectedOrganizationId=org-1&expectedStoreId=store-1";

  const list = await handler(
    new Request(
      `http://localhost/api/crm/catalog-products?view=list&${scope}`,
    ),
  );

  assert.equal(list.status, 200);

  const listBody = await list.json();

  assert.equal(listBody.products.length, 1);
  assert.equal(listBody.products[0].sourceId, detailPoolId);

  const detail = await handler(
    new Request(
      `http://localhost/api/crm/catalog-products?view=detail&sourceKind=pool&sourceId=${detailPoolId}&${scope}`,
    ),
  );

  assert.equal(detail.status, 200);

  const detailBody = await detail.json();

  assert.equal(detailBody.product.sourceId, detailPoolId);
  assert.deepEqual(detailBody.product.photos, []);
  assert.equal(client.storageCalls.length, 0);
});

function createSearchClient(
  rows: unknown,
  fail = false,
) {
  const client = createClient({});

  const rpcCalls: Array<{
    name: string;
    args: Row;
  }> = [];

  return {
    ...client,
    rpcCalls,

    async rpc(name: string, args: Row) {
      rpcCalls.push({ name, args });

      return {
        data: fail ? null : rows,
        error: fail
          ? { message: "private search error" }
          : null,
      };
    },
  };
}

const catalogSearchScope =
  "expectedOrganizationId=org-1&expectedStoreId=store-1";

function catalogSearchRequest(
  query = "",
  scope = catalogSearchScope,
) {
  return new Request(
    `http://localhost/api/crm/catalog-products?view=search&${scope}&${query}`,
  );
}

test("catalog search uses authenticated scope and returns lightweight results", async () => {
  const client = createSearchClient([
    {
      source_kind: "catalog_item",
      source_id: detailItemId,
      name: "Filtro Alpha",
      sku: "FLT-1",
      category: "acessorios",
      internal_secret: "private metadata",
    },
  ]);

  const handler = createCatalogProductsGetHandler({
    resolveAccess: async () => granted,
    createServiceClient: () => client as never,
  });

  const response = await handler(
    catalogSearchRequest(
      "q=Filtro&category=acessorios&page=2",
    ),
  );

  const body = await response.json();

  assert.equal(response.status, 200);

  assert.deepEqual(client.rpcCalls, [{
    name: "crm_search_catalog_products",
    args: {
      p_organization_id: "org-1",
      p_store_id: "store-1",
      p_query: "Filtro",
      p_category: "acessorios",
      p_page: 2,
    },
  }]);

  assert.deepEqual(body.products, [{
    sourceKind: "catalog_item",
    sourceId: detailItemId,
    name: "Filtro Alpha",
    sku: "FLT-1",
    category: "acessorios",
  }]);

  assert.equal(body.hasMore, false);
  assert.equal(body.page, 2);
  assert.deepEqual(client.calls, []);
  assert.deepEqual(client.storageCalls, []);
  assert.equal(JSON.stringify(body).includes("previewUrl"), false);
  assert.equal(JSON.stringify(body).includes("internal_secret"), false);
});

test("catalog search returns only 100 results and exposes next-page state", async () => {
  const rows = Array.from(
    { length: 101 },
    (_, index) => ({
      source_kind: "pool",
      source_id:
        `550e8400-e29b-41d4-a716-${String(index).padStart(12, "0")}`,
      name: `Pool ${index}`,
      sku: null,
      category: "piscinas",
    }),
  );

  const client = createSearchClient(rows);

  const handler = createCatalogProductsGetHandler({
    resolveAccess: async () => granted,
    createServiceClient: () => client as never,
  });

  const response = await handler(
    catalogSearchRequest("page=0"),
  );

  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.products.length, 100);
  assert.equal(body.pageSize, 100);
  assert.equal(body.hasMore, true);
  assert.equal(client.rpcCalls[0].args.p_query, null);
  assert.equal(client.rpcCalls[0].args.p_category, null);
  assert.deepEqual(client.storageCalls, []);
});

test("catalog search rejects invalid inputs before RPC execution", async () => {
  const client = createSearchClient([]);

  const handler = createCatalogProductsGetHandler({
    resolveAccess: async () => granted,
    createServiceClient: () => client as never,
  });

  for (const input of [
    "page=-1",
    "page=10001",
    "page=abc",
    "category=invalid",
    `q=${"x".repeat(121)}`,
  ]) {
    const response = await handler(
      catalogSearchRequest(input),
    );

    assert.equal(response.status, 400);
    assert.equal(
      (await response.json()).error,
      "INVALID_CATALOG_SEARCH",
    );
  }

  assert.deepEqual(client.rpcCalls, []);
  assert.deepEqual(client.storageCalls, []);
});

test("catalog search rejects missing or divergent expected store scope", async () => {
  const client = createSearchClient([]);

  const handler = createCatalogProductsGetHandler({
    resolveAccess: async () => granted,
    createServiceClient: () => client as never,
  });

  for (const scope of [
    "",
    "expectedStoreId=store-1",
    "expectedOrganizationId=org-1",
    "expectedOrganizationId=org-1&expectedStoreId=foreign",
    "expectedOrganizationId=foreign&expectedStoreId=store-1",
  ]) {
    const response = await handler(
      catalogSearchRequest("q=Alpha", scope),
    );

    assert.equal(response.status, 409);
    assert.equal(
      (await response.json()).error,
      "CATALOG_STORE_SCOPE_MISMATCH",
    );
  }

  assert.deepEqual(client.rpcCalls, []);
  assert.deepEqual(client.calls, []);
  assert.deepEqual(client.storageCalls, []);
});

test("catalog search fails closed on RPC errors or invalid result contracts", async () => {
  const valid = {
    source_kind: "pool",
    source_id: detailPoolId,
    name: "Pool Alpha",
    sku: null,
    category: "piscinas",
  };

  const cases = [
    { rows: [], fail: true },
    { rows: null, fail: false },
    { rows: [null], fail: false },
    {
      rows: [{ ...valid, source_id: "invalid" }],
      fail: false,
    },
    {
      rows: [{ ...valid, category: "outros" }],
      fail: false,
    },
    {
      rows: [{ ...valid, name: "" }],
      fail: false,
    },
    { rows: [valid, valid], fail: false },
  ];

  for (const entry of cases) {
    const client = createSearchClient(
      entry.rows,
      entry.fail,
    );

    const handler = createCatalogProductsGetHandler({
      resolveAccess: async () => granted,
      createServiceClient: () => client as never,
    });

    const response = await handler(
      catalogSearchRequest("q=Alpha"),
    );

    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(
      JSON.stringify(body).includes("private search error"),
      false,
    );

    assert.deepEqual(client.storageCalls, []);
  }
});

import { test as categoryBatchTest } from "node:test";
import * as categoryBatchAssert from "node:assert/strict";
import {
  createCatalogProductsGetHandler as createCategoryBatchHandler,
} from "./route-handler";

function createCategoryBatchFixture(
  options: {
    emptyCategory?: string;
    failedCategory?: string;
    malformedCategory?: string;
  } = {},
) {
  const organizationId =
    "11111111-1111-4111-8111-111111111111";

  const storeId =
    "22222222-2222-4222-8222-222222222222";

  const calls: Array<Record<string, unknown>> = [];

  let authCalls = 0;
  let clientCalls = 0;
  let concurrent = 0;
  let maxConcurrent = 0;

  const handler = createCategoryBatchHandler({
    resolveAccess: async () => {
      authCalls += 1;

      return {
        ok: true,
        organizationId,
        storeId,
        sessionUserId:
          "33333333-3333-4333-8333-333333333333",
      } as never;
    },

    createServiceClient: () => {
      clientCalls += 1;

      return {
        async rpc(
          fn: string,
          args: Record<string, unknown>,
        ) {
          categoryBatchAssert.equal(
            fn,
            "crm_search_catalog_products",
          );

          calls.push(args);
          concurrent += 1;

          maxConcurrent = Math.max(
            maxConcurrent,
            concurrent,
          );

          try {
            await Promise.resolve();

            const category = String(args.p_category);

            if (category === options.failedCategory) {
              return {
                data: null,
                error: { message: "PRIVATE_ERROR" },
              };
            }

            if (category === options.emptyCategory) {
              return { data: [], error: null };
            }

            const count =
              category === "piscinas" ? 101 : 1;

            return {
              error: null,
              data: Array.from(
                { length: count },
                (_, index) => ({
                  source_kind:
                    category === "piscinas"
                      ? "pool"
                      : "catalog_item",

                  source_id:
                    "44444444-4444-4444-8444-" +
                    String(index + 1).padStart(12, "0"),

                  name: `${category} ${index + 1}`,

                  sku:
                    category === "piscinas"
                      ? null
                      : `SKU-${index + 1}`,

                  category:
                    category === options.malformedCategory
                      ? "invalid_category"
                      : category,
                }),
              ),
            };
          } finally {
            concurrent -= 1;
          }
        },

        from() {
          throw new Error("UNEXPECTED_TABLE_QUERY");
        },

        storage: {
          from() {
            throw new Error("UNEXPECTED_PHOTO_QUERY");
          },
        },
      } as never;
    },
  });

  function request(
    overrides: Record<string, string> = {},
    omitted: string[] = [],
  ) {
    const params = new URLSearchParams({
      view: "categories",
      expectedOrganizationId: organizationId,
      expectedStoreId: storeId,
      ...overrides,
    });

    for (const key of omitted) {
      params.delete(key);
    }

    return new Request(
      `http://localhost/api/crm/catalog-products?${params}`,
    );
  }

  return {
    handler,
    request,
    calls,
    organizationId,
    storeId,
    authCalls: () => authCalls,
    clientCalls: () => clientCalls,
    maxConcurrent: () => maxConcurrent,
  };
}

categoryBatchTest(
  "category batch authorizes once and loads all four categories in parallel",
  async () => {
    const f = createCategoryBatchFixture();

    const response = await f.handler(f.request());
    const body = await response.json();

    categoryBatchAssert.equal(response.status, 200);
    categoryBatchAssert.equal(body.ok, true);
    categoryBatchAssert.equal(f.authCalls(), 1);
    categoryBatchAssert.equal(f.clientCalls(), 1);
    categoryBatchAssert.equal(f.calls.length, 4);
    categoryBatchAssert.equal(f.maxConcurrent(), 4);

    categoryBatchAssert.deepEqual(
      Object.keys(body.categories).sort(),
      ["acessorios", "outros", "piscinas", "quimicos"],
    );

    for (const call of f.calls) {
      categoryBatchAssert.equal(
        call.p_organization_id,
        f.organizationId,
      );

      categoryBatchAssert.equal(
        call.p_store_id,
        f.storeId,
      );

      categoryBatchAssert.equal(call.p_page, 0);
      categoryBatchAssert.equal(call.p_query, null);
    }

    for (const category of [
      "piscinas",
      "quimicos",
      "acessorios",
      "outros",
    ]) {
      const page = body.categories[category];

      categoryBatchAssert.equal(page.page, 0);
      categoryBatchAssert.equal(page.pageSize, 100);

      categoryBatchAssert.equal(
        page.products.length,
        category === "piscinas" ? 100 : 1,
      );

      categoryBatchAssert.equal(
        page.hasMore,
        category === "piscinas",
      );

      categoryBatchAssert.ok(
        page.products.every(
          (product: Record<string, unknown>) =>
            product.category === category,
        ),
      );
    }

    categoryBatchAssert.doesNotMatch(
      JSON.stringify(body),
      /previewUrl|storage_path|signedUrl/,
    );
  },
);

categoryBatchTest(
  "category batch preserves a valid empty category",
  async () => {
    const f = createCategoryBatchFixture({
      emptyCategory: "quimicos",
    });

    const response = await f.handler(f.request());
    const body = await response.json();

    categoryBatchAssert.equal(response.status, 200);

    categoryBatchAssert.deepEqual(
      body.categories.quimicos.products,
      [],
    );

    categoryBatchAssert.equal(
      body.categories.quimicos.hasMore,
      false,
    );

    categoryBatchAssert.equal(
      body.categories.acessorios.products.length,
      1,
    );
  },
);

categoryBatchTest(
  "category batch rejects wrong scope missing scope and invalid inputs",
  async () => {
    const f = createCategoryBatchFixture();

    const foreign = await f.handler(
      f.request({
        expectedStoreId:
          "99999999-9999-4999-8999-999999999999",
      }),
    );

    categoryBatchAssert.equal(foreign.status, 409);

    const missing = await f.handler(
      f.request({}, ["expectedStoreId"]),
    );

    categoryBatchAssert.equal(missing.status, 409);

    const invalid = await f.handler(
      f.request({ page: "1" }),
    );

    categoryBatchAssert.equal(invalid.status, 400);
    categoryBatchAssert.equal(f.calls.length, 0);
  },
);

categoryBatchTest(
  "category batch fails closed if any category RPC fails",
  async () => {
    const f = createCategoryBatchFixture({
      failedCategory: "acessorios",
    });

    const response = await f.handler(f.request());
    const body = await response.json();

    categoryBatchAssert.equal(response.status, 500);
    categoryBatchAssert.equal(body.ok, false);
    categoryBatchAssert.equal(f.calls.length, 4);

    categoryBatchAssert.equal(
      body.categories,
      undefined,
    );

    categoryBatchAssert.doesNotMatch(
      JSON.stringify(body),
      /PRIVATE_ERROR/,
    );
  },
);

categoryBatchTest(
  "category batch fails closed on malformed category data",
  async () => {
    const f = createCategoryBatchFixture({
      malformedCategory: "quimicos",
    });

    const response = await f.handler(f.request());
    const body = await response.json();

    categoryBatchAssert.equal(response.status, 500);
    categoryBatchAssert.equal(body.ok, false);
    categoryBatchAssert.equal(
      body.categories,
      undefined,
    );
  },
);

test("detail batch signs photos once for all four categories and preserves canonical order", async () => {
  for (const category of [
    "piscinas",
    "quimicos",
    "acessorios",
    "outros",
  ]) {
    const isPool = category === "piscinas";
    const id = isPool ? detailPoolId : detailItemId;

    const productTable = isPool
      ? "pools"
      : "store_catalog_items";

    const photoTable = isPool
      ? "pool_photos"
      : "store_catalog_item_photos";

    const bucket = isPool
      ? "pool-photos"
      : "store-catalog-photos";

    const relation = isPool
      ? { pool_id: id, ...detailScope }
      : { catalog_item_id: id };

    const client = createClient({
      [productTable]: [{
        ...detailScope,
        id,
        name: `Produto ${category}`,
        metadata: { categoria: category },
      }],

      [photoTable]: [
        {
          ...relation,
          id: "photo-2",
          storage_path: "valid/second.jpg",
          sort_order: 2,
        },
        {
          ...relation,
          id: "photo-1",
          storage_path: "valid/first.jpg",
          sort_order: 1,
        },
        {
          ...relation,
          id: "foreign-photo",
          ...(isPool
            ? { store_id: "foreign-store" }
            : { catalog_item_id: "foreign-product" }),
          storage_path: "foreign/private.jpg",
          sort_order: 0,
        },
      ],
    });

    const handler = createCatalogProductsGetHandler({
      resolveAccess: async () => granted,
      createServiceClient: () => client as never,
    });

    const response = await handler(
      detailRequest(
        isPool ? "pool" : "catalog_item",
        id,
      ),
    );

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.product.category, category);
    assert.equal(body.expiresInSeconds, 60);

    assert.equal(client.calls.length, 1);
    assert.equal(client.calls[0].table, productTable);

    assert.ok(
      client.calls[0].columns.includes(
        isPool
          ? "pool_photos!pool_photos_pool_id_fkey("
          : "store_catalog_item_photos!store_catalog_item_photos_catalog_item_id_fkey(",
      ),
    );

    assert.deepEqual(client.batchCalls, [{
      bucket,
      paths: ["valid/first.jpg", "valid/second.jpg"],
      expiresIn: 60,
    }]);

    assert.equal(client.storageCalls.length, 2);

    assert.deepEqual(body.product.photos, [
      {
        id: "photo-1",
        previewUrl: "https://signed.test/valid/first.jpg",
      },
      {
        id: "photo-2",
        previewUrl: "https://signed.test/valid/second.jpg",
      },
    ]);

    assert.doesNotMatch(
      JSON.stringify(body),
      /foreign\/private|storage_path/,
    );
  }
});

test("detail batch rejects incomplete duplicated foreign or failed signing results", async () => {
  for (const batchFault of [
    "missing",
    "duplicate",
    "foreign",
    "item_error",
    "empty_url",
    "invalid_url",
    "top_level_error",
  ]) {
    const client = createClient({
      store_catalog_items: [{
        ...detailScope,
        id: detailItemId,
        name: "Produto",
        metadata: { categoria: "quimicos" },
      }],

      store_catalog_item_photos: [
        {
          id: "photo-1",
          catalog_item_id: detailItemId,
          storage_path: "private/first.jpg",
          sort_order: 1,
        },
        {
          id: "photo-2",
          catalog_item_id: detailItemId,
          storage_path: "private/second.jpg",
          sort_order: 2,
        },
      ],
    }, {
      batchFault,
      signingError: batchFault === "top_level_error",
    });

    const handler = createCatalogProductsGetHandler({
      resolveAccess: async () => granted,
      createServiceClient: () => client as never,
    });

    const response = await handler(
      detailRequest("catalog_item", detailItemId),
    );

    const body = await response.json();

    assert.equal(response.status, 500, batchFault);
    assert.equal(body.ok, false);
    assert.equal(body.product, undefined);
    assert.equal(client.batchCalls.length, 1);

    assert.doesNotMatch(
      JSON.stringify(body),
      /private\/|private storage|private item|signed\.test/,
    );
  }
});

test("detail batch deduplicates storage paths without discarding photo identities", async () => {
  const client = createClient({
    pools: [{
      ...detailScope,
      id: detailPoolId,
      name: "Piscina",
    }],

    pool_photos: [
      {
        ...detailScope,
        id: "photo-1",
        pool_id: detailPoolId,
        storage_path: "shared/photo.jpg",
        sort_order: 1,
      },
      {
        ...detailScope,
        id: "photo-2",
        pool_id: detailPoolId,
        storage_path: "shared/photo.jpg",
        sort_order: 2,
      },
    ],
  });

  const handler = createCatalogProductsGetHandler({
    resolveAccess: async () => granted,
    createServiceClient: () => client as never,
  });

  const response = await handler(
    detailRequest("pool", detailPoolId),
  );

  const body = await response.json();

  assert.equal(response.status, 200);

  assert.deepEqual(client.batchCalls, [{
    bucket: "pool-photos",
    paths: ["shared/photo.jpg"],
    expiresIn: 60,
  }]);

  assert.deepEqual(body.product.photos, [
    {
      id: "photo-1",
      previewUrl: "https://signed.test/shared/photo.jpg",
    },
    {
      id: "photo-2",
      previewUrl: "https://signed.test/shared/photo.jpg",
    },
  ]);
});

test("detail rejects malformed embedded photo relationships before signing", async () => {
  for (const invalid of [
    null,
    undefined,
    {},
    "invalid",
    [null],
    ["invalid"],
    [[]],
  ]) {
    const client = createClient({
      pools: [{
        ...detailScope,
        id: detailPoolId,
        name: "Piscina",
        photo_url: "https://cdn.test/fallback.jpg",
        pool_photos: invalid,
      }],
    });

    const handler = createCatalogProductsGetHandler({
      resolveAccess: async () => granted,
      createServiceClient: () => client as never,
    });

    const response = await handler(
      detailRequest("pool", detailPoolId),
    );

    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(body.ok, false);
    assert.equal(body.product, undefined);
    assert.equal(client.calls.length, 1);
    assert.deepEqual(client.storageCalls, []);
    assert.deepEqual(client.batchCalls, []);
  }
});

test("detail preserves legacy HTTP fallback with a valid empty embedded relationship", async () => {
  const client = createClient({
    pools: [{
      ...detailScope,
      id: detailPoolId,
      name: "Piscina",
      photo_url: "https://cdn.test/pool.jpg",
    }],
    pool_photos: [],
  });

  const handler = createCatalogProductsGetHandler({
    resolveAccess: async () => granted,
    createServiceClient: () => client as never,
  });

  const response = await handler(
    detailRequest("pool", detailPoolId),
  );

  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(client.calls.length, 1);
  assert.deepEqual(client.storageCalls, []);
  assert.deepEqual(client.batchCalls, []);

  assert.deepEqual(body.product.photos, [{
    id: null,
    previewUrl: "https://cdn.test/pool.jpg",
  }]);
});
