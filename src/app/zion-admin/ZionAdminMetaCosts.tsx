"use client";

import { useEffect, useState } from "react";
import {
  formatMetaPricingDisplay,
  readMetaEvidenceForStore,
  type MetaStoreOption,
} from "@/lib/zion-admin-meta-cost-presentation";

type ApiResult = { ok: boolean; payload: unknown; code: string };

function localMonth() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit",
  }).format(new Date());
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

async function readEndpoint(url: string, signal: AbortSignal): Promise<ApiResult> {
  try {
    const response = await fetch(url, { cache: "no-store", credentials: "include", signal });
    const payload: unknown = await response.json().catch(() => null);
    const root = object(payload);
    const code = typeof root?.code === "string" && /^[A-Z0-9_]{3,80}$/.test(root.code)
      ? root.code : "DADOS_INDISPONIVEIS";
    return { ok: response.ok && root?.ok === true, payload, code };
  } catch {
    return { ok: false, payload: null, code: "DADOS_INDISPONIVEIS" };
  }
}

const surface = "rounded-xl border border-[#263540] bg-[#101a22] p-3";

export default function ZionAdminMetaCosts() {
  const [month, setMonth] = useState(localMonth);
  const [stores, setStores] = useState<MetaStoreOption[]>([]);
  const [storeId, setStoreId] = useState("");
  const [storeError, setStoreError] = useState<string | null>(null);
  const [storeLoading, setStoreLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; pricing: ApiResult; evidence: ApiResult } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(async () => {
      const response = await readEndpoint("/api/zion-admin/meta-integrations", controller.signal);
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setStoreError("Não foi possível consultar as integrações da Meta.");
        setStoreLoading(false);
        return;
      }
      const root = object(response.payload);
      const choices = Array.isArray(root?.stores) ? root.stores.filter((item): item is MetaStoreOption => {
        const value = object(item);
        return typeof value?.storeId === "string" && typeof value.label === "string" &&
          (value.status === "ready" || value.status === "incomplete" || value.status === "ambiguous");
      }) : [];
      setStores(choices);
      setStoreId(choices.find(item => item.status === "ready")?.storeId ?? "");
      setStoreLoading(false);
    });
    return () => controller.abort();
  }, []);

  const selected = stores.find(item => item.storeId === storeId && item.status === "ready");
  const selectedId = selected?.storeId ?? "";
  const requestKey = `${selectedId}:${month}:${revision}`;

  useEffect(() => {
    if (!selectedId || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) return;
    const controller = new AbortController();
    const key = `${selectedId}:${month}:${revision}`;
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      const params = new URLSearchParams({ storeId: selectedId, month });
      const [pricing, evidence] = await Promise.all([
        readEndpoint(`/api/zion-admin/meta-pricing?${params}`, controller.signal),
        readEndpoint(`/api/zion-admin/meta-cost-evidence?month=${encodeURIComponent(month)}`, controller.signal),
      ]);
      if (!controller.signal.aborted) setResult({ key, pricing, evidence });
    });
    return () => controller.abort();
  }, [selectedId, month, revision]);

  const currentResult = result?.key === requestKey ? result : null;
  const summary = formatMetaPricingDisplay(currentResult?.pricing.ok ? currentResult.pricing.payload : null);
  const evidence = currentResult?.evidence.ok
    ? readMetaEvidenceForStore(currentResult.evidence.payload, selectedId) : null;
  const integer = (value: number) => new Intl.NumberFormat("pt-BR").format(value);
  const isLoading = Boolean(selectedId) && !currentResult;
  const hasResult = Boolean(selectedId) && Boolean(currentResult);

  return <section className={`${surface} space-y-3`} aria-label="Custos Meta WhatsApp">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold text-white">Meta / WhatsApp</h3>
        <p className="mt-1 text-[11px] text-[#91a7b6]">Apuração mensal por loja. Valores da Meta são aproximados e não equivalem à fatura.</p>
      </div>
      <button type="button" onClick={() => setRevision(value => value + 1)}
        disabled={!selectedId || isLoading}
        className="rounded-lg border border-[#378697] bg-[#153943] px-3 py-2 text-xs text-[#b1f0f5] disabled:opacity-50">
        Atualizar dados
      </button>
    </div>
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-[11px] text-[#b8d0da]">Loja
        <select value={storeId} onChange={event => setStoreId(event.target.value)}
          aria-label="Loja para custos Meta"
          className="ml-2 rounded-lg border border-[#304650] bg-[#08131b] px-3 py-2 text-xs text-white">
          {storeId === "" ? <option value="">Selecione uma loja</option> : null}
          {stores.map(item => <option key={item.storeId} value={item.storeId} disabled={item.status !== "ready"}>
            {item.label}{item.status === "ready" ? "" : " (integração indisponível)"}
          </option>)}
        </select>
      </label>
      <label className="text-[11px] text-[#b8d0da]">Competência
        <input type="month" aria-label="Competência Meta" value={month}
          max={localMonth()} onChange={event => { if (event.target.value) setMonth(event.target.value); }}
          className="ml-2 rounded-lg border border-[#304650] bg-[#08131b] px-3 py-2 text-xs text-white" />
      </label>
    </div>
    {storeLoading ? <p className="text-xs text-[#91a7b6]">Consultando integrações...</p> : null}
    {storeError ? <p role="status" className="text-xs text-amber-200">{storeError}</p> : null}
    {!storeLoading && !storeError && stores.length === 0 ?
      <p className="text-xs text-[#91a7b6]">Nenhuma integração Meta disponível.</p> : null}
    {!storeLoading && !storeError && stores.length > 0 && !selectedId ?
      <p className="text-xs text-amber-200">Nenhuma integração apta à consulta financeira. Verifique a configuração das lojas.</p> : null}
    {isLoading ? <p className="text-xs text-[#91a7b6]">Consultando as fontes financeiras da Meta...</p> : null}
    {hasResult ? <>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-[#293943] bg-[#0b141c] p-3">
          <p className="text-[10px] text-[#9db5c1]">Custo aproximado Meta</p>
          <p className="mt-1 text-lg font-semibold text-[#8ae6ec]">{summary.monetary}</p>
          <p className="text-[10px] text-[#91a7b6]">{summary.state === "approximate" ? "Moeda original da WABA" : "Valor não confirmado"}</p>
        </div>
        <div className="rounded-lg border border-[#293943] bg-[#0b141c] p-3">
          <p className="text-[10px] text-[#9db5c1]">Volume informado pela Meta</p>
          <p className="mt-1 text-lg font-semibold text-white">{summary.volume}</p>
          <p className="text-[10px] text-[#91a7b6]">Não é um valor financeiro</p>
        </div>
        <div className="rounded-lg border border-[#293943] bg-[#0b141c] p-3">
          <p className="text-[10px] text-[#9db5c1]">Entregas registradas no ZION</p>
          <p className="mt-1 text-lg font-semibold text-white">{evidence ? integer(evidence.delivered) : "Indisponível"}</p>
          <p className="text-[10px] text-[#91a7b6]">Registros locais, não faturamento</p>
        </div>
        <div className="rounded-lg border border-[#293943] bg-[#0b141c] p-3">
          <p className="text-[10px] text-[#9db5c1]">Evidências de cobrança</p>
          <p className="mt-1 text-lg font-semibold text-white">{evidence ? integer(evidence.billableEvidence) : "Indisponível"}</p>
          <p className="text-[10px] text-[#91a7b6]">{evidence ? `${integer(evidence.freeEvidence)} gratuitas · ${integer(evidence.unknownPricing)} sem classificação` : "Fonte local indisponível"}</p>
        </div>
      </div>
      {!currentResult?.pricing.ok ? <p className="text-[11px] text-amber-200" role="status">
        Valores não apurados. Diagnóstico: {currentResult?.pricing.code ?? "DADOS_INDISPONIVEIS"}.
      </p> : null}
      {!currentResult?.evidence.ok ? <p className="text-[11px] text-amber-200" role="status">
        Evidências locais indisponíveis. Diagnóstico: {currentResult?.evidence.code ?? "DADOS_INDISPONIVEIS"}.
      </p> : null}
    </> : null}
    <p className="text-[11px] leading-5 text-[#91a7b6]">
      Valores Meta não estão incluídos no Total consolidado, nem nos fechamentos mensais. Somente faturas reconciliadas podem fundamentar valores definitivos; ausência de dados nunca significa custo zero.
    </p>
  </section>;
}
