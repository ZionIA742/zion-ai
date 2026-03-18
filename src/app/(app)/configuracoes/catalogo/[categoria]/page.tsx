"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type CatalogItemMetadata = {
  categoria?: string | null;
  [key: string]: any;
};

type CatalogItemRow = {
  id: string;
  organization_id: string;
  store_id: string;
  sku: string | null;
  name: string;
  description: string | null;
  price_cents: number | null;
  currency: string;
  is_active: boolean;
  track_stock: boolean;
  stock_quantity: number | null;
  metadata: CatalogItemMetadata | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type CatalogItemPhotoRow = {
  id: string;
  catalog_item_id: string;
  storage_path: string;
  file_name: string | null;
  file_size_bytes: number | null;
  sort_order: number | null;
  created_at?: string | null;
};

const ORGANIZATION_ID = "b02252ce-0e73-4371-9e23-f1009e7b1698";
const STORE_ID = "6ac8f4b1-e50f-42c0-9cae-78951d6daf7b";
const STORAGE_BUCKET = "store-catalog-photos";

function normalizeCategory(category: string | null | undefined) {
  if (category === "acessorios") return "acessorios";
  if (category === "quimicos") return "quimicos";
  return "outros";
}

function categoryLabel(category: string) {
  if (category === "acessorios") return "Acessórios";
  if (category === "quimicos") return "Produtos químicos";
  return "Outros itens";
}

function moneyFromCentsBRL(value: number | null) {
  if (value == null) return "Sem preço";
  return `R$ ${(value / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function getPublicImageUrl(storagePath: string) {
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

function getCatalogAvailability(
  item: Pick<CatalogItemRow, "is_active" | "track_stock" | "stock_quantity">
) {
  if (!item.is_active) {
    return {
      label: "Indisponível para oferta",
      detail: "Item inativo",
    };
  }

  if (!item.track_stock) {
    return {
      label: "Disponível para oferta",
      detail: "Sem controle de estoque",
    };
  }

  if ((item.stock_quantity ?? 0) > 0) {
    return {
      label: "Disponível para oferta",
      detail: `Estoque: ${item.stock_quantity ?? 0}`,
    };
  }

  return {
    label: "Indisponível para oferta",
    detail: "Sem estoque",
  };
}

export default function CatalogoCategoriaPage() {
  const params = useParams();
  const categoriaParam = Array.isArray(params?.categoria)
    ? params.categoria[0]
    : (params?.categoria as string | undefined);

  const categoria = normalizeCategory(categoriaParam);

  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [items, setItems] = useState<CatalogItemRow[]>([]);
  const [photos, setPhotos] = useState<CatalogItemPhotoRow[]>([]);

  useEffect(() => {
    void fetchData();
  }, [categoria]);

  async function fetchData() {
    setLoading(true);
    setErrorText(null);

    const [itemsResult, photosResult] = await Promise.all([
      supabase
        .from("store_catalog_items")
        .select(
          "id,organization_id,store_id,sku,name,description,price_cents,currency,is_active,track_stock,stock_quantity,metadata,created_at,updated_at"
        )
        .eq("organization_id", ORGANIZATION_ID)
        .eq("store_id", STORE_ID)
        .order("created_at", { ascending: false }),
      supabase
        .from("store_catalog_item_photos")
        .select(
          "id,catalog_item_id,storage_path,file_name,file_size_bytes,sort_order,created_at"
        )
        .order("sort_order", { ascending: true }),
    ]);

    if (itemsResult.error) {
      setErrorText(itemsResult.error.message ?? "Erro ao carregar itens do catálogo.");
      setLoading(false);
      return;
    }

    if (photosResult.error) {
      setErrorText(photosResult.error.message ?? "Erro ao carregar fotos dos itens.");
      setLoading(false);
      return;
    }

    const allItems = (itemsResult.data || []) as CatalogItemRow[];
    const filteredItems = allItems.filter(
      (item) => normalizeCategory(item.metadata?.categoria) === categoria
    );

    setItems(filteredItems);
    setPhotos((photosResult.data || []) as CatalogItemPhotoRow[]);
    setLoading(false);
  }

  const photosByItemId = useMemo(() => {
    const grouped: Record<string, CatalogItemPhotoRow[]> = {};

    for (const photo of photos) {
      if (!grouped[photo.catalog_item_id]) {
        grouped[photo.catalog_item_id] = [];
      }
      grouped[photo.catalog_item_id].push(photo);
    }

    for (const itemId of Object.keys(grouped)) {
      grouped[itemId] = grouped[itemId].sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
      );
    }

    return grouped;
  }, [photos]);

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {categoryLabel(categoria)}
            </h1>
            <p className="mt-2 text-gray-600">
              Visualize todos os itens cadastrados desta categoria.
            </p>
          </div>

          <Link
            href="/configuracoes"
            className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-50"
          >
            Voltar para configurações
          </Link>
        </div>

        {errorText ? (
          <div className="mb-5 rounded-2xl bg-red-50 p-4 text-sm text-red-800 ring-1 ring-red-600/20">
            <div className="font-semibold">Erro</div>
            <div className="mt-1 break-words">{errorText}</div>
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
            Carregando itens...
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
            Nenhum item cadastrado nesta categoria.
          </div>
        ) : (
          <div className="space-y-6">
            {items.map((item) => {
              const itemPhotos = photosByItemId[item.id] || [];
              const availability = getCatalogAvailability(item);

              return (
                <section
                  key={item.id}
                  className="rounded-2xl bg-white shadow-sm ring-1 ring-black/5"
                >
                  <div className="border-b border-black/5 px-6 py-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <h2 className="text-xl font-semibold text-gray-900">
                          {item.name}
                        </h2>
                        <p className="mt-1 text-sm text-gray-600">
                          {item.sku
                            ? `Código do produto: ${item.sku}`
                            : "Sem código do produto"}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/5">
                          {moneyFromCentsBRL(item.price_cents)}
                        </span>
                        <span className="rounded-full bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/5">
                          {item.is_active ? "Ativo" : "Inativo"}
                        </span>
                        <span className="rounded-full bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/5">
                          {item.track_stock ? "Controla estoque" : "Sem controle de estoque"}
                        </span>
                        <span className="rounded-full bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/5">
                          {availability.label}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-6 p-6 lg:grid-cols-[320px,1fr]">
                    <div className="space-y-4">
                      <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                        <div className="text-sm font-semibold text-gray-900">Descrição</div>
                        <div className="mt-2 text-sm text-gray-600">
                          {item.description?.trim() || "Sem descrição."}
                        </div>
                      </div>

                      <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                        <div className="text-sm font-semibold text-gray-900">
                          Disponibilidade comercial
                        </div>
                        <div className="mt-2 space-y-1 text-sm text-gray-600">
                          <div>Status: {item.is_active ? "Ativo" : "Inativo"}</div>
                          <div>
                            Controle de estoque: {item.track_stock ? "Sim" : "Não"}
                          </div>
                          <div>
                            Quantidade em estoque:{" "}
                            {item.track_stock ? item.stock_quantity ?? 0 : "Não controlado"}
                          </div>
                          <div>Situação: {availability.detail}</div>
                        </div>
                      </div>

                      <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                        <div className="text-sm font-semibold text-gray-900">
                          Informações do item
                        </div>
                        <div className="mt-2 space-y-1 text-sm text-gray-600">
                          <div>Categoria: {categoryLabel(categoria)}</div>
                          <div>Fotos cadastradas: {itemPhotos.length}</div>
                          <div>Moeda: {item.currency || "BRL"}</div>
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-gray-900">
                          Fotos do item
                        </div>
                        <div className="text-xs text-gray-500">
                          Até 10 fotos por item
                        </div>
                      </div>

                      {itemPhotos.length === 0 ? (
                        <div className="rounded-2xl bg-gray-50 p-6 text-sm text-gray-600 ring-1 ring-black/5">
                          Nenhuma foto cadastrada para este item.
                        </div>
                      ) : (
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6">
                          {itemPhotos.map((photo) => (
                            <div
                              key={photo.id}
                              className="overflow-hidden rounded-xl bg-gray-50 ring-1 ring-black/5"
                            >
                              <img
                                src={getPublicImageUrl(photo.storage_path)}
                                alt={photo.file_name || item.name}
                                className="block h-20 w-full object-cover"
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}