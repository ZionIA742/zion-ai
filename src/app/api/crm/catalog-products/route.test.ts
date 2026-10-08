import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createCatalogProductsGetHandler } from "./route";

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

function createClient(data: Record<string, Row[]>, options: { lookupError?: boolean; signingError?: boolean } = {}) {
  const calls: Array<{ table: string; filters: Row[]; columns: string }> = [];
  const storageCalls: Array<{ bucket: string; path: string; expiresIn: number }> = [];
  const client = {
    calls,
    storageCalls,
    from(table: string) {
      const filters: Row[] = [];
      let columns = "";
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
        then(resolve: (value: unknown) => void) {
          calls.push({ table, filters: [...filters], columns });
          resolve({
            data: options.lookupError ? null : data[table] || [],
            error: options.lookupError ? { message: "internal database detail" } : null,
          });
        },
      };
      return builder;
    },
    storage: {
      from(bucket: string) {
        return {
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
    { sourceKind: "catalog_item", sourceId: "item-1", name: "Item Alpha", sku: "SKU-1", previewUrl: "https://signed.test/item/first.jpg" },
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
  assert.equal(body.products[2].previewUrl, "https://signed.test/item/first.jpg");
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
  const source = readFileSync(join(process.cwd(), "src/app/api/crm/catalog-products/route.ts"), "utf8");
  assert.doesNotMatch(source, /name\) \|\| ["'](Piscina|Produto)["']/);
  assert.match(source, /\.in\("pool_id", poolIds\)/);
  assert.match(source, /\.in\("catalog_item_id", itemIds\)/);
  assert.match(source, /compareNullableNumber/);
  assert.match(source, /compareNullableText/);
  assert.doesNotMatch(source, /Number\(null\)/);
  assert.match(source, /Nao foi possivel carregar o catalogo/);
});
