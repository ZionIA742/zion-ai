"use client";

import { useEffect, useState } from "react";

type OfficialDay = {
  date: string;
  status: "available" | "confirmed_empty" | "not_collected" | "unavailable";
  totalUsd: string | null;
  financialLineCount: number;
  ptaxRate?: string | null;
  ptaxQuotationDate?: string | null;
  ptaxStatus?: "same_day" | "previous_available" | "unavailable" | "not_applicable";
  estimatedBrl?: string | null;
};

type OfficialReport = {
  ok: boolean;
  source: "openai_organization_costs";
  totalUsd: string | null;
  totalFinancialLines: number;
  daily: OfficialDay[];
  collectedDays: string[];
  missingDays: string[];
  availability: "complete" | "partial" | "unavailable";
  fx?: {
    source: "bcb_ptax_venda";
    availability: "complete" | "partial" | "unavailable";
    totalBrlEstimated: string | null;
    note: string;
  };
};

function formatOfficialUsd(value: string | null): string {
  if (value === null) return "Não apurado";
  return `US$ ${value.replace(".", ",")}`;
}

function formatOfficialBrl(value: string | null | undefined): string {
  if (value == null) return "Indisponível";
  return `R$ ${value.replace(".", ",")}`;
}

function formatPtax(day: OfficialDay): string {
  if (day.status === "confirmed_empty") return "Não aplicável";
  if (day.status !== "available") return "Não apurado";
  if (!day.ptaxRate || !day.ptaxQuotationDate) return "Indisponível";
  return `${day.ptaxRate.replace(".", ",")} (${day.ptaxQuotationDate})`;
}

function formatDayBrl(day: OfficialDay): string {
  if (day.status === "confirmed_empty") return "Sem linhas";
  if (day.status !== "available") return "Não apurado";
  return formatOfficialBrl(day.estimatedBrl);
}
function lastClosedUtcDay(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1)
  ).toISOString().slice(0, 10);
}

function monthEndUtc(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
}

function dayLabel(status: OfficialDay["status"]): string {
  switch (status) {
    case "available":
      return "Apurado";
    case "confirmed_empty":
      return "Confirmado sem linhas";
    case "not_collected":
      return "Sem coleta confirmada";
    default:
      return "Indisponível";
  }
}

export default function ZionAdminOpenAiOfficialCosts() {
  const [month, setMonth] = useState(
    () => new Date().toISOString().slice(0, 7)
  );

  const [result, setResult] = useState<{
    month: string;
    report: OfficialReport | null;
    error: string | null;
  } | null>(null);

  const maxMonth = new Date().toISOString().slice(0, 7);
  const validMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(month);

  const from = validMonth ? `${month}-01` : "";
  const closedThrough = lastClosedUtcDay();
  const lastDay = validMonth ? monthEndUtc(month) : "";
  const to = validMonth
    ? (lastDay < closedThrough ? lastDay : closedThrough)
    : "";

  const hasClosedDay = validMonth && to >= from;

  // Um resultado de outro mes nunca sera exibido
  // como se pertencesse ao periodo atual.
  const currentResult = result?.month === month
    ? result
    : null;

  const report = currentResult?.report ?? null;
  const error = currentResult?.error ?? null;
  const loading = hasClosedDay && currentResult === null;

  useEffect(() => {
    if (!hasClosedDay) return;

    const controller = new AbortController();

    async function load() {
      try {
        const query = new URLSearchParams({ from, to });

        const response = await fetch(
          `/api/zion-admin/costs/openai-official?${query}`,
          {
            method: "GET",
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          }
        );

        const payload = await response.json();

        if (
          !response.ok ||
          payload?.ok !== true ||
          !Array.isArray(payload.daily) ||
          !Array.isArray(payload.collectedDays) ||
          !Array.isArray(payload.missingDays)
        ) {
          throw new Error("INVALID_OFFICIAL_COST_REPORT");
        }

        if (!controller.signal.aborted) {
          setResult({
            month,
            report: payload as OfficialReport,
            error: null,
          });
        }
      } catch {
        if (!controller.signal.aborted) {
          setResult({
            month,
            report: null,
            error:
              "Custos oficiais indisponíveis. Nenhum valor foi presumido.",
          });
        }
      }
    }

    void load();

    return () => controller.abort();
  }, [month, from, to, hasClosedDay]);
  const complete = report?.availability === "complete";
  const officialTotal = complete
    ? formatOfficialUsd(report.totalUsd)
    : "Incompleto";
  const officialBrlTotal = complete
    ? formatOfficialBrl(report?.fx?.totalBrlEstimated)
    : "Incompleto";

  return (
    <section
      aria-label="OpenAI — Custos oficiais"
      className="rounded-xl border border-[#305867] bg-[#101e27] p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">
            OpenAI — Custos oficiais
          </h3>
          <p className="mt-1 text-[11px] text-[#91a7b6]">
            Valores oficiais coletados da OpenAI, em UTC.
          </p>
        </div>
        <label className="text-xs text-[#b2cad4]">
          Mês UTC
          <input
            type="month"
            aria-label="Mês dos custos oficiais"
            min="2020-01"
            max={maxMonth || undefined}
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            className="ml-2 rounded-lg border border-[#36525f] bg-[#091721] px-2 py-1.5 text-white"
          />
        </label>
      </div>

      {loading ? (
        <p className="mt-3 text-xs text-[#9fb6c2]">
          Consultando custos oficiais...
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-xs text-amber-200">
          {error}
        </p>
      ) : null}

      {!loading && !error && month && !report ? (
        <p className="mt-3 text-xs text-[#9fb6c2]">
          Ainda não há um dia UTC encerrado para consultar neste mês.
        </p>
      ) : null}

      {report ? (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-[#29414d] p-3">
              <p className="text-[10px] uppercase text-[#96b5c1]">
                Total oficial do período
              </p>
              <p className="mt-1 break-words text-lg font-semibold tabular-nums text-[#a0edf2]">
                {officialTotal}
              </p>
              <p className="text-[10px] text-[#8da8b5]">
                {complete ? "Cobertura completa do período consultado" : "Não é um total mensal confirmado"}
              </p>
            </div>
            <div className="rounded-lg border border-[#29414d] p-3">
              <p className="text-[10px] uppercase text-[#96b5c1]">
                BRL estimado pela PTAX
              </p>
              <p className="mt-1 break-words text-lg font-semibold tabular-nums text-white">
                {officialBrlTotal}
              </p>
              <p className="text-[10px] text-[#8da8b5]">
                Estimativa cambial, não valor cobrado pelo cartão
              </p>
            </div>
            <div className="rounded-lg border border-[#29414d] p-3">
              <p className="text-[10px] uppercase text-[#96b5c1]">
                Dias confirmados
              </p>
              <p className="mt-1 text-lg font-semibold text-white">
                {report.collectedDays.length} / {report.daily.length}
              </p>
              <p className="text-[10px] text-[#8da8b5]">
                {report.missingDays.length} dia(s) sem coleta
              </p>
            </div>
            <div className="rounded-lg border border-[#29414d] p-3">
              <p className="text-[10px] uppercase text-[#96b5c1]">
                Cobertura financeira
              </p>
              <p className="mt-1 text-lg font-semibold text-white">
                {report.availability === "complete"
                  ? "Completa"
                  : report.availability === "partial"
                    ? "Parcial"
                    : "Indisponível"}
              </p>
              <p className="text-[10px] text-[#8da8b5]">
                {report.totalFinancialLines} linha(s) confirmada(s)
              </p>
            </div>
          </div>

          <details className="mt-3 rounded-lg border border-[#29414d] p-3">
            <summary className="cursor-pointer text-xs font-semibold text-[#a3e7ee]">
              Expandir histórico diário ({report.daily.length} dias)
            </summary>
            <div className="mt-3 max-h-80 overflow-auto">
              <table className="w-full min-w-[820px] text-left text-xs">
                <thead>
                  <tr className="border-b border-[#36505c] text-[#9db6c2]">
                    <th className="pb-2">Dia UTC</th>
                    <th className="pb-2">Situação</th>
                    <th className="pb-2 text-right">USD oficial</th>
                    <th className="pb-2 text-right">PTAX venda (data)</th>
                    <th className="pb-2 text-right">BRL estimado</th>
                  </tr>
                </thead>
                <tbody>
                  {report.daily.slice().reverse().map((day) => (
                    <tr key={day.date} className="border-b border-[#233b46] last:border-0">
                      <td className="py-2">{day.date}</td>
                      <td className="py-2 text-[#9fb7c3]">
                        {dayLabel(day.status)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-[#a3edf0]">
                        {day.status === "available"
                          ? formatOfficialUsd(day.totalUsd)
                          : day.status === "confirmed_empty"
                            ? "Sem linhas"
                            : "Não apurado"}
                      </td>
                      <td className="py-2 text-right tabular-nums text-[#9fb7c3]">
                        {formatPtax(day)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-[#a3edf0]">
                        {formatDayBrl(day)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <p className="mt-3 text-[11px] leading-5 text-[#8ca6b5]">
            Fonte: OpenAI Organization Costs. Valores oficiais independentes
            das estimativas de ai_runs.cost_usd. Não são somados novamente
            ao Total consolidado. O mês corrente considera somente dias UTC
            já encerrados.
          </p>
          <p className="mt-1 text-[11px] leading-5 text-[#8ca6b5]">
            BRL estimado pela PTAX venda do Banco Central, com data
            da cotação identificada. Não representa cobrança efetiva.
            Sem cotação disponível, nenhum valor em reais é presumido.
          </p>
        </>
      ) : null}
    </section>
  );
}
