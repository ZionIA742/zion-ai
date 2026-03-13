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

export default function PiscinasPage() {
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [pools, setPools] = useState<PoolRow[]>([]);
  const [photos, setPhotos] = useState<PoolPhotoRow[]>([]);

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
          "id,name,width_m,length_m,depth_m,shape,material,max_capacity_l,weight_kg,price,description,created_at"
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("pool_photos")
        .select(
          "id,pool_id,storage_path,file_name,file_size_bytes,sort_order,created_at"
        )
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

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Piscinas cadastradas</h1>
            <p className="mt-2 text-gray-600">
              Visualize todas as piscinas cadastradas com informações e fotos.
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

                      <div className="rounded-full bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-black/5">
                        {moneyBRL(pool.price)}
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

                      <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-black/5">
                        <div className="text-sm font-semibold text-gray-900">Descrição</div>
                        <div className="mt-2 text-sm text-gray-600">
                          {pool.description?.trim() || "Sem descrição."}
                        </div>
                      </div>

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