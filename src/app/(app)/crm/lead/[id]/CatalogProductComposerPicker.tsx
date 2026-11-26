"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStoreContext } from "@/components/StoreProvider";
import type { CatalogCommercialProduct } from "./catalog-commercial-message";

export type CatalogComposerProduct = {
  sourceKind: "pool" | "catalog_item";
  sourceId: string;
  name: string;
  sku?: string | null;
  previewUrl: string;
  commercialDetails: CatalogCommercialProduct;
};

type Category =
  | "piscinas"
  | "quimicos"
  | "acessorios"
  | "outros";

type ListedProduct = {
  sourceKind: "pool" | "catalog_item";
  sourceId: string;
  name: string;
  sku: string | null;
  category: string | null;
};

type ProductDetail = ListedProduct & {
  description: string | null;
  price: {
    amount: number;
    currency: string | null;
  } | null;
  priceStatus: string | null;
  stockStatus: string | null;
  stockQuantity: number | null;
  characteristics: Record<string, string | number | null>;
  photos: Array<{
    id: string | null;
    previewUrl: string;
  }>;
};

type PickerProps = {
  open: boolean;
  onSelect: (product: CatalogComposerProduct) => void;
  onClose: () => void;
};

const CATEGORIES: Array<{
  id: Category;
  label: string;
}> = [
  { id: "piscinas", label: "Piscinas" },
  { id: "quimicos", label: "Produtos químicos" },
  { id: "acessorios", label: "Acessórios" },
  { id: "outros", label: "Outros" },
];

const CHARACTERISTIC_LABELS: Record<string, string> = {
  brand: "Marca",
  model: "Modelo",
  material: "Material",
  shape: "Formato",
  color: "Cor",
  dimensions: "Dimensoes",
  width_m: "Largura (m)",
  length_m: "Comprimento (m)",
  depth_m: "Profundidade (m)",
  max_capacity_l: "Capacidade (L)",
  width_cm: "Largura (cm)",
  height_cm: "Altura (cm)",
  length_cm: "Comprimento (cm)",
  weight_kg: "Peso (kg)",
  weight: "Peso",
  size: "Tamanho",
  size_details: "Detalhes do tamanho",
  capacity: "Capacidade",
  unit_label: "Unidade",
  application: "Aplicacao",
  usage: "Uso",
  composition: "Composicao",
  embalagem: "Embalagem",
  packaging: "Embalagem",
  dosage: "Dosagem",
  concentration: "Concentracao",
  compatibility: "Compatibilidade",
  function: "Funcao",
  barcode: "Codigo de barras",
};

function normalizeCategory(product: ListedProduct): Category {
  if (product.sourceKind === "pool") return "piscinas";
  if (product.category === "quimicos") return "quimicos";
  if (product.category === "acessorios") return "acessorios";
  return "outros";
}

function categoryLabel(category: Category) {
  return CATEGORIES.find((entry) => entry.id === category)?.label || "";
}

function CategoryIcon({ category }: { category: Category }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-6 w-6 sm:h-8 sm:w-8"
      aria-hidden="true"
    >
      {category === "piscinas" ? (
        <>
          <path d="M3 12c3-4 6 4 9 0s6 4 9 0" />
          <path d="M3 18c3-4 6 4 9 0s6 4 9 0" />
          <path d="M7 9V4h6v5M7 7h6" />
        </>
      ) : category === "quimicos" ? (
        <>
          <path d="M9 3h6M10 3v7l-6 9a1 1 0 001 2h14a1 1 0 001-2l-6-9V3" />
          <path d="M7 15h10" />
        </>
      ) : category === "acessorios" ? (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v4m0 12v4M2 12h4m12 0h4M5 5l3 3m8 8 3 3M5 19l3-3m8-8 3-3" />
        </>
      ) : (
        <>
          <path d="M3 7l9-4 9 4v10l-9 4-9-4V7z" />
          <path d="M3 7l9 5 9-5M12 12v9" />
        </>
      )}
    </svg>
  );
}

function formatPrice(price: ProductDetail["price"]) {
  if (!price || !price.currency) return null;

  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: price.currency,
    }).format(price.amount);
  } catch {
    return null;
  }
}

type CatalogStoreScope = {
  organizationId: string;
  storeId: string;
  name: string;
};

type CatalogScreenProps = Omit<PickerProps, "open"> & {
  scope: CatalogStoreScope;
};

function CatalogScreen(props: CatalogScreenProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  const { organizationId, storeId } = props.scope;

  const authorityBlockedRef = useRef(false);
  const [authorityBlocked, setAuthorityBlocked] = useState(false);

  function isCatalogAuthorityDenied(status: number) {
    return [401, 403, 409, 503].includes(status);
  }

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    fetch("/api/store-branding/logo", {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();

        if (cancelled || authorityBlockedRef.current) return;

        if (
          !response.ok ||
          result?.ok !== true ||
          result.branding?.organization_id !== organizationId ||
          result.branding?.store_id !== storeId ||
          typeof result.signedUrl !== "string" ||
          !/^https?:\/\//i.test(result.signedUrl)
        ) {
          setLogoUrl(null);
          return;
        }

        setLogoUrl(result.signedUrl);
      })
      .catch(() => {
        if (!cancelled) setLogoUrl(null);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [organizationId, storeId]);

  const [category, setCategory] =
    useState<Category | null>(null);

  const [products, setProducts] =
    useState<ListedProduct[]>([]);

  const [searchText, setSearchText] = useState("");
  const listRevision = useRef(0);

  type CategoryBatchPage = {
    ok: true;
    products: ListedProduct[];
    page: 0;
    pageSize: 100;
    hasMore: boolean;
  };

  type CategoryBatch = Record<Category, CategoryBatchPage>;

  const CATEGORY_BATCH_TTL_MS = 30_000;

  const categoryBatchRef = useRef<{
    startedAt: number;
    promise: Promise<CategoryBatch | null>;
  } | null>(null);

  const SEARCH_CACHE_TTL_MS = 30_000;
  const SEARCH_CACHE_MAX_ENTRIES = 20;

  const searchPageCacheRef = useRef(
    new Map<string, {
      result: {
        ok: true;
        products: ListedProduct[];
        page: number;
        pageSize: 100;
        hasMore: boolean;
      };
      expiresAt: number;
    }>(),
  );

  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listAttempt, setListAttempt] = useState(0);

  const [selection, setSelection] =
    useState<ListedProduct | null>(null);

  const [detail, setDetail] =
    useState<ProductDetail | null>(null);

  const [detailLoading, setDetailLoading] = useState(false);

  const [detailError, setDetailError] =
    useState<string | null>(null);

  const [detailAttempt, setDetailAttempt] = useState(0);

  const DETAIL_CACHE_TTL_MS = 30_000;
  const DETAIL_CACHE_MAX_ENTRIES = 20;
  const DETAIL_URL_SAFETY_MARGIN_MS = 5_000;

  const detailRevision = useRef(0);

  const detailCacheRef = useRef(
    new Map<string, {
      product: ProductDetail;
      expiresAt: number;
    }>(),
  );

  function blockCatalogAccess() {
    if (authorityBlockedRef.current) return;

    authorityBlockedRef.current = true;

    listRevision.current += 1;
    detailRevision.current += 1;

    categoryBatchRef.current = null;
    detailCacheRef.current.clear();
    searchPageCacheRef.current.clear();

    setProducts([]);
    setSelection(null);
    setDetail(null);
    setLogoUrl(null);
    setCategory(null);
    setSearchText("");
    setHasMore(false);
    setPage(0);
    setLoading(false);
    setDetailLoading(false);
    setError(null);
    setDetailError(null);

    setAuthorityBlocked(true);
  }

  function detailCacheKey(product: ListedProduct) {
    return JSON.stringify([
      organizationId,
      storeId,
      product.sourceKind,
      product.sourceId,
    ]);
  }

  useEffect(() => {
    const searchCache = searchPageCacheRef.current;
    const cache = detailCacheRef.current;

    return () => {
      cache.clear();
      searchCache.clear();
    };
  }, [organizationId, storeId]);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) return;

    dialog.showModal();

    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    if (authorityBlocked) return;

    const controller = new AbortController();
    let cancelled = false;

    const startedAt = Date.now();

    const params = new URLSearchParams({
      view: "categories",
      expectedOrganizationId: organizationId,
      expectedStoreId: storeId,
    });

    const promise = (async (): Promise<CategoryBatch | null> => {
      try {
        const response = await fetch(
          `/api/crm/catalog-products?${params}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );

        if (
          !cancelled &&
          isCatalogAuthorityDenied(response.status)
        ) {
          blockCatalogAccess();
          return null;
        }

        const result = await response.json();

        if (
          cancelled ||
          authorityBlockedRef.current ||
          !response.ok ||
          result?.ok !== true ||
          !result.categories ||
          typeof result.categories !== "object" ||
          Object.keys(result.categories).length !== 4
        ) {
          return null;
        }

        const pages = {} as CategoryBatch;

        for (const entry of CATEGORIES) {
          const page = result.categories[entry.id];

          if (
            !page ||
            page.page !== 0 ||
            page.pageSize !== 100 ||
            typeof page.hasMore !== "boolean" ||
            !Array.isArray(page.products) ||
            page.products.length > 100
          ) {
            return null;
          }

          const ids = new Set<string>();

          for (const product of page.products) {
            if (
              !product ||
              product.category !== entry.id ||
              typeof product.sourceId !== "string" ||
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                product.sourceId,
              ) ||
              typeof product.name !== "string" ||
              !product.name.trim() ||
              !(
                product.sku === null ||
                typeof product.sku === "string"
              ) ||
              product.sourceKind !== (
                entry.id === "piscinas"
                  ? "pool"
                  : "catalog_item"
              ) ||
              !Object.keys(product).every((key) =>
                [
                  "sourceKind",
                  "sourceId",
                  "name",
                  "sku",
                  "category",
                ].includes(key),
              )
            ) {
              return null;
            }

            const key =
              `${product.sourceKind}:${product.sourceId}`;

            if (ids.has(key)) return null;

            ids.add(key);
          }

          pages[entry.id] = {
            ok: true,
            products: page.products,
            page: 0,
            pageSize: 100,
            hasMore: page.hasMore,
          };
        }

        return cancelled || authorityBlockedRef.current ? null : pages;
      } catch {
        return null;
      }
    })();

    const batch = { startedAt, promise };

    categoryBatchRef.current = batch;

    void promise.then((pages) => {
      if (
        !pages &&
        categoryBatchRef.current === batch
      ) {
        categoryBatchRef.current = null;
      }
    });

    return () => {
      cancelled = true;
      controller.abort();

      if (categoryBatchRef.current === batch) {
        categoryBatchRef.current = null;
      }
    };
  }, [organizationId, storeId, authorityBlocked]);

  useEffect(() => {
    if (authorityBlocked) return;

    const query = searchText.trim();

    if (!category && !query) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const revision = listRevision.current;
    let cancelled = false;

    const isCurrent = () =>
      !cancelled &&
      revision === listRevision.current && !authorityBlockedRef.current;

    const params = new URLSearchParams({
      view: "search",
      page: String(page),
      expectedOrganizationId: organizationId,
      expectedStoreId: storeId,
    });

    if (query) {
      params.set("q", query);
    }

    if (category) {
      params.set("category", category);
    }

    const listCache = searchPageCacheRef.current;
    const cacheKey = params.toString();
    const cacheNow = performance.now();

    for (const [entryKey, entry] of listCache) {
      if (entry.expiresAt <= cacheNow) {
        listCache.delete(entryKey);
      }
    }

    const cachedPage = listCache.get(cacheKey);

    const cachedPageUsable =
      cachedPage !== undefined &&
      cachedPage.expiresAt > cacheNow;

    const timer = window.setTimeout(async () => {
      try {
        if (!isCurrent()) return;

        let result: {
          ok?: boolean;
          products?: unknown;
          page?: number;
          pageSize?: number;
          hasMore?: boolean;
        } | null = null;

        if (
          cachedPage &&
          listCache.get(cacheKey) === cachedPage &&
          cachedPage.expiresAt > performance.now()
        ) {
          listCache.delete(cacheKey);
          listCache.set(cacheKey, cachedPage);
          result = cachedPage.result;
        }

        let responseOk = true;
        let fetchedDirectly = false;
        const requestStartedAt = performance.now();

        const batch = categoryBatchRef.current;

        if (
          !result &&
          !query &&
          category &&
          page === 0 &&
          batch &&
          Date.now() - batch.startedAt < CATEGORY_BATCH_TTL_MS
        ) {
          const pages = await batch.promise;

          if (!isCurrent()) return;

          if (
            pages &&
            categoryBatchRef.current === batch &&
            Date.now() - batch.startedAt < CATEGORY_BATCH_TTL_MS
          ) {
            result = pages[category];
          }
        }

        if (!result) {
          const response = await fetch(
            `/api/crm/catalog-products?${params}`,
            {
              cache: "no-store",
              signal: controller.signal,
            },
          );

          if (
            !cancelled &&
            isCatalogAuthorityDenied(response.status)
          ) {
            blockCatalogAccess();
            return;
          }

          result = await response.json();
          responseOk = response.ok;
          fetchedDirectly = true;
        }

        if (
          !responseOk ||
          result?.ok !== true ||
          !Array.isArray(result.products) ||
          result.products.length > 100 ||
          result.page !== page ||
          result.pageSize !== 100 ||
          typeof result.hasMore !== "boolean"
        ) {
          throw new Error("catalog_search_failed");
        }

        if (!isCurrent()) return;

        const seen = new Set<string>();

        for (const product of result.products) {
          if (
            !product ||
            typeof product !== "object" ||
            Array.isArray(product) ||
            !CATEGORIES.some(
              (entry) => entry.id === product.category,
            ) ||
            (category && product.category !== category) ||
            product.sourceKind !== (
              product.category === "piscinas"
                ? "pool"
                : "catalog_item"
            ) ||
            typeof product.sourceId !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              product.sourceId,
            ) ||
            typeof product.name !== "string" ||
            !product.name.trim() ||
            !(
              product.sku === null ||
              typeof product.sku === "string"
            ) ||
            !Object.keys(product).every((key) =>
              [
                "sourceKind",
                "sourceId",
                "name",
                "sku",
                "category",
              ].includes(key),
            )
          ) {
            throw new Error("catalog_search_contract_invalid");
          }

          const identity =
            `${product.sourceKind}:${product.sourceId.toLowerCase()}`;

          if (seen.has(identity)) {
            throw new Error("catalog_search_contract_invalid");
          }

          seen.add(identity);
        }

        const expiresAt =
          requestStartedAt + SEARCH_CACHE_TTL_MS;

        // Nunca renovar a validade de dados vindos do cache
        // ou do carregamento agrupado anterior.
        if (
          fetchedDirectly &&
          isCurrent() &&
          expiresAt > performance.now()
        ) {
          listCache.delete(cacheKey);

          while (listCache.size >= SEARCH_CACHE_MAX_ENTRIES) {
            const oldestKey = listCache.keys().next().value;

            if (oldestKey === undefined) break;

            listCache.delete(oldestKey);
          }

          listCache.set(cacheKey, {
            result: {
              ok: true,
              products: result.products as ListedProduct[],
              page,
              pageSize: 100,
              hasMore: result.hasMore,
            },
            expiresAt,
          });
        }

        setProducts((previous) => {
          const merged = new Map<string, ListedProduct>();

          for (const product of page === 0 ? [] : previous) {
            merged.set(
              `${product.sourceKind}:${product.sourceId}`,
              product,
            );
          }

          for (const product of result.products as ListedProduct[]) {
            merged.set(
              `${product.sourceKind}:${product.sourceId}`,
              product,
            );
          }

          return Array.from(merged.values());
        });

        setHasMore(result.hasMore);
        setError(null);
      } catch {
        if (isCurrent()) {
          setError("N\u00e3o foi poss\u00edvel pesquisar os produtos.");
        }
      } finally {
        if (isCurrent()) {
          setLoading(false);
        }
      }
    }, cachedPageUsable ? 0 : query && page === 0 ? 400 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    page,
    listAttempt,
    organizationId,
    storeId,
    category,
    searchText,
    authorityBlocked,
  ]);

  useEffect(() => {
    if (!selection || authorityBlocked) return;

    const controller = new AbortController();
    const revision = detailRevision.current;
    let cancelled = false;

    const isCurrent = () =>
      !cancelled &&
      revision === detailRevision.current && !authorityBlockedRef.current;

    const cache = detailCacheRef.current;
    const key = detailCacheKey(selection);
    const now = performance.now();

    for (const [entryKey, entry] of cache) {
      if (entry.expiresAt <= now) {
        cache.delete(entryKey);
      }
    }

    const cached = cache.get(key);

    if (cached && cached.expiresAt > now) {
      // Atualizar a ordem de uso sem prolongar a validade.
      cache.delete(key);
      cache.set(key, cached);

      if (isCurrent()) {
        setDetail(cached.product);
        setDetailError(null);
        setDetailLoading(false);
      }

      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    const params = new URLSearchParams({
      view: "detail",
      sourceKind: selection.sourceKind,
      sourceId: selection.sourceId,
      expectedOrganizationId: organizationId,
      expectedStoreId: storeId,
    });

    const requestStartedAt = performance.now();

    fetch(`/api/crm/catalog-products?${params}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (
          !cancelled &&
          isCatalogAuthorityDenied(response.status)
        ) {
          blockCatalogAccess();
          return;
        }

        if (!isCurrent()) return;

        if (!response.ok) {
          cache.clear();

          throw new Error("catalog_detail_failed");
        }

        const result = await response.json();

        if (!isCurrent()) return;

        if (
          result?.ok !== true ||
          result.product?.sourceKind !== selection.sourceKind ||
          result.product?.sourceId !== selection.sourceId ||
          typeof result.product?.name !== "string" ||
          !result.product.name.trim() ||
          !Array.isArray(result.product?.photos) ||
          !result.product.photos.every(
            (photo: ProductDetail["photos"][number]) =>
              photo &&
              typeof photo.previewUrl === "string" &&
              /^https?:\/\//i.test(photo.previewUrl),
          ) ||
          result.expiresInSeconds !== 60
        ) {
          cache.clear();
          throw new Error("catalog_detail_failed");
        }

        const product = result.product as ProductDetail;

        const expiresAt = requestStartedAt + Math.min(
          DETAIL_CACHE_TTL_MS,
          result.expiresInSeconds * 1000 -
            DETAIL_URL_SAFETY_MARGIN_MS,
        );

        if (expiresAt > performance.now()) {
          cache.delete(key);

          while (cache.size >= DETAIL_CACHE_MAX_ENTRIES) {
            const oldestKey = cache.keys().next().value;

            if (oldestKey === undefined) break;

            cache.delete(oldestKey);
          }

          cache.set(key, {
            product,
            expiresAt,
          });
        }

        if (isCurrent()) {
          setDetail(product);
        }
      })
      .catch(() => {
        if (isCurrent()) {
          cache.clear();

          setDetailError(
            "Não foi possível carregar os detalhes do produto.",
          );
        }
      })
      .finally(() => {
        if (isCurrent()) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selection, detailAttempt, organizationId, storeId, authorityBlocked]);

  function resetCatalogList(
    nextCategory: Category | null,
    nextSearch: string,
  ) {
    if (authorityBlockedRef.current) return;

    listRevision.current += 1;

    returnToList();

    setCategory(nextCategory);
    setSearchText(nextSearch);
    setProducts([]);
    setPage(0);
    setHasMore(false);
    setError(null);
    setLoading(Boolean(nextCategory || nextSearch.trim()));
    setListAttempt((value) => value + 1);
  }

  function openProduct(product: ListedProduct) {
    if (authorityBlockedRef.current) return;
    detailRevision.current += 1;
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    setSelection(product);
  }

  function returnToList() {
    detailRevision.current += 1;
    setSelection(null);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
  }

  function reloadDetail() {
    if (authorityBlockedRef.current) return;
    detailRevision.current += 1;

    if (selection) {
      detailCacheRef.current.delete(
        detailCacheKey(selection),
      );
    }

    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    setDetailAttempt((value) => value + 1);
  }

  function confirmProduct(product: ProductDetail) {
    if (authorityBlockedRef.current) return;
    const previewUrl = product.photos[0]?.previewUrl ?? "";

    if (product.photos.length > 0 && !previewUrl) return;

    props.onSelect({
      sourceKind: product.sourceKind,
      sourceId: product.sourceId,
      name: product.name,
      sku: product.sku,
      previewUrl,
      commercialDetails: {
        sourceKind: product.sourceKind,
        category: normalizeCategory(product),
        name: product.name,
        description: product.description,
        price: product.price,
        priceStatus: product.priceStatus,
        characteristics: product.characteristics,
      },
    });
  }

  const visibleProducts = products;

  const displayPrice = detail
    ? formatPrice(detail.price)
    : null;

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby="catalog-fullscreen-title"
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden border-0 bg-white p-0 text-gray-950 backdrop:bg-white"
    >
      <div className="flex h-full min-h-0 flex-col">
        <header className="shrink-0 border-b border-gray-200 bg-white">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-5 sm:px-8">
            <div className="flex min-w-0 items-center gap-3 sm:gap-4">
              {logoUrl ? (
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-gray-100 bg-white sm:h-16 sm:w-16">
                  <img
                    src={logoUrl}
                    alt={`Logo de ${props.scope.name}`}
                    onError={() => setLogoUrl(null)}
                    className="h-full w-full object-contain"
                  />
                </div>
              ) : null}

              <div className="min-w-0">
                <h1
                  id="catalog-fullscreen-title"
                  className="break-words text-xl font-bold sm:text-2xl"
                >
                  {props.scope.name}
                </h1>

                <p className="mt-1 text-sm text-gray-500">
                  Catálogo de produtos
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={props.onClose}
              className="shrink-0 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-50"
            >
              Voltar ao CRM
            </button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-8 sm:py-8">
            {authorityBlocked ? (
              <section
                role="alert"
                className="rounded-xl border border-gray-200 p-6"
              >
                <h2 className="font-semibold">
                  {"Acesso ao cat\u00e1logo indispon\u00edvel"}
                </h2>

                <p className="mt-2 text-sm text-gray-600">
                  {"Volte ao CRM e abra novamente o cat\u00e1logo para validar seu acesso."}
                </p>
              </section>
            ) : (
              <>

            <div className="mb-5 flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 focus-within:border-gray-500">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                className="h-5 w-5 shrink-0 text-gray-500"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-4-4" />
              </svg>

              <input
                type="search"
                value={searchText}
                maxLength={120}
                aria-label={"Pesquisar em todo o cat\u00e1logo"}
                placeholder={"Pesquisar nome, SKU ou caracter\u00edstica..."}
                onChange={(event) =>
                  resetCatalogList(null, event.target.value)
                }
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400 sm:text-base"
              />

              {searchText ? (
                <button
                  type="button"
                  onClick={() => resetCatalogList(null, "")}
                  className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-gray-500 hover:bg-gray-100"
                >
                  Limpar
                </button>
              ) : null}
            </div>

            <nav
              aria-label="Categorias do catalogo"
              className="grid grid-cols-4 gap-2 sm:gap-4"
            >
              {CATEGORIES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={category === entry.id}
                  onClick={() => {
                    resetCatalogList(entry.id, "");
                  }}
                  className={`flex min-h-24 min-w-0 flex-col items-center justify-center gap-2 rounded-2xl border p-2 text-center transition sm:min-h-32 sm:p-4 ${
                    category === entry.id
                      ? "border-gray-950 bg-gray-950 text-white"
                      : "border-gray-200 bg-white text-gray-800 hover:bg-gray-50"
                  }`}
                >
                  <CategoryIcon category={entry.id} />
                  <span className="break-words text-[11px] font-semibold sm:text-sm">
                    {entry.label}
                  </span>
                </button>
              ))}
            </nav>

            {selection ? (
              <section className="mt-8">
                <button
                  type="button"
                  onClick={returnToList}
                  className="mb-5 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-gray-100"
                >
                  Voltar aos produtos
                </button>

                <h2 className="text-2xl font-bold">
                  {selection.name}
                </h2>

                {detailLoading ? (
                  <p role="status" className="mt-5 text-sm text-gray-500">
                    Carregando detalhes e fotografias...
                  </p>
                ) : null}

                {detailError ? (
                  <div className="mt-5 rounded-xl border border-red-200 p-4">
                    <p role="alert" className="text-sm text-red-700">
                      {detailError}
                    </p>

                    <button
                      type="button"
                      onClick={reloadDetail}
                      className="mt-3 rounded-lg border px-3 py-2 text-sm font-semibold"
                    >
                      Tentar novamente
                    </button>
                  </div>
                ) : null}

                {detail && !detailLoading && !detailError ? (
                  <>
                    <h3 className="mb-3 mt-6 text-base font-bold">
                      Fotografias
                    </h3>

                    {detail.photos.length > 0 ? (
                      <>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          {detail.photos.map((photo, index) => (
                            <div
                              key={photo.id ?? `legacy-${index}`}
                              className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-50"
                            >
                              <img
                                src={photo.previewUrl}
                                alt={`${detail.name} - Foto ${index + 1}`}
                                className="aspect-[4/3] w-full object-contain"
                              />
                            </div>
                          ))}
                        </div>

                        <button
                          type="button"
                          onClick={reloadDetail}
                          className="mt-3 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold"
                        >
                          Atualizar fotografias
                        </button>
                      </>
                    ) : (
                      <p className="rounded-xl border border-dashed border-gray-200 p-5 text-sm text-gray-500">
                        Sem foto cadastrada
                      </p>
                    )}

                    <section className="mt-6 rounded-2xl border border-gray-200 p-4 sm:p-6">
                      <h3 className="mb-4 text-base font-bold">
                        Informações do produto
                      </h3>

                      <dl className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <dt className="text-xs text-gray-500">
                            Categoria
                          </dt>

                          <dd className="font-medium">
                            {categoryLabel(normalizeCategory(detail))}
                          </dd>
                        </div>

                        {detail.sku ? (
                          <div>
                            <dt className="text-xs text-gray-500">
                              SKU
                            </dt>

                            <dd className="font-medium">
                              {detail.sku}
                            </dd>
                          </div>
                        ) : null}

                        <div>
                          <dt className="text-xs text-gray-500">
                            Preço cadastrado
                          </dt>

                          <dd className="font-medium">
                            {displayPrice || "Não confirmado"}
                          </dd>
                        </div>

                        {detail.stockQuantity !== null &&
                        detail.stockStatus &&
                        ["available", "zero"].includes(detail.stockStatus) ? (
                          <div>
                            <dt className="text-xs text-gray-500">
                              Estoque
                            </dt>

                            <dd className="font-medium">
                              {detail.stockQuantity}
                            </dd>
                          </div>
                        ) : null}

                        {Object.entries(detail.characteristics || {})
                          .filter(([, value]) =>
                            value !== null &&
                            value !== undefined &&
                            value !== "",
                          )
                          .map(([key, value]) => (
                            <div key={key}>
                              <dt className="text-xs text-gray-500">
                                {CHARACTERISTIC_LABELS[key] || key}
                              </dt>

                              <dd className="break-words font-medium">
                                {String(value)}
                              </dd>
                            </div>
                          ))}
                      </dl>

                      {detail.description ? (
                        <div className="mt-5 border-t border-gray-100 pt-4">
                          <h4 className="text-sm font-semibold">
                            Descrição
                          </h4>

                          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-gray-700">
                            {detail.description}
                          </p>
                        </div>
                      ) : null}
                    </section>

                    <button
                      type="button"
                      disabled={false}
                      onClick={() => confirmProduct(detail)}
                      className="mt-6 w-full rounded-xl bg-gray-950 px-5 py-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Adicionar produto
                    </button>

                    {detail.photos.length === 0 ? (
                      <p className="mt-2 text-center text-xs text-gray-500">
                        Este produto será enviado sem fotografia.
                      </p>
                    ) : null}
                  </>
                ) : null}
              </section>
            ) : category || searchText.trim() ? (
              <section className="mt-8">
                <h2 className="text-xl font-bold">
                  {category ? categoryLabel(category) : "Resultados da pesquisa"}
                </h2>

                {loading ? (
                  <p role="status" className="mt-3 text-sm text-gray-500">
                    Pesquisando produtos...
                  </p>
                ) : null}

                {error ? (
                  <div className="mt-4">
                    <p role="alert" className="text-sm text-red-700">
                      {error}
                    </p>

                    <button
                      type="button"
                      onClick={() => {
                        if (authorityBlockedRef.current) return;

                        listRevision.current += 1;
                        searchPageCacheRef.current.clear();
                        categoryBatchRef.current = null;

                        setError(null);
                        setLoading(true);
                        setListAttempt((value) => value + 1);
                      }}
                      className="mt-3 rounded-lg border px-4 py-2 text-sm font-semibold"
                    >
                      Tentar novamente
                    </button>
                  </div>
                ) : null}

                <div className="mt-4 divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200">
                  {visibleProducts.map((product) => (
                    <button
                      key={`${product.sourceKind}:${product.sourceId}`}
                      type="button"
                      onClick={() => openProduct(product)}
                      className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50"
                    >
                      <span className="break-words text-sm font-medium">
                        {product.name}
                      </span>

                      <span aria-hidden="true" className="text-gray-400">
                        &rsaquo;
                      </span>
                    </button>
                  ))}
                </div>

                {!loading &&
                !error &&
                visibleProducts.length === 0 ? (
                  <p className="mt-4 text-sm text-gray-500">
                    {hasMore
                      ? "Carregue mais produtos."
                      : searchText.trim()
                        ? "Nenhum produto encontrado."
                        : "Nenhum produto ativo nesta categoria."}
                  </p>
                ) : null}

                {hasMore && !error ? (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => {
                      setLoading(true);
                      setPage((value) => value + 1);
                    }}
                    className="mt-5 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold disabled:opacity-40"
                  >
                    Carregar mais produtos
                  </button>
                ) : null}
              </section>
            ) : (
              <section className="mt-10 rounded-2xl border border-dashed border-gray-200 p-8 text-center">
                <h2 className="font-semibold">
                  Selecione uma categoria
                </h2>

                <p className="mt-2 text-sm text-gray-500">
                  Ou pesquise diretamente pelo produto desejado.
                </p>
              </section>
            )}
              </>
            )}
          </div>
        </main>
      </div>
    </dialog>,
    document.body,
  );
}

function CatalogScopedSession(
  props: Omit<PickerProps, "open"> & {
    scope: CatalogStoreScope | null;
  },
) {
  const currentKey = props.scope
    ? `${props.scope.organizationId}:${props.scope.storeId}`
    : null;

  const [initialKey] = useState(currentKey);

  useEffect(() => {
    if (!initialKey || currentKey !== initialKey) {
      props.onClose();
    }
  }, [initialKey, currentKey, props.onClose]);

  if (!props.scope || !initialKey || currentKey !== initialKey) {
    return null;
  }

  return (
    <CatalogScreen
      scope={props.scope}
      onSelect={props.onSelect}
      onClose={props.onClose}
    />
  );
}

export default function CatalogProductComposerPicker(
  props: PickerProps,
) {
  const {
    activeStore,
    activeStoreId,
    organizationId,
    error,
  } = useStoreContext();

  if (!props.open) return null;

  const scope =
    !error &&
    activeStore &&
    activeStoreId &&
    organizationId &&
    activeStore.id === activeStoreId &&
    activeStore.organization_id === organizationId
      ? {
          organizationId,
          storeId: activeStoreId,
          name: activeStore.name.trim() || "Loja ativa",
        }
      : null;

  return (
    <CatalogScopedSession
      scope={scope}
      onSelect={props.onSelect}
      onClose={props.onClose}
    />
  );
}
