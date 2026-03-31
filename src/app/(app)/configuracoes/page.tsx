"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useStoreContext } from "@/components/StoreProvider";
import { supabase } from "@/lib/supabaseBrowser";

type CountState = {
  pools: number;
  quimicos: number;
  acessorios: number;
  outros: number;
};

function normalizeCategory(value: string | null | undefined) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "quimicos") return "quimicos";
  if (normalized === "acessorios") return "acessorios";
  return "outros";
}

function QuickCard({
  href,
  title,
  description,
  count,
}: {
  href: string;
  title: string;
  description: string;
  count?: number;
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-gray-200 bg-white p-4 transition hover:border-black/20 hover:bg-gray-50"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <p className="mt-1 text-sm leading-5 text-gray-600">{description}</p>
        </div>
        {typeof count === "number" ? (
          <span className="inline-flex min-w-[2.2rem] justify-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700">
            {count}
          </span>
        ) : null}
      </div>

      <div className="mt-3 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500 group-hover:text-gray-700">
        Abrir
      </div>
    </Link>
  );
}

export default function ConfiguracoesPage() {
  const { organizationId, activeStoreId } = useStoreContext();

  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [counts, setCounts] = useState<CountState>({
    pools: 0,
    quimicos: 0,
    acessorios: 0,
    outros: 0,
  });

  const hasValidStoreContext = Boolean(organizationId && activeStoreId);

  useEffect(() => {
    async function fetchCounts() {
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

        for (const row of catalogResult.data || []) {
          const category = normalizeCategory((row as any)?.metadata?.categoria);
          nextCounts[category] += 1;
        }

        setCounts(nextCounts);
      } catch (error: any) {
        setErrorText(error?.message ?? "Erro ao carregar a visão geral das configurações.");
      } finally {
        setLoading(false);
      }
    }

    void fetchCounts();
  }, [organizationId, activeStoreId]);

  const totalCatalogo = useMemo(
    () => counts.quimicos + counts.acessorios + counts.outros,
    [counts]
  );

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h1 className="text-2xl font-black tracking-[-0.02em] text-black">
          Configurações
        </h1>
        <p className="text-sm text-gray-600">
          Escolha a área que você quer abrir.
        </p>
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

      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Acessos rápidos</h2>
            <p className="mt-1 text-xs text-gray-500">
              Tudo em um lugar, sem prender na tela errada.
            </p>
          </div>
          {loading ? (
            <span className="text-xs text-gray-500">Carregando...</span>
          ) : null}
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <QuickCard
            href="/configuracoes/piscinas"
            title="Piscinas"
            description="Ver, editar, excluir e revisar fotos das piscinas cadastradas."
            count={counts.pools}
          />
          <QuickCard
            href="/configuracoes/catalogo/quimicos"
            title="Químicos"
            description="Ver e organizar os produtos químicos da loja."
            count={counts.quimicos}
          />
          <QuickCard
            href="/configuracoes/catalogo/acessorios"
            title="Acessórios"
            description="Ver e organizar os acessórios cadastrados."
            count={counts.acessorios}
          />
          <QuickCard
            href="/configuracoes/catalogo/outros"
            title="Outros"
            description="Ver e organizar os itens que não entram nas outras categorias."
            count={counts.outros}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Resumo rápido</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
              Piscinas
            </div>
            <div className="mt-1 text-lg font-bold text-gray-900">{counts.pools}</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
              Químicos
            </div>
            <div className="mt-1 text-lg font-bold text-gray-900">{counts.quimicos}</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
              Acessórios
            </div>
            <div className="mt-1 text-lg font-bold text-gray-900">{counts.acessorios}</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
              Outros itens
            </div>
            <div className="mt-1 text-lg font-bold text-gray-900">
              {counts.outros}
            </div>
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-700">
          Total do catálogo geral: <span className="font-semibold text-gray-900">{totalCatalogo}</span>
        </div>
      </section>
    </div>
  );
}
