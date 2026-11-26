import { withBackendDiagnosticRoute } from "../../../../lib/server/zion-admin-diagnostic-backend-next";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  resolveStoreApiAccess,
  type ResolveStoreApiAccessDeps,
  type StoreApiAccessDenied,
  type StoreApiAccessGranted,
} from "@/lib/server/store-api-access";
import { createStoreApiDeniedResponse } from "@/lib/server/store-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREVIEW_EXPIRATION_SECONDS = 60;

type CatalogProductsDeps = {
  resolveAccess: (params: {
    requirement: "active";
    deps?: Partial<ResolveStoreApiAccessDeps>;
  }) => Promise<StoreApiAccessGranted | StoreApiAccessDenied>;
  createServiceClient: () => ReturnType<typeof createClient>;
};

type CatalogRow = Record<string, unknown>;

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("service_role_unavailable");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function isHttpUrl(value: unknown) {
  return /^https?:\/\//i.test(text(value));
}

function compareNullableNumber(left: unknown, right: unknown) {
  const normalize = (value: unknown) => {
    if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
      return null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const leftNumber = normalize(left);
  const rightNumber = normalize(right);
  if (leftNumber === null && rightNumber === null) return 0;
  if (leftNumber === null) return 1;
  if (rightNumber === null) return -1;
  return leftNumber - rightNumber;
}

function compareNullableText(left: unknown, right: unknown) {
  const leftText = text(left);
  const rightText = text(right);
  if (!leftText && !rightText) return 0;
  if (!leftText) return 1;
  if (!rightText) return -1;
  return leftText.localeCompare(rightText);
}

function firstPoolPhoto(photos: CatalogRow[], poolId: string) {
  return photos
    .filter((photo) => text(photo.pool_id) === poolId && text(photo.storage_path))
    .sort((left, right) =>
      compareNullableNumber(left.sort_order, right.sort_order) ||
      text(left.id).localeCompare(text(right.id)),
    )[0] || null;
}

function firstCatalogPhoto(photos: CatalogRow[], itemId: string) {
  return photos
    .filter((photo) => text(photo.catalog_item_id) === itemId && text(photo.storage_path))
    .sort((left, right) =>
      compareNullableNumber(left.sort_order, right.sort_order) ||
      compareNullableText(left.created_at, right.created_at) ||
      text(left.id).localeCompare(text(right.id)),
    )[0] || null;
}

function normalizeDetailCategory(value: unknown) {
  if (value === "quimicos") return "quimicos";
  if (value === "acessorios") return "acessorios";
  return "outros";
}

function safeDetailNumber(value: unknown): number | null {
  if (
    typeof value !== "number" &&
    typeof value !== "string"
  ) return null;

  if (typeof value === "string" && !value.trim()) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) && number >= 0
    ? number
    : null;
}

function safeCatalogCharacteristics(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) return {};

  const metadata = value as CatalogRow;

  const allowedKeys = [
    "brand",
    "model",
    "material",
    "color",
    "dimensions",
    "width_cm",
    "height_cm",
    "length_cm",
    "weight_kg",
    "weight",
    "size",
    "size_details",
    "capacity",
    "unit_label",
    "application",
    "usage",
    "composition",
    "embalagem",
    "packaging",
    "dosage",
    "concentration",
    "compatibility",
    "function",
    "barcode",
  ];

  const result: CatalogRow = {};

  for (const key of allowedKeys) {
    const entry = metadata[key];

    if (typeof entry === "string" && entry.trim()) {
      result[key] = entry.trim();
    } else if (
      typeof entry === "number" &&
      Number.isFinite(entry)
    ) {
      result[key] = entry;
    }
  }

  return result;
}

export function createCatalogProductsGetHandler(deps: Partial<CatalogProductsDeps> = {}) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const createService = deps.createServiceClient ?? createServiceClient;

  return async function GET(request?: Request) {
    const access = await resolveAccess({ requirement: "active" });

    if (!access.ok) {
      return createStoreApiDeniedResponse(access);
    }

    try {
      const supabase = createService();

      const params = request
        ? new URL(request.url).searchParams
        : null;

      if (
        params &&
        (
          params.has("expectedOrganizationId") ||
          params.has("expectedStoreId")
        ) &&
        (
          params.get("expectedOrganizationId") !== access.organizationId ||
          params.get("expectedStoreId") !== access.storeId
        )
      ) {
        return response({
          ok: false,
          error: "CATALOG_STORE_SCOPE_MISMATCH",
        }, 409);
      }

      const searchPage = async (
        params: URLSearchParams,
      ) => {
        const rawQuery = params.get("q") ?? "";
        const query = rawQuery.trim();
        const category = params.get("category");
        const rawPage = params.get("page") ?? "0";

        if (
          params.get("expectedOrganizationId") !== access.organizationId ||
          params.get("expectedStoreId") !== access.storeId
        ) {
          return response({
            ok: false,
            error: "CATALOG_STORE_SCOPE_MISMATCH",
          }, 409);
        }

        if (
          rawQuery.length > 120 ||
          !/^\d{1,5}$/.test(rawPage) ||
          Number(rawPage) > 10000 ||
          (
            category !== null &&
            ![
              "piscinas",
              "quimicos",
              "acessorios",
              "outros",
            ].includes(category)
          )
        ) {
          return response({
            ok: false,
            error: "INVALID_CATALOG_SEARCH",
          }, 400);
        }

        const page = Number(rawPage);

        const searchResult = await supabase.rpc(
          "crm_search_catalog_products",
          {
            p_organization_id: access.organizationId,
            p_store_id: access.storeId,
            p_query: query || null,
            p_category: category,
            p_page: page,
          },
        );

        if (
          searchResult.error ||
          !Array.isArray(searchResult.data) ||
          searchResult.data.length > 101
        ) {
          throw new Error("catalog_search_failed");
        }

        const products: Array<{
          sourceKind: "pool" | "catalog_item";
          sourceId: string;
          name: string;
          sku: string | null;
          category: string;
        }> = [];

        const seen = new Set<string>();

        for (const raw of searchResult.data) {
          if (
            !raw ||
            typeof raw !== "object" ||
            Array.isArray(raw)
          ) {
            throw new Error("catalog_search_invalid_result");
          }

          const row = raw as CatalogRow;

          const sourceKind = row.source_kind;
          const sourceId = text(row.source_id);
          const name = text(row.name);
          const resultCategory = text(row.category);

          if (
            (
              sourceKind !== "pool" &&
              sourceKind !== "catalog_item"
            ) ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sourceId) ||
            !name ||
            (
              sourceKind === "pool"
                ? resultCategory !== "piscinas"
                : ![
                    "quimicos",
                    "acessorios",
                    "outros",
                  ].includes(resultCategory)
            ) ||
            (
              category !== null &&
              resultCategory !== category
            )
          ) {
            throw new Error("catalog_search_invalid_result");
          }

          const key = `${sourceKind}:${sourceId}`;

          if (seen.has(key)) {
            throw new Error("catalog_search_duplicate_result");
          }

          seen.add(key);

          products.push({
            sourceKind,
            sourceId,
            name,
            sku:
              sourceKind === "pool"
                ? null
                : text(row.sku) || null,
            category: resultCategory,
          });
        }

        return response({
          ok: true,
          products: products.slice(0, 100),
          page,
          pageSize: 100,
          hasMore: products.length > 100,
        });
      };

      if (params?.get("view") === "search") {
        return await searchPage(params);
      }

      if (params?.get("view") === "categories") {
        if (
          params.get("expectedOrganizationId") !== access.organizationId ||
          params.get("expectedStoreId") !== access.storeId
        ) {
          return response({
            ok: false,
            error: "CATALOG_STORE_SCOPE_MISMATCH",
          }, 409);
        }

        if (
          params.has("q") ||
          params.has("category") ||
          params.has("page")
        ) {
          return response({
            ok: false,
            error: "INVALID_CATALOG_BATCH_REQUEST",
          }, 400);
        }

        const categories = [
          "piscinas",
          "quimicos",
          "acessorios",
          "outros",
        ] as const;

        const results = await Promise.allSettled(
          categories.map(async (category) => {
            const categoryParams = new URLSearchParams({
              view: "search",
              category,
              page: "0",
              expectedOrganizationId: access.organizationId,
              expectedStoreId: access.storeId,
            });

            const pageResponse = await searchPage(categoryParams);

            const body = await pageResponse.json();

            if (
              !pageResponse.ok ||
              body?.ok !== true ||
              body.page !== 0 ||
              !Array.isArray(body.products) ||
              body.products.length > 100 ||
              typeof body.hasMore !== "boolean"
            ) {
              throw new Error("catalog_category_batch_failed");
            }

            return [
              category,
              {
                products: body.products,
                page: 0,
                pageSize: 100,
                hasMore: body.hasMore,
              },
            ] as const;
          }),
        );

        const entries = results.map((result) => {
          if (result.status !== "fulfilled") {
            throw new Error("catalog_category_batch_failed");
          }

          return result.value;
        });

        return response({
          ok: true,
          categories: Object.fromEntries(entries),
        });
      }

      if (params?.get("view") === "list") {
        const rawPage = params.get("page") ?? "0";

        if (
          !/^\d{1,5}$/.test(rawPage) ||
          Number(rawPage) > 10000
        ) {
          return response({
            ok: false,
            error: "INVALID_CATALOG_PAGE",
          }, 400);
        }

        const page = Number(rawPage);
        const pageSize = 100;
        const offset = page * pageSize;

        const [poolPage, itemPage] = await Promise.all([
          supabase
            .from("pools")
            .select("id, name")
            .eq("organization_id", access.organizationId)
            .eq("store_id", access.storeId)
            .eq("is_active", true)
            .order("name", { ascending: true })
            .order("id", { ascending: true })
            .range(offset, offset + pageSize),

          supabase
            .from("store_catalog_items")
            .select("id, name, sku, metadata")
            .eq("organization_id", access.organizationId)
            .eq("store_id", access.storeId)
            .eq("is_active", true)
            .order("name", { ascending: true })
            .order("id", { ascending: true })
            .range(offset, offset + pageSize),
        ]);

        if (poolPage.error || itemPage.error) {
          throw new Error("catalog_lookup_failed");
        }

        const poolRows =
          (poolPage.data || []) as CatalogRow[];

        const itemRows =
          (itemPage.data || []) as CatalogRow[];

        const pools = poolRows
          .slice(0, pageSize)
          .filter((row) => text(row.id) && text(row.name))
          .map((row) => ({
            sourceKind: "pool",
            sourceId: text(row.id),
            name: text(row.name),
            sku: null,
            category: "piscinas",
          }));

        const items = itemRows
          .slice(0, pageSize)
          .filter((row) => text(row.id) && text(row.name))
          .map((row) => {
            const metadata =
              row.metadata &&
              typeof row.metadata === "object" &&
              !Array.isArray(row.metadata)
                ? row.metadata as CatalogRow
                : {};

            return {
              sourceKind: "catalog_item",
              sourceId: text(row.id),
              name: text(row.name),
              sku: text(row.sku) || null,
              category:
                typeof metadata.categoria === "string"
                  ? metadata.categoria.trim() || null
                  : null,
            };
          });

        return response({
          ok: true,
          products: [...pools, ...items],
          page,
          pageSizePerSource: pageSize,
          hasMore: {
            pools: poolRows.length > pageSize,
            items: itemRows.length > pageSize,
          },
        });
      }

      if (params?.get("view") === "detail") {
        const sourceKind = params.get("sourceKind");
        const sourceId = params.get("sourceId") || "";

        const validId =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sourceId);

        if (
          !validId ||
          (
            sourceKind !== "pool" &&
            sourceKind !== "catalog_item"
          )
        ) {
          return response({
            ok: false,
            error: "INVALID_CATALOG_PRODUCT",
          }, 400);
        }

        const isPool = sourceKind === "pool";

        const lookup = isPool
          ? await supabase
              .from("pools")
              .select("id, organization_id, store_id, is_active, name, description, width_m, length_m, depth_m, material, shape, max_capacity_l, weight_kg, price, price_status, stock_status, stock_quantity, track_stock, photo_url, pool_photos!pool_photos_pool_id_fkey(id, pool_id, organization_id, store_id, storage_path, sort_order)")
              .eq("pool_photos.organization_id", access.organizationId)
              .eq("pool_photos.store_id", access.storeId)
              .eq("organization_id", access.organizationId)
              .eq("store_id", access.storeId)
              .eq("is_active", true)
              .eq("id", sourceId)
              .range(0, 1)
          : await supabase
              .from("store_catalog_items")
              .select("id, organization_id, store_id, is_active, name, sku, description, price_cents, price_status, currency, stock_status, stock_quantity, track_stock, metadata, store_catalog_item_photos!store_catalog_item_photos_catalog_item_id_fkey(id, catalog_item_id, storage_path, sort_order, created_at)")
              .eq("organization_id", access.organizationId)
              .eq("store_id", access.storeId)
              .eq("is_active", true)
              .eq("id", sourceId)
              .range(0, 1);

        if (lookup.error) {
          throw new Error("catalog_detail_lookup_failed");
        }

        const rows = (lookup.data || []) as CatalogRow[];

        const row = rows.length === 1 ? rows[0] : null;

        if (
          !row ||
          text(row.id).toLowerCase() !== sourceId.toLowerCase() ||
          row.organization_id !== access.organizationId ||
          row.store_id !== access.storeId ||
          row.is_active !== true ||
          !text(row.name)
        ) {
          return response({
            ok: false,
            error: "CATALOG_PRODUCT_NOT_FOUND",
          }, 404);
        }

        const productId = text(row.id);

        const embeddedPhotos = isPool
          ? row.pool_photos
          : row.store_catalog_item_photos;

        if (
          !Array.isArray(embeddedPhotos) ||
          embeddedPhotos.some(
            (photo) =>
              !photo ||
              typeof photo !== "object" ||
              Array.isArray(photo),
          )
        ) {
          throw new Error("catalog_detail_photo_contract_invalid");
        }

        const photos = (embeddedPhotos as CatalogRow[])
          .filter((photo) => {
            if (!text(photo.id) || !text(photo.storage_path)) {
              return false;
            }

            if (isPool) {
              return (
                photo.pool_id === productId &&
                photo.organization_id === access.organizationId &&
                photo.store_id === access.storeId
              );
            }

            return photo.catalog_item_id === productId;
          })
          .sort((left, right) =>
            compareNullableNumber(
              left.sort_order,
              right.sort_order,
            ) ||
            (
              isPool
                ? 0
                : compareNullableText(
                    left.created_at,
                    right.created_at,
                  )
            ) ||
            text(left.id).localeCompare(text(right.id)),
          );

        const previews: Array<{
          id: string | null;
          previewUrl: string;
        }> = [];

        const bucket = isPool
          ? "pool-photos"
          : "store-catalog-photos";

        if (photos.length === 1) {
          const photo = photos[0];

          const signed = await supabase.storage
            .from(bucket)
            .createSignedUrl(
              text(photo.storage_path),
              PREVIEW_EXPIRATION_SECONDS,
            );

          if (
            signed.error ||
            !signed.data?.signedUrl ||
            !isHttpUrl(signed.data.signedUrl)
          ) {
            throw new Error("catalog_detail_preview_failed");
          }

          previews.push({
            id: text(photo.id),
            previewUrl: signed.data.signedUrl,
          });
        } else if (photos.length > 1) {
          const paths = Array.from(
            new Set(
              photos.map((photo) => text(photo.storage_path)),
            ),
          );

          const expectedPaths = new Set(paths);

          const signed = await supabase.storage
            .from(bucket)
            .createSignedUrls(
              paths,
              PREVIEW_EXPIRATION_SECONDS,
            );

          if (
            signed.error ||
            !Array.isArray(signed.data) ||
            signed.data.length !== paths.length
          ) {
            throw new Error("catalog_detail_preview_failed");
          }

          const urlsByPath = new Map<string, string>();

          for (const entry of signed.data) {
            if (
              !entry ||
              entry.error !== null ||
              typeof entry.path !== "string" ||
              !expectedPaths.has(entry.path) ||
              urlsByPath.has(entry.path) ||
              typeof entry.signedUrl !== "string" ||
              !isHttpUrl(entry.signedUrl)
            ) {
              throw new Error("catalog_detail_preview_failed");
            }

            urlsByPath.set(
              entry.path,
              entry.signedUrl,
            );
          }

          for (const photo of photos) {
            const previewUrl = urlsByPath.get(
              text(photo.storage_path),
            );

            if (!previewUrl) {
              throw new Error("catalog_detail_preview_failed");
            }

            previews.push({
              id: text(photo.id),
              previewUrl,
            });
          }
        }

        if (
          isPool &&
          previews.length === 0 &&
          isHttpUrl(row.photo_url)
        ) {
          previews.push({
            id: null,
            previewUrl: text(row.photo_url),
          });
        }

        const metadata =
          row.metadata &&
          typeof row.metadata === "object" &&
          !Array.isArray(row.metadata)
            ? row.metadata as CatalogRow
            : {};

        const rawPrice = safeDetailNumber(
          isPool ? row.price : row.price_cents,
        );

        const price =
          row.price_status === "valid" &&
          rawPrice !== null &&
          rawPrice > 0 &&
          (isPool || Number.isSafeInteger(rawPrice))
            ? {
                amount: isPool ? rawPrice : rawPrice / 100,
                currency: isPool
                  ? "BRL"
                  : text(row.currency) || null,
              }
            : null;

        const characteristics = isPool
          ? {
              width_m: safeDetailNumber(row.width_m),
              length_m: safeDetailNumber(row.length_m),
              depth_m: safeDetailNumber(row.depth_m),
              max_capacity_l: safeDetailNumber(row.max_capacity_l),
              weight_kg: safeDetailNumber(row.weight_kg),
              material: text(row.material) || null,
              shape: text(row.shape) || null,
            }
          : safeCatalogCharacteristics(metadata);

        return response({
          ok: true,
          product: {
            sourceKind,
            sourceId: productId,
            name: text(row.name),
            sku: isPool ? null : text(row.sku) || null,
            category: isPool
              ? "piscinas"
              : normalizeDetailCategory(metadata.categoria),
            description: text(row.description) || null,
            price,
            priceStatus: text(row.price_status) || null,
            stockStatus: text(row.stock_status) || null,
            stockQuantity:
              row.track_stock === true
                ? safeDetailNumber(row.stock_quantity)
                : null,
            characteristics,
            photos: previews,
          },
          expiresInSeconds: PREVIEW_EXPIRATION_SECONDS,
        });
      }

      const [poolResult, itemResult] = await Promise.all([
        supabase
          .from("pools")
          .select("id, name, is_active, photo_url")
          .eq("organization_id", access.organizationId)
          .eq("store_id", access.storeId)
          .eq("is_active", true),
        supabase
          .from("store_catalog_items")
          .select("id, name, sku, is_active")
          .eq("organization_id", access.organizationId)
          .eq("store_id", access.storeId)
          .eq("is_active", true),
      ]);
      if (poolResult.error || itemResult.error) throw new Error("catalog_lookup_failed");

      const pools = (poolResult.data || []) as CatalogRow[];
      const items = (itemResult.data || []) as CatalogRow[];
      const namedPools = pools.filter((pool) => text(pool.name));
      const namedItems = items.filter((item) => text(item.name));
      const poolIds = namedPools.map((pool) => text(pool.id)).filter(Boolean);
      const itemIds = namedItems.map((item) => text(item.id)).filter(Boolean);

      const poolPhotosResult = poolIds.length
        ? await supabase
            .from("pool_photos")
            .select("id, pool_id, organization_id, store_id, storage_path, sort_order")
            .eq("organization_id", access.organizationId)
            .eq("store_id", access.storeId)
            .in("pool_id", poolIds)
        : { data: [], error: null };
      const itemPhotosResult = itemIds.length
        ? await supabase
            .from("store_catalog_item_photos")
            .select("id, catalog_item_id, storage_path, sort_order, created_at")
            .in("catalog_item_id", itemIds)
        : { data: [], error: null };
      if (poolPhotosResult.error || itemPhotosResult.error) throw new Error("catalog_photo_lookup_failed");

      const poolPhotos = (poolPhotosResult.data || []) as CatalogRow[];
      const itemPhotos = (itemPhotosResult.data || []) as CatalogRow[];
      const products: CatalogRow[] = [];

      for (const pool of namedPools) {
        const poolId = text(pool.id);
        const photo = firstPoolPhoto(poolPhotos, poolId);
        const fallback = isHttpUrl(pool.photo_url) ? text(pool.photo_url) : null;
        if (!poolId) continue;

        let previewUrl = fallback;
        if (photo) {
          const signed = await supabase.storage
            .from("pool-photos")
            .createSignedUrl(text(photo.storage_path), PREVIEW_EXPIRATION_SECONDS);
          if (signed.error || !signed.data?.signedUrl) throw new Error("catalog_preview_failed");
          previewUrl = signed.data.signedUrl;
        }
        products.push({ sourceKind: "pool", sourceId: poolId, name: text(pool.name), sku: null, previewUrl });
      }

      for (const item of namedItems) {
        const itemId = text(item.id);
        if (!itemId) continue;
        const photo = firstCatalogPhoto(itemPhotos, itemId);

        let previewUrl: string | null = null;

        if (photo) {
          const signed = await supabase.storage
            .from("store-catalog-photos")
            .createSignedUrl(text(photo.storage_path), PREVIEW_EXPIRATION_SECONDS);

          if (signed.error || !signed.data?.signedUrl) {
            throw new Error("catalog_preview_failed");
          }

          previewUrl = signed.data.signedUrl;
        }

        products.push({
          sourceKind: "catalog_item",
          sourceId: itemId,
          name: text(item.name),
          sku: text(item.sku) || null,
          previewUrl,
        });
      }

      return response({ ok: true, products, expiresInSeconds: PREVIEW_EXPIRATION_SECONDS });
    } catch {
      return response({ ok: false, error: "CATALOG_PRODUCTS_FAILED", message: "Nao foi possivel carregar o catalogo." }, 500);
    }
  };
}

const zionBackendOriginalGET = createCatalogProductsGetHandler();

const zionBackendObservedGET = withBackendDiagnosticRoute(
  "/api/crm/catalog-products",
  "GET",
  (zionRequest?: Request) => zionBackendOriginalGET(zionRequest),
);

export const GET: typeof zionBackendOriginalGET = async function GET(request?: Request) {
  return zionBackendObservedGET(request);
};
