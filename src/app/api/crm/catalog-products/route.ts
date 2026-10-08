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

export function createCatalogProductsGetHandler(deps: Partial<CatalogProductsDeps> = {}) {
  const resolveAccess = deps.resolveAccess ?? resolveStoreApiAccess;
  const createService = deps.createServiceClient ?? createServiceClient;

  return async function GET() {
    const access = await resolveAccess({ requirement: "active" });
    if (!access.ok) return createStoreApiDeniedResponse(access);

    try {
      const supabase = createService();
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
        if (!photo && !fallback) continue;

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
        const photo = firstCatalogPhoto(itemPhotos, itemId);
        if (!photo) continue;
        const signed = await supabase.storage
          .from("store-catalog-photos")
          .createSignedUrl(text(photo.storage_path), PREVIEW_EXPIRATION_SECONDS);
        if (signed.error || !signed.data?.signedUrl) throw new Error("catalog_preview_failed");
        products.push({ sourceKind: "catalog_item", sourceId: itemId, name: text(item.name), sku: text(item.sku) || null, previewUrl: signed.data.signedUrl });
      }

      return response({ ok: true, products, expiresInSeconds: PREVIEW_EXPIRATION_SECONDS });
    } catch {
      return response({ ok: false, error: "CATALOG_PRODUCTS_FAILED", message: "Nao foi possivel carregar o catalogo." }, 500);
    }
  };
}

export const GET = createCatalogProductsGetHandler();
