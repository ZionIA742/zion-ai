"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useStoreContext } from "@/components/StoreProvider";

type ScheduleItem = {
  itemKind: "appointment" | "block" | string;
  itemId: string;
  organizationId: string;
  storeId: string;
  leadId: string | null;
  conversationId: string | null;
  title: string;
  itemType: string;
  status: string;
  startAt: string;
  endAt: string;
  customerName: string | null;
  customerPhone: string | null;
  addressText: string | null;
  notes: string | null;
  source: string;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

type ScheduleApiResponse = {
  ok: boolean;
  error?: string;
  message?: string;
  organizationId?: string;
  storeId?: string;
  start?: string;
  end?: string;
  count?: number;
  items?: ScheduleItem[];
};

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
}

function formatShortDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getCurrentMonthRange() {
  const now = new Date();

  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

function formatItemKind(value: string) {
  if (value === "appointment") return "Compromisso";
  if (value === "block") return "Bloqueio";
  return value || "-";
}

function formatItemType(value: string) {
  const normalized = String(value || "").toLowerCase();

  if (normalized === "technical_visit") return "Visita técnica";
  if (normalized === "installation") return "Instalação";
  if (normalized === "follow_up") return "Retorno";
  if (normalized === "meeting") return "Reunião";
  if (normalized === "personal_unavailable") return "Indisponível";
  if (normalized === "team_unavailable") return "Equipe indisponível";
  if (normalized === "holiday") return "Bloqueio por feriado";
  if (normalized === "manual_block") return "Bloqueio manual";
  if (normalized === "other") return "Outro";
  return value || "-";
}

function getStatusBadge(status: string) {
  const normalized = String(status || "").toLowerCase();

  if (normalized === "scheduled") {
    return "bg-blue-50 text-blue-700 ring-blue-200";
  }

  if (normalized === "rescheduled") {
    return "bg-amber-50 text-amber-700 ring-amber-200";
  }

  if (normalized === "completed") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  }

  if (normalized === "cancelled") {
    return "bg-red-50 text-red-700 ring-red-200";
  }

  if (normalized === "blocked") {
    return "bg-gray-100 text-gray-700 ring-gray-300";
  }

  return "bg-gray-50 text-gray-700 ring-gray-200";
}

export default function SchedulePage() {
  const {
    loading: storeLoading,
    error: storeError,
    organizationId,
    activeStoreId,
    activeStore,
  } = useStoreContext();

  const monthRange = useMemo(() => getCurrentMonthRange(), []);
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const canLoadSchedule = useMemo(() => {
    return !storeLoading && !!organizationId && !!activeStoreId;
  }, [storeLoading, organizationId, activeStoreId]);

  const loadSchedule = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent ?? false;

      if (!canLoadSchedule || !organizationId || !activeStoreId) {
        return;
      }

      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setErrorText(null);

      try {
        const params = new URLSearchParams({
          organizationId,
          storeId: activeStoreId,
          start: monthRange.start,
          end: monthRange.end,
        });

        const response = await fetch(`/api/schedule?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
        });

        const json = (await response.json()) as ScheduleApiResponse;

        if (!response.ok || !json.ok) {
          setErrorText(json.message || "Erro ao carregar agenda.");
          setItems([]);

          if (silent) {
            setRefreshing(false);
          } else {
            setLoading(false);
          }
          return;
        }

        setItems(json.items || []);

        if (silent) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      } catch (error: any) {
        setErrorText(error?.message || "Erro inesperado ao carregar agenda.");
        setItems([]);

        if (silent) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [canLoadSchedule, organizationId, activeStoreId, monthRange.start, monthRange.end]
  );

  useEffect(() => {
    if (!canLoadSchedule) return;
    void loadSchedule();
  }, [canLoadSchedule, loadSchedule]);

  const counts = useMemo(() => {
    const appointments = items.filter((item) => item.itemKind === "appointment").length;
    const blocks = items.filter((item) => item.itemKind === "block").length;

    return {
      total: items.length,
      appointments,
      blocks,
    };
  }, [items]);

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Agenda</h1>

            <p className="text-sm text-gray-600">
              Visualização inicial da agenda da loja no período do mês atual.
            </p>

            <div className="mt-2 text-xs text-gray-500">
              {storeLoading
                ? "Carregando contexto da loja..."
                : storeError
                ? `Erro no contexto da loja: ${storeError}`
                : `Loja ativa: ${activeStore?.name ?? "Sem loja ativa"} • Organização: ${
                    organizationId ?? "-"
                  }`}
            </div>

            <div className="mt-1 text-xs text-gray-500">
              Período carregado: {formatShortDateTime(monthRange.start)} até{" "}
              {formatShortDateTime(monthRange.end)}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {refreshing ? (
              <div className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600 ring-1 ring-black/10">
                Atualizando...
              </div>
            ) : null}

            <button
              onClick={() => void loadSchedule()}
              disabled={loading || storeLoading || !organizationId || !activeStoreId}
              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-black/10 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Recarregar
            </button>
          </div>
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <div className="text-sm text-gray-500">Total de itens</div>
            <div className="mt-2 text-2xl font-bold text-gray-900">{counts.total}</div>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <div className="text-sm text-gray-500">Compromissos</div>
            <div className="mt-2 text-2xl font-bold text-gray-900">
              {counts.appointments}
            </div>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
            <div className="text-sm text-gray-500">Bloqueios</div>
            <div className="mt-2 text-2xl font-bold text-gray-900">{counts.blocks}</div>
          </div>
        </div>

        {errorText ? (
          <div className="mb-4 rounded-xl bg-red-50 p-4 text-red-800 ring-1 ring-red-200">
            {errorText}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
          <table className="w-full text-sm">
            <thead className="border-b border-black/5 bg-gray-50">
              <tr className="text-left text-gray-600">
                <th className="px-4 py-3 font-semibold">Título</th>
                <th className="px-4 py-3 font-semibold">Categoria</th>
                <th className="px-4 py-3 font-semibold">Tipo</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Início</th>
                <th className="px-4 py-3 font-semibold">Fim</th>
                <th className="px-4 py-3 font-semibold">Cliente</th>
                <th className="px-4 py-3 font-semibold">Observações</th>
              </tr>
            </thead>

            <tbody>
              {(loading || storeLoading) && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-gray-500">
                    Carregando agenda...
                  </td>
                </tr>
              )}

              {!loading && !storeLoading && items.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-gray-500">
                    Nenhum item encontrado para a loja ativa neste período.
                  </td>
                </tr>
              )}

              {!loading &&
                !storeLoading &&
                items.map((item) => (
                  <tr key={item.itemId} className="border-b border-black/5 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-900">{item.title || "-"}</div>
                      <div className="mt-1 text-xs text-gray-500">{item.itemId}</div>
                    </td>

                    <td className="px-4 py-3">{formatItemKind(item.itemKind)}</td>

                    <td className="px-4 py-3">{formatItemType(item.itemType)}</td>

                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-semibold ring-1 ${getStatusBadge(
                          item.status
                        )}`}
                      >
                        {item.status || "-"}
                      </span>
                    </td>

                    <td className="px-4 py-3">{formatDateTime(item.startAt)}</td>

                    <td className="px-4 py-3">{formatDateTime(item.endAt)}</td>

                    <td className="px-4 py-3">
                      {item.customerName ? (
                        <div>
                          <div className="font-medium text-gray-900">{item.customerName}</div>
                          <div className="text-xs text-gray-500">
                            {item.customerPhone || "-"}
                          </div>
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>

                    <td className="max-w-md px-4 py-3 text-gray-600">
                      <div className="whitespace-pre-wrap break-words">
                        {item.notes || item.addressText || "-"}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}