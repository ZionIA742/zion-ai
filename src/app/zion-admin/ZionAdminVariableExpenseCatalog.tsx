"use client";

import { useEffect, useState } from "react";

type Currency = "BRL" | "USD";

type CatalogItem = {
  id: string;
  name: string;
  category: string;
  currency: Currency;
  archived_at: string | null;
};

type CatalogMonthlyRow = CatalogItem & {
  totalMinor: number;
};

type MonthlySnapshot = {
  month: string;
  items: CatalogMonthlyRow[];
  unlinkedActive: number;
};

type LoadState =
  | { month: string; refreshKey: number; status: "ready"; snapshot: MonthlySnapshot }
  | { month: string; refreshKey: number; status: "error" };

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril",
  "Maio", "Junho", "Julho", "Agosto",
  "Setembro", "Outubro", "Novembro", "Dezembro",
];

function money(minor: number, currency: Currency) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format(minor / 100);
}

function readPositiveMinor(value: unknown): number | null {
  if (
    typeof value !== "string" &&
    typeof value !== "number"
  ) return null;

  if (typeof value === "string" && !/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);

  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : null;
}

function buildSnapshot(
  payload: unknown,
  expectedMonth: string,
): MonthlySnapshot {
  if (!payload || typeof payload !== "object") {
    throw new Error("CATALOG_RESPONSE_INVALID");
  }

  const body = payload as Record<string, unknown>;

  if (
    body.month !== expectedMonth ||
    !Array.isArray(body.items) ||
    !Array.isArray(body.monthlyExpenses)
  ) {
    throw new Error("CATALOG_RESPONSE_INCOMPLETE");
  }

  const items = new Map<string, CatalogMonthlyRow>();

  for (const raw of body.items) {
    if (!raw || typeof raw !== "object") {
      throw new Error("CATALOG_ITEM_INVALID");
    }

    const item = raw as Record<string, unknown>;

    if (
      typeof item.id !== "string" ||
      !item.id ||
      typeof item.name !== "string" ||
      !item.name ||
      typeof item.category !== "string" ||
      !item.category ||
      (item.currency !== "BRL" && item.currency !== "USD") ||
      (item.archived_at !== null &&
        typeof item.archived_at !== "string") ||
      items.has(item.id)
    ) {
      throw new Error("CATALOG_ITEM_INVALID");
    }

    items.set(item.id, {
      id: item.id,
      name: item.name,
      category: item.category,
      currency: item.currency,
      archived_at: item.archived_at,
      totalMinor: 0,
    });
  }

  let unlinkedActive = 0;

  for (const raw of body.monthlyExpenses) {
    if (!raw || typeof raw !== "object") {
      throw new Error("CATALOG_EXPENSE_INVALID");
    }

    const expense = raw as Record<string, unknown>;

    if (
      expense.status !== "active" &&
      expense.status !== "cancelled"
    ) {
      throw new Error("CATALOG_EXPENSE_STATUS_INVALID");
    }

    // Cancelamentos permanecem no histórico,
    // mas nunca compõem o valor do mês.
    if (expense.status === "cancelled") continue;

    const amount = readPositiveMinor(expense.amount_minor);

    if (amount === null) {
      throw new Error("CATALOG_EXPENSE_AMOUNT_INVALID");
    }

    if (expense.catalog_item_id === null) {
      unlinkedActive++;
      continue;
    }

    if (typeof expense.catalog_item_id !== "string") {
      throw new Error("CATALOG_EXPENSE_LINK_INVALID");
    }

    const item = items.get(expense.catalog_item_id);

    if (!item || item.currency !== expense.currency) {
      throw new Error("CATALOG_EXPENSE_REFERENCE_INVALID");
    }

    const updated = item.totalMinor + amount;

    if (!Number.isSafeInteger(updated)) {
      throw new Error("CATALOG_EXPENSE_TOTAL_OVERFLOW");
    }

    item.totalMinor = updated;
  }

  return {
    month: expectedMonth,
    items: [...items.values()],
    unlinkedActive,
  };
}

export default function ZionAdminVariableExpenseCatalog({
  month,
  refreshKey,
}: {
  month: string;
  refreshKey: number;
}) {
  const [load, setLoad] = useState<LoadState | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchMonth() {
      try {
        const params = new URLSearchParams({ month });
        const response = await fetch(
          `/api/zion-admin/costs/catalog?${params}`,
          {
            cache: "no-store",
            credentials: "include",
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw new Error("CATALOG_MONTH_UNAVAILABLE");
        }

        const payload: unknown = await response.json();
        const snapshot = buildSnapshot(payload, month);

        if (!controller.signal.aborted) {
          setLoad({ month, refreshKey, status: "ready", snapshot });
        }
      } catch {
        if (!controller.signal.aborted) {
          setLoad({ month, refreshKey, status: "error" });
        }
      }
    }

    void fetchMonth();

    return () => controller.abort();
  }, [month, refreshKey]);

  const current = load?.month === month && load.refreshKey === refreshKey ? load : null;
  const monthNumber = Number(month.slice(5, 7));
  const monthLabel =
    `${MONTHS[monthNumber - 1] ?? "Mês"} de ${month.slice(0, 4)}`;

  return (
    <div className="mt-3 rounded-lg border border-[#304650] bg-[#0b1820] p-3">
      <h4 className="text-xs font-semibold text-[#c7f5f7]">
        Catálogo permanente — {monthLabel}
      </h4>

      <p className="mt-1 text-[11px] text-[#91a7b6]">
        Valores da competência mensal completa, independentemente
        do filtro geral do painel. Sem lançamento, o valor zero
        é apenas exibido e não é gravado.
      </p>

      {!current ? (
        <p className="mt-3 text-xs text-[#a5b9c5]">
          Carregando catálogo e lançamentos mensais...
        </p>
      ) : current.status === "error" ? (
        <p role="alert" className="mt-3 text-xs text-amber-200">
          Catálogo ou lançamentos mensais indisponíveis.
          Nenhum valor foi presumido.
        </p>
      ) : current.snapshot.items.length === 0 ? (
        <p className="mt-3 text-xs text-[#a5b9c5]">
          Nenhum nome cadastrado no catálogo permanente.
          O cadastro de nomes será integrado nesta seção.
        </p>
      ) : (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] uppercase text-[#8ba7b6]">
                <tr className="border-b border-[#304650]">
                  <th className="pb-2">Despesa</th>
                  <th className="pb-2">Categoria</th>
                  <th className="pb-2 text-right">Valor do mês</th>
                  <th className="pb-2 text-right">Estado</th>
                </tr>
              </thead>
              <tbody>
                {current.snapshot.items.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-[#24333c] last:border-0"
                  >
                    <td className="py-2.5 pr-2 font-medium text-[#e3f1f2]">
                      {item.name}
                    </td>
                    <td className="py-2.5 text-[#9bb0bd]">
                      {item.category}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-[#c7f5f7]">
                      {money(item.totalMinor, item.currency)}
                    </td>
                    <td className="py-2.5 text-right text-[#9bb0bd]">
                      {item.archived_at ? "Arquivado" : "Ativo"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {current.snapshot.unlinkedActive > 0 ? (
            <p className="mt-2 text-xs text-amber-200">
              Existem {current.snapshot.unlinkedActive} lançamento(s)
              ativo(s) sem vínculo com o catálogo nesta competência.
              Eles não foram associados por nome nem somados aos itens.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}