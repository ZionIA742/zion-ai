"use client";

import { useEffect, useState } from "react";

export type CatalogComposerProduct = {
  sourceKind: "pool" | "catalog_item";
  sourceId: string;
  name: string;
  sku?: string | null;
  previewUrl: string;
};

export default function CatalogProductComposerPicker(props: {
  open: boolean;
  onSelect: (product: CatalogComposerProduct) => void;
  onClose: () => void;
}) {
  const [products, setProducts] = useState<CatalogComposerProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    setProducts([]);
    fetch("/api/crm/catalog-products", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.ok) throw new Error("Nao foi possivel carregar o catalogo.");
        if (!cancelled) {
          setProducts(Array.isArray(result.products) ? result.products : []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Nao foi possivel carregar o catalogo.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [props.open]);

  if (!props.open) return null;
  return (
    <div className="mb-3 rounded-2xl border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-gray-900">Produto do catálogo</div>
        <button type="button" onClick={props.onClose} className="rounded-lg bg-white px-3 py-2 text-xs font-semibold ring-1 ring-black/10">Fechar</button>
      </div>
      {loading ? <p className="mt-3 text-xs text-gray-500">Carregando produtos...</p> : null}
      {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}
      {!loading && !error && products.length === 0 ? <p className="mt-3 text-xs text-gray-500">Nenhum produto com foto disponível.</p> : null}
      {!loading && !error ? (
        <div className="mt-3 grid max-h-64 grid-cols-2 gap-2 overflow-y-auto">
          {products.map((product) => (
            <button type="button" key={`${product.sourceKind}:${product.sourceId}`} onClick={() => props.onSelect(product)} className="rounded-xl bg-white p-2 text-left ring-1 ring-black/10 hover:ring-black/30">
              <img src={product.previewUrl} alt={product.name} className="h-24 w-full rounded-lg object-cover" />
              <div className="mt-2 text-xs font-semibold text-gray-900">{product.name}</div>
              {product.sku ? <div className="text-[11px] text-gray-500">SKU: {product.sku}</div> : null}
              <div className="text-[10px] uppercase text-gray-400">{product.sourceKind === "pool" ? "Piscina" : "Produto"}</div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
