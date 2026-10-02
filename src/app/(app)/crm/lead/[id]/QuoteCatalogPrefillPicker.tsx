"use client";

import { useEffect, useMemo, useState } from "react";

import { supabase } from "@/lib/supabaseBrowser";
import {
  buildQuoteCatalogPrefillItemFromCatalog,
  buildQuoteCatalogPrefillItemFromPool,
  buildQuoteCatalogPrefillValues,
  buildQuoteTechnicalServicePrefillItems,
  isQuoteCatalogPrefillItemEligible,
  matchesQuoteCatalogPrefillSearch,
  quoteCatalogCategoryLabel,
  type QuoteCatalogItemRow,
  type QuoteCatalogPrefillItem,
  type QuoteCatalogPrefillItemType,
  type QuoteCatalogPrefillValues,
  type QuotePoolPrefillRow,
  type QuoteTechnicalServicesPolicy,
} from "./quote-catalog-prefill";

type QuoteCatalogPrefillPickerProps = {
  organizationId: string;
  storeId: string;
  itemType: QuoteCatalogPrefillItemType;
  technicalServicesPolicy: QuoteTechnicalServicesPolicy | null;
  onSelect: (values: QuoteCatalogPrefillValues) => void;
};

export default function QuoteCatalogPrefillPicker({
  organizationId,
  storeId,
  itemType,
  technicalServicesPolicy,
  onSelect,
}: QuoteCatalogPrefillPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [items, setItems] = useState<QuoteCatalogPrefillItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    setIsOpen(false);
    setItems([]);
    setSearch("");
    setLoaded(false);
    setErrorText(null);
  }, [
    itemType,
    organizationId,
    storeId,
    technicalServicesPolicy,
  ]);

  const visibleItems = useMemo(
    () =>
      items.filter(
        (item) =>
          isQuoteCatalogPrefillItemEligible(item) &&
          matchesQuoteCatalogPrefillSearch(item, search),
      ),
    [items, search],
  );

  async function loadCatalog() {
    const safeOrganizationId = String(
      organizationId || "",
    ).trim();
    const safeStoreId = String(storeId || "").trim();

    if (!safeOrganizationId || !safeStoreId) {
      setErrorText(
        "Não foi possível identificar a loja deste orçamento.",
      );
      return;
    }

    setLoading(true);
    setErrorText(null);

    try {
      if (itemType === "service") {
        const serviceItems =
          buildQuoteTechnicalServicePrefillItems(
            technicalServicesPolicy,
          );

        setItems(serviceItems);
        setLoaded(true);
        return;
      }

      if (itemType === "pool_installation") {
        const { data, error } = await supabase
          .from("pools")
          .select(
            "id,name,description,price,price_status,is_active",
          )
          .eq("organization_id", safeOrganizationId)
          .eq("store_id", safeStoreId)
          .eq("is_active", true)
          .eq("price_status", "valid")
          .order("name", { ascending: true })
          .limit(5000);

        if (error) {
          throw error;
        }

        const poolItems = (
          (data || []) as QuotePoolPrefillRow[]
        )
          .map(buildQuoteCatalogPrefillItemFromPool)
          .filter(
            (item): item is QuoteCatalogPrefillItem =>
              item !== null,
          );

        setItems(poolItems);
        setLoaded(true);
        return;
      }

      const { data, error } = await supabase
        .from("store_catalog_items")
        .select(
          "id,name,sku,description,price_cents,price_status,currency,is_active,metadata",
        )
        .eq("organization_id", safeOrganizationId)
        .eq("store_id", safeStoreId)
        .eq("is_active", true)
        .eq("price_status", "valid")
        .order("name", { ascending: true })
        .limit(5000);

      if (error) {
        throw error;
      }

      const catalogItems = (
        (data || []) as QuoteCatalogItemRow[]
      )
        .map(buildQuoteCatalogPrefillItemFromCatalog)
        .filter(
          (item): item is QuoteCatalogPrefillItem =>
            item !== null &&
            (
              item.category === "quimicos" ||
              item.category === "acessorios" ||
              item.category === "outros"
            ),
        );

      setItems(catalogItems);
      setLoaded(true);
    } catch (error: any) {
      setItems([]);
      setErrorText(
        error?.message ||
          "Não foi possível carregar as opções disponíveis.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function togglePicker() {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);

    if (nextOpen && !loaded && !loading) {
      await loadCatalog();
    }
  }

  function selectItem(item: QuoteCatalogPrefillItem) {
    const values =
      buildQuoteCatalogPrefillValues(item);

    if (!values) {
      setErrorText(
        "Esta opção não está disponível para preencher o orçamento.",
      );
      return;
    }

    onSelect(values);

    setSearch("");
    setIsOpen(false);
    setErrorText(null);
  }

  const searchPlaceholder =
    itemType === "pool_installation"
      ? "Buscar piscina por nome"
      : itemType === "service"
        ? "Buscar serviço"
        : "Buscar por nome ou SKU";

  const emptyText =
    itemType === "pool_installation"
      ? "Nenhuma piscina disponível foi encontrada."
      : itemType === "service"
        ? "Nenhum serviço configurado está disponível."
        : "Nenhum produto disponível foi encontrado.";

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => void togglePicker()}
        className="rounded-xl bg-white px-3.5 py-2 text-xs font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-50"
      >
        Selecionar do catálogo
      </button>

      {isOpen ? (
        <div className="mt-3 rounded-2xl bg-gray-50 p-3 ring-1 ring-black/10">
          <div className="flex items-center gap-2">
            <input
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder={searchPlaceholder}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-black"
            />

            <button
              type="button"
              onClick={() => void loadCatalog()}
              disabled={loading}
              className="rounded-xl bg-white px-3 py-2.5 text-xs font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Carregando..." : "Atualizar"}
            </button>
          </div>

          {errorText ? (
            <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200">
              {errorText}
            </div>
          ) : null}

          {!loading &&
          loaded &&
          visibleItems.length === 0 ? (
            <div className="mt-3 text-xs text-gray-500">
              {emptyText}
            </div>
          ) : null}

          {visibleItems.length > 0 ? (
            <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
              {visibleItems.map((catalogItem) => {
                const categoryText =
                  catalogItem.source_kind === "catalog_item"
                    ? quoteCatalogCategoryLabel(
                        catalogItem.category,
                      )
                    : "";

                return (
                  <button
                    key={catalogItem.id}
                    type="button"
                    onClick={() =>
                      selectItem(catalogItem)
                    }
                    className="flex w-full items-center justify-between gap-3 rounded-xl bg-white px-3 py-3 text-left ring-1 ring-black/10 hover:bg-gray-100"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-gray-900">
                        {catalogItem.name}
                      </div>

                      {catalogItem.sku ? (
                        <div className="mt-0.5 truncate text-xs text-gray-500">
                          SKU: {catalogItem.sku}
                        </div>
                      ) : null}

                      {categoryText ? (
                        <div className="mt-0.5 truncate text-xs text-gray-500">
                          {categoryText}
                        </div>
                      ) : null}
                    </div>

                    <div className="shrink-0 text-sm font-semibold text-gray-900">
                      {catalogItem.source_kind ===
                      "service"
                        ? "Preço manual"
                        : new Intl.NumberFormat(
                            "pt-BR",
                            {
                              style: "currency",
                              currency: "BRL",
                            },
                          ).format(
                            (catalogItem.price_cents ||
                              0) / 100,
                          )}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
