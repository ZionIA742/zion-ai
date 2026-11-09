"use client";

import { useEffect, useState } from "react";

type HistoryMonth = {
  month: string;
  preclosure: {
    status: "not_generated" | "preliminary";
    revision: number | null;
    pendingSources: string[];
    auditVerified: boolean;
  };
  revenue: {
    status: "not_reported" | "confirmed";
    amountBrlCents: number | null;
    revision: number | null;
    updatedAt: string | null;
  };
  snapshotRevenue: {
    status:
      | "no_preclosure"
      | "legacy_not_recorded"
      | "confirmed"
      | "not_reported";
    amountBrlCents: number | null;
    revision: number | null;
    matchesCurrent: boolean | null;
  };
  costs: {
    fixedRegisteredBrlCents: number | null;
    manualRegisteredBrlCents: number | null;
    openAiKnownBrlCents: number | null;
    knownSubtotalBrlCents: number | null;
    complete: boolean;
  };
  result: {
    status: "unavailable" | "partial";
    netBrlCents: number | null;
    definitive: false;
    basis: string;
  };
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validCents(value: unknown, negative = false): boolean {
  return value === null || (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    (negative || value >= 0)
  );
}

function validateHistory(raw: unknown): HistoryMonth[] {
  const payload = asObject(raw);

  if (
    !payload ||
    payload.ok !== true ||
    !Array.isArray(payload.history) ||
    payload.history.length > 12 ||
    payload.definitiveFinancialCloseAvailable !== false
  ) {
    throw new Error("O histórico financeiro retornou dados inválidos.");
  }

  const months = new Set<string>();

  for (const item of payload.history) {
    const row = asObject(item);
    const pre = asObject(row?.preclosure);
    const revenue = asObject(row?.revenue);
    const snapshot = asObject(row?.snapshotRevenue);
    const costs = asObject(row?.costs);
    const result = asObject(row?.result);

    if (
      !row ||
      typeof row.month !== "string" ||
      !/^20\d{2}-(0[1-9]|1[0-2])-01$/.test(row.month) ||
      months.has(row.month) ||
      !pre || !revenue || !snapshot || !costs || !result ||
      !["not_generated", "preliminary"].includes(String(pre.status)) ||
      !Array.isArray(pre.pendingSources) ||
      !pre.pendingSources.every((v: unknown) => typeof v === "string") ||
      !["confirmed", "not_reported"].includes(String(revenue.status)) ||
      !["no_preclosure", "legacy_not_recorded", "confirmed", "not_reported"]
        .includes(String(snapshot.status)) ||
      !validCents(revenue.amountBrlCents) ||
      !validCents(snapshot.amountBrlCents) ||
      !validCents(costs.knownSubtotalBrlCents) ||
      !validCents(costs.fixedRegisteredBrlCents) ||
      !validCents(costs.manualRegisteredBrlCents) ||
      !validCents(costs.openAiKnownBrlCents) ||
      !validCents(result.netBrlCents, true) ||
      costs.complete !== false ||
      result.definitive !== false ||
      !["partial", "unavailable"].includes(String(result.status))
    ) {
      throw new Error("O histórico financeiro contém valores inconsistentes.");
    }

    if (
      (revenue.status === "confirmed" &&
        (revenue.amountBrlCents === null ||
          !Number.isSafeInteger(revenue.revision))) ||
      (revenue.status === "not_reported" &&
        revenue.amountBrlCents !== null) ||
      (result.status === "partial" && result.netBrlCents === null) ||
      (pre.status === "preliminary" && pre.auditVerified !== true)
    ) {
      throw new Error("O histórico financeiro não pôde ser validado.");
    }

    months.add(row.month);
  }

  return payload.history as HistoryMonth[];
}

async function loadHistory(signal: AbortSignal): Promise<HistoryMonth[]> {
  const response = await fetch("/api/zion-admin/financial-history", {
    credentials: "include",
    cache: "no-store",
    signal,
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error = asObject(payload)?.error;
    throw new Error(
      typeof error === "string"
        ? error
        : "Não foi possível consultar o histórico financeiro.",
    );
  }

  return validateHistory(payload);
}

function brl(value: number | null): string {
  if (value === null) return "Não informado";

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value / 100);
}

function monthName(month: string): string {
  const year = Number(month.slice(0, 4));
  const number = Number(month.slice(5, 7));

  const formattedMonth = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, number - 1, 1)));
  return formattedMonth.charAt(0).toLocaleUpperCase("pt-BR") +
    formattedMonth.slice(1);
}

const pendingLabels: Record<string, string> = {
  fixed_costs: "Custos fixos",
  manual_expenses: "Despesas manuais",
  manual_revenue: "Receita não informada",
  openai_official: "Apuração oficial OpenAI",
  openai_ptax: "Conversão PTAX",
  meta_financial_authority: "Comprovação financeira da Meta",
  meta_invoice: "Comprovação financeira da Meta",
};

function snapshotRevenueLabel(item: HistoryMonth): string {
  const snapshot = item.snapshotRevenue;

  switch (snapshot.status) {
    case "confirmed":
      return `${brl(snapshot.amountBrlCents)} (revisão ${snapshot.revision})`;
    case "not_reported":
      return "Não informada no pré-fechamento";
    case "legacy_not_recorded":
      return "Não registrada no modelo anterior";
    default:
      return "Sem pré-fechamento";
  }
}

export default function ZionAdminFinancialHistory() {
  const [history, setHistory] = useState<HistoryMonth[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void loadHistory(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setHistory(result);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Histórico financeiro indisponível.",
          );
        }
      });

    return () => controller.abort();
  }, []);

  return (
    <section
      aria-label="Histórico financeiro mensal"
      className="rounded-2xl border border-cyan-500/20 bg-[#0b202b] p-4 md:p-5"
    >
      <h3 className="text-base font-semibold text-white">
        Histórico financeiro mensal
      </h3>

      <p className="mt-1 text-xs leading-5 text-[#9fb6c2]">
        Últimos 12 meses. Receitas declaradas e custos conhecidos.
        Resultados parciais não representam lucro ou prejuízo definitivo.
      </p>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-amber-200">
          {error}
        </p>
      ) : history === null ? (
        <p role="status" className="mt-4 text-sm text-[#9fb6c2]">
          Carregando histórico financeiro...
        </p>
      ) : history.length === 0 ? (
        <p className="mt-4 text-sm text-[#9fb6c2]">
          Nenhuma competência disponível.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {history.map((item) => (
            <details
              key={item.month}
              className="rounded-xl border border-white/10 bg-white/[0.03]"
            >
              <summary className="grid cursor-pointer gap-3 px-3 py-3 text-sm sm:grid-cols-4 sm:items-center">
                <div>
                  <span className="block font-semibold text-white">
                    {monthName(item.month)}
                  </span>
                  <span className="text-xs text-[#9fb6c2]">
                    {item.preclosure.status === "preliminary"
                      ? `Pré-fechamento · revisão ${item.preclosure.revision}`
                      : "Sem pré-fechamento"}
                  </span>
                </div>

                <div>
                  <span className="block text-xs text-[#9fb6c2]">
                    Receita declarada
                  </span>
                  <span className="font-medium text-white">
                    {item.revenue.status === "confirmed"
                      ? brl(item.revenue.amountBrlCents)
                      : "Não informada"}
                  </span>
                </div>

                <div>
                  <span className="block text-xs text-[#9fb6c2]">
                    Custos conhecidos
                  </span>
                  <span className="font-medium text-white">
                    {item.costs.knownSubtotalBrlCents === null
                      ? "Não apurados"
                      : brl(item.costs.knownSubtotalBrlCents)}
                  </span>
                </div>

                <div>
                  <span className="block text-xs text-[#9fb6c2]">
                    Resultado parcial
                  </span>
                  <span className="font-semibold text-white">
                    {item.result.status === "partial"
                      ? brl(item.result.netBrlCents)
                      : "Não calculável"}
                  </span>
                </div>
              </summary>

              <div className="space-y-3 border-t border-white/10 px-3 py-3 text-xs text-[#c2d4de]">
                <div className="grid gap-2 sm:grid-cols-2">
                  <p>
                    Custos fixos cadastrados:{" "}
                    <strong>{brl(item.costs.fixedRegisteredBrlCents)}</strong>
                  </p>
                  <p>
                    Despesas manuais:{" "}
                    <strong>{brl(item.costs.manualRegisteredBrlCents)}</strong>
                  </p>
                  <p>
                    OpenAI conhecido em BRL:{" "}
                    <strong>{brl(item.costs.openAiKnownBrlCents)}</strong>
                  </p>
                  <p>
                    Revisão da receita atual:{" "}
                    <strong>{item.revenue.revision ?? "Não registrada"}</strong>
                  </p>
                </div>

                <p>
                  Receita registrada no pré-fechamento:{" "}
                  <strong>{snapshotRevenueLabel(item)}</strong>
                </p>

                {item.snapshotRevenue.matchesCurrent === false ? (
                  <p className="text-amber-200">
                    A receita atual é diferente daquela registrada no
                    pré-fechamento. O resultado exibido combina a receita
                    atual com os últimos custos conhecidos.
                  </p>
                ) : null}

                {item.preclosure.status === "not_generated" ? (
                  <p>Pré-fechamento ainda não gerado para esta competência.</p>
                ) : item.preclosure.pendingSources.length > 0 ? (
                  <div>
                    <p className="font-semibold text-amber-100">
                      Fontes pendentes
                    </p>
                    <ul className="mt-1 list-inside list-disc space-y-1">
                      {item.preclosure.pendingSources.map((source) => (
                        <li key={source}>
                          {pendingLabels[source] ?? source}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p>
                    Nenhuma pendência listada no pré-fechamento.
                    Isso não comprova fechamento definitivo.
                  </p>
                )}

                <p className="text-[#9fb6c2]">
                  O histórico apresenta dados preliminares e não comprova
                  pagamento de despesas ou faturamento dos fornecedores.
                </p>
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}