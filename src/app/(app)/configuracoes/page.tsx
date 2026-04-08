"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useStoreContext } from "@/components/StoreProvider";
import { supabase } from "@/lib/supabaseBrowser";

type CountState = {
  pools: number;
  quimicos: number;
  acessorios: number;
  outros: number;
};

type CatalogItemRow = {
  id: string;
  metadata?: {
    categoria?: string | null;
  } | null;
};

type CatalogPhotoRow = {
  id: string;
  catalog_item_id: string;
  storage_path: string | null;
};

function normalizeCategory(value: string | null | undefined) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "quimicos") return "quimicos";
  if (normalized === "acessorios") return "acessorios";
  return "outros";
}

function chunkArray<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function SummaryStat({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4 transition hover:border-black/15 hover:bg-white"
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500">
        {label}
      </div>
      <div className="mt-2 text-2xl font-black tracking-[-0.02em] text-black">
        {value}
      </div>
    </Link>
  );
}

function QuickAccessCard({
  href,
  title,
  description,
  count,
}: {
  href: string;
  title: string;
  description: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-gray-200 bg-white px-4 py-4 transition hover:border-black/15 hover:bg-gray-50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-black tracking-[-0.02em] text-black">
            {title}
          </h2>
          <p className="mt-2 text-sm leading-6 text-gray-600">{description}</p>
        </div>

        <span className="inline-flex min-w-[2.4rem] shrink-0 justify-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700">
          {count}
        </span>
      </div>

      <div className="mt-4 inline-flex items-center rounded-xl bg-gray-100 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-700 transition group-hover:bg-black group-hover:text-white">
        Abrir
      </div>
    </Link>
  );
}

export default function ConfiguracoesPage() {
  const { organizationId, activeStoreId } = useStoreContext();

  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);
  const [deletingCatalog, setDeletingCatalog] = useState(false);
  const [counts, setCounts] = useState<CountState>({
    pools: 0,
    quimicos: 0,
    acessorios: 0,
    outros: 0,
  });

  const hasValidStoreContext = Boolean(organizationId && activeStoreId);

  const fetchCounts = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setCounts({
        pools: 0,
        quimicos: 0,
        acessorios: 0,
        outros: 0,
      });
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorText(null);

    try {
      const [poolsResult, catalogResult] = await Promise.all([
        supabase
          .from("pools")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId),
        supabase
          .from("store_catalog_items")
          .select("id, metadata")
          .eq("organization_id", organizationId)
          .eq("store_id", activeStoreId),
      ]);

      if (poolsResult.error) throw poolsResult.error;
      if (catalogResult.error) throw catalogResult.error;

      const nextCounts: CountState = {
        pools: poolsResult.count ?? 0,
        quimicos: 0,
        acessorios: 0,
        outros: 0,
      };

      for (const row of (catalogResult.data || []) as CatalogItemRow[]) {
        const category = normalizeCategory(row?.metadata?.categoria);
        nextCounts[category] += 1;
      }

      setCounts(nextCounts);
    } catch (error: any) {
      setErrorText(
        error?.message ?? "Erro ao carregar a visão geral das configurações."
      );
    } finally {
      setLoading(false);
    }
  }, [organizationId, activeStoreId]);

  useEffect(() => {
    void fetchCounts();
  }, [fetchCounts]);

  const totalCatalogo = useMemo(
    () => counts.quimicos + counts.acessorios + counts.outros,
    [counts]
  );

  const handleDeleteAllCatalog = useCallback(async () => {
    if (!organizationId || !activeStoreId) {
      setErrorText("Nenhuma loja ativa foi encontrada para apagar o catálogo.");
      return;
    }

    if (deletingCatalog) return;

    const hasAnyCatalogItem = totalCatalogo > 0;
    if (!hasAnyCatalogItem) {
      setSuccessText("O catálogo geral já está vazio.");
      setErrorText(null);
      return;
    }

    const firstConfirm = window.confirm(
      "Tem certeza que deseja apagar TODO o catálogo geral desta loja? Isso vai remover químicos, acessórios e outros itens cadastrados."
    );
    if (!firstConfirm) return;

    const secondConfirm = window.confirm(
      "Confirma mais uma vez: apagar todo o catálogo geral agora? Essa ação não apaga as piscinas."
    );
    if (!secondConfirm) return;

    setDeletingCatalog(true);
    setErrorText(null);
    setSuccessText(null);

    try {
      const { data: catalogItems, error: catalogItemsError } = await supabase
        .from("store_catalog_items")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("store_id", activeStoreId);

      if (catalogItemsError) throw catalogItemsError;

      const catalogItemIds = ((catalogItems || []) as Array<{ id: string }>).map(
        (item) => item.id
      );

      if (catalogItemIds.length === 0) {
        setSuccessText("O catálogo geral já estava vazio.");
        await fetchCounts();
        return;
      }

      const photoRows: CatalogPhotoRow[] = [];
      const idChunks = chunkArray(catalogItemIds, 200);

      for (const ids of idChunks) {
        const { data: photoChunk, error: photosError } = await supabase
          .from("store_catalog_item_photos")
          .select("id, catalog_item_id, storage_path")
          .in("catalog_item_id", ids);

        if (photosError) throw photosError;
        photoRows.push(...((photoChunk || []) as CatalogPhotoRow[]));
      }

      const storagePaths = photoRows
        .map((row) => String(row.storage_path || "").trim())
        .filter(Boolean);

      const storagePathChunks = chunkArray(storagePaths, 100);
      for (const paths of storagePathChunks) {
        const { error: storageRemoveError } = await supabase.storage
          .from("store-catalog-photos")
          .remove(paths);

        if (storageRemoveError) {
          throw storageRemoveError;
        }
      }

      if (photoRows.length > 0) {
        const photoIdChunks = chunkArray(
          photoRows.map((row) => row.id),
          200
        );

        for (const ids of photoIdChunks) {
          const { error: deletePhotosError } = await supabase
            .from("store_catalog_item_photos")
            .delete()
            .in("id", ids);

          if (deletePhotosError) throw deletePhotosError;
        }
      }

      for (const ids of idChunks) {
        const { error: deleteItemsError } = await supabase
          .from("store_catalog_items")
          .delete()
          .in("id", ids);

        if (deleteItemsError) throw deleteItemsError;
      }

      setSuccessText("Todo o catálogo geral da loja foi apagado com sucesso.");
      await fetchCounts();
    } catch (error: any) {
      setErrorText(
        error?.message ?? "Erro ao apagar todo o catálogo geral da loja."
      );
    } finally {
      setDeletingCatalog(false);
    }
  }, [
    organizationId,
    activeStoreId,
    deletingCatalog,
    totalCatalogo,
    fetchCounts,
  ]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-[42px] font-black tracking-[-0.03em] text-black">
            Configurações
          </h1>
          <p className="max-w-3xl text-base text-gray-600">
            Abra rapidamente as áreas da loja, revise o catálogo e acompanhe a
            visão geral do que já está cadastrado.
          </p>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700">
          <span className="font-semibold text-gray-900">Loja ativa:</span>{" "}
          {hasValidStoreContext ? "pronta para edição" : "não encontrada"}
        </div>
      </div>

      {!hasValidStoreContext ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Nenhuma loja ativa foi encontrada.
        </div>
      ) : null}

      {errorText ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorText}
        </div>
      ) : null}

      {successText ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {successText}
        </div>
      ) : null}

      <section className="rounded-[28px] border border-gray-200 bg-white p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Acessos rápidos</h2>
            <p className="mt-1 text-sm text-gray-500">
              Entre direto na área certa sem ficar preso na tela errada.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {loading ? (
              <span className="text-xs font-medium text-gray-500">
                Carregando...
              </span>
            ) : null}

            <button
              type="button"
              onClick={() => void handleDeleteAllCatalog()}
              disabled={
                !hasValidStoreContext || deletingCatalog || totalCatalogo === 0
              }
              className="rounded-2xl border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deletingCatalog ? "Apagando catálogo..." : "Apagar todo o catálogo"}
            </button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <QuickAccessCard
            href="/configuracoes/piscinas"
            title="Piscinas"
            description="Ver, editar, excluir e revisar as piscinas cadastradas."
            count={counts.pools}
          />
          <QuickAccessCard
            href="/configuracoes/catalogo/quimicos"
            title="Químicos"
            description="Ver e organizar os produtos químicos da loja."
            count={counts.quimicos}
          />
          <QuickAccessCard
            href="/configuracoes/catalogo/acessorios"
            title="Acessórios"
            description="Ver e organizar os acessórios cadastrados."
            count={counts.acessorios}
          />
          <QuickAccessCard
            href="/configuracoes/catalogo/outros"
            title="Outros"
            description="Ver e organizar os itens que não entram nas outras categorias."
            count={counts.outros}
          />
        </div>
      </section>

      <section className="rounded-[28px] border border-gray-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Resumo rápido</h2>
            <p className="mt-1 text-sm text-gray-500">
              Uma visão geral do que já existe hoje na loja.
            </p>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-700">
            Total do catálogo geral:{" "}
            <span className="font-semibold text-black">{totalCatalogo}</span>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryStat
            label="Piscinas"
            value={counts.pools}
            href="/configuracoes/piscinas"
          />
          <SummaryStat
            label="Químicos"
            value={counts.quimicos}
            href="/configuracoes/catalogo/quimicos"
          />
          <SummaryStat
            label="Acessórios"
            value={counts.acessorios}
            href="/configuracoes/catalogo/acessorios"
          />
          <SummaryStat
            label="Outros itens"
            value={counts.outros}
            href="/configuracoes/catalogo/outros"
          />
        </div>
      </section>
    </div>
  );
}
