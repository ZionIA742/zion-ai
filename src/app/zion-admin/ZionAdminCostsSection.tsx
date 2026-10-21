"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type CostFrequency = "monthly" | "annual";
type FixedCost = { id: string; name: string; amount_cents: number; frequency: CostFrequency; enabled: boolean; effective_month: string };
type MonthlyRow = { month: string; closed: boolean; fixedCents: number; variableCents: number | null; totalCents: number | null; aiCostUsd: number; fxRate: number | null; executions: number; unpriced: number; tokens: number };
type CostData = {
  months: MonthlyRow[];
  fixedCosts: FixedCost[];
  closeCandidates: string[];
  historicalClosures: Array<{ month: string; total_brl_cents: number; fixed_brl_cents: number; variable_brl_cents: number }>;
  totals: {
    fixedCents: number; variableCents: number | null; totalCents: number | null; aiCostUsd: number;
    executions: number; tokens: number; unpricedExecutions: number;
    messagesSales: number | null; messagesAssistant: number | null;
    breakdown: Record<string,{usd:number;tokens:number;runs:number}>;
  };
  note: string;
  fxSource: string;
};
const PALETTE = {
  surface: "rounded-xl border border-[#263540] bg-[#101a22]",
  input: "rounded-lg border border-[#304650] bg-[#08131b] px-3 py-2 text-xs text-[#e9f3f5] outline-none focus:border-[#56c7d8]",
  action: "rounded-lg border border-[#378697] bg-[#153943] px-3 py-2 text-xs font-semibold text-[#b1f0f5] transition hover:bg-[#21505a]",
};
const CATEGORIES = [
  ["sales", "IA vendedora"],["assistant", "IA assistente"],["images", "Geração de imagem"],
  ["catalog", "Catálogo visual"],["unclassified", "Não classificado"],
] as const;
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
function brl(value: number | null | undefined) {
  return value == null ? "Não apurado" : new Intl.NumberFormat("pt-BR", {style:"currency",currency:"BRL"}).format(value / 100);
}
function usd(value: number | null | undefined) {
  return value == null ? "Não apurado" : new Intl.NumberFormat("en-US", {style:"currency",currency:"USD",minimumFractionDigits:4,maximumFractionDigits:6}).format(value);
}
function number(value: number | null | undefined) {
  return value == null ? "Não verificado" : new Intl.NumberFormat("pt-BR").format(value);
}
function localToday() {
  return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
}
function nextMonthLabel() {
  const parts=localToday().split("-").map(Number);
  const date=new Date(Date.UTC(parts[0],parts[1],1));
  return `${MONTHS[date.getUTCMonth()]} de ${date.getUTCFullYear()}`;
}
function FinancialCard({label,value,sub,accent=false}:{label:string;value:string;sub:string;accent?:boolean}) {
  return <div className={`${PALETTE.surface} min-w-0 p-3 ${accent ? "border-cyan-500/35 bg-[#122c37]" : ""}`}>
    <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[#a5bac5]">{label}</p>
    <p className={`mt-1 break-words text-xl font-semibold tabular-nums ${accent ? "text-[#8ae5ef]" : "text-white"}`}>{value}</p>
    <p className="mt-1 text-[11px] leading-4 text-[#8499a9]">{sub}</p>
  </div>;
}

export default function ZionAdminCostsSection() {
  const [period,setPeriod]=useState<"day"|"week"|"month"|"year">("month");
  const [anchor,setAnchor]=useState(localToday);
  const [data,setData]=useState<CostData|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [feedback,setFeedback]=useState<string|null>(null);
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [editing,setEditing]=useState<FixedCost | "new" | null>(null);
  const [name,setName]=useState("");
  const [amount,setAmount]=useState("");
  const [frequency,setFrequency]=useState<CostFrequency>("monthly");
  const closeAttempted=useRef(new Set<string>());
  const year=Number(anchor.slice(0,4));
  const month=Number(anchor.slice(5,7));

  const fetchCosts=useCallback(async (signal?:AbortSignal) => {
    setLoading(true);setError(null);
    try {
      const query=new URLSearchParams({period,anchor});
      const response=await fetch(`/api/zion-admin/costs?${query}`,{cache:"no-store",credentials:"include",signal});
      const payload=await response.json().catch(()=>null);
      if(!response.ok||!payload||!payload.totals) throw new Error(payload?.error || "Não foi possível carregar os dados de custos.");
      if(!signal?.aborted) setData(payload as CostData);
    } catch (caught) {
      if(!signal?.aborted){setData(null);setError(caught instanceof Error?caught.message:"Não foi possível carregar os custos.");}
    } finally { if(!signal?.aborted) setLoading(false); }
  },[period,anchor]);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) void fetchCosts(controller.signal);
    });
    return () => controller.abort();
  }, [fetchCosts]);

  // First visit after month end triggers close, one month at a time; the DB atomically freezes the result.
  useEffect(()=>{
    const next=data?.closeCandidates.find((m)=>!closeAttempted.current.has(m));
    if (!next || saving || loading) return;
    closeAttempted.current.add(next);
    let alive=true;
    (async()=>{
      try {
        const response=await fetch("/api/zion-admin/costs",{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({action:"close",month:next})});
        const payload=await response.json().catch(()=>null);
        if(!response.ok) throw new Error(payload?.error || "Fechamento não concluído.");
        if(alive) void fetchCosts();
      } catch(caught) {
        if(alive)setFeedback(`Fechamento de ${next.slice(0,7)} pendente: ${caught instanceof Error?caught.message:"verifique as fontes"}`);
      }
    })();
    return()=>{alive=false;};
  },[data,fetchCosts,loading,saving]);

  function startEditing(item: FixedCost|"new"){
    setEditing(item);setFeedback(null);
    if(item==="new"){setName("");setAmount("");setFrequency("monthly");}
    else {setName(item.name);setAmount((item.amount_cents/100).toFixed(2).replace(".",","));setFrequency(item.frequency);}
  }
  async function submitCost(action:"add"|"edit"|"remove",item?:FixedCost) {
    if(saving) return;
    if(action==="remove" && !window.confirm(`Excluir ${item?.name} dos custos a partir de ${nextMonthLabel()}? Os meses passados serão preservados.`)) return;
    const cleaned=amount.trim().replace(/^R\$\s*/, "").replace(/\s/g,"");
    const clean=cleaned.includes(",") ? cleaned.replace(/\./g,"").replace(",",".") : cleaned;
    const numeric=Number(clean);
    if(action!=="remove" && (!Number.isFinite(numeric)||numeric<0||!/^\d+(?:\.\d{1,2})?$/.test(clean))){
      setFeedback("Informe o valor em reais (ex.: 104,00).");return;
    }
    setSaving(true);setFeedback(null);
    try{
      const response=await fetch("/api/zion-admin/costs",{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({action,id:item?.id,name:action==="remove"?undefined:name,amountCents:action==="remove"?undefined:Math.round(numeric*100),frequency:action==="remove"?undefined:frequency})});
      const payload=await response.json().catch(()=>null);
      if(!response.ok) throw new Error(payload?.error||"Não foi possível salvar.");
      setEditing(null);setFeedback(`Despesa ${action==="remove"?"excluída":"atualizada"} para os meses a partir de ${nextMonthLabel()}. O histórico não mudou.`);
      void fetchCosts();
    }catch(caught){setFeedback(caught instanceof Error?caught.message:"Falha ao salvar.");}
    finally{setSaving(false);}
  }

  function selectYear(value:number){const chosen=Math.max(2020,Math.min(Number(localToday().slice(0,4)),value));setAnchor(`${chosen}-${String(month).padStart(2,"0")}-01`);}
  const displayData=useMemo(()=>data?.months?.slice().reverse()??[],[data]);
  const maxMonth=Math.max(1, Math.min(12, Number(localToday().slice(0,4))===year?Number(localToday().slice(5,7)):12));
  return <section className="space-y-3" aria-label="Controle financeiro do ZION">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#71dce7]">Controle financeiro</p>
      <h2 className="mt-1 text-xl font-semibold text-[#f4f8fa]">Custos do ZION</h2>
      <p className="mt-1 text-xs text-[#8ca5b4]">Custos fixos a partir de 23/11/2026 (novembro integral), consumo da IA e fechamento mensal. Custos da IA em BRL estimados pela PTAX.</p></div>
    </div>
    <div className={`${PALETTE.surface} flex flex-wrap items-center gap-2 p-2`}>
      {([ ["day","Dia"],["week","Semana"],["month","Mês"],["year","Ano"]] as const).map(([key,label])=><button key={key} type="button" aria-pressed={period===key} onClick={()=>setPeriod(key)} className={`rounded-lg border px-4 py-2 text-xs font-semibold ${period===key?"border-cyan-400/50 bg-[#164653] text-[#a6f5f7]":"border-[#293944] bg-[#0c141b] text-[#aebec9] hover:border-[#428496]"}`}>{label}</button>)}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {(period==="day"||period==="week")?<label className="text-xs text-[#9fb8c4]">{period==="week"?"Escolha um dia da semana":"Escolha o dia"} <input aria-label="Data de referência" className={`${PALETTE.input} ml-2`} type="date" value={anchor} max={localToday()} onChange={(event)=>{if(event.target.value)setAnchor(event.target.value);}} /></label>:
          <><label className="text-xs text-[#9fb8c4]">Ano <input type="number" aria-label="Ano" className={`${PALETTE.input} ml-1 w-20`} min={2020} max={Number(localToday().slice(0,4))} value={year} onChange={e=>selectYear(Number(e.target.value))}/></label>
          {period==="month"?<label className="text-xs text-[#9fb8c4]">Mês <select aria-label="Mês" className={`${PALETTE.input} ml-1`} value={Math.min(month,maxMonth)} onChange={e=>setAnchor(`${year}-${String(e.target.value).padStart(2,"0")}-01`)}>{MONTHS.slice(0,maxMonth).map((name,index)=><option value={index+1} key={name}>{name}</option>)}</select></label>:null}</>}
      </div>
    </div>
    {error?<div role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/[0.08] p-3 text-xs text-amber-100">{error}</div>:null}
    {feedback?<div role="status" className="rounded-xl border border-cyan-500/30 bg-cyan-500/[0.06] p-3 text-xs text-cyan-100">{feedback}</div>:null}
    {loading&&!data?<p className="text-sm text-[#9fb6c2]">Carregando informações financeiras...</p>:null}
    {data?<>
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <FinancialCard label="Custos fixos" value={brl(data.totals.fixedCents)} sub="Despesas cadastradas, conforme a vigência" />
        <FinancialCard label="IA variável" value={brl(data.totals.variableCents)} sub={`${usd(data.totals.aiCostUsd)} em custos registrados`} />
        <FinancialCard accent label="Total consolidado" value={brl(data.totals.totalCents)} sub="Fixos + consumo da IA, sem dupla contagem" />
        <FinancialCard label="Execuções da IA" value={number(data.totals.executions)} sub={`${number(data.totals.tokens)} tokens utilizados`} />
      </div>
      {(data.totals.variableCents==null || data.totals.unpricedExecutions>0)?<div className="rounded-xl border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">A conversão em reais está incompleta: cotação PTAX indisponível ou {data.totals.unpricedExecutions} execução(ões) sem custo registrado. Não presumimos custo zero.</div>:null}
      <div className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
        <section className={`${PALETTE.surface} p-3`}>
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold text-white">Despesas fixas</h3><p className="text-[11px] text-[#91a7b6]">Edições e exclusões passam a valer em {nextMonthLabel()}.</p></div><button className={PALETTE.action} type="button" onClick={()=>startEditing("new")}>+ Adicionar custo</button></div>
          <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-[10px] uppercase text-[#7d9bad]"><tr className="border-b border-[#293b46]"><th className="pb-2">Custo</th><th className="pb-2">Periodicidade</th><th className="pb-2 text-right">Valor</th><th className="pb-2 text-right">Ações</th></tr></thead><tbody>{data.fixedCosts.map((item)=><tr className="border-b border-[#24333c] last:border-0" key={item.id}><td className="py-2.5 pr-2 font-medium text-[#e3f1f2]">{item.name}{!item.enabled?<span className="ml-2 text-[10px] text-amber-300">Excluído a partir da vigência</span>:null}</td><td className="py-2 text-[#90a5b4]">{item.frequency==="annual"?"Anual (rateado)":"Mensal"}</td><td className="py-2 text-right text-[#d9f9fb] tabular-nums">{brl(item.amount_cents)}</td><td className="py-2 text-right whitespace-nowrap"><button type="button" aria-label={`Editar ${item.name}`} onClick={()=>startEditing(item)} className="rounded-md p-1.5 text-[#6bd1df] hover:bg-cyan-500/10" title="Editar custo">✎</button><button type="button" aria-label={`Excluir ${item.name}`} onClick={()=>void submitCost("remove",item)} disabled={saving} className="rounded-md p-1.5 text-red-300 hover:bg-red-500/10" title="Excluir dos próximos meses">✕</button></td></tr>)}</tbody></table></div>
          <p className="mt-2 text-[11px] text-[#819eae]">Domínio: os R$ 40 anuais são distribuídos por 12 meses, com ajuste dos centavos para totalizar exatamente R$ 40 no ano.</p>
        </section>
        <section className={`${PALETTE.surface} p-3`}><h3 className="text-sm font-semibold text-white">Uso da IA por tipo</h3><p className="mt-1 text-[11px] text-[#91a7b6]">O custo pertence à execução de IA, não é cobrado de novo por token ou mensagem.</p><div className="mt-3 space-y-2">{CATEGORIES.map(([key,label])=>{const item=data.totals.breakdown[key];return <div key={key} className="flex items-center justify-between gap-2 rounded-lg border border-[#293943] bg-[#0b141c] p-2.5"><div><div className="text-xs font-medium text-[#e8f2f5]">{label}</div><div className="text-[11px] text-[#8ba4b2]">{number(item?.runs)} exec. · {number(item?.tokens)} tokens</div></div><div className="text-xs font-semibold tabular-nums text-[#8ae6ec]">{usd(item?.usd)}</div></div>;})}</div></section>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        <FinancialCard label="Mensagens IA vendedora" value={number(data.totals.messagesSales)} sub="Mensagens registradas no período" />
        <FinancialCard label="Mensagens IA assistente" value={number(data.totals.messagesAssistant)} sub="Mensagens registradas no período" />
        <FinancialCard label="Consumo em dólares" value={usd(data.totals.aiCostUsd)} sub="Fonte: ai_runs.cost_usd" />
      </div>
      <section className={`${PALETTE.surface} p-3`}><div className="flex flex-wrap justify-between gap-2"><div><h3 className="text-sm font-semibold text-white">Fechamentos e histórico</h3><p className="mt-1 text-[11px] text-[#91a7b6]">Fechamentos anteriores são preservados sem recálculo, mesmo após excluir ou alterar despesas.</p></div><span className="h-fit rounded-lg border border-[#2e6170] bg-[#153541] px-2 py-1 text-[10px] text-cyan-100">{data.closeCandidates.length?`${data.closeCandidates.length} pendente(s)`:"Atualizado"}</span></div><div className="mt-3 overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b border-[#31434e] text-left text-[10px] uppercase text-[#8da7b7]"><th className="pb-2">Mês</th><th className="pb-2 text-right">Fixos</th><th className="pb-2 text-right">IA variável</th><th className="pb-2 text-right">Total</th><th className="pb-2 text-right">Situação</th></tr></thead><tbody>{displayData.map(row=><tr key={row.month} className="border-b border-[#253742] last:border-0"><td className="py-2.5 text-[#e4f2f4]">{MONTHS[Number(row.month.slice(5,7))-1]} {row.month.slice(0,4)}</td><td className="py-2.5 text-right tabular-nums">{brl(row.fixedCents)}</td><td className="py-2.5 text-right tabular-nums">{brl(row.variableCents)}</td><td className="py-2.5 text-right font-semibold tabular-nums text-[#8ae6ef]">{brl(row.totalCents)}</td><td className="py-2.5 text-right text-[11px]">{row.closed?<span className="text-emerald-300">Fechado</span>:<span className="text-amber-200">Aberto / não fechado</span>}</td></tr>)}</tbody></table></div></section>
      <p className="text-[11px] leading-5 text-[#879da9]">{data.note} Fonte da cotação: {data.fxSource}. Para reconciliação com a fatura real de cartão, é necessário conferir a taxa efetivamente cobrada.</p>
    </>:null}
    {editing?<div role="dialog" aria-modal="true" aria-label="Editar despesa fixa" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 px-3"><form onSubmit={e=>{e.preventDefault();void submitCost(editing==="new"?"add":"edit",editing==="new"?undefined:editing);}} className="w-full max-w-md space-y-3 rounded-2xl border border-[#3b7e8b] bg-[#0d1b24] p-5 shadow-2xl"><div><h3 className="text-base font-semibold text-white">{editing==="new"?"Adicionar despesa fixa":"Editar despesa fixa"}</h3><p className="mt-1 text-xs text-[#a2b8c3]">A alteração começará em {nextMonthLabel()}. Fechamentos antigos não serão modificados.</p></div><label className="block text-xs text-[#aebdc5]">Nome<input required maxLength={100} value={name} onChange={e=>setName(e.target.value)} className={`${PALETTE.input} mt-1 w-full`} placeholder="Ex.: Hospedagem"/></label><label className="block text-xs text-[#aebdc5]">Valor em reais<input required inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} className={`${PALETTE.input} mt-1 w-full`} placeholder="100,00"/></label><label className="block text-xs text-[#aebdc5]">Frequência<select value={frequency} onChange={e=>setFrequency(e.target.value as CostFrequency)} className={`${PALETTE.input} mt-1 w-full`}><option value="monthly">Mensal</option><option value="annual">Anual (dividido por 12)</option></select></label><div className="flex justify-end gap-2"><button type="button" className="rounded-lg border border-[#3e4b57] px-3 py-2 text-xs text-white" onClick={()=>setEditing(null)}>Cancelar</button><button disabled={saving} type="submit" className={PALETTE.action}>{saving?"Salvando...":"Salvar para o próximo mês"}</button></div></form></div>:null}
  </section>;
}
