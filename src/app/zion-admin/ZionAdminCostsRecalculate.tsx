"use client";

import { useEffect, useRef, useState } from "react";

type Period = "day" | "week" | "month" | "year";

type VariableExpense = {
  status: string;
  currency: string;
  amount_minor: number | string;
};

type CostResponse = {
  range?: { startDate: string; endDate: string };
  totals?: { fixedCents: number };
  variableExpenses?: VariableExpense[] | null;
  dataAvailability?: {
    fixedCosts?: string;
    variableExpenses?: string;
  };
};

type OfficialDay = {
  status: string;
  totalUsd: string | null;
  estimatedBrl: string | null;
};

type OfficialResponse = {
  ok?: boolean;
  availability?: string;
  daily?: OfficialDay[];
};

type Snapshot = {
  period: Period;
  label: string;
  fixedCents: number | null;
  manualBrlCents: number | null;
  manualUsdCents: number | null;
  officialUsd: string | null;
  officialBrlCents: number | null;
  confirmedDays: number;
  checkedDays: number;
  officialComplete: boolean;
  subtotalCents: number | null;
  error: string | null;
};

const PERIODS = [
  ["day", "Dia"],
  ["week", "Semana"],
  ["month", "Mês"],
  ["year", "Ano"],
] as const;

function todayInSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function previousUtcDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function safeMinor(value: unknown): number | null {
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}

function sumMinor(values: number[]): number | null {
  const result = values.reduce((sum, value) => sum + value, 0);
  return Number.isSafeInteger(result) ? result : null;
}

function sumBrlDecimals(values: string[]): number | null {
  let total = BigInt(0);

  for (const value of values) {
    if (!/^-?\d+\.\d{2}$/.test(value)) return null;
    total += BigInt(value.replace(".", ""));
  }

  const result = Number(total);
  return Number.isSafeInteger(result) ? result : null;
}

function sumUsdDecimals(values: string[]): string | null {
  const parts = values.map((value) =>
    /^(-?)(\d+)(?:\.(\d+))?$/.exec(value),
  );

  if (parts.some((part) => !part)) return null;

  const scaleDigits = Math.max(
    0,
    ...parts.map((part) => (part?.[3] ?? "").length),
  );

  if (scaleDigits > 30) return null;

  const scale = BigInt(10) ** BigInt(scaleDigits);
  let total = BigInt(0);

  for (const part of parts) {
    if (!part) return null;

    const fraction = (part[3] ?? "").padEnd(scaleDigits, "0");
    const value =
      BigInt(part[2]) * scale +
      BigInt(fraction || "0");

    total += part[1] === "-" ? -value : value;
  }

  const negative = total < BigInt(0);
  const magnitude = negative ? -total : total;
  const integer = magnitude / scale;

  if (scaleDigits === 0) {
    return `${negative ? "-" : ""}${integer}`;
  }

  const fraction = (magnitude % scale)
    .toString()
    .padStart(scaleDigits, "0")
    .replace(/0+$/, "");

  return `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}

function brl(value: number | null): string {
  if (value === null) return "Indisponível";

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value / 100);
}

function usdMinor(value: number | null): string {
  if (value === null) return "Indisponível";
  return `US$ ${(value / 100).toFixed(2)}`;
}

async function readJson(
  url: string,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch(url, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    signal,
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok || !payload || typeof payload !== "object") {
    throw new Error("FONTE_INDISPONIVEL");
  }

  return payload;
}

async function calculatePeriod(
  period: Period,
  label: string,
  anchor: string,
  signal: AbortSignal,
): Promise<Snapshot> {
  const base: Snapshot = {
    period,
    label,
    fixedCents: null,
    manualBrlCents: null,
    manualUsdCents: null,
    officialUsd: null,
    officialBrlCents: null,
    confirmedDays: 0,
    checkedDays: 0,
    officialComplete: false,
    subtotalCents: null,
    error: null,
  };

  try {
    const params = new URLSearchParams({ period, anchor });

    const costs = (await readJson(
      `/api/zion-admin/costs?${params}`,
      signal,
    )) as CostResponse;

    if (!costs.totals || !costs.range ||
        !/^\d{4}-\d{2}-\d{2}$/.test(costs.range.startDate) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(costs.range.endDate)) {
      throw new Error("DADOS_FINANCEIROS_INVALIDOS");
    }

    const fixedCents =
      costs.dataAvailability?.fixedCosts === "available"
        ? safeMinor(costs.totals.fixedCents)
        : null;

    let manualBrlCents: number | null = null;
    let manualUsdCents: number | null = null;

    if (
      costs.dataAvailability?.variableExpenses === "available" &&
      Array.isArray(costs.variableExpenses)
    ) {
      const brlAmounts: number[] = [];
      const usdAmounts: number[] = [];
      let invalid = false;

      for (const item of costs.variableExpenses) {
        if (item.status === "cancelled") continue;

        if (item.status !== "active") {
          invalid = true;
          break;
        }

        const amount = safeMinor(item.amount_minor);

        if (amount === null) {
          invalid = true;
          break;
        }

        if (item.currency === "BRL") brlAmounts.push(amount);
        else if (item.currency === "USD") usdAmounts.push(amount);
        else {
          invalid = true;
          break;
        }
      }

      if (!invalid) {
        manualBrlCents = sumMinor(brlAmounts);
        manualUsdCents = sumMinor(usdAmounts);
      }
    }

    const end = previousUtcDate(costs.range.endDate);
    const todayUtc = new Date().toISOString().slice(0, 10);
    const lastClosedUtcDay = previousUtcDate(todayUtc);
    const to = [end, anchor, lastClosedUtcDay].sort()[0];

    let officialUsd: string | null = null;
    let officialBrlCents: number | null = null;
    let confirmedDays = 0;
    let checkedDays = 0;
    let officialComplete = false;

    if (costs.range.startDate <= to) {
      const officialParams = new URLSearchParams({
        from: costs.range.startDate,
        to,
      });

      try {
        const official = (await readJson(
          `/api/zion-admin/costs/openai-official?${officialParams}`,
          signal,
        )) as OfficialResponse;

        if (official.ok === true && Array.isArray(official.daily)) {
          checkedDays = official.daily.length;

          const confirmed = official.daily.filter(
            (day) =>
              day.status === "available" ||
              day.status === "confirmed_empty",
          );

          confirmedDays = confirmed.length;

          officialComplete =
            official.availability === "complete" &&
            confirmedDays === checkedDays &&
            checkedDays > 0;

          if (confirmedDays > 0) {
            const usdValues = confirmed.map((day) =>
              day.status === "confirmed_empty"
                ? "0"
                : day.totalUsd,
            );

            if (usdValues.every((value): value is string =>
              typeof value === "string",
            )) {
              officialUsd = sumUsdDecimals(usdValues);
            }

            const brlValues = confirmed.map((day) =>
              day.status === "confirmed_empty"
                ? "0.00"
                : day.estimatedBrl,
            );

            if (brlValues.every((value): value is string =>
              typeof value === "string",
            )) {
              officialBrlCents = sumBrlDecimals(brlValues);
            }
          }
        }
      } catch {
        if (signal.aborted) throw new Error("ABORTED");
        // Falha de leitura oficial nao transforma ausencia em zero.
      }
    }

    const knownBrlSources = [fixedCents, manualBrlCents, officialBrlCents]
      .filter((value): value is number => value !== null);
    const subtotalCents =
      knownBrlSources.some((value) => value > 0) ||
      (fixedCents !== null &&
        manualBrlCents !== null &&
        officialBrlCents !== null)
        ? sumMinor(knownBrlSources)
        : null;

    return {
      ...base,
      fixedCents,
      manualBrlCents,
      manualUsdCents,
      officialUsd,
      officialBrlCents,
      confirmedDays,
      checkedDays,
      officialComplete,
      subtotalCents,
    };
  } catch {
    return {
      ...base,
      error: signal.aborted
        ? "Consulta cancelada"
        : "Não foi possível consultar este período.",
    };
  }
}

export default function ZionAdminCostsRecalculate({
  onRecalculated,
}: {
  onRecalculated: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Snapshot[] | null>(null);
  const [calculatedAt, setCalculatedAt] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => controller.current?.abort();
  }, []);

  async function recalculate() {
    if (loading) return;

    const current = new AbortController();
    controller.current = current;

    setLoading(true);

    try {
      const anchor = todayInSaoPaulo();

      const next = await Promise.all(
        PERIODS.map(([period, label]) =>
          calculatePeriod(period, label, anchor, current.signal),
        ),
      );

      if (current.signal.aborted) return;

      setResults(next);
      setCalculatedAt(
        new Intl.DateTimeFormat("pt-BR", {
          timeZone: "America/Sao_Paulo",
          dateStyle: "short",
          timeStyle: "short",
        }).format(new Date()),
      );

      onRecalculated();
    } finally {
      if (!current.signal.aborted) setLoading(false);
    }
  }

  return (
    <section
      aria-label="Recálculo dos quatro períodos"
      className="rounded-xl border border-[#304650] bg-[#101a22] p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">
            Resumo financeiro atualizado
          </h3>
          <p className="mt-1 text-[11px] text-[#91a7b6]">
            Dia, semana, mês e ano. Consulta somente os registros
            disponíveis, sem executar nova coleta financeira.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void recalculate()}
          disabled={loading}
          className="rounded-lg border border-[#378697] bg-[#153943] px-4 py-2 text-xs font-semibold text-[#b1f0f5] transition hover:bg-[#21505a] disabled:opacity-50"
        >
          {loading ? "Recalculando..." : "Recalcular agora"}
        </button>
      </div>

      {calculatedAt ? (
        <p className="mt-2 text-[11px] text-[#91a7b6]" role="status">
          Última atualização: {calculatedAt}
        </p>
      ) : null}

      {results ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {results.map((item) => (
            <section
              key={item.period}
              className="rounded-lg border border-[#293b46] bg-[#0b141c] p-3"
            >
              <h4 className="text-xs font-semibold text-[#c5f7fa]">
                {item.label}
              </h4>

              {item.error ? (
                <p className="mt-2 text-xs text-amber-200" role="status">
                  {item.error}
                </p>
              ) : (
                <div className="mt-2 space-y-2">
                  <div>
                    <p className="text-[10px] text-[#91a7b6]">
                      Subtotal conhecido em BRL
                    </p>
                    <p className="text-lg font-semibold tabular-nums text-white">
                      {brl(item.subtotalCents)}
                    </p>
                    <p className="text-[10px] text-amber-200">
                      Parcial. Não é o total efetivamente cobrado.
                    </p>
                  </div>

                  <div className="space-y-1 text-[11px] text-[#adc2ce]">
                    <p>Fixos cadastrados: {brl(item.fixedCents)}</p>
                    <p>Manuais BRL: {brl(item.manualBrlCents)}</p>
                    <p>Manuais USD: {usdMinor(item.manualUsdCents)}</p>
                    <p>
                      OpenAI oficial:{" "}
                      {item.officialUsd === null
                        ? "Não apurado"
                        : `US$ ${item.officialUsd}`}
                    </p>
                    <p>
                      OpenAI pela PTAX:{" "}
                      {brl(item.officialBrlCents)}
                    </p>
                    <p>
                      Dias OpenAI confirmados: {item.confirmedDays}
                      {item.checkedDays > 0
                        ? ` de ${item.checkedDays}`
                        : " — sem relatório disponível"}
                    </p>
                  </div>

                  <p className="text-[10px] text-[#91a7b6]">
                    OpenAI:{" "}
                    {item.officialComplete
                      ? "período confirmado"
                      : "cobertura incompleta"}
                    . Meta: cobrança ainda não comprovada.
                  </p>
                </div>
              )}
            </section>
          ))}
        </div>
      ) : null}

      <p className="mt-3 text-[11px] leading-5 text-[#91a7b6]">
        O subtotal inclui fixos cadastrados, despesas manuais em BRL
        e valores oficiais OpenAI convertidos pela PTAX quando
        disponíveis. Não inclui manuais em USD sem conversão nem
        custos Meta sem comprovação. PTAX não é o valor da fatura.
        Fixos cadastrados não significam necessariamente pagos.
      </p>
    </section>
  );
}