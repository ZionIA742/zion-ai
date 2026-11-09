"use client";

import { useEffect, useRef, useState } from "react";

type RevenueRecord = {
  amountBrlCents: number;
  revision: number;
  updatedAt: string;
};
type RevenueHistory = {
  revision: number;
  amountBrlCents: number;
  recordedAt: string;
};
type RevenueData = {
  ok: true;
  month: string;
  confirmed: boolean;
  revenue: RevenueRecord | null;
  history: RevenueHistory[];
};
type Props = {
  month: string;
  totalCostCents: number | null;
  knownSubtotalCents: number;
  costsComplete: boolean;
};

function brl(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

function editAmount(cents: number): string {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
}

function parseRevenueCents(text: string): number | null {
  const match = /^(\d{1,10})(?:[,.](\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= 100000000000
    ? cents
    : null;
}

async function readRevenue(month: string, signal?: AbortSignal): Promise<RevenueData> {
  const response = await fetch(
    `/api/zion-admin/manual-revenue?month=${encodeURIComponent(month)}`,
    { credentials: "include", cache: "no-store", signal },
  );
  const raw: unknown = await response.json().catch(() => null);
  const payload = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : null;
  if (!response.ok) {
    throw new Error(typeof payload?.error === "string" ? payload.error : "Não foi possível consultar a receita.");
  }
  if (!payload || payload.ok !== true || payload.month !== month ||
      typeof payload.confirmed !== "boolean" || !Array.isArray(payload.history)) {
    throw new Error("A leitura da receita não pôde ser confirmada.");
  }
  const revenue = payload.revenue as RevenueRecord | null;
  if (payload.confirmed &&
      (!revenue || !Number.isSafeInteger(revenue.amountBrlCents) ||
       revenue.amountBrlCents < 0 || !Number.isSafeInteger(revenue.revision))) {
    throw new Error("Os dados da receita estão inválidos.");
  }
  return payload as RevenueData;
}

export default function ZionAdminManualRevenue({
  month, totalCostCents, knownSubtotalCents, costsComplete,
}: Props) {
  const [data, setData] = useState<RevenueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("0,00");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const operationKey = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => readRevenue(month, controller.signal))
      .then((result) => {
        if (!controller.signal.aborted) { setData(result); setLoading(false); }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Receita indisponível.");
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [month]);

  const revenue = data?.confirmed ? data.revenue : null;
  const hasKnownCosts = Number.isSafeInteger(knownSubtotalCents) && knownSubtotalCents >= 0;
  const costBase = totalCostCents ?? (hasKnownCosts ? knownSubtotalCents : null);
  const result = revenue && costBase !== null ? revenue.amountBrlCents - costBase : null;
  const partial = !costsComplete || totalCostCents === null;

  function beginEdit() {
    setAmount(editAmount(revenue?.amountBrlCents ?? 0));
    setEditing(true);
    setError(null);
    setFeedback(null);
    operationKey.current = null;
  }

  async function saveRevenue() {
    const cents = parseRevenueCents(amount);
    if (cents === null || !data) {
      setError("Informe um valor válido em reais, incluindo 0,00 quando não houve receita.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      operationKey.current ??= crypto.randomUUID();
      const response = await fetch("/api/zion-admin/manual-revenue", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          month,
          amountBrlCents: cents,
          expectedRevision: data.revenue?.revision ?? 0,
          operationKey: operationKey.current,
        }),
      });
      const raw: unknown = await response.json().catch(() => null);
      const payload = raw && typeof raw === "object" && !Array.isArray(raw)
        ? raw as Record<string, unknown>
        : null;
      if (!response.ok || payload?.ok !== true || payload.month !== month ||
          payload.amountBrlCents !== cents) {
        throw new Error(typeof payload?.error === "string" ? payload.error : "O salvamento não pôde ser confirmado.");
      }
      const refreshed = await readRevenue(month);
      if (!refreshed.confirmed || refreshed.revenue?.amountBrlCents !== cents) {
        throw new Error("Receita enviada, mas a confirmação de leitura está pendente.");
      }
      setData(refreshed);
      setEditing(false);
      setFeedback("Receita mensal salva e confirmada.");
      operationKey.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível confirmar a receita.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-[#2e6170] bg-[#0d1b24] p-4" aria-label="Receita manual e resultado mensal">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Receita de assinaturas e resultado</h3>
          <p className="mt-1 text-[11px] text-[#9bb4c1]">Valor recebido informado manualmente para {month.slice(0, 7)}. Sem cobrança automática.</p>
        </div>
        {data && !editing ? <button className="rounded-lg border border-cyan-400/40 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/10" type="button" onClick={beginEdit}>{revenue ? "Editar receita" : "Informar receita"}</button> : null}
      </div>
      {loading ? <p className="text-xs text-[#9bb4c1]">Consultando a receita mensal...</p> : null}
      {error ? <p role="alert" className="text-xs text-amber-200">{error}</p> : null}
      {feedback ? <p role="status" className="text-xs text-emerald-300">{feedback}</p> : null}
      {data ? <>
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-[#29414b] p-3"><div className="text-[11px] text-[#94b1bd]">Receita mensal confirmada</div><div className="mt-1 text-base font-semibold text-white tabular-nums">{revenue ? brl(revenue.amountBrlCents) : "Não informada"}</div></div>
          <div className="rounded-lg border border-[#29414b] p-3"><div className="text-[11px] text-[#94b1bd]">{partial ? "Despesas conhecidas" : "Despesas apuradas"}</div><div className="mt-1 text-base font-semibold text-white tabular-nums">{costBase === null ? "Indisponível" : brl(costBase)}</div></div>
          <div className="rounded-lg border border-[#29414b] p-3"><div className="text-[11px] text-[#94b1bd]">{partial ? "Resultado parcial" : "Resultado operacional"}</div><div className="mt-1 text-base font-semibold text-white tabular-nums">{result === null ? "Indisponível" : brl(result)}</div></div>
        </div>
        <p className="text-[11px] text-amber-200">{partial ? "Resultado parcial: ainda existem fontes financeiras sem comprovação, incluindo a Meta. Não representa lucro ou prejuízo fechado." : "Resultado operacional com custos registrados; ainda não representa pagamento confirmado nem fechamento definitivo."}</p>
        {editing ? <form className="flex flex-wrap items-end gap-2 rounded-lg border border-[#315965] p-3" onSubmit={(event) => { event.preventDefault(); void saveRevenue(); }}>
          <label className="text-xs text-[#c3dbe3]">Receita recebida (R$)
            <input className="mt-1 block w-44 rounded-lg border border-[#42606b] bg-[#09141b] p-2 text-white" inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); operationKey.current = null; }} placeholder="0,00" required aria-label="Receita recebida em reais" />
          </label>
          <button className="rounded-lg bg-[#145765] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50" type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar receita"}</button>
          <button className="rounded-lg border border-[#465966] px-4 py-2 text-xs text-white disabled:opacity-50" type="button" disabled={saving} onClick={() => { setEditing(false); setError(null); operationKey.current = null; }}>Cancelar</button>
          <p className="w-full text-[11px] text-[#9bb4c1]">Para meses sem vendas, salve 0,00. Sem registro significa receita desconhecida.</p>
        </form> : null}
        {data.history.length > 0 ? <details className="text-xs text-[#a4c1cb]"><summary className="cursor-pointer">Histórico de alterações ({data.history.length} últimas revisões)</summary><ul className="mt-2 space-y-1">{data.history.map((row) => <li key={row.revision}>Revisão {row.revision}: {brl(row.amountBrlCents)} — {new Date(row.recordedAt).toLocaleString("pt-BR")}</li>)}</ul></details> : null}
      </> : null}
    </section>
  );
}
