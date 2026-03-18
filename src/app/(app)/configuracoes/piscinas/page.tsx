"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type PoolRow = {
  id: string;
  name: string | null;
  width_m: number | null;
  length_m: number | null;
  depth_m: number | null;
  shape: string | null;
  material: string | null;
  max_capacity_l: number | null;
  weight_kg: number | null;
  price: number | null;
  description: string | null;
  is_active: boolean;
  track_stock: boolean;
  stock_quantity: number | null;
  created_at?: string | null;
};

type PoolPhotoRow = {
  id: string;
  pool_id: string;
  storage_path: string;
  file_name: string | null;
  file_size_bytes: number | null;
  sort_order: number | null;
  created_at?: string | null;
};

type EditPoolForm = {
  name: string;
  description: string;
  price: string;
  is_active: boolean;
  track_stock: boolean;
  stock_quantity: string;
};

const STORAGE_BUCKET = "pool-photos";

function moneyBRL(value: number | null) {
  if (value == null) return "Sem preço";
  return `R$ ${Number(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function getPublicImageUrl(storagePath: string) {
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

function formatPriceInput(value: string) {
  const cleaned = value.replace(/[^\d,]/g, "");
  if (!cleaned) return "";

  const parts = cleaned.split(",");
  const integerPartRaw = parts[0].replace(/^0+(?=\d)/, "");
  const integerPart = integerPartRaw || (parts[0] ? "0" : "");
  const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  if (parts.length === 1) {
    return formattedInteger;
  }

  const decimalPart = parts.slice(1).join("").slice(0, 2);
  return `${formattedInteger},${decimalPart}`;
}

function toNullableNumber(value: string) {
  const cleaned = value.replace(/\./g, "").replace(",", ".").trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatIntegerInput(value: string) {
  return value.replace(/[^\d]/g, "");
}

function toNullableInteger(value: string) {
  const cleaned = value.replace(/[^\d-]/g, "").trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  if (Number.isNaN(parsed)) return null;
  return Math.trunc(parsed);
}

function getPoolAvailability(pool: Pick<PoolRow, "is_active" | "track_stock" | "stock_quantity">) {
  if (!pool.is_active) {
    return {
      label: "Indisponível para oferta",
      detail: "Piscina inativa",
    };
  }

  if (!pool.track_stock) {
    return {
      label: "Disponível para oferta",
      detail: "Sem controle de estoque",
    };
  }

  if ((pool.stock_quantity ?? 0) > 0) {
    return {
      label: "Disponível para oferta",
      detail: `Estoque: ${pool.stock_quantity ?? 0}`,
    };
  }

  return {
    label: "Indisponível para oferta",
    detail: "Sem estoque",
  };
}

function buildEditForm(pool: PoolRow): EditPoolForm {
  return {
    name: pool.name ?? "",
    description: pool.description ?? "",
    price: pool.price == null ? "" : formatPriceInput(String(pool.price).replace(".", ",")),
    is_active: Boolean(pool.is_active),
    track_stock: Boolean(pool.track_stock),
    stock_quantity:
      pool.track_stock && pool.stock_quantity != null ? String(pool.stock_quantity) : "",
  };
}

export default function PiscinasPage() {
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);
  const [pools, setPools] = useState<PoolRow[]>([]);
  const [photos, setPhotos] = useState<PoolPhotoRow[]>([]);

  const [editingPoolId, setEditingPoolId] = useState<string | null>(null);
  const [editPoolForm, setEditPoolForm] = useState<EditPoolForm | null>(null);
  const [savingPoolId, setSavingPoolId] = useState<string | null>(null);

  useEffect(() => {
    void fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    setErrorText(null);

    const [poolsResult, photosResult] = await Promise.all([
      supabase
        .from("pools")
        .select(
          "id,name,width_m,length_m,depth_m,shape,material,max_capacity_l,weight_kg,price,description,is_active,track_stock,stock_quantity,created_at"
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("pool_photos")
        .select("id,pool_id,storage_path,file_name,file_size_bytes,sort_order,created_at")
        .order("sort_order", { ascending: true }),
    ]);

    if (poolsResult.error) {
      setErrorText(poolsResult.error.message ?? "Erro ao carregar piscinas.");
      setLoading(false);
      return;
    }

    if (photosResult.error) {
      setErrorText(photosResult.error.message ?? "Erro ao carregar fotos.");
      setLoading(false);
      return;
    }

    setPools((poolsResult.data || []) as PoolRow[]);
    setPhotos((photosResult.data || []) as PoolPhotoRow[]);
    setLoading(false);
  }

  const photosByPoolId = useMemo(() => {
    const grouped: Record<string, PoolPhotoRow[]> = {};

    for (const photo of photos) {
      if (!grouped[photo.pool_id]) {
        grouped[photo.pool_id] = [];
      }
      grouped[photo.pool_id].push(photo);
    }

    for (const poolId of Object.keys(grouped)) {
      grouped[poolId] = grouped[poolId].sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
      );
    }

    return grouped;
  }, [photos]);

  function startEditing(pool: PoolRow) {
    setErrorText(null);
    setSuccessText(null);
    setEditingPoolId(pool.id);
    setEditPoolForm(buildEditForm(pool));
  }

  function cancelEditing() {
    setEditingPoolId(null);
    setEditPoolForm(null);
  }

  async function handleSavePool(poolId: string) {
    if (!editPoolForm) return;

    setErrorText(null);
    setSuccessText(null);

    if (!editPoolForm.name.trim()) {
      setErrorText("O nome da piscina é obrigatório.");
      return;
    }

    const priceValue = toNullableNumber(editPoolForm.price);
    const stockQuantityValue = toNullableInteger(editPoolForm.stock_quantity);

    if (editPoolForm.price.trim() && priceValue == null) {
      setErrorText("O preço da piscina está inválido.");
      return;
    }

    if (editPoolForm.track_stock) {
      if (stockQuantityValue == null) {
        setErrorText("A quantidade em estoque é obrigatória quando o controle de estoque está ativado.");
        return;
      }

      if (stockQuantityValue < 0) {
        setErrorText("A quantidade em estoque não pode ser negativa.");
        return;
      }
    }

    setSavingPoolId(poolId);

    const { error } = await supabase
      .from("pools")
      .update({
        name: editPoolForm.name.trim(),
        description: editPoolForm.description.trim() || null,
        price: editPoolForm.price.trim() ? priceValue : null,
        is_active: editPoolForm.is_active,
        track_stock: editPoolForm.track_stock,
        stock_quantity: editPoolForm.track_stock ? stockQuantityValue : null,
      })
      .eq("id", poolId);

    if (error) {
      setErrorText(error.message ?? "Erro ao salvar piscina.");
      setSavingPoolId(null);
      return;
    }

    setSuccessText("Piscina atualizada com sucesso.");
    setSavingPoolId(null);
    cancelEditing();
    await fetchData();
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Piscinas cadastradas</h1>
            <p className="mt-2 text-gray-600">
              Visualize e edite todas as piscinas cadastradas.
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

        {successText ? (
          <div className="mb-5 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800 ring-1 ring-emerald-600/20">
            <div className="font-semibold">Sucesso</div>
            <div className="mt-1 break-words">{successText}</div>
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
            Carregando piscinas...
          </div>
        ) : pools.length === 0 ? (
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
            Nenhuma piscina cadastrada.
          </div>
        ) : (
          <div className="space-y-6">
            {pools.map((pool) => {
              const poolPhotos = photosByPoolId[pool.id] || [];
              const availability = getPoolAvailability(pool);
              const isEditing = editingPoolId === pool.id && editPoolForm;
              const isSaving = savingPoolId === pool.id;

              return (
                <section
                  key={pool.id}
                  className="rounded-2xl bg-white shadow-sm ring-1 ring-black/5"
                >
                  <div className="border-b border-black/5 px-6 py-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <h2 className="text-xl font-semibold text-gray-900">
                          {pool.name ?? "Piscina sem nome"}
                        </h2>
                        <p className="mt-1 text-sm text-gray-600">
                          {pool.shape ?? "-"} • {pool.material ?? "-"}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {!isEditing ? (
                          <>
                            <span className="rounded-full bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/5">
                              {moneyBRL(pool.price)}
                            </span>
                            <span className="rounded-full bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/5">
                              {pool.is_active ? "Ativa" : "Inativa"}
                            </span>
                            <span className="rounded-full bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/5">
                              {pool.track_stock ? "Controla estoque" : "Sem controle de estoque"}
                            </span>
                            <span className="rounded-full bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/5">
                              {availability.label}
                            </span>

                            <button
                              type="button"
                              onClick={() => startEditing(pool)}
                              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50"
                            >
                              Editar
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleSavePool(pool.id)}
                              disabled={isSaving}
                              className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isSaving ? "Salvando..." : "Salvar"}
                            </button>

                            <button
                              type="button"
                              onClick={cancelEditing}
                              disabled={isSaving}
                              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Cancelar
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-6 p-6 lg:grid-cols-[320px,1fr]">
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Largura
                          </div>
                          <div className="mt-2 text-lg font-semibold text-gray-900">
                            {pool.width_m ?? "-"} m
                          </div>
                        </div>

                        <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Comprimento
                          </div>
                          <div className="mt-2 text-lg font-semibold text-gray-900">
                            {pool.length_m ?? "-"} m
                          </div>
                        </div>

                        <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Profundidade
                          </div>
                          <div className="mt-2 text-lg font-semibold text-gray-900">
                            {pool.depth_m ?? "-"} m
                          </div>
                        </div>

                        <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Fotos
                          </div>
                          <div className="mt-2 text-lg font-semibold text-gray-900">
                            {poolPhotos.length}
                          </div>
                        </div>
                      </div>

                      {isEditing ? (
                        <div className="space-y-4 rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                          <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">
                              Nome
                            </label>
                            <input
                              value={editPoolForm.name}
                              onChange={(e) =>
                                setEditPoolForm((prev) =>
                                  prev ? { ...prev, name: e.target.value } : prev
                                )
                              }
                              className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">
                              Preço
                            </label>
                            <input
                              value={editPoolForm.price}
                              onChange={(e) =>
                                setEditPoolForm((prev) =>
                                  prev
                                    ? { ...prev, price: formatPriceInput(e.target.value) }
                                    : prev
                                )
                              }
                              className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                              placeholder="Ex.: 12.000,00"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">
                              Descrição
                            </label>
                            <textarea
                              value={editPoolForm.description}
                              onChange={(e) =>
                                setEditPoolForm((prev) =>
                                  prev ? { ...prev, description: e.target.value } : prev
                                )
                              }
                              className="min-h-[120px] w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black"
                            />
                          </div>

                          <div className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-black/5">
                            <label className="flex items-center gap-3 text-sm text-gray-700">
                              <input
                                type="checkbox"
                                checked={editPoolForm.is_active}
                                onChange={(e) =>
                                  setEditPoolForm((prev) =>
                                    prev ? { ...prev, is_active: e.target.checked } : prev
                                  )
                                }
                              />
                              Piscina ativa para oferta
                            </label>

                            <label className="flex items-center gap-3 text-sm text-gray-700">
                              <input
                                type="checkbox"
                                checked={editPoolForm.track_stock}
                                onChange={(e) =>
                                  setEditPoolForm((prev) =>
                                    prev ? { ...prev, track_stock: e.target.checked } : prev
                                  )
                                }
                              />
                              Controlar estoque desta piscina
                            </label>
                          </div>

                          <div>
                            <label className="mb-1 block text-sm font-medium text-gray-700">
                              Quantidade em estoque
                            </label>
                            <input
                              value={editPoolForm.stock_quantity}
                              onChange={(e) =>
                                setEditPoolForm((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        stock_quantity: formatIntegerInput(e.target.value),
                                      }
                                    : prev
                                )
                              }
                              disabled={!editPoolForm.track_stock}
                              className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-black disabled:cursor-not-allowed disabled:bg-gray-100"
                              placeholder={
                                editPoolForm.track_stock
                                  ? "Ex.: 3"
                                  : "Desativado porque o controle de estoque está desligado"
                              }
                            />
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                            <div className="text-sm font-semibold text-gray-900">
                              Disponibilidade comercial
                            </div>
                            <div className="mt-2 space-y-1 text-sm text-gray-600">
                              <div>Status: {pool.is_active ? "Ativa" : "Inativa"}</div>
                              <div>
                                Controle de estoque: {pool.track_stock ? "Sim" : "Não"}
                              </div>
                              <div>
                                Quantidade em estoque:{" "}
                                {pool.track_stock ? pool.stock_quantity ?? 0 : "Não controlado"}
                              </div>
                              <div>Situação: {availability.detail}</div>
                            </div>
                          </div>

                          <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                            <div className="text-sm font-semibold text-gray-900">Descrição</div>
                            <div className="mt-2 text-sm text-gray-600">
                              {pool.description?.trim() || "Sem descrição."}
                            </div>
                          </div>
                        </>
                      )}

                      <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                        <div className="text-sm font-semibold text-gray-900">
                          Informações adicionais
                        </div>
                        <div className="mt-2 space-y-1 text-sm text-gray-600">
                          <div>Capacidade: {pool.max_capacity_l ?? "-"} L</div>
                          <div>Peso: {pool.weight_kg ?? "-"} kg</div>
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-gray-900">
                          Fotos da piscina
                        </div>
                        <div className="text-xs text-gray-500">
                          Até 10 fotos por piscina
                        </div>
                      </div>

                      {poolPhotos.length === 0 ? (
                        <div className="rounded-2xl bg-gray-50 p-6 text-sm text-gray-600 ring-1 ring-black/5">
                          Nenhuma foto cadastrada para esta piscina.
                        </div>
                      ) : (
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6">
                          {poolPhotos.map((photo) => (
                            <div
                              key={photo.id}
                              className="overflow-hidden rounded-xl bg-gray-50 ring-1 ring-black/5"
                            >
                              <img
                                src={getPublicImageUrl(photo.storage_path)}
                                alt={photo.file_name || pool.name || "Foto da piscina"}
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