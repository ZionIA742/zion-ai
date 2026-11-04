"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

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
  | { month: string; refreshKey: number; catalogRevision: number; status: "ready"; snapshot: MonthlySnapshot }
  | { month: string; refreshKey: number; catalogRevision: number; status: "error" };

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
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftCategory, setDraftCategory] = useState("");
  const [draftCurrency, setDraftCurrency] = useState<Currency>("BRL");
  const [catalogSaving, setCatalogSaving] = useState(false);
  const [catalogFeedback, setCatalogFeedback] = useState<string | null>(null);
  const catalogOperationKey = useRef<string | null>(null);

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
          setLoad({ month, refreshKey, catalogRevision, status: "ready", snapshot });
        }
      } catch {
        if (!controller.signal.aborted) {
          setLoad({ month, refreshKey, catalogRevision, status: "error" });
        }
      }
    }

    void fetchMonth();

    return () => controller.abort();
  }, [month, refreshKey, catalogRevision]);

  const current = load?.month === month && load.refreshKey === refreshKey && load.catalogRevision === catalogRevision ? load : null;
  const monthNumber = Number(month.slice(5, 7));
  const monthLabel =
    `${MONTHS[monthNumber - 1] ?? "Mês"} de ${month.slice(0, 4)}`;

  async function submitCatalogItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (catalogSaving) return;

    const name = draftName.trim();
    const category = draftCategory.trim();

    if (!name || name.length > 100 ||
        !category || category.length > 80) {
      setCatalogFeedback("Informe um nome e uma categoria válidos.");
      return;
    }

    if (!catalogOperationKey.current) {
      catalogOperationKey.current =
        `zion-admin-catalog-${crypto.randomUUID()}`;
    }

    setCatalogSaving(true);
    setCatalogFeedback(null);

    try {
      const response = await fetch(
        "/api/zion-admin/costs/catalog",
        {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "created",
            operationKey: catalogOperationKey.current,
            name,
            category,
            currency: draftCurrency,
          }),
        },
      );

      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const error =
          payload && typeof payload === "object" &&
          "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "Não foi possível cadastrar o nome.";

        throw new Error(error);
      }

      const confirmed =
        payload && typeof payload === "object" &&
        "ok" in payload && payload.ok === true &&
        "item" in payload &&
        payload.item && typeof payload.item === "object" &&
        "id" in payload.item &&
        typeof payload.item.id === "string";

      if (!confirmed) {
        throw new Error("Cadastro não confirmado pelo servidor.");
      }

      catalogOperationKey.current = null;
      setDraftName("");
      setDraftCategory("");
      setDraftCurrency("BRL");
      setCreating(false);

      // Uma nova revisão força a leitura do catálogo.
      // Os totais antigos ficam ocultos até a resposta.
      setCatalogRevision((value) => value + 1);

      setCatalogFeedback(
        "Nome cadastrado. Nenhuma despesa financeira foi lançada.",
      );
    } catch (caught) {
      setCatalogFeedback(
        caught instanceof Error
          ? caught.message
          : "Não foi possível cadastrar o nome.",
      );
    } finally {
      setCatalogSaving(false);
    }
  }
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

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={catalogSaving}
          onClick={() => {
            setCreating((value) => !value);
            setCatalogFeedback(null);
            catalogOperationKey.current = null;
          }}
          className="rounded-lg border border-[#378697] bg-[#153943] px-3 py-2 text-xs font-semibold text-[#b1f0f5] disabled:opacity-50"
        >
          {creating ? "Fechar cadastro" : "+ Cadastrar nome"}
        </button>
      </div>

      {catalogFeedback ? (
        <p role="status" className="mt-2 text-xs text-[#c2eaf0]">
          {catalogFeedback}
        </p>
      ) : null}

      {creating ? (
        <form
          onSubmit={(event) => void submitCatalogItem(event)}
          className="mt-3 grid gap-2 rounded-lg border border-[#304650] p-3 sm:grid-cols-2"
        >
          <label className="text-xs text-[#aebdc5]">
            Nome permanente
            <input
              required
              maxLength={100}
              disabled={catalogSaving}
              value={draftName}
              onChange={(event) => {
                setDraftName(event.target.value);
                catalogOperationKey.current = null;
              }}
              placeholder="Ex.: Gasolina"
              className="mt-1 w-full rounded-lg border border-[#304650] bg-[#08131b] px-3 py-2 text-xs text-white"
            />
          </label>

          <label className="text-xs text-[#aebdc5]">
            Categoria
            <input
              required
              maxLength={80}
              disabled={catalogSaving}
              value={draftCategory}
              onChange={(event) => {
                setDraftCategory(event.target.value);
                catalogOperationKey.current = null;
              }}
              placeholder="Ex.: Transporte"
              className="mt-1 w-full rounded-lg border border-[#304650] bg-[#08131b] px-3 py-2 text-xs text-white"
            />
          </label>

          <label className="text-xs text-[#aebdc5]">
            Moeda
            <select
              value={draftCurrency}
              disabled={catalogSaving}
              onChange={(event) => {
                setDraftCurrency(event.target.value as Currency);
                catalogOperationKey.current = null;
              }}
              className="mt-1 w-full rounded-lg border border-[#304650] bg-[#08131b] px-3 py-2 text-xs text-white"
            >
              <option value="BRL">BRL — Real</option>
              <option value="USD">USD — Dólar</option>
            </select>
          </label>

          <div className="flex items-end justify-end">
            <button
              type="submit"
              disabled={catalogSaving}
              className="rounded-lg border border-[#378697] bg-[#153943] px-4 py-2 text-xs font-semibold text-[#b1f0f5] disabled:opacity-50"
            >
              {catalogSaving ? "Salvando..." : "Salvar nome"}
            </button>
          </div>

          <p className="text-[11px] text-[#91a7b6] sm:col-span-2">
            Este cadastro cria apenas o nome permanente.
            Os valores são lançados separadamente, por competência.
          </p>
        </form>
      ) : null}
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